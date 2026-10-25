import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { haptic } from "@/lib/haptics";
import { IconBack } from "@/components/icons";
import { hasBackButton, pushBack } from "@/lib/backButton";
import {
  BUILDINGS,
  FADE_MS,
  NAV_AT,
  ZOOM_MS,
  motionMode,
  tierBox,
  zoomVars,
  type Building,
  type BuildingId,
} from "@/lib/buildings";

/**
 * Интерактивные здания (DESIGN.md п. 3.8.3): точка входа на улице, наезд камеры и интерьер раздела.
 * Камера — CSS-классы на <html>: bz-in (наезд на здание), bz-hide (контент растворяется), bz-fade (слабое устройство),
 * bz-snap (без перехода — мгновенно поставить камеру), bz-back (обратный отъезд).
 */
export const setZoomVars = (b: Building, tier: number) => {
  const st = document.documentElement.style;
  for (const [k, v] of Object.entries(zoomVars(b, tier))) st.setProperty(k, v);
};

/** Момент (performance.now), когда камера доедет: экран раздела монтируется раньше и проявляется ровно к нему. */
let arriveAt = 0;
export const msToArrive = () => Math.max(0, arriveAt - performance.now());

/** Вход в здание: наезд 0,45 с; маршрут раздела — уже на 0,15 с (state.bld — «вошли через здание», от этого зависит «Назад»). */
export function enterBuilding(b: Building, tier: number, navigate: NavigateFunction) {
  const root = document.documentElement;
  if (root.classList.contains("bz-hide")) return; // двойной тап во время наезда
  haptic.tap();
  const go = () => navigate(b.route, { state: { bld: b.id } });
  const mode = motionMode();
  if (mode === "none") {
    arriveAt = 0;
    return go();
  }
  setZoomVars(b, tier);
  arriveAt = performance.now() + (mode === "zoom" ? ZOOM_MS : FADE_MS);
  root.classList.add("bz-hide", mode === "zoom" ? "bz-in" : "bz-fade");
  // маршрут — когда кадр интерьера раскодирован (обычно уже к касанию), но не раньше NAV_AT и не позже конца наезда +0,5 с
  const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
  const end = mode === "zoom" ? ZOOM_MS : FADE_MS;
  Promise.all([wait(NAV_AT[mode]), Promise.race([prefetchInterior(b.id), wait(end + 500)])]).then(go);
}

/**
 * Точка входа на главной — прямо в «окне в город» (обычная кнопка в потоке страницы, не в слое города).
 * Вся башня — зона тапа; видна только маленькая вывеска «◎ МАЙНЕР» в стилистике городских (без UI-рамок),
 * а что на башню можно нажать — покажет туториал. Тап проходит только здесь, промежутки между панелями город не трогают.
 * По горизонтали окно и сцена города центрированы одинаково, поэтому x башни считается от центра:
 * left = 50% + ширина сцены × (x − 360) / 720.
 */
export function TowerHotspot({ tier }: { tier: number }) {
  const navigate = useNavigate();
  const b = BUILDINGS.reactor;
  const [x, , w] = tierBox(b, tier);
  const style = { "--bx": String(x - 360), "--bw": String(w) } as CSSProperties;
  return (
    <button
      type="button"
      className={`bh bh-${b.id} t${tier}`}
      style={style}
      aria-label={`${b.name}: войти — раздел «${b.section}»`}
      onPointerDown={() => prefetchInterior(b.id)}
      onClick={() => enterBuilding(b, tier, navigate)}
    >
      {/* вывеска на башне — неоновая лопасть, как «ОБМЕН» и «РЕАКТОР»: тёмная табличка, светящаяся кромка */}
      <i className="bh-press" aria-hidden="true" />
      <span className="bh-sign" aria-hidden="true">
        <i className="bh-glyph" />
        <b>{b.section.toUpperCase()}</b>
      </span>
    </button>
  );
}

// интерьер — один нарисованный кадр на тему (тёмный / светлый), грузится только нужный и только при входе
const loaders = import.meta.glob<string>("../assets/city/interior/*.webp", { query: "?url", import: "default" });
const urls: Record<string, string> = {};
const pending: Record<string, Promise<void>> = {};
const isLight = () => document.documentElement.dataset.theme === "light";
const fileOf = (id: BuildingId, light = isLight()) => (light ? `${id}-light` : id);

/** скачать и раскодировать кадр интерьера заранее — с первого касания здания */
export function prefetchInterior(id: BuildingId, light = isLight()): Promise<void> {
  const f = fileOf(id, light);
  return (pending[f] ??= (loaders[`../assets/city/interior/${f}.webp`]?.() ?? Promise.reject())
    .then((u) => {
      urls[f] = u;
      const img = new Image();
      img.src = u;
      return img.decode().catch(() => undefined);
    })
    .catch(() => undefined));
}

export type InteriorAnim = "zoom" | "fade" | "dock" | "out" | "out-fade" | "still";

export function Interior({ id, anim, delay = 0 }: { id: BuildingId; anim: InteriorAnim; delay?: number }) {
  const [light, setLight] = useState(isLight);
  const f = fileOf(id, light);
  const [url, setUrl] = useState<string | undefined>(urls[f]);
  useEffect(() => {
    // смена темы внутри здания — перерисовать кадр под тему
    const mo = new MutationObserver(() => setLight(isLight()));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => mo.disconnect();
  }, []);
  useEffect(() => {
    if (urls[f]) return setUrl(urls[f]);
    let alive = true;
    prefetchInterior(id, light).then(() => {
      if (alive) setUrl(urls[f]);
    });
    return () => {
      alive = false;
    };
  }, [id, f, light]);
  return (
    <div
      className={`bi bi-${id} a-${anim}`}
      style={delay ? ({ animationDelay: `${Math.round(delay)}ms` } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      {url && <img src={url} alt="" decoding="async" />}
    </div>
  );
}

/**
 * «Назад» из здания: системная кнопка Telegram (или ссылка вне Telegram) — шаг назад по истории;
 * улица ловит этот шаг (POP) и проигрывает отъезд камеры.
 */
export function StreetBack({ active }: { active: boolean }) {
  const navigate = useNavigate();
  useEffect(() => (active ? pushBack(() => navigate(-1)) : undefined), [active, navigate]);
  if (!active || hasBackButton()) return null;
  return (
    <button type="button" className="ui-btn secondary sm mb-3" onClick={() => navigate(-1)}>
      <IconBack size={16} /> На улицу
    </button>
  );
}

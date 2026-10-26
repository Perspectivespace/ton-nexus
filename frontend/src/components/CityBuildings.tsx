import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { haptic } from "@/lib/haptics";
import { IconBack } from "@/components/icons";
import { hasBackButton, pushBack } from "@/lib/backButton";
import { prefetchRoute } from "@/lib/routes";
import { warmFonts } from "@/lib/fontWarm";
import {
  BUILDINGS,
  FADE_MS,
  NAV_AT,
  hitShape,
  ZOOM_MS,
  motionMode,
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
  // маршрут — когда кадр интерьера раскодирован и чанк раздела загружен (обычно оба готовы уже к касанию:
  // чанк подтянут в простое главной и ещё раз запрошен на pointerdown), но не раньше NAV_AT и не позже конца наезда +0,5 с
  const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
  const end = mode === "zoom" ? ZOOM_MS : FADE_MS;
  const ready = Promise.all([prefetchInterior(b.id), prefetchRoute(b.route), warmFonts()]);
  Promise.all([wait(NAV_AT[mode]), Promise.race([ready, wait(end + 500)])]).then(go);
}

/** отклик нажатия рисует сама башня в слое города (экран «МАЙНЕР» + подсветка): кнопка лишь ставит класс на <html> */
const pressed = (on: boolean) => document.documentElement.classList.toggle("bh-down", on);

/**
 * Точка входа на главной — невидимая кнопка в «окне в город» (в потоке страницы: карточки, наехавшие на башню, тап забирают себе).
 * Город — position: fixed и не скроллится, а окно едет со страницей, поэтому кнопка каждый кадр прокрутки ставится по
 * сцене города (.c-stage) — в координатах кадра 720×1280, как экран «МАЙНЕР» (TowerScreen): форма — силуэт башни (clip-path),
 * без неба над шпилем. Видимая часть — только внутри окна (обрезка .bh-clip): ниже — карточки, они сверху.
 */
export function TowerHotspot({ tier }: { tier: number }) {
  const navigate = useNavigate();
  const b = BUILDINGS.reactor;
  const clipRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const { box, clip } = hitShape(b);

  useLayoutEffect(() => {
    const [x, y, w, h] = box;
    let raf = 0;
    const place = () => {
      raf = 0;
      const stage = document.querySelector<HTMLElement>(".city .c-stage");
      const c = clipRef.current?.getBoundingClientRect();
      const el = btnRef.current;
      if (!stage || !c || !el) return;
      const s = stage.getBoundingClientRect();
      const k = s.width / 720;
      el.style.width = `${w * k}px`;
      el.style.height = `${h * k}px`;
      el.style.transform = `translate3d(${s.left + x * k - c.left}px, ${s.top + y * k - c.top}px, 0)`;
    };
    const queue = () => {
      if (!raf) raf = requestAnimationFrame(place);
    };
    place();
    const stage = document.querySelector(".city .c-stage");
    window.addEventListener("scroll", queue, { passive: true });
    window.addEventListener("resize", queue);
    stage?.addEventListener("transitionend", queue); // сдвиг сцены при входе на главную (.cv2-home)
    const t = window.setTimeout(queue, 700);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
      window.removeEventListener("scroll", queue);
      window.removeEventListener("resize", queue);
      stage?.removeEventListener("transitionend", queue);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tier]);

  return (
    <div className="bh-clip" ref={clipRef}>
      <button
        ref={btnRef}
        type="button"
        className={`bh bh-${b.id} t${tier}`}
        style={{ clipPath: clip } as CSSProperties}
        aria-label={`${b.name}: войти — раздел «${b.section}»`}
        onPointerDown={() => {
          prefetchInterior(b.id);
          void prefetchRoute(b.route);
          void warmFonts();
          pressed(true);
        }}
        onPointerUp={() => pressed(false)}
        onPointerCancel={() => pressed(false)}
        onPointerLeave={() => pressed(false)}
        onClick={() => enterBuilding(b, tier, navigate)}
      />
    </div>
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

import { useEffect, useState, type CSSProperties } from "react";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import { haptic } from "@/lib/haptics";
import { IconBack } from "@/components/icons";
import { hasBackButton, pushBack } from "@/lib/backButton";
import {
  BUILDINGS,
  FADE_MS,
  ZOOM_MS,
  motionMode,
  tierBox,
  zoomVars,
  type Building,
  type BuildingId,
} from "@/lib/buildings";

/**
 * КОНЦЕПТ «интерактивные здания» (DESIGN.md п. 3.8.3): точки входа на улице, наезд камеры и интерьер раздела.
 * Камера — CSS-классы на <html>: bz-in (наезд на здание), bz-hide (контент растворяется), bz-fade (слабое устройство),
 * bz-snap (без перехода — мгновенно поставить камеру), bz-back (обратный отъезд).
 */
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(2)}%`;

export const setZoomVars = (b: Building, tier: number) => {
  const st = document.documentElement.style;
  for (const [k, v] of Object.entries(zoomVars(b, tier))) st.setProperty(k, v);
};

/** Вход в здание: наезд 0,45 с → маршрут раздела (state.bld — «вошли через здание», от этого зависит «Назад»). */
export function enterBuilding(b: Building, tier: number, navigate: NavigateFunction) {
  const root = document.documentElement;
  if (root.classList.contains("bz-hide")) return; // двойной тап во время наезда
  haptic.tap();
  const go = () => navigate(b.route, { state: { bld: b.id } });
  const mode = motionMode();
  if (mode === "none") return go();
  setZoomVars(b, tier);
  root.classList.add("bz-hide", mode === "zoom" ? "bz-in" : "bz-fade");
  // маршрут — когда камера доехала и кадр интерьера готов (не дольше +0,5 с, иначе — фон интерьера, кадр догрузится)
  const wait = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
  const ms = mode === "zoom" ? ZOOM_MS : FADE_MS;
  Promise.all([wait(ms), Promise.race([prefetchInterior(b.id), wait(ms + 500)])]).then(go);
}

/** Точки входа на улице: крупная зона тапа на всё здание, статичная подсветка уголками и подпись на подложке. */
export function CityHotspots({ tier }: { tier: number }) {
  const navigate = useNavigate();
  return (
    <div className="bh-layer">
      {Object.values(BUILDINGS).map((b) => {
        const [x, y, w, h] = tierBox(b, tier);
        const style: CSSProperties = { left: pc(x, 720), top: pc(y, 1280), width: pc(w, 720), height: pc(h, 1280) };
        return (
          <button
            key={b.id}
            type="button"
            className={`bh bh-${b.id}`}
            style={style}
            aria-label={`${b.name}: войти — раздел «${b.section}»`}
            onPointerDown={() => prefetchInterior(b.id)}
            onClick={() => enterBuilding(b, tier, navigate)}
          >
            <i className="bh-frame" aria-hidden="true" />
            <span className="bh-label" aria-hidden="true">
              <span className="bh-name">{b.name}</span>
              <span className="bh-sec">
                {b.section} <span className="bh-go">›</span>
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

// интерьеры — по одному нарисованному кадру на раздел, грузятся при первом входе
const loaders = import.meta.glob<string>("../assets/city/interior/*.webp", { query: "?url", import: "default" });
const urls: Partial<Record<BuildingId, string>> = {};
const pending: Partial<Record<BuildingId, Promise<void>>> = {};

/** скачать и раскодировать кадр интерьера заранее — с первого касания здания */
export function prefetchInterior(id: BuildingId): Promise<void> {
  return (pending[id] ??= (loaders[`../assets/city/interior/${id}.webp`]?.() ?? Promise.reject())
    .then((u) => {
      urls[id] = u;
      const img = new Image();
      img.src = u;
      return img.decode().catch(() => undefined);
    })
    .catch(() => undefined));
}

export type InteriorAnim = "zoom" | "fade" | "dock" | "out" | "out-fade" | "still";

export function Interior({ id, anim }: { id: BuildingId; anim: InteriorAnim }) {
  const [url, setUrl] = useState(urls[id]);
  useEffect(() => {
    if (urls[id]) return setUrl(urls[id]);
    let alive = true;
    prefetchInterior(id).then(() => {
      if (alive) setUrl(urls[id]);
    });
    return () => {
      alive = false;
    };
  }, [id]);
  return (
    <div className={`bi bi-${id} a-${anim}`} aria-hidden="true">
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

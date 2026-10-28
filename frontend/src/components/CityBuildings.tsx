import { useEffect, useState } from "react";
import type { BuildingId } from "@/lib/buildings";

/**
 * Интерьер раздела-здания (DESIGN.md п. 3.8.3): на маршруте «Майнера» вместо улицы — нарисованный зал реактора.
 * Входа через башню на главной больше нет (в «Майнер» ведёт док), поэтому без наезда камеры: интерьер просто проявляется.
 */
// один нарисованный кадр на тему (тёмный / светлый), грузится только нужный и только при входе в раздел;
// пришёл позже проявления зала — сам мягко проявляется (buildings.css, .bi img)
const loaders = import.meta.glob<string>("../assets/city/interior/*.webp", { query: "?url", import: "default" });
const urls: Record<string, string> = {};
const pending: Record<string, Promise<void>> = {};
const isLight = () => document.documentElement.dataset.theme === "light";
const fileOf = (id: BuildingId, light = isLight()) => (light ? `${id}-light` : id);

/** скачать и раскодировать кадр интерьера (один раз на тему) */
function prefetchInterior(id: BuildingId, light = isLight()): Promise<void> {
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

export type InteriorAnim = "dock" | "still";

export function Interior({ id, anim }: { id: BuildingId; anim: InteriorAnim }) {
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
    <div className={`bi bi-${id} a-${anim}`} aria-hidden="true">
      {url && <img src={url} alt="" decoding="async" />}
    </div>
  );
}

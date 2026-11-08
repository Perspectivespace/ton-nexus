import type { CSSProperties } from "react";
import { useCityAds, type CityAdSpotOnBoard } from "@/api/hooks";
import { cityWalk, useCityWalk } from "@/lib/cityWalk";
import { adVars } from "@/lib/cityAdPalette";

/**
 * Рекламные места в городе (PR 3 — простые заготовки; голо-баннеры B и LED-строка A — в PR 4).
 * Координаты — в пикселях кадра 720×1280 (как вывески CityV2), подобраны так, чтобы место было на всех обликах T1–T4.
 * Вне «Прогулки» — только картинка (pointer-events: none, вне фокуса). В «Прогулке» — кнопки: касание открывает карточку.
 */
export const AD_SPOT_BOX: Record<string, [number, number, number, number]> = {
  tower_line: [334, 573, 154, 26],
  banner_sky: [196, 728, 124, 56],
  banner_street: [92, 866, 126, 56],
  neon_left: [236, 934, 112, 30],
  neon_right: [542, 868, 106, 34],
};
const W = 720;
const H = 1280;
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
/** базовый кегль заготовки по формату (px кадра) и средняя ширина знака в em (с разрядкой) */
const FONT: Record<string, [number, number]> = { banner: [20, 0.7], line: [15, 0.78], neon: [22, 0.72] };

/** кегль, при котором заголовок помещается в место (px кадра): длинные названия мельчают, а не обрезаются */
export function fitFont(format: string, title: string, w: number): number {
  const [base, em] = FONT[format] ?? FONT.banner;
  const fit = (w - 14) / (Math.max(1, [...title].length) * em);
  return Math.max(9, Math.min(base, Math.floor(fit * 10) / 10));
}

/** места с объявлением на сегодня, которые умеем нарисовать */
export function liveSpots(spots: CityAdSpotOnBoard[] | undefined): CityAdSpotOnBoard[] {
  return (spots ?? []).filter((s) => s.ad && AD_SPOT_BOX[s.key]);
}

export function CityAdSpots() {
  const { data } = useCityAds();
  const walk = useCityWalk();
  const live = liveSpots(data?.spots);
  if (!live.length) return null;
  return (
    <div className={`cads-live${walk.active ? " is-walk" : ""}`}>
      {live.map((s) => {
        const [x, y, w, h] = AD_SPOT_BOX[s.key];
        const ad = s.ad!;
        const style = { left: pc(x, W), top: pc(y, H), width: pc(w, W), height: pc(h, H), ...adVars(ad.color), "--fs": fitFont(s.format, ad.title, w) } as CSSProperties;
        const label = `Реклама: ${ad.title}${ad.subtitle ? `, ${ad.subtitle}` : ""}`;
        return (
          <button
            key={s.key}
            type="button"
            className={`cad-spot f-${s.format}${walk.picked === s.key ? " picked" : ""}`}
            data-spot={s.key}
            style={style}
            tabIndex={walk.active ? 0 : -1}
            aria-hidden={walk.active ? undefined : true}
            aria-label={label}
            onClick={() => cityWalk.pick(s.key)}
          >
            <span className="t">{ad.title}</span>
            {s.format === "banner" && ad.subtitle && <small>{ad.subtitle}</small>}
          </button>
        );
      })}
    </div>
  );
}

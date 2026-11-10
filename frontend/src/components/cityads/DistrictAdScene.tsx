import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { CityAdFormat } from "@/api/hooks";
import { IdleSurface } from "@/components/IdleSpot";
import { loadDistrict } from "@/lib/districtAssets";
import { ART_ASPECT, SURFACES, lookFor, surfaceBounds, type SceneDistrict, type Surface } from "@/lib/districts";
import { useCityPhase, type CityPhase } from "@/lib/cityPhase";
import { AdScene, CROP_ALL, cropAround, type SceneSlot, type SignContent } from "./AdScene";
import "@/styles/idle-ads.css";

/**
 * Кусок района с местами рекламы — для покупки, «Моих объявлений» и модерации (PR 6).
 * Та же сведённая картинка района (день / ночь), те же доли рисунка 4:3 (SURFACES) и тот же облик места, что на улице
 * (idle-ads.css, класс dz-ad): что видно здесь — то и будет в районе. Без движения (строка стоит).
 * Рамка кадра — доли рисунка: [x, y, ширина, высота].
 */
type Rect = [number, number, number, number];
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const boxOf = (s: Surface): CSSProperties => ({
  left: pct(s.x),
  top: pct(s.y),
  width: pct(s.w),
  height: pct(s.h),
  ...(s.rot ? { transform: `rotate(${s.rot}deg)` } : {}),
});
export const surfaceOf = (spot: string): { district: SceneDistrict; s: Surface } | null => {
  for (const d of ["rows", "port"] as SceneDistrict[]) {
    const s = SURFACES[d]?.find((x) => x.spot === spot);
    if (s) return { district: d, s };
  }
  return null;
};
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/** рамка с заданной пропорцией (ширина / высота в пикселях рисунка) вокруг точки, в пределах рисунка */
function frameAt(cx: number, cy: number, cw: number, aspect: number, lift = 0.5): Rect {
  const w = Math.min(1, cw);
  const h = Math.min(1, (w * ART_ASPECT) / aspect);
  return [clamp(cx - w / 2, 0, 1 - w), clamp(cy - h * lift, 0, 1 - h), w, h];
}

/** весь пояс рекламы района: все четыре места с полями */
export function districtCropAll(d: SceneDistrict, aspect = 1.47): Rect {
  const b = (SURFACES[d] ?? []).map(surfaceBounds);
  if (!b.length) return [0, 0, 1, 1];
  const x0 = Math.min(...b.map((r) => r.x));
  const x1 = Math.max(...b.map((r) => r.x + r.w));
  const y0 = Math.min(...b.map((r) => r.y));
  const y1 = Math.max(...b.map((r) => r.y + r.h));
  // ширина — по местам с полями, но не уже, чем нужно по высоте при этой пропорции
  const w = Math.max(x1 - x0 + 0.1, ((y1 - y0 + 0.14) * aspect) / ART_ASPECT);
  return frameAt((x0 + x1) / 2, (y0 + y1) / 2, w, aspect);
}

/** кадр вокруг места: zoom — во сколько раз крупнее всего рисунка по ширине, aspect — ширина / высота */
export function districtCropAround(spot: string, zoom = 3, aspect = 1.6): Rect {
  const hit = surfaceOf(spot);
  if (!hit) return [0, 0, 1, 1];
  const r = surfaceBounds(hit.s);
  const w = Math.max(1 / zoom, r.w * 1.5);
  return frameAt(r.x + r.w / 2, r.y + r.h / 2, w, aspect, 0.45);
}

function useFlat(d: SceneDistrict, art: "day" | "night"): string | null {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    loadDistrict(d, art, true).then(
      (u) => alive && setSrc(u.flat ?? null),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [d, art]);
  return src;
}

export type PlaceSign = { spot: string; format: CityAdFormat; ad: SignContent };

export function DistrictAdScene({
  district,
  crop,
  phase: forced,
  slots,
  onPick,
  sign,
  className,
  label,
  children,
}: {
  district: SceneDistrict;
  crop?: Rect;
  phase?: CityPhase;
  slots?: SceneSlot[];
  onPick?: (key: string) => void;
  sign?: PlaceSign | null;
  className?: string;
  label?: string;
  children?: ReactNode;
}) {
  const { phase: now } = useCityPhase();
  const phase = forced ?? now;
  const { art } = lookFor(phase);
  const src = useFlat(district, art);
  const [x, y, cw, ch] = crop ?? districtCropAll(district);
  const frame: CSSProperties = {
    width: pct(1 / cw),
    height: pct(1 / ch),
    left: pct(-x / cw),
    top: pct(-y / ch),
  };
  const surfaces = SURFACES[district] ?? [];
  const signAt = sign ? surfaces.find((s) => s.spot === sign.spot) : undefined;
  return (
    <div
      className={`cab-scene cab-dz ph-${phase}${className ? ` ${className}` : ""}`}
      style={{ aspectRatio: `${(cw * ART_ASPECT).toFixed(4)} / ${ch.toFixed(4)}` }}
      role="img"
      aria-label={label}
      data-district={district}
    >
      <div className="cab-frame" style={frame}>
        {src ? <img className="cab-img" src={src} alt="" decoding="async" /> : <span className="cab-img cab-noimg" />}
        <div className={`cads-live cab-live ${art === "night" ? "is-lit" : "is-unlit"}`}>
          {sign && signAt && (
            <div className="dz-idles">
              <IdleSurface spot={signAt.spot} kind={signAt.kind} style={boxOf(signAt)} i={0} price={null} still ad={sign.ad} />
            </div>
          )}
          {slots?.map((sl) => {
            const s = surfaces.find((v) => v.spot === sl.key);
            if (!s) return null;
            return (
              <button
                key={sl.key}
                type="button"
                className={`cab-slot s-${sl.state}`}
                style={boxOf(s)}
                disabled={sl.state === "off" || !onPick}
                aria-pressed={sl.state === "picked"}
                aria-label={sl.label}
                onClick={() => onPick?.(sl.key)}
              >
                <b style={s.rot ? { rotate: `${-s.rot}deg` } : undefined}>{sl.n}</b>
              </button>
            );
          })}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * Место на картинке — Центр (кадр города) или район (рисунок района): один вход для покупки, «Моих объявлений»
 * и модерации. view = "all" — все места района; иначе — крупно вокруг spot (zoom, aspect).
 */
export function PlaceScene({
  district,
  spot,
  zoom = 2.6,
  aspect = 1.6,
  ...rest
}: {
  district: string;
  spot?: string | null;
  zoom?: number;
  aspect?: number;
  phase?: CityPhase;
  slots?: SceneSlot[];
  onPick?: (key: string) => void;
  sign?: PlaceSign | null;
  className?: string;
  label?: string;
  children?: ReactNode;
}) {
  if (district === "rows" || district === "port") {
    const crop = spot ? districtCropAround(spot, zoom + 0.4, aspect) : districtCropAll(district);
    return <DistrictAdScene district={district} crop={crop} {...rest} />;
  }
  return <AdScene crop={spot ? cropAround(spot, zoom, aspect) : CROP_ALL} {...rest} />;
}

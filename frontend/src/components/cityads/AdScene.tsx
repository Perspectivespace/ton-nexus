import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { CityAdFormat } from "@/api/hooks";
import { AD_SPOT_BOX, fitFont } from "@/components/CityAdSpots";
import { loadCityFrame, useCityTier } from "@/components/CityV2";
import { adVars } from "@/lib/cityAdPalette";
import { useCityPhase, type CityPhase } from "@/lib/cityPhase";

/**
 * Кусок города с местами рекламы — для экрана покупки, «Моих объявлений» и модерации.
 * Тот же кадр (облик × фаза), те же координаты (кадр 720×1280) и тот же облик вывески, что на улице (city-ads.css):
 * что видно здесь — то и будет в городе. Без движения: строка на башне стоит, как в режиме «меньше движения».
 */
const W = 720;
const H = 1280;
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
type Rect = [number, number, number, number];
const box = ([x, y, w, h]: Rect): CSSProperties => ({ left: pc(x, W), top: pc(y, H), width: pc(w, W), height: pc(h, H) });

/** весь пояс рекламы: от башни до вывесок у земли */
export const CROP_ALL: Rect = [0, 520, 720, 490];
/** кадр вокруг места: zoom — во сколько раз крупнее полного кадра по ширине, aspect — ширина / высота */
export function cropAround(key: string, zoom = 2, aspect = 1.6): Rect {
  const [x, y, w, h] = AD_SPOT_BOX[key] ?? AD_SPOT_BOX.banner_sky;
  const cw = W / zoom;
  const ch = cw / aspect;
  const cx = Math.min(Math.max(x + w / 2 - cw / 2, 0), W - cw);
  // вывеска чуть выше центра — под ней луч проектора
  const cy = Math.min(Math.max(y + h / 2 - ch * 0.42, 0), H - ch);
  return [cx, cy, cw, ch];
}

export type SignContent = { title: string; subtitle?: string | null; color: string };

/** Вывеска как в городе (голо-баннер / неон / LED-строка). Элементы — div, не кнопки: здесь их не касаются. */
export function Sign({ spot, format, ad }: { spot: string; format: CityAdFormat; ad: SignContent }) {
  const r = AD_SPOT_BOX[spot];
  if (!r) return null;
  if (format === "line") {
    return (
      <div className="cad-spot cad-tick" style={{ ...box(r), ...adVars(ad.color) }}>
        <span className="tk m-still">
          <span className="own">МАЙНЕР</span>
          <span className="tw-win">
            <span className="trk">{ad.title}</span>
          </span>
        </span>
      </div>
    );
  }
  const banner = format === "banner";
  const style = {
    ...box(r),
    ...adVars(ad.color),
    "--fs": fitFont(banner ? "banner" : "neon", ad.title, r[2]),
    "--fs2": banner && ad.subtitle ? fitFont("sub", ad.subtitle, r[2]) : undefined,
  } as CSSProperties;
  return (
    <>
      <i className="cad-halo" style={{ ...box(r), ...adVars(ad.color) }} />
      <div className={`cad-spot cad-holo f-${banner ? "banner" : "neon"}`} style={style}>
        {banner && <i className="emit" />}
        <span className="t">{ad.title}</span>
        {banner && ad.subtitle && <small>{ad.subtitle}</small>}
      </div>
    </>
  );
}

function useFrame(phase: CityPhase): string | null {
  const tier = useCityTier();
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    loadCityFrame(tier, phase)?.then((u) => alive && setSrc(u));
    return () => {
      alive = false;
    };
  }, [tier, phase]);
  return src;
}

export type SceneSlot = { key: string; state: "picked" | "free" | "off"; n: number; label: string };

/**
 * crop — какой кусок кадра показать; slots — рамки мест (выбор места), sign — вывеска с текстом покупателя.
 * phase — «ночью / днём» для превью (по умолчанию — как сейчас в городе).
 */
export function AdScene({
  crop = CROP_ALL,
  phase: forced,
  slots,
  onPick,
  sign,
  className,
  label,
  children,
}: {
  crop?: Rect;
  phase?: CityPhase;
  slots?: SceneSlot[];
  onPick?: (key: string) => void;
  sign?: { spot: string; format: CityAdFormat; ad: SignContent } | null;
  className?: string;
  label?: string;
  children?: ReactNode;
}) {
  const { phase: now } = useCityPhase();
  const phase = forced ?? now;
  const src = useFrame(phase);
  const lit = phase === "night" || phase === "dusk";
  const [x, y, cw, ch] = crop;
  const frame: CSSProperties = {
    width: `${((W / cw) * 100).toFixed(3)}%`,
    height: `${((H / ch) * 100).toFixed(3)}%`,
    left: `${((-x / cw) * 100).toFixed(3)}%`,
    top: `${((-y / ch) * 100).toFixed(3)}%`,
  };
  return (
    <div className={`cab-scene ph-${phase}${className ? ` ${className}` : ""}`} style={{ aspectRatio: `${cw} / ${ch}` }} role="img" aria-label={label}>
      <div className="cab-frame" style={frame}>
        {src ? <img className="cab-img" src={src} alt="" decoding="async" /> : <span className="cab-img cab-noimg" />}
        <div className={`cads-live cab-live ${lit ? "is-lit" : "is-unlit"}`}>
          {sign && <Sign {...sign} />}
          {slots?.map((s) => (
            <button
              key={s.key}
              type="button"
              className={`cab-slot s-${s.state}`}
              style={box(AD_SPOT_BOX[s.key])}
              disabled={s.state === "off" || !onPick}
              aria-pressed={s.state === "picked"}
              aria-label={s.label}
              onClick={() => onPick?.(s.key)}
            >
              <b>{s.n}</b>
            </button>
          ))}
        </div>
      </div>
      {children}
    </div>
  );
}

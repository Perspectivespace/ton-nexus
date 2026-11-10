import type { CSSProperties } from "react";
import { useDistrictAds } from "@/api/hooks";
import { IdleSurface } from "@/components/IdleSpot";
import { SURFACES, type SceneDistrict, type Surface } from "@/lib/districts";

/**
 * Места рекламы района поверх рисунка улицы (внутри слоя «улица» — едет вместе с ним): купленное и одобренное
 * на сегодня объявление (PR 6) — в облике места, свободное — самореклама с ценой из витрины района.
 */
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const boxOf = (s: Surface): CSSProperties => ({
  left: pct(s.x),
  top: pct(s.y),
  width: pct(s.w),
  height: pct(s.h),
  ...(s.rot ? { transform: `rotate(${s.rot}deg)` } : {}),
});

export function DistrictIdleAds({ district, still }: { district: SceneDistrict; still: boolean }) {
  const surfaces = SURFACES[district];
  const { data } = useDistrictAds(district, !!surfaces);
  if (!surfaces) return null;
  const spots = new Map((data?.spots ?? []).map((s) => [s.key, s]));
  return (
    <div className="dz-idles" aria-hidden="true">
      {surfaces.map((s, i) => {
        const spot = spots.get(s.spot);
        // купленное место: тот же облик, текст и цвет покупателя (PR 6)
        const ad = spot?.ad ? { title: spot.ad.title, subtitle: spot.ad.subtitle, color: spot.ad.color } : null;
        // цена места, иначе — цена его типа
        const price = spot?.price_day ?? data?.prices?.[s.kind] ?? null;
        return <IdleSurface key={s.spot} spot={s.spot} kind={s.kind} style={boxOf(s)} i={i} price={price} still={still} ad={ad} />;
      })}
    </div>
  );
}

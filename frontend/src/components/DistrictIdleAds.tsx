import type { CSSProperties } from "react";
import { useDistrictAds } from "@/api/hooks";
import { IdleSurface } from "@/components/IdleSpot";
import { SURFACES, type SceneDistrict, type Surface } from "@/lib/districts";

/**
 * Самореклама свободных мест района поверх рисунка улицы (внутри слоя «улица» — едет вместе с ним).
 * Пока места района не продаются (PR 6), все четыре места «Неон-рядов» показывают её; цена — из витрины района.
 * Только картинка: касание не обрабатывается (покупка в районах — PR 6).
 */
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const boxOf = (s: Surface): CSSProperties => ({ left: pct(s.x), top: pct(s.y), width: pct(s.w), height: pct(s.h) });

export function DistrictIdleAds({ district, still }: { district: SceneDistrict; still: boolean }) {
  const surfaces = SURFACES[district];
  const { data } = useDistrictAds(district, !!surfaces);
  if (!surfaces) return null;
  const spots = new Map((data?.spots ?? []).map((s) => [s.key, s]));
  return (
    <div className="dz-idles" aria-hidden="true">
      {surfaces.map((s, i) => {
        const spot = spots.get(s.spot);
        if (spot?.ad) return null; // купленное место рисует реклама (PR 6)
        // цена места, иначе — цена его типа
        const price = spot?.price_day ?? data?.prices?.[s.kind] ?? null;
        return <IdleSurface key={s.spot} spot={s.spot} kind={s.kind} style={boxOf(s)} i={i} price={price} still={still} />;
      })}
    </div>
  );
}

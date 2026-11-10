import type { CSSProperties } from "react";
import { useDistrictAds } from "@/api/hooks";
import { IdleSurface } from "@/components/IdleSpot";
import { SPOT_SHORT } from "@/lib/cityAdBuy";
import { SURFACES, type SceneDistrict, type Surface } from "@/lib/districts";

/**
 * Места рекламы района поверх рисунка улицы (внутри слоя «улица» — едет вместе с ним): купленное и одобренное
 * на сегодня объявление (PR 6) — в облике места, свободное — самореклама с ценой из витрины района.
 * PR 6b: поверх — зоны касания (.dz-hit, не меньше 44×44 px): купленное место открывает карточку, свободное — покупку.
 * Касание ловит камера района (порог сдвига — протяжка улицы не открывает ничего), клавиатура — Enter / пробел (onAct).
 */
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const boxOf = (s: Surface): CSSProperties => ({
  left: pct(s.x),
  top: pct(s.y),
  width: pct(s.w),
  height: pct(s.h),
  ...(s.rot ? { transform: `rotate(${s.rot}deg)` } : {}),
});

export function DistrictIdleAds({
  district,
  still,
  picked = null,
  onAct,
}: {
  district: SceneDistrict;
  still: boolean;
  picked?: string | null;
  onAct?: (spot: string) => void;
}) {
  const surfaces = SURFACES[district];
  const { data } = useDistrictAds(district, !!surfaces);
  if (!surfaces) return null;
  const spots = new Map((data?.spots ?? []).map((s) => [s.key, s]));
  return (
    <>
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
    {onAct && (
      <div className="dz-hits">
        {surfaces.map((s) => {
          const spot = spots.get(s.spot);
          const ad = spot?.ad;
          // свободное место без витрины (ещё грузится) — тоже ведёт в покупку: место проверит сервер
          if (!ad && spot && !spot.on_sale) return null;
          const name = SPOT_SHORT[s.spot] ?? spot?.title ?? "Место для рекламы";
          return (
            <span
              key={s.spot}
              className="dz-hit"
              data-spot={s.spot}
              data-kind={ad ? "ad" : "buy"}
              role="button"
              tabIndex={0}
              aria-pressed={ad ? picked === s.spot : undefined}
              aria-label={ad ? `Реклама: ${ad.title}${ad.subtitle ? `, ${ad.subtitle}` : ""}` : `Свободное место: ${name} — разместить рекламу`}
              style={boxOf(s)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onAct(s.spot);
              }}
            />
          );
        })}
      </div>
    )}
    </>
  );
}

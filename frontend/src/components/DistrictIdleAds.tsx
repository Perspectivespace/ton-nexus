import type { CSSProperties } from "react";
import { useDistrictAds } from "@/api/hooks";
import { apiUrl } from "@/api/client";
import { ArenaGateMark, ArenaPoster } from "@/components/ArenaPoster";
import { IdleSurface } from "@/components/IdleSpot";
import { isPosterSpot, SPOT_SHORT } from "@/lib/cityAdBuy";
import { type ArenaPosterModel } from "@/lib/arena/poster";
import { ARENA_GATES, SURFACES, type SceneDistrict, type Surface } from "@/lib/districts";
import { t } from "@/i18n";

/**
 * Места рекламы района поверх рисунка улицы (внутри слоя «улица» — едет вместе с ним): купленное и одобренное
 * на сегодня объявление (PR 6) — в облике места, свободное — самореклама с ценой из витрины района.
 * PR 6b: поверх — зоны касания (.dz-hit, не меньше 44×44 px): купленное место открывает карточку, свободное — покупку.
 * Касание ловит камера района (порог сдвига — протяжка улицы не открывает ничего), клавиатура — Enter / пробел (onAct).
 * PR 5 (Арена): arena_facade всегда афиша (не заглушка покупки и не объявление); ворота — вход в игру.
 */
const pct = (v: number) => `${(v * 100).toFixed(3)}%`;
const boxOf = (s: Pick<Surface, "x" | "y" | "w" | "h"> & { rot?: number }): CSSProperties => ({
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
  poster = null,
}: {
  district: SceneDistrict;
  still: boolean;
  picked?: string | null;
  onAct?: (spot: string) => void;
  /** живая афиша Арены; на других районах не передаётся */
  poster?: ArenaPosterModel | null;
}) {
  const surfaces = SURFACES[district];
  const { data } = useDistrictAds(district, !!surfaces);
  if (!surfaces) return null;
  const spots = new Map((data?.spots ?? []).map((s) => [s.key, s]));
  const arena = district === "arena" && poster;
  return (
    <>
    <div className="dz-idles" aria-hidden="true">
      {surfaces.map((s, i) => {
        if (isPosterSpot(s.spot) && poster) {
          return <ArenaPoster key={s.spot} style={boxOf(s)} model={poster} still={still} />;
        }
        const spot = spots.get(s.spot);
        const ad = spot?.ad
          ? {
              title: spot.ad.title,
              subtitle: spot.ad.subtitle,
              color: spot.ad.color,
              image: spot.ad.image_url ? apiUrl(spot.ad.image_url) : null,
            }
          : null;
        const price = spot?.price_day ?? data?.prices?.[s.kind] ?? null;
        return <IdleSurface key={s.spot} spot={s.spot} kind={s.kind} style={boxOf(s)} i={i} price={price} still={still} ad={ad} />;
      })}
      {arena && <ArenaGateMark style={boxOf(ARENA_GATES)} />}
    </div>
    {onAct && (
      <div className="dz-hits">
        {surfaces.map((s) => {
          if (isPosterSpot(s.spot)) {
            if (!poster) return null;
            const closed = poster.kind === "closed";
            return (
              <span
                key={s.spot}
                className="dz-hit"
                data-spot="arena_facade"
                data-kind="poster"
                role="button"
                tabIndex={0}
                aria-label={closed ? t("poster.ariaClosed") : t("poster.aria", { summary: poster.kind === "queue" ? String(poster.waiting) : t("poster.openSub") })}
                style={boxOf(s)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" && e.key !== " ") return;
                  e.preventDefault();
                  onAct("arena_facade");
                }}
              />
            );
          }
          const spot = spots.get(s.spot);
          const ad = spot?.ad;
          if (!ad && spot && !spot.on_sale) return null;
          const name = SPOT_SHORT[s.spot] ?? spot?.title ?? t("idle.adSpace");
          return (
            <span
              key={s.spot}
              className="dz-hit"
              data-spot={s.spot}
              data-kind={ad ? "ad" : "buy"}
              role="button"
              tabIndex={0}
              aria-pressed={ad ? picked === s.spot : undefined}
              aria-label={ad ? t("city.adAria", { title: ad.title, subtitle: ad.subtitle ? `, ${ad.subtitle}` : "" }) : t("city.freeSpotAria2", { name })}
              style={boxOf(s)}
              onKeyDown={(e) => {
                if (e.key !== "Enter" && e.key !== " ") return;
                e.preventDefault();
                onAct(s.spot);
              }}
            />
          );
        })}
        {arena && (
          <span
            className="dz-hit"
            data-spot="arena_gate"
            data-kind="enter"
            role="button"
            tabIndex={0}
            aria-label={poster.kind === "queue" ? t("gate.ariaQueue", { n: poster.waiting }) : t("gate.aria")}
            style={boxOf(ARENA_GATES)}
            onKeyDown={(e) => {
              if (e.key !== "Enter" && e.key !== " ") return;
              e.preventDefault();
              onAct("arena_gate");
            }}
          />
        )}
      </div>
    )}
    </>
  );
}

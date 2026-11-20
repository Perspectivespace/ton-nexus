import { Link } from "react-router-dom";
import { useAchievements, type AchBranchView } from "@/api/achievements";
import { Bar, Panel, SectionLabel } from "@/components/ui";
import { t, fmtNum } from "@/i18n";
import { haptic } from "@/lib/haptics";
import { AchBadge } from "./AchBadge";
import { branchName, tierTitle, tonText } from "./text";

/** доля пути от прошлой ступени до следующей (0…1) */
export function branchShare(b: AchBranchView): number {
  if (!b.next) return 1;
  const prev = [...b.tiers].reverse().find((x) => x.done)?.at ?? 0;
  const span = b.next.at - prev;
  return span > 0 ? Math.min(1, Math.max(0, (b.value - prev) / span)) : 0;
}

/** высшая полученная ступень ветки (для значка в списке) */
export const topTier = (b: AchBranchView) => [...b.tiers].reverse().find((x) => x.done) ?? null;

/** Профиль → «Достижения»: закреплённый значок, сколько получено и прогресс по веткам. Тап — экран достижений. */
export function AchievementsCard() {
  const { data } = useAchievements();
  if (!data || (!data.enabled && data.done === 0)) return null;
  const pin = data.pin;
  return (
    <section className="space-y-2" aria-label={t("ach.title")}>
      <SectionLabel
        action={
          <Link to="/achievements" className="ui-btn secondary night sm no-underline" onClick={() => haptic.tap()}>
            {t("ach.all")}
          </Link>
        }
      >
        {t("ach.title")}
      </SectionLabel>
      <Link to="/achievements" className="block no-underline text-inherit" aria-label={t("ach.open")} onClick={() => haptic.tap()}>
        <Panel className="ach-card p-4">
          <div className="flex items-center gap-4">
            <div className="ach-pin-slot">
              {pin ? <AchBadge metal={pin.metal} branch={pin.branch} size={60} /> : <AchBadge metal="bronze" branch="tasks" size={60} locked />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="ui-label">{t("ach.pinned")}</p>
              <p className="ach-card-t">{pin ? tierTitle(pin.branch, pin.tier, pin.index) : t("ach.pinHint")}</p>
              <div className="ach-card-meta">
                <span>
                  <b className="ui-num">{t("ach.doneOf", { done: fmtNum(data.done), total: fmtNum(data.total) })}</b>
                </span>
                {Number(data.earned_ton) > 0 && (
                  <span>
                    {t("ach.earned")} <b className="ui-num">{tonText(data.earned_ton)}</b>
                  </span>
                )}
              </div>
            </div>
          </div>
          <ul className="ach-mini">
            {data.branches.map((b) => {
              const top = topTier(b);
              return (
                <li key={b.key}>
                  <AchBadge metal={top?.metal ?? "bronze"} branch={b.key} size={28} locked={!top} />
                  <div className="min-w-0 flex-1">
                    <div className="ach-mini-h">
                      <span className="truncate">{branchName(b.key)}</span>
                      <span className="ui-num">{b.next ? `${fmtNum(b.value)} / ${fmtNum(b.next.at)}` : t("ach.complete")}</span>
                    </div>
                    <Bar value={branchShare(b)} tone={b.next ? "neon" : "amber"} label={branchName(b.key)} />
                  </div>
                </li>
              );
            })}
          </ul>
        </Panel>
      </Link>
    </section>
  );
}

import { useState } from "react";
import { Link } from "react-router-dom";
import { useAchievements, useAchPin, type AchBranchView, type AchTierView } from "@/api/achievements";
import { BackLink } from "@/components/BackLink";
import { AchBadge } from "@/components/achievements/AchBadge";
import { branchShare, topTier } from "@/components/achievements/AchievementsCard";
import { branchHow, branchMetric, branchName, metalName, statusName, tierTitle, tonText } from "@/components/achievements/text";
import { Bar, Button, EmptyPanel, ErrorPanel, LoadingPanel, Panel, ScreenHeader, Sheet, useToast } from "@/components/ui";
import { fmtDate, fmtNum, t } from "@/i18n";
import { haptic } from "@/lib/haptics";
import { useScreenBack } from "@/lib/backButton";
import { IconChevron } from "@/components/icons";

type Pick = { branch: AchBranchView; tier: AchTierView };

/** Профиль → «Достижения»: ветки, пройденные ступени, сколько осталось; тап по ступени — подробности и закрепление значка. */
export function Achievements() {
  useScreenBack("/wallet");
  const { data, isLoading, error } = useAchievements();
  const [pick, setPick] = useState<Pick | null>(null);
  const pinM = useAchPin();
  const toast = useToast();

  if (isLoading) return <LoadingPanel label={t("ach.loading")} />;
  if (error || !data) return <ErrorPanel message={t("ach.failed")} />;

  const pin = data.pin;
  const pinnedHere = !!(pick && pin && pin.branch === pick.branch.key && pin.tier === pick.tier.at);
  const doPin = (on: boolean) => {
    if (!pick) return;
    pinM.mutate(on ? { branch: pick.branch.key, tier: pick.tier.at } : null, {
      onSuccess: () => {
        haptic.success();
        if (on) toast({ kind: "ok", title: t("ach.pinnedNow") });
      },
      onError: (e) => toast({ kind: "danger", title: t("ach.pinFailed"), sub: e instanceof Error ? e.message : undefined }),
    });
  };

  return (
    <div className="space-y-5">
      <ScreenHeader eyebrow={t("nav.profile")} title={t("ach.title")} action={<BackLink to="/wallet" label={t("nav.profile")} />} />

      <Panel level="hero" see cut="l" lift="l2" className="ach-hero p-5">
        <div className="flex items-center gap-4">
          {pin ? <AchBadge metal={pin.metal} branch={pin.branch} size={76} /> : <AchBadge metal="bronze" branch="tasks" size={76} locked />}
          <div className="min-w-0 flex-1">
            <p className="ui-label ui-shade">{t("ach.pinned")}</p>
            <p className="ach-hero-t ui-shade">{pin ? tierTitle(pin.branch, pin.tier, pin.index) : t("ach.pinHint")}</p>
            {pin && <p className="ui-sec ui-shade !text-[12px] !leading-[16px]">{metalName(pin.metal)}</p>}
          </div>
        </div>
        <div className="ach-hero-stats">
          <div>
            <p className="ui-label">{t("ach.tiers")}</p>
            <p className="ui-num s-l">{t("ach.doneOf", { done: fmtNum(data.done), total: fmtNum(data.total) })}</p>
          </div>
          <div>
            <p className="ui-label">{t("ach.earned")}</p>
            <p className="ui-num s-l">{tonText(data.earned_ton) || "0 TON"}</p>
          </div>
        </div>
      </Panel>

      <Link to="/achievements/wall" className="block no-underline text-inherit" onClick={() => haptic.tap()}>
        <Panel className="ach-wall-link p-4">
          <AchBadge metal="neon" branch="ambassador" size={40} />
          <div className="min-w-0 flex-1">
            <p className="ui-h !text-[15px] !leading-[20px]">{t("ach.wall")}</p>
            <p className="ui-sec !text-[12px] !leading-[16px]">{t("ach.wallLinkSub")}</p>
          </div>
          <IconChevron size={18} />
        </Panel>
      </Link>

      {!data.enabled && <EmptyPanel title={t("ach.off")} body={t("ach.offSub")} />}

      {data.branches.map((b) => (
        <BranchPanel key={b.key} b={b} pinTier={pin && pin.branch === b.key ? pin.tier : null} onPick={(tier) => setPick({ branch: b, tier })} />
      ))}

      <Sheet
        open={!!pick}
        onClose={() => setPick(null)}
        title={pick ? tierTitle(pick.branch.key, pick.tier.at, pick.tier.index) : ""}
        sub={pick ? t("ach.tierOf", { i: pick.tier.index, of: pick.branch.tiers.length }) : undefined}
        footer={
          pick?.tier.done ? (
            <Button kind={pinnedHere ? "secondary" : "primary"} block disabled={pinM.isPending} onClick={() => doPin(!pinnedHere)}>
              {pinnedHere ? t("ach.unpin") : t("ach.pin")}
            </Button>
          ) : undefined
        }
      >
        {pick && (
          <div className="ach-detail">
            <AchBadge metal={pick.tier.metal} branch={pick.branch.key} size={112} locked={!pick.tier.done} label={metalName(pick.tier.metal)} />
            <p className="ach-detail-m">{metalName(pick.tier.metal)}</p>
            <dl className="ach-dl">
              <div>
                <dt>{branchMetric(pick.branch.key)}</dt>
                <dd className="ui-num">
                  {fmtNum(Math.min(pick.branch.value, pick.tier.at))} / {fmtNum(pick.tier.at)}
                </dd>
              </div>
              <div>
                <dt>{t("ach.reward")}</dt>
                <dd className="ui-num">
                  {[tonText(pick.tier.ton), pick.tier.xp > 0 ? `+${fmtNum(pick.tier.xp)} XP` : ""].filter(Boolean).join(" · ") || t("ach.badgeOnly")}
                </dd>
              </div>
              <div>
                <dt>{t("ach.state")}</dt>
                <dd className={`ach-st s-${pick.tier.status ?? "locked"}`}>
                  {statusName(pick.tier.status)}
                  {pick.tier.awarded_at ? ` · ${fmtDate(pick.tier.awarded_at, { day: "numeric", month: "short", year: "numeric" })}` : ""}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Sheet>
    </div>
  );
}

function BranchPanel({ b, pinTier, onPick }: { b: AchBranchView; pinTier: number | null; onPick: (t: AchTierView) => void }) {
  const top = topTier(b);
  const left = b.tiers.filter((x) => !x.done).length;
  return (
    <Panel className="ach-br p-4" aria-label={branchName(b.key)}>
      <div className="flex items-start gap-3">
        <AchBadge metal={top?.metal ?? "bronze"} branch={b.key} size={44} locked={!top} />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="ui-h !text-[16px] !leading-[20px]">{branchName(b.key)}</h2>
            <span className="ui-num s-m !font-bold">{fmtNum(b.value)}</span>
          </div>
          <p className="ui-sec !text-[12px] !leading-[16px] mt-0.5">{branchHow(b.key)}</p>
        </div>
      </div>
      <Bar value={branchShare(b)} tone={b.next ? "neon" : "amber"} className="mt-3" label={branchMetric(b.key)} />
      <div className="ach-br-foot">
        <span>{b.next ? t("ach.next", { at: fmtNum(b.next.at), left: fmtNum(b.next.left) }) : t("ach.complete")}</span>
        {left > 0 && <span>{t("ach.tiersLeft", { n: left })}</span>}
      </div>
      <ul className="ach-tiers">
        {b.tiers.map((x) => (
          <li key={x.at}>
            <button
              type="button"
              className={`ach-tier${x.done ? " done" : ""}${pinTier === x.at ? " pinned" : ""}`}
              aria-label={t("ach.tierAria", { at: fmtNum(x.at), state: statusName(x.status) })}
              onClick={() => {
                haptic.tap();
                onPick(x);
              }}
            >
              <AchBadge metal={x.metal} branch={b.key} size={40} locked={!x.done} />
              <span className="ui-num at">{fmtNum(x.at)}</span>
              <span className="ton">{x.status === "pending" ? "···" : tonText(x.ton).replace(" TON", "") || "—"}</span>
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

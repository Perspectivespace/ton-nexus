import { useRef, useState } from "react";
import {
  useWheelStatus,
  useWheelSpin,
  type SpinOut,
} from "@/api/hooks";
import {
  ScreenHeader,
  LoadingPanel,
  Readout,
  Panel,
  Scrim,
  Tag,
  Button,
  Sheet,
  PrizeWheel,
  useToast,
  cx,
  type PrizeWheelHandle,
  type WheelRole,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { IconBolt, IconSpark } from "@/components/icons";
import { useScreenBack } from "@/lib/backButton";
import { BackLink } from "@/components/BackLink";
import { DailyWeek } from "@/components/DailyWeek";
import { useDaily } from "@/lib/useDaily";
import { formatLeft, nextMskMidnight, useCountdown } from "@/lib/countdown";
import { useQueryClient } from "@tanstack/react-query";
import { fmtNum, t } from "@/i18n";

/**
 * Сектора колеса. Порядок — визуальный (цвета чередуются), выпавший сектор ищется по id ответа сервера.
 * Шансы не зашиты: приходят с сервера в /wheel/status (веса из настроек владельца).
 */
const PRIZES: readonly {
  id: string;
  title: string;
  sub?: string;
  label: string;
  role: WheelRole;
  use: string;
}[] = [
  { id: "success_plus_5", title: "+5%", get sub() { return t("wheel.successSub"); }, get label() { return t("wheel.successLabel"); }, role: "hot", get use() { return t("wheel.successUse"); } },
  { id: "xp_small", title: "XP", get sub() { return t("wheel.xpSub"); }, label: "XP", role: "steel", get use() { return t("wheel.xpUse"); } },
  { id: "focus_1", get title() { return t("token.focus"); }, sub: "×1", get label() { return t("wheel.focusLabel"); }, role: "amber", get use() { return t("wheel.focusUse"); } },
  { id: "nothing", get title() { return t("wheel.empty"); }, get label() { return t("wheel.empty"); }, role: "void", get use() { return t("wheel.emptyUse"); } },
  { id: "ton_dust", title: "TON", get sub() { return t("wheel.dustSub"); }, get label() { return t("wheel.dustLabel"); }, role: "neon", get use() { return t("wheel.dustUse"); } },
  { id: "block_1", get title() { return t("token.block"); }, sub: "×1", get label() { return t("wheel.blockLabel"); }, role: "magenta", get use() { return t("wheel.blockUse"); } },
];
const MISS = PRIZES.findIndex((p) => p.id === "nothing");

function prizeIndex(itemId: string): number {
  const i = PRIZES.findIndex((p) => p.id === itemId);
  return i >= 0 ? i : MISS;
}

function rewardParts(r: SpinOut): string[] {
  return [
    Number(r.reward_ton) > 0 && `+${Number(r.reward_ton).toFixed(4)} TON`,
    r.reward_xp > 0 && `+${r.reward_xp} XP`,
    r.reward_focus > 0 && t("promo.focusReward", { rewardFocus: r.reward_focus }),
    r.reward_block > 0 && t("wheel.blockReward", { rewardBlock: r.reward_block }),
    r.success_boost_bp > 0 && t("wheel.boostReward", { successBoostBp: r.success_boost_bp / 100 }),
  ].filter(Boolean) as string[];
}

const DOT: Record<WheelRole, string> = {
  hot: "var(--amber-core)",
  amber: "var(--amber)",
  neon: "var(--neon)",
  magenta: "var(--magenta)",
  steel: "var(--text-2)",
  void: "var(--line-strong)",
};


type Phase = "idle" | "wait" | "spin" | "done";

export function Wheel() {
  useScreenBack("/");
  const daily = useDaily();
  const wheelSt = useWheelStatus();
  const qc = useQueryClient();
  const resetAt = wheelSt.data && wheelSt.data.left_today <= 0 ? (wheelSt.data.next_reset_at ? Date.parse(wheelSt.data.next_reset_at) : nextMskMidnight()) : null;
  const spinLeftMs = useCountdown(resetAt, 0, () => qc.invalidateQueries({ queryKey: ["wheel"] }));
  const spinIn = spinLeftMs != null ? formatLeft(spinLeftMs) : null;
  const spinMut = useWheelSpin();
  const toast = useToast();

  const wheel = useRef<PrizeWheelHandle>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [win, setWin] = useState<number | null>(null);
  const [last, setLast] = useState<SpinOut | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);

  const busy = phase === "wait" || phase === "spin";

  async function onSpin() {
    if (busy) return;
    setWin(null);
    setLast(null);
    setPhase("wait");
    let out: SpinOut;
    try {
      // сначала ответ сервера, потом колесо доезжает до выпавшего сектора
      out = await spinMut.mutateAsync();
    } catch (e) {
      setPhase("idle");
      toast({ kind: "danger", title: t("wheel.noAnswer"), sub: e instanceof Error ? e.message : undefined });
      return;
    }
    const idx = prizeIndex(out.item_id);
    setPhase("spin");
    await wheel.current?.spinTo(idx);
    setWin(idx);
    setLast(out);
    setPhase("done");
    const p = PRIZES[idx];
    if (p.id === "nothing" && rewardParts(out).length === 0) {
      toast({ kind: "info", title: t("wheel.emptySector"), sub: t("wheel.noRewardThisTime") });
    } else {
      haptic.heavy();
      toast({ kind: "amber", title: t("wheel.win", { label: out.label || p.label }), sub: rewardParts(out).join(" · ") || undefined });
    }
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  if (daily.loading || wheelSt.isLoading) {
    return <LoadingPanel label={t("wheel.loading")} />;
  }

  const d = daily.status;
  const w = wheelSt.data;
  const left = w?.left_today ?? 0;
  const maxSpins = Math.max(w?.free_spins_per_day ?? 1, 1);
  const won = win != null ? PRIZES[win] : null;
  const miss = !!last && won?.id === "nothing" && rewardParts(last).length === 0;
  const spinsOut = left <= 0;
  const odds = w?.sectors ? new Map(w.sectors.map((s) => [s.id, s])) : null;

  return (
    <div
      className="space-y-5"
      onPointerDown={() => {
        if (phase === "spin") wheel.current?.skip();
      }}
    >
      <ScreenHeader
        title={t("games.wheel")}
        action={
          <Button kind="secondary" size="sm" onClick={() => setHelpOpen(true)} aria-label={t("wheel.prizesOdds")}>
            {t("wheel.odds")}</Button>
        }
      />

      {/* Герой: колесо (п. 8.3) */}
      <Panel level="hero" cut="l" lift="l2" className="px-5 pb-0 pt-5">
        <p className="sr-only">
          {t("wheel.freeToday")}{" "}{left}{" "}{t("task.of")}{" "}{maxSpins}
        </p>
        <PrizeWheel
          ref={wheel}
          sectors={PRIZES}
          winIndex={phase === "done" ? win : null}
          spinning={phase === "spin"}
          miss={miss}
          spins={{ left, max: maxSpins }}
          mode={phase === "wait" ? t("wheel.stLink") : phase === "spin" ? t("wheel.stSpin") : phase === "done" ? (miss ? t("wheel.empty") : t("wheel.stWin")) : left > 0 ? t("wheel.stReady") : t("wheel.stWait")}
          className="mb-5"
        />
        <Scrim className="relative -mx-5 space-y-3 px-5 pb-5 pt-3">
          <p className="ui-sec text-center !text-[12px]">
            {phase === "wait"
              ? t("wheel.linking")
              : phase === "spin"
                ? t("upgrade.tapSkip")
                : left > 0
                  ? t("wheel.pointerHint")
                  : t("wheel.resetHint")}
          </p>
          <span className="ui-spill block">
            <Button kind="primary" size="lg" block icon={<IconSpark size={18} />} disabled={busy || spinsOut} onClick={onSpin}>
              {phase === "wait" ? t("wheel.linkingShort") : phase === "spin" ? t("wheel.spinning") : spinsOut ? (
                <>
                  {t("wheel.nextIn")}{" "}<span className="ui-num">{spinIn ?? "—"}</span>
                </>
              ) : (
                t("wheel.spin")
              )}
            </Button>
          </span>
        </Scrim>
      </Panel>

      {/* Итог вращения: натриевая плашка (награда) или нейтральная (пусто) */}
      {last && won && phase === "done" && (
        <div ref={resultRef} className="scroll-mb-28">
          <Panel className={cx("space-y-3 p-5", !miss && "win-edge")}>
            <div className="flex items-center justify-between gap-3">
              <p className="ui-label">{miss ? t("wheel.result") : t("wheel.stWin")}</p>
              {miss ? <Tag tone="neutral">{t("wheel.emptyLower")}</Tag> : <span className="ui-verdict ok ui-ignite">{last.label || won.label}</span>}
            </div>
            {miss ? (
              <p className="ui-sec">{t("wheel.betterLuck")}</p>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  {rewardParts(last).map((part) => (
                    <span key={part} className="ui-num text-[20px] font-bold leading-7 text-[var(--amber)]">
                      {part}
                    </span>
                  ))}
                </div>
                <p className="ui-sec !text-[12px] !leading-[16px]">{won.use}</p>
              </>
            )}
          </Panel>
        </div>
      )}

      {/* Ежедневная отметка */}
      <Panel className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="ui-h">{t("daily.title")}</p>
            <p className="ui-sec !text-[12px] !leading-[16px]">
              {t("wheel.dailyRules")}</p>
          </div>
          <Tag tone={daily.waiting ? "ok" : "amber"}>{daily.waiting ? t("wheel.claimed") : t("partner.available")}</Tag>
        </div>
        {d?.rewards && d.rewards.length > 0 && (
          <DailyWeek days={d.rewards} today={d.cycle_day ?? 1} claimed={!!d.claimed_today} streak={d.streak} />
        )}
        <div className="grid grid-cols-2 gap-4">
          <Readout label={t("daily.streak")} value={String(d?.streak ?? 0)} unit={t("wheel.daysShort")} />
          <Readout label={daily.waiting ? t("wheel.nextInCap") : t("daily.today")} value={daily.countdown ?? t("partner.available")} live />
        </div>
        <Button kind="secondary" block icon={<IconBolt size={18} />} disabled={!daily.ready} onClick={daily.claimNow}>
          {daily.pending ? t("daily.claiming") : daily.waiting ? t("daily.gotToast") : t("wheel.claimCheckin")}
        </Button>
      </Panel>

      <BackLink to="/" />

      <Sheet open={helpOpen} onClose={() => setHelpOpen(false)} title={t("wheel.prizesOdds")}>
        <p className="ui-sec !text-[13px]">{t("wheel.pointerTop")}</p>
        <p className="ui-sec mt-1 !text-[12px] !leading-[16px]">
          {!odds
            ? t("wheel.oddsAfterUpdate")
            : w?.weights_source === "default"
              ? t("wheel.oddsDefault")
              : t("wheel.oddsSettings")}
        </p>
        <div className="mt-4 divide-y divide-[var(--line)]">
          {PRIZES.map((p) => {
            const o = odds?.get(p.id);
            const off = !!odds && (!o || o.chance_pct <= 0);
            return (
              <div key={p.id} className={cx("flex gap-3 py-3", off && "opacity-60")}>
                <span className="pw-dot mt-[5px]" style={{ background: DOT[p.role] }} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-medium leading-5 text-[var(--text)]">{o?.label || p.label}</span>
                    {off ? (
                      <Tag tone="neutral">{t("wheel.neverDrops")}</Tag>
                    ) : (
                      <span className="ui-num text-[15px]">{o ? `${fmtNum(o.chance_pct, { maximumFractionDigits: 1 })}%` : "—"}</span>
                    )}
                  </div>
                  <p className="ui-sec mt-0.5 !text-[12px] !leading-[16px]">{p.use}</p>
                </div>
              </div>
            );
          })}
        </div>
        <Button kind="primary" block className="mt-4" onClick={() => setHelpOpen(false)}>
          {t("wheel.gotIt")}</Button>
      </Sheet>
    </div>
  );
}

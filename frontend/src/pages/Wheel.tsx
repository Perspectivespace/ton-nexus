import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  useDailyStatus,
  useDailyClaimFull,
  useWheelStatus,
  useWheelSpin,
  type SpinOut,
  type DailyClaim,
} from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Readout,
} from "@/components/ui";
import { IconSpark } from "@/components/icons";

export function Wheel() {
  const dailySt = useDailyStatus();
  const dailyClaim = useDailyClaimFull();
  const wheelSt = useWheelStatus();
  const spin = useWheelSpin();
  const [spinning, setSpinning] = useState(false);
  const [lastSpin, setLastSpin] = useState<SpinOut | null>(null);
  const [lastDaily, setLastDaily] = useState<DailyClaim | null>(null);

  async function onDaily() {
    try {
      const r = await dailyClaim.mutateAsync();
      setLastDaily(r);
    } catch {
      /* */
    }
  }

  async function onSpin() {
    setSpinning(true);
    await new Promise((r) => setTimeout(r, 900));
    try {
      const r = await spin.mutateAsync();
      setLastSpin(r);
    } catch {
      /* */
    } finally {
      setSpinning(false);
    }
  }

  if (dailySt.isLoading || wheelSt.isLoading) {
    return <LoadingPanel label="Загрузка контуров наград…" />;
  }

  const d = dailySt.data;
  const w = wheelSt.data;

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Награды"
        title="Daily · Рулетка"
        action={
          <StatusPill tone={d?.claimed_today ? "ok" : "live"}>
            {d?.claimed_today ? "daily ✓" : "daily open"}
          </StatusPill>
        }
      />

      <div className="panel panel-glow space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Check-in</p>
          <StatusPill tone={d?.claimed_today ? "ok" : "neutral"}>
            streak {d?.streak ?? 0}
          </StatusPill>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Readout label="Серия" value={String(d?.streak ?? 0)} unit="дн" />
          <Readout label="Сегодня" value={d?.claimed_today ? "получено" : "доступно"} />
        </div>
        <button
          type="button"
          className="btn-primary w-full"
          disabled={dailyClaim.isPending || !!d?.claimed_today}
          onClick={onDaily}
        >
          <IconSpark size={16} />
          {d?.claimed_today
            ? "Уже получено"
            : dailyClaim.isPending
              ? "Начисление…"
              : "Забрать daily"}
        </button>
        {dailyClaim.isError && (
          <ErrorPanel
            message={
              dailyClaim.error instanceof Error ? dailyClaim.error.message : "Ошибка daily"
            }
          />
        )}
        <AnimatePresence>
          {lastDaily && !lastDaily.already_claimed && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-[var(--success)]/25 bg-[var(--success)]/5 p-3 text-[13px]"
            >
              +{Number(lastDaily.reward_ton).toFixed(4)} TON
              {lastDaily.reward_xp > 0 && ` · +${lastDaily.reward_xp} XP`}
              {lastDaily.reward_focus > 0 && ` · Фокус +${lastDaily.reward_focus}`}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="panel panel-glow space-y-4 p-5">
        <div className="flex items-center justify-between">
          <p className="eyebrow">Prize wheel</p>
          <StatusPill tone={(w?.left_today ?? 0) > 0 ? "live" : "neutral"}>
            {w?.left_today ?? 0}/{w?.free_spins_per_day ?? 0} спин
          </StatusPill>
        </div>

        <div className="flex justify-center py-2">
          <motion.div
            animate={spinning ? { rotate: 360 } : { rotate: 0 }}
            transition={
              spinning
                ? { repeat: Infinity, duration: 0.6, ease: "linear" }
                : { duration: 0.4 }
            }
            className="flex h-28 w-28 items-center justify-center rounded-full border border-[var(--line-strong)] bg-[var(--accent-soft)]"
            style={{
              boxShadow: spinning ? "0 0 40px rgba(107,155,255,0.35)" : undefined,
            }}
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-[var(--accent)]/40 bg-[var(--bg-deep)]">
              <IconSpark size={22} className="text-[var(--accent)]" />
            </div>
          </motion.div>
        </div>

        <button
          type="button"
          className="btn-primary w-full"
          disabled={spinning || spin.isPending || (w?.left_today ?? 0) <= 0}
          onClick={onSpin}
        >
          {spinning || spin.isPending
            ? "Крутится…"
            : (w?.left_today ?? 0) <= 0
              ? "Лимит на сегодня"
              : "Крутить"}
        </button>

        {spin.isError && (
          <ErrorPanel
            message={spin.error instanceof Error ? spin.error.message : "Ошибка рулетки"}
          />
        )}

        <AnimatePresence mode="wait">
          {lastSpin && !spinning && (
            <motion.div
              key={lastSpin.item_id + lastSpin.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="panel border-[var(--accent)]/20 p-4"
            >
              <p className="eyebrow">Выпало</p>
              <p className="mt-1 text-base font-semibold">{lastSpin.label}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-[12px] text-[var(--text-dim)]">
                {Number(lastSpin.reward_ton) > 0 && (
                  <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                    +{Number(lastSpin.reward_ton).toFixed(4)} TON
                  </span>
                )}
                {lastSpin.reward_xp > 0 && (
                  <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                    +{lastSpin.reward_xp} XP
                  </span>
                )}
                {lastSpin.reward_focus > 0 && (
                  <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                    Фокус +{lastSpin.reward_focus}
                  </span>
                )}
                {lastSpin.reward_block > 0 && (
                  <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                    Запрет +{lastSpin.reward_block}
                  </span>
                )}
                {lastSpin.success_boost_bp > 0 && (
                  <span className="rounded-md border border-[var(--success)]/30 px-2 py-0.5 text-[var(--success)]">
                    +{lastSpin.success_boost_bp / 100}% успех
                  </span>
                )}
              </div>
              <p className="mt-2 text-[11px] text-[var(--text-dim)]">
                Осталось спинов: {lastSpin.free_spins_left_today}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

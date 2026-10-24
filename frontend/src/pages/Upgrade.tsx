import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { useMe, useMiner, useMinerUpgrade, type UpgradeOut } from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Readout,
} from "@/components/ui";
import { IconReactor, IconSpark } from "@/components/icons";

const TYPE_RU: Record<string, string> = {
  power: "Мощность",
  capacity: "Ёмкость",
  acceleration: "Длительность",
  luck: "Удача",
  stability: "Стабильность",
};

const TYPES = ["power", "capacity", "acceleration", "luck", "stability"] as const;

export function Upgrade() {
  const { data: me } = useMe();
  const { data: m, isLoading, error } = useMiner();
  const upgrade = useMinerUpgrade();
  const [focusOn, setFocusOn] = useState<string | null>(null);
  const [blockType, setBlockType] = useState<string | null>(null);
  const [last, setLast] = useState<UpgradeOut | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [spinLabel, setSpinLabel] = useState("Тип…");

  async function run() {
    setSpinning(true);
    setSpinLabel("Колесо типа");
    await new Promise((r) => setTimeout(r, 700));
    setSpinLabel("Колесо шанса");
    await new Promise((r) => setTimeout(r, 550));
    try {
      const res = await upgrade.mutateAsync({
        use_focus_on: focusOn,
        block_type: blockType,
      });
      setLast(res);
    } catch {
      /* */
    } finally {
      setSpinning(false);
    }
  }

  if (isLoading) return <LoadingPanel label="Калибровка модуля усиления…" />;
  if (error) return <ErrorPanel message="Канал майнера недоступен" />;
  if (!m) return null;

  const busy = upgrade.isPending || spinning;

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Модуль"
        title="Усиление"
        action={
          <Link
            to="/miner"
            className="rounded-xl border border-[var(--line)] px-3 py-2 text-xs text-[var(--text-dim)] no-underline"
          >
            ← Реактор
          </Link>
        }
      />

      <div className="panel panel-glow grid grid-cols-3 gap-3 p-4">
        <Readout label="Баланс" value={me ? Number(me.balance).toFixed(4) : "—"} unit="TON" />
        <Readout label="Фокус" value={String(me?.focus_tokens ?? 0)} hint="вес типа ×" />
        <Readout label="Запрет" value={String(me?.block_tokens ?? 0)} hint="блок типа" />
      </div>

      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="eyebrow">Стойка параметров</p>
          <StatusPill tone={busy ? "live" : "neutral"}>
            {busy ? "вращение" : "двойное колесо"}
          </StatusPill>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {TYPES.map((t) => {
            const val = m[t] as number;
            const focused = focusOn === t;
            const blocked = blockType === t;
            return (
              <button
                key={t}
                type="button"
                disabled={busy}
                onClick={() => {
                  if (focused) {
                    setFocusOn(null);
                    setBlockType(t);
                  } else if (blocked) {
                    setBlockType(null);
                  } else {
                    setFocusOn(t);
                    if (blockType === t) setBlockType(null);
                  }
                }}
                className={`stat-chip transition ${
                  focused
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]"
                    : blocked
                      ? "border-[var(--danger)]/40 bg-[var(--danger)]/10"
                      : ""
                }`}
              >
                <div className="text-[9px] font-semibold tracking-wider text-[var(--text-dim)]">
                  {t.slice(0, 3).toUpperCase()}
                </div>
                <div className="mono mt-1 text-sm font-semibold">{val}</div>
                {focused && <div className="mt-1 text-[8px] text-[var(--accent)]">FOCUS</div>}
                {blocked && <div className="mt-1 text-[8px] text-[var(--danger)]">BLOCK</div>}
              </button>
            );
          })}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--text-dim)]">
          Тап: Фокус → Запрет → сброс. Тип выбирает колесо.
        </p>
      </div>

      <div className="panel panel-glow space-y-4 p-5">
        <div className="flex items-center gap-3">
          <motion.div
            animate={spinning ? { rotate: 360 } : { rotate: 0 }}
            transition={
              spinning
                ? { repeat: Infinity, duration: 0.85, ease: "linear" }
                : { duration: 0.3 }
            }
            className="rounded-2xl border border-[var(--line)] bg-[var(--accent-soft)] p-3 text-[var(--accent)]"
          >
            <IconReactor size={22} />
          </motion.div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{spinning ? spinLabel : "Прогон усиления"}</p>
            <p className="text-[12px] text-[var(--text-dim)]">
              1) тип · 2) шанс · провал = 100% burn
            </p>
          </div>
        </div>

        <AnimatePresence>
          {spinning && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="absolute inset-y-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-[var(--accent)] to-transparent"
                  animate={{ left: ["-33%", "100%"] }}
                  transition={{ repeat: Infinity, duration: 0.9, ease: "linear" }}
                />
              </div>
              <p className="mt-2 text-center text-[11px] text-[var(--text-dim)]">
                Считывание вероятностей…
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        <button type="button" className="btn-primary w-full" disabled={busy} onClick={run}>
          <IconSpark size={16} />
          {busy ? "Прокрутка…" : "Запустить колесо"}
        </button>

        {upgrade.isError && (
          <ErrorPanel
            message={upgrade.error instanceof Error ? upgrade.error.message : "Отказ модуля"}
          />
        )}
      </div>

      <AnimatePresence mode="wait">
        {last && !spinning && (
          <motion.div
            key={`${last.upgrade_type}-${last.success}-${last.cost}`}
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className={`panel p-5 ${
              last.success ? "border-[var(--success)]/30 panel-glow" : "border-[var(--danger)]/25"
            }`}
          >
            <div className="flex items-center justify-between">
              <p className="eyebrow">{last.success ? "Lock-in" : "Burn"}</p>
              <StatusPill tone={last.success ? "ok" : "danger"}>
                {last.success ? "успех" : "сгорание"}
              </StatusPill>
            </div>
            <p className="mt-2 text-lg font-semibold">
              {TYPE_RU[last.upgrade_type] || last.upgrade_type}
              {last.success && last.new_level != null && (
                <span className="mono text-[var(--text-dim)]"> → {last.new_level}</span>
              )}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <Readout label="Стоимость" value={Number(last.cost).toFixed(4)} unit="TON" />
              <Readout
                label="Шанс"
                value={`${(last.success_chance_bp / 100).toFixed(1)}`}
                unit="%"
              />
            </div>
            {last.burned && !last.success && (
              <p className="mt-3 text-[12px] text-[var(--danger)]">Сумма списана без возврата.</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

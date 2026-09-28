import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useMiner, useMinerStart, useMinerClaim } from "@/api/hooks";
import { IconReactor } from "@/components/icons";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Gauge,
  Readout,
} from "@/components/ui";

const statusTone = {
  idle: "neutral" as const,
  running: "live" as const,
  ready: "warn" as const,
};

const statusLabel: Record<string, string> = {
  idle: "Ожидание",
  running: "Цикл активен",
  ready: "Хранилище полное",
};

export function Miner() {
  const { data: m, isLoading, error } = useMiner();
  const start = useMinerStart();
  const claim = useMinerClaim();

  if (isLoading) return <LoadingPanel label="Синхронизация реактора…" />;
  if (error) return <ErrorPanel message="Не удалось загрузить майнер" />;
  if (!m) return null;

  const accrued = Number(m.accrued_now ?? m.pending_reward);
  const cap = Number(m.storage_cap ?? m.estimated_reward ?? 0);

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Реактор"
        title="Майнер"
        action={
          <div className="rounded-2xl border border-[var(--line)] bg-[var(--accent-soft)] p-3 text-[var(--accent)]">
            <IconReactor size={22} />
          </div>
        }
      />

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel panel-glow space-y-5 p-5"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-dim)]">Канал</span>
          <StatusPill tone={statusTone[m.status as keyof typeof statusTone] || "neutral"}>
            {statusLabel[m.status] || m.status}
          </StatusPill>
        </div>

        <div className="flex items-center gap-6">
          <Gauge value={accrued} max={cap || 1} label="Заполнение" sub={`${accrued.toFixed(4)}`} />
          <div className="min-w-0 flex-1 space-y-4">
            <Readout
              label="Накоплено"
              value={accrued.toFixed(6)}
              unit="TON"
              hint={m.cycle_hours != null ? `цикл ~${m.cycle_hours.toFixed(1)} ч` : undefined}
            />
            <Readout label="Ёмкость" value={cap.toFixed(6)} unit="TON" />
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2">
          {(
            [
              ["PWR", m.power],
              ["CAP", m.capacity],
              ["DUR", m.acceleration],
              ["LCK", m.luck],
              ["STB", m.stability],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="stat-chip">
              <div className="text-[9px] font-semibold tracking-wider text-[var(--text-dim)]">{k}</div>
              <div className="mono mt-1 text-sm font-semibold">{v}</div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-2">
          {m.status === "idle" && (
            <button
              type="button"
              className="btn-primary w-full"
              disabled={start.isPending}
              onClick={() => start.mutate()}
            >
              {start.isPending ? "Запуск…" : "Запуск цикла"}
            </button>
          )}
          {(m.status === "running" || m.status === "ready") && (
            <button
              type="button"
              className="btn-primary w-full"
              disabled={claim.isPending}
              onClick={() => claim.mutate()}
            >
              {claim.isPending ? "Сбор…" : "Собрать"}
            </button>
          )}
          <Link to="/upgrade" className="btn-ghost w-full">
            Модуль усиления
          </Link>
        </div>
      </motion.div>
    </div>
  );
}

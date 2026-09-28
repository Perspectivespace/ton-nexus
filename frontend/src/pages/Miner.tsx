import { motion } from "framer-motion";
import { useMiner, useMinerStart, useMinerClaim } from "@/api/hooks";
import { IconReactor } from "@/components/icons";

const statusLabel: Record<string, string> = {
  idle: "Ожидание",
  running: "Цикл активен",
  ready: "Хранилище полное",
};

export function Miner() {
  const { data: m, isLoading, error } = useMiner();
  const start = useMinerStart();
  const claim = useMinerClaim();

  if (isLoading)
    return <p className="text-sm text-[var(--text-dim)]">Синхронизация реактора…</p>;
  if (error)
    return <p className="text-sm text-[var(--danger)]">Не удалось загрузить майнер.</p>;
  if (!m) return null;

  const accrued = Number(m.accrued_now ?? m.pending_reward);
  const cap = Number(m.storage_cap ?? m.estimated_reward ?? 0);
  const fill = cap > 0 ? Math.min(100, (accrued / cap) * 100) : 0;

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between">
        <div>
          <p className="eyebrow">Реактор</p>
          <h1 className="text-[26px] font-semibold tracking-tight">Майнер</h1>
        </div>
        <div className="rounded-2xl border border-[var(--line)] bg-[var(--accent-soft)] p-3 text-[var(--accent)]">
          <IconReactor size={24} />
        </div>
      </header>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="panel panel-glow space-y-5 p-5"
      >
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-dim)]">Статус</span>
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-xs font-medium text-[var(--accent)]">
            {statusLabel[m.status] || m.status}
          </span>
        </div>

        <div>
          <p className="text-[11px] font-medium text-[var(--text-dim)]">Накоплено</p>
          <p className="mono mt-1 text-[28px] font-semibold tracking-tight">
            {accrued.toFixed(6)}
            <span className="ml-1 text-sm font-normal text-[var(--text-dim)]">TON</span>
          </p>
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]"
              initial={{ width: 0 }}
              animate={{ width: `${fill}%` }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            />
          </div>
          <p className="mono mt-1.5 text-[11px] text-[var(--text-dim)]">
            ёмкость {cap.toFixed(6)}
            {m.cycle_hours != null && ` · цикл ~${m.cycle_hours.toFixed(1)} ч`}
          </p>
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

        <div className="flex gap-2 pt-1">
          {m.status === "idle" && (
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={start.isPending}
              onClick={() => start.mutate()}
            >
              Запуск цикла
            </button>
          )}
          {(m.status === "running" || m.status === "ready") && (
            <button
              type="button"
              className="btn-primary flex-1"
              disabled={claim.isPending}
              onClick={() => claim.mutate()}
            >
              Собрать
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

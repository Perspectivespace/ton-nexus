import { useMiner, useMinerStart, useMinerClaim } from "@/api/hooks";

export function Miner() {
  const { data: m, isLoading, error } = useMiner();
  const start = useMinerStart();
  const claim = useMinerClaim();

  if (isLoading) return <p className="text-[var(--text-dim)]">Синхронизация…</p>;
  if (error)
    return <p className="text-sm text-[var(--danger)]">Не удалось загрузить майнер.</p>;
  if (!m) return null;

  const statusLabel: Record<string, string> = {
    idle: "Ожидание",
    running: "Цикл идёт",
    ready: "Хранилище полное",
  };

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">Реактор</p>
        <h1 className="text-2xl font-semibold">Майнер</h1>
      </header>

      <div className="panel space-y-4 p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--text-dim)]">Статус</span>
          <span className="rounded-full bg-[var(--accent-soft)] px-3 py-1 text-sm text-[var(--accent)]">
            {statusLabel[m.status] || m.status}
          </span>
        </div>

        <div>
          <p className="text-xs text-[var(--text-dim)]">Накоплено / ёмкость</p>
          <p className="mono text-2xl">
            {Number(m.accrued_now ?? m.pending_reward).toFixed(6)}
            <span className="text-sm text-[var(--text-dim)]">
              {" "}/ {Number(m.storage_cap ?? m.estimated_reward ?? 0).toFixed(6)} TON
            </span>
          </p>
          {m.cycle_hours != null && (
            <p className="mt-1 text-xs text-[var(--text-dim)]">Цикл ~{m.cycle_hours.toFixed(1)} ч</p>
          )}
        </div>

        <div className="grid grid-cols-5 gap-2 text-center text-xs">
          {(
            [
              ["PWR", m.power],
              ["CAP", m.capacity],
              ["DUR", m.acceleration],
              ["LCK", m.luck],
              ["STB", m.stability],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-[var(--line)] py-2">
              <div className="text-[var(--text-dim)]">{k}</div>
              <div className="mono text-sm font-semibold">{v}</div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          {m.status === "idle" && (
            <button type="button" className="btn-primary flex-1" disabled={start.isPending} onClick={() => start.mutate()}>
              Запуск цикла
            </button>
          )}
          {(m.status === "running" || m.status === "ready") && (
            <button type="button" className="btn-primary flex-1" disabled={claim.isPending} onClick={() => claim.mutate()}>
              Собрать
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

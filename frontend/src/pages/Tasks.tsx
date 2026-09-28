import { useTasks } from "@/api/hooks";

export function Tasks() {
  const { data, isLoading, error } = useTasks();

  return (
    <div className="space-y-4">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">Маркет</p>
        <h1 className="text-2xl font-semibold">Задания</h1>
      </header>

      {isLoading && <p className="text-[var(--text-dim)]">Загрузка…</p>}
      {error && <p className="text-sm text-[var(--danger)]">Не удалось загрузить задания</p>}

      <ul className="space-y-3">
        {(data || []).map((t) => (
          <li key={t.id} className="panel p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-medium leading-snug">{t.title}</h2>
              <span className="mono shrink-0 text-sm text-[var(--accent)]">
                {Number(t.reward).toFixed(4)} TON
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-sm text-[var(--text-dim)]">{t.description}</p>
            <p className="mt-2 text-xs text-[var(--text-dim)]">
              {t.filled_slots}/{t.total_slots} · ур.{t.min_level}+ · +{t.xp_reward} XP
            </p>
          </li>
        ))}
        {data?.length === 0 && (
          <li className="panel p-4 text-sm text-[var(--text-dim)]">Активных заданий пока нет</li>
        )}
      </ul>
    </div>
  );
}

import { motion } from "framer-motion";
import { useTasks } from "@/api/hooks";

export function Tasks() {
  const { data, isLoading, error } = useTasks();

  return (
    <div className="space-y-5">
      <header>
        <p className="eyebrow">Маркет</p>
        <h1 className="text-[26px] font-semibold tracking-tight">Задания</h1>
      </header>

      {isLoading && <p className="text-sm text-[var(--text-dim)]">Загрузка ленты…</p>}
      {error && <p className="text-sm text-[var(--danger)]">Не удалось загрузить задания</p>}

      <ul className="space-y-3">
        {(data || []).map((t, i) => (
          <motion.li
            key={t.id}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04 }}
            className="panel p-4"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-[15px] font-medium leading-snug">{t.title}</h2>
              <span className="mono shrink-0 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent)]">
                {Number(t.reward).toFixed(4)}
              </span>
            </div>
            <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-[var(--text-dim)]">
              {t.description}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-[var(--text-dim)]">
              <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                {t.filled_slots}/{t.total_slots}
              </span>
              <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                ур. {t.min_level}+
              </span>
              <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                +{t.xp_reward} XP
              </span>
            </div>
          </motion.li>
        ))}
        {data?.length === 0 && (
          <li className="panel p-5 text-sm text-[var(--text-dim)]">Активных заданий пока нет</li>
        )}
      </ul>
    </div>
  );
}

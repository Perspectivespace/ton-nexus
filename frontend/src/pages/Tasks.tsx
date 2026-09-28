import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useTasks } from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  EmptyPanel,
} from "@/components/ui";

export function Tasks() {
  const { data, isLoading, error, isFetching } = useTasks();

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Маркет"
        title="Задания"
        action={
          <StatusPill tone={isFetching ? "live" : "neutral"}>
            {isFetching ? "sync" : `${data?.length ?? 0} active`}
          </StatusPill>
        }
      />

      {isLoading && <LoadingPanel label="Загрузка ленты заданий…" />}
      {error && <ErrorPanel message="Канал заданий недоступен" />}

      {!isLoading && !error && data?.length === 0 && (
        <EmptyPanel
          title="Пустой рынок"
          body="Активных заданий пока нет. Амбассадоры и админы публикуют их из кабинета."
        />
      )}

      <ul className="space-y-3">
        {(data || []).map((t, i) => {
          const slotsLeft = t.total_slots - t.filled_slots;
          const fillPct =
            t.total_slots > 0 ? Math.round((t.filled_slots / t.total_slots) * 100) : 0;
          return (
            <motion.li
              key={t.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.04 }}
            >
              <Link to={`/tasks/${t.id}`} className="panel block p-4 no-underline text-inherit">
                <div className="flex items-start justify-between gap-3">
                  <h2 className="text-[15px] font-medium leading-snug">{t.title}</h2>
                  <span className="mono shrink-0 rounded-lg bg-[var(--accent-soft)] px-2 py-1 text-xs font-semibold text-[var(--accent)]">
                    {Number(t.reward).toFixed(4)}
                  </span>
                </div>
                <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-[var(--text-dim)]">
                  {t.description}
                </p>
                <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.06]">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-2)]"
                    style={{ width: `${fillPct}%` }}
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[var(--text-dim)]">
                  <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                    {slotsLeft} слот{slotsLeft === 1 ? "" : "ов"}
                  </span>
                  <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                    ур. {t.min_level}+
                  </span>
                  <span className="rounded-md border border-[var(--line)] px-2 py-0.5">
                    +{t.xp_reward} XP
                  </span>
                </div>
              </Link>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

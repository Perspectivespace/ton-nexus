import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useMe, useTasks } from "@/api/hooks";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  EmptyPanel,
  Panel,
  Bar,
  Tag,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";

export function Tasks() {
  const { data: me } = useMe();
  const { data, isLoading, error, isFetching } = useTasks();
  const canCreate = me?.is_owner || me?.is_admin || me?.is_ambassador;

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Маркет"
        title="Задания"
        action={
          <div className="flex items-center gap-2">
            {canCreate && (
              <Link to="/tasks/new" className="ui-btn ghost sm" onClick={() => haptic.tap()}>
                + Создать
              </Link>
            )}
            <StatusPill tone={isFetching ? "live" : "neutral"}>
              {isFetching ? "синхр." : `${data?.length ?? 0} активных`}
            </StatusPill>
          </div>
        }
      />

      {isLoading && <LoadingPanel label="Загрузка ленты заданий…" />}
      {error && <ErrorPanel message="Канал заданий недоступен" />}

      {!isLoading && !error && data?.length === 0 && (
        <EmptyPanel
          title="Пустой рынок"
          body="Активных заданий пока нет. Амбассадоры и админы публикуют их в разделе «Управление» на «Контуре»."
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
              <Link to={`/tasks/${t.id}`} className="block no-underline text-inherit" onClick={() => haptic.tap()}>
                <Panel className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="ui-h !text-[15px] !leading-[20px] !font-medium">{t.title}</h2>
                    <span className="ui-num s-m !font-bold !text-[var(--neon)] shrink-0">
                      {Number(t.reward).toFixed(4)}
                      <span className="unit">TON</span>
                    </span>
                  </div>
                  <p className="ui-sec mt-2 line-clamp-2">{t.description}</p>
                  <Bar value={fillPct / 100} className="mt-3" label="Заполнено слотов" />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Tag tone="neutral" dot={false}>
                      {slotsLeft} слот{slotsLeft === 1 ? "" : "ов"}
                    </Tag>
                    <Tag tone="neutral" dot={false}>ур. {t.min_level}+</Tag>
                    <Tag tone="amber" dot={false}>+{t.xp_reward} XP</Tag>
                  </div>
                </Panel>
              </Link>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

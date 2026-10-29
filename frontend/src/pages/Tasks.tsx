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
  SectionLabel,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { DailyCheckIn } from "@/components/DailyCheckIn";

export function Tasks() {
  const { data: me } = useMe();
  const { data, isLoading, error, isFetching } = useTasks();
  const canCreate = me?.is_owner || me?.is_admin || me?.is_ambassador;

  return (
    <div className="space-y-5">
      <ScreenHeader
        title="Заработок"
        action={
          canCreate ? (
            <Link to="/tasks/new" className="ui-btn ghost sm" onClick={() => haptic.tap()}>
              + Создать
            </Link>
          ) : undefined
        }
      />

      <DailyCheckIn />

      <section className="space-y-2.5">
        {/* счётчик ленты — у подписи раздела, чтобы заголовок «Заработок» не обрезался на узких экранах */}
        <SectionLabel
          action={
            <StatusPill tone={isFetching ? "live" : "neutral"}>
              {isFetching ? "синхр." : `${data?.length ?? 0} активных`}
            </StatusPill>
          }
        >
          Задания
        </SectionLabel>

        {isLoading && <LoadingPanel label="Загрузка ленты заданий…" />}
        {error && <ErrorPanel message="Канал заданий недоступен" />}

        {!isLoading && !error && data?.length === 0 && (
          <EmptyPanel
            title="Заданий пока нет"
            body="Активных заданий пока нет. Амбассадоры и админы публикуют их в разделе «Управление» в «Профиле»."
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
                    <Bar value={fillPct / 100} className="mt-3" label="Занято мест" />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Tag tone="neutral" dot={false}>
                        {slotsLeft} {plural(slotsLeft, "место", "места", "мест")}
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
      </section>
    </div>
  );
}

/** 1 место, 2 места, 5 мест */
function plural(n: number, one: string, few: string, many: string) {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

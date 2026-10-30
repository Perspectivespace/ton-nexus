import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { useMe, useTasks } from "@/api/hooks";
import { ScreenHeader, StatusPill, LoadingPanel, ErrorPanel, EmptyPanel, Panel, Bar, Tag, Tabs } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { DailyCheckIn } from "@/components/DailyCheckIn";
import { PromoPanel } from "@/components/PromoPanel";
import { IconUser } from "@/components/icons";

export type EarnTab = "tasks" | "friends" | "promo";
const TABS: ReadonlyArray<{ value: EarnTab; label: string }> = [
  { value: "tasks", label: "Задания" },
  { value: "friends", label: "Друзья" },
  { value: "promo", label: "Промокод" },
];

/** ?tab= → вкладка; неизвестное значение — «Задания» */
export function earnTab(v: string | null): EarnTab {
  return v === "friends" || v === "promo" ? v : "tasks";
}

/**
 * «Заработок» (/tasks, псевдоним /earn, DESIGN.md §14.1): сверху карточка ежедневной отметки,
 * ниже переключатель «Задания | Друзья | Промокод» (вкладка — в адресе ?tab=, чтобы ссылка открывала нужную).
 */
export function Tasks() {
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const tab = earnTab(params.get("tab"));
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

      <section className="space-y-3">
        <Tabs
          label="Способы заработка"
          items={TABS}
          value={tab}
          onChange={(v) =>
            setParams(
              (p) => {
                const n = new URLSearchParams(p);
                if (v === "tasks") n.delete("tab");
                else n.set("tab", v);
                return n;
              },
              { replace: true },
            )
          }
        />
        <div role="tabpanel" aria-label={TABS.find((t) => t.value === tab)?.label}>
          {tab === "tasks" && <TaskFeed />}
          {tab === "friends" && <FriendsSoon />}
          {tab === "promo" && <PromoPanel />}
        </div>
      </section>
    </div>
  );
}

/** Лента заданий */
function TaskFeed() {
  const { data, isLoading, error, isFetching } = useTasks();
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="ui-sec ui-shade !text-[12px] !leading-[16px]">Выполните — получите TON и опыт после проверки</p>
        <StatusPill tone={isFetching ? "live" : "neutral"}>{isFetching ? "синхр." : `${data?.length ?? 0} активных`}</StatusPill>
      </div>

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
          const fillPct = t.total_slots > 0 ? Math.round((t.filled_slots / t.total_slots) * 100) : 0;
          return (
            <motion.li key={t.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
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
                    <Tag tone="neutral" dot={false}>
                      ур. {t.min_level}+
                    </Tag>
                    <Tag tone="amber" dot={false}>
                      +{t.xp_reward} XP
                    </Tag>
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

/** «Друзья» — честная заглушка: наград за друзей на сервере пока нет (есть только поле referred_by), цифр не выдумываем */
export function FriendsSoon() {
  return (
    <Panel className="p-5">
      <div className="flex items-start gap-3">
        <span className="dc-ic muted" aria-hidden>
          <IconUser size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <h2 className="ui-h">Приглашения друзей</h2>
            <Tag tone="neutral" dot={false}>
              скоро
            </Tag>
          </div>
          <p className="ui-sec mt-1">
            Награды за приглашённых друзей пока не начисляются. Когда программа заработает, здесь появятся ваша ссылка и список друзей.
          </p>
        </div>
      </div>
    </Panel>
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

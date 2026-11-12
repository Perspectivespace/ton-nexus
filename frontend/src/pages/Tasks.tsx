import { motion } from "framer-motion";
import { Link, useSearchParams } from "react-router-dom";
import { useMe, useTasks } from "@/api/hooks";
import { ScreenHeader, StatusPill, LoadingPanel, ErrorPanel, EmptyPanel, Panel, Bar, Tag, Tabs } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { DailyCheckIn } from "@/components/DailyCheckIn";
import { PromoPanel } from "@/components/PromoPanel";
import { IconUser } from "@/components/icons";
import { TasksTopLink } from "@/components/RatingLinks";
import { t, tp } from "@/i18n";

export type EarnTab = "tasks" | "friends" | "promo";
const TABS: ReadonlyArray<{ value: EarnTab; label: string }> = [
  { value: "tasks", get label() { return t("tasks.tabTasks"); } },
  { value: "friends", get label() { return t("tasks.tabFriends"); } },
  { value: "promo", get label() { return t("tasks.tabPromo"); } },
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
  const canCreate = !!me; // visit доступен всем; legacy-типы режет форма создания

  return (
    <div className="space-y-5">
      <ScreenHeader
        title={t("nav.earn")}
        action={
          canCreate ? (
            <Link to="/tasks/new" className="ui-btn ghost sm" onClick={() => haptic.tap()}>
              {t("tasks.create")}</Link>
          ) : undefined
        }
      />

      <DailyCheckIn />

      <section className="space-y-3">
        <Tabs
          label={t("tasks.waysLabel")}
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
        <div role="tabpanel" aria-label={TABS.find((x) => x.value === tab)?.label}>
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
        <p className="ui-sec ui-shade !text-[12px] !leading-[16px]">{t("tasks.feedSub")}</p>
        <StatusPill tone={isFetching ? "live" : "neutral"}>{isFetching ? t("home.syncing") : t("tasks.activeN", { data: data?.length ?? 0 })}</StatusPill>
      </div>

      <TasksTopLink />

      {isLoading && <LoadingPanel label={t("tasks.loading")} />}
      {error && <ErrorPanel message={t("tasks.feedDown")} />}

      {!isLoading && !error && data?.length === 0 && (
        <EmptyPanel
          title={t("tasks.none")}
          body={t("tasks.noneSub")}
        />
      )}

      <ul className="space-y-3">
        {(data || []).map((task, i) => {
          const slotsLeft = task.total_slots - task.filled_slots;
          const fillPct = task.total_slots > 0 ? Math.round((task.filled_slots / task.total_slots) * 100) : 0;
          return (
            <motion.li key={task.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <Link to={`/tasks/${task.id}`} className="block no-underline text-inherit" onClick={() => haptic.tap()}>
                <Panel className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="ui-h !text-[15px] !leading-[20px] !font-medium">{task.title}</h2>
                    <span className="ui-num s-m !font-bold !text-[var(--neon)] shrink-0">
                      {Number(task.reward).toFixed(4)}
                      <span className="unit">TON</span>
                    </span>
                  </div>
                  <p className="ui-sec mt-2 line-clamp-2">{task.description}</p>
                  <Bar value={fillPct / 100} className="mt-3" label={t("tasks.slotsTaken")} />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Tag tone="neutral" dot={false}>
                      {slotsLeft} {tp("tasks.slots", slotsLeft)}
                    </Tag>
                    <Tag tone="neutral" dot={false}>
                      {t("common.lvlLower")}{" "}{task.min_level}+
                    </Tag>
                    <Tag tone="amber" dot={false}>
                      +{task.xp_reward} XP
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
            <h2 className="ui-h">{t("tasks.invites")}</h2>
            <Tag tone="neutral" dot={false}>
              {t("tasks.soon")}</Tag>
          </div>
          <p className="ui-sec mt-1">
            {t("tasks.invitesSoon")}</p>
        </div>
      </div>
    </Panel>
  );
}

/** 1 место, 2 места, 5 мест */

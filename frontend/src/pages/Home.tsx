import { motion, type Variants } from "framer-motion";
import { useMe, useDailyClaim } from "@/api/hooks";
import {
  IconBolt,
  IconChevron,
  IconReactor,
  IconUp,
  IconTasks,
  IconWallet,
  IconWheel,
} from "@/components/icons";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Panel,
  Num,
  Bar,
  Chip,
  List,
  ListRow,
  Button,
  SectionLabel,
  useToast,
} from "@/components/ui";

const modules = [
  {
    to: "/miner",
    idx: "01",
    title: "Майнер",
    channel: "Реактор",
    Icon: IconReactor,
  },
  {
    to: "/wheel",
    idx: "02",
    title: "Рулетка",
    channel: "Удача",
    Icon: IconWheel,
  },
  {
    to: "/tasks",
    idx: "03",
    title: "Задания",
    channel: "Рынок",
    Icon: IconTasks,
  },
  {
    to: "/wallet",
    idx: "04",
    title: "Баланс",
    channel: "Касса",
    Icon: IconWallet,
  },
] as const;

const container: Variants = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const item: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] as const },
  },
};

export function Home() {
  const { data: me, isLoading, error, isFetching } = useMe();
  const daily = useDailyClaim();
  const toast = useToast();

  return (
    <motion.div
      className="space-y-5"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.div variants={item}>
        <ScreenHeader
          eyebrow="TON Nexus"
          title={me?.first_name || me?.username || "Контур"}
          action={
            me ? (
              <StatusPill tone={isFetching ? "live" : "ok"}>
                {isFetching ? "синхр." : "в сети"}
              </StatusPill>
            ) : undefined
          }
        />
      </motion.div>

      {isLoading && <LoadingPanel label="Синхронизация контура…" />}
      {error && (
        <ErrorPanel message="Нет связи с API. Нужны backend и Telegram initData." />
      )}

      {me && (
        <motion.section variants={item}>
          <Panel level="hero" see cut="l" lift="l2" className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="ui-label ui-shade">Баланс</p>
                <Num value={Number(me.balance).toFixed(4)} unit="TON" size="xl" glow className="ui-shade mt-2 block !text-[36px] !leading-[44px]" />
              </div>
              <Panel level="e0" cut="s" lift={false} className="shrink-0 px-3 py-2.5 text-right">
                <div className="flex items-center justify-end gap-1.5 text-[var(--text-3)]">
                  <IconUp size={12} />
                  <span className="ui-label">Уровень</span>
                </div>
                <Num value={me.level} size="l" className="mt-1 block !text-[24px] !leading-[28px]" />
                <p className="ui-sys mt-0.5">{me.xp} XP</p>
              </Panel>
            </div>

            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between">
                <span className="ui-label ui-shade">Прогресс уровня</span>
                <span className="ui-sys ui-shade">{me.xp % 100} / 100 XP</span>
              </div>
              <Bar value={(me.xp % 100) / 100} label="Прогресс уровня" />
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Chip label="Фокус" value={me.focus_tokens} />
              <Chip label="Запрет" value={me.block_tokens} />
              {me.success_boost_bp > 0 && (
                <StatusPill tone="ok">+{(me.success_boost_bp / 100).toFixed(0)}% к удаче</StatusPill>
              )}
              {me.is_owner && <StatusPill tone="live">владелец</StatusPill>}
              {me.is_admin && !me.is_owner && <StatusPill tone="neutral">админ</StatusPill>}
            </div>
          </Panel>
        </motion.section>
      )}

      <motion.div variants={item} className="ui-spill">
        <Button
          kind="primary"
          size="lg"
          block
          className="!h-[60px] !justify-between !px-4 text-left"
          disabled={daily.isPending}
          onClick={() =>
            daily.mutate(undefined, {
              onSuccess: (r) =>
                r.already_claimed
                  ? toast({ kind: "info", title: "Сегодня уже отмечено", sub: `серия ${r.streak} дн · приходите завтра` })
                  : toast({
                      kind: "ok",
                      title: "Отметка засчитана",
                      sub: [
                        `+${Number(r.reward_ton).toFixed(4)} TON`,
                        r.reward_xp > 0 && `+${r.reward_xp} XP`,
                        r.reward_focus > 0 && `Фокус +${r.reward_focus}`,
                        `серия ${r.streak} дн`,
                      ]
                        .filter(Boolean)
                        .join(" · "),
                    }),
              onError: (e) => toast({ kind: "danger", title: "Отметка не прошла", sub: e.message }),
            })
          }
        >
          <span className="flex items-center gap-3">
            <IconBolt size={22} />
            <span>
              <span className="block text-[15px] leading-[20px]">
                {daily.isPending ? "Начисление…" : "Ежедневная отметка"}
              </span>
              <span className="block text-[11px] leading-[16px] tracking-[0.14em] opacity-70">Серия · награда · XP</span>
            </span>
          </span>
          <IconChevron size={20} />
        </Button>
      </motion.div>

      <motion.div variants={item} className="space-y-2.5">
        <SectionLabel>Модули</SectionLabel>
        <List>
          {modules.map((m) => {
            const Icon = m.Icon;
            return (
              <ListRow
                key={m.to}
                to={m.to}
                icon={<Icon size={20} />}
                title={m.title}
                sub={m.channel}
                value={<span className="ui-sys">{m.idx}</span>}
              />
            );
          })}
        </List>
      </motion.div>

      {(me?.is_owner || me?.is_admin || me?.is_ambassador || me?.can_deploy) && (
        <motion.div variants={item} className="space-y-2.5">
          <SectionLabel>Операции</SectionLabel>
          <List>
            {(me.is_owner || me.is_admin || me.is_ambassador) && (
              <ListRow to="/tasks/new" title="Создать задание" />
            )}
            {(me.is_owner || me.is_admin || me.is_ambassador) && (
              <ListRow to="/inbox" title="Модерация · входящие" />
            )}
            {(me.is_owner || me.is_admin) && <ListRow to="/withdraws" title="Касса · выводы" />}
            {me.is_owner && <ListRow to="/owner" title="Владелец · экономика" />}
            {me.can_deploy && <ListRow to="/owner?tab=deploy" title="Деплой · сервер" />}
          </List>
        </motion.div>
      )}
    </motion.div>
  );
}

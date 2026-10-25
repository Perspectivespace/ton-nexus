import { motion, type Variants } from "framer-motion";
import { Link } from "react-router-dom";
import { useMe, useMiner } from "@/api/hooks";
import { useDaily } from "@/lib/useDaily";
import { haptic } from "@/lib/haptics";
import { WorkArea } from "@/components/WorkArea";
import { CityWindow } from "@/components/CityV2";
import {
  IconBolt,
  IconCheck,
  IconChevron,
  IconReactor,
  IconUp,
  IconWheel,
} from "@/components/icons";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Panel,
  Scrim,
  Num,
  Bar,
  Chip,
  List,
  ListRow,
  Button,
  SectionLabel,
} from "@/components/ui";

/** Нижний док уже ведёт на Майнер, Задания и Баланс — здесь только то, чего в доке нет */
const more = [
  { to: "/wheel", title: "Колесо удачи", sub: "Вращение и ежедневная отметка", Icon: IconWheel },
  { to: "/upgrade", title: "Усиление", sub: "Прокачка параметров реактора", Icon: IconUp },
] as const;

const MINER_RU: Record<string, string> = {
  idle: "остановлен — запустите цикл",
  running: "цикл активен",
  ready: "хранилище полное — соберите",
};

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
  const { data: miner } = useMiner();
  const daily = useDaily();

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

      {/* КОНЦЕПТ v2: «окно в город» — полоса, где город не закрыт панелями */}
      <CityWindow />

      {isLoading && <LoadingPanel label="Синхронизация контура…" />}
      {error && (
        <ErrorPanel message="Нет связи с сервером. Откройте приложение из Telegram." />
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
              {me.is_ambassador && !me.is_admin && !me.is_owner && <StatusPill tone="neutral">амбассадор</StatusPill>}
              {me.can_deploy && <StatusPill tone="neutral">деплойер</StatusPill>}
            </div>

            {miner && (() => {
              const cap = Number(miner.storage_cap ?? 0);
              const acc = Number(miner.accrued_now ?? miner.pending_reward ?? 0);
              const pct = cap > 0 ? Math.min(100, Math.round((acc / cap) * 100)) : 0;
              const ready = miner.status === "ready";
              return (
                <Scrim className="relative -mx-5 -mb-5 mt-5 px-5 pb-4 pt-3">
                  <Link to="/miner" className="home-rx no-underline" onClick={() => haptic.tap()}>
                    <IconReactor size={20} />
                    <span className="min-w-0 flex-1">
                      <span className="ui-label block">Реактор</span>
                      <span className="ui-sec block truncate !text-[13px]">{MINER_RU[miner.status] || miner.status}</span>
                    </span>
                    <span className={ready ? "ui-num tone-amber text-[15px] font-bold" : "ui-num text-[15px] font-bold"}>{pct}%</span>
                    <IconChevron size={18} />
                  </Link>
                </Scrim>
              );
            })()}
          </Panel>
        </motion.section>
      )}

      <motion.div variants={item} className="ui-spill">
        <Button
          kind="primary"
          size="lg"
          block
          className="!h-[60px] !justify-between !px-4 text-left"
          disabled={!daily.ready}
          aria-label={daily.countdown ? `Отметка получена. Следующая награда через ${daily.countdown}` : undefined}
          onClick={daily.claimNow}
        >
          <span className="flex items-center gap-3">
            {daily.waiting ? <IconCheck size={22} /> : <IconBolt size={22} />}
            <span>
              <span className="block text-[15px] leading-[20px]">
                {daily.pending ? "Начисление…" : daily.waiting ? "Отметка получена" : "Ежедневная отметка"}
              </span>
              <span className="block text-[11px] leading-[16px] tracking-[0.14em] opacity-80">
                {daily.countdown ? (
                  <>
                    Следующая награда через <span className="ui-num">{daily.countdown}</span>
                  </>
                ) : (
                  "Серия · награда · XP"
                )}
              </span>
            </span>
          </span>
          {!daily.waiting && <IconChevron size={20} />}
        </Button>
      </motion.div>

      <motion.div variants={item} className="space-y-2.5">
        <SectionLabel>Ещё</SectionLabel>
        <List>
          {more.map((m) => {
            const Icon = m.Icon;
            return <ListRow key={m.to} to={m.to} icon={<Icon size={20} />} title={m.title} sub={m.sub} />;
          })}
        </List>
      </motion.div>

      {me && (
        <motion.div variants={item}>
          <WorkArea />
        </motion.div>
      )}
    </motion.div>
  );
}

import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useMe, useDailyClaim } from "@/api/hooks";
import {
  IconSpark,
  IconArrow,
  IconReactor,
  IconLevel,
  IconTasks,
  IconWallet,
} from "@/components/icons";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
} from "@/components/ui";

const modules = [
  {
    to: "/miner",
    idx: "01",
    title: "Майнер",
    channel: "Реактор",
    Icon: IconReactor,
    tone: "#7a9fd4",
  },
  {
    to: "/wheel",
    idx: "02",
    title: "Рулетка",
    channel: "Удача",
    Icon: IconSpark,
    tone: "#6eb8c9",
  },
  {
    to: "/tasks",
    idx: "03",
    title: "Задания",
    channel: "Рынок",
    Icon: IconTasks,
    tone: "#8f8fd4",
  },
  {
    to: "/wallet",
    idx: "04",
    title: "Баланс",
    channel: "Касса",
    Icon: IconWallet,
    tone: "#6fbf9a",
  },
] as const;

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

const item = {
  hidden: { opacity: 0, y: 16 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
  },
};

export function Home() {
  const { data: me, isLoading, error, isFetching } = useMe();
  const daily = useDailyClaim();

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
                {isFetching ? "sync" : "online"}
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
        <motion.section
          variants={item}
          className="panel panel-glow p-5"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <p className="eyebrow">Liquid balance</p>
              <hr className="rule mt-2 mb-3" />
              <p className="value-display text-[34px]">
                {Number(me.balance).toFixed(4)}
                <span className="ml-2 text-[11px] font-medium tracking-[0.16em] text-[var(--text-dim)]">
                  TON
                </span>
              </p>
            </div>
            <div className="shrink-0 rounded-[12px] border border-[var(--line)] bg-black/25 px-3 py-2.5 text-right">
              <div className="flex items-center justify-end gap-1.5">
                <IconLevel size={11} className="text-[var(--text-dim)]" />
                <span className="eyebrow">level</span>
              </div>
              <p className="value-display mt-1 text-[22px]">{me.level}</p>
              <p className="mono mt-0.5 text-[10px] text-[var(--text-dim)]">{me.xp} XP</p>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-1.5 flex items-center justify-between">
              <span className="eyebrow">Progress</span>
              <span className="mono text-[10px] text-[var(--text-dim)]">{me.xp} XP</span>
            </div>
            <div className="flex h-1 gap-0.5 overflow-hidden">
              {Array.from({ length: 12 }).map((_, i) => {
                const filled = i < Math.max(1, Math.floor(((me.xp % 100) / 100) * 12));
                return (
                  <motion.div
                    key={i}
                    className="h-full flex-1 rounded-[1px]"
                    initial={{ scaleX: 0, opacity: 0 }}
                    animate={{ scaleX: 1, opacity: filled ? 0.85 - i * 0.02 : 1 }}
                    transition={{ duration: 0.4, delay: 0.3 + i * 0.03, ease: "easeOut" }}
                    style={{
                      background: filled ? "var(--accent)" : "rgba(255,255,255,0.06)",
                      transformOrigin: "left",
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            <TokenChip label="Focus" value={me.focus_tokens} />
            <TokenChip label="Block" value={me.block_tokens} />
            {me.success_boost_bp > 0 && (
              <StatusPill tone="ok">+{(me.success_boost_bp / 100).toFixed(0)}% boost</StatusPill>
            )}
            {me.is_owner && <StatusPill tone="live">owner</StatusPill>}
            {me.is_admin && !me.is_owner && <StatusPill tone="neutral">admin</StatusPill>}
          </div>
        </motion.section>
      )}

      <motion.button
        variants={item}
        type="button"
        whileTap={{ scale: 0.985 }}
        className="btn-primary w-full justify-between px-4 py-3.5 text-left"
        disabled={daily.isPending}
        onClick={() => daily.mutate()}
      >
        <span className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/15">
            <IconSpark size={16} />
          </span>
          <span>
            <span className="block text-[13px] font-semibold tracking-[0.04em]">
              {daily.isPending ? "Начисление…" : "Daily check-in"}
            </span>
            <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.16em] opacity-70">
              Серия · награда · XP
            </span>
          </span>
        </span>
        <IconArrow size={15} />
      </motion.button>

      {/* Modules — console rows, not tile buttons */}
      <motion.div variants={item}>
        <p className="eyebrow mb-2.5">Modules</p>
        <div className="panel overflow-hidden p-0">
          {modules.map((m, i) => {
            const Icon = m.Icon;
            const last = i === modules.length - 1;
            return (
              <motion.div
                key={m.to}
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.45 + i * 0.06, ease: [0.22, 1, 0.36, 1] }}
              >
                <Link
                  to={m.to}
                  className={`module-row group flex items-center gap-3.5 px-4 py-3.5 no-underline active:bg-white/[0.04] ${
                    last ? "" : "border-b border-[var(--line)]"
                  }`}
                  style={{ ["--row-tone" as string]: m.tone }}
                >
                  <span className="mono w-6 shrink-0 text-[11px] text-[var(--text-meta)]">{m.idx}</span>
                  <span
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-[var(--line)]"
                    style={{
                      background: `color-mix(in srgb, ${m.tone} 12%, transparent)`,
                      color: m.tone,
                    }}
                  >
                    <Icon size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold tracking-tight text-[var(--text)]">
                      {m.title}
                    </span>
                    <span className="mt-0.5 block text-[9px] font-semibold uppercase tracking-[0.16em] text-[var(--text-dim)]">
                      {m.channel}
                    </span>
                  </span>
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-[var(--line)] text-[var(--text-dim)] transition-colors">
                    <IconArrow size={13} />
                  </span>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </motion.div>

      {(me?.is_owner || me?.is_admin || me?.is_ambassador) && (
        <motion.div variants={item} className="space-y-2">
          <p className="eyebrow">Operations</p>
          <div className="panel overflow-hidden p-0">
            {(me.is_owner || me.is_admin || me.is_ambassador) && (
              <OpsLink to="/tasks/new" label="Создать задание" />
            )}
            {(me.is_owner || me.is_admin || me.is_ambassador) && (
              <OpsLink to="/inbox" label="Inbox · модерация" />
            )}
            {(me.is_owner || me.is_admin) && <OpsLink to="/withdraws" label="Касса · выводы" />}
            {me.is_owner && <OpsLink to="/owner" label="Owner · экономика" last />}
          </div>
        </motion.div>
      )}
    </motion.div>
  );
}

function TokenChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-black/20 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">
      <span className="h-1 w-1 rounded-full bg-[var(--accent)]" />
      {label} {value}
    </span>
  );
}

function OpsLink({ to, label, last }: { to: string; label: string; last?: boolean }) {
  return (
    <Link
      to={to}
      className={`flex items-center justify-between px-4 py-3.5 text-[13px] tracking-wide text-[var(--text)] no-underline active:bg-white/[0.03] ${
        last ? "" : "border-b border-[var(--line)]"
      }`}
    >
      <span className="font-medium">{label}</span>
      <IconArrow size={14} className="text-[var(--text-dim)]" />
    </Link>
  );
}

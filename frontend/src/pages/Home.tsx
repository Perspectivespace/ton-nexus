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
    title: "Майнер",
    sub: "Реактор · цикл",
    Icon: IconReactor,
  },
  {
    to: "/wheel",
    title: "Рулетка",
    sub: "Контур удачи",
    Icon: IconSpark,
  },
  {
    to: "/tasks",
    title: "Задания",
    sub: "Рынок · TON",
    Icon: IconTasks,
  },
  {
    to: "/wallet",
    title: "Баланс",
    sub: "Вывод · история",
    Icon: IconWallet,
  },
] as const;

export function Home() {
  const { data: me, isLoading, error, isFetching } = useMe();
  const daily = useDailyClaim();

  return (
    <div className="space-y-6">
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

      {isLoading && <LoadingPanel label="Синхронизация контура…" />}
      {error && (
        <ErrorPanel message="Нет связи с API. Нужны backend и Telegram initData." />
      )}

      {me && (
        <motion.section
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="panel panel-glow relative overflow-hidden p-5"
        >
          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Liquid balance</p>
                <p className="value-display mt-1.5 text-[32px]">
                  {Number(me.balance).toFixed(4)}
                  <span className="ml-2 text-[11px] font-medium tracking-[0.14em] text-[var(--text-dim)]">
                    TON
                  </span>
                </p>
              </div>
              <div className="rounded-2xl border border-[var(--line)] bg-white/[0.03] px-3.5 py-2.5 text-right">
                <div className="flex items-center justify-end gap-1">
                  <IconLevel size={12} className="text-[var(--text-dim)]" />
                  <span className="eyebrow">level</span>
                </div>
                <p className="value-display mt-1 text-2xl">{me.level}</p>
                <p className="mono mt-0.5 text-[10px] tracking-wide text-[var(--text-dim)]">
                  {me.xp} XP
                </p>
              </div>
            </div>

            <div className="mt-4">
              <div className="mb-1.5 flex justify-between">
                <span className="eyebrow">Progress</span>
                <span className="mono text-[10px] text-[var(--text-dim)]">{me.xp} XP</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full rounded-full bg-[var(--accent)]"
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (me.xp % 100) || 8)}%` }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <TokenChip label="Фокус" value={me.focus_tokens} />
              <TokenChip label="Запрет" value={me.block_tokens} />
              {me.success_boost_bp > 0 && (
                <StatusPill tone="ok">+{(me.success_boost_bp / 100).toFixed(0)}% успех</StatusPill>
              )}
              {me.is_owner && <StatusPill tone="live">owner</StatusPill>}
              {me.is_admin && !me.is_owner && <StatusPill tone="neutral">admin</StatusPill>}
            </div>
          </div>
        </motion.section>
      )}

      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        className="btn-primary relative w-full overflow-hidden px-5 py-4 text-left"
        disabled={daily.isPending}
        onClick={() => daily.mutate()}
      >
        <div className="relative flex w-full items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/15">
              <IconSpark size={17} />
            </span>
            <div>
              <p className="text-[14px] font-semibold tracking-wide">
                {daily.isPending ? "Начисление…" : "Ежедневный check-in"}
              </p>
              <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-white/65">
                Серия · награда · XP
              </p>
            </div>
          </div>
          <IconArrow size={16} />
        </div>
      </motion.button>

      <div>
        <p className="eyebrow mb-3">Модули</p>
        <div className="grid grid-cols-2 gap-2.5">
          {modules.map((m, i) => {
            const Icon = m.Icon;
            return (
              <motion.div
                key={m.to}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 * i, duration: 0.3 }}
              >
                <Link
                  to={m.to}
                  className="panel flex h-[100px] flex-col justify-between p-3.5 no-underline transition-[border-color,background] duration-150 hover:border-[var(--line-strong)]"
                >
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--line)] bg-white/[0.03] text-[var(--text)]">
                    <Icon size={16} />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold tracking-tight text-[var(--text)]">
                      {m.title}
                    </p>
                    <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-[var(--text-dim)]">
                      {m.sub}
                    </p>
                  </div>
                </Link>
              </motion.div>
            );
          })}
        </div>
      </div>

      {(me?.is_owner || me?.is_admin || me?.is_ambassador) && (
        <div className="space-y-2">
          <p className="eyebrow">Операции</p>
          <div className="panel overflow-hidden p-0">
            {(me.is_owner || me.is_admin || me.is_ambassador) && (
              <OpsLink to="/tasks/new" label="Создать задание" />
            )}
            {(me.is_owner || me.is_admin || me.is_ambassador) && (
              <OpsLink to="/inbox" label="Inbox · модерация" />
            )}
            {(me.is_owner || me.is_admin) && (
              <OpsLink to="/withdraws" label="Касса · выводы" />
            )}
            {me.is_owner && <OpsLink to="/owner" label="Owner · экономика" last />}
          </div>
        </div>
      )}
    </div>
  );
}

function TokenChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-white/[0.03] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-dim)]">
      <span className="h-1 w-1 rounded-full bg-[var(--accent)]" />
      {label} · {value}
    </span>
  );
}

function OpsLink({ to, label, last }: { to: string; label: string; last?: boolean }) {
  return (
    <Link
      to={to}
      className={`flex items-center justify-between px-4 py-3.5 text-[13px] tracking-wide text-[var(--text)] no-underline transition-colors hover:bg-white/[0.03] ${
        last ? "" : "border-b border-[var(--line)]"
      }`}
    >
      <span className="font-medium">{label}</span>
      <IconArrow size={14} className="text-[var(--text-dim)]" />
    </Link>
  );
}

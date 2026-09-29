import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useMe, useDailyClaim } from "@/api/hooks";
import { IconSpark, IconArrow, IconReactor, IconLevel } from "@/components/icons";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Readout,
} from "@/components/ui";

export function Home() {
  const { data: me, isLoading, error, isFetching } = useMe();
  const daily = useDailyClaim();

  return (
    <div className="space-y-5">
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
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="panel panel-glow relative overflow-hidden p-5"
        >
          <div
            className="pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full opacity-50"
            style={{
              background:
                "radial-gradient(circle, rgba(107,155,255,0.28), transparent 70%)",
            }}
          />
          <div className="relative grid grid-cols-[1fr_auto] gap-4">
            <Readout label="Баланс" value={Number(me.balance).toFixed(4)} unit="TON" />
            <div className="rounded-2xl border border-[var(--line)] bg-white/[0.03] px-3 py-2 text-right">
              <div className="mb-1 flex items-center justify-end gap-1 text-[var(--text-dim)]">
                <IconLevel size={14} />
                <span className="text-[10px] uppercase tracking-wider">ур.</span>
              </div>
              <p className="mono text-xl font-semibold">{me.level}</p>
              <p className="mono text-[11px] text-[var(--text-dim)]">{me.xp} XP</p>
            </div>
          </div>

          <div className="relative mt-4 flex flex-wrap gap-2">
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--text-dim)]">
              Фокус · {me.focus_tokens}
            </span>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-[11px] text-[var(--text-dim)]">
              Запрет · {me.block_tokens}
            </span>
            {me.success_boost_bp > 0 && (
              <StatusPill tone="ok">+{(me.success_boost_bp / 100).toFixed(0)}% успех</StatusPill>
            )}
            {me.is_owner && <StatusPill tone="live">owner</StatusPill>}
            {me.is_admin && !me.is_owner && <StatusPill tone="neutral">admin</StatusPill>}
          </div>
        </motion.section>
      )}

      <section className="grid grid-cols-2 gap-3">
        <button
          type="button"
          className="btn-primary"
          disabled={daily.isPending}
          onClick={() => daily.mutate()}
        >
          <IconSpark size={16} />
          {daily.isPending ? "…" : "Daily"}
        </button>
        <Link to="/miner" className="btn-ghost">
          <IconReactor size={16} />
          Майнер
          <IconArrow size={14} />
        </Link>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <Link to="/wheel" className="btn-ghost text-center text-[13px]">
          Рулетка
        </Link>
        <Link to="/tasks" className="btn-ghost text-center text-[13px]">
          Задания
        </Link>
      </div>

      {(me?.is_owner || me?.is_admin || me?.is_ambassador) && (
        <Link to="/inbox" className="btn-ghost flex w-full justify-center text-[13px]">
          Inbox · модерация
        </Link>
      )}

      {me?.is_owner && (
        <Link to="/owner" className="btn-ghost flex w-full justify-center text-[13px]">
          Owner · экономика
        </Link>
      )}

      <div className="panel p-4">
        <p className="eyebrow mb-2">Система</p>
        <p className="text-[13px] leading-relaxed text-[var(--text-dim)]">
          Приборный контур: длинный цикл майнера, double-wheel усиление, задания с модерацией,
          ручной вывод.
        </p>
      </div>
    </div>
  );
}

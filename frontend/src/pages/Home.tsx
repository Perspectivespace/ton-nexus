import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useMe, useDailyClaim } from "@/api/hooks";
import { IconSpark, IconArrow, IconLevel, IconReactor } from "@/components/icons";

export function Home() {
  const { data: me, isLoading, error } = useMe();
  const daily = useDailyClaim();

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <p className="eyebrow">TON Nexus</p>
        <h1 className="text-[26px] font-semibold tracking-tight leading-tight">
          {me?.first_name || me?.username || "Контур"}
        </h1>
      </header>

      {isLoading && (
        <div className="panel panel-glow p-5 text-sm text-[var(--text-dim)]">
          Синхронизация контура…
        </div>
      )}
      {error && (
        <div className="panel border-[var(--danger)]/20 p-4 text-sm text-[var(--danger)]">
          Нет связи с API. Нужны backend и Telegram initData.
        </div>
      )}

      {me && (
        <motion.section
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="panel panel-glow relative overflow-hidden p-5"
        >
          <div
            className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full opacity-40"
            style={{
              background: "radial-gradient(circle, rgba(107,155,255,0.35), transparent 70%)",
            }}
          />
          <div className="relative flex items-end justify-between gap-4">
            <div>
              <p className="text-[11px] font-medium text-[var(--text-dim)]">Баланс</p>
              <p className="mono mt-1 text-[32px] font-semibold leading-none tracking-tight">
                {Number(me.balance).toFixed(4)}
              </p>
              <p className="mt-1 text-xs text-[var(--text-dim)]">TON</p>
            </div>
            <div className="rounded-2xl border border-[var(--line)] bg-white/[0.03] px-3 py-2 text-right">
              <div className="mb-1 flex items-center justify-end gap-1 text-[var(--text-dim)]">
                <IconLevel size={14} />
                <span className="text-[10px] uppercase tracking-wider">ур.</span>
              </div>
              <p className={"mono text-xl font-semibold"}>{me.level}</p>
              <p className={"mono text-[11px] text-[var(--text-dim)]"}>{me.xp} XP</p>
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
              <span className="rounded-full border border-[var(--success)]/30 bg-[var(--success)]/10 px-2.5 py-1 text-[11px] text-[var(--success)]">
                +{(me.success_boost_bp / 100).toFixed(0)}% успех
              </span>
            )}
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
          Daily
        </button>
        <Link to="/miner" className="btn-ghost">
          <IconReactor size={16} />
          Майнер
          <IconArrow size={14} />
        </Link>
      </section>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="panel p-4"
      >
        <p className="eyebrow mb-2">Система</p>
        <p className="text-sm leading-relaxed text-[var(--text-dim)]">
          Длинный цикл майнера, задания с модерацией, ручной вывод. Экономика крутится
          владельцем без деплоя.
        </p>
      </motion.div>
    </div>
  );
}

import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useMe, useDailyClaim } from "@/api/hooks";

export function Home() {
  const { data: me, isLoading, error } = useMe();
  const daily = useDailyClaim();

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--text-dim)]">TON Nexus</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {me?.first_name || me?.username || "Контур"}
        </h1>
      </header>

      {isLoading && <div className="panel p-4 text-[var(--text-dim)]">Загрузка профиля…</div>}
      {error && (
        <div className="panel p-4 text-sm text-[var(--danger)]">
          Нет связи с API. Нужны backend и Telegram initData (VITE_API_BASE).
        </div>
      )}

      {me && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="panel space-y-3 p-4"
          style={{ boxShadow: "var(--glow)" }}
        >
          <div className="flex items-end justify-between">
            <div>
              <p className="text-xs text-[var(--text-dim)]">Баланс</p>
              <p className="mono text-3xl font-semibold tracking-tight">
                {Number(me.balance).toFixed(4)}
                <span className="ml-1 text-sm font-normal text-[var(--text-dim)]">TON</span>
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs text-[var(--text-dim)]">Уровень</p>
              <p className="mono text-xl">{me.level}</p>
              <p className="text-xs text-[var(--text-dim)]">{me.xp} XP</p>
            </div>
          </div>
          <div className="flex gap-3 text-xs text-[var(--text-dim)]">
            <span>Фокус {me.focus_tokens}</span>
            <span>Запрет {me.block_tokens}</span>
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
          Daily
        </button>
        <Link to="/miner" className="btn-ghost text-center no-underline">
          Майнер →
        </Link>
      </section>
    </div>
  );
}

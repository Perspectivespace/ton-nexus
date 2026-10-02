import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useMe, useDailyClaim } from "@/api/hooks";
import { IconSpark, IconArrow, IconReactor, IconLevel } from "@/components/icons";
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
    accent: "#6b9bff",
    icon: "reactor",
  },
  {
    to: "/wheel",
    title: "Рулетка",
    sub: "Контур удачи",
    accent: "#5ce1ff",
    icon: "wheel",
  },
  {
    to: "/tasks",
    title: "Задания",
    sub: "Рынок · TON",
    accent: "#8b7cf7",
    icon: "tasks",
  },
  {
    to: "/wallet",
    title: "Баланс",
    sub: "Вывод · история",
    accent: "#3dd68c",
    icon: "wallet",
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
          className="relative overflow-hidden rounded-[22px] border border-white/[0.08] p-5"
          style={{
            background:
              "linear-gradient(155deg, rgba(18,24,40,0.95) 0%, rgba(8,10,18,0.98) 55%, rgba(12,16,28,0.9) 100%)",
            boxShadow:
              "0 0 0 1px rgba(107,155,255,0.06), 0 24px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
          }}
        >
          {/* scanline + glow */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              background:
                "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.12) 3px)",
            }}
          />
          <div
            className="pointer-events-none absolute -right-8 -top-12 h-44 w-44 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(107,155,255,0.35), transparent 68%)",
              filter: "blur(2px)",
            }}
          />
          <div
            className="pointer-events-none absolute -bottom-16 left-1/3 h-32 w-32 rounded-full"
            style={{
              background:
                "radial-gradient(circle, rgba(139,124,247,0.2), transparent 70%)",
            }}
          />

          <div className="relative">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7a8499]">
                  Liquid balance
                </p>
                <p className="mono mt-1 text-[32px] font-semibold leading-none tracking-tight">
                  {Number(me.balance).toFixed(4)}
                  <span className="ml-2 text-sm font-medium text-[#7a8499]">TON</span>
                </p>
              </div>
              <div
                className="rounded-2xl border border-white/[0.08] px-3.5 py-2.5 text-right"
                style={{ background: "rgba(107,155,255,0.08)" }}
              >
                <div className="flex items-center justify-end gap-1 text-[#7a8499]">
                  <IconLevel size={13} />
                  <span className="text-[9px] uppercase tracking-wider">level</span>
                </div>
                <p className="mono text-2xl font-semibold leading-none">{me.level}</p>
                <p className="mono mt-1 text-[10px] text-[#7a8499]">{me.xp} XP</p>
              </div>
            </div>

            {/* XP bar */}
            <div className="mt-4">
              <div className="mb-1.5 flex justify-between text-[10px] text-[#7a8499]">
                <span>Прогресс уровня</span>
                <span className="mono">{me.xp} XP</span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: "linear-gradient(90deg, #6b9bff, #8b7cf7)",
                    width: `${Math.min(100, (me.xp % 100) || 8)}%`,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(100, (me.xp % 100) || 8)}%` }}
                  transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
                />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <TokenChip label="Фокус" value={me.focus_tokens} color="#6b9bff" />
              <TokenChip label="Запрет" value={me.block_tokens} color="#8b7cf7" />
              {me.success_boost_bp > 0 && (
                <StatusPill tone="ok">+{(me.success_boost_bp / 100).toFixed(0)}% успех</StatusPill>
              )}
              {me.is_owner && <StatusPill tone="live">owner</StatusPill>}
              {me.is_admin && !me.is_owner && <StatusPill tone="neutral">admin</StatusPill>}
            </div>
          </div>
        </motion.section>
      )}

      {/* Primary action */}
      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        className="relative w-full overflow-hidden rounded-2xl px-5 py-4 text-left font-semibold text-white"
        style={{
          background: "linear-gradient(135deg, #6b9bff 0%, #5a7ef0 40%, #8b7cf7 100%)",
          boxShadow: "0 8px 32px rgba(107,155,255,0.35)",
        }}
        disabled={daily.isPending}
        onClick={() => daily.mutate()}
      >
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          style={{
            background:
              "linear-gradient(110deg, transparent 30%, rgba(255,255,255,0.25) 50%, transparent 70%)",
          }}
        />
        <div className="relative flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/15">
              <IconSpark size={18} />
            </span>
            <div>
              <p className="text-[15px]">{daily.isPending ? "Начисление…" : "Ежедневный check-in"}</p>
              <p className="text-[11px] font-normal text-white/70">Серия · награда · XP</p>
            </div>
          </div>
          <IconArrow size={16} />
        </div>
      </motion.button>

      {/* Module grid */}
      <div>
        <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7a8499]">
          Модули
        </p>
        <div className="grid grid-cols-2 gap-3">
          {modules.map((m, i) => (
            <motion.div
              key={m.to}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05 * i, duration: 0.35 }}
            >
              <Link
                to={m.to}
                className="group relative flex h-[104px] flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.07] p-4 transition-colors"
                style={{
                  background: "rgba(14,18,28,0.85)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
                }}
              >
                <div
                  className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full opacity-50 transition-opacity group-hover:opacity-80"
                  style={{
                    background: `radial-gradient(circle, ${m.accent}55, transparent 70%)`,
                  }}
                />
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-lg"
                  style={{ background: `${m.accent}18`, color: m.accent }}
                >
                  {m.icon === "reactor" && <IconReactor size={16} />}
                  {m.icon === "wheel" && <IconSpark size={16} />}
                  {m.icon === "tasks" && <span className="text-xs font-bold">T</span>}
                  {m.icon === "wallet" && <span className="text-xs font-bold">₿</span>}
                </span>
                <div>
                  <p className="text-[14px] font-semibold tracking-tight">{m.title}</p>
                  <p className="text-[11px] text-[#7a8499]">{m.sub}</p>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Ops — only roles */}
      {(me?.is_owner || me?.is_admin || me?.is_ambassador) && (
        <div className="space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#7a8499]">
            Операции
          </p>
          <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
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

function TokenChip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
      style={{
        borderColor: `${color}33`,
        background: `${color}12`,
        color,
      }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      {label} · {value}
    </span>
  );
}

function OpsLink({ to, label, last }: { to: string; label: string; last?: boolean }) {
  return (
    <Link
      to={to}
      className={`flex items-center justify-between bg-white/[0.02] px-4 py-3.5 text-[13px] text-[#c8d0e0] transition-colors hover:bg-white/[0.04] ${
        last ? "" : "border-b border-white/[0.05]"
      }`}
    >
      {label}
      <IconArrow size={14} className="text-[#7a8499]" />
    </Link>
  );
}

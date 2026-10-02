import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { useMiner, useMinerStart, useMinerClaim } from "@/api/hooks";
import { IconReactor } from "@/components/icons";
import {
  ScreenHeader,
  StatusPill,
  LoadingPanel,
  ErrorPanel,
  Gauge,
  Readout,
} from "@/components/ui";

const statusTone = {
  idle: "neutral" as const,
  running: "live" as const,
  ready: "warn" as const,
};

const statusLabel: Record<string, string> = {
  idle: "Ожидание",
  running: "Цикл активен",
  ready: "Хранилище полное",
};

export function Miner() {
  const { data: m, isLoading, error } = useMiner();
  const start = useMinerStart();
  const claim = useMinerClaim();

  if (isLoading) return <LoadingPanel label="Синхронизация реактора…" />;
  if (error) return <ErrorPanel message="Не удалось загрузить майнер" />;
  if (!m) return null;

  const accrued = Number(m.accrued_now ?? m.pending_reward);
  const cap = Number(m.storage_cap ?? m.estimated_reward ?? 0);
  const running = m.status === "running";
  const ready = m.status === "ready";

  return (
    <div className="space-y-5">
      <ScreenHeader
        eyebrow="Реактор"
        title="Майнер"
        action={
          <StatusPill tone={statusTone[m.status as keyof typeof statusTone] || "neutral"}>
            {statusLabel[m.status] || m.status}
          </StatusPill>
        }
      />

      {/* Hero reactor */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative overflow-hidden rounded-[22px] border border-white/[0.08] p-6"
        style={{
          background:
            "linear-gradient(160deg, rgba(16,22,38,0.98) 0%, rgba(6,8,14,1) 100%)",
          boxShadow:
            "0 0 0 1px rgba(107,155,255,0.08), 0 20px 50px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        <div
          className="pointer-events-none absolute left-1/2 top-1/2 h-48 w-48 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: running
              ? "radial-gradient(circle, rgba(107,155,255,0.35), transparent 65%)"
              : ready
                ? "radial-gradient(circle, rgba(245,193,74,0.25), transparent 65%)"
                : "radial-gradient(circle, rgba(107,155,255,0.12), transparent 65%)",
            animation: running ? "reactor-pulse 2.4s ease-in-out infinite" : undefined,
          }}
        />

        <div className="relative flex flex-col items-center">
          <div
            className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-white/[0.1]"
            style={{
              background: running ? "rgba(107,155,255,0.15)" : "rgba(255,255,255,0.04)",
              color: running ? "#6b9bff" : ready ? "#f5c14a" : "#7a8499",
              boxShadow: running ? "0 0 28px rgba(107,155,255,0.35)" : undefined,
            }}
          >
            <IconReactor size={28} />
          </div>

          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#7a8499]">
            Накоплено в цикле
          </p>
          <p className="mono mt-1 text-[28px] font-semibold tracking-tight">
            {accrued.toFixed(6)}
            <span className="ml-2 text-sm font-medium text-[#7a8499]">TON</span>
          </p>
          {m.cycle_hours != null && (
            <p className="mt-1 text-[12px] text-[#7a8499]">
              Длительность цикла ~{m.cycle_hours.toFixed(1)} ч
            </p>
          )}
        </div>

        <div className="relative mt-6 flex items-center gap-5">
          <Gauge value={accrued} max={cap || 1} label="Хранилище" sub={`${accrued.toFixed(4)}`} />
          <div className="min-w-0 flex-1 space-y-3">
            <Readout label="Ёмкость" value={cap.toFixed(6)} unit="TON" />
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${cap > 0 ? Math.min(100, (accrued / cap) * 100) : 0}%`,
                  background: ready
                    ? "linear-gradient(90deg, #f5c14a, #ff8a4c)"
                    : "linear-gradient(90deg, #6b9bff, #8b7cf7)",
                }}
              />
            </div>
            <p className="text-[11px] leading-relaxed text-[#7a8499]">
              {ready
                ? "Хранилище заполнено — соберите награду, иначе фарм остановлен."
                : running
                  ? "Реактор работает. Можно собрать до конца цикла."
                  : "Запустите цикл, чтобы начать накопление."}
            </p>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-2">
        {(
          [
            ["PWR", m.power, "Мощность"],
            ["CAP", m.capacity, "Ёмкость"],
            ["DUR", m.acceleration, "Длит."],
            ["LCK", m.luck, "Удача"],
            ["STB", m.stability, "Стаб."],
          ] as const
        ).map(([k, v, tip]) => (
          <div
            key={k}
            className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-1.5 py-2.5 text-center"
            title={tip}
          >
            <div className="text-[9px] font-semibold tracking-wider text-[#7a8499]">{k}</div>
            <div className="mono mt-1 text-sm font-semibold">{v}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-2.5">
        {m.status === "idle" && (
          <button
            type="button"
            className="btn-primary w-full py-3.5 text-[15px]"
            style={{
              background: "linear-gradient(135deg, #6b9bff, #8b7cf7)",
              boxShadow: "0 8px 28px rgba(107,155,255,0.35)",
            }}
            disabled={start.isPending}
            onClick={() => start.mutate()}
          >
            {start.isPending ? "Запуск…" : "Запуск цикла"}
          </button>
        )}
        {(m.status === "running" || m.status === "ready") && (
          <button
            type="button"
            className="btn-primary w-full py-3.5 text-[15px]"
            style={{
              background: ready
                ? "linear-gradient(135deg, #f5c14a, #e8a317)"
                : "linear-gradient(135deg, #6b9bff, #5a7ef0)",
              color: ready ? "#1a1200" : "#fff",
              boxShadow: ready
                ? "0 8px 28px rgba(245,193,74,0.35)"
                : "0 8px 28px rgba(107,155,255,0.3)",
            }}
            disabled={claim.isPending}
            onClick={() => claim.mutate()}
          >
            {claim.isPending ? "Сбор…" : ready ? "Собрать · хранилище полное" : "Собрать"}
          </button>
        )}
        <Link
          to="/upgrade"
          className="btn-ghost w-full border-white/[0.08] py-3.5 text-[14px]"
        >
          Модуль усиления · double-wheel
        </Link>
      </div>

      <style>{`
        @keyframes reactor-pulse {
          0%, 100% { opacity: 0.55; transform: translate(-50%, -50%) scale(1); }
          50% { opacity: 1; transform: translate(-50%, -50%) scale(1.08); }
        }
      `}</style>
    </div>
  );
}

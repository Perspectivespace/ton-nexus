import { motion } from "framer-motion";
import type { ReactNode } from "react";

export function StatusPill({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "live" | "warn" | "danger" | "ok";
  children: ReactNode;
}) {
  const map = {
    neutral: "bg-white/[0.06] text-[var(--text-dim)]",
    live: "bg-[var(--accent-soft)] text-[var(--accent)]",
    warn: "bg-[var(--warn)]/15 text-[var(--warn)]",
    danger: "bg-[var(--danger)]/15 text-[var(--danger)]",
    ok: "bg-[var(--success)]/15 text-[var(--success)]",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] ${map[tone]}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          tone === "live"
            ? "bg-[var(--accent)] animate-pulse"
            : tone === "ok"
              ? "bg-[var(--success)]"
              : tone === "warn"
                ? "bg-[var(--warn)]"
                : tone === "danger"
                  ? "bg-[var(--danger)]"
                  : "bg-[var(--text-dim)]"
        }`}
      />
      {children}
    </span>
  );
}

export function LoadingPanel({ label = "Синхронизация…" }: { label?: string }) {
  return (
    <div className="panel panel-glow flex items-center gap-3 p-5">
      <div className="relative h-9 w-9 shrink-0">
        <div className="absolute inset-0 rounded-full border border-[var(--line-strong)]" />
        <div className="absolute inset-0 animate-spin rounded-full border-2 border-transparent border-t-[var(--accent)]" />
      </div>
      <div>
        <p className="eyebrow">Telemetry</p>
        <p className="label-meta mt-1">{label}</p>
      </div>
    </div>
  );
}

export function ErrorPanel({ message }: { message: string }) {
  return (
    <div className="panel border-[var(--danger)]/25 p-4">
      <p className="eyebrow text-[var(--danger)]">Fault</p>
      <p className="mt-1.5 text-[13px] leading-relaxed tracking-wide text-[var(--danger)]">{message}</p>
    </div>
  );
}

export function EmptyPanel({ title, body }: { title: string; body: string }) {
  return (
    <div className="panel p-6 text-center">
      <p className="eyebrow mb-2">Idle</p>
      <p className="text-sm font-semibold tracking-tight">{title}</p>
      <p className="label-meta mt-2">{body}</p>
    </div>
  );
}

export function Readout({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: string;
  unit?: string;
  hint?: string;
}) {
  return (
    <div className="min-w-0">
      <p className="eyebrow">{label}</p>
      <p className="value-display mt-1.5 truncate text-xl">
        {value}
        {unit && (
          <span className="ml-1.5 text-[11px] font-medium tracking-[0.12em] text-[var(--text-dim)]">
            {unit}
          </span>
        )}
      </p>
      {hint && <p className="label-meta mt-1">{hint}</p>}
    </div>
  );
}

export function Gauge({
  value,
  max = 100,
  label,
  sub,
}: {
  value: number;
  max?: number;
  label: string;
  sub?: string;
}) {
  const pct = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const r = 36;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - pct);

  return (
    <div className="flex flex-col items-center">
      <div className="relative h-[96px] w-[96px]">
        <svg viewBox="0 0 96 96" className="h-full w-full -rotate-90">
          <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
          <motion.circle
            cx="48"
            cy="48"
            r={r}
            fill="none"
            stroke="url(#g)"
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={c}
            initial={{ strokeDashoffset: c }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
          />
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#6b9bff" />
              <stop offset="100%" stopColor="#8b7cf7" />
            </linearGradient>
          </defs>
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="value-display text-lg">{Math.round(pct * 100)}</span>
          <span className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--text-dim)]">%</span>
        </div>
      </div>
      <p className="eyebrow mt-2">{label}</p>
      {sub && <p className="mono mt-0.5 text-[10px] text-[var(--text-dim)]">{sub}</p>}
    </div>
  );
}

export function ScreenHeader({
  eyebrow,
  title,
  action,
}: {
  eyebrow: string;
  title: string;
  action?: ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1 className="title-display mt-1">{title}</h1>
      </div>
      {action}
    </header>
  );
}

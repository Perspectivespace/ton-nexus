import type { ReactNode } from "react";
import { cx } from "./press";

export type Tone = "ok" | "warn" | "danger" | "neon" | "neutral" | "amber";

/** Маркер статуса: срез 5, Tektur 11 капсом, квадратная точка, фон *-soft (п. 7) */
export function Tag({ tone = "neutral", dot = true, className, children }: { tone?: Tone; dot?: boolean; className?: string; children: ReactNode }) {
  return <span className={cx("ui-tag", tone, !dot && "nodot", className)}>{children}</span>;
}

/** Чип-счётчик: подпись + моно-значение, тёмный металл */
export function Chip({ icon, label, value, className }: { icon?: ReactNode; label?: ReactNode; value: ReactNode; className?: string }) {
  return (
    <span className={cx("ui-chip", className)}>
      {icon}
      {label ? <span>{label}</span> : null}
      <b>{value}</b>
    </span>
  );
}

/** Плитка характеристики: подпись, значение моно, подстрочник. focus — подсвечена, blocked — недоступна */
export function StatTile({
  label,
  value,
  sub,
  state,
  className,
  title,
}: {
  label: ReactNode;
  value: ReactNode;
  sub?: ReactNode;
  state?: "focus" | "blocked";
  className?: string;
  title?: string;
}) {
  return (
    <div className={cx("ui-stat", state, className)} title={title}>
      <p className="k">{label}</p>
      <p className="v">{value}</p>
      {sub != null ? <p className="p">{sub}</p> : null}
    </div>
  );
}

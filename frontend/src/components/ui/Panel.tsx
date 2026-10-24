import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./press";

export type PanelLevel = "e0" | "e1" | "e2" | "hero";

type PanelProps = HTMLAttributes<HTMLDivElement> & {
  /** e0 утоплено (поля, трек), e1 — обычная карточка, e2 — плавающий слой, hero — главный объект экрана */
  level?: PanelLevel;
  /** размер среза: s 8, m 14 (по умолчанию), l 20 */
  cut?: "s" | "m" | "l";
  /** «окно в город»: полупрозрачная заливка, сквозь которую виден фон (только для hero) */
  see?: boolean;
  /** тень-подложка под панелью (без filter) */
  lift?: boolean | "l2";
  /** магентовая кромка — состояние ошибки */
  danger?: boolean;
  /** классы внешней обёртки (отступы, сетка) — сама панель обрезается clip-path */
  wrapClassName?: string;
  children?: ReactNode;
};

/**
 * Панель со срезанными углами (docs/DESIGN.md, п. 3).
 * Срез делается clip-path, а он обрезает box-shadow, поэтому тень живёт на обёртке .ui-lift.
 */
export function Panel({ level = "e1", cut = "m", see, lift = true, danger, wrapClassName, className, children, ...rest }: PanelProps) {
  const panel = (
    <div
      className={cx(
        "ui-cut",
        level !== "e1" && level,
        cut === "s" && "c-s",
        cut === "l" && "c-l",
        see && "see",
        danger && "err-edge",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
  if (!lift) return wrapClassName ? <div className={wrapClassName}>{panel}</div> : panel;
  return <div className={cx("ui-lift", lift === "l2" && "l2", wrapClassName)}>{panel}</div>;
}

/** Затемнение под текстом, который лежит поверх «окна в город» */
export function Scrim({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx("ui-scrim", className)} {...rest}>
      {children}
    </div>
  );
}

/** Заголовок секции: Tektur 11 капсом на подложке (лежит прямо на городе, п. 3.8) + необязательное действие справа */
export function SectionLabel({ children, action, className }: { children: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={cx("flex items-center justify-between gap-3", className)}>
      <p className="ui-label ui-onbg">{children}</p>
      {action}
    </div>
  );
}

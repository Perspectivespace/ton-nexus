import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { haptic } from "@/lib/haptics";
import { IconChevron } from "../icons";
import { Panel } from "./Panel";
import { cx, usePressed } from "./press";

/** Группа строк в одной панели e1 с разделителями от 64 px (п. 7) */
export function List({ children, className, wrapClassName }: { children: ReactNode; className?: string; wrapClassName?: string }) {
  return (
    <Panel className={cx("ui-list", className)} wrapClassName={wrapClassName}>
      {children}
    </Panel>
  );
}

type RowProps = {
  icon?: ReactNode;
  iconTone?: "neon" | "amber" | "magenta" | "muted";
  title: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  valueTone?: "neon" | "amber" | "magenta";
  /** что-то справа вместо значения (маркер, кнопка) */
  trailing?: ReactNode;
  chevron?: boolean;
  to?: string;
  onClick?: () => void;
  className?: string;
};

/**
 * Строка списка 60 px: иконка 36 в срезанной плитке, заголовок Onest 15/500, подпись 13,
 * значение моно 15, шеврон. Нажатие — голубая риска слева + лёгкая вибрация.
 */
export function ListRow({ icon, iconTone = "neon", title, sub, value, valueTone, trailing, chevron, to, onClick, className }: RowProps) {
  const { bind } = usePressed();
  const interactive = !!(to || onClick);
  const inner = (
    <>
      {icon ? <span className={cx("ic", iconTone !== "neon" && iconTone)}>{icon}</span> : null}
      <span className="main">
        <span className="ttl block">{title}</span>
        {sub ? <span className="sub block">{sub}</span> : null}
      </span>
      {value != null ? <span className={cx("val", valueTone)}>{value}</span> : null}
      {trailing}
      {(chevron ?? interactive) ? <IconChevron size={18} className="chev" /> : null}
    </>
  );
  const cls = cx("ui-row", !icon && "noicon", !interactive && "static", className);
  if (to) {
    return (
      <Link to={to} className={cls} {...bind} onClick={() => haptic.tap()}>
        {inner}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={cls}
        {...bind}
        onClick={() => {
          haptic.tap();
          onClick();
        }}
      >
        {inner}
      </button>
    );
  }
  return <div className={cls}>{inner}</div>;
}

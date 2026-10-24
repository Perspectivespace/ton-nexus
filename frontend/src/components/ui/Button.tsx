import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { cx, usePressed } from "./press";

export type ButtonKind = "primary" | "secondary" | "ghost" | "danger";

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  kind?: ButtonKind;
  size?: "sm" | "md" | "lg";
  block?: boolean;
  icon?: ReactNode;
  /** вибрация при нажатии; по умолчанию лёгкий удар (п. 11.2). false — без вибрации */
  haptics?: "tap" | "collect" | "heavy" | "select" | false;
};

/**
 * Кнопка: primary — светящееся стекло (одна на экран), secondary — тёмный металл с голубой кромкой,
 * ghost — голубой текст, danger — тёмная магента. Нажатие: 97 %, сдвиг 1 px, 80 мс + вибрация.
 * Обёртка с переливом неона под primary — <span className="ui-spill">, если нужно.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { kind = "primary", size = "md", block, icon, haptics = "tap", className, children, onClick, type = "button", disabled, ...rest },
  ref,
) {
  const { bind } = usePressed();
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled}
      className={cx("ui-btn", kind, size === "lg" && "lg", size === "sm" && "sm", block && "block", className)}
      {...(disabled ? {} : bind)}
      onClick={(e) => {
        if (haptics) haptic[haptics]();
        onClick?.(e);
      }}
      {...rest}
    >
      {icon}
      {children}
    </button>
  );
});

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { haptic } from "@/lib/haptics";
import { cx } from "./press";

type HoldButtonProps = {
  /** вызывается, когда шкала заполнилась до конца */
  onConfirm: () => void;
  kind?: "primary" | "danger";
  /** сколько держать, мс (п. 13 D — 800) */
  duration?: number;
  disabled?: boolean;
  block?: boolean;
  size?: "md" | "lg";
  className?: string;
  children: ReactNode;
  /** подпись, пока держат (по умолчанию «Держите…») */
  holdingLabel?: ReactNode;
};

/**
 * «Удержание = заряд» для необратимых действий (вывод, удаление).
 * Палец на кнопке — шкала слева направо за 800 мс (только transform: scaleX), лёгкая вибрация в начале,
 * success в конце. Отпустил раньше — шкала стекает назад, ничего не происходит.
 * С клавиатуры: Enter/Пробел нужно так же держать.
 */
export function HoldButton({
  onConfirm,
  kind = "primary",
  duration = 800,
  disabled,
  block,
  size = "md",
  className,
  children,
  holdingLabel = "Держите…",
}: HoldButtonProps) {
  const [holding, setHolding] = useState(false);
  const [done, setDone] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const stop = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    setHolding(false);
  }, []);

  const start = useCallback(() => {
    if (disabled || timer.current) return;
    setDone(false);
    setHolding(true);
    haptic.tap();
    timer.current = window.setTimeout(() => {
      timer.current = undefined;
      setHolding(false);
      setDone(true);
      haptic.success();
      onConfirm();
      window.setTimeout(() => setDone(false), 600);
    }, duration);
  }, [disabled, duration, onConfirm]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return (
    <button
      type="button"
      disabled={disabled}
      className={cx("ui-btn hold", kind, size === "lg" && "lg", block && "block", className)}
      style={{ ["--hold-ms" as string]: `${duration}ms` }}
      data-holding={holding ? "" : undefined}
      data-done={done ? "" : undefined}
      data-pressed={holding ? "" : undefined}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture?.(e.pointerId);
        start();
      }}
      onPointerUp={stop}
      onPointerCancel={stop}
      onLostPointerCapture={stop}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !e.repeat) {
          e.preventDefault();
          start();
        }
      }}
      onKeyUp={(e) => {
        if (e.key === "Enter" || e.key === " ") stop();
      }}
      onContextMenu={(e) => e.preventDefault()}
      aria-label={typeof children === "string" ? `${children} — удерживайте` : undefined}
    >
      <i className="charge" aria-hidden />
      <span className="lbl">{holding ? holdingLabel : children}</span>
    </button>
  );
}

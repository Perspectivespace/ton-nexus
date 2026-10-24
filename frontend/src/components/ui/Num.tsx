import { useEffect, useRef, useState, type ReactNode } from "react";
import { cx, prefersReducedMotion } from "./press";

const DIGITS = "0123456789";

/**
 * Число моноширинным шрифтом с «расшифровкой» (п. 13 B): при смене значения цифры перебираются
 * и встают на место слева направо за 600 мс, ~12 кадров/с. Точки, пробелы и буквы не трогаются.
 * «Уменьшить движение» — значение сразу.
 */
export function useDecode(text: string, enabled = true, ms = 600): string {
  const [shown, setShown] = useState(text);
  const first = useRef(true);
  useEffect(() => {
    if (!enabled || prefersReducedMotion() || document.documentElement.classList.contains("app-hidden")) {
      setShown(text);
      first.current = false;
      return;
    }
    const target = text;
    const t0 = performance.now();
    const positions = [...target].map((ch, i) => (DIGITS.includes(ch) ? i : -1)).filter((i) => i >= 0);
    if (!positions.length) {
      setShown(target);
      return;
    }
    let id = 0;
    const tick = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const settled = Math.floor(k * positions.length);
      const chars = [...target];
      positions.forEach((pos, n) => {
        if (n >= settled) chars[pos] = DIGITS[(Math.random() * 10) | 0];
      });
      setShown(chars.join(""));
      if (k < 1) id = window.setTimeout(tick, 83);
      else setShown(target);
    };
    tick();
    first.current = false;
    return () => window.clearTimeout(id);
  }, [text, enabled, ms]);
  return shown;
}

export function Num({
  value,
  unit,
  size = "m",
  glow,
  tone,
  decode = true,
  className,
}: {
  value: string | number;
  unit?: ReactNode;
  size?: "s" | "m" | "l" | "xl";
  /** светящаяся цифра (только для главной цифры экрана) */
  glow?: boolean;
  tone?: "neon" | "amber" | "magenta";
  decode?: boolean;
  className?: string;
}) {
  const text = String(value);
  const shown = useDecode(text, decode);
  return (
    <span className={cx("ui-num", `s-${size}`, glow && "glow", tone && `tone-${tone}`, className)} aria-label={unit ? `${text} ${typeof unit === "string" ? unit : ""}` : text}>
      <span aria-hidden>{shown}</span>
      {unit ? (
        <span className="unit" aria-hidden>
          {unit}
        </span>
      ) : null}
    </span>
  );
}

/** Сегментная шкала 8 px (6 + 2). value 0…1 */
export function Bar({ value, tone = "neon", className, label }: { value: number; tone?: "neon" | "amber"; className?: string; label?: string }) {
  const v = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  return (
    <div
      className={cx("ui-bar", tone === "amber" && "amber", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      <i style={{ transform: `scaleX(${v})` }} />
    </div>
  );
}

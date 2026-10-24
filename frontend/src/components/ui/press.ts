import { useCallback, useState } from "react";

/**
 * Состояние «нажато» для кнопок и строк: data-pressed пока палец на элементе.
 * Отдельно от :active, потому что в WebView iOS :active срабатывает с задержкой.
 */
export function usePressed() {
  const [pressed, setPressed] = useState(false);
  const on = useCallback(() => setPressed(true), []);
  const off = useCallback(() => setPressed(false), []);
  return {
    pressed,
    bind: {
      onPointerDown: on,
      onPointerUp: off,
      onPointerLeave: off,
      onPointerCancel: off,
      "data-pressed": pressed ? "" : undefined,
    },
  };
}

export function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

/** «Уменьшить движение» — читаем один раз на вызов, без подписки */
export function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

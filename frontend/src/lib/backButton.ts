import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { WebApp } from "@/lib/telegram";

/**
 * Системная кнопка «Назад» Telegram — одна на всё приложение, поэтому обработчики складываются в стек:
 * отвечает верхний (открытая шторка поверх экрана), после его снятия кнопка снова ведёт назад с экрана.
 */
const stack: Array<() => void> = [];

function bb() {
  try {
    if (WebApp.platform !== "unknown" && WebApp.isVersionAtLeast("6.1")) return WebApp.BackButton;
  } catch {
    /* вне Telegram */
  }
  return null;
}

const fire = () => stack[stack.length - 1]?.();
let bound = false;

/** Есть ли системная «Назад» (внутри Telegram 6.1+). Вне Telegram экран рисует свою ссылку. */
export function hasBackButton() {
  return bb() !== null;
}

/** Повесить обработчик; возвращает функцию снятия. bottom — под всеми остальными (запасной «назад» маршрута). */
export function pushBack(handler: () => void, bottom = false): () => void {
  const b = bb();
  if (bottom) stack.unshift(handler);
  else stack.push(handler);
  if (b) {
    if (!bound) {
      b.onClick(fire);
      bound = true;
    }
    b.show();
  }
  return () => {
    const i = stack.lastIndexOf(handler);
    if (i >= 0) stack.splice(i, 1);
    if (b && !stack.length) b.hide();
  };
}

/** Шаг назад по истории приложения, а если её нет (открыли по прямой ссылке) — на fallback. */
function goBack(navigate: ReturnType<typeof useNavigate>, fallback: string) {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  if (idx > 0) navigate(-1);
  else navigate(fallback, { replace: true });
}

/**
 * Страховка для экранов вне дока (Layout): системная «Назад» видна всегда, даже если экран забыл useScreenBack —
 * иначе в Telegram (своей ссылки «Назад» там нет) игрок застревает. Обработчик лежит под экранными,
 * поэтому useScreenBack экрана и открытые шторки отвечают первыми.
 */
export function useRouteBackFallback(active: boolean) {
  const navigate = useNavigate();
  useEffect(() => (active ? pushBack(() => goBack(navigate, "/"), true) : undefined), [active, navigate]);
}

/**
 * Вложенный экран: системная «Назад» Telegram.
 * Если в приложении есть куда вернуться — шаг назад по истории, иначе (открыли по прямой ссылке) — на `fallback`.
 */
export function useScreenBack(fallback = "/") {
  const navigate = useNavigate();
  useEffect(
    () =>
      pushBack(() => goBack(navigate, fallback)),
    [navigate, fallback],
  );
}

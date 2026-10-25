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

/** Повесить обработчик; возвращает функцию снятия. */
export function pushBack(handler: () => void): () => void {
  const b = bb();
  stack.push(handler);
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

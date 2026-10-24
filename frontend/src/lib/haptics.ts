import { WebApp } from "./telegram";

/**
 * Вибрация через Telegram HapticFeedback (docs/DESIGN.md, п. 11.2).
 * Вне Telegram и в старых клиентах — тихо ничего не делает (это не ошибка).
 * Вибрация остаётся при «уменьшить движение».
 *
 *   haptic.tap()        — тап по главной кнопке (impact light)
 *   haptic.select()     — вкладка, выбор, шаг прогона
 *   haptic.collect()    — «Собрать»: medium сейчас, success — вызвать haptic.success() по ответу сервера
 *   haptic.success() / haptic.error() / haptic.warning()
 *   haptic.sheet()      — открытие шторки (impact soft)
 *   haptic.heavy()      — выигрыш колеса (затем success)
 */
function hf() {
  try {
    if (WebApp?.platform === "unknown" || !WebApp.isVersionAtLeast("6.1")) return null;
    return WebApp.HapticFeedback ?? null;
  } catch {
    return null;
  }
}

type Impact = "light" | "medium" | "heavy" | "rigid" | "soft";

export const haptic = {
  impact(style: Impact = "light") {
    hf()?.impactOccurred(style);
  },
  notify(type: "success" | "error" | "warning") {
    hf()?.notificationOccurred(type);
  },
  tap: () => haptic.impact("light"),
  select: () => hf()?.selectionChanged(),
  collect: () => haptic.impact("medium"),
  sheet: () => haptic.impact("soft"),
  heavy: () => haptic.impact("heavy"),
  success: () => haptic.notify("success"),
  error: () => haptic.notify("error"),
  warning: () => haptic.notify("warning"),
};

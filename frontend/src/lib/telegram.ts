import type { WebApp as WebAppT } from "@twa-dev/types";

/**
 * Telegram WebApp берётся из официального скрипта (index.html, telegram.org/js/telegram-web-app.js) —
 * он уже загружен до приложения. Своя копия скрипта (@twa-dev/sdk, 52 КБ) в стартовый чанк больше не входит:
 * она грузится, только если официальный скрипт не загрузился (см. telegramReady).
 * Все обращения к WebApp — в try (вне Telegram, старые клиенты).
 */
type TgWindow = Window & { Telegram?: { WebApp?: WebAppT } };
export let WebApp: WebAppT = (window as TgWindow).Telegram?.WebApp as WebAppT;

/** Готов ли WebApp; если официальный скрипт не загрузился — подгружаем копию из пакета */
export function telegramReady(): Promise<void> | null {
  if (WebApp) return null;
  return import("@twa-dev/sdk").then(
    (m) => {
      WebApp = m.default;
    },
    () => undefined,
  );
}

/** Цвета шапки и фона Telegram ставит lib/theme.ts по токену --bg текущей темы. */
export function initTelegram() {
  try {
    WebApp.ready();
    WebApp.expand();
  } catch {
    // browser outside Telegram
  }
}

/**
 * Real Telegram initData when inside Mini App.
 * Outside Telegram: if VITE_DEV_TG_ID is set, send "dev:<id>"
 * (backend accepts only when DEBUG=true).
 */
export function getInitData(): string {
  try {
    if (WebApp.initData) return WebApp.initData;
  } catch {
    /* */
  }
  // Browser demo (local Vite OR Vercel): need matching DEBUG=true on API
  const devId = import.meta.env.VITE_DEV_TG_ID;
  if (devId) {
    return `dev:${devId}`;
  }
  if (import.meta.env.DEV) {
    return "dev:1";
  }
  return "";
}

export function getTelegramUser() {
  try {
    return WebApp.initDataUnsafe?.user ?? null;
  } catch {
    return null;
  }
}

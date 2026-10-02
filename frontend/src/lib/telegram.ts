import WebApp from "@twa-dev/sdk";

export function initTelegram() {
  try {
    WebApp.ready();
    WebApp.expand();
    WebApp.setHeaderColor("#07090f");
    WebApp.setBackgroundColor("#07090f");
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

export { WebApp };

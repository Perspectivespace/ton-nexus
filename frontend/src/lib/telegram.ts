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

/** Real Telegram initData, or "dev:<id>" when running Vite without Telegram. */
export function getInitData(): string {
  try {
    if (WebApp.initData) return WebApp.initData;
  } catch {
    /* */
  }
  const devId = import.meta.env.VITE_DEV_TG_ID || "1";
  if (import.meta.env.DEV) {
    return `dev:${devId}`;
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

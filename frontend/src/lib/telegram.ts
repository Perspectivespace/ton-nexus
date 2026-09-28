import WebApp from "@twa-dev/sdk";

export function initTelegram() {
  try {
    WebApp.ready();
    WebApp.expand();
    WebApp.setHeaderColor("#07090f");
    WebApp.setBackgroundColor("#07090f");
  } catch {
    /* outside Telegram */
  }
}

export function getInitData(): string {
  try {
    return WebApp.initData || "";
  } catch {
    return "";
  }
}

export function getTelegramUser() {
  try {
    return WebApp.initDataUnsafe?.user ?? null;
  } catch {
    return null;
  }
}

export { WebApp };

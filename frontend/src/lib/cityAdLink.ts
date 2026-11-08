import { WebApp } from "@/lib/telegram";

/** Адрес для подписи в карточке: «t.me/канал» или домен сайта. */
export function linkHost(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === "t.me") return `t.me${u.pathname.replace(/\/+$/, "")}`;
    return u.hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/** Ссылка объявления безопасна для открытия: только https (сервер уже проверил — здесь страховка). */
export function isSafeAdLink(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Открыть ссылку объявления: t.me — внутри Telegram (openTelegramLink), сайт — во внешнем браузере (openLink).
 * Вне Telegram или в старом клиенте — новая вкладка без доступа к нашему окну.
 */
export function openAdLink(url: string, kind: "telegram" | "web" | null): boolean {
  if (!isSafeAdLink(url)) return false;
  try {
    if (kind === "telegram" && typeof WebApp?.openTelegramLink === "function" && WebApp.platform !== "unknown") {
      WebApp.openTelegramLink(url);
      return true;
    }
    if (typeof WebApp?.openLink === "function" && WebApp.platform !== "unknown") {
      WebApp.openLink(url);
      return true;
    }
  } catch {
    /* старый клиент — ниже обычное окно */
  }
  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}

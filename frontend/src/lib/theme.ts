import { WebApp } from "./telegram";

/**
 * Тема приложения по теме Telegram (docs/DESIGN.md, п. 2.3–2.4).
 * Тёмный Telegram → «Ночь», светлый → «Дневной HUD». Вне Telegram — «Ночь».
 * Меняется только атрибут data-theme на <html>; все цвета берутся из токенов (styles/tokens.css).
 */
export type Theme = "dark" | "light";

function insideTelegram(): boolean {
  try {
    return !!WebApp && WebApp.platform !== "unknown";
  } catch {
    return false;
  }
}

/**
 * «Дневной HUD» включён в фазе 1: жёсткие тёмные цвета (герой Майнера, Колесо, карточка уровня
 * на Главной, сине-фиолетовая «Собрать») заменены токенами, все экраны проверены в светлой теме.
 * Если понадобится срочно вернуть «всегда ночь» — поставить false; предпросмотр тогда
 * по-прежнему включается через localStorage.setItem("tn-theme-preview", "1").
 */
const LIGHT_THEME_READY = true;

function lightAllowed(): boolean {
  if (LIGHT_THEME_READY) return true;
  try {
    return localStorage.getItem("tn-theme-preview") === "1";
  } catch {
    return false;
  }
}

export function currentTheme(): Theme {
  if (!insideTelegram() || !lightAllowed()) return "dark";
  return WebApp.colorScheme === "light" ? "light" : "dark";
}

function tokenColor(name: string, fallback: `#${string}`): `#${string}` {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-fA-F]{6}$/.test(v) ? (v as `#${string}`) : fallback;
}

export function applyTheme(theme: Theme = currentTheme()) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  const bg = tokenColor("--bg", theme === "light" ? "#EEF1F6" : "#06070C");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  if (!insideTelegram()) return;
  try {
    WebApp.setHeaderColor(bg);
    WebApp.setBackgroundColor(bg);
  } catch {
    /* старые клиенты Telegram */
  }
}

/**
 * Флаги для «искр жизни» в городе (п. 12.1):
 * - html.app-hidden — приложение скрыто, анимации на паузе;
 * - html.low-end — слабое устройство (≤ 4 ядер или ≤ 4 ГБ), без дождя, искр и окон.
 * «Уменьшить движение» обрабатывается в CSS через prefers-reduced-motion.
 */
function initAmbientFlags() {
  const root = document.documentElement;
  const sync = () => root.classList.toggle("app-hidden", document.hidden);
  document.addEventListener("visibilitychange", sync);
  sync();
  const nav = navigator as Navigator & { deviceMemory?: number };
  if ((nav.hardwareConcurrency || 8) <= 4 || (nav.deviceMemory || 8) <= 4) root.classList.add("low-end");
}

export function initTheme() {
  applyTheme();
  initAmbientFlags();
  if (!insideTelegram()) return;
  try {
    WebApp.onEvent("themeChanged", () => applyTheme());
  } catch {
    /* */
  }
}

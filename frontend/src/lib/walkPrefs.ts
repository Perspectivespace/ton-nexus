import { WebApp } from "@/lib/telegram";

/**
 * Настройки «Прогулки»: наклон телефона (параллакс) и «жизнь улицы».
 * На слабых устройствах и при «меньше движения» наклон и уличные события выключены всегда, переключатель не показывается.
 */
const KEY = "walk:tilt";

export function reducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}
export const lowEnd = () => document.documentElement.classList.contains("low-end");
/** можно ли вообще «живое» движение (наклон, уличные события, инерция) */
export const motionAllowed = () => !lowEnd() && !reducedMotion();

/** датчик наклона Telegram (Bot API 8.0+) */
export function tgOrientation() {
  try {
    if (WebApp && WebApp.platform !== "unknown" && WebApp.isVersionAtLeast("8.0") && WebApp.DeviceOrientation) return WebApp.DeviceOrientation;
  } catch {
    /* вне Telegram */
  }
  return null;
}

/** есть ли датчик: Telegram или браузерный deviceorientation на сенсорном экране */
export function tiltAvailable(): boolean {
  if (tgOrientation()) return true;
  try {
    return typeof window.DeviceOrientationEvent !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** выбор пользователя (по умолчанию — включено) */
export function tiltPref(): boolean {
  try {
    return localStorage.getItem(KEY) !== "0";
  } catch {
    return true;
  }
}
export function setTiltPref(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    /* приватный режим */
  }
}

/** показывать ли переключатель наклона */
export const tiltOffered = () => tiltAvailable() && motionAllowed();
/** включён ли наклон сейчас */
export const tiltOn = () => tiltOffered() && tiltPref();

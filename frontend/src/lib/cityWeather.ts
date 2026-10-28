import { serverNow } from "./cityPhase";

/**
 * Погода светлых фаз (daycity, шаг 5; DESIGN.md п. 12.1). Обычно над городом дождь; примерно каждый третий
 * день по Москве — ясный: без дождя, с бликами в лужах. Детерминированно по дате МСК — у всех игроков
 * в один день одинаково и без запросов к серверу. Ночь и вечер не меняются (всегда дождь).
 * `?weather=clear` / `?weather=rain` — принудительно для проверки.
 */
export function clearDayKey(now: number): number {
  const msk = new Date(now + 3 * 3600 * 1000);
  return msk.getUTCFullYear() * 10000 + (msk.getUTCMonth() + 1) * 100 + msk.getUTCDate();
}

export function isClearDate(now: number): boolean {
  let h = clearDayKey(now) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) % 3 === 0;
}

export function isClearSky(now = serverNow()): boolean {
  const q = typeof location !== "undefined" ? new URLSearchParams(location.search).get("weather") : null;
  if (q === "clear") return true;
  if (q === "rain") return false;
  return isClearDate(now);
}

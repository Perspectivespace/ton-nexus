/**
 * Локальное хранилище «Башни» (PR 1: всё на устройстве). Рекорд и пробная строка про попытки;
 * счёт и лимит попыток на сервер переедут в следующих PR (серверная проверка забега по seed + журналу тапов).
 */
const BEST = "tn-tower-best";

/** бесплатных попыток в день — пока только подпись на старте, лимит не включён */
export const FREE_ATTEMPTS = 3;

export function loadBest(): number {
  try {
    const n = Number(localStorage.getItem(BEST));
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  } catch {
    return 0;
  }
}

/** сохранить рекорд, если счёт его побил; true — побил */
export function saveBest(score: number): boolean {
  if (score <= loadBest()) return false;
  try {
    localStorage.setItem(BEST, String(score));
  } catch {
    /* приватный режим: рекорд живёт до закрытия через состояние экрана */
  }
  return true;
}

/** seed забега. Позже его выдаёт сервер; пока — случайный на клиенте */
export function randomSeed(): number {
  const a = new Uint32Array(1);
  try {
    crypto.getRandomValues(a);
  } catch {
    a[0] = (Math.random() * 4294967296) >>> 0;
  }
  return a[0];
}

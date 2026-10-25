import { useEffect, useState } from "react";

/** «23:41:05» — часы:минуты:секунды до момента; меньше нуля не бывает. */
export function formatLeft(ms: number) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

const MSK_MS = 3 * 3600 * 1000; // Москва — UTC+3 круглый год

/** Ближайшие 00:00 по Москве (игровой день) — запасное правило, если сервер не прислал время сброса. */
export function nextMskMidnight(now = Date.now()) {
  const d = new Date(now + MSK_MS);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - MSK_MS;
}

/**
 * Живой отсчёт до `target` (мс, по часам сервера). `offset` — поправка «сервер минус телефон».
 * Тикает раз в секунду, пока цель в будущем; по достижении зовёт `onDone` один раз.
 */
export function useCountdown(target: number | null, offset = 0, onDone?: () => void) {
  const [now, setNow] = useState(() => Date.now() + offset);
  useEffect(() => {
    if (target == null) return;
    setNow(Date.now() + offset);
    const id = window.setInterval(() => {
      const t = Date.now() + offset;
      setNow(t);
      if (t >= target) {
        window.clearInterval(id);
        onDone?.();
      }
    }, 1000);
    return () => window.clearInterval(id);
    // onDone намеренно не в зависимостях: достаточно последнего на момент запуска
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, offset]);
  if (target == null) return null;
  const left = target - now;
  return left > 0 ? left : 0;
}

import { useEffect, useRef } from "react";
import { useSecondTick } from "@/lib/clock";

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
 * Тикает от общих секундных часов (`lib/clock`), пока цель в будущем; по достижении зовёт `onDone` один раз.
 * Компонент только перерисовывает текст — без перемонтирования и повторных анимаций.
 */
export function useCountdown(target: number | null, offset = 0, onDone?: () => void) {
  const live = target != null && Date.now() + offset < target;
  useSecondTick(live);
  const now = Date.now() + offset;
  const left = target == null ? null : Math.max(0, target - now);
  const done = useRef<number | null>(null);
  const cb = useRef(onDone);
  cb.current = onDone;
  useEffect(() => {
    if (target == null || left == null || left > 0 || done.current === target) return;
    done.current = target;
    cb.current?.();
  }, [target, left]);
  return left;
}

import { useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./press";
import { haptic } from "@/lib/haptics";

/**
 * Момент A (docs/DESIGN.md, п. 13): «неон зажигается» один раз на экран за сессию.
 * Возвращает true, пока идёт зажигание (380 мс), в конце — лёгкая вибрация.
 * Повторное открытие, «уменьшить движение» или enabled=false — сразу false.
 */
export function useIgniteOnce(key: string, enabled = true): boolean {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!enabled || prefersReducedMotion()) return;
    const k = `ignite:${key}`;
    try {
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    } catch {
      return;
    }
    setActive(true);
    const id = window.setTimeout(() => {
      setActive(false);
      haptic.tap();
    }, 380);
    return () => {
      window.clearTimeout(id);
      setActive(false);
    };
  }, [key, enabled]);
  return active;
}

/**
 * Живой счётчик накопления (п. 13 B): «тихий одометр», 4 обновления в секунду, без расшифровки.
 * Сервер считает линейно от начала цикла до конца, с потолком хранилища, — повторяем то же на клиенте
 * от последнего ответа сервера. Скрытое приложение — без обновлений.
 */
export function useLiveAccrued(opts: {
  accrued: number;
  cap: number;
  running: boolean;
  startedAt?: string | null;
  endsAt?: string | null;
  fetchedAt: number;
}): number {
  const { accrued, cap, running, startedAt, endsAt, fetchedAt } = opts;
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef(0);
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      if (!document.documentElement.classList.contains("app-hidden")) setNow(Date.now());
    };
    timer.current = window.setInterval(tick, 250);
    return () => window.clearInterval(timer.current);
  }, [running]);
  if (!running || !startedAt) return accrued;
  const start = Date.parse(startedAt);
  const ends = endsAt ? Date.parse(endsAt) : Infinity;
  const elapsedAtFetch = Math.min(fetchedAt, ends) - start;
  if (!(elapsedAtFetch > 5000) || !(accrued > 0)) return accrued;
  const rate = accrued / elapsedAtFetch;
  const elapsedNow = Math.min(now, ends) - start;
  const live = rate * Math.max(elapsedNow, elapsedAtFetch);
  return cap > 0 ? Math.min(cap, live) : live;
}

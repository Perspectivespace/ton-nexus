import { useEffect, useState } from "react";

/**
 * Смена суток в городе по московскому времени (DESIGN.md п. 3.8.2).
 * Москва — UTC+3 круглый год; время считаем от UTC (часовой пояс телефона не важен),
 * с поправкой на часы сервера, если она известна (`setServerClock`).
 *
 *   рассвет 05:00–09:00 · день 09:00–18:00 · вечер 18:00–21:00 · ночь 21:00–05:00
 */
export type CityPhase = "dawn" | "day" | "dusk" | "night";
export const PHASES: CityPhase[] = ["dawn", "day", "dusk", "night"];

const MSK_MS = 3 * 3600 * 1000;
const HOUR = 3600 * 1000;
/** начало каждой фазы, часы МСК — по возрастанию */
const STARTS: [number, CityPhase][] = [
  [5, "dawn"],
  [9, "day"],
  [18, "dusk"],
  [21, "night"],
];
/** за сколько до смены фазы подгружать следующий кадр */
export const PRELOAD_MS = 90 * 1000;

let offset = 0; // «сервер минус телефон», мс
const listeners = new Set<() => void>();

/** Поправка часов: сервер прислал своё время (например, server_time из /daily/status). */
export function setServerClock(serverIso: string | undefined | null) {
  const srv = serverIso ? Date.parse(serverIso) : NaN;
  if (!Number.isFinite(srv)) return;
  const next = srv - Date.now();
  if (Math.abs(next - offset) < 5000) return; // дребезг сети не трогаем
  offset = next;
  listeners.forEach((f) => f());
}

export const serverNow = () => Date.now() + offset;

/** Фаза и момент (по часам телефона) следующей смены. */
export function phaseAt(now = serverNow()): { phase: CityPhase; next: CityPhase; changeAt: number } {
  const msk = now + MSK_MS;
  const dayStart = Math.floor(msk / (24 * HOUR)) * 24 * HOUR;
  const h = (msk - dayStart) / HOUR;
  let i = STARTS.length - 1; // до 05:00 — ещё ночь
  for (let k = 0; k < STARTS.length; k++) if (h >= STARTS[k][0]) i = k;
  const n = (i + 1) % STARTS.length;
  let nextH = STARTS[n][0];
  if (nextH <= h) nextH += 24;
  const changeAt = dayStart + nextH * HOUR - MSK_MS - offset;
  return { phase: STARTS[i][1], next: STARTS[n][1], changeAt };
}

/** ?phase=dawn|day|dusk|night — принудительная фаза для проверки (работает и в сборке: меняет только картинку). */
function forced(): CityPhase | null {
  try {
    const q = new URLSearchParams(location.search).get("phase");
    return PHASES.includes(q as CityPhase) ? (q as CityPhase) : null;
  } catch {
    return null;
  }
}

/**
 * Текущая фаза города и `upcoming` — следующая фаза, когда до смены осталось меньше PRELOAD_MS
 * (её кадр пора подкачать, чтобы смена шла плавным растворением; иначе null).
 * Таймеры ставятся на ближайшую границу; после сна вкладки (visibilitychange) всё пересчитывается.
 */
export function useCityPhase(): { phase: CityPhase; upcoming: CityPhase | null } {
  const [phase, setPhase] = useState<CityPhase>(() => forced() ?? phaseAt().phase);
  const [upcoming, setUpcoming] = useState<CityPhase | null>(null);
  useEffect(() => {
    if (forced()) return;
    let tPre = 0;
    let tChange = 0;
    const plan = () => {
      window.clearTimeout(tPre);
      window.clearTimeout(tChange);
      const p = phaseAt();
      setPhase(p.phase);
      setUpcoming(null);
      const left = p.changeAt - Date.now();
      tPre = window.setTimeout(() => setUpcoming(p.next), Math.max(0, left - PRELOAD_MS));
      tChange = window.setTimeout(plan, left + 250); // чуть позже границы — точно уже новая фаза
    };
    plan();
    const onVis = () => document.visibilityState === "visible" && plan();
    document.addEventListener("visibilitychange", onVis);
    listeners.add(plan);
    return () => {
      window.clearTimeout(tPre);
      window.clearTimeout(tChange);
      document.removeEventListener("visibilitychange", onVis);
      listeners.delete(plan);
    };
  }, []);
  return { phase, upcoming };
}

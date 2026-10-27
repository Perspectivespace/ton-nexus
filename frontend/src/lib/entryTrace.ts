/**
 * Журнал входа в здание (тап по башне → экран «Майнер»): метки времени от тапа.
 * Нужен счётчику FPS (lib/fpsMeter.ts): на плашке и в отчёте видно, на чём именно вход задержался —
 * на загрузке кадра интерьера / раздела, на самом маршруте или на отрисовке. Сам журнал почти бесплатный
 * (несколько записей в массив), поэтому работает всегда, а читает его только счётчик.
 */
export type EntryMark = { name: string; at: number; dur?: number; note?: string };
export type Entry = { n: number; t0: number; path: string; marks: EntryMark[] };

/** метки, пришедшие позже этого срока после тапа, к входу уже не относятся */
const LIFE_MS = 8000;
const KEEP = 4;
const log: Entry[] = [];
let counter = 0;

export function entryStart(path: string): void {
  log.push({ n: ++counter, t0: performance.now(), path, marks: [{ name: "тап", at: 0 }] });
  if (log.length > KEEP) log.shift();
}

function live(): Entry | null {
  const e = log[log.length - 1];
  return e && performance.now() - e.t0 < LIFE_MS ? e : null;
}

/** поставить метку (один раз на вход); note — пояснение, например «по таймауту» */
export function entryMark(name: string, note?: string): void {
  const e = live();
  if (!e || e.marks.some((m) => m.name === name)) return;
  e.marks.push({ name, at: Math.round(performance.now() - e.t0), note });
}

/** выполнить fn и записать, сколько она заняла (мост Telegram — вибрация, кнопка «Назад» — вызывается синхронно) */
export function entryTime<T>(name: string, fn: () => T): T {
  const t = performance.now();
  try {
    return fn();
  } finally {
    const e = live();
    const d = performance.now() - t;
    if (e && !e.marks.some((m) => m.name === name)) e.marks.push({ name, at: Math.round(t - e.t0), dur: Math.round(d * 10) / 10 });
  }
}

export const entries = (): readonly Entry[] => log;

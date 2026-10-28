/**
 * «Тишина» для фоновой подгрузки: ~1 с после смены экрана главный поток и компоновщик заняты первыми кадрами
 * нового экрана — чанки разделов (загрузка, разбор, исполнение модуля) в это окно добавляют остановки кадров.
 * Фоновое — только когда окно закрылось; по намерению (касание ссылки) — как раньше.
 */
let until = 0;

/** Отложить фоновую подгрузку минимум на ms от сейчас. */
export const markBusy = (ms: number) => {
  until = Math.max(until, performance.now() + ms);
};

export const isBusy = () => performance.now() < until;

/** Выполнить cb в простое, но не раньше конца окна «занято» (проверка раз в 250 мс). */
export function idleWhenQuiet(cb: () => void) {
  const tick = () => {
    if (isBusy()) return void window.setTimeout(tick, 250);
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb, { timeout: 2500 });
    else window.setTimeout(cb, 1200);
  };
  tick();
}

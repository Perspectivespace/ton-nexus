/**
 * «Тишина» для фоновой подгрузки: пока идёт наезд на здание и ~1 с после смены экрана, главный поток и
 * компоновщик заняты кадрами перехода — чанки разделов (загрузка, разбор, исполнение модуля) в это окно
 * добавляют остановки кадров. Фоновое — только когда окно закрылось; по намерению (касание ссылки) — как раньше.
 */
let until = 0;

/** Отложить фоновую подгрузку минимум на ms от сейчас. */
export const markBusy = (ms: number) => {
  until = Math.max(until, performance.now() + ms);
};

const transitioning = () => {
  const c = document.documentElement.classList;
  return c.contains("bz-hide") || c.contains("bz-in") || c.contains("bz-fade") || c.contains("bz-show") || c.contains("bz-back");
};

export const isBusy = () => performance.now() < until || transitioning();

/** Выполнить cb в простое, но не раньше конца окна «занято» (проверка раз в 250 мс). */
export function idleWhenQuiet(cb: () => void) {
  const tick = () => {
    if (isBusy()) return void window.setTimeout(tick, 250);
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(cb, { timeout: 2500 });
    else window.setTimeout(cb, 1200);
  };
  tick();
}

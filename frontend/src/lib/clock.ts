import { useSyncExternalStore } from "react";

/**
 * Общие «секундные часы» приложения: один таймер на все обратные отсчёты.
 * Тикает ровно на границе секунды, поэтому все отсчёты на экране (колесо, отметка, башня)
 * меняют цифру в один и тот же кадр, а не вразнобой. Пока подписчиков нет — таймер остановлен.
 */
type Fn = () => void;
const subs = new Set<Fn>();
let tick = Math.floor(Date.now() / 1000);
let timer = 0;

function schedule() {
  // до следующей целой секунды (+5 мс, чтобы точно перейти через границу)
  timer = window.setTimeout(() => {
    tick = Math.floor(Date.now() / 1000);
    subs.forEach((f) => f());
    if (subs.size) schedule();
    else timer = 0;
  }, 1005 - (Date.now() % 1000));
}

export function subscribeSeconds(f: Fn) {
  subs.add(f);
  if (!timer) {
    tick = Math.floor(Date.now() / 1000);
    schedule();
  }
  return () => {
    subs.delete(f);
    if (!subs.size && timer) {
      window.clearTimeout(timer);
      timer = 0;
    }
  };
}

const noop = () => () => {};
const snap = () => tick;

/** Номер текущей секунды; компонент перерисовывается раз в секунду, пока `active`. */
export function useSecondTick(active = true): number {
  return useSyncExternalStore(active ? subscribeSeconds : noop, snap, snap);
}

/** Для тестов: сколько компонентов сейчас слушают часы. */
export function clockSubscribers() {
  return subs.size;
}

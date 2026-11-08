import { useSyncExternalStore } from "react";

/**
 * «Прогулка» («чистый город», реклама в городе PR 3): режим главной, где остаётся только город на весь экран.
 * Панели главной размонтированы, шапка и док скрыты (класс html.city-walk), реклама в городе становится
 * касаемой: касание вывески открывает подробную карточку. Вне «Прогулки» реклама пассивна (pointer-events: none).
 * Состояние — маленькое общее хранилище: город (CityBackdrop) и главная (Home) живут в разных ветках дерева.
 */
type State = { active: boolean; picked: string | null };
let state: State = { active: false, picked: null };
const subs = new Set<() => void>();

function set(next: Partial<State>) {
  state = { ...state, ...next };
  const c = document.documentElement.classList;
  c.toggle("city-walk", state.active);
  c.toggle("city-walk-card", state.active && state.picked !== null);
  subs.forEach((f) => f());
}

export const cityWalk = {
  enter: () => set({ active: true, picked: null }),
  exit: () => set({ active: false, picked: null }),
  /** выбрать рекламное место (ключ места) — только в «Прогулке» */
  pick: (spot: string) => {
    if (state.active) set({ picked: spot });
  },
  close: () => set({ picked: null }),
  get: () => state,
};

const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function useCityWalk(): State {
  return useSyncExternalStore(subscribe, cityWalk.get, cityWalk.get);
}

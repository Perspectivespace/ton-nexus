import { cityWalk } from "@/lib/cityWalk";
import { DISTRICT_ORDER, type DistrictId } from "@/lib/districts";
import { reducedMotion } from "@/lib/walkPrefs";

/**
 * Переходы между районами внутри «Прогулки» (PR 3 районов): полоска «Центр · Неон-ряды · Порт» и протяжка за край улицы.
 * Порядок слева направо — DISTRICT_ORDER: Центр — главная (её «Прогулка»), справа от него — Неон-ряды, за ними — Порт.
 *
 * Переход: текущая сцена гаснет (~0.2 с), открывается соседняя, и камера за ~0.6 с проезжает от ближнего края её улицы
 * к центру — будто вы прошли по улице дальше. Без «меньше движения» — мгновенно.
 * Центр — это главная в режиме «Прогулки»: переход в Центр включает «Прогулку» и открывает главную.
 */
export type Dir = -1 | 1;
/** насколько (px) протянуть улицу за край, чтобы перейти к соседу */
export const EDGE_PULL = 72;
/** проезд камеры от края к центру при входе в район */
export const ARRIVE_MS = 600;
/** затухание уходящей сцены */
export const LEAVE_MS = 200;

export const neighbourOf = (p: DistrictId, dir: Dir): DistrictId | null => DISTRICT_ORDER[DISTRICT_ORDER.indexOf(p) + dir] ?? null;
export const dirBetween = (from: DistrictId, to: DistrictId): Dir => (DISTRICT_ORDER.indexOf(to) >= DISTRICT_ORDER.indexOf(from) ? 1 : -1);

/**
 * Протяжка за край: x — сдвиг камеры (+ — улица уехала вправо, видно её левый конец), min/max — границы.
 * Возвращает, к какому соседу тянут (−1 — левый, +1 — правый) и насколько (0…1 от EDGE_PULL).
 */
export function edgePull(x: number, min: number, max: number, pull = EDGE_PULL): { dir: Dir | 0; p: number } {
  if (x > max) return { dir: -1, p: Math.min(1, (x - max) / pull) };
  if (x < min) return { dir: 1, p: Math.min(1, (min - x) / pull) };
  return { dir: 0, p: 0 };
}

/** камера у края улицы (в пределах px) — показать подсказку соседа с этой стороны */
export const nearEdge = (x: number, min: number, max: number, px = 24): { l: boolean; r: boolean } => ({
  l: x >= max - px,
  r: x <= min + px,
});

type Arrival = { dir: Dir };
let arrival: Arrival | null = null;
let busy = false;

/** куда вести: путь экрана для места (Центр — главная) */
export const placePath = (p: DistrictId) => (p === "centre" ? "/" : `/district?d=${p}`);

export const districtNav = {
  /**
   * Перейти из from в to. navigate — из react-router. Возвращает false, если переход уже идёт или идти некуда.
   */
  go(from: DistrictId, to: DistrictId, navigate: (path: string, o?: { replace?: boolean }) => void): boolean {
    if (busy || from === to) return false;
    busy = true;
    arrival = { dir: dirBetween(from, to) };
    const root = document.documentElement;
    const still = reducedMotion();
    const finish = () => {
      if (to === "centre") cityWalk.enter(); // Центр — «Прогулка» на главной
      navigate(placePath(to), { replace: from !== "centre" });
      busy = false;
      requestAnimationFrame(() => root.classList.remove("dz-going"));
    };
    if (still) finish();
    else {
      root.classList.add("dz-going");
      window.setTimeout(finish, LEAVE_MS);
    }
    return true;
  },
  /** вход в сцену: откуда пришли (null — прямой вход: ссылка, кнопка «Прогулка») */
  takeArrival(): Arrival | null {
    const a = arrival;
    arrival = null;
    return a;
  },
  /** для тестов */
  reset() {
    arrival = null;
    busy = false;
    document.documentElement.classList.remove("dz-going");
  },
};

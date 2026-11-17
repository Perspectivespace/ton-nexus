import { create } from "zustand";

/**
 * Знакомство игрока: вводные экраны при первом входе + разовые подсказки в разделах дока.
 * Что уже показано, хранит сервер (GET /me → onboarding, PUT /me/onboarding) — на другом устройстве не повторяется.
 * Отметка на устройстве (onboardingFlag) остаётся запасной: сервер недоступен или запрос не дошёл.
 */
export const HINT_KEYS = ["home", "miner", "earn", "profile"] as const;
export type HintKey = (typeof HINT_KEYS)[number];
export type OnboardingState = { intro_done: boolean; hints: string[] };

const BY_PATH: Record<string, HintKey> = { "/": "home", "/miner": "miner", "/tasks": "earn", "/wallet": "profile" };

/** Подсказка раздела для адреса (только корневые экраны дока) */
export function hintFor(path: string): HintKey | null {
  const p = path.length > 1 ? path.replace(/\/+$/, "") : path;
  return BY_PATH[p] ?? null;
}

/**
 * Показывать ли вводные экраны. Сервер главный; пока /me грузится — ждём (не мигаем знакомством у старых игроков).
 * Сервер не ответил — решает отметка на устройстве. Сервер «не пройдено», а устройство «пройдено» — значит,
 * прошлое сохранение не дошло: не показываем, а досылаем (resync).
 */
export function introDecision(state: OnboardingState | null | undefined, meFailed: boolean, localDone: boolean): "show" | "hide" | "resync" | "wait" {
  if (state) return state.intro_done ? "hide" : localDone ? "resync" : "show";
  if (meFailed) return localDone ? "hide" : "show";
  return "wait";
}

/** Показывать ли подсказку раздела сейчас */
export function hintToShow(path: string, state: OnboardingState | null | undefined, dismissed: ReadonlySet<string>): HintKey | null {
  const k = hintFor(path);
  if (!k || !state || !state.intro_done) return null; // сначала — вводные экраны
  return state.hints.includes(k) || dismissed.has(k) ? null : k;
}

/** «Повторить знакомство» из Профиля: открыть вводные экраны поверх текущего экрана */
export const useOnboardingUi = create<{ replay: boolean; startReplay: () => void; endReplay: () => void }>((set) => ({
  replay: false,
  startReplay: () => set({ replay: true }),
  endReplay: () => set({ replay: false }),
}));

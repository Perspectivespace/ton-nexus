const KEY = "tn-onboarded";

/**
 * Отметка «знакомство пройдено» на этом устройстве. Главное состояние — на сервере (lib/onboarding.ts);
 * отметка нужна, чтобы заранее грузить чанк знакомства и чтобы без сети не показывать его повторно.
 */
export function shouldShowOnboarding() {
  try {
    return localStorage.getItem(KEY) !== "1";
  } catch {
    return false;
  }
}

export function markDone() {
  try {
    localStorage.setItem(KEY, "1");
  } catch {
    /* нет доступа к хранилищу — решает сервер */
  }
}

/** «Повторить знакомство»: снимаем отметку, иначе устройство сочтёт его пройденным и досылать будет «пройдено» */
export function clearDone() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* */
  }
}

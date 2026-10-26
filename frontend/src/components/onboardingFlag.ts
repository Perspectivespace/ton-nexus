const KEY = "tn-onboarded";

/**
 * Знакомство показываем один раз: отметка хранится только на устройстве (localStorage), сервер не трогаем.
 * Флаг — отдельно от экрана знакомства: сам экран (реактор, шкала) — свой чанк, грузится только при первом запуске.
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
    /* нет доступа к хранилищу — покажем ещё раз, это не страшно */
  }
}

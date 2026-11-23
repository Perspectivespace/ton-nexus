/**
 * Минимальный кегль вывесок в городе (PR C по аудиту читаемости). Вывески рисуются в пикселях кадра 720×1280
 * (--u = 1 px кадра), а нижняя граница кегля задаётся в пикселях экрана: 9.5 px у названия рекламы, 10 px у табло.
 * --sign-px — сколько пикселей кадра приходится на 1 px экрана на улице (ширина сцены = min(100vw, 560px)).
 * Превью на экране покупки — тот же кадр крупнее: кегль в пикселях кадра тот же, значит пропорции как на улице.
 */
export const SIGN_MIN_PX = { title: 9.5, line: 10 } as const;

export function signPx(width: number): number {
  return 720 / Math.min(Math.max(width, 320), 560);
}

export function initSignScale(): void {
  if (typeof window === "undefined") return;
  const set = () => document.documentElement.style.setProperty("--sign-px", signPx(window.innerWidth).toFixed(3));
  set();
  window.addEventListener("resize", set, { passive: true });
}

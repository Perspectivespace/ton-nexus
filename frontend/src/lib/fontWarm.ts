/**
 * Прогрев начертаний, которых нет на главной, но есть в разделах (майнер: Onest 600 — подписи и цифры плиток).
 * Без прогрева файл шрифта качается в момент первого показа раздела, а по приходу (font-display: swap)
 * браузер заново раскладывает всю страницу — «Fonts changed» на сотнях узлов реактора прямо во время наезда камеры.
 * document.fonts.load сам ничего не перерисовывает: только скачивает и регистрирует начертание.
 * Пример текста — латиница + кириллица + цифры, чтобы подтянулись оба нужных поднабора unicode-range.
 */
const FACES = ["600 16px Onest", "700 16px Onest"];
const SAMPLE = "Aa Яя 0123456789";

let started: Promise<void> | null = null;
export function warmFonts(): Promise<void> {
  if (started) return started;
  const fonts = typeof document !== "undefined" ? document.fonts : undefined;
  if (!fonts?.load) return (started = Promise.resolve());
  started = Promise.all(FACES.map((f) => fonts.load(f, SAMPLE).catch(() => []))).then(() => undefined);
  return started;
}

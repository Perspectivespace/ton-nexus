/**
 * Счётчик FPS (включается через lib/fps.ts). Маленькая плашка в углу: текущий / средний / минимальный FPS
 * и число долгих задач (> 50 мс, где браузер их отдаёт — Android/Chrome; в iOS «—»).
 * Раз в 10 с — сводка в консоль. Сам счётчик — один requestAnimationFrame и textContent раз в 500 мс,
 * без CSS-анимаций и без влияния на вёрстку (pointer-events: none).
 */
type Sum = { frames: number; ms: number; worst: number; janks: number; long: number; minFps: number };

/** чем выключить запущенный счётчик (переключатель в кабинете владельца) */
let stopCurrent: (() => void) | null = null;

export function stopFpsMeter() {
  stopCurrent?.();
  stopCurrent = null;
}

export function startFpsMeter() {
  if ((window as { __fpsOn?: boolean }).__fpsOn) return;
  (window as { __fpsOn?: boolean }).__fpsOn = true;
  let raf = 0;
  let observer: PerformanceObserver | null = null;

  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText =
    "position:fixed;z-index:2147483647;left:calc(env(safe-area-inset-left,0px) + 6px);top:calc(env(safe-area-inset-top,0px) + var(--tg-content-safe-area-inset-top,0px) + 6px);" +
    "pointer-events:none;padding:4px 7px;font:600 11px/14px ui-monospace,Menlo,monospace;color:#9fffc8;background:rgba(4,6,12,.82);" +
    "border:1px solid rgba(120,255,190,.35);white-space:pre;contain:layout paint;";
  document.body.appendChild(el);

  let long = 0;
  let longSupported = false;
  try {
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      observer = new PerformanceObserver((l) => {
        long += l.getEntries().length;
        win.long += l.getEntries().length;
      });
      observer.observe({ type: "longtask", buffered: false });
      longSupported = true;
    }
  } catch {
    /* */
  }

  // всё время с включения; «окно» — последние 10 с для сводки в консоль
  const total: Sum = { frames: 0, ms: 0, worst: 0, janks: 0, long: 0, minFps: Infinity };
  let win: Sum = { frames: 0, ms: 0, worst: 0, janks: 0, long: 0, minFps: Infinity };
  let secFrames = 0;
  let secStart = 0;
  let last = 0;
  let cur = 0;
  let lastPaint = 0;
  let lastLog = performance.now();

  const show = (now: number) => {
    lastPaint = now;
    const avg = total.ms ? (total.frames * 1000) / total.ms : 0;
    const min = Number.isFinite(total.minFps) ? total.minFps : cur;
    el.textContent = `FPS ${cur.toFixed(0).padStart(3)}  ср ${avg.toFixed(0)}  мин ${min.toFixed(0)}\nдолгих задач ${longSupported ? long : "—"}`;
  };

  const log = (now: number) => {
    lastLog = now;
    if (!win.ms) return;
    const avg = (win.frames * 1000) / win.ms;
    console.info(
      `[fps] 10 с: ср ${avg.toFixed(1)}, мин ${Number.isFinite(win.minFps) ? win.minFps.toFixed(0) : "—"}, ` +
        `худший кадр ${win.worst.toFixed(0)} мс, кадров > 50 мс ${win.janks}, долгих задач ${longSupported ? win.long : "—"}`,
    );
    (window as { __fps?: unknown }).__fps = { avg, min: win.minFps, worst: win.worst, janks: win.janks, long: win.long, total: { avg: (total.frames * 1000) / total.ms, min: total.minFps, long } };
    win = { frames: 0, ms: 0, worst: 0, janks: 0, long: 0, minFps: Infinity };
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!last) {
      last = secStart = now;
      return;
    }
    const dt = now - last;
    last = now;
    for (const s of [total, win]) {
      s.frames++;
      s.ms += dt;
      if (dt > s.worst) s.worst = dt;
      if (dt > 50) s.janks++;
    }
    secFrames++;
    // текущий FPS — по полусекундам, минимальный — худшая полусекунда
    if (now - secStart >= 500) {
      cur = (secFrames * 1000) / (now - secStart);
      if (cur < total.minFps) total.minFps = cur;
      if (cur < win.minFps) win.minFps = cur;
      secFrames = 0;
      secStart = now;
    }
    if (now - lastPaint >= 500) show(now);
    if (now - lastLog >= 10_000) log(now);
  };
  // свёрнутое приложение не считаем: после возврата начинаем отсчёт кадров заново
  const onVisibility = () => {
    last = 0;
    secFrames = 0;
  };
  document.addEventListener("visibilitychange", onVisibility);
  raf = requestAnimationFrame(frame);

  stopCurrent = () => {
    cancelAnimationFrame(raf);
    observer?.disconnect();
    document.removeEventListener("visibilitychange", onVisibility);
    el.remove();
    (window as { __fpsOn?: boolean }).__fpsOn = false;
  };
}

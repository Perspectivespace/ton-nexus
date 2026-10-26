/**
 * Счётчик FPS (включается через lib/fps.ts). Маленькая плашка в углу:
 *   FPS текущий · ср средний · мин худшая секунда
 *   долгих задач N · макс — самая долгая (> 50 мс; где браузер отдаёт — Android/Chrome, в iOS «—») и где была
 *   худший кадр — самый длинный промежуток между кадрами, на каком экране и сколько секунд назад
 * Чтобы цифры не врали:
 *   — первую секунду после включения и после возврата в приложение не считаем (там идёт отрисовка самого экрана);
 *   — промежуток между кадрами > 1 с — это пауза (WebView Telegram останавливает кадры без visibilitychange,
 *     например под всплывающим окном), а не рывок: в ср/мин не идёт, а отдельной строкой «пауз N · макс …»;
 *   — «мин» — худшая целая секунда (была худшая полусекунда: один рывок 400 мс давал «мин 5»).
 * Раз в 10 с — сводка в консоль и window.__fps. Сам счётчик — один requestAnimationFrame и textContent раз в 500 мс,
 * без CSS-анимаций и без влияния на вёрстку (pointer-events: none).
 */
type Sum = { frames: number; ms: number; worst: number; janks: number; long: number; minFps: number };
type Spot = { ms: number; at: number; path: string };

const WARMUP_MS = 1000;
const PAUSE_MS = 1000;
const WINDOW_MS = 1000;

const here = () => location.pathname;
const ago = (now: number, at: number) => `${Math.max(0, Math.round((now - at) / 1000))} с назад`;

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
  /** самая долгая задача с начала: длительность, когда и на каком экране */
  let longMax: Spot | null = null;
  try {
    if (PerformanceObserver.supportedEntryTypes?.includes("longtask")) {
      observer = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) {
          long++;
          win.long++;
          if (!longMax || e.duration > longMax.ms) longMax = { ms: e.duration, at: e.startTime, path: here() };
        }
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
  let worst: Spot | null = null;
  let pauses = 0;
  /** самая длинная пауза (> 1 с без кадров): в ср/мин не идёт, но видна на плашке — вдруг это всё же зависание */
  let pauseMax: Spot | null = null;
  let secFrames = 0;
  let secStart = 0;
  let curFrames = 0;
  let curStart = 0;
  let last = 0;
  /** до этого момента кадры не считаем (разгон после включения / возврата в приложение) */
  let countFrom = 0;
  let cur = 0;
  let lastPaint = 0;
  let lastLog = performance.now();

  const show = (now: number) => {
    lastPaint = now;
    const avg = total.ms ? (total.frames * 1000) / total.ms : cur;
    const min = Number.isFinite(total.minFps) ? total.minFps.toFixed(0) : "—";
    const lt = !longSupported ? "долгих задач —" : `долгих задач ${long}${longMax ? ` · макс ${longMax.ms.toFixed(0)} мс ${longMax.path}` : ""}`;
    const wf = worst ? `худший кадр ${worst.ms.toFixed(0)} мс · ${worst.path} · ${ago(now, worst.at)}` : "худший кадр —";
    const pz = pauseMax ? `\nпауз ${pauses} · макс ${(pauseMax.ms / 1000).toFixed(1)} с · ${pauseMax.path} · ${ago(now, pauseMax.at)}` : "";
    el.textContent = `FPS ${cur.toFixed(0).padStart(3)}  ср ${avg.toFixed(0)}  мин ${min}\n${lt}\n${wf}${pz}`;
  };

  const log = (now: number) => {
    lastLog = now;
    if (!win.ms) return;
    const avg = (win.frames * 1000) / win.ms;
    console.info(
      `[fps] 10 с: ср ${avg.toFixed(1)}, мин ${Number.isFinite(win.minFps) ? win.minFps.toFixed(0) : "—"}, ` +
        `худший кадр ${win.worst.toFixed(0)} мс, кадров > 50 мс ${win.janks}, долгих задач ${longSupported ? win.long : "—"}, пауз > 1 с ${pauses}`,
    );
    (window as { __fps?: unknown }).__fps = {
      avg,
      min: win.minFps,
      worst: win.worst,
      janks: win.janks,
      long: win.long,
      total: { avg: total.ms ? (total.frames * 1000) / total.ms : 0, min: total.minFps, long, worstFrame: worst, longMax, pauses, pauseMax },
    };
    win = { frames: 0, ms: 0, worst: 0, janks: 0, long: 0, minFps: Infinity };
  };

  const restart = (now: number) => {
    last = secStart = curStart = now;
    secFrames = curFrames = 0;
    countFrom = now + WARMUP_MS;
  };

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    if (!last) return restart(now);
    const dt = now - last;
    if (dt > PAUSE_MS) {
      // кадров не было больше секунды — пауза WebView, а не рывок; считаем заново, с разгоном
      pauses++;
      if (!pauseMax || dt > pauseMax.ms) pauseMax = { ms: dt, at: now, path: here() };
      return restart(now);
    }
    last = now;
    // текущий FPS — по полусекундам, всегда (и в разгон)
    curFrames++;
    if (now - curStart >= 500) {
      cur = (curFrames * 1000) / (now - curStart);
      curFrames = 0;
      curStart = now;
    }
    if (now < countFrom) {
      secFrames = 0;
      secStart = now;
    } else {
      for (const s of [total, win]) {
        s.frames++;
        s.ms += dt;
        if (dt > s.worst) s.worst = dt;
        if (dt > 50) s.janks++;
      }
      if (!worst || dt > worst.ms) worst = { ms: dt, at: now, path: here() };
      secFrames++;
      // минимальный — худшая целая секунда
      if (now - secStart >= WINDOW_MS) {
        const fps = (secFrames * 1000) / (now - secStart);
        if (fps < total.minFps) total.minFps = fps;
        if (fps < win.minFps) win.minFps = fps;
        secFrames = 0;
        secStart = now;
      }
    }
    if (now - lastPaint >= 500) show(now);
    if (now - lastLog >= 10_000) log(now);
  };
  // свёрнутое приложение не считаем: после возврата начинаем отсчёт кадров заново (с разгоном)
  const onVisibility = () => {
    last = 0;
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

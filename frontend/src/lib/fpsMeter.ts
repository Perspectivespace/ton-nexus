/**
 * Счётчик FPS (включается через lib/fps.ts). Маленькая плашка в углу:
 *   FPS текущий · ср средний · мин худшая секунда
 *   долгих задач N · макс — самая долгая (> 50 мс; где браузер отдаёт — Android/Chrome, в iOS «—») и где была
 *   худший кадр — самый длинный промежуток между кадрами, на каком экране и сколько секунд назад
 *   кнопка «копировать отчёт» — всё то же подробно + что делал худший кадр (Long Animation Frames, где браузер отдаёт),
 *   и сведения об устройстве: текст можно вставить в чат
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
/** кадр, который тянулся долго (Long Animation Frames): что в нём исполнялось */
type Loaf = { at: number; dur: number; block: number; render: number; layout: number; scripts: string[] };

const WARMUP_MS = 1000;
const PAUSE_MS = 1000;
const WINDOW_MS = 1000;

const here = () => location.pathname;
const ago = (now: number, at: number) => `${Math.max(0, Math.round((now - at) / 1000))} с назад`;

type LoafEntry = PerformanceEntry & {
  blockingDuration?: number;
  renderStart?: number;
  styleAndLayoutStart?: number;
  scripts?: Array<{
    invoker?: string;
    invokerType?: string;
    sourceURL?: string;
    sourceFunctionName?: string;
    duration: number;
    forcedStyleAndLayoutDuration: number;
    pauseDuration: number;
  }>;
};

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
    "border:1px solid rgba(120,255,190,.35);contain:layout paint;";
  const txt = document.createElement("div");
  txt.style.cssText = "white-space:pre-wrap;max-width:calc(100vw - 32px);overflow-wrap:anywhere;";
  // единственное, что ловит касания: маленькая кнопка внизу плашки (остальное — pointer-events: none)
  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "копировать отчёт";
  copyBtn.style.cssText =
    "pointer-events:auto;touch-action:manipulation;margin-top:3px;padding:3px 6px;font:inherit;color:#04060c;background:#9fffc8;border:0;border-radius:3px;";
  el.append(txt, copyBtn);
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

  // Long Animation Frames (Chrome 123+): что исполнялось в долгом кадре — скрипт, вызвавший его, и сколько он тянул
  const loafs: Loaf[] = [];
  let loafObserver: PerformanceObserver | null = null;
  try {
    if (PerformanceObserver.supportedEntryTypes?.includes("long-animation-frame")) {
      loafObserver = new PerformanceObserver((l) => {
        for (const e of l.getEntries() as unknown as LoafEntry[]) {
          const scripts = [...(e.scripts ?? [])]
            .sort((a, b) => b.duration - a.duration)
            .slice(0, 3)
            .map((x) => {
              const file = (x.sourceURL || "").split("/").pop()?.split("?")[0] ?? "";
              const fn = x.sourceFunctionName ? `:${x.sourceFunctionName}` : "";
              const extra = [
                x.forcedStyleAndLayoutDuration > 1 ? `раскладка ${x.forcedStyleAndLayoutDuration.toFixed(0)}` : "",
                x.pauseDuration > 1 ? `синхр. вызов ${x.pauseDuration.toFixed(0)}` : "",
              ].filter(Boolean);
              return `${x.invokerType ?? ""} ${x.invoker ?? ""} ${file}${fn} ${x.duration.toFixed(0)} мс${extra.length ? ` (${extra.join(", ")})` : ""}`.trim();
            });
          loafs.push({
            at: e.startTime,
            dur: e.duration,
            block: e.blockingDuration ?? 0,
            render: e.renderStart ? e.renderStart - e.startTime : 0,
            layout: e.styleAndLayoutStart ? e.styleAndLayoutStart - e.startTime : 0,
            scripts,
          });
          if (loafs.length > 150) loafs.shift();
        }
      });
      loafObserver.observe({ type: "long-animation-frame", buffered: true });
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

  const loafText = (l: Loaf) =>
    `  кадр ${l.dur.toFixed(0)} мс · блок ${l.block.toFixed(0)}` +
    `${l.layout ? ` · стиль+раскладка с +${l.layout.toFixed(0)}` : ""}${l.render ? ` · отрисовка с +${l.render.toFixed(0)}` : ""}` +
    l.scripts.map((x) => `\n    ${x}`).join("");

  /** текст отчёта: вставить в чат как есть */
  const buildReport = (now: number) => {
    const out: string[] = [];
    const nav = navigator as Navigator & { connection?: { effectiveType?: string; rtt?: number; downlink?: number; saveData?: boolean }; deviceMemory?: number };
    const tg = (window as { Telegram?: { WebApp?: { platform?: string; version?: string } } }).Telegram?.WebApp;
    const c = nav.connection;
    const build = [...document.scripts].map((s) => s.src.split("/").pop()).find((n) => n?.startsWith("index")) ?? "—";
    out.push(`TON Nexus · отчёт счётчика FPS · ${new Date().toLocaleString("ru-RU")}`);
    out.push(`сборка ${build} · ${here()}`);
    out.push(
      `экран ${innerWidth}×${innerHeight} @${devicePixelRatio} · ядер ${nav.hardwareConcurrency ?? "—"} · память ${nav.deviceMemory ?? "—"} ГБ · ` +
        `сеть ${c ? `${c.effectiveType} rtt ${c.rtt} мс ${c.downlink} Мбит/с${c.saveData ? " экономия" : ""}` : "—"} · ` +
        `Telegram ${tg?.platform ?? "—"} ${tg?.version ?? ""} · тема ${document.documentElement.dataset.theme ?? "—"}${document.documentElement.classList.contains("low-end") ? " · low-end" : ""}`,
    );
    out.push(txt.textContent?.split("\n").slice(0, 4).join(" | ") ?? "");
    // что делал худший кадр
    if (worst) {
      const from = worst.at - worst.ms;
      const hit = loafs
        .map((l) => ({ l, o: Math.min(l.at + l.dur, worst!.at) - Math.max(l.at, from) }))
        .filter((x) => x.o > 0)
        .sort((a, b) => b.o - a.o)[0];
      out.push(`худший кадр ${worst.ms.toFixed(0)} мс, ${ago(now, worst.at)}:`);
      out.push(
        hit
          ? loafText(hit.l)
          : worst.ms <= 50
            ? "  обычный кадр, долгих нет"
            : loafOn
              ? "  Long Animation Frames: в этом кадре долгих скриптов нет (ждал не JS: отрисовка, мост Telegram, сеть)"
              : "  Long Animation Frames этим браузером не отдаются",
      );
    }
    return out.join("\n");
  };
  const loafOn = !!loafObserver;
  (window as { __fpsReport?: () => string }).__fpsReport = () => buildReport(performance.now());

  /** копирование: буфер обмена → execCommand → окно с текстом, который можно выделить и скопировать руками */
  const copyReport = async () => {
    const text = buildReport(performance.now());
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.cssText = "position:fixed;left:0;top:0;opacity:0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        ta.remove();
      } catch {
        /* */
      }
    }
    if (ok) {
      copyBtn.textContent = "скопировано ✓";
      window.setTimeout(() => (copyBtn.textContent = "копировать отчёт"), 2000);
      return;
    }
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgba(4,6,12,.96);padding:10px;display:flex;flex-direction:column;gap:8px;";
    const ta = document.createElement("textarea");
    ta.readOnly = true;
    ta.value = text;
    ta.style.cssText = "flex:1;font:11px/14px ui-monospace,Menlo,monospace;color:#9fffc8;background:#04060c;border:1px solid rgba(120,255,190,.35);";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "закрыть (выделите текст и скопируйте)";
    close.style.cssText = "padding:10px;font:600 13px system-ui;color:#04060c;background:#9fffc8;border:0;border-radius:6px;";
    close.onclick = () => box.remove();
    box.append(ta, close);
    document.body.appendChild(box);
    ta.focus();
    ta.select();
  };
  copyBtn.addEventListener("click", () => void copyReport());

  const show = (now: number) => {
    lastPaint = now;
    const avg = total.ms ? (total.frames * 1000) / total.ms : cur;
    const min = Number.isFinite(total.minFps) ? total.minFps.toFixed(0) : "—";
    const lt = !longSupported ? "долгих задач —" : `долгих задач ${long}${longMax ? ` · макс ${longMax.ms.toFixed(0)} мс ${longMax.path}` : ""}`;
    const wf = worst ? `худший кадр ${worst.ms.toFixed(0)} мс · ${worst.path} · ${ago(now, worst.at)}` : "худший кадр —";
    const pz = pauseMax ? `\nпауз ${pauses} · макс ${(pauseMax.ms / 1000).toFixed(1)} с · ${pauseMax.path} · ${ago(now, pauseMax.at)}` : "";
    txt.textContent = `FPS ${cur.toFixed(0).padStart(3)}  ср ${avg.toFixed(0)}  мин ${min}\n${lt}\n${wf}${pz}`;
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
    loafObserver?.disconnect();
    delete (window as { __fpsReport?: () => string }).__fpsReport;
    document.removeEventListener("visibilitychange", onVisibility);
    el.remove();
    (window as { __fpsOn?: boolean }).__fpsOn = false;
  };
}

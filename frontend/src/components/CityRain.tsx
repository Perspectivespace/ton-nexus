import { useEffect, useRef, type CSSProperties } from "react";
import type { CityPhase } from "@/lib/cityPhase";

/**
 * Дождь и брызги на мокрой площади (DESIGN.md п. 12.1). Всё рисуется ОДИН раз в canvas-спрайты
 * (при монтировании, смене фазы/облика и размера сцены), дальше двигается только transform на компоновщике.
 *
 * Дождь — три глубины (дальняя / средняя / ближняя) и ОДНА бесконечная анимация:
 *  - `.rain` повёрнут на угол ветра и задаёт перспективу; `.rain-mv` едет вниз на период ближнего слоя;
 *  - слои стоят на разной глубине (translateZ) и масштабом возвращены к своему размеру, поэтому
 *    смещение родителя проецируется на них с коэффициентом 1 / 0.6 / 0.4 — дальние капли медленнее
 *    (параллакс) без лишних анимаций. Период узора каждого слоя = его доле смещения → петля бесшовная.
 *  - капли — штрихи с градиентным «хвостом» (размытие движения): дальние тонкие, бледные и короткие,
 *    ближние длиннее и ярче; часть ближних ловит неон (бирюза / маджента).
 * Брызги — лист кадров (20 × 80 мс) в окне над площадью, `steps()` по transform: короткая «корона» и
 * расходящийся эллипс в перспективе. Тоже одна анимация (на T1–T3; на T4 бюджет занят).
 *
 * Canvas-текстура хранится в своём разрешении (×1–1.25 к CSS-пикселю), а не ×DPR², — на DPR 2.6 памяти
 * меньше, чем у прежнего градиентного дождя. На слабом устройстве и при «уменьшить движение» не рисуется.
 */

const P = 1000; // перспектива, px
const LAYERS = [
  // доля скорости, период узора (px, по вертикали), капель на 100 px ширины, длина, толщина, яркость
  { f: 0.4, per: 192, dens: 13, len: [9, 18], w: 0.8, a: 0.3 },
  { f: 0.6, per: 288, dens: 9, len: [20, 36], w: 1.1, a: 0.42 },
  { f: 1, per: 480, dens: 4.2, len: [40, 78], w: 1.7, a: 0.55 },
] as const;
const SPLASH_FRAMES = 20;

type Rgb = [number, number, number];
const TINT: Record<CityPhase, Rgb> = {
  night: [176, 212, 255],
  dusk: [255, 214, 232],
  dawn: [255, 240, 248],
  day: [236, 246, 255],
};
const NEON: Rgb[] = [
  [120, 244, 255],
  [255, 120, 214],
];

/** детерминированный ГСЧ: один и тот же узор при каждой перерисовке */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const lowEnd = () => document.documentElement.classList.contains("low-end");
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
/** во сколько раз canvas подробнее CSS-пикселя: периоды 192/288/480 × 1.25 — целые, петля без шва */
const density = () => ((window.devicePixelRatio || 1) >= 1.75 && ((navigator as { deviceMemory?: number }).deviceMemory ?? 8) > 4 ? 1.25 : 1);

const idle = (f: () => void) =>
  "requestIdleCallback" in window ? requestIdleCallback(f, { timeout: 400 }) : setTimeout(f, 16);

function rgba([r, g, b]: Rgb, a: number) {
  return `rgba(${r},${g},${b},${a})`;
}

/** спрайт одной капли: градиентный хвост + мягкий ореол; дальше капли — это drawImage с растяжкой по длине */
function dropSprite(c: Rgb, w: number, len: number, k: number) {
  const pad = Math.ceil(w * 1.6 * k);
  const cv = document.createElement("canvas");
  cv.width = pad * 2 + Math.ceil(w * k);
  cv.height = Math.ceil(len * k);
  const g = cv.getContext("2d");
  if (!g) return cv;
  const x = cv.width / 2;
  const grad = g.createLinearGradient(0, 0, 0, cv.height);
  grad.addColorStop(0, rgba(c, 0));
  grad.addColorStop(0.7, rgba(c, 0.55));
  grad.addColorStop(1, rgba(c, 1));
  g.strokeStyle = grad;
  g.lineCap = "round";
  g.globalAlpha = 0.35;
  g.lineWidth = w * 2.6 * k;
  g.beginPath();
  g.moveTo(x, 0);
  g.lineTo(x, cv.height - (w * k) / 2);
  g.stroke();
  g.globalAlpha = 1;
  g.lineWidth = w * k;
  g.stroke();
  return cv;
}

function drawLayer(cv: HTMLCanvasElement, wCss: number, hCss: number, li: number, phase: CityPhase) {
  const L = LAYERS[li];
  const k = density();
  cv.width = Math.round(wCss * k);
  cv.height = Math.round(hCss * k);
  cv.style.width = `${cv.width / k}px`;
  cv.style.height = `${cv.height / k}px`;
  const g = cv.getContext("2d");
  if (!g) return;
  const day = phase === "day" || phase === "dawn";
  const colors = day || li === 0 ? [TINT[phase]] : [TINT[phase], ...NEON];
  const sprites = colors.map((c) => dropSprite(c, L.w, L.len[1], k));
  const r = rng(7 + li * 101);
  const n = Math.round((wCss / 100) * L.dens * (L.per / 192));
  for (let i = 0; i < n; i++) {
    const x = r() * wCss;
    const y0 = r() * L.per; // голова капли внутри периода
    const len = L.len[0] + r() * (L.len[1] - L.len[0]);
    const a = L.a * (0.55 + r() * 0.45) * (day ? 1.15 : 1);
    const ci = colors.length > 1 && r() < 0.1 ? 1 + Math.floor(r() * 2) : 0; // часть капель ловит неон
    const sp = sprites[ci];
    const sw = sp.width * (0.8 + r() * 0.4);
    g.globalAlpha = Math.min(1, a);
    // повторяем каплю с периодом по всей высоте (плюс период сверху — хвосты на стыке)
    for (let y = y0 - L.per; y < hCss + L.len[1]; y += L.per) {
      g.drawImage(sp, x * k - sw / 2, (y - len) * k, sw, len * k);
    }
  }
}

/** лист кадров брызг: кадры друг под другом, каждый — окно wCss × hCss над площадью */
function drawSplashes(cv: HTMLCanvasElement, wCss: number, hCss: number, phase: CityPhase) {
  const k = Math.min(1, 4000 / (hCss * SPLASH_FRAMES)); // лист не выше 4000 px — влезает в текстуру GPU
  cv.width = Math.round(wCss * k);
  cv.height = Math.round(hCss * k) * SPLASH_FRAMES;
  const g = cv.getContext("2d");
  if (!g) return;
  const fh = cv.height / SPLASH_FRAMES;
  const day = phase === "day" || phase === "dawn";
  const c: Rgb = day ? [255, 255, 255] : [190, 222, 255];
  const r = rng(4242);
  const LIFE = 5;
  const COUNT = 36;
  for (let i = 0; i < COUNT; i++) {
    // глубина площади: v=0 — дальний край (выше, мельче, площе), v=1 — у зрителя
    const v = r();
    const x = r() * cv.width;
    const y = (0.06 + v * 0.86) * fh;
    const size = (2.5 + v * 8) * k * (0.7 + r() * 0.6);
    const start = Math.floor(r() * SPLASH_FRAMES);
    const near = !day && r() < 0.2 ? NEON[Math.floor(r() * 2)] : c;
    for (let t = 0; t < LIFE; t++) {
      const fr = (start + t) % SPLASH_FRAMES;
      const cy = fr * fh + y;
      g.save();
      g.beginPath();
      g.rect(0, fr * fh, cv.width, fh);
      g.clip();
      if (t === 0) {
        // «корона»: короткий всплеск и пара капель вверх
        g.fillStyle = rgba(near, 0.55);
        g.fillRect(x - 0.5 * k, cy - size * 0.55, 1.2 * k, size * 0.5);
        g.fillRect(x - size * 0.35, cy - size * 0.35, 1.1 * k, 1.1 * k);
        g.fillRect(x + size * 0.3, cy - size * 0.42, 1.1 * k, 1.1 * k);
      }
      const p = (t + 0.6) / LIFE;
      const rx = size * (0.35 + p * 1.3);
      const ry = rx * (0.16 + v * 0.12);
      const a = 0.5 * (1 - p) + 0.06;
      // мягкий ореол + тонкое кольцо; со второго кадра — внутреннее кольцо поменьше
      g.lineWidth = Math.max(1, 2.6 * k);
      g.strokeStyle = rgba(near, a * 0.2);
      g.beginPath();
      g.ellipse(x, cy, rx, ry, 0, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = Math.max(0.7, 0.9 * k);
      g.strokeStyle = rgba(near, a);
      g.stroke();
      if (t >= 2) {
        g.strokeStyle = rgba(near, a * 0.6);
        g.beginPath();
        g.ellipse(x, cy, rx * 0.55, ry * 0.55, 0, 0, Math.PI * 2);
        g.stroke();
      }
      g.restore();
    }
  }
}

export function CityRain({ phase, tier }: { phase: CityPhase; tier: number }) {
  const host = useRef<HTMLDivElement>(null);
  const layers = useRef<(HTMLCanvasElement | null)[]>([]);
  const splash = useRef<HTMLCanvasElement>(null);
  const off = lowEnd() || reduced();
  const withSplash = tier <= 3;

  useEffect(() => {
    const el = host.current;
    const stage = el?.parentElement;
    if (!el || !stage) return;
    let last = "";
    let dead = false;
    const paint = () => {
      const w = stage.clientWidth;
      const h = stage.clientHeight;
      if (!w || !h) return;
      const key = `${w}x${h}`;
      if (key === last) return;
      last = key;
      // .rain повёрнут: его коробка больше сцены (140% × 114%), слои ниже — на период длиннее.
      // Рисуем по одному слою в простое браузера — без длинной задачи на старте.
      const rw = Math.ceil(w * 1.4);
      const rh = Math.ceil(h * 1.14);
      const jobs: (() => void)[] = LAYERS.map((L, i) => () => {
        const cv = layers.current[i];
        if (cv) drawLayer(cv, rw, rh + L.per + L.len[1], i, phase);
      });
      jobs.push(() => {
        const sp = splash.current;
        if (sp) drawSplashes(sp, w, h * (240 / 1280), phase);
      });
      const run = () => {
        const job = jobs.shift();
        if (!job || dead) return;
        job();
        idle(run);
      };
      idle(run);
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(stage);
    return () => {
      dead = true;
      ro.disconnect();
    };
  }, [phase, withSplash]);

  if (off) return null;
  return (
    <>
      <div ref={host} className="rain" aria-hidden>
        <div className="rain-mv">
          {LAYERS.map((L, i) => (
            <canvas
              key={i}
              ref={(c) => {
                layers.current[i] = c;
              }}
              className={`rl rl${i}`}
              style={
                {
                  top: `-${L.per}px`,
                  transformOrigin: `50% calc(50% + ${(L.per - L.len[1]) / 2}px)`,
                  transform: `translateZ(${(-P * (1 / L.f - 1)).toFixed(2)}px) scale(${(1 / L.f).toFixed(5)})`,
                } as CSSProperties
              }
            />
          ))}
        </div>
      </div>
      {withSplash && (
        <div className="puddle" aria-hidden>
          <canvas ref={splash} />
        </div>
      )}
    </>
  );
}


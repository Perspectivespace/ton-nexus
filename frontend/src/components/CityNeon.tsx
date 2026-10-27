import { useEffect, useRef } from "react";
import type { CityPhase } from "@/lib/cityPhase";

/**
 * Неоновые вывески и голограмма над крышами (DESIGN.md п. 12.1, «Неон»).
 * - Вывески — «трубки»: штриховые глифы (свой мини-шрифт из путей SVG, без шрифтов и без tofu),
 *   ореол из нескольких мазков разной ширины, белое ядро. Рисуются в canvas ОДИН раз (смена размера),
 *   по частям в простое браузера. Под светом — тёмная стеклянная трубка: днём вывески «выключены» и видны.
 * - Голограмма — оригинальная стилизованная девушка в профиль (каре, высокий воротник), полупрозрачная
 *   бирюза/маджента, статичные сканлайны, луч проектора с крыши.
 * - Жизнь — без CSS-анимаций: редкие короткие смены состояния (opacity / transform) по таймерам:
 *   мигание, «больная» жужжащая трубка, вывеска, загорающаяся по букве, глитч голограммы.
 *   Бюджет бесконечных анимаций не меняется. Пауза, когда приложение скрыто; «уменьшить движение» и
 *   слабое устройство — всё горит статично; днём — статично и тускло.
 */
const W = 720;
const H = 1280;
type Rgb = [number, number, number];
type Kind = "seq" | "buzz" | "flick" | "chase" | "still";
type Sign = {
  id: string;
  from: number; // с какого облика города
  x: number;
  y: number;
  s: number; // масштаб глифа: ячейка 10 × 14 → s px кадра на единицу
  v?: boolean; // вертикальная
  glyphs: string[];
  c: Rgb;
  kind: Kind;
  frame?: boolean; // трубка-рамка вокруг
  buzz?: number; // какая буква «больная»
};

// штриховой мини-шрифт: ячейка 10 × 14, пути SVG (трубки — линии, концы скруглены)
const G: Record<string, string> = {
  О: "M5 1C9 1 9.5 4 9.5 7S9 13 5 13 .5 10 .5 7 1 1 5 1Z",
  Т: "M.5 1H9.5M5 1V13",
  Е: "M9 1H1.5V13H9M1.5 7H7",
  Л: "M1 13C2.6 12 3.2 9 3.2 1H9V13",
  Ь: "M1.8 1V13H6C9.6 13 9.6 7 6 7H1.8",
  Б: "M9 1H1.8V13H6C9.6 13 9.6 7 6 7H1.8",
  А: "M.6 13 5 1l4.4 12M2.3 8.6h5.4",
  Р: "M1.8 13V1H6c3.6 0 3.6 6.6 0 6.6H1.8",
  "2": "M1.2 4C1.4 .6 8.6.6 8.6 4.2 8.6 7 1.2 9.6 1.2 13H8.8",
  "4": "M7 13V1L.8 9.4H9.2",
  // катакана ラーメン (вертикально: «ー» — вертикальная черта)
  ラ: "M2.4 1.6H7.6M1.2 5H8.8C8.6 9.2 6.4 12 2.2 13.4",
  ー: "M5 1.2V12.8",
  メ: "M7.6 1.4C6.8 7 4.6 10.6 1 13M3 5.6l5.6 6",
  ン: "M2 2.4 4.2 4.6M1.4 12.6C5 11.6 7.6 9 9 3.4",
  // кандзи 光 — «свет»
  光: "M5 .8V6.2M2 2.2l1.2 2.8M8 2.2 6.8 5M.8 7.2h8.4M3.8 7.2C3.8 11 3 12.6.8 13.4M6.2 7.2V12c0 1.2.6 1.4 2.8 1.4V11.8",
  // абстракция: шеврон и крест
  "›": "M1.4 2 5 5.4 8.6 2",
  "+": "M5 2.5V11.5M.5 7H9.5",
};

export const SIGNS: Sign[] = [
  // ОТЕЛЬ — вертикаль на дальнем левом корпусе, загорается по букве
  { id: "hotel", from: 1, x: 14, y: 602, s: 1.9, v: true, glyphs: ["О", "Т", "Е", "Л", "Ь"], c: [255, 74, 92], kind: "seq" },
  // БАР — над крышей низкого дома, «А» — больная трубка: жужжит и сбоит
  { id: "bar", from: 1, x: 204, y: 648, s: 1.35, glyphs: ["Б", "А", "Р"], c: [255, 66, 206], kind: "buzz", buzz: 1 },
  // ラーメン — вертикаль на узком доме справа от башни, изредка моргает
  { id: "ramen", from: 2, x: 529, y: 690, s: 1.55, v: true, glyphs: ["ラ", "ー", "メ", "ン"], c: [70, 236, 255], kind: "flick" },
  // 光 в рамке — на углу правого корпуса
  { id: "hikari", from: 2, x: 658, y: 640, s: 2.4, glyphs: ["光"], c: [196, 120, 255], kind: "flick", frame: true },
  // шевроны — бегущая стрелка вниз (раз в несколько секунд), абстракция
  { id: "chev", from: 3, x: 697, y: 706, s: 1.25, v: true, glyphs: ["›", "›", "›", "›"], c: [255, 186, 64], kind: "chase" },
  // аптечный крест и «24» — ровный зелёный свет
  { id: "cross", from: 2, x: 150, y: 728, s: 1.5, glyphs: ["+", "2", "4"], c: [70, 255, 150], kind: "still" },
];

// голограмма: коробка в кадре и проектор на крыше низкого дома
export const HOLO = { x: 164, y: 338, w: 140, h: 280, px: 233, py: 612 };

const lowEnd = () => document.documentElement.classList.contains("low-end");
const reduced = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const quiet = () => {
  const c = document.documentElement.classList;
  return document.hidden || c.contains("app-hidden") || c.contains("in-bld");
};
const idle = (f: () => void) =>
  "requestIdleCallback" in window ? requestIdleCallback(f, { timeout: 500 }) : setTimeout(f, 16);
const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a})`;
const mix = (c: Rgb, t: number): Rgb => [c[0] + (255 - c[0]) * t, c[1] + (255 - c[1]) * t, c[2] + (255 - c[2]) * t].map(Math.round) as Rgb;
const pc = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

const GAP = 3.4; // зазор между ячейками, в единицах шрифта
const PAD = 5; // поле под ореол, в единицах шрифта
/** размер вывески в единицах шрифта */
function signUnits(s: Sign) {
  const n = s.glyphs.length;
  const fw = s.v ? 10 : n * 10 + (n - 1) * GAP;
  const fh = s.v ? n * 14 + (n - 1) * GAP : 14;
  return { fw: fw + PAD * 2 + (s.frame ? 6 : 0), fh: fh + PAD * 2 + (s.frame ? 6 : 0) };
}
const cellAt = (s: Sign, i: number) => {
  const o = PAD + (s.frame ? 3 : 0);
  return s.v ? [o, o + i * (14 + GAP)] : [o + i * (10 + GAP), o];
};

/** неоновая трубка: ореол из широких бледных мазков, цветное тело, белое ядро */
function tube(g: CanvasRenderingContext2D, p: Path2D, c: Rgb, lw: number) {
  g.lineCap = "round";
  g.lineJoin = "round";
  const passes: [number, number, Rgb][] = [
    [lw * 8, 0.05, c],
    [lw * 5, 0.09, c],
    [lw * 3, 0.2, c],
    [lw * 1.7, 0.7, c],
    [lw * 0.9, 0.95, mix(c, 0.55)],
    [lw * 0.4, 1, mix(c, 0.9)],
  ];
  for (const [w, a, col] of passes) {
    g.lineWidth = w;
    g.strokeStyle = rgba(col, a);
    g.stroke(p);
  }
}
/** выключенная трубка: тёмное стекло с тонким бликом — видна днём */
function glass(g: CanvasRenderingContext2D, p: Path2D, lw: number) {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = lw * 1.25;
  g.strokeStyle = "rgba(24,30,44,.55)";
  g.stroke(p);
  g.lineWidth = lw * 0.35;
  g.strokeStyle = "rgba(210,222,240,.32)";
  g.stroke(p);
}
const LW = 1.25; // толщина трубки в единицах шрифта

function prep(cv: HTMLCanvasElement, wCss: number, hCss: number, k: number) {
  cv.width = Math.max(1, Math.round(wCss * k));
  cv.height = Math.max(1, Math.round(hCss * k));
  const g = cv.getContext("2d");
  g?.clearRect(0, 0, cv.width, cv.height);
  return g;
}
/** один слой вывески: off — все трубки стеклом; part — одна буква (или вся вывеска) светом */
function paintSign(cv: HTMLCanvasElement, s: Sign, wCss: number, hCss: number, k: number, part: number | "off" | "all") {
  const g = prep(cv, wCss, hCss, k);
  if (!g) return;
  const { fw } = signUnits(s);
  const u = (wCss * k) / fw; // px canvas на единицу шрифта
  g.scale(u, u);
  const idx = part === "off" || part === "all" ? s.glyphs.map((_, i) => i) : [part];
  for (const i of idx) {
    const [x, y] = cellAt(s, i);
    const p = new Path2D();
    p.addPath(new Path2D(G[s.glyphs[i]] ?? ""), new DOMMatrix([1, 0, 0, 1, x, y]));
    if (part === "off") glass(g, p, LW);
    else tube(g, p, s.c, LW);
  }
  if (s.frame && (part === "off" || part === "all" || part === 0)) {
    const { fw: w, fh: h } = signUnits(s);
    const fr = new Path2D();
    const m = PAD - 1;
    fr.roundRect(m, m, w - m * 2, h - m * 2, 2.2);
    if (part === "off") glass(g, fr, LW * 0.8);
    else tube(g, fr, s.c, LW * 0.8);
  }
}
/** части вывески, которыми управляет таймер */
const partsOf = (s: Sign) => (s.kind === "seq" || s.kind === "buzz" || s.kind === "chase" ? s.glyphs.map((_, i) => i) : ["all" as const]);

// ── голограмма: оригинальная стилизованная фигура, координаты в коробке 160 × 320 ──
const FACE =
  "M100 58C105 64 107 74 107 84C107 87 105 89 106 92C109 97 114 101 115 104C116 107 112 108 109 108C110 110 111 112 111 114C111 116 107 116 107 117C107 118 110 119 110 121C110 123 106 124 106 125C107 127 108 129 108 132C108 136 105 139 100 140C98 145 96 152 97 162L61 162C62 152 61 140 60 128C60 104 70 62 100 58Z";
const HAIR =
  "M110 84C112 60 102 40 80 38C58 36 40 50 38 74C36 96 38 116 44 130C56 136 70 140 86 148C82 134 80 118 82 104C84 96 92 90 102 88Z";
const STRANDS = ["M100 48C78 50 60 72 58 132", "M106 70C92 72 84 86 83 104"];
const BODY =
  "M61 162L97 162L99 172C106 176 116 186 121 202C125 216 125 230 119 242C116 256 116 284 118 320L22 320C20 290 20 262 22 236C22 214 24 198 32 190C40 182 50 179 58 176Z";
const DETAIL = [
  "M60 168C72 172 88 172 98 168", // ворот
  "M58 176C72 181 90 181 100 174",
  "M34 192C46 186 58 190 62 202C68 236 68 276 64 320", // рука
  "M98 92C101 90 104 91 106 93", // глаз
  "M109 118L106 118", // губы
];
const EAR = "M84 149V160";

function paintHolo(cv: HTMLCanvasElement, wCss: number, hCss: number, k: number, tint?: Rgb) {
  const g = prep(cv, wCss, hCss, k);
  if (!g) return;
  const u = (wCss * k) / 160;
  g.save();
  g.scale(u, u);
  const cy: Rgb = [90, 236, 255];
  const mg: Rgb = [255, 84, 206];
  const face = new Path2D(FACE);
  const hair = new Path2D(HAIR);
  const body = new Path2D(BODY);
  const fill = (p: Path2D, c: Rgb, a0: number, a1: number, y0: number, y1: number) => {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, rgba(c, a0));
    gr.addColorStop(1, rgba(c, a1));
    g.fillStyle = gr;
    g.fill(p);
  };
  const aura = g.createRadialGradient(78, 150, 4, 78, 160, 76);
  aura.addColorStop(0, rgba(cy, 0.12));
  aura.addColorStop(1, rgba(cy, 0));
  g.fillStyle = aura;
  g.fillRect(0, 0, 160, 320);
  fill(body, cy, 0.2, 0.03, 165, 320);
  fill(face, cy, 0.26, 0.16, 56, 162);
  fill(hair, mg, 0.36, 0.2, 30, 142);
  const edge = (p: Path2D, c: Rgb, lw: number) => {
    g.lineJoin = "round";
    g.lineCap = "round";
    for (const [w, a] of [
      [lw * 5, 0.07],
      [lw * 2.6, 0.18],
      [lw, 0.85],
    ] as const) {
      g.lineWidth = w;
      g.strokeStyle = rgba(c, a);
      g.stroke(p);
    }
  };
  edge(body, cy, 1.1);
  edge(face, mix(cy, 0.35), 1.1);
  edge(hair, mg, 1.1);
  for (const d of DETAIL) edge(new Path2D(d), mix(cy, 0.2), 0.7);
  for (const d of STRANDS) edge(new Path2D(d), mix(mg, 0.3), 0.55);
  edge(new Path2D(EAR), mg, 1.1);
  g.fillStyle = rgba(mix(mg, 0.4), 0.95);
  g.beginPath();
  g.arc(84, 162, 1.8, 0, Math.PI * 2);
  g.fill();
  g.restore();
  // сканлайны: каждая третья CSS-строка гасится наполовину; низ растворяется в луче
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "rgba(0,0,0,.5)";
  const step = 3 * k;
  for (let y = 0; y < cv.height; y += step) g.fillRect(0, y, cv.width, Math.max(1, k * 1.1));
  const fade = g.createLinearGradient(0, cv.height * 0.72, 0, cv.height);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  g.fillStyle = fade;
  g.fillRect(0, cv.height * 0.72, cv.width, cv.height * 0.28);
  if (tint) {
    // копия для глитча — подкрашенный срез
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = rgba(tint, 0.7);
    g.fillRect(0, 0, cv.width, cv.height);
  }
  g.globalCompositeOperation = "source-over";
}

/** луч проектора: конус от крыши вверх, ярче у источника */
function paintBeam(cv: HTMLCanvasElement, wCss: number, hCss: number, k: number) {
  const g = prep(cv, wCss, hCss, k);
  if (!g) return;
  const w = cv.width;
  const h = cv.height;
  const sx = ((HOLO.px - HOLO.x) / HOLO.w) * w;
  const gr = g.createLinearGradient(0, h, 0, 0);
  gr.addColorStop(0, "rgba(120,240,255,.42)");
  gr.addColorStop(0.35, "rgba(120,240,255,.12)");
  gr.addColorStop(1, "rgba(120,240,255,0)");
  g.fillStyle = gr;
  g.beginPath();
  g.moveTo(sx - w * 0.015, h);
  g.lineTo(w * 0.06, 0);
  g.lineTo(w * 0.9, 0);
  g.lineTo(sx + w * 0.015, h);
  g.closePath();
  g.fill();
  const dot = g.createRadialGradient(sx, h - 2 * k, 0, sx, h - 2 * k, 9 * k);
  dot.addColorStop(0, "rgba(230,255,255,.95)");
  dot.addColorStop(0.3, "rgba(120,240,255,.5)");
  dot.addColorStop(1, "rgba(120,240,255,0)");
  g.fillStyle = dot;
  g.fillRect(sx - 10 * k, h - 12 * k, 20 * k, 12 * k);
}

const BEAM_H = 92; // высота луча в кадре (до проектора)

export function CityNeon({ tier, phase }: { tier: number; phase: CityPhase }) {
  const host = useRef<HTMLDivElement>(null);
  const signs = SIGNS.filter((s) => tier >= s.from);
  const key = signs.map((s) => s.id).join();

  // рисуем один раз на размер сцены (фаза меняет только прозрачность в CSS)
  useEffect(() => {
    const el = host.current;
    const stage = el?.parentElement;
    if (!el || !stage) return;
    let last = "";
    let dead = false;
    const paint = () => {
      const sw = stage.clientWidth;
      const sh = stage.clientHeight;
      if (!sw || !sh) return;
      const sz = `${sw}x${sh}`;
      if (sz === last) return;
      last = sz;
      const k = Math.min(window.devicePixelRatio || 1, 2);
      const fx = sw / W;
      const fy = sh / H;
      const jobs: (() => void)[] = [];
      for (const s of signs) {
        const { fw, fh } = signUnits(s);
        const w = fw * s.s * fx;
        const h = fh * s.s * fy;
        const node = el.querySelector<HTMLElement>(`[data-s="${s.id}"]`);
        if (!node) continue;
        jobs.push(() => {
          const cvs = node.querySelectorAll("canvas");
          paintSign(cvs[0], s, w, h, k, "off");
          partsOf(s).forEach((p, i) => paintSign(cvs[i + 1], s, w, h, k, p));
        });
      }
      const hn = el.querySelector<HTMLElement>(".holo-w");
      if (hn) {
        const w = HOLO.w * fx;
        const h = HOLO.h * fy;
        const [beam, fig, g1, g2] = Array.from(hn.querySelectorAll("canvas"));
        jobs.push(() => paintHolo(fig, w, h, k));
        jobs.push(() => {
          paintHolo(g1, w, h, k, [255, 70, 200]);
          paintHolo(g2, w, h, k, [150, 255, 255]);
          paintBeam(beam, w, (BEAM_H + 8) * fy, k);
        });
      }
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
  }, [key]);

  // редкие смены состояния: только ночью, вечером и на рассвете; не при «уменьшить движение» и на слабых
  useEffect(() => {
    const el = host.current;
    if (!el || phase === "day" || reduced() || lowEnd()) return;
    const timers = new Set<number>();
    const after = (ms: number, f: () => void) => {
      const t = window.setTimeout(() => {
        timers.delete(t);
        f();
      }, ms);
      timers.add(t);
    };
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    const set = (n: HTMLElement | undefined, o: number) => {
      if (n) n.style.opacity = String(o);
    };
    /** короткая последовательность состояний: [прозрачность, мс] */
    const play = (ns: HTMLElement[], seq: [number, number][], done?: () => void) => {
      let t = 0;
      for (const [o, ms] of seq) {
        after(t, () => ns.forEach((n) => set(n, o)));
        t += ms;
      }
      if (done) after(t, done);
    };
    /** повтор с паузой; пока приложение скрыто — пропуск */
    const loop = (wait: () => number, act: (next: () => void) => void) => {
      const next = () => after(wait(), () => (quiet() ? next() : act(next)));
      next();
    };
    for (const s of signs) {
      const node = el.querySelector<HTMLElement>(`[data-s="${s.id}"]`);
      if (!node) continue;
      const parts = Array.from(node.querySelectorAll<HTMLElement>("canvas.lit"));
      if (s.kind === "flick")
        loop(
          () => rnd(6000, 16000),
          (next) =>
            play(
              parts,
              Math.random() < 0.3
                ? [[0.15, 70], [1, 60], [0, 420], [0.6, 50], [1, 0]]
                : [[0.1, 60], [1, 90], [0.35, 50], [1, 0]],
              next,
            ),
        );
      if (s.kind === "buzz") {
        const bad = parts[s.buzz ?? 0];
        loop(
          () => rnd(1800, 4800),
          (next) => {
            const seq: [number, number][] = [];
            for (let i = 0, n = 6 + Math.floor(Math.random() * 9); i < n; i++) seq.push([Math.random() < 0.5 ? rnd(0, 0.25) : rnd(0.6, 1), rnd(28, 90)]);
            seq.push([Math.random() < 0.35 ? 0.3 : 1, 0]);
            play([bad], seq, next);
          },
        );
      }
      if (s.kind === "seq") {
        const cycle = () => {
          if (quiet()) return after(3000, cycle);
          parts.forEach((p) => set(p, 0));
          parts.forEach((p, i) => play([p], [[0, 900 + i * 260], [1, 50], [0.2, 60], [1, 0]]));
          // держим, потом гаснет с перебоем
          after(900 + parts.length * 260 + rnd(6000, 10000), () =>
            play(parts, [[0.3, 60], [1, 80], [0, 0]], () => after(700, cycle)),
          );
        };
        after(rnd(1500, 4000), cycle);
      }
      if (s.kind === "chase")
        loop(
          () => rnd(5000, 9000),
          (next) => {
            const n = parts.length;
            let t = 0;
            for (let r = 0; r < 3; r++)
              for (let i = 0; i < n; i++) {
                after(t, () => parts.forEach((p, j) => set(p, j === i ? 1 : 0.18)));
                t += 120;
              }
            after(t, () => {
              parts.forEach((p) => set(p, 1));
              next();
            });
          },
        );
    }
    // голограмма: глитч — подкрашенные срезы сдвигаются на пару пикселей, сама фигура вздрагивает
    const hn = el.querySelector<HTMLElement>(".holo-w");
    if (hn) {
      const [, fig, g1, g2] = Array.from(hn.querySelectorAll<HTMLElement>("canvas"));
      const slice = (n: HTMLElement) => {
        const top = rnd(5, 70);
        n.style.clipPath = `inset(${top.toFixed(1)}% 0 ${(100 - top - rnd(4, 14)).toFixed(1)}% 0)`;
        n.style.transform = `translate3d(${rnd(-7, 7).toFixed(1)}px,0,0)`;
        n.style.opacity = "1";
      };
      const hide = () => [g1, g2].forEach((n) => set(n, 0));
      loop(
        () => rnd(3500, 9000),
        (next) => {
          let t = 0;
          for (let i = 0, n = 2 + Math.floor(Math.random() * 3); i < n; i++) {
            after(t, () => {
              slice(g1);
              if (Math.random() < 0.6) slice(g2);
              set(fig, rnd(0.55, 0.85));
            });
            t += rnd(50, 110);
            after(t, () => {
              hide();
              set(fig, 1);
            });
            t += rnd(40, 160);
          }
          if (Math.random() < 0.25) {
            after(t, () => set(fig, 0.25));
            after(t + 70, () => set(fig, 1));
          }
          after(t + 80, next);
        },
      );
    }
    return () => {
      timers.forEach((t) => clearTimeout(t));
      el.querySelectorAll<HTMLElement>("canvas").forEach((n) => {
        n.style.opacity = "";
        n.style.transform = "";
        n.style.clipPath = "";
      });
    };
  }, [key, phase]);

  return (
    <div ref={host} className="neon" aria-hidden>
      <span className="holo-w" style={{ left: pc(HOLO.x, W), top: pc(HOLO.y, H), width: pc(HOLO.w, W), height: pc(HOLO.h, H) }}>
        <canvas
          className="hb"
          style={{ top: pc(HOLO.py - BEAM_H - HOLO.y, HOLO.h), height: pc(BEAM_H + 8, HOLO.h) }}
        />
        <canvas className="hf" />
        <canvas className="hg" />
        <canvas className="hg" />
      </span>
      {signs.map((s) => {
        const { fw, fh } = signUnits(s);
        return (
          <span
            key={s.id}
            data-s={s.id}
            className={`ns ns-${s.id}`}
            style={{ left: pc(s.x - PAD * s.s, W), top: pc(s.y - PAD * s.s, H), width: pc(fw * s.s, W), height: pc(fh * s.s, H) }}
          >
            <canvas className="off" />
            <span className="lt">
              {partsOf(s).map((p) => (
                <canvas key={String(p)} className="lit" />
              ))}
            </span>
          </span>
        );
      })}
    </div>
  );
}

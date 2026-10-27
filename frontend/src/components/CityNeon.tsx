import { useEffect, useRef } from "react";
import type { CityPhase } from "@/lib/cityPhase";

/**
 * Неоновые вывески и голограмма над крышами (DESIGN.md п. 12.1, «Неон»).
 * - Вывески — тонкие LED-линии: геометричные глифы (свой мини-шрифт из путей SVG), голо-панели
 *   с тёмным стеклом и угловой разметкой, LED-рёбра зданий; мягкий ореол из нескольких мазков. Рисуются в canvas ОДИН раз (смена размера),
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
  glyphs: string[]; // ключи шрифта G
  paths?: string[]; // вместо глифов: свои пути (LED-полоса по ребру здания), единица = 1 px кадра
  pw?: number; // размер области путей
  ph?: number;
  c: Rgb;
  kind: Kind;
  frame?: boolean; // тонкий LED-контур панели
  panel?: boolean; // тёмная стеклянная подложка (голо-панель)
  buzz?: number; // какая буква «больная»
};

// тонкий «LED»-шрифт: ячейка 10 × 14, пути SVG, геометричные латинские буквы + знаки
const G: Record<string, string> = {
  H: "M1.5 1V13M8.5 1V13M1.5 7H8.5",
  O: "M3 1H7C8.6 1 9 2 9 3.6V10.4C9 12 8.6 13 7 13H3C1.4 13 1 12 1 10.4V3.6C1 2 1.4 1 3 1Z",
  T: "M.8 1H9.2M5 1V13",
  E: "M8.6 1H1.5V13H8.6M1.5 7H6.8",
  L: "M1.5 1V13H8.6",
  B: "M1.5 7V13H6.4C9.2 13 9.2 7 6.4 7H1.5V1H6C8.6 1 8.6 7 6 7",
  A: "M.8 13 5 1l4.2 12M2.6 8.4h4.8",
  R: "M1.5 13V1H6.2C9 1 9 7 6.2 7H1.5M5.8 7 9 13",
  N: "M1.5 13V1L8.5 13V1",
  X: "M1.2 1 8.8 13M8.8 1 1.2 13",
  U: "M1.5 1V9.6C1.5 12 3 13 5 13S8.5 12 8.5 9.6V1",
  S: "M8.6 2.4C7.8 1.4 6.6 1 5 1 2.6 1 1.4 2.2 1.4 3.8 1.4 7.6 8.6 6 8.6 10.2 8.6 12 7.2 13 5 13 3.2 13 2 12.4 1.2 11.4",
  // ромб-логотип (в духе знака TON): грань и ось
  "◇": "M1 2.4H9L5 12.6ZM5 2.4V12.6",
  // катакана-акцент ネオン
  ネ: "M5 .8V2.6M1.4 2.8H8.4L2 8.8M5 6.4V13.4M5.8 8.8 8.8 11",
  オ: "M1 4.4H9M6.4 1V12.6C6.4 13.4 5.6 13.6 4.4 13.2M6 5 1.4 11",
  ン: "M2 2.4 4.2 4.6M1.4 12.6C5 11.6 7.6 9 9 3.4",
};

export const SIGNS: Sign[] = [
  // HOTEL — узкая вертикальная голо-панель на фасаде башни слева, загорается по букве
  { id: "hotel", from: 1, x: 126, y: 540, s: 0.85, v: true, glyphs: ["H", "O", "T", "E", "L"], c: [255, 92, 170], kind: "seq", panel: true, frame: true },
  // BAR — тонкие буквы под крышей низкого дома (с проектором голограммы); «A» — сбоящий диод
  { id: "bar", from: 1, x: 217, y: 640, s: 0.95, glyphs: ["B", "A", "R"], c: [255, 70, 210], kind: "buzz", buzz: 1 },
  // LED-полоса по фасаду низкого дома под BAR — ровный холодный свет
  { id: "edge-c", from: 1, x: 214, y: 662, s: 1, glyphs: [], paths: ["M0 0H42"], pw: 42, ph: 0, c: [80, 230, 255], kind: "still" },
  // NEXUS — горизонтальная строка на правом корпусе, изредка моргает
  { id: "nexus", from: 2, x: 617, y: 664, s: 0.9, glyphs: ["N", "E", "X", "U", "S"], c: [150, 240, 255], kind: "flick" },
  // узкая панель: ромб-логотип + катакана ネオン
  { id: "panel", from: 2, x: 529, y: 684, s: 0.72, v: true, glyphs: ["◇", "ネ", "オ", "ン"], c: [176, 132, 255], kind: "flick", panel: true, frame: true },
  // LED-линия под NEXUS: бегущий огонь сегментами слева направо
  {
    id: "edge-d", from: 3, x: 618, y: 684, s: 1, glyphs: [], pw: 54, ph: 0, c: [255, 178, 80], kind: "chase",
    paths: [0, 1, 2, 3, 4].map((i) => `M${i * 11} 0H${i * 11 + 9}`),
  },
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
  if (s.paths) return { fw: (s.pw ?? 0) + PAD * 2, fh: (s.ph ?? 0) + PAD * 2 };
  const n = s.glyphs.length;
  const fw = s.v ? 10 : n * 10 + (n - 1) * GAP;
  const fh = s.v ? n * 14 + (n - 1) * GAP : 14;
  return { fw: fw + PAD * 2 + (s.frame ? 5 : 0), fh: fh + PAD * 2 + (s.frame ? 5 : 0) };
}
const cellAt = (s: Sign, i: number) => {
  if (s.paths) return [PAD, PAD];
  const o = PAD + (s.frame ? 2.5 : 0);
  return s.v ? [o, o + i * (14 + GAP)] : [o + i * (10 + GAP), o];
};

/** LED-линия: мягкий ореол (несколько бледных мазков), тонкое цветное тело, почти белое ядро */
function tube(g: CanvasRenderingContext2D, p: Path2D, c: Rgb, lw: number) {
  g.lineCap = "round";
  g.lineJoin = "round";
  const passes: [number, number, Rgb][] = [
    [lw * 7, 0.035, c],
    [lw * 3.6, 0.09, c],
    [lw * 1.8, 0.3, c],
    [lw, 0.95, mix(c, 0.35)],
    [lw * 0.45, 1, mix(c, 0.85)],
  ];
  for (const [w, a, col] of passes) {
    g.lineWidth = w;
    g.strokeStyle = rgba(col, a);
    g.stroke(p);
  }
}
/** выключенный диод: тонкая тёмная линия с бликом — днём видна разметка вывески */
function glass(g: CanvasRenderingContext2D, p: Path2D, lw: number) {
  g.lineCap = "round";
  g.lineJoin = "round";
  g.lineWidth = lw * 1.1;
  g.strokeStyle = "rgba(24,30,44,.45)";
  g.stroke(p);
  g.lineWidth = lw * 0.35;
  g.strokeStyle = "rgba(210,222,240,.26)";
  g.stroke(p);
}
const LW = 0.8; // толщина диодной линии в единицах шрифта

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
  if (s.panel && part === "off") {
    // тёмная стеклянная подложка голо-панели с тонкой гранью
    const { fw: w, fh: h } = signUnits(s);
    const m = PAD - 1;
    g.beginPath();
    g.roundRect(m, m, w - m * 2, h - m * 2, 0.8);
    g.fillStyle = "rgba(6,12,26,.5)";
    g.fill();
    g.lineWidth = 0.3;
    g.strokeStyle = rgba(s.c, 0.22);
    g.stroke();
  }
  const idx = part === "off" || part === "all" ? items(s).map((_, i) => i) : [part];
  for (const i of idx) {
    const [x, y] = cellAt(s, i);
    const p = new Path2D();
    p.addPath(new Path2D((s.paths ? s.paths[i] : G[s.glyphs[i]]) ?? ""), new DOMMatrix([1, 0, 0, 1, x, y]));
    const lw = s.paths ? LW * 1.6 : LW; // LED-полосы чуть толще букв
    if (part === "off") glass(g, p, lw);
    else tube(g, p, s.c, lw);
  }
  if (s.frame && (part === "off" || part === "all" || part === 0)) {
    const { fw: w, fh: h } = signUnits(s);
    const fr = new Path2D();
    const m = PAD - 1;
    // контур панели: углы-скобки, а не сплошная рамка — «хай-тек» разметка
    const x0 = m, y0 = m, x1 = w - m, y1 = h - m, t = 3;
    fr.moveTo(x0, y0 + t); fr.lineTo(x0, y0); fr.lineTo(x0 + t, y0);
    fr.moveTo(x1 - t, y0); fr.lineTo(x1, y0); fr.lineTo(x1, y0 + t);
    fr.moveTo(x1, y1 - t); fr.lineTo(x1, y1); fr.lineTo(x1 - t, y1);
    fr.moveTo(x0 + t, y1); fr.lineTo(x0, y1); fr.lineTo(x0, y1 - t);
    if (part === "off") glass(g, fr, LW * 0.5);
    else tube(g, fr, s.c, LW * 0.5);
  }
}
/** части вывески, которыми управляет таймер */
const items = (s: Sign) => s.paths ?? s.glyphs;
const partsOf = (s: Sign) => (s.kind === "seq" || s.kind === "buzz" || s.kind === "chase" ? items(s).map((_, i) => i) : ["all" as const]);

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

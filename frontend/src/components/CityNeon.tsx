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

// ── голограмма: оригинальная стилизованная женщина, 3/4 вправо, по пояс; коробка 200 × 400 ──
// Вектор + градиенты, рисуется в разрешении экрана (k = DPR, ≤ 3) — края гладкие.
const HEAD =
  "M126 60C131 66 134 74 134 81C136 86 140 92 141 97C141 100 138 101 135 102C136 105 137 107 136 109C135 110 134 111 135 112C136 114 135 116 133 117C133 120 131 123 127 125C120 128 110 125 103 118C99 112 98 104 99 96C100 82 110 64 126 60Z";
const NECK = "M103 116C106 124 105 138 99 150L125 150C121 140 121 130 124 125C117 127 109 123 103 116Z";
const BODY =
  "M100 146C88 154 72 158 62 166C52 174 49 190 50 210C51 240 55 270 59 296C61 330 60 370 60 400L142 400C144 370 142 340 136 314C132 298 132 286 135 272C142 254 148 236 148 216C149 192 144 170 134 158C130 153 127 149 125 146C118 150 106 150 100 146Z";
const HAIR =
  "M128 62C124 46 108 38 92 40C74 42 62 56 60 76C58 96 62 114 64 132C66 156 58 180 52 204C48 222 50 244 60 262C62 246 68 232 74 218C80 202 88 182 92 162C96 144 96 126 96 112C96 100 98 88 104 78C110 70 118 66 128 62Z";
// тонкие пряди: от темени по массе волос вниз
const STRANDS = Array.from({ length: 14 }, (_, i) => {
  const t = i / 13;
  const f = (n: number) => n.toFixed(1);
  return `M${f(124 - t * 50)} ${f(56 - t * 6 + t * t * 20)}C${f(100 - t * 30)} ${f(56 + t * 8)} ${f(90 - t * 26)} ${f(90 + t * 10)} ${f(90 - t * 22)} ${f(132 + t * 6)}S${f(80 - t * 22)} ${f(200 + t * 10)} ${f(70 - t * 12)} ${f(240 + t * 14)}`;
});
const FRINGE = "M128 62C120 64 112 70 107 80C104 87 103 94 104 100C108 88 116 76 129 67Z";
const FACE_D = [
  "M117 80C121 77 127 77 131 79", // бровь
  "M119 87C122 85 126 85 129 87C126 89 122 89 119 87Z", // глаз
  "M131 84C134 89 137 94 139 97", // спинка носа (блик)
  "M130 110C132 109 134 109 135 110", // губы
  "M130 112.5C132 113.6 134 113.6 135 112.5",
];
const COAT_D = [
  "M97 140C104 152 118 154 128 142", // высокий ворот
  "M95 146C104 160 122 160 132 148",
  "M122 156C116 210 110 300 106 400", // борт пальто
  "M68 196C72 240 74 290 74 330", // внутренний край руки
  "M66 170C74 178 76 192 72 206", // плечевой шов
  "M76 300C94 306 116 306 134 298", // пояс
  "M88 220C92 250 92 270 90 290", // складки
  "M128 204C126 232 125 256 127 278",
];

function paintHolo(cv: HTMLCanvasElement, wCss: number, hCss: number, k: number, tint?: Rgb) {
  const g = prep(cv, wCss, hCss, k);
  if (!g) return;
  const u = (wCss * k) / 200;
  g.save();
  g.scale(u, u);
  const cy: Rgb = [96, 238, 255];
  const mg: Rgb = [255, 92, 214];
  const vi: Rgb = [176, 140, 255];
  /** объём: базовая заливка, внутренний ореол у края (френель), двухцветный боковой свет, тонкий контур */
  const shape = (p: Path2D, c: Rgb, a0: number, a1: number, y0: number, y1: number, rim: number) => {
    const gr = g.createLinearGradient(0, y0, 0, y1);
    gr.addColorStop(0, rgba(c, a0));
    gr.addColorStop(1, rgba(c, a1));
    g.fillStyle = gr;
    g.fill(p);
    g.save();
    g.clip(p);
    g.lineJoin = "round";
    for (const [w, a] of [
      [16, 0.06],
      [8, 0.1],
      [3.5, 0.18],
    ] as const) {
      g.lineWidth = w;
      g.strokeStyle = rgba(mix(c, 0.2), a * rim);
      g.stroke(p);
    }
    // ключевой свет: маджента слева, бирюза справа — складываются (additive)
    g.globalCompositeOperation = "lighter";
    const side = g.createLinearGradient(30, 0, 160, 0);
    side.addColorStop(0, rgba(mg, 0.16));
    side.addColorStop(0.45, rgba(mg, 0));
    side.addColorStop(0.62, rgba(cy, 0));
    side.addColorStop(1, rgba(cy, 0.2));
    g.fillStyle = side;
    g.fillRect(0, 0, 200, 400);
    g.restore();
    g.lineWidth = 0.9;
    g.strokeStyle = rgba(mix(c, 0.45), 0.85);
    g.stroke(p);
  };
  const line = (d: string, c: Rgb, w: number, a: number) => {
    g.lineCap = "round";
    g.lineJoin = "round";
    const p = new Path2D(d);
    g.lineWidth = w * 3;
    g.strokeStyle = rgba(c, a * 0.15);
    g.stroke(p);
    g.lineWidth = w;
    g.strokeStyle = rgba(c, a);
    g.stroke(p);
  };
  // мягкое свечение вокруг фигуры
  const aura = g.createRadialGradient(100, 170, 6, 100, 190, 98);
  aura.addColorStop(0, rgba(cy, 0.1));
  aura.addColorStop(1, rgba(cy, 0));
  g.fillStyle = aura;
  g.fillRect(0, 0, 200, 400);
  shape(new Path2D(BODY), cy, 0.2, 0.04, 150, 400, 1);
  for (const d of COAT_D) line(d, mix(cy, 0.25), 0.55, 0.55);
  shape(new Path2D(NECK), cy, 0.22, 0.16, 116, 150, 0.8);
  shape(new Path2D(HEAD), mix(cy, 0.15), 0.3, 0.2, 60, 126, 1);
  for (const d of FACE_D) line(d, mix(cy, 0.6), 0.5, 0.85);
  shape(new Path2D(HAIR), vi, 0.26, 0.06, 40, 262, 1.1);
  shape(new Path2D(FRINGE), mix(vi, 0.2), 0.3, 0.2, 62, 100, 0.8);
  STRANDS.forEach((d, i) => line(d, mix(i % 3 ? mg : vi, 0.25), 0.32, 0.5));
  // серьга-капля
  line("M101 116V125", mix(mg, 0.4), 0.6, 0.9);
  const ear = g.createRadialGradient(101, 127, 0, 101, 127, 4);
  ear.addColorStop(0, "rgba(255,230,250,.95)");
  ear.addColorStop(1, rgba(mg, 0));
  g.fillStyle = ear;
  g.fillRect(95, 121, 12, 12);
  g.restore();
  // тонкие сканлайны (в пикселях экрана) и растворение низа в луче
  g.globalCompositeOperation = "destination-out";
  g.fillStyle = "rgba(0,0,0,.3)";
  const step = Math.max(3, Math.round(1.7 * k));
  const lh = Math.max(1, Math.round(0.55 * k));
  for (let y = 0; y < cv.height; y += step) g.fillRect(0, y, cv.width, lh);
  const fade = g.createLinearGradient(0, cv.height * 0.66, 0, cv.height);
  fade.addColorStop(0, "rgba(0,0,0,0)");
  fade.addColorStop(1, "rgba(0,0,0,1)");
  g.fillStyle = fade;
  g.fillRect(0, cv.height * 0.66, cv.width, cv.height * 0.34);
  if (tint) {
    // копия для глитча — подкрашенный срез
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = rgba(tint, 0.7);
    g.fillRect(0, 0, cv.width, cv.height);
  }
  g.globalCompositeOperation = "source-over";
}

/** луч проектора: мягкий конус от крыши вверх (широкий бледный + узкое ядро) и пылинки в свете */
function paintBeam(cv: HTMLCanvasElement, wCss: number, hCss: number, k: number) {
  const g = prep(cv, wCss, hCss, k);
  if (!g) return;
  const w = cv.width;
  const h = cv.height;
  const sx = ((HOLO.px - HOLO.x) / HOLO.w) * w;
  const cone = (spread: number, a: number) => {
    const gr = g.createLinearGradient(0, h, 0, 0);
    gr.addColorStop(0, `rgba(120,240,255,${a})`);
    gr.addColorStop(0.4, `rgba(120,240,255,${a * 0.3})`);
    gr.addColorStop(1, "rgba(120,240,255,0)");
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(sx - w * 0.012, h);
    g.lineTo(sx - w * spread, 0);
    g.lineTo(sx + w * spread, 0);
    g.lineTo(sx + w * 0.012, h);
    g.closePath();
    g.fill();
  };
  cone(0.42, 0.22);
  cone(0.16, 0.3);
  // пылинки: детерминированная раскладка внутри конуса
  let seed = 7;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 34; i++) {
    const t = r();
    const y = h * (0.08 + t * 0.86);
    const half = w * 0.012 + (w * 0.4 - w * 0.012) * (1 - y / h);
    const x = sx + (r() * 2 - 1) * half * 0.9;
    const rad = (0.22 + r() * 0.4) * k;
    const d = g.createRadialGradient(x, y, 0, x, y, rad * 2.2);
    const a = 0.3 + r() * 0.45;
    d.addColorStop(0, `rgba(220,252,255,${a})`);
    d.addColorStop(1, "rgba(160,240,255,0)");
    g.fillStyle = d;
    g.fillRect(x - rad * 2.2, y - rad * 2.2, rad * 4.4, rad * 4.4);
  }
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
        const kh = Math.min(window.devicePixelRatio || 1, 3); // голограмма — в разрешении экрана
        jobs.push(() => paintHolo(fig, w, h, kh));
        jobs.push(() => {
          paintHolo(g1, w, h, kh, [255, 70, 200]);
          paintHolo(g2, w, h, kh, [150, 255, 255]);
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
        n.style.transform = `translate3d(${rnd(-5, 5).toFixed(1)}px,0,0)`;
        n.style.opacity = "1";
      };
      const hide = () => [g1, g2].forEach((n) => set(n, 0));
      loop(
        () => rnd(6000, 14000),
        (next) => {
          let t = 0;
          for (let i = 0, n = 1 + Math.floor(Math.random() * 3); i < n; i++) {
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
      // редкий «вдох»: конечная WAAPI-анимация 4.6 с, не бесконечная петля
      loop(
        () => rnd(9000, 16000),
        (next) => {
          fig.animate?.(
            [{ transform: "none" }, { transform: "translate3d(0,-0.4%,0) scale(1.006,1.01)" }, { transform: "none" }],
            { duration: 4600, easing: "ease-in-out" },
          );
          after(4700, next);
        },
      );
    }
    return () => {
      timers.forEach((t) => clearTimeout(t));
      el.querySelectorAll<HTMLElement>(".holo-w canvas").forEach((n) => n.getAnimations?.().forEach((a) => a.cancel()));
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

/**
 * Образцы клеток для легенды «Карта» в правилах — порт ArenaRenderer.swatch из прототипа (proto-arena/render.js, v3):
 * те же спрайты стены, укрытия и лута, та же штриховка зоны. Рисуется один раз при открытии правил, без анимаций.
 * Отсюда же экран боя (components/arena/board) берёт GLYPH / RARITY и рисовалки стены, укрытия и лута —
 * поле и легенда не расходятся.
 */
export const GLYPH = {
  fists: "M6.5 9.5h11a2 2 0 0 1 2 2v3.5a5 5 0 0 1-5 5h-5a5 5 0 0 1-5-5v-3.5a2 2 0 0 1 2-2zM6.5 5.5h3.2v3.2H6.5zM10.4 4.5h3.2v4.2h-3.2zM14.3 5.5h3.2v3.2h-3.2z",
  knife: "M21 3c-3.2.6-6.3 2.6-9.3 5.6l-2.9 2.9 3.7 3.7 2.9-2.9C18.4 9.3 20.4 6.2 21 3zM8.1 12.2l3.7 3.7-1.5 1.5-1-1-3.7 3.7a1.5 1.5 0 0 1-2.1-2.1l3.7-3.7-1-1z",
  pistol: "M2.5 7h17.5l1.5 1.5v3h-6.5l-1 1.2h-2.2l-.6 2.3H9.1L7.8 20H3.9l1.6-7.2L2.5 11z",
  rifle: "M.8 10.2h4.6l1.2-1.4h11.6V7.6h2.2v1.2h2.8v2.6h-3l-1.2 1.2h-4.4l-1.5 2.4h-2.6l-.4-2.4H9.2l-1.7 4.3H4.3l1.6-4.3H1.9L.8 11.4z",
  armor: "M12 2.6l8.2 3.1v5.6c0 5.2-3.5 8.9-8.2 10.4-4.7-1.5-8.2-5.2-8.2-10.4V5.7z",
  medkit: "M4 7.2h16a1.3 1.3 0 0 1 1.3 1.3v10.3A1.3 1.3 0 0 1 20 20.1H4a1.3 1.3 0 0 1-1.3-1.3V8.5A1.3 1.3 0 0 1 4 7.2zM9 3.9h6v3.3H9z",
  cross: "M10.6 10h2.8v2.6H16v2.8h-2.6V18h-2.8v-2.6H8v-2.8h2.6z",
} as const;
export type GlyphKey = keyof typeof GLYPH;
export const RARITY = { fists: "#9AA4BA", knife: "#C9D4EA", pistol: "#7C9BFF", rifle: "#FFB547", light: "#7C9BFF", heavy: "#C77DFF", medkit: "#5DFFB0" } as const;
export type LootKey = keyof typeof RARITY;

export type SwatchKind = "wall" | "cover" | "zone" | LootKey;
/** Легенда: ключ образца, заголовок, пояснение (как в прототипе) */
export const LEGEND: { k: SwatchKind; title: string; text: string }[] = [
  { k: "wall", title: "Стена", text: "не пройти, пули не проходят" },
  { k: "cover", title: "Укрытие", text: "встаньте: урон издалека ×½" },
  { k: "pistol", title: "Оружие", text: "цвет — редкость" },
  { k: "light", title: "Броня", text: "1 пластина — лёгкая, 2 — тяжёлая" },
  { k: "medkit", title: "Аптечка", text: "+35 HP, в запас" },
  { k: "zone", title: "Вне зоны", text: "урон каждый ход" },
];

export type G = CanvasRenderingContext2D;
export const TAU = Math.PI * 2;
const C = 30; // клетка образца, CSS px
const H = Math.round(C * 0.3); // высота стены (ложная глубина)
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const rgba = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
};
const P2D: Partial<Record<GlyphKey, Path2D>> = {};
export const gp = (k: GlyphKey) => (P2D[k] ??= new Path2D(GLYPH[k]));

export function layer(w: number, h: number, d: number): [HTMLCanvasElement, G] {
  const c = document.createElement("canvas");
  c.width = Math.ceil(w * d);
  c.height = Math.ceil(h * d);
  const g = c.getContext("2d")!;
  g.scale(d, d);
  return [c, g];
}
export function cutPath(g: G, x: number, y: number, w: number, h: number, c: number) {
  g.beginPath();
  g.moveTo(x + c, y);
  g.lineTo(x + w, y);
  g.lineTo(x + w, y + h - c);
  g.lineTo(x + w - c, y + h);
  g.lineTo(x, y + h);
  g.lineTo(x, y + c);
  g.closePath();
}
export function corners(g: G, x: number, y: number, s: number, k: number) {
  g.beginPath();
  g.moveTo(x, y + k); g.lineTo(x, y); g.lineTo(x + k, y);
  g.moveTo(x + s - k, y); g.lineTo(x + s, y); g.lineTo(x + s, y + k);
  g.moveTo(x + s, y + s - k); g.lineTo(x + s, y + s); g.lineTo(x + s - k, y + s);
  g.moveTo(x + k, y + s); g.lineTo(x, y + s); g.lineTo(x, y + s - k);
}
export function hatch(g: G, x: number, y: number, w: number, h: number, col: string, lw: number, step: number) {
  g.save();
  g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.strokeStyle = col; g.lineWidth = lw; g.beginPath();
  for (let s = -h; s < w + h; s += step) { g.moveTo(x + s, y + h); g.lineTo(x + s + h, y); }
  g.stroke(); g.restore();
}

/** стена v3: стальной блок — светлая крышка, тёмный бок, яркая кромка (клетка C, высота H; рисуется от (0, 0)) */
export function paintWall(g: G, C: number, H: number, hue = 200) {
  const hu = 214 + Math.round(clamp01((hue - 188) / 72) * 3) * 6;
  g.save();
  const x0 = 1, x1 = C - 1, t0 = 1, t1 = C - 1, cut = C * 0.14;
  let gr = g.createLinearGradient(0, t1, 0, t1 + H);
  gr.addColorStop(0, `hsl(${hu},26%,17%)`); gr.addColorStop(1, `hsl(${hu},34%,6%)`);
  g.beginPath(); g.moveTo(x0, t1 - cut); g.lineTo(x0, t1 + H); g.lineTo(x1 - cut, t1 + H); g.lineTo(x1, t1 + H - cut); g.lineTo(x1, t1 - cut); g.closePath();
  g.fillStyle = gr; g.fill();
  g.fillStyle = "rgba(0,0,0,.35)";
  for (let i = 1; i < 3; i++) g.fillRect(x0 + ((x1 - x0) * i) / 3, t1 + 1, 1, H - 2);
  g.save(); g.shadowColor = `hsla(${hu + 14},100%,62%,.9)`; g.shadowBlur = 5;
  g.strokeStyle = `hsla(${hu + 14},100%,68%,.8)`; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0 + 0.5, t1 + H - 0.5); g.lineTo(x1 - cut, t1 + H - 0.5); g.lineTo(x1 - 0.5, t1 + H - cut); g.stroke();
  g.restore();
  gr = g.createLinearGradient(0, t0, 0, t1);
  gr.addColorStop(0, `hsl(${hu},20%,44%)`); gr.addColorStop(1, `hsl(${hu},22%,29%)`);
  cutPath(g, x0, t0, x1 - x0, t1 - t0, cut); g.fillStyle = gr; g.fill();
  const p = C * 0.2;
  cutPath(g, x0 + p, t0 + p, x1 - x0 - 2 * p, t1 - t0 - 2 * p, cut * 0.6);
  g.fillStyle = `hsla(${hu},24%,22%,.55)`; g.fill();
  g.strokeStyle = "rgba(0,0,0,.45)"; g.lineWidth = 1; g.stroke();
  g.strokeStyle = "rgba(255,255,255,.14)"; g.beginPath(); g.moveTo(x0 + p + 1, t1 - p + 0.5); g.lineTo(x1 - p, t1 - p + 0.5); g.stroke();
  g.fillStyle = "rgba(230,240,255,.55)";
  for (const [rx, ry] of [[x0 + p * 0.5, t1 - p * 0.5], [x1 - p * 0.5, t0 + p * 0.5], [x1 - p * 0.5, t1 - p * 0.5]]) g.fillRect(rx - 0.7, ry - 0.7, 1.4, 1.4);
  g.save(); g.shadowColor = `hsla(${hu + 14},100%,62%,.8)`; g.shadowBlur = 5;
  cutPath(g, x0, t0, x1 - x0, t1 - t0, cut); g.strokeStyle = `hsla(${hu + 10},70%,74%,.9)`; g.lineWidth = 1.1; g.stroke();
  g.restore();
  g.strokeStyle = "#F4F9FF"; g.lineWidth = 1.3; g.lineCap = "round";
  g.beginPath(); g.moveTo(x0 + 0.6, t1 - cut - 1); g.lineTo(x0 + 0.6, t0 + cut); g.lineTo(x0 + cut, t0 + 0.6); g.lineTo(x1 - 1.5, t0 + 0.6); g.stroke();
  g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 1;
  g.beginPath(); g.moveTo(x0 + 1, t1 + 0.5); g.lineTo(x1 - cut, t1 + 0.5); g.stroke();
  g.restore();
}

/** укрытие v3: низкий барьер из ящиков, латунный неон, щит-шеврон (badge=false — на клетке лут, щит не рисуем) */
export function paintCover(g: G, C: number, H: number, badge = true) {
  g.save(); g.translate(0, H);
  const x0 = C * 0.1, x1 = C * 0.9, hc = C * 0.17, yb = C * 0.56, yt = yb - hc, y0 = yt - C * 0.2, n = 3, sw = (x1 - x0) / n;
  let gr = g.createLinearGradient(0, yb, 0, yb + C * 0.16);
  gr.addColorStop(0, "rgba(0,0,0,.6)"); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(x0 + 1, yb, x1 - x0, C * 0.16);
  for (let i = 0; i < n; i++) {
    const a = x0 + i * sw + 0.6, b = a + sw - 1.2;
    gr = g.createLinearGradient(0, yt, 0, yb);
    gr.addColorStop(0, "hsl(32,46%,22%)"); gr.addColorStop(1, "hsl(26,50%,9%)");
    g.fillStyle = gr; g.fillRect(a, yt, b - a, hc);
    g.strokeStyle = "rgba(0,0,0,.4)"; g.lineWidth = 0.8; g.beginPath(); g.moveTo(a + 1, yt + 1); g.lineTo(b - 1, yb - 1); g.stroke();
    gr = g.createLinearGradient(0, y0, 0, yt);
    gr.addColorStop(0, "hsl(38,55%,52%)"); gr.addColorStop(1, "hsl(33,48%,34%)");
    g.fillStyle = gr; g.fillRect(a, y0, b - a, yt - y0);
    g.fillStyle = "rgba(0,0,0,.22)"; g.fillRect(a + 1.5, y0 + (yt - y0) / 2 - 0.4, b - a - 3, 0.9);
    g.fillStyle = "rgba(255,240,205,.95)"; g.fillRect(a, y0, b - a, 1);
  }
  g.save(); g.shadowColor = "rgba(255,180,80,.9)"; g.shadowBlur = 5;
  g.strokeStyle = "rgba(255,200,120,.9)"; g.lineWidth = 1; g.beginPath(); g.moveTo(x0, yb - 0.5); g.lineTo(x1, yb - 0.5); g.stroke(); g.restore();
  if (!badge) return void g.restore();
  const s = (C * 0.32) / 24, cx = (x0 + x1) / 2, cy = y0 - C * 0.02;
  g.save(); g.translate(cx - 12 * s, cy - 12 * s); g.scale(s, s);
  g.fillStyle = "#1B1307"; g.fill(gp("armor"));
  g.lineWidth = 2.6; g.strokeStyle = "#FFC977"; g.lineJoin = "round"; g.stroke(gp("armor"));
  g.strokeStyle = "#FFF1D6"; g.lineWidth = 2.6; g.lineCap = "round";
  g.beginPath(); g.moveTo(7.5, 14); g.lineTo(12, 9.5); g.lineTo(16.5, 14); g.stroke();
  g.restore();
  g.restore();
}

/** лут v3: иконка типа на постаменте цвета редкости (спрайт C×C) */
export function paintLoot(g: G, C: number, key: LootKey) {
  const col = RARITY[key];
  const px = C / 2, py = C * 0.76, rx = C * 0.3, ry = C * 0.1, lip = C * 0.07;
  g.fillStyle = "#070A12"; g.beginPath(); g.ellipse(px, py + lip, rx, ry, 0, 0, TAU); g.fill();
  g.fillRect(px - rx, py, rx * 2, lip);
  let gr = g.createLinearGradient(0, py - ry, 0, py + ry);
  gr.addColorStop(0, "#3A4458"); gr.addColorStop(1, "#161C2A");
  g.fillStyle = gr; g.beginPath(); g.ellipse(px, py, rx, ry, 0, 0, TAU); g.fill();
  g.save(); g.shadowColor = col; g.shadowBlur = 5; g.strokeStyle = col; g.lineWidth = 1; g.stroke(); g.restore();
  const rg = g.createRadialGradient(px, py, 0, px, py, rx);
  rg.addColorStop(0, rgba(col, 0.55)); rg.addColorStop(1, rgba(col, 0));
  g.fillStyle = rg; g.beginPath(); g.ellipse(px, py, rx * 0.8, ry * 0.8, 0, 0, TAU); g.fill();
  const s = (C * 0.52) / 24, ox = C / 2 - 12 * s, oy = C * 0.4 - 12 * s;
  g.save(); g.translate(ox, oy); g.scale(s, s);
  const path = gp(key === "light" || key === "heavy" ? "armor" : key);
  g.save(); g.shadowColor = col; g.shadowBlur = 7; g.fillStyle = col; g.fill(path); g.restore();
  g.lineJoin = "round"; g.strokeStyle = "#05070D"; g.lineWidth = 1.1 / s; g.stroke(path);
  g.fillStyle = col; g.fill(path);
  g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 0.45 / s; g.stroke(path);
  g.lineCap = "round";
  if (key === "medkit") { g.fillStyle = "#FFFFFF"; g.fill(gp("cross")); }
  if (key === "light" || key === "heavy") {
    g.fillStyle = "#FFFFFF";
    if (key === "light") g.fillRect(7.5, 10.2, 9, 2.6);
    else { g.fillRect(7.5, 8.2, 9, 2.4); g.fillRect(8.3, 12.6, 7.4, 2.4); }
  }
  g.restore();
}

/** Нарисовать образец kind на canvas (30×39 CSS px). dpr — плотность (как в прототипе: до 2 × 1.5). */
export function drawSwatch(cv: HTMLCanvasElement, kind: SwatchKind, dpr = 2) {
  cv.width = Math.ceil(C * dpr);
  cv.height = Math.ceil((C + H) * dpr);
  const g = cv.getContext("2d");
  if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.fillStyle = "#070A14"; g.fillRect(0, 0, C, C + H);
  g.strokeStyle = "rgba(120,200,255,.14)"; g.lineWidth = 1; g.strokeRect(0.5, H + 0.5, C - 1, C - 1);
  if (kind === "zone") {
    g.fillStyle = "rgba(60,10,18,.5)"; g.fillRect(0, H, C, C);
    hatch(g, 0, H, C, C, "rgba(176,72,84,.42)", 1.2, 6);
    g.strokeStyle = "#C9505C"; g.lineWidth = 1.5; g.beginPath(); g.moveTo(C - 1, H); g.lineTo(C - 1, C + H); g.stroke();
    return;
  }
  if (kind === "wall") return paintWall(g, C, H);
  if (kind === "cover") {
    g.fillStyle = "rgba(255,190,110,.07)"; g.fillRect(1, H + 1, C - 2, C - 2);
    g.strokeStyle = "rgba(255,200,120,.55)"; g.lineWidth = 1.2; corners(g, 2.5, H + 2.5, C - 5, C * 0.2); g.stroke();
    return paintCover(g, C, H);
  }
  // лут — спрайт C×C, опущен на клетку (как drawImage(s, 0, H − C·0.06) в прототипе)
  const [sc, sg] = layer(C, C, dpr);
  paintLoot(sg, C, kind);
  g.drawImage(sc, 0, H - C * 0.06, C, C);
}

/** Плотность образцов: как в прототипе — devicePixelRatio (до 2) × 1.5 */
export const swatchDpr = () => Math.min((typeof window !== "undefined" && window.devicePixelRatio) || 1, 2) * 1.5;

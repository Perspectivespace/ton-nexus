/**
 * Фишки «Арены» — концепт D из прототипа (proto-arena/tokens.js): гранёный самоцвет-оболочка, в центре линза
 * с сигилом игрока (у каждого соперника свой силуэт и цвет, у вас — «соты» и циановая корона), засечка взгляда,
 * значок оружия, дуги HP (5 сегментов на 270°) и брони, разлом при гибели.
 * Свечение только запекается в спрайты (shadowBlur при запекании); в кадре — drawImage и тонкие дуги.
 */
import { GLYPH, RARITY, TAU, clamp01, rgba, type G } from "@/lib/arena/swatch";
import type { Shot } from "@shared/arena/engine.js";
import type { BoardPlayer, DrawView } from "./types";
import { T } from "./types";

type GlyphKey = keyof typeof GLYPH;
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const lerpA = (a: number, b: number, k: number) => {
  const d = ((((b - a + Math.PI) % TAU) + TAU) % TAU) - Math.PI;
  return a + d * k;
};
const mix = (hex: string, to: string, k: number) => {
  const a = parseInt(hex.slice(1), 16),
    b = parseInt(to.slice(1), 16),
    c = (sh: number) => Math.round(((a >> sh) & 255) * (1 - k) + ((b >> sh) & 255) * k);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
};
export const hashName = (s: string | number) => {
  let h = 2166136261;
  for (const ch of String(s)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

export const ME_COL = "#2BF5FF";
/** цвета соперников — разнесены по тону; вместе с уникальным силуэтом сигила различимы и без цвета */
export const FOES = ["#FF2E7E", "#FFB547", "#B07CFF", "#9DFF5C", "#FF6B3D", "#FF7AD9", "#5C8CFF"];
const HPC = (hp: number) => (hp > 60 ? "#5DFFB0" : hp > 35 ? "#FFE066" : "#FF3B5C");

export interface Sig {
  shape: number;
  h: number;
  col: string;
}

/** сигил: 7 силуэтов соперников + «соты» (7) для вас */
function sigilPath(g: G, shape: number, R: number) {
  g.beginPath();
  switch (shape) {
    case 0: g.moveTo(0, -R); g.lineTo(R * 0.95, R * 0.72); g.lineTo(-R * 0.95, R * 0.72); g.closePath(); break;
    case 1: g.moveTo(0, -R); g.lineTo(R * 0.78, 0); g.lineTo(0, R); g.lineTo(-R * 0.78, 0); g.closePath(); break;
    case 2: {
      const a = R * 0.36;
      g.moveTo(-a, -R); g.lineTo(a, -R); g.lineTo(a, -a); g.lineTo(R, -a); g.lineTo(R, a); g.lineTo(a, a);
      g.lineTo(a, R); g.lineTo(-a, R); g.lineTo(-a, a); g.lineTo(-R, a); g.lineTo(-R, -a); g.lineTo(-a, -a); g.closePath();
      break;
    }
    case 3:
      for (let i = 0; i < 8; i++) {
        const an = -Math.PI / 2 + (i * Math.PI) / 4, rr = i % 2 ? R * 0.36 : R;
        g.lineTo(Math.cos(an) * rr, Math.sin(an) * rr);
      }
      g.closePath();
      break;
    case 4: g.arc(0, 0, R, 0, TAU); g.moveTo(R * 0.48, 0); g.arc(0, 0, R * 0.48, 0, TAU, true); break;
    case 5: {
      const w = R * 0.46;
      for (const [x, h] of [[-R * 0.92, 1.05], [-w / 2, 1.9], [R * 0.92 - w, 1.05]]) g.rect(x, (-h * R) / 2, w, h * R);
      break;
    }
    case 6: {
      const t = R * 0.42;
      for (const y0 of [-R * 0.55, R * 0.25]) {
        g.moveTo(-R, y0 + R * 0.5); g.lineTo(0, y0 - R * 0.4); g.lineTo(R, y0 + R * 0.5);
        g.lineTo(R, y0 + R * 0.5 + t); g.lineTo(0, y0 - R * 0.4 + t); g.lineTo(-R, y0 + R * 0.5 + t); g.closePath();
      }
      break;
    }
    default:
      for (let i = 0; i < 6; i++) {
        const an = -Math.PI / 2 + (i * Math.PI) / 3;
        g.lineTo(Math.cos(an) * R, Math.sin(an) * R);
      }
      g.closePath();
  }
}
export function drawSigil(g: G, s: Sig, R: number, col: string, dark = "#05070D", level = 2) {
  g.fillStyle = col;
  sigilPath(g, s.shape, R);
  g.fill(s.shape === 4 ? "evenodd" : "nonzero");
  if (level < 1) return;
  const d = s.h % 3;
  if (s.shape === 4) {
    if (d) { g.beginPath(); g.arc(0, 0, R * 0.2, 0, TAU); g.fill(); }
  } else if (s.shape === 7) {
    g.fillStyle = dark; sigilPath(g, 7, R * 0.5); g.fill();
    g.fillStyle = col; g.beginPath(); g.arc(0, 0, R * 0.18, 0, TAU); g.fill();
  } else if (d === 1) {
    g.fillStyle = dark; g.beginPath(); g.arc(0, s.shape === 0 ? R * 0.2 : 0, R * 0.2, 0, TAU); g.fill();
  } else if (d === 2) {
    g.strokeStyle = dark; g.lineWidth = Math.max(0.8, R * 0.16);
    g.beginPath(); g.moveTo(-R * 0.3, R * 0.3); g.lineTo(R * 0.3, -R * 0.3); g.stroke();
  }
  if (level >= 2 && (s.h >> 4) & 1 && s.shape !== 7) {
    const an = (((s.h >> 5) % 8) * Math.PI) / 4;
    g.fillStyle = col; g.beginPath(); g.arc(Math.cos(an) * R * 1.32, Math.sin(an) * R * 1.32, R * 0.14, 0, TAU); g.fill();
  }
}

/** Цвета и сигилы соперников: уникальный силуэт (0–6) по хэшу имени, цвет — по порядку мест; вы — «соты» */
export function assignSigils(players: Pick<BoardPlayer, "id" | "name">[], meId: number | null): Map<number, Sig> {
  const out = new Map<number, Sig>();
  const used = new Set<number>();
  const foes = players.filter((p) => p.id !== meId).sort((a, b) => a.id - b.id);
  foes.forEach((p, seat) => {
    const h = hashName(p.name || p.id);
    let s = h % 7;
    while (used.has(s) && used.size < 7) s = (s + 1) % 7;
    used.add(s);
    out.set(p.id, { shape: s, h, col: FOES[seat % FOES.length] });
  });
  const me = players.find((p) => p.id === meId);
  if (me) out.set(me.id, { shape: 7, h: hashName(me.name || "me"), col: ME_COL });
  return out;
}

export interface Sprite {
  c: HTMLCanvasElement;
  w: number;
  h: number;
  ax?: number;
  ay?: number;
}
/** что фишкам нужно от рендера: клетка, кэш спрайтов, свечение */
export interface TokenHost {
  C: number;
  sprite(key: string, w: number, h: number, fn: (g: G) => void): Sprite;
  glow(g: G, x: number, y: number, r: number, col: string, a: number): void;
}
interface Paint {
  p: BoardPlayer;
  mine: boolean;
  cx: number;
  cy: number;
  hp: number;
  ap: number;
  hk: number;
  face: number | undefined;
  t: number | null;
  ghost?: boolean;
}

export class TokenKit {
  R: TokenHost;
  face = new Map<number, number>();
  cur = new Map<number, number>();
  sig = new Map<number, Sig>();
  hits = new Map<number, number[]>();
  mePos: { x: number; y: number } | null = null;
  key = "";
  private P2D: Partial<Record<GlyphKey, Path2D>> = {};

  constructor(R: TokenHost) {
    this.R = R;
  }
  gp(k: GlyphKey) {
    return (this.P2D[k] ??= new Path2D(GLYPH[k]));
  }
  info(p: BoardPlayer, mine: boolean): Sig {
    return this.sig.get(p.id) ?? (mine ? { shape: 7, h: 1, col: ME_COL } : { shape: p.id % 7, h: hashName(p.name || p.id), col: FOES[(p.id + 6) % 7] });
  }
  geom() {
    return { r: this.R.C * 0.39 };
  }

  /** раз в кадр: попадания по фишкам и направление взгляда */
  prepare(v: DrawView, t: number | null) {
    const m = v.m, lt = m.lastTurn;
    const key = `${v.meId}:${m.players.map((p) => `${p.id}=${p.name}`).join(",")}`;
    if (key !== this.key) {
      this.key = key;
      this.sig = assignSigils(m.players, v.meId);
      this.face.clear();
    }
    this.hits.clear();
    if (t != null && lt) {
      const push = (id: number, at: number) => {
        const a = this.hits.get(id) ?? [];
        a.push(at);
        this.hits.set(id, a);
      };
      lt.shots.forEach((s, i) => { if (!s.miss) push(s.to, T.shot0 + i * T.shotGap + T.travel); });
      for (const z of lt.zoneHits) push(z.who, T.zone0 - 80);
    }
    for (const p of m.players) if (p.alive || t != null) this.cur.set(p.id, this.faceOf(v, p, t));
  }
  faceOf(v: DrawView, p: BoardPlayer, t: number | null): number {
    const m = v.m, lt = m.lastTurn, c = (m.N - 1) / 2;
    const base = this.face.get(p.id) ?? Math.atan2(c - p.y, c - p.x || 0.001);
    let shot: Shot | null = null;
    let si = -1;
    if (lt) lt.shots.forEach((s, i) => { if (s.from === p.id) { shot = s; si = i; } });
    const mv = lt ? lt.moves[p.id] : undefined;
    const aMv = mv && (mv.to.x !== mv.from.x || mv.to.y !== mv.from.y) ? Math.atan2(mv.to.y - mv.from.y, mv.to.x - mv.from.x) : null;
    const sh = shot as Shot | null;
    const aSh = sh ? Math.atan2(sh.ty - sh.fy, sh.tx - sh.fx) : null;
    if (t == null) {
      const real = aSh ?? aMv ?? base;
      this.face.set(p.id, real);
      if (p.id === v.meId && v.attack && v.from) return Math.atan2(v.attack.y - v.from.y, v.attack.x - v.from.x);
      if (p.id === v.meId && v.plan && v.plan.path.length) {
        const q = v.plan.path[v.plan.path.length - 1];
        return Math.atan2(q.y - p.y, q.x - p.x);
      }
      return real;
    }
    let a = aMv != null ? lerpA(base, aMv, clamp01(t / 140)) : base;
    if (aSh != null) {
      const ts = T.shot0 + si * T.shotGap;
      if (t >= ts - 70) a = lerpA(a, aSh, clamp01((t - ts + 70) / 80));
    }
    return a;
  }
  hitK(id: number, t: number | null) {
    const hs = this.hits.get(id);
    if (!hs || t == null) return -1;
    let best = -1;
    for (const at of hs) {
      const k = (t - at) / 240;
      if (k >= 0 && k < 1) best = k;
    }
    return best;
  }

  // ───── спрайты ─────
  spr(key: string, w: number, h: number, ax: number, ay: number, fn: (g: G) => void): Sprite {
    const s = this.R.sprite(`d${this.R.C}:${key}`, w, h, (g) => {
      g.translate(ax, ay);
      fn(g);
    });
    s.ax = ax;
    s.ay = ay;
    return s;
  }
  blit(g: G, s: Sprite, x: number, y: number) {
    g.drawImage(s.c, x - (s.ax ?? 0), y - (s.ay ?? 0), s.w, s.h);
  }
  pool(g: G, r: number, col: string, y = r * 0.95, a = 0.5) {
    g.save();
    g.scale(1, 0.34);
    const gr = g.createRadialGradient(0, y / 0.34, 0, 0, y / 0.34, r * 1.35);
    gr.addColorStop(0, rgba(col, a));
    gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr;
    g.fillRect(-r * 1.5, y / 0.34 - r * 1.5, r * 3, r * 3);
    g.restore();
  }
  sigSprite(p: BoardPlayer, info: Sig, R: number, level: number) {
    const S = Math.ceil(R * 3.2 + 6);
    return this.spr(`sg${p.id}:${info.shape}:${R.toFixed(1)}:${level}`, S, S, S / 2, S / 2, (g) => {
      g.save(); g.shadowColor = info.col; g.shadowBlur = 4; drawSigil(g, info, R, info.col, "#05070D", level); g.restore();
    });
  }
  badgeSprite(w: string) {
    const C = this.R.C, bs = Math.max(9.5, C * 0.32), col = (RARITY as Record<string, string>)[w] ?? "#C9D4EA", S = Math.ceil(bs + 6);
    return this.spr(`bd${w}`, S, S, S / 2, S / 2, (g) => {
      g.beginPath(); g.arc(0, 0, bs / 2, 0, TAU);
      g.fillStyle = "#070A12"; g.fill();
      g.save(); g.shadowColor = col; g.shadowBlur = 4; g.strokeStyle = col; g.lineWidth = 1.1; g.stroke(); g.restore();
      const k = (bs * 0.66) / 24;
      g.save(); g.scale(k, k); g.translate(-12, -12);
      g.fillStyle = w === "fists" ? "#DCE4F5" : col;
      g.fill(this.gp((w in GLYPH ? w : "fists") as GlyphKey));
      g.restore();
    });
  }
  flashSprite() {
    return this.spr("fl", 64, 64, 32, 32, (g) => {
      const gr = g.createRadialGradient(0, 0, 0, 0, 0, 32);
      gr.addColorStop(0, "rgba(255,255,255,.95)"); gr.addColorStop(0.35, "rgba(255,255,255,.45)"); gr.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = gr; g.fillRect(-32, -32, 64, 64);
    });
  }
  /** гранёная оболочка (8 граней, свет сверху-слева) + пластины брони + линза с сигилом */
  core(info: Sig, mine: boolean, arm: boolean, low: boolean) {
    const C = this.R.C, r = this.geom().r, S = Math.ceil(C * 1.7), col = info.col;
    return this.spr(`cB${col}${info.shape}:${info.h}${mine ? "m" : ""}${arm ? "a" : ""}${low ? "l" : ""}`, S, S, S / 2, S / 2, (g) => {
      g.save(); g.scale(1, 0.34); g.beginPath(); g.arc(0, (r * 0.98) / 0.34, r * 0.92, 0, TAU); g.fillStyle = "rgba(0,0,0,.55)"; g.fill(); g.restore();
      this.pool(g, r, col);
      const V: [number, number][] = [];
      for (let i = 0; i < 8; i++) {
        const an = -Math.PI / 2 + Math.PI / 8 + (i * TAU) / 8;
        V.push([Math.cos(an) * r, Math.sin(an) * r]);
      }
      const L = -Math.PI * 0.75;
      for (let i = 0; i < 8; i++) {
        const a = V[i], b = V[(i + 1) % 8], am = Math.atan2(a[1] + b[1], a[0] + b[0]), l = 0.5 + 0.5 * Math.cos(am - L);
        g.beginPath(); g.moveTo(0, 0); g.lineTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.closePath();
        g.fillStyle = "#070A12"; g.fill(); g.fillStyle = rgba(col, 0.06 + 0.32 * l * l); g.fill();
        if (l > 0.75) { g.fillStyle = `rgba(255,255,255,${((0.16 * (l - 0.75)) / 0.25).toFixed(3)})`; g.fill(); }
      }
      if (arm)
        for (const i of [0, 2, 4, 6]) {
          const a = V[i], b = V[(i + 1) % 8];
          g.beginPath(); g.moveTo(a[0] * 0.98, a[1] * 0.98); g.lineTo(b[0] * 0.98, b[1] * 0.98); g.lineTo(b[0] * 0.72, b[1] * 0.72); g.lineTo(a[0] * 0.72, a[1] * 0.72); g.closePath();
          g.fillStyle = "rgba(157,180,255,.42)"; g.fill(); g.strokeStyle = "#C9D6FF"; g.lineWidth = 0.7; g.stroke();
        }
      g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 0.7;
      for (const [x, y] of V) { g.beginPath(); g.moveTo(x * 0.6, y * 0.6); g.lineTo(x, y); g.stroke(); }
      g.beginPath(); V.forEach(([x, y], i) => (i ? g.lineTo(x * 0.6, y * 0.6) : g.moveTo(x * 0.6, y * 0.6))); g.closePath(); g.strokeStyle = "rgba(255,255,255,.2)"; g.stroke();
      g.beginPath(); V.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
      g.save(); g.shadowColor = col; g.shadowBlur = 9; g.strokeStyle = col; g.lineWidth = mine ? 2.1 : 1.5; g.lineJoin = "round"; g.stroke(); g.restore();
      g.strokeStyle = "rgba(255,255,255,.7)"; g.lineWidth = 0.8;
      g.beginPath(); g.moveTo(V[5][0] * 0.94, V[5][1] * 0.94); g.lineTo(V[6][0] * 0.94, V[6][1] * 0.94); g.lineTo(V[7][0] * 0.94, V[7][1] * 0.94); g.stroke();
      this.lens(g, info, r, low);
    });
  }
  /** линза-ядро: голо-проекция сигила игрока в центре оболочки */
  lens(g: G, info: Sig, r: number, low: boolean) {
    const col = info.col, cr = r * 0.66, cc = low ? "#FF3B5C" : col;
    g.save(); g.shadowColor = cc; g.shadowBlur = 8; g.beginPath(); g.arc(0, 0, cr + 1.6, 0, TAU); g.fillStyle = rgba(cc, 0.55); g.fill(); g.restore();
    g.beginPath(); g.arc(0, 0, cr + 1.3, 0, TAU); g.fillStyle = "#03050A"; g.fill();
    const bz = g.createLinearGradient(-cr, -cr, cr, cr);
    bz.addColorStop(0, "#F2F8FF"); bz.addColorStop(0.4, mix(cc, "#FFFFFF", 0.15)); bz.addColorStop(1, mix(cc, "#05070D", 0.7));
    g.beginPath(); g.arc(0, 0, cr + 0.5, 0, TAU); g.strokeStyle = bz; g.lineWidth = 1.1; g.stroke();
    const gl = g.createRadialGradient(0, -cr * 0.15, 0, 0, 0, cr);
    gl.addColorStop(0, rgba(cc, low ? 0.32 : 0.22)); gl.addColorStop(0.6, "#060A14"); gl.addColorStop(1, "#010207");
    g.beginPath(); g.arc(0, 0, cr, 0, TAU); g.fillStyle = gl; g.fill();
    g.save(); g.clip(); g.fillStyle = rgba(cc, 0.1); for (let y = -cr; y < cr; y += 1.4) g.fillRect(-cr, y, 2 * cr, 0.45); g.restore();
    const R = cr * 0.8;
    g.save(); g.shadowColor = col; g.shadowBlur = 7; drawSigil(g, info, R, col, "#05070D", 1); g.restore();
    drawSigil(g, info, R * 0.97, mix(col, "#FFFFFF", 0.28), "#05070D", 1);
    g.save(); g.beginPath(); g.rect(-cr, -cr, 2 * cr, cr * 0.92); g.clip(); g.globalCompositeOperation = "lighter"; g.globalAlpha = 0.3;
    drawSigil(g, info, R * 0.97, "#FFFFFF", "#000000", 0); g.restore();
    g.strokeStyle = "rgba(255,255,255,.5)"; g.lineWidth = 0.7; g.lineCap = "round";
    g.beginPath(); g.arc(0, 0, cr - 1.1, Math.PI * 1.1, Math.PI * 1.4); g.stroke();
  }
  /** «вы»: гранёная циановая корона */
  crown() {
    const C = this.R.C, w = C * 0.42, h = C * 0.22, S = Math.ceil(w + 10);
    return this.spr("crD", S, Math.ceil(h + 10), S / 2, Math.ceil(h + 5), (g) => {
      const P = [[-w / 2, 0], [-w / 2, -h * 0.8], [-w / 4, -h * 0.3], [0, -h], [w / 4, -h * 0.3], [w / 2, -h * 0.8], [w / 2, 0]];
      g.beginPath(); P.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath();
      const gr = g.createLinearGradient(0, -h, 0, 0); gr.addColorStop(0, "#E9FEFF"); gr.addColorStop(0.5, ME_COL); gr.addColorStop(1, "#0F6D80");
      g.save(); g.shadowColor = ME_COL; g.shadowBlur = 6; g.fillStyle = gr; g.fill(); g.restore();
      g.strokeStyle = "rgba(5,7,13,.7)"; g.lineWidth = 0.6; g.stroke();
      g.strokeStyle = "rgba(255,255,255,.8)"; g.lineWidth = 0.5; g.beginPath(); g.moveTo(-w / 2 + 1, -h * 0.15); g.lineTo(w / 2 - 1, -h * 0.15); g.stroke();
    });
  }

  /** одна фишка: o.hk — фаза удара 0..1 (−1 — нет), o.t — время розыгрыша или null, ghost — призрак конца пути */
  paint(g: G, o: Paint) {
    const { r } = this.geom(), info = this.info(o.p, o.mine), low = o.hp <= 35, arm = o.ap > 0;
    const x = o.cx, y = o.cy;
    let sx = 1, sy = 1, fl = 0;
    if (o.hk >= 0 && o.hk < 1) {
      const s = Math.sin(o.hk * Math.PI) * (1 - o.hk * 0.4);
      sx = 1 + 0.24 * s; sy = 1 - 0.22 * s; fl = 1 - o.hk;
    }
    g.save(); g.translate(x, y + r); g.scale(sx, sy); g.translate(0, -r);
    this.blit(g, this.core(info, o.mine, arm, low), 0, 0);
    if (o.face != null && !o.ghost) this.tick(g, r, info.col, o.face);
    if (o.t != null && !o.ghost) this.runes(g, r, info.col, o.t);
    g.restore();
    if (o.ghost) return;
    this.hpArc(g, x, y, r, o.hp, o.ap);
    const bo = r * 0.8;
    this.blit(g, this.badgeSprite(o.p.weapon || "fists"), x + bo, y + bo);
    if (fl > 0) {
      g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = fl;
      const s = this.flashSprite(); g.drawImage(s.c, x - r * 1.6, y - r * 1.6, r * 3.2, r * 3.2); g.restore();
    }
    if (o.mine) {
      // метка «вы» над фишкой; в верхнем ряду прижимается к краю поля, чтобы не обрезалась
      const mk = this.crown();
      this.blit(g, mk, x, Math.max(y - r - 3.5, (mk.ay ?? 0) - 4));
    }
  }
  /** засечка взгляда на грани оболочки (куда шёл / стрелял) */
  tick(g: G, r: number, col: string, face: number) {
    g.save(); g.rotate(face);
    g.beginPath(); g.moveTo(r * 1.04, 0); g.lineTo(r * 0.8, -r * 0.14); g.lineTo(r * 0.85, 0); g.lineTo(r * 0.8, r * 0.14); g.closePath();
    g.fillStyle = mix(col, "#FFFFFF", 0.45); g.fill(); g.strokeStyle = "rgba(5,7,13,.8)"; g.lineWidth = 0.5; g.stroke();
    g.restore();
  }
  runes(g: G, r: number, col: string, t: number) {
    const k = clamp01(t / T.end), a = Math.sin(k * Math.PI), rot = t * 0.0042;
    if (a <= 0.02) return;
    g.save(); g.globalCompositeOperation = "lighter"; g.strokeStyle = col; g.lineCap = "round";
    for (let i = 0; i < 12; i++) {
      const an = rot + (i * TAU) / 12, long = i % 3 === 0, r0 = r + 5.4, r1 = r0 + (long ? 3 : 1.6);
      g.globalAlpha = a * (long ? 0.95 : 0.6); g.lineWidth = long ? 1.3 : 1;
      g.beginPath(); g.moveTo(Math.cos(an) * r0, Math.sin(an) * r0); g.lineTo(Math.cos(an) * r1, Math.sin(an) * r1); g.stroke();
    }
    g.restore();
  }
  /** HP: 5 сегментов по 20 на 270° (разрыв под значком оружия); броня — тонкая дуга снаружи (из 60) */
  hpArc(g: G, x: number, y: number, r: number, hp: number, ap: number) {
    const col = HPC(hp), R = r + 2.5;
    g.save(); g.lineCap = "butt";
    const a0 = Math.PI / 2 + 0.25, span = TAU * 0.75 - 0.5, seg = span / 5, gap = 0.12;
    g.lineWidth = 2.4;
    for (let i = 0; i < 5; i++) {
      const s0 = a0 + i * seg + gap / 2, f = clamp01(hp / 20 - i);
      g.strokeStyle = "rgba(200,215,255,.13)"; g.beginPath(); g.arc(x, y, R, s0, s0 + seg - gap); g.stroke();
      if (f > 0) { g.strokeStyle = col; g.beginPath(); g.arc(x, y, R, s0, s0 + (seg - gap) * f); g.stroke(); }
    }
    if (ap > 0) { g.strokeStyle = "#A9BEFF"; g.lineWidth = 1.1; g.beginPath(); g.arc(x, y, R + 2.7, a0, a0 + span * Math.min(1, ap / 60)); g.stroke(); }
    g.restore();
  }
  /** гибель: грани разлетаются, ядро схлопывается и вспыхивает, сигил всплывает и тает (k 0..1) */
  shatter(g: G, p: BoardPlayer, mine: boolean, cx: number, cy: number, k: number) {
    const C = this.R.C, { r } = this.geom(), info = this.info(p, mine), col = info.col, e = easeOut(k), y = cy;
    g.save();
    const s = this.core(info, mine, false, true), rr = r * 1.06;
    const sg = this.sigSprite(p, info, r * 0.45, 1);
    g.save(); g.globalCompositeOperation = "lighter"; g.globalAlpha = (1 - k) * 0.9;
    const sc = 1 + 0.9 * e; g.translate(cx, y - C * 0.45 * e); g.scale(sc, sc); this.blit(g, sg, 0, 0); g.restore();
    for (let i = 0; i < 8; i++) {
      const a0 = -Math.PI / 2 + Math.PI / 8 + (i * TAU) / 8, a1 = a0 + TAU / 8, am = (a0 + a1) / 2, d = C * 0.62 * e;
      g.save(); g.translate(cx + Math.cos(am) * d, y + Math.sin(am) * d + C * 0.22 * k * k); g.rotate((i % 2 ? 1.6 : -1.3) * e);
      g.beginPath(); g.moveTo(0, 0); g.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr); g.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr); g.closePath(); g.clip();
      g.globalAlpha = 1 - k; this.blit(g, s, 0, 0); g.restore();
    }
    g.globalCompositeOperation = "lighter";
    const ck = k < 0.3 ? 1 - k / 0.3 : (k - 0.3) / 0.7;
    this.R.glow(g, cx, y, C * (k < 0.3 ? 0.35 * ck + 0.08 : 0.2 + 0.9 * ck), col, k < 0.3 ? 1 : 1 - ck);
    g.strokeStyle = col; g.globalAlpha = 1 - k; g.lineWidth = 1.4; g.beginPath();
    for (let i = 0; i < 8; i++) {
      const an = -Math.PI / 2 + Math.PI / 8 + (i * TAU) / 8, R = r + C * 0.32 * e;
      g.lineTo(cx + Math.cos(an) * R, y + Math.sin(an) * R);
    }
    g.closePath(); g.stroke();
    g.restore();
  }
  /** след погибшего: тусклый сигил и расколотая оболочка */
  dead(g: G, p: BoardPlayer, mine: boolean, cx: number, cy: number) {
    const C = this.R.C, info = this.info(p, mine), col = info.col, r = C * 0.3;
    g.save();
    g.save(); g.translate(cx, cy); g.globalAlpha = 0.3; drawSigil(g, info, r * 0.42, col, "#05070D", 0); g.restore();
    g.beginPath();
    for (let i = 0; i < 8; i++) {
      const an = -Math.PI / 2 + Math.PI / 8 + (i * TAU) / 8;
      g.lineTo(cx + Math.cos(an) * r, cy + Math.sin(an) * r);
    }
    g.closePath();
    g.fillStyle = "rgba(0,0,0,.38)"; g.fill(); g.strokeStyle = rgba(col, 0.35); g.lineWidth = 1; g.stroke();
    g.strokeStyle = rgba(col, 0.45); g.beginPath();
    g.moveTo(cx - r * 0.5, cy - r * 0.4); g.lineTo(cx - r * 0.05, cy + r * 0.05); g.lineTo(cx + r * 0.2, cy - r * 0.25);
    g.moveTo(cx - r * 0.05, cy + r * 0.05); g.lineTo(cx + r * 0.1, cy + r * 0.55); g.stroke();
    g.restore();
  }
  /** «дыхание» своей фишки — из цикла шиммера (оверлей); в розыгрыше хода выключено */
  breath(g: G, now: number) {
    if (!this.mePos) return;
    const k = 0.5 + 0.5 * Math.sin((now * TAU) / 2600), { r } = this.geom();
    g.save(); g.globalCompositeOperation = "lighter";
    this.R.glow(g, this.mePos.x, this.mePos.y, r * (1.5 + 0.18 * k), ME_COL, 0.14 + 0.16 * k);
    g.restore();
  }
}

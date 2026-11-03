/**
 * Рендер поля «Арены» — порт ArenaRenderer из утверждённого прототипа (proto-arena/render.js, поле v3, фишки D).
 * Слои: пол (запечён на матч), зона (запечена на стадию), стены/укрытия/лут/фишки — спрайты из кэша.
 * Кадр рисуется по событию (новое состояние, тап, план) и в коротком розыгрыше хода (≤ 1,25 с).
 * Единственный постоянный цикл — оверлей ~30 к/с (плазма по кольцу зоны и «дыхание» своей фишки);
 * при prefers-reduced-motion — один статичный кадр. Свечение только при запекании; backdrop-filter не используется.
 */
import { inBox, maxStage, zoneBox, type Cell, type ZoneBox } from "@shared/arena/engine.js";
import { RARITY, TAU, clamp01, corners, cutPath, hatch, layer, paintCover, paintLoot, paintWall, rgba, gp, type G, type LootKey } from "@/lib/arena/swatch";
import { TokenKit, ME_COL, type Sprite } from "./tokens";
import { T, type Board, type BoardPlayer, type DrawView } from "./types";

const PAL = { me: ME_COL, foe: "#FF2E7E", warn: "#FFE066", ok: "#5DFFB0" };
const easeOut = (t: number) => 1 - Math.pow(1 - clamp01(t), 3);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function hexPath(g: G, x: number, y: number, r: number) {
  g.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
  }
  g.closePath();
}
type Rect = { x: number; y: number; w: number; h: number };
interface ZoneLayers {
  under: HTMLCanvasElement;
  over: HTMLCanvasElement;
  R: Rect | null;
}
export interface Perf {
  frames: number;
  total: number;
  max: number;
  samples: number[];
  shimmer: number;
  shimmerN: number;
}
const lootKey = (l: { kind: string; type: string | null }): LootKey => (l.kind === "medkit" ? "medkit" : ((l.type ?? "fists") as LootKey));
export const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export class ArenaRenderer {
  cv: HTMLCanvasElement;
  g: G;
  ov: HTMLCanvasElement;
  og: G;
  sprites = new Map<string, Sprite>();
  zones = new Map<string, ZoneLayers>();
  perf: Perf = { frames: 0, total: 0, max: 0, samples: [], shimmer: 0, shimmerN: 0 };
  shimmer = { raf: 0, last: 0, on: false };
  tk: TokenKit;
  N = 0;
  C = 0;
  D = 1;
  H = 0;
  PAD = 0;
  W = 0;
  HH = 0;
  tiles: number[][] = [];
  blocks: { x: number; y: number; t: number }[] = [];
  floor: HTMLCanvasElement | null = null;
  /** кольцо текущей зоны для цикла оверлея */
  ringRect: Rect | null = null;

  constructor(main: HTMLCanvasElement, over: HTMLCanvasElement) {
    this.cv = main;
    this.g = main.getContext("2d")!;
    this.ov = over;
    this.og = over.getContext("2d")!;
    this.tk = new TokenKit(this);
  }
  /** размеры поля: cell — клетка в CSS px, dpr — плотность (до 2) */
  setup(m: Pick<Board, "N" | "tiles">, cell: number, dpr: number) {
    this.N = m.N;
    this.C = cell;
    this.D = dpr;
    this.H = Math.round(cell * 0.3); // высота стены (ложная глубина)
    this.PAD = this.H + 3;
    this.W = m.N * cell;
    this.HH = m.N * cell + this.PAD;
    for (const c of [this.cv, this.ov]) {
      c.width = Math.round(this.W * dpr);
      c.height = Math.round(this.HH * dpr);
      c.style.width = this.W + "px";
      c.style.height = this.HH + "px";
    }
    this.sprites.clear();
    this.zones.clear();
    this.tiles = m.tiles;
    this.blocks = [];
    for (let y = 0; y < m.N; y++) for (let x = 0; x < m.N; x++) if (m.tiles[y][x]) this.blocks.push({ x, y, t: m.tiles[y][x] });
    this.floor = this.bakeFloor();
  }
  cx(x: number) {
    return (x + 0.5) * this.C;
  }
  cy(y: number) {
    return this.PAD + (y + 0.5) * this.C;
  }
  /** клетка под точкой (CSS px от левого верхнего угла canvas) или null */
  cellAt(px: number, py: number): Cell | null {
    const x = Math.floor(px / this.C), y = Math.floor((py - this.PAD) / this.C);
    return x < 0 || y < 0 || x >= this.N || y >= this.N ? null : { x, y };
  }
  hue(x: number, y: number) {
    return 188 + 72 * ((x + y) / (2 * this.N - 2));
  }
  layer(w: number, h: number) {
    return layer(w, h, this.D);
  }
  sprite(key: string, w: number, h: number, fn: (g: G) => void): Sprite {
    let s = this.sprites.get(key);
    if (!s) {
      const [c, g] = this.layer(w, h);
      fn(g);
      s = { c, w, h };
      this.sprites.set(key, s);
    }
    return s;
  }

  // ───── пол (v3): спокойная тёмная сетка; тени стен и метки укрытий запечены сюда ─────
  bakeFloor() {
    const { W, HH, PAD, C, N } = this;
    const [c, g] = this.layer(W, HH);
    let gr = g.createLinearGradient(0, 0, 0, HH);
    gr.addColorStop(0, "#04050B"); gr.addColorStop(1, "#080C18");
    g.fillStyle = gr; g.fillRect(0, 0, W, HH);
    gr = g.createRadialGradient(W / 2, PAD + W * 0.55, 0, W / 2, PAD + W * 0.55, W * 0.75);
    gr.addColorStop(0, "rgba(43,245,255,.045)"); gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr; g.fillRect(0, 0, W, HH);
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (this.tiles[y][x] === 1) continue;
        g.fillStyle = (x + y) % 2 ? "rgba(150,175,230,.035)" : "rgba(150,175,230,.015)";
        g.fillRect(x * C + 1, PAD + y * C + 1, C - 2, C - 2);
      }
    g.strokeStyle = "rgba(120,200,255,.10)"; g.lineWidth = 1;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const v = Math.min(W - 0.5, Math.max(0.5, i * C + 0.5)); g.moveTo(v, PAD); g.lineTo(v, HH);
      const h = Math.min(HH - 0.5, PAD + i * C + 0.5); g.moveTo(0, h); g.lineTo(W, h);
    }
    g.stroke();
    g.fillStyle = "rgba(170,230,255,.22)";
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) g.fillRect(i * C - 0.5, PAD + j * C - 0.5, 2, 2);
    for (const b of this.blocks)
      if (b.t === 2) {
        const X = b.x * C, Y = PAD + b.y * C, k = C * 0.2, i = 2.5;
        g.fillStyle = "rgba(255,190,110,.07)"; g.fillRect(X + 1, Y + 1, C - 2, C - 2);
        g.strokeStyle = "rgba(255,200,120,.55)"; g.lineWidth = 1.2; corners(g, X + i, Y + i, C - 2 * i, k); g.stroke();
      }
    for (const b of this.blocks)
      if (b.t === 1) {
        const X = b.x * C, Y = PAD + (b.y + 1) * C;
        gr = g.createLinearGradient(0, Y, 0, Y + C * 0.34);
        gr.addColorStop(0, "rgba(0,0,0,.72)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.fillRect(X + C * 0.12, Y, C, C * 0.34);
        gr = g.createLinearGradient(X + C, 0, X + C + C * 0.2, 0);
        gr.addColorStop(0, "rgba(0,0,0,.55)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = gr; g.fillRect(X + C, Y - C - this.H * 0.4, C * 0.2, C + this.H * 0.4);
      }
    gr = g.createRadialGradient(W / 2, HH * 0.55, W * 0.4, W / 2, HH * 0.55, W * 0.85);
    gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, "rgba(0,0,0,.45)");
    g.fillStyle = gr; g.fillRect(0, 0, W, HH);
    gr = g.createLinearGradient(0, 0, 0, PAD + C * 0.5);
    gr.addColorStop(0, "rgba(3,4,10,.9)"); gr.addColorStop(1, "rgba(3,4,10,0)");
    g.fillStyle = gr; g.fillRect(0, 0, W, PAD + C * 0.5);
    return c;
  }

  // ───── спрайты поля: те же рисовалки, что у легенды правил (lib/arena/swatch) ─────
  wallSprite(hue: number) {
    const { C, H } = this, M = 7, hu = 214 + Math.round(clamp01((hue - 188) / 72) * 3) * 6;
    return this.sprite(`w${hu}`, C + 2 * M, C + H + 2 * M, (g) => {
      g.translate(M, M);
      paintWall(g, C, H, hue);
    });
  }
  coverSprite(badge = true) {
    const { C, H } = this, M = 6;
    return this.sprite(badge ? "cov3" : "cov3n", C + 2 * M, C + H + 2 * M, (g) => {
      g.translate(M, M);
      paintCover(g, C, H, badge);
    });
  }
  lootSprite(l: { kind: string; type: string | null }) {
    const key = lootKey(l);
    return this.sprite(`l3${key}`, this.C, this.C, (g) => paintLoot(g, this.C, key));
  }
  glowSprite(col: string) {
    const R = 32;
    return this.sprite(`g${col}`, R * 2, R * 2, (g) => {
      const gr = g.createRadialGradient(R, R, 0, R, R, R);
      gr.addColorStop(0, "rgba(255,255,255,1)"); gr.addColorStop(0.18, rgba(col, 0.95)); gr.addColorStop(0.5, rgba(col, 0.3)); gr.addColorStop(1, rgba(col, 0));
      g.fillStyle = gr; g.fillRect(0, 0, R * 2, R * 2);
    });
  }

  // ───── зона (v3): снаружи — приглушённое затемнение и красная штриховка, мягкая граница + кольцо ─────
  zoneRect(box: ZoneBox): Rect {
    const { C, PAD } = this;
    return { x: box.x0 * C + 1.5, y: PAD + box.y0 * C + 1.5, w: (box.x1 - box.x0 + 1) * C - 3, h: (box.y1 - box.y0 + 1) * C - 3 };
  }
  zoneLayers(key: string, box: ZoneBox, next: ZoneBox | null): ZoneLayers {
    let z = this.zones.get(key);
    if (z) return z;
    const { W, HH, PAD, C } = this;
    const [under, gu] = this.layer(W, HH);
    const [over, go] = this.layer(W, HH);
    const R = box.closed ? null : this.zoneRect(box);
    const outside = (g: G, top: number) => {
      g.beginPath(); g.rect(0, top, W, HH - top); if (R) g.rect(R.x, R.y, R.w, R.h); g.clip("evenodd");
    };
    gu.save(); outside(gu, PAD);
    gu.fillStyle = "rgba(26,4,9,.34)"; gu.fillRect(0, PAD, W, HH - PAD);
    hatch(gu, 0, PAD, W, HH - PAD, "rgba(176,72,84,.17)", 1.1, 8);
    if (R) { gu.shadowColor = "rgba(170,40,54,.55)"; gu.shadowBlur = C * 0.32; gu.strokeStyle = "rgba(190,64,76,.18)"; gu.lineWidth = 4; gu.strokeRect(R.x - 3, R.y - 3, R.w + 6, R.h + 6); }
    gu.restore();
    go.save(); outside(go, PAD - this.H);
    go.fillStyle = "rgba(18,3,7,.18)"; go.fillRect(0, 0, W, HH);
    hatch(go, 0, PAD - this.H, W, HH, "rgba(180,84,96,.07)", 1, 8);
    go.restore();
    if (next && !next.closed) {
      const n = this.zoneRect(next);
      go.save(); go.setLineDash([6, 5]); go.shadowColor = "rgba(255,181,71,.9)"; go.shadowBlur = 6;
      go.strokeStyle = "rgba(255,200,110,.85)"; go.lineWidth = 1.3; go.strokeRect(n.x + 1.5, n.y + 1.5, n.w - 3, n.h - 3); go.restore();
    }
    if (R) this.ring(go, R, 1);
    z = { under, over, R };
    this.zones.set(key, z);
    return z;
  }
  ring(g: G, R: Rect, a: number) {
    g.save(); g.globalAlpha = a;
    g.shadowColor = "rgba(200,48,62,.7)"; g.shadowBlur = 7;
    g.strokeStyle = "rgba(200,64,76,.20)"; g.lineWidth = 4; g.strokeRect(R.x, R.y, R.w, R.h);
    g.shadowBlur = 4; g.strokeStyle = "#C9505C"; g.lineWidth = 1.5; g.strokeRect(R.x, R.y, R.w, R.h);
    g.shadowBlur = 0; g.strokeStyle = "rgba(255,214,218,.5)"; g.lineWidth = 0.6; g.strokeRect(R.x, R.y, R.w, R.h);
    const k = Math.min(14, R.w * 0.2);
    g.strokeStyle = "#E9C4C8"; g.lineWidth = 2; g.shadowColor = "rgba(200,48,62,.8)"; g.shadowBlur = 5;
    g.beginPath();
    g.moveTo(R.x, R.y + k); g.lineTo(R.x, R.y); g.lineTo(R.x + k, R.y);
    g.moveTo(R.x + R.w - k, R.y); g.lineTo(R.x + R.w, R.y); g.lineTo(R.x + R.w, R.y + k);
    g.moveTo(R.x + R.w, R.y + R.h - k); g.lineTo(R.x + R.w, R.y + R.h); g.lineTo(R.x + R.w - k, R.y + R.h);
    g.moveTo(R.x + k, R.y + R.h); g.lineTo(R.x, R.y + R.h); g.lineTo(R.x, R.y + R.h - k);
    g.stroke();
    g.restore();
  }
  zoneFor(m: Pick<Board, "N" | "stage">) {
    const ms = maxStage(m.N);
    const box = zoneBox(m.N, m.stage), nb = m.stage + 1 <= ms ? zoneBox(m.N, m.stage + 1) : null;
    return this.zoneLayers(`${m.stage}`, box, nb);
  }

  // ───── кадр ─────
  draw(v: DrawView) {
    if (!this.floor) return;
    const t0 = performance.now();
    const { g, D, C, PAD } = this;
    const m = v.m, prev = v.prev, lt = m.lastTurn;
    const anim = v.t != null && v.t < T.end && !!prev && !!lt;
    const t = anim ? (v.t as number) : 0;
    this.tk.prepare(v, anim ? t : null);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.floor, 0, 0);
    g.setTransform(D, 0, 0, D, 0, 0);
    const zNow = this.zoneFor(m), zPrev = anim && prev!.stage !== m.stage ? this.zoneFor(prev!) : null;
    this.ringRect = zNow.R;
    const zk = zPrev ? clamp01((t - T.zone0 - 120) / 300) : 1;
    const blit = (c: HTMLCanvasElement, a: number) => {
      if (a <= 0) return;
      g.save(); g.globalAlpha = a; g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(c, 0, 0); g.restore();
    };
    if (zPrev) blit(zPrev.under, 1 - zk);
    blit(zNow.under, zk);
    const prevAlive = anim ? new Set(prev!.players.filter((p) => p.alive).map((p) => p.id)) : null;
    for (const p of m.players) if (!p.alive && !(prevAlive && prevAlive.has(p.id))) this.tk.dead(g, p, p.id === v.meId, this.cx(p.x), this.cy(p.y));
    if (!anim && v.reach)
      for (const c of v.reach) {
        cutPath(g, c.x * C + 3, PAD + c.y * C + 3, C - 6, C - 6, C * 0.16);
        g.fillStyle = c.near ? "rgba(43,245,255,.11)" : "rgba(43,245,255,.05)"; g.fill();
        g.strokeStyle = c.near ? "rgba(43,245,255,.38)" : "rgba(43,245,255,.16)"; g.lineWidth = 1; g.stroke();
      }
    for (const l of m.loot) if (m.tiles[l.y]?.[l.x] !== 2) this.drawLoot(g, l, 1);
    if (anim) for (const l of lt!.picks) this.drawLoot(g, l, 1 - clamp01((t - T.move + 60) / 120));
    if (!anim && v.plan && v.plan.path.length) this.drawPath(g, v);
    const toks: { p: BoardPlayer; x: number; y: number }[] = [];
    for (const p of m.players) {
      const dying = anim && prevAlive!.has(p.id) && !p.alive;
      if (!p.alive && !dying) continue;
      let x = p.x, y = p.y;
      const mv = anim ? lt!.moves[p.id] : undefined;
      if (mv) {
        const k = easeOut(t / T.move);
        x = lerp(mv.from.x, mv.to.x, k);
        y = lerp(mv.from.y, mv.to.y, k);
      }
      if (dying && t >= this.deathTime(m, p.id)) continue;
      toks.push({ p, x, y });
    }
    toks.sort((a, b) => a.y - b.y);
    const meTok = !anim ? toks.find((k) => k.p.id === v.meId) : undefined;
    this.tk.mePos = meTok ? { x: this.cx(meTok.x), y: this.cy(meTok.y) - C * 0.04 } : null;
    let ti = 0;
    for (const b of this.blocks) {
      while (ti < toks.length && toks[ti].y < b.y) this.drawToken(g, toks[ti++], v, anim ? t : null);
      const s = b.t === 1 ? this.wallSprite(this.hue(b.x, b.y)) : this.coverSprite(!m.loot.some((l) => l.x === b.x && l.y === b.y));
      const M = (s.w - C) / 2;
      g.drawImage(s.c, b.x * C - M, PAD + b.y * C - this.H - M, s.w, s.h);
      if (b.t === 2) for (const l of m.loot) if (l.x === b.x && l.y === b.y) this.drawLoot(g, l, 1);
    }
    while (ti < toks.length) this.drawToken(g, toks[ti++], v, anim ? t : null);
    if (zPrev) blit(zPrev.over, 1 - zk);
    blit(zNow.over, zk);
    if (!anim && v.targets) for (const o of v.targets) this.bracket(g, o, o.id === v.attack?.id);
    if (!anim && v.attack && v.from) this.attackLine(g, v.from, v.attack);
    if (!anim && v.medkit) {
      const p = m.players.find((o) => o.id === v.meId);
      if (p) this.healRing(g, p);
    }
    if (anim) this.fx(g, v, t, !!zPrev);
    const d = performance.now() - t0;
    this.perf.frames++;
    this.perf.total += d;
    this.perf.max = Math.max(this.perf.max, d);
    if (this.perf.samples.length < 4000) this.perf.samples.push(d);
  }
  deathTime(m: Board, id: number) {
    let at: number = T.zone0;
    m.lastTurn?.shots.forEach((s, i) => {
      if (s.to === id && !s.miss) at = Math.max(at, T.shot0 + i * T.shotGap + T.travel + 60);
    });
    return at;
  }
  drawLoot(g: G, l: { x: number; y: number; kind: string; type: string | null }, a: number) {
    if (a <= 0) return;
    const s = this.lootSprite(l);
    g.globalAlpha = a; g.drawImage(s.c, l.x * this.C, this.PAD + l.y * this.C - this.C * 0.06, s.w, s.h); g.globalAlpha = 1;
  }
  hpOf(v: DrawView, p: BoardPlayer, t: number | null) {
    const q = t != null && v.prev ? v.prev.players.find((o) => o.id === p.id) : undefined;
    if (!q || t == null) return { hp: p.hp, ap: p.ap };
    const k = clamp01((t - T.shot0 - T.travel) / 260);
    return { hp: lerp(q.hp, p.hp, k), ap: lerp(q.ap, p.ap, k) };
  }
  drawToken(g: G, tk: { p: BoardPlayer; x: number; y: number }, v: DrawView, t: number | null) {
    const { p, x, y } = tk, { hp, ap } = this.hpOf(v, p, t);
    this.tk.paint(g, { p, mine: p.id === v.meId, cx: this.cx(x), cy: this.cy(y) - this.C * 0.04, hp, ap, hk: this.tk.hitK(p.id, t), face: this.tk.cur.get(p.id), t });
  }
  drawPath(g: G, v: DrawView) {
    const me = v.m.players.find((o) => o.id === v.meId);
    if (!me || !v.plan) return;
    const pts = [{ x: me.x, y: me.y }, ...v.plan.path].map((p) => [this.cx(p.x), this.cy(p.y)] as const);
    g.lineCap = "round"; g.lineJoin = "round";
    g.strokeStyle = "rgba(43,245,255,.18)"; g.lineWidth = 6;
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
    g.strokeStyle = "#7FFAFF"; g.lineWidth = 1.6; g.setLineDash([5, 4]); g.stroke(); g.setLineDash([]);
    const [ex, ey] = pts[pts.length - 1];
    g.globalAlpha = 0.32;
    this.tk.paint(g, { p: me, mine: true, cx: ex, cy: ey - this.C * 0.04, hp: me.hp, ap: me.ap, hk: -1, face: this.tk.cur.get(me.id), t: null, ghost: true });
    g.globalAlpha = 1;
    hexPath(g, ex, ey - this.C * 0.04, this.C * 0.4); g.strokeStyle = "rgba(127,250,255,.8)"; g.lineWidth = 1.2; g.setLineDash([3, 3]); g.stroke(); g.setLineDash([]);
  }
  bracket(g: G, o: Cell, sel: boolean) {
    const C = this.C, X = o.x * C, Y = this.PAD + o.y * C, k = C * 0.24, i = 2;
    const col = sel ? PAL.warn : PAL.foe;
    g.save();
    g.strokeStyle = rgba(col, sel ? 0.3 : 0.18); g.lineWidth = 4; corners(g, X + i, Y + i, C - 2 * i, k); g.stroke();
    g.strokeStyle = col; g.lineWidth = sel ? 1.8 : 1.3; corners(g, X + i, Y + i, C - 2 * i, k); g.stroke();
    g.restore();
    if (sel) {
      const cx = X + C / 2, cy = Y + C / 2;
      g.strokeStyle = rgba(PAL.warn, 0.9); g.lineWidth = 1;
      g.beginPath(); g.arc(cx, cy, C * 0.47, 0, TAU); g.stroke();
      for (let a = 0; a < 4; a++) {
        const an = (a * Math.PI) / 2;
        g.beginPath(); g.moveTo(cx + Math.cos(an) * C * 0.4, cy + Math.sin(an) * C * 0.4); g.lineTo(cx + Math.cos(an) * C * 0.54, cy + Math.sin(an) * C * 0.54); g.stroke();
      }
    }
  }
  attackLine(g: G, from: Cell, o: Cell) {
    const x0 = this.cx(from.x), y0 = this.cy(from.y), x1 = this.cx(o.x), y1 = this.cy(o.y);
    g.strokeStyle = "rgba(255,224,102,.22)"; g.lineWidth = 5; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = "rgba(255,232,140,.95)"; g.lineWidth = 1.3; g.setLineDash([2, 4]); g.stroke(); g.setLineDash([]);
  }
  healRing(g: G, p: Cell) {
    const cx = this.cx(p.x), cy = this.cy(p.y) - this.C * 0.04, r = this.C * 0.5;
    g.strokeStyle = "rgba(93,255,176,.25)"; g.lineWidth = 5; g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke();
    g.strokeStyle = PAL.ok; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.stroke(); g.setLineDash([]);
    g.save(); g.translate(cx + r * 0.7, cy - r * 0.7); const s = this.C * 0.016; g.scale(s, s); g.translate(-12, -12);
    g.fillStyle = PAL.ok; g.fill(gp("cross")); g.restore();
  }

  // ───── эффекты хода (одноразовые) ─────
  fx(g: G, v: DrawView, t: number, zoneShrunk: boolean) {
    const m = v.m, lt = m.lastTurn!, C = this.C;
    const pos = (id: number): [number, number] => {
      const p = m.players.find((o) => o.id === id);
      return p ? [this.cx(p.x), this.cy(p.y) - C * 0.04] : [0, 0];
    };
    g.save(); g.globalCompositeOperation = "lighter"; g.lineCap = "round";
    const dmg: Record<number, number> = {}, firstHit: Record<number, number> = {};
    lt.shots.forEach((s, i) => {
      const ts = T.shot0 + i * T.shotGap, k = (t - ts) / T.travel;
      const shooterMine = s.from === v.meId;
      const col = s.miss ? "#9AA4BA" : shooterMine ? PAL.me : PAL.foe;
      const x0 = this.cx(s.fx), y0 = this.cy(s.fy) - C * 0.04, x1 = this.cx(s.tx), y1 = this.cy(s.ty) - C * 0.04;
      const ex = s.miss ? x1 + (x1 - x0) * 0.25 : x1, ey = s.miss ? y1 + (y1 - y0) * 0.25 : y1;
      if (!s.miss) {
        firstHit[s.to] = Math.min(firstHit[s.to] ?? Infinity, ts + T.travel);
        dmg[s.to] = (dmg[s.to] || 0) + (s.dmg ?? 0);
      }
      if (k < 0) return;
      if (k < 0.8) this.glow(g, x0, y0, C * 0.42 * (1 - k), col, 0.9 * (1 - k));
      const head = clamp01(k), tail = clamp01(k - 0.55), fade = 1 - clamp01((t - ts - T.travel) / 300);
      if (fade <= 0) return;
      const hx = lerp(x0, ex, head), hy = lerp(y0, ey, head), tx = lerp(x0, ex, tail), ty = lerp(y0, ey, tail);
      g.globalAlpha = 0.4 * fade; g.strokeStyle = col; g.lineWidth = 7; g.setLineDash(s.miss ? [4, 5] : []);
      g.beginPath(); g.moveTo(tx, ty); g.lineTo(hx, hy); g.stroke();
      g.globalAlpha = fade; g.lineWidth = 2.2; g.beginPath(); g.moveTo(tx, ty); g.lineTo(hx, hy); g.stroke();
      g.strokeStyle = "#FFFFFF"; g.lineWidth = 1.1; g.beginPath(); g.moveTo(lerp(tx, hx, 0.6), lerp(ty, hy, 0.6)); g.lineTo(hx, hy); g.stroke();
      g.setLineDash([]); g.globalAlpha = 1;
      if (k <= 1) this.glow(g, hx, hy, C * 0.22, col, 0.9);
      const hk = (t - ts - T.travel) / T.flash;
      if (!s.miss && hk >= 0 && hk < 1) {
        this.glow(g, x1, y1, C * (0.35 + 0.6 * hk), shooterMine ? PAL.me : PAL.foe, 1 - hk);
        const ang = Math.atan2(y1 - y0, x1 - x0);
        g.strokeStyle = shooterMine ? "#BFFCFF" : "#FFB3CF"; g.lineWidth = 1.2; g.globalAlpha = 1 - hk;
        for (let j = 0; j < 6; j++) {
          const a = ang + (j - 2.5) * 0.42, d0 = C * (0.2 + 0.35 * hk), d1 = d0 + C * 0.18 * (1 - hk);
          g.beginPath(); g.moveTo(x1 + Math.cos(a) * d0, y1 + Math.sin(a) * d0); g.lineTo(x1 + Math.cos(a) * d1, y1 + Math.sin(a) * d1); g.stroke();
        }
        g.globalAlpha = 1;
      }
    });
    for (const z of lt.zoneHits) {
      dmg[z.who] = (dmg[z.who] || 0) + z.dmg;
      firstHit[z.who] = Math.min(firstHit[z.who] ?? Infinity, T.zone0 - 80);
      const zk = (t - T.zone0 + 80) / 320;
      if (zk >= 0 && zk < 1) {
        const [x, y] = pos(z.who);
        this.glow(g, x, y, C * 0.55, PAL.foe, 0.8 * (1 - zk));
      }
    }
    for (const pk of lt.picks) {
      const k = (t - T.move + 40) / 420;
      if (k < 0 || k >= 1) continue;
      const col = RARITY[lootKey(pk)] ?? "#FFFFFF";
      const x = this.cx(pk.x), y = this.cy(pk.y);
      g.globalAlpha = 1 - k; g.strokeStyle = col; g.lineWidth = 1.5;
      g.beginPath(); g.arc(x, y, C * (0.2 + 0.4 * k), 0, TAU); g.stroke(); g.globalAlpha = 1;
      this.glow(g, x, y - C * 0.3 * k, C * 0.3, col, 0.7 * (1 - k));
    }
    for (const id of lt.deaths) {
      const at = this.deathTime(m, id), k = (t - at) / T.shatter;
      const p = m.players.find((o) => o.id === id);
      if (k < 0 || k >= 1 || !p) continue;
      g.globalCompositeOperation = "source-over";
      this.tk.shatter(g, p, id === v.meId, this.cx(p.x), this.cy(p.y) - C * 0.04, k);
      g.globalCompositeOperation = "lighter";
    }
    if (zoneShrunk && v.prev) {
      const k = (t - T.zone0) / T.zoneDur;
      const pb = zoneBox(m.N, v.prev.stage), nb = zoneBox(m.N, m.stage);
      if (k >= 0 && k < 1 && !pb.closed) {
        const a = this.zoneRect(pb), b = nb.closed ? { x: this.W / 2, y: this.PAD + this.W / 2, w: 0, h: 0 } : this.zoneRect(nb), e = easeOut(k);
        const R = { x: lerp(a.x, b.x, e), y: lerp(a.y, b.y, e), w: lerp(a.w, b.w, e), h: lerp(a.h, b.h, e) };
        g.globalAlpha = 1 - k * 0.7;
        g.strokeStyle = "rgba(255,59,78,.5)"; g.lineWidth = 8; g.strokeRect(R.x, R.y, R.w, R.h);
        g.strokeStyle = "#FFE1EC"; g.lineWidth = 1.6; g.strokeRect(R.x, R.y, R.w, R.h);
        g.globalAlpha = 0.25 * (1 - k); g.fillStyle = "#FF3B4E"; g.fillRect(0, this.PAD, this.W, this.HH - this.PAD);
        g.globalAlpha = 1;
      }
    }
    g.restore();
    g.save();
    g.textAlign = "center"; g.textBaseline = "middle";
    for (const key in dmg) {
      const id = +key, at = firstHit[id], k = (t - at) / T.num;
      if (k < 0 || k >= 1) continue;
      const [x, y] = pos(id), mine = id === v.meId;
      const pop = k < 0.15 ? 1.45 - 3 * k : 1;
      const yy = y - C * 0.55 - C * 0.45 * easeOut(k);
      g.globalAlpha = k > 0.7 ? 1 - (k - 0.7) / 0.3 : 1;
      g.font = `800 ${Math.round(C * 0.36 * pop)}px "JetBrains Mono", monospace`;
      g.lineWidth = 3.5; g.strokeStyle = "rgba(4,5,10,.9)"; g.strokeText(`−${dmg[id]}`, x, yy);
      g.fillStyle = mine ? "#FFE066" : "#FF8FB8"; g.fillText(`−${dmg[id]}`, x, yy);
    }
    g.restore();
  }
  glow(g: G, x: number, y: number, r: number, col: string, a: number) {
    if (a <= 0 || r <= 0) return;
    const s = this.glowSprite(col);
    g.globalAlpha = Math.min(1, a); g.drawImage(s.c, x - r, y - r, r * 2, r * 2); g.globalAlpha = 1;
  }

  // ───── эмбиент оверлея: плазма по кольцу зоны + пульс кромки + «дыхание» своей фишки (~30 к/с) ─────
  shimmerFrame(R: Rect | null, phase: number, now = 650) {
    const g = this.og, D = this.D;
    g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, this.ov.width, this.ov.height);
    g.setTransform(D, 0, 0, D, 0, 0);
    if (R) {
      const P = 2 * (R.w + R.h);
      const at = (s: number): [number, number] => {
        s = ((s % P) + P) % P;
        if (s < R.w) return [R.x + s, R.y];
        if ((s -= R.w) < R.h) return [R.x + R.w, R.y + s];
        if ((s -= R.h) < R.w) return [R.x + R.w - s, R.y + R.h];
        return [R.x, R.y + R.h - (s - R.w)];
      };
      g.globalCompositeOperation = "lighter"; g.lineCap = "round";
      const pu = 0.5 + 0.5 * Math.sin(now / 255);
      g.strokeStyle = `rgba(200,60,74,${0.05 + 0.1 * pu})`; g.lineWidth = 3 + 1.5 * pu; g.strokeRect(R.x - 2, R.y - 2, R.w + 4, R.h + 4);
      const L = Math.min(P * 0.16, this.C * 2.6), n = 10;
      for (const off of [0, P / 2]) {
        const head = phase * P + off;
        for (let i = 0; i < n; i++) {
          const a = at(head - (L * i) / n), b = at(head - (L * (i + 1)) / n);
          if (Math.abs(a[0] - b[0]) > 1 && Math.abs(a[1] - b[1]) > 1) continue;
          const al = 1 - i / n;
          g.strokeStyle = `rgba(220,96,108,${0.26 * al})`; g.lineWidth = 3; g.beginPath(); g.moveTo(a[0], a[1]); g.lineTo(b[0], b[1]); g.stroke();
          g.strokeStyle = `rgba(255,226,230,${0.55 * al})`; g.lineWidth = 1; g.stroke();
        }
        const h = at(head), s = this.glowSprite("#C94452"), r = this.C * 0.24;
        g.drawImage(s.c, h[0] - r, h[1] - r, r * 2, r * 2);
      }
      g.globalCompositeOperation = "source-over";
    }
    this.tk.breath(g, now);
  }
  /** цикл оверлея; при reduced motion — один кадр */
  startShimmer() {
    this.stopShimmer();
    if (reducedMotion()) {
      this.shimmerFrame(this.ringRect, 0.13);
      return;
    }
    this.shimmer.on = true;
    const loop = (now: number) => {
      if (!this.shimmer.on) return;
      this.shimmer.raf = requestAnimationFrame(loop);
      if (document.hidden || now - this.shimmer.last < 33) return;
      this.shimmer.last = now;
      const a = performance.now();
      this.shimmerFrame(this.ringRect, (now / 5200) % 1, now);
      this.perf.shimmer += performance.now() - a;
      this.perf.shimmerN++;
    };
    this.shimmer.raf = requestAnimationFrame(loop);
  }
  stopShimmer() {
    this.shimmer.on = false;
    cancelAnimationFrame(this.shimmer.raf);
  }
  /** игрок вне текущей зоны (для подсказок HUD) */
  static outside(m: Pick<Board, "N" | "stage">, p: Cell) {
    const b = zoneBox(m.N, m.stage);
    return b.closed || !inBox(b, p);
  }
}

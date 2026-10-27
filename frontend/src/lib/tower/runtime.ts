/**
 * «Башня» — отрисовка и цикл. Один <canvas> 2D и ровно один requestAnimationFrame.
 *
 * Бережём ресурсы (docs/DESIGN.md, «Скорость»):
 *  — цикл крутится, только пока идёт забег или доезжают падающие куски и камера; в простое (старт, итог),
 *    при свёрнутом приложении и без канваса на экране — ни одного кадра;
 *  — размер канваса меняется только по ResizeObserver, в кадре нет чтения вёрстки (getBoundingClientRect и т. п.);
 *  — DPR ограничен (2, на слабых 1,5) и один раз снижается до 1,25, если кадры стабильно тяжелее ~24 мс;
 *  — цвета читаются из токенов темы при старте и при смене data-theme — никаких сырых hex в логике;
 *  — без filter / shadowBlur / backdrop-filter, свечение — двойной штрих; вспышка «идеально» — одно угасание, не цикл;
 *  — «уменьшить движение»: без падения кусков, вспышки и сглаживания камеры.
 *
 * Игровые часы идут только в кадрах (не больше 50 мс за кадр) — пауза и свёрнутое приложение их не двигают.
 * Тап оценивается в момент события (event.timeStamp), а не кадра, и пишется в журнал целыми мс (engine.ts).
 */
import { CONFIG, drop, newGame, sliderX, top, type Block, type DropResult, type Game } from "./engine";

export interface RunCallbacks {
  /** бросок принят (идеальный, обычный или промах) */
  onDrop(r: DropResult, g: Game): void;
  /** забег окончен — после промаха; куски ещё падают */
  onOver(g: Game): void;
}

interface Palette {
  skyTop: string;
  skyBottom: string;
  line: string;
  star: string;
  dark: boolean;
}

interface Piece {
  x: number;
  y: number;
  w: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  hue: number;
  age: number;
}

const MAX_DT = 50;
const BLINK_MS = 280;
const PIECE_MS = 1400;
const IGNORE_AFTER_RESUME = 350;

const prefersReduced = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** слабое устройство: мало ядер или памяти — меньше DPR и без лишних штрихов */
export function isLowEnd(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 2;
}

const token = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function readPalette(): Palette {
  const dark = document.documentElement.dataset.theme !== "light";
  return {
    dark,
    skyTop: token(dark ? "--bg-sunken" : "--surface-1", dark ? "#030407" : "#FFFFFF"),
    skyBottom: token(dark ? "--surface-3" : "--surface-3", dark ? "#181C2A" : "#E7EBF2"),
    line: token("--line-strong", dark ? "rgba(150,170,255,.20)" : "rgba(10,20,50,.20)"),
    star: token("--text-2", "#9AA4BA"),
  };
}

/** цвет слоя i: оттенок плывёт от неонового бирюзового по кругу, светлая тема темнее и плотнее */
function layerColors(i: number, dark: boolean) {
  const h = (185 + i * 8) % 360;
  return dark
    ? { fill: `hsla(${h},85%,14%,.94)`, edge: `hsl(${h},100%,62%)`, soft: `hsla(${h},100%,60%,.28)`, top: `hsl(${h},100%,88%)` }
    : { fill: `hsla(${h},75%,90%,.96)`, edge: `hsl(${h},90%,34%)`, soft: `hsla(${h},90%,34%,.20)`, top: `hsl(${h},90%,22%)` };
}

// звёзды фона: фиксированный набор (свой простой генератор, игровой rng не трогаем)
const STARS = (() => {
  const a: number[] = [];
  let s = 12345;
  for (let i = 0; i < 28; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const x = (s >>> 8) / 16777216;
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const y = (s >>> 8) / 16777216;
    a.push(x, y);
  }
  return a;
})();

export class TowerRun {
  private ctx: CanvasRenderingContext2D;
  private g: Game;
  private pal = readPalette();
  private raf = 0;
  private running = false;
  private playing = false;
  private lastNow = 0;
  private clock = 0;
  private ignoreUntil = 0;
  private cssW = 0;
  private cssH = 0;
  private dpr = 1;
  private dprCap: number;
  private downgraded = false;
  private slow = 0;
  private cam = -80;
  private sheetUp = true;
  private pieces: Piece[] = [];
  private flash: { x: number; w: number; level: number; t0: number; hue: number } | null = null;
  private reduced = prefersReduced();
  private lite = isLowEnd();
  private sky: CanvasGradient | null = null;
  private ro: ResizeObserver;
  private mo: MutationObserver;
  private mq: MediaQueryList | null = null;
  private disposed = false;

  constructor(
    private canvas: HTMLCanvasElement,
    private cb: RunCallbacks,
  ) {
    this.ctx = canvas.getContext("2d", { alpha: false })!;
    this.dprCap = this.lite ? 1.5 : 2;
    this.g = newGame(1);
    this.cam = this.camTarget();
    this.ro = new ResizeObserver((e) => {
      const r = e[0]?.contentRect;
      if (r) this.resize(r.width, r.height);
    });
    this.ro.observe(canvas.parentElement ?? canvas);
    this.mo = new MutationObserver(() => {
      this.pal = readPalette();
      this.sky = null;
      this.paintIdle();
    });
    this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    document.addEventListener("visibilitychange", this.onVis);
    try {
      this.mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      this.mq.addEventListener("change", this.onMotion);
    } catch {
      /* старый WebView */
    }
  }

  /** новый забег с этим seed */
  start(seed: number) {
    this.g = newGame(seed);
    this.pieces = [];
    this.flash = null;
    this.clock = 0;
    this.pal = readPalette();
    this.sky = null;
    this.sheetUp = false;
    this.playing = true;
    this.lastNow = performance.now();
    this.ignoreUntil = this.lastNow + 150;
    this.wake();
  }

  /** показать башню без забега (старт, итог) — один кадр */
  idle(seed = 1) {
    this.g = newGame(seed);
    this.pieces = [];
    this.flash = null;
    this.playing = false;
    this.sheetUp = true;
    this.cam = this.camTarget();
    this.paintIdle();
  }

  /** лист старта/итога поверх поля: камера поднимает башню над ним (плавно, если можно) */
  sheet(on: boolean) {
    if (this.sheetUp === on) return;
    this.sheetUp = on;
    if (this.reduced || !this.running) {
      if (this.reduced) this.cam = this.camTarget();
      this.wake();
    }
  }

  /** тап игрока; ts — event.timeStamp */
  tap(ts: number) {
    if (!this.playing || this.g.over) return;
    if (ts < this.ignoreUntil) return;
    const t = Math.max(this.g.spawnT, Math.floor(this.clock + Math.min(Math.max(ts - this.lastNow, 0), MAX_DT)));
    const r = drop(this.g, t);
    if (!r) return;
    const hue = r.level;
    if (r.kind === "perfect") {
      if (!this.reduced) this.flash = { x: r.placed!.x, w: r.placed!.w, level: r.level, t0: this.lastNow, hue };
    } else if (r.cut && !this.reduced) {
      // кусок отлетает в сторону свеса и падает
      const dir = r.cut.x + r.cut.w / 2 < r.drop.x + r.drop.w / 2 ? -1 : 1;
      this.pieces.push({ x: r.cut.x, y: r.level * CONFIG.BLOCK_H, w: r.cut.w, vx: dir * 70, vy: 0, rot: 0, vr: dir * 0.13, hue, age: 0 });
    }
    this.cb.onDrop(r, this.g);
    if (r.kind === "miss") {
      this.playing = false;
      this.cb.onOver(this.g);
    }
    this.wake();
  }

  get game(): Game {
    return this.g;
  }

  /** игровое время, мс (для лабораторного бота, см. pages/Tower.tsx) */
  get time(): number {
    return this.clock + Math.min(Math.max(performance.now() - this.lastNow, 0), MAX_DT);
  }

  destroy() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.running = false;
    this.ro.disconnect();
    this.mo.disconnect();
    document.removeEventListener("visibilitychange", this.onVis);
    this.mq?.removeEventListener("change", this.onMotion);
  }

  // ——— цикл ———

  private onMotion = () => {
    this.reduced = prefersReduced();
  };

  private onVis = () => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.running = false;
    } else {
      this.lastNow = performance.now();
      this.ignoreUntil = this.lastNow + IGNORE_AFTER_RESUME;
      this.wake();
    }
  };

  private wake() {
    if (this.running || this.disposed || document.hidden) return;
    this.running = true;
    this.lastNow = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number) => {
    const raw = now - this.lastNow;
    const dt = Math.min(Math.max(raw, 0), MAX_DT);
    this.lastNow = now;
    if (this.playing) this.clock += dt;
    this.watchLoad(raw);
    const settled = this.update(dt, now);
    this.draw(now);
    if (this.playing || !settled) this.raf = requestAnimationFrame(this.frame);
    else this.running = false;
  };

  /** кадры стабильно тяжёлые — один раз снижаем DPR до 1,25 */
  private watchLoad(raw: number) {
    if (this.downgraded || !this.playing) return;
    this.slow = raw > 24 && raw < 200 ? this.slow + 1 : Math.max(0, this.slow - 2);
    if (this.slow > 45 && this.dprCap > 1.25) {
      this.downgraded = true;
      this.dprCap = 1.25;
      this.resize(this.cssW, this.cssH);
    }
  }

  /** сдвинуть камеру и куски; true — всё улеглось, кадры больше не нужны */
  private update(dt: number, now: number): boolean {
    const target = this.camTarget();
    if (this.reduced) this.cam = target;
    else this.cam += (target - this.cam) * (1 - Math.exp(-dt / 120));
    let moving = Math.abs(target - this.cam) > 0.3;
    if (!moving) this.cam = target;
    const s = dt / 1000;
    for (const p of this.pieces) {
      p.age += dt;
      p.vy -= 2600 * s;
      p.y += p.vy * s;
      p.x += p.vx * s;
      p.rot += p.vr * s;
    }
    if (this.pieces.length) {
      this.pieces = this.pieces.filter((p) => p.age < PIECE_MS && p.y > this.cam - CONFIG.BLOCK_H * 2);
      if (this.pieces.length) moving = true;
    }
    if (this.flash && now - this.flash.t0 < BLINK_MS) moving = true;
    else this.flash = null;
    return !moving;
  }

  // ——— размер ———

  private resize(w: number, h: number) {
    if (w < 2 || h < 2) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const pw = Math.round(w * this.dpr);
    const ph = Math.round(h * this.dpr);
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.sky = null;
    this.paintIdle();
  }

  /** перерисовать один кадр, если цикл стоит */
  private paintIdle() {
    if (!this.running && !this.disposed && this.cssW) this.draw(performance.now());
  }

  // ——— мир → экран ———

  /** px на единицу мира */
  private get k() {
    return (this.cssW * this.dpr) / CONFIG.FIELD;
  }
  private visH() {
    return this.cssH ? (this.cssH * this.dpr) / this.k : 1500;
  }
  private camTarget() {
    const n = this.g.blocks.length * CONFIG.BLOCK_H;
    const v = this.visH();
    // обычно верх башни на 40% высоты; под листом старта/итога — выше, чтобы башню не закрывало
    return this.sheetUp ? Math.max(-0.52 * v, n - 0.62 * v) : Math.max(-0.1 * v, n - 0.4 * v);
  }

  private draw(now: number) {
    const { ctx, pal } = this;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const k = this.k;
    const cam = this.cam;
    const sy = (y: number) => H - (y - cam) * k;

    if (!this.sky) {
      this.sky = ctx.createLinearGradient(0, 0, 0, H);
      this.sky.addColorStop(0, pal.skyTop);
      this.sky.addColorStop(1, pal.skyBottom);
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.sky;
    ctx.fillRect(0, 0, W, H);

    // фон: звёзды (ночью, с параллаксом) и линии каждые 10 блоков
    if (pal.dark && !this.lite) {
      ctx.fillStyle = pal.star;
      ctx.globalAlpha = 0.45;
      const loop = H * 1.4;
      for (let i = 0; i < STARS.length; i += 2) {
        const y = (((STARS[i + 1] * loop - cam * k * 0.12) % loop) + loop) % loop;
        if (y > H) continue;
        const r = (i % 3 === 0 ? 1.6 : 1) * this.dpr;
        ctx.fillRect(STARS[i] * W, y, r, r);
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = this.dpr;
    ctx.globalAlpha = 0.55;
    const step = CONFIG.BLOCK_H * 10;
    ctx.beginPath();
    for (let y = Math.max(step, Math.ceil(cam / step) * step); y < cam + H / k; y += step) {
      const yy = Math.round(sy(y)) + 0.5;
      ctx.moveTo(0, yy);
      ctx.lineTo(W, yy);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // земля
    const gy = sy(0);
    if (gy < H) {
      ctx.fillStyle = pal.skyTop;
      ctx.fillRect(0, gy, W, H - gy);
      ctx.fillStyle = pal.line;
      ctx.fillRect(0, gy, W, Math.max(1, this.dpr));
    }

    // башня (только видимые слои)
    const bh = CONFIG.BLOCK_H * k;
    const blocks = this.g.blocks;
    const first = Math.max(0, Math.floor(cam / CONFIG.BLOCK_H) - 1);
    const last = Math.min(blocks.length - 1, Math.ceil((cam + H / k) / CONFIG.BLOCK_H));
    for (let i = first; i <= last; i++) this.block(blocks[i], i, sy((i + 1) * CONFIG.BLOCK_H), k, bh);

    // скользящий блок + направляющие по краям верха башни
    if (this.playing && !this.g.over) {
      const g = this.g;
      const lvl = blocks.length;
      const cur: Block = { x: sliderX(g, this.clock), w: g.w };
      const base = top(g);
      const y0 = sy(lvl * CONFIG.BLOCK_H);
      ctx.strokeStyle = layerColors(lvl, pal.dark).edge;
      ctx.globalAlpha = 0.22;
      ctx.lineWidth = this.dpr;
      ctx.beginPath();
      for (const x of [base.x, base.x + base.w]) {
        const xx = Math.round(x * k) + 0.5;
        ctx.moveTo(xx, y0);
        ctx.lineTo(xx, y0 + CONFIG.BLOCK_H * k * 1.1);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      this.block(cur, lvl, sy((lvl + 1) * CONFIG.BLOCK_H), k, bh);
    }

    // вспышка идеального: один раз гаснет
    const f = this.flash;
    if (f) {
      const p = (now - f.t0) / BLINK_MS;
      if (p >= 0 && p < 1) {
        const c = layerColors(f.hue, pal.dark);
        const y = sy((f.level + 1) * CONFIG.BLOCK_H);
        const grow = p * 10 * k;
        ctx.globalAlpha = (1 - p) * (1 - p) * 0.9;
        ctx.strokeStyle = c.top;
        ctx.lineWidth = 2 * this.dpr;
        ctx.strokeRect(f.x * k - grow, y - grow, f.w * k + grow * 2, bh + grow * 2);
        ctx.globalAlpha = 1;
      }
    }

    // отрезанные куски
    for (const p of this.pieces) {
      const a = 1 - p.age / PIECE_MS;
      ctx.globalAlpha = Math.max(0, Math.min(1, a * 1.6));
      const cx = (p.x + p.w / 2) * k;
      const cy = sy(p.y + CONFIG.BLOCK_H / 2);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-p.rot);
      this.block({ x: -p.w / 2, w: p.w }, p.hue, 0, k, bh, true);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /** один блок: тёмное тело, двойной неоновый контур, яркая верхняя кромка */
  private block(b: Block, i: number, yTop: number, k: number, bh: number, centered = false) {
    const { ctx } = this;
    const c = layerColors(i, this.pal.dark);
    const x = centered ? b.x * k : Math.round(b.x * k);
    const y = centered ? -bh / 2 : Math.round(yTop);
    const w = Math.max(1, Math.round(b.w * k));
    const h = Math.round(bh) - Math.max(1, Math.round(this.dpr));
    ctx.fillStyle = c.fill;
    ctx.fillRect(x, y, w, h);
    if (!this.lite) {
      ctx.strokeStyle = c.soft;
      ctx.lineWidth = 3.5 * this.dpr;
      ctx.strokeRect(x, y, w, h);
    }
    ctx.strokeStyle = c.edge;
    ctx.lineWidth = 1.5 * this.dpr;
    ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = c.top;
    ctx.fillRect(x, y, w, Math.max(1, Math.round(1.5 * this.dpr)));
  }
}

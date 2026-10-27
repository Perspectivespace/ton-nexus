/**
 * «Башня» — отрисовка и цикл. Один <canvas> 2D и ровно один requestAnimationFrame.
 *
 * Бережём ресурсы (docs/DESIGN.md, «Скорость»):
 *  — цикл крутится, только пока идёт забег или доезжают падающие куски, искры и камера; в простое (старт, итог),
 *    при свёрнутом приложении и без канваса на экране — ни одного кадра;
 *  — размер канваса меняется только по ResizeObserver, в кадре нет чтения вёрстки (getBoundingClientRect и т. п.);
 *  — DPR ограничен (2, на слабых 1,5) и один раз снижается до 1,25, если кадры стабильно тяжелее ~24 мс;
 *  — вся «красота» нарисована заранее на маленьких оффскрин-канвасах: спрайты блоков (тело-стекло, неоновая кромка,
 *    свечение — один раз на оттенок), небо с солнцем и звёздами, два слоя города, пол с сеткой. В кадре — только drawImage;
 *    shadowBlur и градиенты в кадре не создаются (shadowBlur только при заготовке спрайта);
 *  — эффекты комбо (кольцо, блик по кромке, искры, «вырост» блока) короткие, каждый гаснет сам; бесконечных циклов нет;
 *  — оттенки блоков плывут от циана токена --neon к маджента токена --magenta и обратно; это единственные «сырые» цвета
 *    в логике (канвас не читает hex из CSS), остальные цвета (линии) — из токенов темы;
 *  — «уменьшить движение»: без падения кусков, колец, искр и сглаживания камеры.
 *
 * Игровые часы идут только в кадрах (не больше 50 мс за кадр) — пауза и свёрнутое приложение их не двигают.
 * Тап оценивается в момент события (event.timeStamp), а не кадра, и пишется в журнал целыми мс (engine.ts).
 * Вся графика — только отображение: счёт, журнал тапов и движок от неё не зависят.
 */
import { CONFIG, LIMITS, drop, newGame, sliderX, top, type Block, type Booster, type DropResult, type Game } from "./engine";

import { Background, Sprites, stepOf, lineColor, GOLD_KEY } from "./visuals";

export interface RunCallbacks {
  /** бросок принят (идеальный, обычный или промах) */
  onDrop(r: DropResult, g: Game): void;
  /** забег окончен — после промаха; куски ещё падают */
  onOver(g: Game): void;
}

interface Palette {
  line: string;
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
  step: number;
  age: number;
}

/** кольцо вдоль кромки поставленного блока; lv — сила комбо 1…6 */
interface Ring {
  x: number;
  w: number;
  level: number;
  step: number;
  lv: number;
  age: number;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  key: number;
}

/** «вырост» блока на 3+ идеальных подряд: ширина плавно доезжает, по краям — шевроны */
interface Grow {
  level: number;
  fromW: number;
  toX: number;
  toW: number;
  step: number;
  age: number;
}

const MAX_DT = 50;
const PIECE_MS = 1400;
const RING_MS = 420;
const SWEEP_MS = 240;
const GROW_MS = 380;
const GROW_ANIM_MS = 170;
const MAX_SPARKS = 90;
const IGNORE_AFTER_RESUME = 350;

const prefersReduced = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

/** слабое устройство: мало ядер или памяти — меньше DPR и меньше искр */
export function isLowEnd(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number };
  return (n.hardwareConcurrency ?? 8) <= 4 || (n.deviceMemory ?? 8) <= 2;
}

const token = (name: string, fallback: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;

function readPalette(): Palette {
  const dark = document.documentElement.dataset.theme !== "light";
  return {
    dark,
    line: token("--line-strong", dark ? "rgba(150,170,255,.20)" : "rgba(10,20,50,.20)"),
  };
}

const easeOutCubic = (p: number) => 1 - (1 - p) ** 3;
const easeOutBack = (p: number) => 1 + 2.4 * (p - 1) ** 3 + 1.4 * (p - 1) ** 2;

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
  private rings: Ring[] = [];
  private sparks: Spark[] = [];
  private grow: Grow | null = null;
  private reduced = prefersReduced();
  private lite = isLowEnd();
  private spr: Sprites | null = null;
  private bg: Background | null = null;
  private rebuild = false;
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
      this.invalidate();
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

  /** новый забег с этим seed и (необязательно) бустером — их выдаёт сервер */
  start(seed: number, booster: Booster | null = null) {
    this.g = newGame(seed, booster);
    this.clearFx();
    this.clock = 0;
    const was = this.pal.dark;
    this.pal = readPalette();
    if (was !== this.pal.dark) this.invalidate();
    this.sheetUp = false;
    this.playing = true;
    this.lastNow = performance.now();
    this.ignoreUntil = this.lastNow + 150;
    this.wake();
  }

  /** показать башню без забега (старт, итог) — один кадр */
  idle(seed = 1) {
    this.g = newGame(seed);
    this.clearFx();
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
    // слишком быстрый тап (двойное касание) не принимаем: сервер такой журнал всё равно отклонил бы
    if (t - this.g.spawnT < (this.g.taps.length ? LIMITS.MIN_TAP_GAP_MS : LIMITS.MIN_FIRST_TAP_MS)) return;
    const r = drop(this.g, t);
    if (!r) return;
    if (!this.reduced) this.fx(r);
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

  // ——— эффекты (только картинка) ———

  private clearFx() {
    this.pieces = [];
    this.rings = [];
    this.sparks = [];
    this.grow = null;
  }

  private spark(x: number, y: number, vx: number, vy: number, life: number, size: number, key: number) {
    if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
    this.sparks.push({ x, y, vx, vy, age: 0, life, size, key });
  }

  /** эффекты броска: идеальный — кольцо, блик, искры (сильнее с комбо), «вырост»; обрез — падающий кусок и крошка */
  private fx(r: DropResult) {
    const step = stepOf(r.level);
    const topY = (r.level + 1) * CONFIG.BLOCK_H;
    if (r.kind === "perfect" && r.placed) {
      const p = r.placed;
      const lv = Math.min(r.combo, 6);
      this.rings.push({ x: p.x, w: p.w, level: r.level, step, lv, age: 0 });
      if (this.rings.length > 4) this.rings.shift();
      const n = Math.round((4 + 3 * lv) * (this.lite ? 0.5 : 1));
      for (let i = 0; i < n; i++) {
        const gold = lv >= 5 && i % 3 === 0;
        const dir = Math.random() < 0.5 ? -1 : 1;
        this.spark(
          p.x + Math.random() * p.w,
          topY,
          dir * (40 + Math.random() * (140 + 20 * lv)),
          140 + Math.random() * (200 + 30 * lv),
          380 + Math.random() * 280,
          (3 + Math.random() * 4 + lv * 0.7) * 2.2,
          gold ? GOLD_KEY : step,
        );
      }
      if (r.combo >= CONFIG.REGROW_FROM && p.w > r.drop.w) {
        this.grow = { level: r.level, fromW: r.drop.w, toX: p.x, toW: p.w, step, age: 0 };
      }
    } else if (r.cut) {
      // кусок отлетает в сторону свеса и падает
      const dir = r.cut.x + r.cut.w / 2 < r.drop.x + r.drop.w / 2 ? -1 : 1;
      this.pieces.push({ x: r.cut.x, y: r.level * CONFIG.BLOCK_H, w: r.cut.w, vx: dir * 70, vy: 0, rot: 0, vr: dir * 0.13, step, age: 0 });
      // крошка по линии разреза
      const edgeX = dir < 0 ? r.cut.x + r.cut.w : r.cut.x;
      const cnt = this.lite ? 3 : 6;
      for (let i = 0; i < cnt; i++) {
        this.spark(edgeX, topY - Math.random() * CONFIG.BLOCK_H, dir * (30 + Math.random() * 110), 40 + Math.random() * 120, 300 + Math.random() * 220, 5 + Math.random() * 4, step);
      }
    }
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
    const settled = this.update(dt);
    this.draw();
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

  /** сдвинуть камеру и эффекты; true — всё улеглось, кадры больше не нужны */
  private update(dt: number): boolean {
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
    if (this.rings.length) {
      for (const r of this.rings) r.age += dt;
      this.rings = this.rings.filter((r) => r.age < RING_MS + 120);
      if (this.rings.length) moving = true;
    }
    if (this.sparks.length) {
      let n = 0;
      for (const p of this.sparks) {
        p.age += dt;
        p.vy -= 900 * s;
        p.x += p.vx * s;
        p.y += p.vy * s;
        if (p.age < p.life) this.sparks[n++] = p;
      }
      this.sparks.length = n;
      if (n) moving = true;
    }
    if (this.grow) {
      this.grow.age += dt;
      if (this.grow.age >= GROW_MS) this.grow = null;
      else moving = true;
    }
    return !moving;
  }

  // ——— размер и заготовки ———

  private resize(w: number, h: number) {
    if (w < 2 || h < 2) return;
    this.cssW = w;
    this.cssH = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, this.dprCap);
    const pw = Math.round(w * this.dpr);
    const ph = Math.round(h * this.dpr);
    if (this.canvas.width !== pw) this.canvas.width = pw;
    if (this.canvas.height !== ph) this.canvas.height = ph;
    this.invalidate();
    this.paintIdle();
  }

  /** размер или тема сменились — заготовки перерисуются при ближайшем кадре */
  private invalidate() {
    this.spr = null;
    this.bg = null;
  }

  /** перерисовать один кадр, если цикл стоит */
  private paintIdle() {
    if (!this.running && !this.disposed && this.cssW) this.draw();
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

  private draw() {
    const { ctx, pal } = this;
    const dark = pal.dark;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const k = this.k;
    const cam = this.cam;
    const d = this.dpr;
    const sy = (y: number) => H - (y - cam) * k;
    const bh = CONFIG.BLOCK_H * k;

    const spr = (this.spr ??= new Sprites(dark, d, bh));
    const bg = (this.bg ??= new Background(W, H, d, dark, !this.lite));
    // части фона собираются по одной за кадр; в простое дорисуем сами
    if ((bg.step() || spr.warm()) && !this.running && !this.rebuild) {
      this.rebuild = true;
      requestAnimationFrame(() => {
        this.rebuild = false;
        this.paintIdle();
      });
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.imageSmoothingEnabled = true;

    // небо: по мере подъёма окно сдвигается вверх по высокой текстуре — от закатной дымки к глубокому космосу
    if (bg.sky) {
      const srcY = Math.max(0, Math.min(bg.sky.h - H, bg.sky.h - H - Math.max(0, cam) * k * 0.2));
      const K = bg.sky.k;
      ctx.drawImage(bg.sky.c, 0, srcY * K, W * K, H * K, 0, 0, W, H);
    } else {
      ctx.fillStyle = dark ? "#03040a" : "#c9b8ff";
      ctx.fillRect(0, 0, W, H);
    }

    // город: два слоя с параллаксом, уезжают вниз, когда башня вырастает
    const gy = sy(0);
    if (bg.cityFar) {
      const y = Math.round(H + cam * k * 0.28);
      if (y - bg.cityFar.height < H) ctx.drawImage(bg.cityFar, 0, y - bg.cityFar.height);
    }
    if (bg.cityNear) {
      const y = Math.round(H + cam * k * 0.55);
      if (y - bg.cityNear.height < H) ctx.drawImage(bg.cityNear, 0, y - bg.cityNear.height);
    }

    // линии высоты каждые 10 блоков
    ctx.strokeStyle = pal.line;
    ctx.lineWidth = d;
    ctx.globalAlpha = 0.5;
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
    if (gy < H && bg.ground) {
      const y = Math.round(gy);
      ctx.drawImage(bg.ground.c, 0, y);
      const end = y + bg.ground.c.height;
      if (end < H) {
        ctx.fillStyle = bg.ground.bottom;
        ctx.fillRect(0, end, W, H - end);
      }
    }

    // башня (только видимые слои)
    const blocks = this.g.blocks;
    const first = Math.max(0, Math.floor(cam / CONFIG.BLOCK_H) - 1);
    const last = Math.min(blocks.length - 1, Math.ceil((cam + H / k) / CONFIG.BLOCK_H));
    const gr = this.grow;
    for (let i = first; i <= last; i++) {
      let b = blocks[i];
      if (gr && gr.level === i) {
        // «вырост»: ширина плавно доезжает с небольшим перелётом
        const e = easeOutBack(Math.min(1, gr.age / GROW_ANIM_MS));
        const w = gr.fromW + (gr.toW - gr.fromW) * e;
        b = { x: gr.toX + gr.toW / 2 - w / 2, w };
      }
      this.block(spr, b, stepOf(i), Math.round(sy((i + 1) * CONFIG.BLOCK_H)), k);
    }

    // скользящий блок + направляющие по краям верха башни
    if (this.playing && !this.g.over) {
      const g = this.g;
      const lvl = blocks.length;
      const cur: Block = { x: sliderX(g, this.clock), w: g.w };
      const base = top(g);
      const y0 = sy(lvl * CONFIG.BLOCK_H);
      const st = stepOf(lvl);
      ctx.strokeStyle = lineColor(st, dark);
      ctx.globalAlpha = 0.28;
      ctx.lineWidth = d;
      ctx.beginPath();
      for (const x of [base.x, base.x + base.w]) {
        const xx = Math.round(x * k) + 0.5;
        ctx.moveTo(xx, y0);
        ctx.lineTo(xx, y0 + bh * 1.1);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // бустер «Прицел»: тонкая линия на идеальной точке первые AIM_BLOCKS блоков (только картинка, на счёт не влияет)
      if (g.booster === "aim" && lvl - 1 < CONFIG.AIM_BLOCKS) {
        const xx = Math.round(base.x * k) + 0.5;
        ctx.strokeStyle = lineColor(st, dark);
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = Math.max(1, d);
        ctx.beginPath();
        ctx.moveTo(xx, y0 - bh * 1.6);
        ctx.lineTo(xx, y0 + bh * 1.1);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      // аура серии: статичное пятно света за скользящим блоком, сильнее с комбо
      if (g.combo >= 2 && !this.reduced) {
        const lv = Math.min(g.combo, 6);
        const gl = spr.glow(lv >= 5 ? GOLD_KEY : st);
        const bx = cur.x * k;
        const bw = cur.w * k;
        const padx = bh * 0.9;
        ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
        ctx.globalAlpha = Math.min(0.55, 0.12 + 0.07 * lv) * (dark ? 1 : 0.8);
        ctx.drawImage(gl, bx - padx, y0 - bh * 0.45, bw + padx * 2, bh * 1.9);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
      this.block(spr, cur, st, Math.round(sy((lvl + 1) * CONFIG.BLOCK_H)), k);
    }

    this.drawFx(spr, sy, k, bh);
  }

  /** кольца, блик по кромке, искры, шевроны «выроста», падающие куски */
  private drawFx(spr: Sprites, sy: (y: number) => number, k: number, bh: number) {
    const { ctx } = this;
    const dark = this.pal.dark;
    const d = this.dpr;

    for (const r of this.rings) {
      const p = r.age / RING_MS;
      const hot = r.lv >= 5 ? GOLD_KEY : r.step;
      const y = sy((r.level + 1) * CONFIG.BLOCK_H);
      // два кольца при сильном комбо: второе идёт следом и шире
      const passes = r.lv >= 4 ? 2 : 1;
      for (let n = 0; n < passes; n++) {
        const pp = p - n * 0.22;
        if (pp <= 0 || pp >= 1) continue;
        const grow = easeOutCubic(pp) * (7 + 3 * r.lv + n * 6) * k;
        const a = (1 - pp) * (1 - pp);
        ctx.strokeStyle = lineColor(hot, dark, 0.2 * a);
        ctx.lineWidth = (2.5 + r.lv * 0.4) * d;
        ctx.strokeRect(r.x * k - grow, y - grow, r.w * k + grow * 2, bh + grow * 2);
        ctx.strokeStyle = lineColor(hot, dark, 0.95 * a);
        ctx.lineWidth = (1.4 + r.lv * 0.2) * d;
        ctx.strokeRect(r.x * k - grow, y - grow, r.w * k + grow * 2, bh + grow * 2);
      }
      // блик пробегает по верхней кромке слева направо
      const u = r.age / SWEEP_MS;
      if (u < 1) {
        const gl = spr.glow(hot);
        const seg = (r.w * 0.38 + 26) * k;
        const cx = r.x * k + r.w * k * u;
        ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
        ctx.globalAlpha = Math.sin(Math.PI * u) * (0.55 + 0.07 * r.lv);
        ctx.drawImage(gl, cx - seg, y - bh * 0.55, seg * 2, bh * 1.1);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }
    }

    // искры: мягкие пятна, угасают за 0,4–0,7 с
    if (this.sparks.length) {
      ctx.globalCompositeOperation = dark ? "lighter" : "source-over";
      for (const p of this.sparks) {
        const a = 1 - p.age / p.life;
        const sz = p.size * d * (0.55 + 0.45 * a);
        ctx.globalAlpha = a * a * (dark ? 1 : 0.9);
        ctx.drawImage(spr.glow(p.key), p.x * k - sz / 2, sy(p.y) - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
    }

    // «вырост»: шевроны ‹ › у концов блока расходятся и гаснут
    const gr = this.grow;
    if (gr) {
      const p = gr.age / GROW_MS;
      const e = easeOutCubic(p);
      const y = sy((gr.level + 1) * CONFIG.BLOCK_H) + bh / 2;
      const s = bh * 0.2;
      const off = (6 + 14 * e) * k;
      ctx.strokeStyle = lineColor(gr.step, dark, 1);
      ctx.globalAlpha = (1 - p) * (1 - p);
      ctx.lineWidth = 2 * d;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      const lx = gr.toX * k - off;
      const rx = (gr.toX + gr.toW) * k + off;
      ctx.moveTo(lx + s, y - s);
      ctx.lineTo(lx, y);
      ctx.lineTo(lx + s, y + s);
      ctx.moveTo(rx - s, y - s);
      ctx.lineTo(rx, y);
      ctx.lineTo(rx - s, y + s);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // отрезанные куски: падают, вращаются и гаснут
    for (const p of this.pieces) {
      const a = 1 - p.age / PIECE_MS;
      ctx.globalAlpha = Math.max(0, Math.min(1, a * 1.6));
      const cx = (p.x + p.w / 2) * k;
      const cy = sy(p.y + CONFIG.BLOCK_H / 2);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-p.rot);
      this.block(spr, { x: -p.w / 2, w: p.w }, p.step, -Math.round(spr.bodyH / 2), k, true);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  /** один блок: спрайт «стекло + неоновая кромка + свечение», растянутый по ширине (три части) */
  private block(spr: Sprites, b: Block, step: number, yTop: number, k: number, centered = false) {
    const x = centered ? Math.round(b.x * k) : Math.round(b.x * k);
    const w = Math.max(1, Math.round(b.w * k));
    spr.blit(this.ctx, spr.block(step), x, yTop, w);
  }
}

/**
 * «Башня» — заготовки графики. Всё рисуется один раз на оффскрин-канвасах (при смене размера/темы),
 * в кадре runtime.ts только копирует их через drawImage. Игровой логики здесь нет.
 */

/** цвета блоков: оттенок плывёт от циана (--neon) к маджента (--magenta) и обратно, 36 шагов в одну сторону */
export const HUE_A = 184;
export const HUE_B = 334;
export const HUE_STEPS = 36;
/** янтарный (--amber) — для искр на высоких комбо */
export const GOLD_KEY = 99;
const GOLD_HUE = 42;

/** шаг палитры для слоя i: треугольная волна 0…HUE_STEPS…0 */
export function stepOf(i: number): number {
  const period = HUE_STEPS * 2;
  const p = ((i % period) + period) % period;
  return p <= HUE_STEPS ? p : period - p;
}
export const hueOf = (step: number): number => (step === GOLD_KEY ? GOLD_HUE : Math.round(HUE_A + ((HUE_B - HUE_A) * step) / HUE_STEPS));

/** цвет линии/кольца для шага: ночью светлее, днём плотнее */
export const lineColor = (step: number, dark: boolean, alpha = 1): string =>
  dark ? `hsla(${hueOf(step)},100%,72%,${alpha})` : `hsla(${hueOf(step)},100%,36%,${alpha})`;

export interface BlockSprite {
  c: HTMLCanvasElement;
  /** поля вокруг тела под свечение, px */
  pad: number;
  /** ширина каждой из двух «шапок» (концы блока), px; середина (mid) растягивается */
  cap: number;
  mid: number;
  w: number;
  h: number;
}

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext("2d")!];
}

/** простой детерминированный генератор для декора (игровой rng не трогаем) */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return (s >>> 8) / 16777216;
  };
}

/** Спрайты блоков и «пятен света»: ленивая заготовка по шагам палитры */
export class Sprites {
  private blocks = new Map<number, BlockSprite>();
  private glows = new Map<number, HTMLCanvasElement>();
  readonly pad: number;
  readonly cap: number;
  readonly chamfer: number;
  /** высота тела блока, px */
  readonly bodyH: number;

  constructor(
    readonly dark: boolean,
    readonly d: number,
    blockPx: number,
  ) {
    this.pad = Math.round(9 * d);
    this.cap = Math.round(10 * d);
    this.chamfer = Math.round(4 * d);
    this.bodyH = Math.max(8, Math.round(blockPx) - Math.max(1, Math.round(d)));
  }

  private warmed = 0;
  /** в простое заранее готовим спрайты первых слоёв и искр — по паре за кадр; false — всё готово */
  warm(): boolean {
    if (this.warmed > 12) return false;
    const i = this.warmed++;
    if (i === 12) this.glow(GOLD_KEY);
    else {
      this.block(i);
      this.glow(i);
    }
    return true;
  }

  block(step: number): BlockSprite {
    let s = this.blocks.get(step);
    if (!s) {
      s = this.makeBlock(step);
      this.blocks.set(step, s);
    }
    return s;
  }

  glow(step: number): HTMLCanvasElement {
    let g = this.glows.get(step);
    if (!g) {
      g = this.makeGlow(step);
      this.glows.set(step, g);
    }
    return g;
  }

  /** x, y — левый верхний угол тела блока (целые px), w — ширина тела */
  blit(ctx: CanvasRenderingContext2D, s: BlockSprite, x: number, y: number, w: number) {
    const { pad, cap, mid, c } = s;
    const yy = y - pad;
    if (w >= cap * 2) {
      ctx.drawImage(c, 0, 0, pad + cap, s.h, x - pad, yy, pad + cap, s.h);
      ctx.drawImage(c, pad + cap, 0, mid, s.h, x + cap, yy, w - cap * 2, s.h);
      ctx.drawImage(c, s.w - pad - cap, 0, pad + cap, s.h, x + w - cap, yy, pad + cap, s.h);
    } else {
      // узкий блок: берём по половине каждой шапки
      const lw = w >> 1;
      const rw = w - lw;
      if (lw > 0) ctx.drawImage(c, 0, 0, pad + lw, s.h, x - pad, yy, pad + lw, s.h);
      ctx.drawImage(c, s.w - pad - rw, 0, pad + rw, s.h, x + w - rw, yy, pad + rw, s.h);
    }
  }

  private makeBlock(step: number): BlockSprite {
    const { d, pad, cap, bodyH, dark, chamfer: ch } = this;
    const mid = 4;
    const bw = cap * 2 + mid;
    const w = bw + pad * 2;
    const h = bodyH + pad * 2;
    const [c, x] = canvas(w, h);
    const hue = hueOf(step);
    const x0 = pad;
    const y0 = pad;
    const x1 = pad + bw;
    const y1 = pad + bodyH;
    // скос — левый верх и правый низ: как фаски панелей приложения
    const path = () => {
      x.beginPath();
      x.moveTo(x0 + ch, y0);
      x.lineTo(x1, y0);
      x.lineTo(x1, y1 - ch);
      x.lineTo(x1 - ch, y1);
      x.lineTo(x0, y1);
      x.lineTo(x0, y0 + ch);
      x.closePath();
    };

    // свечение: тень от непрозрачного тела (shadowBlur только здесь, один раз)
    x.save();
    x.shadowColor = dark ? `hsla(${hue},100%,60%,.9)` : `hsla(${hue},100%,48%,.55)`;
    x.shadowBlur = pad * 0.95;
    x.fillStyle = `hsl(${hue},70%,${dark ? 10 : 46}%)`;
    path();
    x.fill();
    x.restore();

    // тело: тёмное стекло ночью, насыщенный «леденец» днём
    const g = x.createLinearGradient(0, y0, 0, y1);
    if (dark) {
      g.addColorStop(0, `hsl(${hue},62%,27%)`);
      g.addColorStop(0.5, `hsl(${hue},68%,13%)`);
      g.addColorStop(1, `hsl(${hue},78%,8%)`);
    } else {
      g.addColorStop(0, `hsl(${hue},100%,70%)`);
      g.addColorStop(0.55, `hsl(${hue},96%,56%)`);
      g.addColorStop(1, `hsl(${hue},96%,44%)`);
    }
    x.fillStyle = g;
    path();
    x.fill();

    x.save();
    path();
    x.clip();
    // блик стекла на верхней половине
    const sheen = x.createLinearGradient(0, y0, 0, y0 + bodyH * 0.5);
    sheen.addColorStop(0, dark ? "rgba(255,255,255,.20)" : "rgba(255,255,255,.55)");
    sheen.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = sheen;
    x.fillRect(x0, y0, bw, bodyH * 0.5);
    // нижний подсвет
    const under = x.createLinearGradient(0, y1, 0, y1 - bodyH * 0.38);
    under.addColorStop(0, dark ? `hsla(${hue},100%,58%,.34)` : `hsla(${hue},100%,24%,.30)`);
    under.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = under;
    x.fillRect(x0, y1 - bodyH * 0.38, bw, bodyH * 0.38);
    x.restore();

    // внутренняя тонкая рамка
    x.strokeStyle = dark ? `hsla(${hue},100%,85%,.18)` : "rgba(255,255,255,.38)";
    x.lineWidth = Math.max(1, d * 0.8);
    x.strokeRect(x0 + 2.5 * d, y0 + 2.5 * d, bw - 5 * d, bodyH - 5 * d);

    // неоновая кромка
    x.strokeStyle = dark ? `hsl(${hue},100%,64%)` : `hsl(${hue},100%,30%)`;
    x.lineWidth = 1.5 * d;
    path();
    x.stroke();

    // тонкий светлый блик по верхней грани
    x.fillStyle = dark ? `hsl(${hue},100%,93%)` : "rgba(255,255,255,.95)";
    x.fillRect(x0 + ch, y0, bw - ch, Math.max(1, Math.round(1.5 * d)));

    return { c, pad, cap, mid, w, h };
  }

  /** мягкое пятно света для искр, блика и ауры */
  private makeGlow(step: number): HTMLCanvasElement {
    const size = 64;
    const hue = hueOf(step);
    const [c, x] = canvas(size, size);
    const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    if (this.dark) {
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.16, `hsla(${hue},100%,82%,.95)`);
      g.addColorStop(0.5, `hsla(${hue},100%,58%,.34)`);
      g.addColorStop(1, `hsla(${hue},100%,55%,0)`);
    } else {
      // днём: белое ядро и сочный ореол — на светлом фоне искра читается, а не выглядит пятном
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.22, `hsla(${hue},100%,62%,.95)`);
      g.addColorStop(0.55, `hsla(${hue},100%,58%,.35)`);
      g.addColorStop(1, `hsla(${hue},100%,58%,0)`);
    }
    x.fillStyle = g;
    x.fillRect(0, 0, size, size);
    return c;
  }
}

export interface SkyTex {
  /** высокая текстура неба: низ — у горизонта, выше — глубже в космос */
  c: HTMLCanvasElement;
  /** во сколько раз текстура мельче экрана, и её высота в px экрана */
  k: number;
  h: number;
}
export interface GroundTex {
  c: HTMLCanvasElement;
  bottom: string;
}

/**
 * Фон собирается по частям (небо, пол, ближний и дальний город) — по одной за кадр, чтобы заготовка не давала долгой
 * задачи на слабом телефоне. Пока части нет, она просто не рисуется.
 */
export class Background {
  sky: SkyTex | null = null;
  ground: GroundTex | null = null;
  cityNear: HTMLCanvasElement | null = null;
  cityFar: HTMLCanvasElement | null = null;
  constructor(
    private W: number,
    private H: number,
    private d: number,
    private dark: boolean,
    private withFar: boolean,
  ) {}

  get ready(): boolean {
    return !!(this.sky && this.ground && this.cityNear && (this.cityFar || !this.withFar));
  }

  /** собрать следующую недостающую часть; false — всё готово */
  step(): boolean {
    const { W, H, d, dark } = this;
    if (!this.sky) this.sky = buildSky(W, H, d, dark);
    else if (!this.ground) this.ground = buildGround(W, H, d, dark);
    else if (!this.cityNear) this.cityNear = makeCity(W, Math.round(H * 0.44), d, dark, 4242, false);
    else if (!this.cityFar && this.withFar) this.cityFar = makeCity(W, Math.round(H * 0.3), d, dark, 777, true);
    return !this.ready;
  }
}

function buildSky(W: number, H: number, d: number, dark: boolean): SkyTex {
  // небо — плавные градиенты, поэтому текстура вдвое мельче экрана (4× меньше пикселей на заготовку), в кадре растягивается
  const SK = 0.5;
  const texH = Math.round(H * 2.4);
  const [sky, s] = canvas(W * SK, texH * SK);
  s.scale(SK, SK);
  const g = s.createLinearGradient(0, 0, 0, texH);
  if (dark) {
    g.addColorStop(0, "hsl(232,70%,3%)");
    g.addColorStop(0.45, "hsl(250,62%,8%)");
    g.addColorStop(0.75, "hsl(268,66%,15%)");
    g.addColorStop(0.92, "hsl(300,72%,22%)");
    g.addColorStop(1, "hsl(330,82%,28%)");
  } else {
    g.addColorStop(0, "hsl(226,92%,72%)");
    g.addColorStop(0.5, "hsl(262,88%,82%)");
    g.addColorStop(0.8, "hsl(308,92%,86%)");
    g.addColorStop(1, "hsl(342,100%,84%)");
  }
  s.fillStyle = g;
  s.fillRect(0, 0, W, texH);

  // неоновая дымка у горизонта: циан слева, маджента справа
  const haze = (cx: number, cy: number, r: number, hue: number, a: number) => {
    const rg = s.createRadialGradient(cx, cy, 0, cx, cy, r);
    rg.addColorStop(0, `hsla(${hue},100%,${dark ? 55 : 60}%,${a})`);
    rg.addColorStop(1, `hsla(${hue},100%,55%,0)`);
    s.fillStyle = rg;
    s.fillRect(0, texH - H * 1.1, W, H * 1.1);
  };
  haze(W * 0.15, texH - H * 0.16, W * 0.85, 184, dark ? 0.26 : 0.4);
  haze(W * 0.9, texH - H * 0.24, W * 0.95, 334, dark ? 0.26 : 0.38);

  // солнце в стиле synthwave: диск с горизонтальными прорезями в нижней половине
  const R = W * 0.3;
  const [sun, u] = canvas(R * 2, R * 2);
  const sg = u.createLinearGradient(0, 0, 0, R * 2);
  sg.addColorStop(0, "hsl(48,100%,64%)");
  sg.addColorStop(0.55, "hsl(18,100%,60%)");
  sg.addColorStop(1, "hsl(334,100%,56%)");
  u.fillStyle = sg;
  u.beginPath();
  u.arc(R, R, R, 0, Math.PI * 2);
  u.fill();
  u.globalCompositeOperation = "destination-out";
  for (let j = 0; j < 6; j++) {
    const yy = R + R * (0.18 + j * 0.15);
    u.fillRect(0, yy, R * 2, (1.4 + j * 1.3) * d);
  }
  s.globalAlpha = dark ? 0.5 : 0.82;
  s.drawImage(sun, W / 2 - R, texH - H * 0.3 - R);
  s.globalAlpha = 1;

  // звёзды (ночью): неподвижная часть текстуры
  if (dark) {
    const rnd = lcg(12345);
    for (let i = 0; i < 120; i++) {
      const y = rnd() * texH * 0.8;
      const near = y / (texH * 0.8);
      s.globalAlpha = 0.25 + rnd() * 0.6 * (1 - near * 0.5);
      s.fillStyle = rnd() < 0.2 ? "hsl(184,100%,85%)" : "hsl(230,60%,92%)";
      const r = (rnd() < 0.15 ? 2.4 : 1.6) * d;
      s.fillRect(Math.round(rnd() * W), Math.round(y), r, r);
    }
    s.globalAlpha = 1;
  }

  return { c: sky, k: SK, h: texH };
}

function buildGround(W: number, H: number, d: number, dark: boolean): GroundTex {
  // пол: градиент + сетка в перспективе + неоновая линия горизонта
  const gh = Math.round(H * 0.26);
  const [ground, q] = canvas(W, gh);
  const bottom = dark ? "hsl(270,60%,6%)" : "hsl(276,70%,88%)";
  const gg = q.createLinearGradient(0, 0, 0, gh);
  gg.addColorStop(0, dark ? "hsl(285,62%,11%)" : "hsl(300,80%,90%)");
  gg.addColorStop(1, bottom);
  q.fillStyle = gg;
  q.fillRect(0, 0, W, gh);
  q.strokeStyle = dark ? "hsla(184,100%,60%,.30)" : "hsla(318,90%,46%,.42)";
  q.lineWidth = Math.max(1, d * 0.8);
  q.beginPath();
  for (let j = -14; j <= 14; j++) {
    q.moveTo(W / 2 + j * W * 0.012, 0);
    q.lineTo(W / 2 + j * W * 0.12, gh);
  }
  for (let t = 1; t <= 6; t++) {
    const yy = Math.round(gh * (t / 6) ** 2) + 0.5;
    q.moveTo(0, yy);
    q.lineTo(W, yy);
  }
  q.stroke();
  const hl = q.createLinearGradient(0, 0, 0, 12 * d);
  hl.addColorStop(0, dark ? "hsla(184,100%,60%,.45)" : "hsla(334,100%,50%,.4)");
  hl.addColorStop(1, "rgba(0,0,0,0)");
  q.fillStyle = hl;
  q.fillRect(0, 0, W, 12 * d);
  q.fillStyle = dark ? "hsl(184,100%,68%)" : "hsl(334,100%,44%)";
  q.fillRect(0, 0, W, Math.max(1, Math.round(1.5 * d)));

  return { c: ground, bottom };
}

/** слой города: силуэты с окнами и неоновой кромкой крыш; far — светлее и в дымке */
function makeCity(W: number, hMax: number, d: number, dark: boolean, seed: number, far: boolean): HTMLCanvasElement {
  const [c, x] = canvas(W, hMax);
  const rnd = lcg(seed);
  const body = dark ? (far ? "hsl(258,48%,13%)" : "hsl(250,52%,6%)") : far ? "hsl(266,60%,66%)" : "hsl(256,58%,34%)";
  const neon = [184, 334, 42, 280];
  let px = -Math.round(rnd() * 20 * d);
  while (px < W) {
    const bw = Math.round((far ? 22 + rnd() * 34 : 18 + rnd() * 40) * d);
    const bh = Math.round(hMax * (0.28 + rnd() * 0.72));
    const by = hMax - bh;
    x.fillStyle = body;
    x.fillRect(px, by, bw, bh);
    let ty = by;
    if (rnd() < 0.4) {
      const sw = Math.round(bw * (0.45 + rnd() * 0.3));
      const sh = Math.round(hMax * (0.06 + rnd() * 0.1));
      x.fillRect(px + ((bw - sw) >> 1), by - sh, sw, sh);
      ty = by - sh;
    }
    if (!far && rnd() < 0.22) {
      x.fillRect(px + (bw >> 1), ty - Math.round((10 + rnd() * 16) * d), Math.max(1, Math.round(d)), Math.round((10 + rnd() * 16) * d));
    }
    if (rnd() < (far ? 0.25 : 0.45)) {
      x.fillStyle = `hsl(${neon[Math.floor(rnd() * 4)]},100%,${dark ? 62 : 50}%)`;
      x.globalAlpha = far ? 0.55 : 0.95;
      x.fillRect(px, ty, bw, Math.max(1, Math.round(1.3 * d)));
      x.globalAlpha = 1;
    }
    // окна
    const cell = Math.round(6 * d);
    const dens = far ? 0.07 : 0.16;
    for (let wy = by + cell; wy < hMax - cell; wy += cell) {
      for (let wx = px + cell; wx < px + bw - cell; wx += cell) {
        if (rnd() > dens) continue;
        const hue = rnd() < 0.5 ? 184 : rnd() < 0.5 ? 334 : 42;
        x.fillStyle = dark ? `hsl(${hue},100%,${far ? 52 : 66}%)` : `hsl(${hue === 184 ? 190 : hue},100%,${far ? 80 : 86}%)`;
        x.globalAlpha = far ? 0.55 : 0.9;
        x.fillRect(wx, wy, Math.round(2.2 * d), Math.round(2.2 * d));
      }
    }
    x.globalAlpha = 1;
    px += bw + Math.round(rnd() * 3 * d);
  }
  if (far) {
    // дымка к основанию
    x.globalCompositeOperation = "source-atop";
    const fog = x.createLinearGradient(0, 0, 0, hMax);
    fog.addColorStop(0, "rgba(0,0,0,0)");
    fog.addColorStop(1, dark ? "hsla(300,70%,26%,.7)" : "hsla(330,100%,90%,.75)");
    x.fillStyle = fog;
    x.fillRect(0, 0, W, hMax);
    x.globalCompositeOperation = "source-over";
  }
  return c;
}

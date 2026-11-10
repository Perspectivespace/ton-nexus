import {
  camBounds, clamp, clampCam, easeInOut, glideStep, inBounds, isDrag, layerShift, lerpCam, releaseVelocity, rubber,
  WALK_STREET, WALK_ZOOM, type Bounds, type Cam, type Sample, type Vec,
} from "@/lib/walkMath";
import { ARRIVE_MS, edgePull, nearEdge, type Dir } from "@/lib/districtNav";
import type { EdgeState } from "@/lib/districtCamera";

/**
 * Камера «Прогулки» (DOM-часть; математика — walkMath.ts).
 * — Пролёт на входе (~0.8 с): с вида главной город приближается и опускается к улице; на выходе — обратно.
 * — Панорама пальцем со «резинкой» и инерцией; касание (без протяжки) по-прежнему открывает вывеску.
 * — Слои глубины двигаются с разной скоростью (параллакс), наклон телефона добавляет лёгкий сдвиг.
 * Всё — transform/translate из одного requestAnimationFrame, который работает только пока есть движение.
 * Бесконечных CSS-анимаций нет; на «меньше движения» пролёта и инерции нет.
 */

/** слои глубины поверх цельного кадра: k < 1 — дальше города, k > 1 — ближе */
export const DEPTH_LAYERS: { sel: string; k: number }[] = [
  // небо: облака, звёзды, дальние борта и дрон (за башней их закрывает копия башни — она в слое города)
  { sel: ".cv2-back > .drone, .cv2-back > .craft, .cv2-back > .sky, .cv2-sun > .clouds, .cv2-sun > .dk-stars", k: 0.72 },
  // дальняя трасса «Прогулки» за башней
  { sel: ".cv2-back > .walk-far", k: 0.88 },
  // ближний туман и борт перед башней
  { sel: ".cv2-life > .fog.f-near, .cv2-life > .craft.front", k: 1.12 },
  // дождь — передний план
  { sel: ".cv2-life > .rain", k: 1.35 },
];
/** сдвиг главной под «окно в город» (html.cv2-home в city.css) */
export const HOME_SHIFT = -120;
const FLY_IN = 800;
const FLY_OUT = 600;
const FOCUS = 450;
const TILT_CAM_PX = 8;
const IGNORE = ".walk-top, .walk-tools, .cad-card";

type Tween = { from: Cam; to: Cam; t0: number; dur: number; done?: () => void };
type Drag = { id: number; x0: number; y0: number; cam0: Cam; samples: Sample[]; moved: boolean };

let current: WalkCamera | null = null;
export const getWalkCamera = () => current;

export class WalkCamera {
  private cam: Cam = { x: 0, y: 0, s: 1 };
  private home: Cam = { x: 0, y: 0, s: 1 };
  private rest: Cam = { x: 0, y: 0, s: 1 };
  private tilt: Vec = { x: 0, y: 0 };
  private tiltT: Vec = { x: 0, y: 0 };
  private v: Vec = { x: 0, y: 0 };
  private tw: Tween | null = null;
  private gliding = false;
  private drag: Drag | null = null;
  private raf = 0;
  private last = 0;
  private frames = 0;
  private extraBottom = 0;
  private suppressUntil = 0;
  private layers: { el: HTMLElement; k: number }[] = [];
  private leaving = false;
  /** размеры сцены и окна: читаются из вёрстки один раз за жест/пролёт, а не каждый кадр (иначе — принудительный пересчёт стилей) */
  private dimsCache: { sw: number; sh: number; vw: number; vh: number } | null = null;
  private ro: ResizeObserver | null = null;
  private moving = false;
  /** кадров отрисовано (для замеров) */
  rendered = 0;

  constructor(
    private stage: HTMLElement,
    private opts: {
      flight: boolean;
      inertia: boolean;
      /** районы (PR 3): протяжка за край кадра — к соседу; true — переход начался */
      onEdge?: (dir: Dir) => boolean;
      onPull?: (s: EdgeState) => void;
    },
  ) {
    current = this;
    window.addEventListener("pointerdown", this.onDown, { passive: true });
    window.addEventListener("pointermove", this.onMove, { passive: true });
    window.addEventListener("pointerup", this.onUp, { passive: true });
    window.addEventListener("pointercancel", this.onUp, { passive: true });
    window.addEventListener("click", this.onClick, true);
    window.addEventListener("resize", this.onResize);
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => (this.dimsCache = null));
      this.ro.observe(stage);
      if (stage.parentElement) this.ro.observe(stage.parentElement);
    }
  }

  private dims() {
    if (this.dimsCache) return this.dimsCache;
    const box = this.stage.parentElement ?? document.documentElement;
    const d = { sw: this.stage.offsetWidth, sh: this.stage.offsetHeight, vw: box.clientWidth || innerWidth, vh: box.clientHeight || innerHeight };
    // кэш живёт только пока идёт движение (rAF); вне его — свежее чтение
    if (this.moving) this.dimsCache = d;
    return d;
  }
  bounds(s = this.cam.s): Bounds {
    const d = this.dims();
    return camBounds(d.sw, d.sh, s, d.vw, d.vh, this.extraBottom);
  }
  private homeCam(): Cam {
    const d = this.dims();
    return { x: 0, y: HOME_SHIFT, s: Math.min(d.vw, 560) / Math.max(1, d.sw) };
  }
  private walkCam(): Cam {
    const d = this.dims();
    const b = camBounds(d.sw, d.sh, WALK_ZOOM, d.vw, d.vh);
    return { x: 0, y: Math.round(b.minY * WALK_STREET), s: WALK_ZOOM };
  }
  get state(): Cam {
    return { ...this.cam };
  }

  /**
   * вход: с вида главной — пролёт к улице. arrive — пришли из соседнего района (полоска или край улицы):
   * камера уже на улице у ближнего края кадра и проезжает к середине (как вход в район).
   */
  enter(arrive?: Dir) {
    this.home = this.homeCam();
    this.rest = this.walkCam();
    if (arrive) {
      const b = this.bounds(this.rest.s);
      this.cam = { ...this.rest, x: arrive === 1 ? b.maxX : b.minX };
      this.render();
      this.tween(this.rest, this.opts.flight ? ARRIVE_MS : 0);
      return;
    }
    this.cam = { ...this.home };
    this.render();
    if (this.opts.flight) this.tween(this.rest, FLY_IN);
    else {
      this.cam = { ...this.rest };
      this.render();
    }
  }

  /** выход: обратный пролёт к виду главной, потом done */
  leave(done: () => void) {
    if (this.leaving) return;
    this.leaving = true;
    this.drag = null;
    this.gliding = false;
    if (!this.opts.flight) return done();
    this.tween(this.homeCam(), FLY_OUT, done);
  }

  /** открыта карточка: вывеска — по центру и над карточкой (с запасом под луч проектора) */
  focus(spot: Element, cardH: number) {
    const d = this.dims();
    this.extraBottom = cardH + 48;
    const r = spot.getBoundingClientRect();
    const roof = 64; // под кнопкой «Выйти»
    const floor = d.vh - 12 - cardH - 36;
    let dy = 0;
    if (r.bottom > floor) dy = Math.max(floor - r.bottom, roof - r.top);
    else if (r.top < roof) dy = roof - r.top;
    const dx = d.vw / 2 - (r.left + r.width / 2);
    const target = clampCam({ s: this.cam.s, x: this.cam.x + dx, y: this.cam.y + dy }, this.bounds());
    this.tween(target, this.opts.flight ? FOCUS : 0);
  }
  /** карточка закрыта: запас снизу убирается, камера возвращается в кадр */
  unfocus() {
    this.extraBottom = 0;
    if (this.leaving) return;
    const b = this.bounds();
    if (!inBounds(this.cam, b)) this.tween(clampCam(this.cam, b), this.opts.flight ? 350 : 0);
  }

  setTilt(v: Vec) {
    this.tiltT = v;
    this.wake();
  }

  private tween(to: Cam, dur: number, done?: () => void) {
    this.gliding = false;
    if (dur <= 0) {
      this.cam = { ...to };
      this.tw = null;
      this.render();
      done?.();
      return;
    }
    this.tw = { from: { ...this.cam }, to, t0: -1, dur, done }; // отсчёт — с первого кадра (тяжёлый кадр входа не съедает пролёт)
    this.wake();
  }

  private onDown = (e: PointerEvent) => {
    if (!e.isPrimary || e.button > 0 || this.leaving) return;
    if (e.target instanceof Element && e.target.closest(IGNORE)) return;
    if (this.tw && !this.tw.done) this.tw = null; // палец перехватывает пролёт/фокус
    this.gliding = false;
    this.v = { x: 0, y: 0 };
    this.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, cam0: { ...this.cam }, samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }], moved: false };
  };
  private onMove = (e: PointerEvent) => {
    const g = this.drag;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.moved && !isDrag(dx, dy)) return;
    g.moved = true;
    const b = this.bounds();
    this.cam = { s: this.cam.s, x: rubber(g.cam0.x + dx, b.minX, b.maxX), y: rubber(g.cam0.y + dy, b.minY, b.maxY) };
    g.samples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (g.samples.length > 10) g.samples.shift();
    this.wake();
  };
  private onUp = (e: PointerEvent) => {
    const g = this.drag;
    if (!g || e.pointerId !== g.id) return;
    this.drag = null;
    if (!g.moved) return; // касание — его обработает кнопка вывески
    this.suppressUntil = performance.now() + 400; // протяжка — не касание: гасим следующий click
    const b = this.bounds();
    const pull = edgePull(this.cam.x, b.minX, b.maxX);
    if (e.type === "pointerup" && pull.dir !== 0 && pull.p >= 1 && this.opts.onEdge?.(pull.dir)) {
      this.v = { x: 0, y: 0 };
      this.gliding = false;
      return;
    }
    const v = e.type === "pointerup" && this.opts.inertia ? releaseVelocity(g.samples, performance.now()) : { x: 0, y: 0 };
    this.v = v;
    this.gliding = true;
    this.wake();
  };
  private onClick = (e: MouseEvent) => {
    if (performance.now() < this.suppressUntil) {
      e.stopPropagation();
      e.preventDefault();
      this.suppressUntil = 0;
    }
  };
  private onResize = () => {
    this.dimsCache = null;
    this.rest = this.walkCam();
    this.cam = clampCam(this.cam, this.bounds());
    this.render();
  };

  private wake() {
    if (this.raf) return;
    this.dimsCache = null;
    this.moving = true;
    this.layers = this.findLayers();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }
  private findLayers() {
    const root = this.stage;
    return DEPTH_LAYERS.flatMap(({ sel, k }) => [...root.querySelectorAll<HTMLElement>(sel)].map((el) => ({ el, k })));
  }

  private tick = (now: number) => {
    this.raf = 0;
    const dt = Math.min(48, Math.max(0, now - this.last));
    this.last = now;
    let busy = !!this.drag;
    if (this.tw) {
      if (this.tw.t0 < 0) this.tw.t0 = now;
      const t = clamp((now - this.tw.t0) / this.tw.dur, 0, 1);
      this.cam = lerpCam(this.tw.from, this.tw.to, easeInOut(t));
      if (t >= 1) {
        const done = this.tw.done;
        this.tw = null;
        done?.();
      } else busy = true;
    } else if (this.gliding && !this.drag) {
      const r = glideStep(this.cam, this.v, dt, this.bounds());
      this.cam = r.cam;
      this.v = r.v;
      this.gliding = !r.done;
      busy ||= this.gliding;
    }
    const a = 1 - Math.exp(-dt / 140);
    this.tilt = { x: this.tilt.x + (this.tiltT.x - this.tilt.x) * a, y: this.tilt.y + (this.tiltT.y - this.tilt.y) * a };
    if (Math.abs(this.tiltT.x - this.tilt.x) > 0.002 || Math.abs(this.tiltT.y - this.tilt.y) > 0.002) busy = true;
    if (++this.frames % 60 === 0) this.layers = this.findLayers(); // кадр сцены мог смениться (фаза/облик)
    this.render();
    if (busy && current === this) this.raf = requestAnimationFrame(this.tick);
    else {
      this.moving = false;
      this.dimsCache = null;
    }
  };

  private render() {
    const c = this.cam;
    const b = this.bounds();
    // наклон слегка ведёт и сам город, но не выводит кадр за край
    let rx = c.x;
    let ry = c.y;
    if (inBounds(c, b)) {
      rx = clamp(c.x - this.tilt.x * TILT_CAM_PX, b.minX, b.maxX);
      ry = clamp(c.y - this.tilt.y * TILT_CAM_PX, b.minY, b.maxY);
    }
    this.stage.style.transform = `translate3d(-50%,0,0) translate3d(${rx.toFixed(2)}px,${ry.toFixed(2)}px,0) scale(${c.s.toFixed(4)})`;
    // параллакс слоёв набирает силу вместе с зумом: на виде главной слои стоят на месте
    const span = this.rest.s - this.home.s;
    const w = span > 0 ? clamp((c.s - this.home.s) / span, 0, 1) : 1;
    for (const { el, k } of this.layers) {
      const sh = layerShift(k, c, this.rest, { x: -this.tilt.x, y: -this.tilt.y });
      el.style.translate = `${((sh.x * w) / c.s).toFixed(2)}px ${((sh.y * w) / c.s).toFixed(2)}px`;
    }
    if (this.opts.onPull) {
      const pull = edgePull(c.x, b.minX, b.maxX);
      this.opts.onPull({ dir: pull.dir, p: this.drag ? pull.p : 0, ...nearEdge(c.x, b.minX, b.maxX) });
    }
    this.rendered++;
  }

  destroy() {
    if (current === this) current = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    window.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("click", this.onClick, true);
    window.removeEventListener("resize", this.onResize);
    this.ro?.disconnect();
    this.ro = null;
    this.moving = false;
    this.dimsCache = null;
    for (const { el } of this.findLayers()) el.style.translate = "";
    // вид главной уже совпадает с последним кадром пролёта — без CSS-перехода, чтобы город не дёрнулся
    const st = this.stage.style;
    st.transition = "none";
    st.transform = "";
    void this.stage.offsetWidth;
    requestAnimationFrame(() => (st.transition = ""));
  }
}

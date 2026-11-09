import { clamp, easeInOut, glideStep, isDrag, releaseVelocity, rubber, type Bounds, type Sample } from "@/lib/walkMath";
import { layerX } from "@/lib/districts";
import { edgePull, nearEdge, type Dir } from "@/lib/districtNav";

/**
 * Камера сцены района: только по горизонтали. Механика — из «Прогулки» (walkMath): порог касания, «резинка» за краем,
 * скорость отпускания, инерция с затуханием и пружина обратно в границы. Вход — в центре улицы.
 * Один requestAnimationFrame, который крутится только пока есть движение; слои двигаются transform'ом.
 * PR 3: протяжка за край дальше EDGE_PULL и отпускание — переход к соседнему району (onEdge); onPull — подсказка у края;
 * arrive(dir) — проезд от ближнего края к центру при входе из соседнего района.
 */
export type EdgeState = { dir: Dir | 0; p: number; l: boolean; r: boolean };
type Drag = { id: number; x0: number; cam0: number; samples: Sample[]; moved: boolean };
export type CamLayer = { el: HTMLElement; k: number };

export class DistrictCamera {
  x = 0;
  private v = 0;
  private range = 0;
  private drag: Drag | null = null;
  private gliding = false;
  private tw: { from: number; to: number; t0: number; dur: number } | null = null;
  private raf = 0;
  private last = 0;
  /** кадров отрисовано (для проверок) */
  rendered = 0;

  constructor(
    private host: HTMLElement,
    private layers: () => CamLayer[],
    private opts: { inertia: boolean; onEdge?: (dir: Dir) => boolean; onPull?: (s: EdgeState) => void },
  ) {
    host.addEventListener("pointerdown", this.onDown);
    window.addEventListener("pointermove", this.onMove, { passive: true });
    window.addEventListener("pointerup", this.onUp, { passive: true });
    window.addEventListener("pointercancel", this.onUp, { passive: true });
  }

  private bounds(): Bounds {
    return { minX: -this.range, maxX: this.range, minY: 0, maxY: 0 };
  }

  /** новая ширина экрана/улицы: камера остаётся в границах */
  setRange(range: number) {
    this.range = Math.max(0, range);
    this.x = clamp(this.x, -this.range, this.range);
    this.render();
  }

  /** встать в точку (0 — центр улицы) без движения */
  jump(x: number) {
    this.v = 0;
    this.gliding = false;
    this.x = clamp(x, -this.range, this.range);
    this.render();
  }

  /**
   * вход из соседнего района: камера стоит у ближнего края улицы и за dur мс проезжает к центру.
   * dir = +1 — шли вправо (пришли слева): видим левый конец улицы, т. е. сдвиг +range.
   */
  arrive(dir: Dir, dur: number) {
    const from = dir === 1 ? this.range : -this.range;
    this.jump(from);
    if (dur <= 0 || this.range === 0) return this.jump(0);
    this.tw = { from, to: 0, t0: -1, dur };
    this.wake();
  }

  /** протяжка по сдвигу (для тестов и клавиатуры): как палец, с инерцией vx (px/мс) */
  nudge(dx: number, vx = 0) {
    this.x = rubber(this.x + dx, -this.range, this.range);
    this.v = this.opts.inertia ? vx : 0;
    this.gliding = true;
    this.wake();
  }

  private onDown = (e: PointerEvent) => {
    if (!e.isPrimary || e.button > 0) return;
    if (e.target instanceof Element && e.target.closest("button, a")) return;
    this.gliding = false;
    this.tw = null; // палец перехватывает проезд
    this.v = 0;
    this.drag = { id: e.pointerId, x0: e.clientX, cam0: this.x, samples: [{ t: performance.now(), x: e.clientX, y: 0 }], moved: false };
  };
  private onMove = (e: PointerEvent) => {
    const g = this.drag;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x0;
    if (!g.moved && !isDrag(dx, 0)) return;
    g.moved = true;
    this.x = rubber(g.cam0 + dx, -this.range, this.range);
    g.samples.push({ t: performance.now(), x: e.clientX, y: 0 });
    if (g.samples.length > 10) g.samples.shift();
    this.wake();
  };
  private onUp = (e: PointerEvent) => {
    const g = this.drag;
    if (!g || e.pointerId !== g.id) return;
    this.drag = null;
    if (!g.moved) return;
    // протянули за край достаточно — к соседнему району (если он есть), иначе — пружина назад
    const pull = edgePull(this.x, -this.range, this.range);
    if (e.type === "pointerup" && pull.dir !== 0 && pull.p >= 1 && this.opts.onEdge?.(pull.dir)) {
      this.v = 0;
      this.gliding = false;
      return;
    }
    this.v = e.type === "pointerup" && this.opts.inertia ? releaseVelocity(g.samples, performance.now()).x : 0;
    this.gliding = true;
    this.wake();
  };

  private wake() {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  private tick = (now: number) => {
    this.raf = 0;
    const dt = Math.min(48, Math.max(0, now - this.last));
    this.last = now;
    let busy = !!this.drag;
    if (this.tw) {
      if (this.tw.t0 < 0) this.tw.t0 = now;
      const t = clamp((now - this.tw.t0) / this.tw.dur, 0, 1);
      this.x = this.tw.from + (this.tw.to - this.tw.from) * easeInOut(t);
      if (t >= 1) this.tw = null;
      else busy = true;
    } else if (this.gliding && !this.drag) {
      const r = glideStep({ x: this.x, y: 0, s: 1 }, { x: this.v, y: 0 }, dt, this.bounds());
      this.x = r.cam.x;
      this.v = r.v.x;
      this.gliding = !r.done;
      busy ||= this.gliding;
    }
    this.render();
    if (busy) this.raf = requestAnimationFrame(this.tick);
  };

  render() {
    for (const { el, k } of this.layers()) el.style.transform = `translate3d(${layerX(k, this.x).toFixed(2)}px,0,0)`;
    if (this.opts.onPull) {
      const pull = edgePull(this.x, -this.range, this.range);
      const near = nearEdge(this.x, -this.range, this.range);
      this.opts.onPull({ dir: pull.dir, p: this.drag ? pull.p : 0, ...near });
    }
    this.rendered++;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.host.removeEventListener("pointerdown", this.onDown);
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
  }
}

import { clamp, glideStep, isDrag, releaseVelocity, rubber, type Bounds, type Sample } from "@/lib/walkMath";
import { layerX } from "@/lib/districts";

/**
 * Камера сцены района: только по горизонтали. Механика — из «Прогулки» (walkMath): порог касания, «резинка» за краем,
 * скорость отпускания, инерция с затуханием и пружина обратно в границы. Вход — в центре улицы.
 * Один requestAnimationFrame, который крутится только пока есть движение; слои двигаются transform'ом.
 */
type Drag = { id: number; x0: number; cam0: number; samples: Sample[]; moved: boolean };
export type CamLayer = { el: HTMLElement; k: number };

export class DistrictCamera {
  x = 0;
  private v = 0;
  private range = 0;
  private drag: Drag | null = null;
  private gliding = false;
  private raf = 0;
  private last = 0;
  /** кадров отрисовано (для проверок) */
  rendered = 0;

  constructor(
    private host: HTMLElement,
    private layers: () => CamLayer[],
    private opts: { inertia: boolean },
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
    if (this.gliding && !this.drag) {
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

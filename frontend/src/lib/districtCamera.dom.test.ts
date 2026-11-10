import { LANES } from "./districts";
// @vitest-environment jsdom
/** Камера района: вход в центре, протяжка двигает слои с разной скоростью, «резинка» и пружина у края, инерция. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DistrictCamera } from "./districtCamera";
import { startDistrictLife, MAX_ACTIVE } from "./districtLife";

let frames: FrameRequestCallback[] = [];
const flush = (n = 200, step = 16) => {
  let t = performance.now();
  for (let i = 0; i < n && frames.length; i++) {
    const f = frames.splice(0);
    t += step;
    f.forEach((cb) => cb(t));
  }
};
const ptr = (type: string, x: number, target: EventTarget = window) => {
  const e = new MouseEvent(type, { clientX: x, clientY: 300, bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: 1, isPrimary: true });
  target.dispatchEvent(e);
};
const tx = (el: HTMLElement) => Number(/translate3d\((-?[\d.]+)px/.exec(el.style.transform)?.[1] ?? NaN);

let host: HTMLDivElement;
let els: HTMLDivElement[];
let cam: DistrictCamera;
const KS = [0.25, 0.55, 1, 1.3];

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  host = document.createElement("div");
  els = KS.map(() => document.createElement("div"));
  els.forEach((e) => host.appendChild(e));
  document.body.appendChild(host);
  cam = new DistrictCamera(host, () => els.map((el, i) => ({ el, k: KS[i] })), { inertia: true });
  cam.setRange(367); // 390×844: (1125 − 390) / 2
  cam.jump(0);
});
afterEach(() => {
  cam.destroy();
  host.remove();
  vi.unstubAllGlobals();
});

describe("district camera", () => {
  it("enters at the centre: every layer aligned", () => {
    expect(els.map(tx)).toEqual([0, 0, 0, 0]);
  });

  it("a drag moves layers at their own speed", () => {
    ptr("pointerdown", 200, host);
    ptr("pointermove", 180);
    ptr("pointermove", 100);
    flush(1);
    expect(cam.x).toBe(-100);
    expect(els.map(tx)).toEqual([-25, -55, -100, -130]);
    ptr("pointercancel", 100);
    flush();
    expect(cam.x).toBe(-100); // без скорости — остаётся на месте
  });

  it("a tap does not move the street", () => {
    ptr("pointerdown", 200, host);
    ptr("pointermove", 204);
    ptr("pointerup", 204);
    flush();
    expect(cam.x).toBe(0);
  });

  it("past the edge: rubber band while dragging, spring back after release", () => {
    ptr("pointerdown", 0, host);
    ptr("pointermove", 20);
    ptr("pointermove", 567); // 200 px за краем
    flush(1);
    expect(cam.x).toBeGreaterThan(367);
    expect(cam.x).toBeLessThan(367 + 200);
    ptr("pointercancel", 567);
    flush();
    expect(cam.x).toBe(367);
  });

  it("inertia glides and stops inside the street", () => {
    cam.nudge(-10, -2);
    flush(1);
    const after1 = cam.x;
    flush();
    expect(cam.x).toBeLessThan(after1);
    expect(cam.x).toBeGreaterThanOrEqual(-367);
    expect(frames.length).toBe(0); // движение кончилось — rAF не крутится
  });

  it("resize keeps the camera inside", () => {
    cam.jump(300);
    cam.setRange(100);
    expect(cam.x).toBe(100);
  });
});

describe("district street life", () => {
  it("one-shot events only, at most two at once, removed on stop", () => {
    const anims: { onfinish: null | (() => void); oncancel: null | (() => void); opts: KeyframeAnimationOptions }[] = [];
    const lane = { kind: "car" as const, y: 0.3, w: 0.02, h: 0.01, dur: [1000, 1000] as [number, number] };
    HTMLElement.prototype.animate = function (_k: Keyframe[], opts: KeyframeAnimationOptions) {
      const a = { onfinish: null, oncancel: null, opts };
      anims.push(a);
      return a as unknown as Animation;
    } as unknown as typeof HTMLElement.prototype.animate;
    const life = startDistrictLife(host, [lane], { first: 1e9 });
    life.spawn(0);
    life.spawn(0);
    life.spawn(0);
    expect(host.querySelectorAll(".dz-mover").length).toBe(MAX_ACTIVE);
    expect(anims.every((a) => a.opts.iterations === undefined)).toBe(true);
    anims[0].onfinish?.();
    expect(host.querySelectorAll(".dz-mover").length).toBe(1);
    life.stop();
    expect(host.querySelectorAll(".dz-mover").length).toBe(0);
  });

  it("final rows: sprites (walker bobs in the same one-shot run)", () => {
    const frames: Keyframe[][] = [];
    HTMLElement.prototype.animate = function (k: Keyframe[]) {
      frames.push(k);
      return { onfinish: null, oncancel: null } as unknown as Animation;
    } as unknown as typeof HTMLElement.prototype.animate;
    const walker = LANES.rows.findIndex((l) => l.sprite === "walker");
    const life = startDistrictLife(host, LANES.rows, { first: 1e9 });
    life.spawn(walker);
    const el = host.querySelector<HTMLElement>(".dz-mover")!;
    expect(el.className).toBe("dz-mover walker sprite");
    expect(el.style.backgroundImage).toContain("url(");
    expect(frames[0].length).toBeGreaterThan(4);
    life.stop();
  });
});

describe("district camera: neighbours (PR 3)", () => {
  it("pulling far enough past the edge and releasing asks for the neighbour; a short pull springs back", () => {
    cam.destroy();
    const onEdge = vi.fn(() => true);
    const pulls: number[] = [];
    cam = new DistrictCamera(host, () => els.map((el, i) => ({ el, k: KS[i] })), { inertia: true, onEdge, onPull: (s) => pulls.push(s.p) });
    cam.setRange(367);
    cam.jump(-367); // у правого конца улицы
    ptr("pointerdown", 300, host);
    ptr("pointermove", 280);
    ptr("pointermove", 200); // 100 px пальцем → ~35 px за краем: мало
    flush(1);
    ptr("pointerup", 200);
    flush();
    expect(onEdge).not.toHaveBeenCalled();
    expect(cam.x).toBe(-367);
    ptr("pointerdown", 380, host);
    ptr("pointermove", 360);
    ptr("pointermove", 100); // 280 px → ~98 px за краем
    flush(1);
    expect(Math.max(...pulls)).toBe(1);
    ptr("pointerup", 100);
    expect(onEdge).toHaveBeenCalledWith(1); // правый сосед
  });

  it("arrive(): from the near edge to the centre in ~0.6 s", () => {
    cam.arrive(1, 600);
    expect(cam.x).toBe(367); // пришли слева — видим левый конец улицы
    flush(20); // ~320 мс
    expect(cam.x).toBeGreaterThan(0);
    expect(cam.x).toBeLessThan(367);
    flush();
    expect(cam.x).toBe(0);
    cam.arrive(-1, 0);
    expect(cam.x).toBe(0);
  });

  it("arrive(): ends at the rest point, clamped to the panorama", () => {
    cam.arrive(1, 600, 80);
    flush();
    expect(cam.x).toBe(80);
    cam.arrive(-1, 0, -999);
    expect(cam.x).toBe(-367);
  });
});

describe("district camera: taps and panTo (PR 6b)", () => {
  let taps: (Element | null)[] = [];
  let spot: HTMLElement;
  beforeEach(() => {
    cam.destroy();
    taps = [];
    spot = document.createElement("span");
    host.appendChild(spot);
    cam = new DistrictCamera(host, () => els.map((el, i) => ({ el, k: KS[i] })), { inertia: true, onTap: (t) => taps.push(t) });
    cam.setRange(367);
    cam.jump(0);
  });
  const at = (type: string, x: number, y: number, target: EventTarget = window) => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.assign(e, { pointerId: 1, isPrimary: true });
    target.dispatchEvent(e);
  };

  it("a tap below the threshold reports the element under the finger and does not move the street", () => {
    at("pointerdown", 200, 300, spot);
    at("pointermove", 204, 303);
    at("pointerup", 204, 303);
    flush();
    expect(taps).toEqual([spot]);
    expect(cam.x).toBe(0);
  });

  it("a swipe is not a tap (horizontal pans, vertical just cancels)", () => {
    at("pointerdown", 200, 300, spot);
    at("pointermove", 150, 300);
    at("pointerup", 150, 300);
    flush();
    at("pointerdown", 200, 300, spot);
    at("pointermove", 202, 340);
    at("pointerup", 202, 340);
    flush();
    expect(taps).toEqual([]);
  });

  it("a cancelled pointer is not a tap", () => {
    at("pointerdown", 200, 300, spot);
    at("pointercancel", 200, 300);
    expect(taps).toEqual([]);
  });

  it("a tap that stops the inertia glide only stops it — nothing opens", () => {
    at("pointerdown", 300, 300, host);
    for (let i = 1; i <= 6; i++) {
      at("pointermove", 300 - i * 30, 300);
      flush(1);
    }
    at("pointerup", 120, 300);
    flush(2); // улица ещё едет
    expect(cam.moving).toBe(true);
    at("pointerdown", 200, 300, spot);
    at("pointerup", 200, 300);
    expect(taps).toEqual([]);
    const x = cam.x;
    flush();
    expect(cam.x).toBe(x); // остановилась под пальцем
    at("pointerdown", 200, 300, spot); // теперь стоит — касание засчитывается
    at("pointerup", 200, 300);
    expect(taps).toEqual([spot]);
  });

  it("buttons and the ad card do not start a drag or a tap", () => {
    const card = document.createElement("div");
    card.className = "cad-card";
    host.appendChild(card);
    at("pointerdown", 200, 300, card);
    at("pointermove", 100, 300);
    at("pointerup", 100, 300);
    flush();
    expect(cam.x).toBe(0);
    expect(taps).toEqual([]);
  });

  it("panTo: one smooth rAF run to the point, clamped; dur 0 — jumps", () => {
    cam.panTo(-300, 600);
    flush(3);
    expect(cam.x).toBeLessThan(0);
    expect(cam.x).toBeGreaterThan(-300);
    flush();
    expect(cam.x).toBe(-300);
    expect(frames.length).toBe(0); // кадры кончились — бесконечного цикла нет
    cam.panTo(9999, 0);
    expect(cam.x).toBe(367);
    expect(frames.length).toBe(0);
  });
});

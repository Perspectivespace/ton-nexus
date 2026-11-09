// @vitest-environment jsdom
/** Камера «Прогулки» в DOM: касание проходит к вывеске, протяжка двигает город и гасит click, край кадра держит. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WalkCamera, getWalkCamera } from "./walkCamera";
import { pickKind } from "./walkLife";

let frames: FrameRequestCallback[] = [];
const flush = (n = 80, step = 16) => {
  let t = performance.now();
  for (let i = 0; i < n && frames.length; i++) {
    const f = frames.splice(0);
    t += step;
    f.forEach((cb) => cb(t));
  }
};
const size = (el: HTMLElement, w: number, h: number, client = false) => {
  Object.defineProperty(el, client ? "clientWidth" : "offsetWidth", { configurable: true, value: w });
  Object.defineProperty(el, client ? "clientHeight" : "offsetHeight", { configurable: true, value: h });
};
const ptr = (type: string, x: number, y: number, target: EventTarget = window) => {
  const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.assign(e, { pointerId: 1, isPrimary: true });
  target.dispatchEvent(e);
};

let city: HTMLDivElement;
let stage: HTMLDivElement;
let spot: HTMLButtonElement;
let cam: WalkCamera;
const clicks = vi.fn();

beforeEach(() => {
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  city = document.createElement("div");
  stage = document.createElement("div");
  spot = document.createElement("button");
  spot.addEventListener("click", clicks);
  stage.appendChild(spot);
  city.appendChild(stage);
  document.body.appendChild(city);
  size(city, 390, 844, true);
  size(stage, 475, 844);
  clicks.mockClear();
  cam = new WalkCamera(stage, { flight: false, inertia: true });
  cam.enter();
});
afterEach(() => {
  cam.destroy();
  city.remove();
  vi.unstubAllGlobals();
});

describe("WalkCamera", () => {
  it("вход: зум и опускание к улице, в границах кадра", () => {
    const s = cam.state;
    const b = cam.bounds();
    expect(s.s).toBeGreaterThan(1.2);
    expect(s.y).toBeLessThan(0);
    expect(s.y).toBeGreaterThanOrEqual(b.minY);
    expect(stage.style.transform).toContain("scale(1.32");
    expect(getWalkCamera()).toBe(cam);
  });

  it("касание без протяжки — click доходит до вывески, город стоит", () => {
    const before = cam.state;
    ptr("pointerdown", 100, 400, spot);
    ptr("pointermove", 103, 402);
    ptr("pointerup", 103, 402);
    spot.click();
    expect(clicks).toHaveBeenCalledTimes(1);
    expect(cam.state).toEqual(before);
  });

  it("протяжка двигает город и гасит click; после отпускания — в границах", () => {
    const x0 = cam.state.x;
    ptr("pointerdown", 100, 400, spot);
    ptr("pointermove", 140, 400);
    ptr("pointermove", 400, 400); // далеко за край — «резинка»
    expect(cam.state.x).toBeGreaterThan(x0);
    ptr("pointerup", 400, 400);
    spot.click();
    expect(clicks).not.toHaveBeenCalled();
    flush(200);
    const b = cam.bounds();
    expect(cam.state.x).toBeCloseTo(b.maxX, 0);
  });

  it("выход: обратный путь, потом done; пальцы после этого не двигают город", () => {
    const done = vi.fn();
    cam.leave(done);
    expect(done).toHaveBeenCalledTimes(1);
    const s = cam.state;
    ptr("pointerdown", 100, 400);
    ptr("pointermove", 200, 400);
    expect(cam.state).toEqual(s);
  });

  it("карточка: вывеска уходит над карточку, запас снизу пропадает после закрытия", () => {
    spot.getBoundingClientRect = () => ({ left: 300, right: 360, top: 700, bottom: 740, width: 60, height: 40, x: 300, y: 700, toJSON: () => ({}) });
    const y0 = cam.state.y;
    cam.focus(spot, 330);
    expect(cam.state.y).toBeLessThan(y0);
    expect(cam.state.x).toBeLessThan(0); // вывеска справа — город уезжает влево
    cam.unfocus();
    flush(1);
    expect(cam.bounds().minY).toBeCloseTo(844 - 844 * 1.32);
  });
});

describe("WalkCamera: районы (PR 3)", () => {
  it("протяжка влево за правый край кадра — к правому соседу (Неон-ряды); вправо за левый край — соседа нет, пружина", () => {
    cam.destroy();
    const onEdge = vi.fn((dir: number) => dir === 1);
    cam = new WalkCamera(stage, { flight: false, inertia: true, onEdge });
    cam.enter();
    ptr("pointerdown", 300, 400, spot);
    ptr("pointermove", 280, 400);
    ptr("pointermove", -300, 400); // далеко влево — за правый край кадра
    ptr("pointerup", -300, 400);
    expect(onEdge).toHaveBeenCalledWith(1);
    onEdge.mockClear();
    cam.destroy();
    cam = new WalkCamera(stage, { flight: false, inertia: true, onEdge });
    cam.enter();
    ptr("pointerdown", 10, 400, spot);
    ptr("pointermove", 30, 400);
    ptr("pointermove", 600, 400);
    ptr("pointerup", 600, 400);
    expect(onEdge).toHaveBeenCalledWith(-1);
    flush(200);
    expect(cam.state.x).toBeCloseTo(cam.bounds().maxX, 0); // соседа слева нет — пружина в кадр
  });

  it("вход из района: камера уже на улице у края и проезжает к середине", () => {
    cam.destroy();
    cam = new WalkCamera(stage, { flight: true, inertia: true });
    cam.enter(-1); // шли влево из Неон-рядов — видим правый край Центра
    const b = cam.bounds();
    expect(cam.state.s).toBeCloseTo(1.32);
    expect(cam.state.x).toBeCloseTo(b.minX);
    flush(200);
    expect(cam.state.x).toBeCloseTo(0);
  });
});

describe("walkLife.pickKind", () => {
  it("окна зажигаются только в темноте", () => {
    expect(pickKind(true, 0.9)).toBe("window");
    expect(pickKind(false, 0.9)).toBe("drone");
    expect(pickKind(false, 0.1)).toBe("car");
    expect(pickKind(false, 0.4)).toBe("street");
    expect(pickKind(false, 0.6)).toBe("far");
  });
});

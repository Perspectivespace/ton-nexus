import { describe, expect, it } from "vitest";
import {
  camBounds, clampCam, glideStep, GLIDE_STOP, isDrag, layerShift, releaseVelocity, rubber, tiltVec, TAP_SLOP, type Cam,
} from "./walkMath";

describe("walkMath: границы", () => {
  it("кадр шире экрана — ход по x симметричен, по y — от низа кадра до верха", () => {
    const b = camBounds(475, 844, 1.32, 390, 844);
    expect(b.maxX).toBeCloseTo((475 * 1.32 - 390) / 2);
    expect(b.minX).toBeCloseTo(-b.maxX);
    expect(b.maxY).toBe(0);
    expect(b.minY).toBeCloseTo(844 - 844 * 1.32);
  });
  it("кадр уже экрана — сдвига нет; запас под карточку опускает нижнюю границу", () => {
    const b = camBounds(300, 500, 1, 390, 844);
    expect([b.minX, b.maxX, b.minY, b.maxY]).toEqual([-0, 0, 0, 0]);
    expect(camBounds(475, 844, 1.32, 390, 844, 300).minY).toBeCloseTo(844 - 844 * 1.32 - 300);
  });
  it("clampCam не выпускает за край", () => {
    const b = camBounds(475, 844, 1.32, 390, 844);
    const c = clampCam({ x: 999, y: 50, s: 1.32 }, b);
    expect(c).toEqual({ x: b.maxX, y: 0, s: 1.32 });
  });
});

describe("walkMath: касание или протяжка", () => {
  it("до порога — касание, за порогом — протяжка", () => {
    expect(isDrag(3, 4)).toBe(false);
    expect(isDrag(TAP_SLOP, 0)).toBe(false);
    expect(isDrag(TAP_SLOP + 0.5, 0)).toBe(true);
    expect(isDrag(6, 6)).toBe(true);
  });
  it("«резинка» ослабляет движение только за краем", () => {
    expect(rubber(5, 0, 10)).toBe(5);
    expect(rubber(20, 0, 10)).toBeCloseTo(13.5);
    expect(rubber(-10, 0, 10)).toBeCloseTo(-3.5);
  });
});

describe("walkMath: инерция", () => {
  it("скорость по последним 100 мс; палец замер — скорости нет", () => {
    const s = [
      { t: 0, x: 0, y: 0 },
      { t: 900, x: 100, y: 0 },
      { t: 950, x: 120, y: 10 },
      { t: 1000, x: 140, y: 20 },
    ];
    const v = releaseVelocity(s, 1000);
    expect(v.x).toBeCloseTo(0.4);
    expect(v.y).toBeCloseTo(0.2);
    expect(releaseVelocity(s, 1200)).toEqual({ x: 0, y: 0 });
  });
  it("скольжение затухает и останавливается, у края ось гасится", () => {
    const b = camBounds(475, 844, 1.32, 390, 844);
    let cam: Cam = { x: 0, y: -100, s: 1.32 };
    let v = { x: 1, y: 0 };
    let steps = 0;
    let done = false;
    let prev = 0;
    while (!done && steps < 400) {
      const r = glideStep(cam, v, 16, b);
      expect(r.cam.x).toBeGreaterThanOrEqual(prev);
      prev = r.cam.x;
      cam = r.cam;
      v = r.v;
      done = r.done;
      steps++;
    }
    expect(done).toBe(true);
    expect(cam.x).toBeLessThanOrEqual(b.maxX);
    expect(steps).toBeLessThan(200);
    expect(Math.abs(v.x)).toBeLessThan(GLIDE_STOP);
  });
  it("за краем после «резинки» — пружиной обратно в кадр", () => {
    const b = camBounds(475, 844, 1.32, 390, 844);
    let cam: Cam = { x: b.maxX + 40, y: 30, s: 1.32 };
    for (let i = 0; i < 60; i++) cam = glideStep(cam, { x: 0, y: 0 }, 16, b).cam;
    expect(cam.x).toBeCloseTo(b.maxX, 0);
    expect(cam.y).toBeCloseTo(0, 0);
  });
});

describe("walkMath: параллакс и наклон", () => {
  it("дальний слой отстаёт, ближний обгоняет; в покое — на месте", () => {
    const rest = { x: 0, y: -200, s: 1.32 };
    const cam = { x: 50, y: -200, s: 1.32 };
    expect(layerShift(0.72, rest, rest, { x: 0, y: 0 })).toEqual({ x: -0, y: -0 });
    expect(layerShift(0.72, cam, rest, { x: 0, y: 0 }).x).toBeCloseTo(-14);
    expect(layerShift(1.35, cam, rest, { x: 0, y: 0 }).x).toBeCloseTo(17.5);
  });
  it("наклон — относительно нуля и не больше ±1", () => {
    const base = { beta: 0.8, gamma: 0 };
    expect(tiltVec(0.8, 0, base)).toEqual({ x: 0, y: 0 });
    expect(tiltVec(0.8, 0.175, base).x).toBeCloseTo(0.5);
    expect(tiltVec(3, -3, base)).toEqual({ x: -1, y: 1 });
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { SIGNAL_BOX } from "./SecretSignal";
import { AD_SPOT_BOX } from "./CityAdSpots";
import { restX, streetWidth, SURFACES, surfaceBounds } from "@/lib/districts";

type R = [number, number, number, number];
const hit = (a: R, b: R) => a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];

describe("секретный код: своя точка сцены", () => {
  it("Центр: не на местах рекламы и в кадре «Прогулки» в покое (360–430 px)", () => {
    const [x, y, w, h] = SIGNAL_BOX.centre;
    const box: R = [x * 720, y * 1280, w * 720, h * 1280];
    for (const [k, b] of Object.entries(AD_SPOT_BOX)) expect(hit(box, b), k).toBe(false);
    // в покое при зуме 1.32 видна полоса кадра ≈ 137…583 px по ширине (экраны 19.5:9–20:9)
    expect(box[0]).toBeGreaterThanOrEqual(150);
    expect(box[0] + box[2]).toBeLessThanOrEqual(575);
  });

  for (const d of ["rows", "port"] as const)
    it(`${d}: не на местах рекламы и целиком на экране в точке покоя камеры`, () => {
      const box = SIGNAL_BOX[d];
      for (const s of SURFACES[d]!) {
        const b = surfaceBounds(s);
        expect(hit(box, [b.x, b.y, b.w, b.h]), s.spot).toBe(false);
      }
      for (const [vw, vh] of [[360, 780], [390, 844], [412, 892]] as const) {
        const sw = streetWidth(vw, vh);
        const left = vw / 2 + (box[0] - 0.5) * sw + restX(d, vw, vh);
        expect(left, `${vw}`).toBeGreaterThanOrEqual(8);
        expect(left + box[2] * sw, `${vw}`).toBeLessThanOrEqual(vw - 8);
      }
    });
});

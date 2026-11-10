/** Кромка света на башне — тонкая полоса у бока силуэта, а не весь силуэт (иначе без копии кадра башня — плоская заливка). */
import { describe, expect, it } from "vitest";
import { TOWER_SILHOUETTE, towerRim } from "./towerSilhouette";

const pts = (poly: string) =>
  poly
    .replace(/^polygon\(|\)$/g, "")
    .split(",")
    .map((p) => p.trim().split(/\s+/).map((v) => parseFloat(v)));
// площадь многоугольника в «процентах²» (формула шнурка)
const area = (poly: string) => {
  const p = pts(poly);
  return Math.abs(p.reduce((a, [x, y], i) => a + x * p[(i + 1) % p.length][1] - p[(i + 1) % p.length][0] * y, 0)) / 2;
};

describe("towerRim", () => {
  for (const tier of [1, 2, 3, 4]) {
    it(`облик ${tier}: полоса узкая и снаружи силуэта, с нужной стороны`, () => {
      const sil = area(TOWER_SILHOUETTE[tier]);
      for (const side of ["l", "r"] as const) {
        const rim = towerRim(tier, side, 0.42);
        // полоса — малая доля силуэта (кромка), а не силуэт целиком
        expect(area(rim)).toBeGreaterThan(0);
        expect(area(rim)).toBeLessThan(sil * 0.05);
        const xs = pts(rim).map(([x]) => x);
        const sx = pts(TOWER_SILHOUETTE[tier]).map(([x]) => x);
        if (side === "r") expect(Math.max(...xs)).toBeCloseTo(Math.max(...sx) + 0.42, 1);
        else expect(Math.min(...xs)).toBeCloseTo(Math.min(...sx) - 0.42, 1);
      }
    });
  }
});

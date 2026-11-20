import { describe, expect, it } from "vitest";
import { signPx } from "./signScale";

describe("signScale: сколько пикселей кадра 720 в одном пикселе экрана", () => {
  it("кадр шириной min(экран, 560): 360 → 2, 390 → ~1.85, шире 560 — как 560", () => {
    expect(signPx(360)).toBe(2);
    expect(signPx(390)).toBeCloseTo(1.846, 3);
    expect(signPx(1200)).toBeCloseTo(720 / 560, 6);
  });
  it("совсем узкий экран не раздувает минимум сверх 320 px", () => {
    expect(signPx(200)).toBe(720 / 320);
  });
});

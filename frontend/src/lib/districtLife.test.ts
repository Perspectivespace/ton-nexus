import { describe, expect, it } from "vitest";
import { moverFrames, SPRITES } from "./districtLife";

describe("districtLife: one-shot frames", () => {
  it("plain mover: fade in, cross, fade out — transform and opacity only", () => {
    const f = moverFrames(-10, 110, 5000);
    expect(f[0]).toEqual({ transform: "translate3d(-10px,0px,0)", opacity: 0 });
    expect(f[f.length - 1]).toEqual({ transform: "translate3d(110px,0px,0)", opacity: 0 });
    for (const k of f) expect(Object.keys(k).every((p) => ["transform", "opacity", "offset"].includes(p))).toBe(true);
  });

  it("walker bobs every ~0.45 s within one run, monotonic offsets", () => {
    const f = moverFrames(0, 1000, 9000, 3);
    expect(f.length).toBe(21);
    expect(f.some((k) => String(k.transform).includes(",-3px,"))).toBe(true);
    const offs = f.map((k) => Number(k.offset));
    expect(offs[0]).toBe(0);
    expect(offs[offs.length - 1]).toBe(1);
    for (let i = 1; i < offs.length; i++) expect(offs[i]).toBeGreaterThan(offs[i - 1]);
    expect(f[0].opacity).toBe(0);
    expect(f[f.length - 1].opacity).toBe(0);
    expect(f[10].opacity).toBe(1);
  });

  it("every sprite has an asset", () => {
    for (const url of Object.values(SPRITES)) expect(String(url)).toMatch(/rows-(car|drone|walker)|^data:image\/webp/);
  });
});

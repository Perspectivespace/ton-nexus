import { describe, expect, it } from "vitest";
import { IDLE_COLOR, IDLE_IN, IDLE_OUT, idleDelay, idleSlogans, idleTickerMs, priceLine, tonRu } from "./districtIdle";
import { SURFACES } from "./districts";

describe("districtIdle: self-promo of free spots", () => {
  it("price in Russian, no trailing zeros; unknown price — no line", () => {
    expect(tonRu("1.50")).toBe("1,5");
    expect(tonRu("2")).toBe("2");
    expect(tonRu("0.125")).toBe("0,125");
    expect(tonRu(null)).toBeNull();
    expect(tonRu("0")).toBeNull();
    expect(priceLine("1.5")).toBe("от 1,5 TON/сутки");
    expect(priceLine(undefined)).toBeNull();
  });

  it("every surface kind has short slogans; first = «Место для рекламы» / «Засветись тут»", () => {
    for (const s of SURFACES.rows ?? []) {
      const list = idleSlogans(s.kind, "1");
      expect(list.length).toBeGreaterThanOrEqual(3);
      expect(["Место для рекламы", "Засветись тут"]).toContain(list[0].split(" · ")[0]);
      expect(IDLE_COLOR[s.kind]).toBeTruthy();
    }
    // короткие: вывеска — до 13 знаков, баннер — до 19, экран — до 26
    expect(Math.max(...idleSlogans("neon").map((t) => t.length))).toBeLessThanOrEqual(13);
    expect(Math.max(...idleSlogans("banner").map((t) => t.length))).toBeLessThanOrEqual(19);
    expect(Math.max(...idleSlogans("facade_screen").map((t) => t.length))).toBeLessThanOrEqual(26);
    expect(idleSlogans("line", "0.5")[0]).toBe("Место для рекламы · от 0,5 TON/сутки");
    expect(idleSlogans("line")[0]).toBe("Место для рекламы");
  });

  it("compact (места Центра): вывеска в одну короткую строку, баннер — короче", () => {
    expect(idleSlogans("neon", null, true)).toEqual(["Засветись", "Свободно", "Твой неон"]);
    for (const t of idleSlogans("neon", null, true)) expect(t.length).toBeLessThanOrEqual(9);
    expect(idleSlogans("banner", null, true)[0]).toBe("Засветись тут");
    for (const t of idleSlogans("banner", null, true)) expect(t.length).toBeLessThanOrEqual(17);
  });

  it("swaps are one-shot and staggered; transitions animate transform/opacity only", () => {
    expect(idleDelay(0, 0)).toBe(7000);
    expect(idleDelay(0, 1)).toBe(10000);
    expect(idleDelay(2, 0)).toBeGreaterThan(idleDelay(1, 0));
    expect(idleTickerMs(256, -500, 256)).toBeCloseTo((756 / 256) * 3600);
    for (const k of [...IDLE_OUT, ...IDLE_IN])
      expect(Object.keys(k).every((p) => ["transform", "opacity", "offset"].includes(p))).toBe(true);
  });
});

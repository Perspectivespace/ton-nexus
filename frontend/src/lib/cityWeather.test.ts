import { describe, expect, it } from "vitest";
import { clearDayKey, isClearDate } from "./cityWeather";

describe("cityWeather", () => {
  it("day key follows Moscow date", () => {
    expect(clearDayKey(Date.UTC(2026, 9, 27, 20, 59))).toBe(20261027);
    expect(clearDayKey(Date.UTC(2026, 9, 27, 21, 0))).toBe(20261028);
  });
  it("same answer all day, some days clear and most rainy", () => {
    const day = Date.UTC(2026, 9, 28, 0, 0);
    const a = isClearDate(day + 3600e3);
    expect(isClearDate(day + 12 * 3600e3)).toBe(a);
    let clear = 0;
    for (let i = 0; i < 300; i++) if (isClearDate(day + i * 86400e3)) clear++;
    expect(clear).toBeGreaterThan(60);
    expect(clear).toBeLessThan(150);
  });
});

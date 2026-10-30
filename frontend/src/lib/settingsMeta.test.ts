import { describe, expect, it } from "vitest";
import { fieldMeta, fromInput, parsePctList, summarize, toInput } from "./settingsMeta";

describe("призы «Башни» в редакторе владельца", () => {
  const DEFAULT = {
    enabled: false,
    budget_ton: "0",
    min_participants: 10,
    base_places: 3,
    extra_place_every: 20,
    max_places: 5,
    shares: { "3": [50, 30, 20], "4": [40, 27, 20, 13], "5": [35, 25, 18, 13, 9] },
    min_score: 1,
    payout_mode: "review",
  };

  it("поля: вкл/выкл, бюджет в TON, целые пороги, доли одной строкой", () => {
    expect(fieldMeta("tower_prizes", "enabled", false).kind).toBe("bool");
    expect(fieldMeta("tower_prizes", "budget_ton", "0")).toMatchObject({ kind: "ton", unit: "TON" });
    expect(fieldMeta("tower_prizes", "min_participants", 10).kind).toBe("int");
    expect(fieldMeta("tower_prizes", "extra_place_every", 20).kind).toBe("int");
    expect(fieldMeta("tower_prizes", "4", [40, 27, 20, 13])).toMatchObject({ kind: "pct_list", label: "4 места" });
    expect(fieldMeta("tower_prizes", "5", []).label).toBe("5 мест");
  });

  it("вкл/выкл сохраняется булевым, а не строкой", () => {
    const m = fieldMeta("tower_prizes", "enabled", false);
    expect(toInput(m, true)).toBe("1");
    expect(fromInput(m, "1", false)).toBe(true);
    expect(fromInput(m, "0", true)).toBe(false);
  });

  it("бюджет — строкой TON", () => {
    const m = fieldMeta("tower_prizes", "budget_ton", "0");
    expect(fromInput(m, "12,50", "0")).toBe("12.5");
  });

  it("доли: строка ↔ проценты", () => {
    const m = fieldMeta("tower_prizes", "3", [50, 30, 20]);
    expect(toInput(m, [50, 30, 20])).toBe("50 30 20");
    expect(fromInput(m, " 60  25 15 ", [50, 30, 20])).toEqual([60, 25, 15]);
    expect(fromInput(m, "40/27/20/13", [40, 27, 20, 13])).toEqual([40, 27, 20, 13]);
  });

  it("доли: ошибки по-русски", () => {
    expect(() => parsePctList("50 30 19")).toThrow("сумма 99%, нужно 100%");
    expect(() => parsePctList("50 30 21")).toThrow("сумма 101%");
    expect(() => parsePctList("30 50 20")).toThrow("место 2: не больше, чем за место 1");
    expect(() => parsePctList("50.5 29.5 20")).toThrow("целое число процентов");
    expect(() => parsePctList("100 0 0")).toThrow("не меньше 1%");
    expect(() => parsePctList("60 40", 3)).toThrow("нужно 3 доли");
  });

  it("сводка в списке настроек", () => {
    expect(summarize("tower_prizes", DEFAULT)).toBe("Выключены");
    expect(summarize("tower_prizes", { ...DEFAULT, budget_ton: "20" })).toBe("Выключены · 20 TON в месяц");
    expect(summarize("tower_prizes", { ...DEFAULT, enabled: true, budget_ton: "20" })).toBe("20 TON в месяц");
  });
});

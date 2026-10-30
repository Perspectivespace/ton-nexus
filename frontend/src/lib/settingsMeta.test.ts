import { describe, expect, it } from "vitest";
import { fieldMeta, fromInput, parseIntList, summarize, toInput, towerMinBudget } from "./settingsMeta";

describe("призы «Башни» в редакторе владельца", () => {
  const DEFAULT = {
    enabled: false,
    budget_ton: "0",
    min_participants: 10,
    base_places: 3,
    extra_place_every: 20,
    ladder_max_places: 5,
    places_percent: 5,
    max_places: 200,
    min_prize_ton: "0.1",
    individual_places: 10,
    bands: [20, 50, 100, 200],
    min_score: 1,
    payout_mode: "review",
  };

  it("поля: подписи и типы", () => {
    expect(fieldMeta("tower_prizes", "enabled", false).kind).toBe("bool");
    expect(fieldMeta("tower_prizes", "budget_ton", "0")).toMatchObject({ kind: "ton", unit: "TON" });
    expect(fieldMeta("tower_prizes", "min_prize_ton", "0.1")).toMatchObject({ kind: "ton", label: "Мин. приз" });
    expect(fieldMeta("tower_prizes", "places_percent", 5)).toMatchObject({ kind: "int", unit: "%", max: 100 });
    expect(fieldMeta("tower_prizes", "max_places", 200)).toMatchObject({ kind: "int", max: 1000 });
    expect(fieldMeta("tower_prizes", "individual_places", 10).kind).toBe("int");
    expect(fieldMeta("tower_prizes", "bands", [20]).kind).toBe("int_list");
  });

  it("вкл/выкл сохраняется булевым, а не строкой", () => {
    const m = fieldMeta("tower_prizes", "enabled", false);
    expect(toInput(m, true)).toBe("1");
    expect(fromInput(m, "1", false)).toBe(true);
    expect(fromInput(m, "0", true)).toBe(false);
  });

  it("бюджет и мин. приз — строкой TON", () => {
    expect(fromInput(fieldMeta("tower_prizes", "budget_ton", "0"), "12,50", "0")).toBe("12.5");
    expect(fromInput(fieldMeta("tower_prizes", "min_prize_ton", "0.1"), "0,2", "0.1")).toBe("0.2");
    expect(() => fromInput(fieldMeta("tower_prizes", "min_prize_ton", "0.1"), "0", "0.1")).toThrow("не меньше");
  });

  it("группы: строка ↔ границы", () => {
    const m = fieldMeta("tower_prizes", "bands", [20, 50, 100, 200]);
    expect(toInput(m, [20, 50, 100, 200])).toBe("20 50 100 200");
    expect(fromInput(m, " 30  60,150 ", [])).toEqual([30, 60, 150]);
    expect(fromInput(m, "", [20])).toEqual([]);
  });

  it("группы: ошибки по-русски", () => {
    expect(() => parseIntList("50 20")).toThrow("по возрастанию: 20 после 50");
    expect(() => parseIntList("20 20")).toThrow("по возрастанию");
    expect(() => parseIntList("20.5")).toThrow("нужно целое число");
    expect(() => parseIntList("0")).toThrow("от 1 до 1000");
    expect(() => parseIntList("2000")).toThrow("от 1 до 1000");
  });

  it("минимальный бюджет как на сервере: 3 места по 0.1 TON — 0.55 TON", () => {
    expect(towerMinBudget(DEFAULT)).toBe(0.55);
    expect(towerMinBudget({ ...DEFAULT, min_prize_ton: "1" })).toBe(5.5);
    // 4 места, своя сумма у 2 первых: группа 3–4 в среднем (1/3+1/4)/2
    expect(towerMinBudget({ base_places: 4, individual_places: 2, min_prize_ton: "0.1" })).toBe(0.7143);
  });

  it("сводка в списке настроек", () => {
    expect(summarize("tower_prizes", DEFAULT)).toBe("Выключены");
    expect(summarize("tower_prizes", { ...DEFAULT, budget_ton: "20" })).toBe("Выключены · 20 TON в месяц");
    expect(summarize("tower_prizes", { ...DEFAULT, enabled: true, budget_ton: "20" })).toBe("20 TON в месяц");
  });
});

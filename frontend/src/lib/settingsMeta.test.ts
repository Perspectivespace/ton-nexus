import { describe, expect, it } from "vitest";
import { fieldMeta, fromInput, parseTonList, summarize, toInput } from "./settingsMeta";

describe("призы «Башни» в редакторе владельца", () => {
  const DEFAULT = { enabled: false, places: [], min_participants: 10, min_score: 1, payout_mode: "review" };

  it("поля: вкл/выкл, суммы одной строкой, целые пороги", () => {
    expect(fieldMeta("tower_prizes", "enabled", false).kind).toBe("bool");
    expect(fieldMeta("tower_prizes", "places", []).kind).toBe("ton_list");
    expect(fieldMeta("tower_prizes", "min_participants", 10).kind).toBe("int");
  });

  it("вкл/выкл сохраняется булевым, а не строкой", () => {
    const m = fieldMeta("tower_prizes", "enabled", false);
    expect(toInput(m, true)).toBe("1");
    expect(fromInput(m, "1", false)).toBe(true);
    expect(fromInput(m, "0", true)).toBe(false);
  });

  it("суммы: строка ↔ места", () => {
    const m = fieldMeta("tower_prizes", "places", []);
    expect(fromInput(m, "5 3 1,5", [])).toEqual([
      { place: 1, ton: "5" },
      { place: 2, ton: "3" },
      { place: 3, ton: "1.5" },
    ]);
    expect(fromInput(m, "5; 3;  2.50", [])).toEqual([
      { place: 1, ton: "5" },
      { place: 2, ton: "3" },
      { place: 3, ton: "2.5" },
    ]);
    expect(fromInput(m, "  ", [])).toEqual([]);
    expect(toInput(m, [{ place: 2, ton: "3" }, { place: 1, ton: "5" }])).toBe("5 3");
  });

  it("суммы: ошибки по-русски", () => {
    expect(() => parseTonList("3 5")).toThrow("место 2: не больше, чем за место 1");
    expect(() => parseTonList("0")).toThrow("больше 0");
    expect(() => parseTonList("abc")).toThrow("нужно число");
    expect(() => parseTonList("1001")).toThrow("не больше 1000");
    expect(() => parseTonList(Array(21).fill("1").join(" "))).toThrow("не больше 20 мест");
  });

  it("сводка в списке настроек", () => {
    expect(summarize("tower_prizes", DEFAULT)).toBe("Выключены");
    expect(summarize("tower_prizes", { ...DEFAULT, enabled: true, places: [{ place: 1, ton: "5" }, { place: 2, ton: "3" }] })).toBe("5 / 3 TON");
  });
});

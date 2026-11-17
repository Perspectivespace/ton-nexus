import { describe, expect, it } from "vitest";
import {
  SETTINGS,
  cityAdsExample,
  fieldMeta,
  fromInput,
  parseIntList,
  summarize,
  taskTariffExamples,
  toInput,
  towerMinBudget,
} from "./settingsMeta";

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

describe("TON: сеть списком и пополнения", () => {
  it("сеть — выбор mainnet/testnet, чужое значение не сохраняется", () => {
    const m = fieldMeta("ton_wallet", "network", "mainnet");
    expect(m.kind).toBe("select");
    expect(fromInput(m, "testnet", "mainnet")).toBe("testnet");
    expect(() => fromInput(m, "devnet", "mainnet")).toThrow();
    expect(summarize("ton_wallet", { enabled: true, network: "testnet", unique_address: true })).not.toContain("undefined");
  });
  it("адрес кошелька проекта можно оставить пустым, опрос 5–120 с", () => {
    const addr = fieldMeta("ton_deposits", "project_address", "");
    expect(fromInput(addr, "", "")).toBe("");
    const poll = fieldMeta("ton_deposits", "poll_seconds", 15);
    expect(fromInput(poll, "15", 15)).toBe(15);
    expect(() => fromInput(poll, "2", 15)).toThrow();
    expect(summarize("ton_deposits", { enabled: true, project_address: "", min_ton: "0.1", poll_seconds: 15 })).toContain("нет кошелька");
  });
  it("арена — один флаг", () => {
    expect(fieldMeta("arena", "enabled", false).kind).toBe("bool");
    expect(summarize("arena", { enabled: false })).toBe("Выключено · комиссия 10%");
    expect(summarize("arena", { enabled: true, commission_bp: 1250 })).toBe("Включено · комиссия 12.5%");
    const c = fieldMeta("arena", "commission_bp", 1000);
    expect([c.kind, c.min, c.max]).toEqual(["pct_bp", 0, 30]);
    expect(toInput(c, 1250)).toBe("12.5");
    expect(fromInput(c, "7.5", 1000)).toBe(750);
  });
  it("выплаты TON — кошелёк выплат текстом, сводка без адреса — выключено", () => {
    const w = fieldMeta("ton_payouts", "payout_wallet", "");
    expect(w.kind).toBe("text");
    expect(fromInput(w, "", "")).toBe("");
    expect(fieldMeta("ton_payouts", "enabled", false).kind).toBe("bool");
    expect(summarize("ton_payouts", { enabled: false, payout_wallet: "" })).toContain("нет кошелька выплат");
    expect(summarize("ton_payouts", { enabled: true, payout_wallet: "UQAbcdEFgh12abcdef" })).toBe("Включено · UQAbcd…cdef");
  });
});

describe("тариф заданий в редакторе владельца", () => {
  const TARIFF = {
    visit: { reward: "0.01", commission_bp: 1000, xp: 5, min_slots: 1, max_slots: 10000 },
    campaign: { commission_bp: 1000, xp: 10 },
    partner: { fee_bp: 1000, xp: 5 },
  };

  it("поля: типы и русские подписи", () => {
    expect(fieldMeta("task_tariff", "visit", TARIFF.visit).label).toBe("Переход на сторонний ресурс");
    expect(fieldMeta("task_tariff", "campaign", TARIFF.campaign).label).toBe("Кампания");
    expect(fieldMeta("task_tariff", "partner", TARIFF.partner).label).toBe("Партнёрская услуга");
    expect(fieldMeta("task_tariff", "reward", "0.01")).toMatchObject({
      kind: "ton",
      unit: "TON",
      label: "Цена выполнения",
    });
    expect(fieldMeta("task_tariff", "commission_bp", 1000)).toMatchObject({
      kind: "pct_bp",
      unit: "%",
      label: "Комиссия владельца",
    });
    expect(fieldMeta("task_tariff", "fee_bp", 1000)).toMatchObject({
      kind: "pct_bp",
      label: "Комиссия с продажи",
    });
    expect(fieldMeta("task_tariff", "xp", 5).unit).toBe("XP");
  });

  it("цена — строка TON, комиссия — bp из %", () => {
    expect(fromInput(fieldMeta("task_tariff", "reward", "0.01"), "0,03", "0.01")).toBe("0.03");
    expect(toInput(fieldMeta("task_tariff", "commission_bp", 1000), 1000)).toBe("10");
    expect(fromInput(fieldMeta("task_tariff", "commission_bp", 1000), "10", 1000)).toBe(1000);
  });

  it("сводка в списке настроек", () => {
    expect(summarize("task_tariff", TARIFF)).toBe("переход 0.01 TON · комиссия 10% · партнёр 10%");
  });
});

describe("пример тарифа заданий", () => {
  it("100 выполнений и покупка 1 TON", () => {
    const ex = taskTariffExamples({
      visit: { reward: "0.01", commission_bp: 1000 },
      partner: { fee_bp: 1000 },
    });
    expect(ex.visit).toContain("заказчик платит 1.1 TON");
    expect(ex.visit).toContain("исполнители получают 1 TON");
    expect(ex.visit).toContain("комиссия 0.1 TON");
    expect(ex.partner).toContain("партнёр получает 0.9 TON");
    expect(ex.partner).toContain("комиссия платформы 0.1 TON");
  });
});

describe("реклама в городе в редакторе владельца", () => {
  const CFG = {
    min_level: 3,
    min_days: 1,
    max_days: 30,
    body_max: 500,
    spots: {
      tower_line: { price_day: "1", enabled: true },
      banner_sky: { price_day: "0.5", enabled: true },
      banner_street: { price_day: "0.5", enabled: true },
      neon_left: { price_day: "0.3", enabled: true },
      neon_right: { price_day: "0.3", enabled: false },
    },
    limits: { line: { title_max: 60 }, banner: { title_max: 14, subtitle_max: 18 }, neon: { title_max: 12 } },
  };

  it("поля: русские подписи и типы", () => {
    expect(SETTINGS.city_ads.title).toBe("Реклама в городе");
    expect(fieldMeta("city_ads", "tower_line", CFG.spots.tower_line).label).toBe("Бегущая строка · башня");
    expect(fieldMeta("city_ads", "price_day", "1")).toMatchObject({ kind: "ton", unit: "TON", label: "Цена за сутки" });
    expect(fieldMeta("city_ads", "enabled", true)).toMatchObject({ kind: "bool", label: "Продаётся" });
    expect(fieldMeta("city_ads", "min_level", 3)).toMatchObject({ kind: "int", label: "Мин. уровень" });
    expect(fieldMeta("city_ads", "subtitle_max", 18).unit).toBe("симв");
  });

  it("цена — строка TON, флаг — булево", () => {
    expect(fromInput(fieldMeta("city_ads", "price_day", "1"), "0,75", "1")).toBe("0.75");
    expect(fromInput(fieldMeta("city_ads", "enabled", true), "0", true)).toBe(false);
  });

  it("сводка и пример недели без ошибок округления", () => {
    expect(summarize("city_ads", CFG)).toBe("строка 1 · баннер 0.5 · неон 0.3 TON · снято с продажи: 1 · с 3 ур.");
    expect(summarize("city_ads", { ...CFG, min_level: 1 })).toBe("строка 1 · баннер 0.5 · неон 0.3 TON · снято с продажи: 1 · любой ур.");
    expect(cityAdsExample("0.3", 7)).toBe("2.1");
    expect(cityAdsExample("0.1", 3)).toBe("0.3");
    expect(cityAdsExample("1", 30)).toBe("30");
    expect(cityAdsExample("abc", 7)).toBeNull();
    expect(cityAdsExample("1", 0)).toBeNull();
  });
});

describe("«Честность» (integrity_rules) в редакторе владельца", () => {
  it("русские подписи, теневой режим и ограничения — только чтение", () => {
    expect(SETTINGS.integrity_rules.title).toBe("Честность");
    expect(fieldMeta("integrity_rules", "shadow_mode", true)).toMatchObject({ kind: "bool", readOnly: true });
    expect(fieldMeta("integrity_rules", "enabled", false, ["gates", "enabled"])).toMatchObject({
      kind: "bool",
      readOnly: true,
      label: "Включены",
    });
    expect(fieldMeta("integrity_rules", "enabled", true, ["enabled"]).readOnly).toBeFalsy();
    expect(fieldMeta("integrity_rules", "submission_rejected_forged", {}).label).toBe("Отказ: поддельное доказательство");
    expect(fieldMeta("integrity_rules", "half_life_days", 90)).toMatchObject({ kind: "int", unit: "дн", min: 0 });
  });

  it("тиры подписаны по-русски, сводка", () => {
    expect(SETTINGS.integrity_rules.rowLabel?.({ key: "exalted", min: 950 })).toBe("Превознесение");
    expect(SETTINGS.integrity_rules.rowLabel?.({ key: "hostile", min: 0 })).toBe("Неприязнь");
    expect(summarize("integrity_rules", { enabled: true, start: 500 })).toBe("копит события · старт 500 · теневой режим");
  });
});

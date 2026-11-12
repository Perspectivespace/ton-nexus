import { afterEach, describe, expect, it } from "vitest";
import { ru } from "./ru";
import { en } from "./en";
import { DICTS, LANGS, detectLang, fmtNum, pluralIndex, setLang, t, tp, type Key } from "./core";

/** Плейсхолдеры строки: {name} */
const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
const FORMS: Record<string, number> = { ru: 3, en: 2 };

describe("словари", () => {
  it("в каждом языке есть все ключи и нет лишних", () => {
    const base = Object.keys(ru).sort();
    for (const l of LANGS) {
      const keys = Object.keys(DICTS[l]).sort();
      expect(keys.filter((k) => !base.includes(k)), `${l}: лишние ключи`).toEqual([]);
      expect(base.filter((k) => !keys.includes(k)), `${l}: нет перевода`).toEqual([]);
    }
  });

  it("нет пустых строк", () => {
    for (const l of LANGS)
      for (const [k, v] of Object.entries(DICTS[l])) expect(v.trim(), `${l}.${k}`).not.toBe("");
  });

  it("подстановки одинаковые во всех языках", () => {
    for (const k of Object.keys(ru) as Key[]) {
      const want = [...new Set(vars(ru[k]))].sort();
      for (const l of LANGS) expect([...new Set(vars(DICTS[l][k]))].sort(), `${l}.${k}`).toEqual(want);
    }
  });

  it("множественное число: ru — 3 формы, en — 2", () => {
    for (const k of Object.keys(ru) as Key[]) {
      if (!ru[k].includes("|")) {
        expect(en[k].includes("|"), `en.${k}: формы есть только в en`).toBe(false);
        continue;
      }
      for (const l of LANGS) expect(DICTS[l][k].split("|").length, `${l}.${k}`).toBe(FORMS[l]);
    }
  });

  it("в английском нет кириллицы", () => {
    for (const [k, v] of Object.entries(en)) {
      if (k === "lang.title") continue; // «Язык / Language» — нарочно на обоих языках
      expect(/[\u0400-\u04FF]/.test(v), `en.${k}: ${v}`).toBe(false);
    }
  });
});

describe("язык и форматы", () => {
  afterEach(() => setLang("ru"));

  it("язык первого входа по Telegram: ru, uk, be, kk → RU, остальное → EN", () => {
    for (const c of ["ru", "ru-RU", "uk", "be", "kk", "KK"]) expect(detectLang(c)).toBe("ru");
    for (const c of ["en", "de", "uz", "", null, undefined]) expect(detectLang(c)).toBe("en");
  });

  it("t и tp переключаются вместе с языком", () => {
    setLang("ru");
    expect(t("nav.profile")).toBe("Профиль");
    expect([1, 2, 5, 21, 11].map((n) => tp("time.days", n))).toEqual(["1 день", "2 дня", "5 дней", "21 день", "11 дней"]);
    setLang("en");
    expect(t("nav.profile")).toBe("Profile");
    expect([1, 2, 5].map((n) => tp("time.days", n))).toEqual(["1 day", "2 days", "5 days"]);
    expect(pluralIndex(1, "en")).toBe(0);
  });

  it("числа по правилам языка", () => {
    setLang("en");
    expect(fmtNum(1240.5)).toBe("1,240.5");
    setLang("ru");
    expect(fmtNum(1240.5).replace(/\s/g, " ")).toBe("1 240,5");
  });
});

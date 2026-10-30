import { describe, expect, it } from "vitest";
import { closesOn, countdown, formatCountdown, monthEnd, monthPrepositional, monthTitle, mskMonth, prevMonth, spokenCountdown } from "./month";

const at = (iso: string) => Date.parse(iso);

describe("месяц топа по Москве", () => {
  it("граница месяца — 00:00 МСК, а не UTC", () => {
    expect(mskMonth(at("2026-10-31T20:59:59Z"))).toBe("2026-10");
    expect(mskMonth(at("2026-10-31T21:00:00Z"))).toBe("2026-11");
  });

  it("предыдущий месяц и переход года", () => {
    expect(prevMonth("2026-10")).toBe("2026-09");
    expect(prevMonth("2026-01")).toBe("2025-12");
    expect(prevMonth("мусор")).toBe("мусор");
  });

  it("конец месяца совпадает с сервером (month_ends_at)", () => {
    expect(new Date(monthEnd("2026-10")).toISOString()).toBe("2026-10-31T21:00:00.000Z");
    expect(new Date(monthEnd("2026-12")).toISOString()).toBe("2026-12-31T21:00:00.000Z");
    expect(monthEnd("x")).toBeNaN();
  });

  it("подписи месяца", () => {
    const now = at("2026-10-15T12:00:00Z");
    expect(monthTitle("2026-10", now)).toBe("Октябрь");
    expect(monthTitle("2025-12", now)).toBe("Декабрь 2025");
    expect(closesOn("2026-10")).toBe("1 ноября");
    expect(closesOn("2026-12")).toBe("1 января");
    expect(monthPrepositional("2026-05")).toBe("мае");
    expect(monthPrepositional("2026-08")).toBe("августе");
  });
});

describe("обратный отсчёт", () => {
  const end = "2026-10-31T21:00:00+00:00";

  it("дни, часы, минуты, секунды", () => {
    const c = countdown(end, at("2026-10-19T16:54:51Z"));
    expect(c).toEqual({ days: 12, h: 4, m: 5, s: 9, over: false });
    expect(formatCountdown(c)).toBe("12 д 04:05:09");
    expect(spokenCountdown(c)).toBe("12 дней 4 часа");
  });

  it("в последние сутки — без дней, вслух с минутами", () => {
    const c = countdown(end, at("2026-10-31T19:59:00Z"));
    expect(formatCountdown(c)).toBe("01:01:00");
    expect(spokenCountdown(c)).toBe("1 час 1 минута");
  });

  it("прошедшая или неверная дата — ноль и over", () => {
    expect(countdown(end, at("2026-11-01T00:00:00Z")).over).toBe(true);
    expect(countdown("не дата").over).toBe(true);
    expect(formatCountdown(countdown(undefined))).toBe("00:00:00");
  });
});

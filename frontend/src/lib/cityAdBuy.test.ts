import { describe, expect, it } from "vitest";
import {
  addDays,
  adTimeline,
  canCancel,
  canEditLink,
  contentField,
  diffDays,
  fmtRange,
  linkHint,
  monthGrid,
  refundOnReject,
  statusView,
  ton,
  tonToNano,
  unshownDays,
} from "./cityAdBuy";
import type { CityAdMine, CityAdOwner } from "@/api/hooks";

const ad = (p: Partial<CityAdOwner> = {}): CityAdOwner => ({
  id: 1, spot: "banner_sky", format: "banner", status: "approved", title: "T", subtitle: null, body: null, link_url: null, link_kind: null,
  color: "cyan", start: "2026-11-10", end: "2026-11-16", days: 7, price_day: "0.5", total: "3.5", paid: "3.5", refunded: "0",
  total_nano: 3_500_000_000, paid_nano: 3_500_000_000, refunded_nano: 0, moderation_note: null, moderated: true, created_at: null, stats: null,
  advertiser_id: 9, revenue_nano: 3_500_000_000, held_nano: 0, link_changed_at: null, ...p,
});

describe("даты", () => {
  it("арифметика и подписи", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(diffDays("2026-11-08", "2027-02-06")).toBe(90);
    expect(fmtRange("2026-11-12", "2026-11-18")).toBe("12–18 ноя");
    expect(fmtRange("2026-11-28", "2026-12-03")).toBe("28 ноя – 3 дек");
    expect(fmtRange("2026-11-12", "2026-11-12")).toBe("12 ноя");
  });
  it("сетка месяца с понедельника", () => {
    const g = monthGrid("2026-11"); // 1 ноября 2026 — воскресенье
    expect(g[0].slice(0, 7)).toEqual([null, null, null, null, null, null, "2026-11-01"]);
    expect(g.flat().filter(Boolean)).toHaveLength(30);
    expect(g.every((w) => w.length === 7)).toBe(true);
  });
});

describe("суммы", () => {
  it("TON без хвостовых нулей", () => {
    expect(ton(3_500_000_000)).toBe("3.5 TON");
    expect(ton(300_000_000)).toBe("0.3 TON");
    expect(ton(0)).toBe("0 TON");
    expect(tonToNano("12.25")).toBe(12_250_000_000);
  });
});

describe("подсказки по ссылке (сервер — главный)", () => {
  it.each([
    ["", null],
    ["https://example.org/x", null],
    ["t.me/nexus_test", null],
    ["http://example.org", "Ссылка: нужен защищённый адрес https://"],
    ["ftp://x.org", "Ссылка: только https:// или t.me/…"],
    ["bit.ly/pixel", "Ссылка: сокращатели запрещены — укажите полный адрес"],
    ["example.org/x", "Ссылка: начните с https://"],
    ["https://bit.ly/abc", "Ссылка: сокращатели запрещены — укажите полный адрес"],
    ["https://1.2.3.4/x", "Ссылка: адрес по IP запрещён — нужен домен"],
    ["https://t.me/", "Ссылка t.me: укажите канал, бота или чат"],
    ["https://user:pw@example.org", "Ссылка: логин и пароль в адресе запрещены"],
    ["https://localhost", "Ссылка: неверный адрес сайта"],
  ])("%s", (url, want) => expect(linkHint(url)).toBe(want));

  it("ошибки сервера раскладываются по полям", () => {
    expect(contentField("Ссылка: сокращатели ссылок запрещены — укажите полный адрес")).toBe("link");
    expect(contentField("Текст в городе: не длиннее 14 символов")).toBe("title");
    expect(contentField("Подпись бывает только у баннера")).toBe("subtitle");
    expect(contentField("Текст объявления: не длиннее 500 символов")).toBe("body");
    expect(contentField("Цвет: только из палитры города")).toBe("color");
    expect(contentField("Срок: от 1 до 30 суток")).toBeNull();
  });
});

describe("статусы и действия", () => {
  const today = "2026-11-12";
  it("в эфире / впереди / завершено", () => {
    expect(adTimeline(ad(), today)).toBe("live");
    expect(adTimeline(ad({ start: "2026-11-13" }), today)).toBe("upcoming");
    expect(adTimeline(ad({ end: "2026-11-11" }), today)).toBe("ended");
    expect(statusView(ad(), today)).toEqual({ label: "В эфире", tone: "ok" });
    expect(statusView(ad({ status: "pending", moderated: false }), today).label).toBe("На проверке");
    expect(statusView(ad({ status: "pending" }), today).label).toBe("Снова на проверке");
    expect(statusView(ad({ status: "rejected", refunded_nano: 3_500_000_000 }), today).label).toBe("Отклонено");
    expect(statusView(ad({ status: "rejected", refunded_nano: 2_500_000_000 }), today).label).toBe("Снято");
  });
  it("отмена — только до проверки; ссылку можно менять, пока показ не закончился", () => {
    const m = (p: Partial<CityAdMine>) => ad(p) as CityAdMine;
    expect(canCancel(m({ status: "pending", moderated: false }))).toBe(true);
    expect(canCancel(m({ status: "pending", moderated: true }))).toBe(false);
    expect(canCancel(m({ status: "approved" }))).toBe(false);
    expect(canEditLink(m({ status: "approved" }), today)).toBe(true);
    expect(canEditLink(m({ status: "approved", end: "2026-11-11" }), today)).toBe(false);
    expect(canEditLink(m({ status: "rejected" }), today)).toBe(false);
  });
  it("возврат при снятии — как на сервере: удержанное + непоказанные сутки с сегодняшних", () => {
    expect(unshownDays(ad(), today)).toBe(5); // 12..16
    expect(unshownDays(ad({ start: "2026-11-20", end: "2026-11-21" }), today)).toBe(2);
    expect(refundOnReject(ad(), today)).toBe(2_500_000_000);
    // на проверке, ни разу не одобрено: всё удержано
    expect(refundOnReject(ad({ status: "pending", revenue_nano: 0, held_nano: 3_500_000_000 }), today)).toBe(3_500_000_000);
  });
});

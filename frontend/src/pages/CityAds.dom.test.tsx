// @vitest-environment jsdom
/**
 * Покупка рекламы в городе (PR 5): замок ниже уровня, шаги с живым расчётом, 409 и 402, «Мои объявления», модерация.
 * Сеть — подменённый fetch (тот же api-клиент и react-query, что в приложении).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { CityAds } from "./CityAds";
import { CityAdsOwner } from "@/components/owner/CityAdsOwner";

const BOARD = {
  day: "2026-11-08",
  palette: {},
  min_level: 3,
  min_days: 1,
  max_days: 30,
  body_max: 500,
  limits: { line: { title_max: 60 }, banner: { title_max: 14, subtitle_max: 18 }, neon: { title_max: 12 } },
  spots: [
    { key: "tower_line", format: "line", title: "Бегущая строка на реакторной башне", on_sale: true, price_day: "1", ad: null },
    { key: "banner_sky", format: "banner", title: "Голо-баннер над площадью", on_sale: true, price_day: "0.5", ad: null },
    { key: "neon_left", format: "neon", title: "Неоновая вывеска слева", on_sale: false, price_day: "0.3", ad: null },
  ],
};
const ME = { id: 1, level: 5, balance: "10", is_owner: false, miner: null };
const AD = {
  id: 41, spot: "banner_sky", format: "banner", status: "pending", title: "PIXEL", subtitle: "кофе", body: "Текст", link_url: "https://example.org/x",
  link_kind: "web", color: "magenta", start: "2026-11-10", end: "2026-11-16", days: 7, price_day: "0.5", total: "3.5", paid: "3.5", refunded: "0",
  total_nano: 3.5e9, paid_nano: 3.5e9, refunded_nano: 0, moderation_note: null, moderated: false, created_at: null,
  stats: { impression: 0, open: 0, click: 0 }, advertiser_id: 7, revenue_nano: 0, held_nano: 3.5e9, link_changed_at: null,
};

type Call = { method: string; path: string; body: unknown };
const PIC = "/api/v1/city-ads/images/0123456789abcdef0123456789abcdef/private";
let calls: Call[] = [];
let me: Record<string, unknown> = ME;
let bookStatus = 201;
let mine: unknown[] = [];

const ROWS_BOARD = {
  ...BOARD,
  district: "rows",
  image_upload: true as boolean,
  limits: { ...BOARD.limits, facade_screen: { title_max: 24, subtitle_max: 32 } },
  spots: [
    { key: "rows_facade", format: "facade_screen", district: "rows", title: "Экран на фасаде рынка", on_sale: true, price_day: "1.5", ad: null },
    { key: "rows_line", format: "line", district: "rows", title: "Бегущая строка над навесами", on_sale: true, price_day: "1", ad: null },
    { key: "rows_neon", format: "neon", district: "rows", title: "Неоновая вывеска у входа на рынок", on_sale: false, price_day: "0.3", ad: null },
    { key: "rows_banner", format: "banner", district: "rows", title: "Голо-баннер над крышей рынка", on_sale: true, price_day: "0.5", ad: null },
  ],
};
const PORT_BOARD = {
  ...BOARD,
  district: "port",
  spots: [
    { key: "port_line", format: "line", district: "port", title: "Бегущая строка на стреле крана", on_sale: true, price_day: "1", ad: null },
    { key: "port_banner_cargo", format: "banner", district: "port", title: "Голо-баннер на контейнерах", on_sale: true, price_day: "0.5", ad: null },
    { key: "port_banner_tram", format: "banner", district: "port", title: "Голо-баннер на станции трамвая", on_sale: true, price_day: "0.5", ad: null },
    { key: "port_neon", format: "neon", district: "port", title: "Неоновая вывеска над воротами склада", on_sale: true, price_day: "0.3", ad: null },
  ],
};

function quote(b: { spot: string; start: string; days: number; link_url?: string }) {
  if (b.link_url?.includes("bit.ly")) return [400, { detail: "Ссылка: сокращатели ссылок запрещены — укажите полный адрес" }];
  const busy = ["2026-11-12"];
  const end = new Date(Date.parse(`${b.start}T00:00:00Z`) + (b.days - 1) * 864e5).toISOString().slice(0, 10);
  const occupied = busy.filter((d) => d >= b.start && d <= end);
  const perDay = b.spot === "tower_line" ? 1e9 : b.spot === "rows_facade" ? 1.5e9 : 5e8;
  return [200, {
    spot: b.spot, format: b.spot === "tower_line" ? "line" : b.spot === "rows_facade" ? "facade_screen" : "banner", start: b.start, end, days: b.days,
    price_day: String(perDay / 1e9), total: String((perDay * b.days) / 1e9), price_day_nano: perDay, total_nano: perDay * b.days,
    available: !occupied.length, occupied, busy, next_free: occupied.length ? "2026-11-13" : b.start,
    earliest: "2026-11-09", latest: "2027-02-06",
    content: b.link_url ? { title: null, subtitle: null, body: null, link_url: b.link_url, link_kind: "web", color: "cyan" } : null,
  }];
}

function route(method: string, path: string, body: unknown): [number, unknown] {
  if (path === "/api/v1/city-ads" && method === "GET") return [200, BOARD];
  if (path === "/api/v1/city-ads?district=rows") return [200, ROWS_BOARD];
  if (path === "/api/v1/city-ads?district=port") return [200, PORT_BOARD];
  if (path === "/api/v1/me") return [200, me];
  if (path === "/api/v1/city-ads/quote") return quote(body as never) as [number, unknown];
  if (path === "/api/v1/city-ads" && method === "POST") {
    if (bookStatus === 409) return [409, { detail: "Эти сутки уже заняты" }];
    if (bookStatus === 402) return [402, { detail: "Недостаточно TON: нужно 3.5 TON" }];
    return [201, AD];
  }
  if (path === "/api/v1/city-ads/images" && method === "POST") return [201, { id: 77, width: 640, height: 520, size: 31000, preview_url: PIC }];
  if (/\/city-ads\/\d+\/image$/.test(path)) return [200, { ...AD, status: "pending", image_url: PIC }];
  if (path === "/api/v1/city-ads/mine") return [200, mine];
  if (path.endsWith("/cancel")) return [200, { ...AD, status: "cancelled" }];
  if (path.startsWith("/api/v1/city-ads/moderation")) {
    const st = new URL(`http://x${path}`).searchParams.get("status");
    const items = st === "pending" ? [AD] : [{ ...AD, id: 42, status: "approved", start: "2026-11-06", end: "2026-11-12", moderated: true, revenue_nano: 3.5e9, held_nano: 0, stats: { impression: 120, open: 30, click: 12 } }];
    return [200, { items, revenue_total: "3.5", revenue_total_nano: 3.5e9 }];
  }
  if (/\/(approve|reject)$/.test(path)) return [200, { ...AD, status: path.endsWith("approve") ? "approved" : "rejected" }];
  return [404, { detail: "nope" }];
}

let root: Root;
let el: HTMLDivElement;
async function render(ui: React.ReactNode, at = "/ads") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[at]}>{ui}</MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await wait(30);
}
const wait = (ms: number) => act(() => new Promise<void>((r) => setTimeout(r, ms)));
const btn = (t: string | RegExp) =>
  [...document.querySelectorAll("button")].find((b) => (typeof t === "string" ? b.textContent?.trim() === t : t.test(b.textContent ?? "")))!;
const text = () => document.body.textContent ?? "";
async function until(ok: () => boolean, ms = 2000) {
  for (let t = 0; t < ms && !ok(); t += 25) await wait(25);
  expect(ok()).toBe(true);
}
async function click(b: HTMLElement) {
  await act(async () => b.click());
  await wait(20);
}
async function type(input: HTMLInputElement | HTMLTextAreaElement, v: string) {
  const proto = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  calls = [];
  me = ME;
  bookStatus = 201;
  mine = [];
  URL.createObjectURL = vi.fn(() => "blob:pic");
  URL.revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? "GET").toUpperCase();
    const body = typeof init.body === "string" ? JSON.parse(init.body) : init.body;
    calls.push({ method, path: url, body });
    if (url.endsWith("/private")) return new Response(new Blob([new Uint8Array([82, 73, 70, 70])], { type: "image/webp" }), { status: 200 });
    const [status, json] = route(method, url, body);
    return new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
  }));
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
  vi.unstubAllGlobals();
});

async function toPay() {
  await render(<CityAds />, "/ads?spot=banner_sky");
  expect(btn(/Голо-баннер над площадью/).getAttribute("aria-checked")).toBe("true");
  await click(btn("Выбрать даты"));
  await wait(30);
  await click(btn("К тексту"));
  const title = document.querySelector<HTMLInputElement>('input[placeholder="ВАШ БРЕНД"]')!;
  await type(title, "PIXEL");
  await wait(450);
  await until(() => !btn("Проверить").disabled);
  await click(btn("Проверить"));
  await wait(30);
}

describe("покупка рекламы", () => {
  it("ниже минимального уровня — замок, расчёт не запрашивается", async () => {
    me = { ...ME, level: 2 };
    await render(<CityAds />);
    expect(text()).toContain("Реклама в городе — с 3-го уровня");
    expect(text()).toContain("ур. 2 / 3");
    expect(calls.some((c) => c.path.endsWith("/quote"))).toBe(false);
  });

  it("шаги: место → даты (занятое — с подсказкой) → текст с проверкой ссылки → оплата", async () => {
    await render(<CityAds />, "/ads?spot=banner_sky");
    expect(btn(/Неоновая вывеска слева/).disabled).toBe(true); // не продаётся
    await click(btn("Выбрать даты"));
    await wait(30);
    // 7 суток с 9-го задевают занятое 12-е → сразу ближайшее свободное (13-е)
    expect(calls.filter((c) => c.path.endsWith("/quote")).map((c) => (c.body as { start: string }).start)).toContain("2026-11-13");
    expect(text()).toContain("13–19 ноя");
    // ручной выбор начала, задевающего занятое, — предупреждение и блок «Далее»
    await click(btn((/^10$/)));
    await wait(30);
    expect(text()).toContain("уже заняты");
    expect(btn("К тексту").disabled).toBe(true);
    await click(btn(/Ближайшее свободное/));
    await wait(30);
    expect(btn("К тексту").disabled).toBe(false);
    expect(text()).toContain("3.5 TON");
    await click(btn("К тексту"));
    // кнопка «Проверить» ждёт надпись; сокращатель — подсказка сразу, без сервера
    expect(btn("Проверить").disabled).toBe(true);
    await type(document.querySelector<HTMLInputElement>('input[placeholder="ВАШ БРЕНД"]')!, "PIXEL");
    const link = document.querySelector<HTMLInputElement>('input[inputmode="url"]')!;
    await type(link, "https://bit.ly/x");
    await until(() => text().includes("сокращатели запрещены"));
    expect(btn("Проверить").disabled).toBe(true);
    await type(link, "https://example.org/x");
    await until(() => text().includes("Откроется во внешнем браузере"));
    await click(btn("Проверить"));
    expect(text()).toContain("Итого");
    await click(btn(/^Оплатить/));
    await click(btn(/^Списать/));
    await until(() => text().includes("Оплачено — объявление на проверке"));
    const book = calls.find((c) => c.method === "POST" && c.path === "/api/v1/city-ads")!;
    expect(book.body).toMatchObject({ spot: "banner_sky", start: "2026-11-13", days: 7, title: "PIXEL", color: "cyan", link_url: "https://example.org/x" });
    expect(text()).toContain("Оплачено — объявление на проверке");
  });

  it("409: сутки только что заняли — ничего не списано, предложение выбрать даты", async () => {
    bookStatus = 409;
    await toPay();
    await click(btn(/^Оплатить/));
    await click(btn(/^Списать/));
    await until(() => text().includes("Эти сутки только что заняли"));
    expect(text()).toContain("Эти сутки только что заняли");
    await click(btn("Выбрать даты"));
    expect(text()).toContain("Начало показа");
  });

  it("402: не хватает TON — понятное сообщение и «Пополнить»", async () => {
    bookStatus = 402;
    await toPay();
    await click(btn(/^Оплатить/));
    await click(btn(/^Списать/));
    await until(() => text().includes("Не хватает TON"));
    expect(text()).toContain("Недостаточно TON: нужно 3.5 TON");
    expect([...document.querySelectorAll("a")].some((a) => a.getAttribute("href") === "/wallet")).toBe(true);
  });

  it("баланса меньше суммы — оплата закрыта заранее", async () => {
    me = { ...ME, balance: "1" };
    await toPay();
    expect(text()).toContain("Не хватает 2.5 TON");
    expect(btn(/^Оплатить/).disabled).toBe(true);
  });
});

describe("покупка в районах (PR 6)", () => {
  it("касание места района (?spot=rows_facade): выбран район «Неон-ряды» и экран; заголовок 24 / подпись 32, картинка — по желанию; район уходит в расчёт и бронь", async () => {
    me = { ...ME, balance: "20" };
    await render(<CityAds />, "/ads?spot=rows_facade");
    expect(btn("Неон-ряды").getAttribute("aria-checked")).toBe("true");
    expect(btn("Центр").getAttribute("aria-checked")).toBe("false");
    expect(btn(/Экран на фасаде рынка/).getAttribute("aria-checked")).toBe("true");
    expect(btn(/Экран на фасаде рынка/).textContent).toContain("1.5 TON");
    expect(btn(/Неоновая вывеска у входа на рынок/).disabled).toBe(true);
    // на картинке — места района (рамки на рисунке района), а не кадр Центра
    expect(document.querySelector('.cab-dz[data-district="rows"]')).not.toBeNull();
    expect(document.querySelectorAll(".cab-dz .cab-slot").length).toBe(4);
    await click(btn("Выбрать даты"));
    await wait(30);
    const q = calls.find((c) => c.path.endsWith("/quote"))!;
    expect(q.body).toMatchObject({ spot: "rows_facade", district: "rows" });
    await click(btn("К тексту"));
    expect(text()).toContain("Заголовок на экране");
    expect(text()).toContain("Подпись на экране");
    expect(text()).toContain("Картинка на экране");
    expect(document.querySelector<HTMLInputElement>('input[type="file"]')?.accept).toBe("image/png,image/jpeg,image/webp");
    const [title, sub] = [...document.querySelectorAll<HTMLInputElement>(".cab-step input.ui-input")];
    expect([title.maxLength, sub.maxLength]).toEqual([24, 32]);
    await type(title, "PIXEL CAFE");
    await type(sub, "второй кофе в подарок");
    // превью — экран района в облике места, с текстом покупателя
    await until(() => document.querySelector(".cab-dz .dz-ad.k-facade_screen .t")?.textContent === "PIXEL CAFE");
    expect(document.querySelector(".cab-dz .dz-ad.k-facade_screen .p")?.textContent).toBe("второй кофе в подарок");
    await wait(450);
    await until(() => !btn("Проверить").disabled);
    await click(btn("Проверить"));
    expect(text()).toContain("Неон-ряды · Экран на фасаде рынка");
    await click(btn(/^Оплатить/));
    await click(btn(/^Списать/));
    await until(() => text().includes("Оплачено — объявление на проверке"));
    const book = calls.find((c) => c.method === "POST" && c.path === "/api/v1/city-ads")!;
    expect(book.body).toMatchObject({ spot: "rows_facade", district: "rows", title: "PIXEL CAFE", subtitle: "второй кофе в подарок" });
    expect((book.body as { image_id?: number }).image_id).toBeUndefined();
  });

  it("картинка экрана: загрузка → превью пережатой картинки на рисунке района днём и ночью → id в брони", async () => {
    me = { ...ME, balance: "20" };
    await render(<CityAds />, "/ads?spot=rows_facade");
    await click(btn("Выбрать даты"));
    await wait(30);
    await click(btn("К тексту"));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    // не тот тип — ошибка, на сервер ничего не уходит
    const gif = new File([new Uint8Array([71, 73, 70])], "a.gif", { type: "image/gif" });
    Object.defineProperty(input, "files", { value: [gif], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await wait(20);
    expect(text()).toContain("Нужна картинка PNG, JPG или WebP");
    expect(calls.some((c) => c.path === "/api/v1/city-ads/images")).toBe(false);
    const png = new File([new Uint8Array([137, 80, 78, 71])], "poster.png", { type: "image/png" });
    Object.defineProperty(input, "files", { value: [png], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await until(() => !!document.querySelector(".cab-dz .dz-ad.k-facade_screen.has-pic img.pic"));
    const up = calls.find((c) => c.path === "/api/v1/city-ads/images")!;
    expect(up.method).toBe("POST");
    expect(up.body).toBe(png); // без canvas (jsdom) — исходный файл
    expect(calls.some((c) => c.path === PIC)).toBe(true); // превью — уже пережатая сервером картинка
    expect(document.querySelector(".cab-dz .has-pic img.pic")!.getAttribute("src")).toBe("blob:pic");
    expect(document.querySelector<HTMLImageElement>(".cab-pic-img")!.src).toBe("blob:pic");
    // день и ночь — на том же рисунке района
    expect(document.querySelector(".cab-mini.ph-night")).not.toBeNull();
    await click(btn("Днём"));
    expect(document.querySelector(".cab-mini.ph-day .has-pic")).not.toBeNull();
    const [title] = [...document.querySelectorAll<HTMLInputElement>(".cab-step input.ui-input")];
    await type(title, "PIXEL CAFE");
    await wait(450);
    await until(() => !btn("Проверить").disabled);
    await click(btn("Проверить"));
    expect(text()).toContain("есть · проверит владелец");
    expect(document.querySelector(".cab-prev .ph-day .has-pic")).not.toBeNull(); // выбор «Днём» сохранился
    await click(btn("Ночью"));
    expect(document.querySelector(".cab-prev .ph-night .has-pic")).not.toBeNull();
    await click(btn(/^Оплатить/));
    await click(btn(/^Списать/));
    await until(() => text().includes("Оплачено — объявление на проверке"));
    const book = calls.find((c) => c.method === "POST" && c.path === "/api/v1/city-ads")!;
    expect(book.body).toMatchObject({ spot: "rows_facade", image_id: 77 });
  });

  it("на сервере нет обработки картинок — выбора картинки нет, экран только с текстом", async () => {
    const saved = ROWS_BOARD.image_upload;
    ROWS_BOARD.image_upload = false;
    try {
      await render(<CityAds />, "/ads?spot=rows_facade");
      await click(btn("Выбрать даты"));
      await wait(30);
      await click(btn("К тексту"));
      expect(document.querySelector('input[type="file"]')).toBeNull();
      expect(text()).toContain("Экран — заголовок и подпись");
    } finally {
      ROWS_BOARD.image_upload = saved;
    }
  });

  it("выбор района: Центр → Порт — места Порта с ценами по типу; выбор сохраняется в адресе", async () => {
    await render(<CityAds />, "/ads");
    expect(btn("Центр").getAttribute("aria-checked")).toBe("true");
    expect(btn(/Голо-баннер над площадью/)).toBeTruthy();
    await click(btn("Порт"));
    await until(() => !!btn(/Голо-баннер на станции трамвая/));
    expect(calls.some((c) => c.path === "/api/v1/city-ads?district=port")).toBe(true);
    expect(btn("Порт").getAttribute("aria-checked")).toBe("true");
    expect(btn(/Бегущая строка на стреле крана/).getAttribute("aria-checked")).toBe("true"); // первое в продаже
    expect(btn(/Неоновая вывеска над воротами склада/).textContent).toContain("0.3 TON");
    expect(btn(/Голо-баннер над площадью/)).toBeUndefined();
    await click(btn("Выбрать даты"));
    await wait(30);
    expect(calls.filter((c) => c.path.endsWith("/quote")).at(-1)!.body).toMatchObject({ spot: "port_line", district: "port" });
  });

  it("ниже 3-го уровня район тоже закрыт", async () => {
    me = { ...ME, level: 2 };
    await render(<CityAds />, "/ads?district=port");
    expect(text()).toContain("Реклама в городе — с 3-го уровня");
    expect(text()).toContain("4 места в районе");
    expect(calls.some((c) => c.path.endsWith("/quote"))).toBe(false);
  });
});

describe("Мои объявления", () => {
  it("в эфире в районе — ссылка «На улице» к месту; в Центре и не в эфире — нет (PR 6b)", async () => {
    const live = { status: "approved", moderated: true, start: "2026-11-06", end: "2026-11-12" };
    mine = [
      { ...AD, ...live, id: 60, spot: "rows_facade", district: "rows", spot_title: "Экран на фасаде рынка", format: "facade_screen" },
      { ...AD, ...live, id: 61, district: "centre" },
      { ...AD, id: 62, spot: "port_neon", district: "port", format: "neon" }, // на проверке
      { ...AD, ...live, id: 63, spot: "port_neon", district: "port", format: "neon", start: "2026-11-09" }, // ещё не начался
    ];
    await render(<CityAds />, "/ads?tab=mine");
    const links = [...document.querySelectorAll("a")].filter((a) => a.textContent === "На улице");
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["/district?d=rows&spot=rows_facade"]);
  });

  it("район и русское название места, не ключ", async () => {
    mine = [
      { ...AD, id: 50, spot: "rows_facade", district: "rows", spot_title: "Экран на фасаде рынка", format: "facade_screen" },
      { ...AD, id: 51, spot: "port_neon", district: "port", spot_title: "Неоновая вывеска над воротами склада", format: "neon" },
      { ...AD, id: 52, district: "centre", spot_title: "Голо-баннер над площадью" },
    ];
    await render(<CityAds />, "/ads?tab=mine");
    expect(text()).toContain("Неон-ряды · Экран на фасаде рынка");
    expect(text()).toContain("Порт · Вывеска над воротами склада");
    expect(text()).toContain("Центр · Баннер над площадью");
    expect(text()).not.toMatch(/rows_facade|port_neon/);
    expect(document.querySelector('.cab-thumb.cab-dz[data-district="rows"]')).not.toBeNull();
  });

  it("статус, счётчики, отмена до проверки с возвратом", async () => {
    mine = [AD, { ...AD, id: 43, status: "approved", moderated: true, start: "2026-11-06", stats: { impression: 200, open: 40, click: 10 } }];
    await render(<CityAds />, "/ads?tab=mine");
    expect(text()).toContain("На проверке");
    expect(text()).toContain("В эфире");
    expect(text()).toContain("5.0%"); // CTR 10/200
    await click(btn("Отменить"));
    expect(text()).toContain("3.5 TON вернутся на баланс");
    await click(btn("Отменить и вернуть"));
    expect(calls.some((c) => c.method === "POST" && c.path === "/api/v1/city-ads/41/cancel")).toBe(true);
  });

  it("смена ссылки одобренного — предупреждение о повторной проверке", async () => {
    mine = [{ ...AD, status: "approved", moderated: true }];
    await render(<CityAds />, "/ads?tab=mine");
    await click(btn("Изменить ссылку"));
    expect(text()).toContain("снова уйдёт на проверку");
  });
});

describe("Кабинет → Реклама", () => {
  it("очередь с превью, одобрение, отклонение с причиной, снятие с возвратом за непоказанные сутки", async () => {
    await render(<CityAdsOwner />, "/owner?tab=ads");
    expect(text()).toContain("Доход с рекламы");
    expect(text()).toContain("Центр · Баннер над площадью");
    expect(text()).toContain("3.5 TON");
    expect(document.querySelector(".cad-card.cab-static")!.textContent).toContain("PIXEL");
    await click(btn("Одобрить"));
    expect(calls.some((c) => c.path === "/api/v1/city-ads/41/approve")).toBe(true);
    await click(btn("Отклонить"));
    await click(btn("Ссылка не открывается"));
    await click(btn(/^Отклонить · /));
    const rej = calls.find((c) => c.path === "/api/v1/city-ads/41/reject")!;
    expect(rej.body).toEqual({ note: "Ссылка не открывается" });
    // в эфире: снятие — 8..12 ноября, показано 6–7 → вернём 5 суток × 0.5
    await click(btn("В эфире"));
    expect(text()).toContain("показы");
    expect(document.querySelector(".cab-own-dz")?.textContent).toBe("Центр 120 пок. · 12 перех.");
    await click(btn("Снять с показа"));
    expect(text()).toContain("Вернём 2.5 TON за 5 суток без показа");
  });
});

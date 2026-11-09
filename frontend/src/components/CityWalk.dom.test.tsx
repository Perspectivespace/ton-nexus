// @vitest-environment jsdom
/**
 * «Прогулка» (реклама в городе, PR 3): места пассивны вне режима, касание в режиме открывает карточку,
 * события уходят только в режиме, переход на сайт — через подтверждение, в Telegram — сразу.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({ send: vi.fn(), open: vi.fn(() => true), board: null as unknown }));
vi.mock("@/api/hooks", () => ({
  useCityAds: () => ({ data: m.board, refetch: vi.fn(async () => ({})) }),
  sendCityAdEvent: m.send,
}));
vi.mock("@/lib/cityAdLink", async (orig) => ({ ...(await orig<typeof import("@/lib/cityAdLink")>()), openAdLink: m.open }));

import { CityAdSpots, fitFont } from "./CityAdSpots";
import { CityWalk } from "./CityWalk";
import { cityWalk, useCityWalk } from "@/lib/cityWalk";

const ad = (id: number, link_kind: "web" | "telegram", link_url: string) => ({
  id,
  title: `AD${id}`,
  subtitle: "подзаголовок",
  body: "строка 1\nстрока 2",
  link_url,
  link_kind,
  color: "magenta",
  until: "2026-11-10",
});
const BOARD = {
  day: "2026-11-08",
  palette: {},
  spots: [
    { key: "banner_sky", format: "banner", title: "Голо-баннер", on_sale: true, price_day: "1", ad: ad(1, "web", "https://example.org/x") },
    { key: "neon_right", format: "neon", title: "Неон", on_sale: true, price_day: "1", ad: ad(2, "telegram", "https://t.me/nexus_test") },
    { key: "neon_left", format: "neon", title: "Неон", on_sale: true, price_day: "1", ad: null },
  ],
};

let root: Root;
let el: HTMLDivElement;
const render = () =>
  act(() =>
    root.render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route
            path="*"
            element={
              <>
                <CityAdSpots phase="night" />
                <WalkHost />
                <Where />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    ),
  );
function Where() {
  const loc = useLocation();
  return <output data-testid="loc">{loc.pathname + loc.search}</output>;
}
function WalkHost() {
  return useCityWalk().active ? <CityWalk /> : null;
}
const spot = (k: string) => el.querySelector<HTMLButtonElement>(`[data-spot="${k}"]`)!;
const btn = (t: string) => [...el.querySelectorAll("button")].find((b) => b.textContent?.trim() === t)!;

beforeEach(() => {
  m.board = BOARD;
  m.send.mockClear();
  m.open.mockClear();
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => cityWalk.exit());
  act(() => root.unmount());
  el.remove();
});

describe("CityWalk", () => {
  it("вне «Прогулки» места пассивны и событий нет", () => {
    render();
    expect(el.querySelectorAll(".cad-spot")).toHaveLength(2);
    expect(spot("banner_sky").tabIndex).toBe(-1);
    expect(spot("banner_sky").getAttribute("aria-hidden")).toBe("true");
    act(() => spot("banner_sky").click());
    expect(el.querySelector(".cad-card")).toBeNull();
    expect(m.send).not.toHaveBeenCalled();
  });

  it("в «Прогулке»: показы, касание → карточка, сайт — через подтверждение", () => {
    render();
    act(() => cityWalk.enter());
    expect(document.documentElement.classList.contains("city-walk")).toBe(true);
    expect(m.send.mock.calls.map((c) => c.slice(0, 2))).toEqual([
      [1, "impression"],
      [2, "impression"],
    ]);
    expect(spot("banner_sky").tabIndex).toBe(0);
    act(() => spot("banner_sky").click());
    const card = el.querySelector(".cad-card")!;
    expect(card.textContent).toContain("AD1");
    expect(card.textContent).toContain("ещё 3 дн.");
    expect(card.textContent).toContain("example.org");
    expect(card.querySelector(".cc-body")!.textContent).toBe("строка 1\nстрока 2");
    expect(m.send).toHaveBeenCalledWith(1, "open", "2026-11-08");
    act(() => btn("Перейти").click());
    expect(m.open).not.toHaveBeenCalled();
    act(() => btn("Открыть сайт").click());
    expect(m.open).toHaveBeenCalledWith("https://example.org/x", "web");
    expect(m.send).toHaveBeenCalledWith(1, "click", "2026-11-08");
    act(() => btn("Закрыть").click());
    expect(el.querySelector(".cad-card")).toBeNull();
  });

  it("Telegram-ссылка открывается сразу; выход возвращает пассивный режим", () => {
    render();
    act(() => cityWalk.enter());
    act(() => spot("neon_right").click());
    act(() => btn("Перейти").click());
    expect(m.open).toHaveBeenCalledWith("https://t.me/nexus_test", "telegram");
    act(() => btn("× Выйти из прогулки").click());
    expect(document.documentElement.classList.contains("city-walk")).toBe(false);
    expect(el.querySelector(".walk-ui")).toBeNull();
    expect(spot("neon_right").tabIndex).toBe(-1);
  });

  it("без рекламы — подсказка без рекламы", () => {
    m.board = { ...BOARD, spots: [] };
    render();
    act(() => cityWalk.enter());
    expect(el.querySelector(".walk-hint")!.textContent).toBe("Ведите пальцем — осмотритесь");
  });
});

describe("покупка из «Прогулки» (PR 5)", () => {
  const loc = () => el.querySelector('[data-testid="loc"]')!.textContent;
  it("свободные места видны только в «Прогулке», касание ведёт к покупке этого места", () => {
    render();
    expect(el.querySelector(".cad-free")).toBeNull();
    act(() => cityWalk.enter());
    const free = el.querySelectorAll<HTMLButtonElement>(".cad-free");
    expect([...free].map((b) => b.dataset.free)).toEqual(["neon_left"]);
    act(() => free[0].click());
    expect(loc()).toBe("/ads?spot=neon_left");
  });

  it("кнопка «Реклама» открывает экран покупки; подсказка про свободное место без рекламы", () => {
    m.board = { ...BOARD, spots: [BOARD.spots[2]] };
    render();
    act(() => cityWalk.enter());
    expect(el.querySelector(".walk-hint")!.textContent).toBe("Ведите пальцем · свободное место можно занять");
    act(() => btn("+Реклама").click());
    expect(loc()).toBe("/ads");
  });
});

describe("fitFont", () => {
  it("короткое название — базовый кегль, длинное мельчает, но не меньше 7", () => {
    expect(fitFont("banner", "PIXEL", 126)).toBe(14.5);
    expect(fitFont("neon", "КИБЕРЧАЙ НОЧЬЮ", 106)).toBeLessThan(17.5);
    expect(fitFont("sub", "Х".repeat(80), 124)).toBe(7);
  });
});

describe("строка на башне", () => {
  it("продана — рисуется LED-строка с «МАЙНЕР» и текстом рекламы, в «Прогулке» касаема", () => {
    m.board = {
      ...BOARD,
      spots: [{ key: "tower_line", format: "line", title: "Строка", on_sale: true, price_day: "1", ad: ad(7, "telegram", "https://t.me/nexus_test") }],
    };
    render();
    const tick = spot("tower_line");
    expect(tick.classList.contains("cad-tick")).toBe(true);
    expect(tick.querySelector(".own")!.textContent).toBe("МАЙНЕР");
    expect(tick.querySelector(".trk")!.textContent).toBe("AD7 · подзаголовок");
    expect(tick.querySelector(".tk")!.classList.contains("m-own")).toBe(true);
    act(() => cityWalk.enter());
    act(() => spot("tower_line").click());
    expect(el.querySelector(".cad-card")!.textContent).toContain("БЕГУЩАЯ СТРОКА");
  });
});

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

const m = vi.hoisted(() => ({ send: vi.fn(), open: vi.fn(() => true), board: null as unknown, owner: false }));
vi.mock("@/api/hooks", () => ({
  useCityAds: () => ({ data: m.board, refetch: vi.fn(async () => ({})) }),
  sendCityAdEvent: m.send,
  useMe: () => ({ data: { is_owner: m.owner }, isLoading: false }),
}));
vi.mock("@/lib/cityAdLink", async (orig) => ({ ...(await orig<typeof import("@/lib/cityAdLink")>()), openAdLink: m.open }));

import { CityAdSpots, fitFont } from "./CityAdSpots";
import { CityWalk } from "./CityWalk";
import { cityWalk, useCityWalk } from "@/lib/cityWalk";
import { districtNav } from "@/lib/districtNav";

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
  m.owner = false;
  districtNav.reset();
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

describe("самореклама свободных мест Центра", () => {
  const loc = () => el.querySelector('[data-testid="loc"]')!.textContent;
  const TOWER = { key: "tower_line", format: "line", title: "Строка на башне", on_sale: true, price_day: "1.20", ad: null };

  it("в «Прогулке» свободное место рекламирует себя (вместо рамки «+ свободно»), касание — покупка", () => {
    render();
    expect(el.querySelector(".dz-idle")).toBeNull(); // на главной вне «Прогулки» — пусто
    act(() => cityWalk.enter());
    const free = el.querySelector<HTMLButtonElement>('.cad-free[data-free="neon_left"]')!;
    const idle = free.querySelector<HTMLElement>(".dz-idle")!;
    expect(idle.className).toContain("k-neon");
    expect(idle.className).toContain("compact");
    expect(idle.textContent).toBe("Засветись");
    expect(el.textContent).not.toContain("свободно");
    act(() => free.click());
    expect(loc()).toBe("/ads?spot=neon_left");
  });

  it("свободный баннер — голо-баннер с короткими слоганами", () => {
    m.board = { ...BOARD, spots: [{ key: "banner_street", format: "banner", title: "Баннер", on_sale: true, price_day: "1", ad: null }] };
    render();
    act(() => cityWalk.enter());
    const idle = el.querySelector<HTMLElement>('.cad-free[data-free="banner_street"] .dz-idle')!;
    expect(idle.className).toContain("k-banner");
    expect(idle.textContent).toBe("Засветись тут");
  });

  it("свободная строка на башне: «МАЙНЕР» ↔ «Место для рекламы · от X TON/сутки» и на главной; касание — только в «Прогулке»", () => {
    m.board = { ...BOARD, spots: [...BOARD.spots, TOWER] };
    render();
    const tick = () => el.querySelector<HTMLButtonElement>(".cad-idle-tick")!;
    expect(tick().textContent).toContain("МАЙНЕР");
    expect(tick().textContent).toContain("Место для рекламы · от 1,2 TON/сутки");
    expect(tick().tabIndex).toBe(-1);
    act(() => tick().click());
    expect(loc()).toBe("/");
    act(() => cityWalk.enter());
    expect(tick().tabIndex).toBe(0);
    act(() => tick().click());
    expect(loc()).toBe("/ads?spot=tower_line");
  });

  it("строка на башне не продаётся или куплена — саморекламы нет", () => {
    m.board = { ...BOARD, spots: [...BOARD.spots, { ...TOWER, on_sale: false }] };
    render();
    expect(el.querySelector(".cad-idle-tick")).toBeNull();
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

/* Районы (PR 3): полоска «Центр · Неон-ряды · Порт» в «Прогулке» — пока только владельцу (и dev-сборке). */
describe("районы в «Прогулке»", () => {
  const strip = () => el.querySelector(".dz-strip");

  it("в продакшене игрок полоски не видит, владелец — видит; Центр отмечен", () => {
    vi.stubEnv("DEV", false);
    try {
      render();
      act(() => cityWalk.enter());
      expect(strip()).toBeNull();
      expect(el.querySelector(".walk-ui")?.classList.contains("has-strip")).toBe(false);
      act(() => cityWalk.exit());
      m.owner = true;
      render();
      act(() => cityWalk.enter());
      expect([...strip()!.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Центр", "Неон-ряды", "Порт"]);
      expect(strip()!.querySelector("[aria-current=page]")?.textContent).toBe("Центр");
      expect(el.querySelector(".dz-edge.r")?.textContent).toContain("Неон-ряды");
      expect(el.querySelector(".dz-edge.l")).toBeNull(); // левее Центра ничего нет
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("касание «Неон-ряды» открывает район (с «меньше движения» — сразу)", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    try {
      m.owner = true;
      render();
      act(() => cityWalk.enter());
      act(() => btn("Неон-ряды").click());
      expect(el.querySelector("[data-testid=loc]")?.textContent).toBe("/district?d=rows");
      expect(districtNav.takeArrival()).toEqual({ dir: 1 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

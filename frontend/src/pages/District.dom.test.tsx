// @vitest-environment jsdom
/**
 * Экран района (PR 2 районов): доступ только dev/владельцу, вход в центре, 4 слоя со своей скоростью,
 * подкраска рассвета/вечера, на слабом устройстве — одна сведённая картинка без уличных событий; выход — на главную.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({
  me: { data: { is_owner: true } as { is_owner: boolean } | undefined, isLoading: false },
  load: vi.fn(),
  life: vi.fn(() => ({ stop: vi.fn(), spawn: vi.fn() })),
  phase: "night" as "dawn" | "day" | "dusk" | "night",
  event: vi.fn(),
  ads: { data: undefined } as {
    data?: {
      day?: string;
      spots: {
        key: string;
        price_day: string | null;
        on_sale?: boolean;
        format?: string;
        ad: { id: number; title: string; subtitle: string | null; color: string; body?: string | null; link_url?: string | null; link_kind?: string | null; until?: string } | null;
      }[];
      prices?: Record<string, string>;
    };
  },
}));
vi.mock("@/api/hooks", () => ({ useMe: () => m.me, useDistrictAds: () => m.ads, sendCityAdEvent: m.event }));
vi.mock("@/lib/districtAssets", () => ({ loadDistrict: m.load, preloadWhenIdle: () => () => {} }));
vi.mock("@/lib/districtLife", () => ({ startDistrictLife: m.life }));
vi.mock("@/lib/cityPhase", () => ({ useCityPhase: () => ({ phase: m.phase, upcoming: null }) }));

import { District } from "./District";
import { cityWalk } from "@/lib/cityWalk";
import { districtNav } from "@/lib/districtNav";

let root: Root;
let el: HTMLDivElement;
let path = "";
let search = "";
function Where() {
  const loc = useLocation();
  path = loc.pathname;
  search = loc.search;
  return null;
}
const render = async (url: string) => {
  await act(async () =>
    root.render(
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/district" element={<District />} />
          <Route path="*" element={<p>home</p>} />
        </Routes>
        <Where />
      </MemoryRouter>,
    ),
  );
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  m.me = { data: { is_owner: true }, isLoading: false };
  m.phase = "night";
  m.ads = {
    data: {
      spots: [
        { key: "rows_facade", price_day: "1.50", ad: null },
        { key: "rows_line", price_day: "0.5", ad: null },
        { key: "rows_neon", price_day: "0.7", ad: null },
        { key: "rows_banner", price_day: "1", ad: null },
      ],
    },
  };
  m.load.mockImplementation(async (_d: string, art: string, lite: boolean) =>
    lite ? { flat: `/flat-${art}.webp` } : { sky: `/sky-${art}`, far: `/far-${art}`, mid: `/mid-${art}`, near: `/near-${art}` },
  );
  m.life.mockClear();
  districtNav.reset();
  vi.stubGlobal("requestAnimationFrame", () => 0);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
  document.documentElement.classList.remove("low-end");
  vi.unstubAllGlobals();
});

describe("district screen", () => {
  it("final art (Неон-ряды and Порт) shows no «Черновик» badge", async () => {
    await render("/district?d=rows");
    expect(el.querySelector(".dz-badge")).toBeNull();
    expect(el.querySelector(".dz-far img")?.getAttribute("src")).toBe("/far-night");
    act(() => root.unmount());
    root = createRoot(el);
    await render("/district?d=port");
    expect(el.querySelector(".dz-badge")).toBeNull();
    expect(el.querySelector(".dz-far img")?.getAttribute("src")).toBe("/far-night");
  });

  it("renders 4 layers at their speeds, entered at the centre, and hides the app chrome", async () => {
    await render("/district?d=port");
    const layers = [...el.querySelectorAll<HTMLElement>(".dz-layer")];
    expect(layers.map((l) => [l.className, l.dataset.k])).toEqual([
      ["dz-layer dz-sky", "0.25"],
      ["dz-layer dz-far", "0.55"],
      ["dz-layer dz-mid", "1"],
      ["dz-layer dz-near", "1.3"],
    ]);
    expect(layers.map((l) => l.style.transform)).toEqual(Array(4).fill("translate3d(0.00px,0,0)"));
    expect(m.load).toHaveBeenCalledWith("port", "night", false);
    expect(el.querySelector(".dz")?.getAttribute("data-tint")).toBeNull();
    expect(document.documentElement.classList.contains("district-open")).toBe(true);
    expect(m.life).toHaveBeenCalledTimes(1);
    expect(el.querySelector(".dz")?.getAttribute("aria-label")).toContain("Порт");
    expect(el.querySelector(".dz-strip [aria-current=page]")?.textContent).toBe("Порт");
  });

  it("dawn = day art + tint, dusk = night art + tint", async () => {
    m.phase = "dawn";
    await render("/district?d=rows");
    expect(m.load).toHaveBeenLastCalledWith("rows", "day", false);
    expect(el.querySelector(".dz-tint.dawn")).not.toBeNull();
    act(() => root.unmount());
    root = createRoot(el);
    m.phase = "dusk";
    await render("/district?d=rows");
    expect(m.load).toHaveBeenLastCalledWith("rows", "night", false);
    expect(el.querySelector(".dz-tint.dusk")).not.toBeNull();
  });

  it("low-end: one flattened image, no street events", async () => {
    document.documentElement.classList.add("low-end");
    await render("/district?d=rows");
    const layers = [...el.querySelectorAll<HTMLElement>(".dz-layer")];
    expect(layers.map((l) => l.className)).toEqual(["dz-layer dz-flat"]);
    expect(layers[0].querySelector("img")?.getAttribute("src")).toBe("/flat-night.webp");
    expect(m.life).not.toHaveBeenCalled();
  });

  it("?lite=1 shows the low-end variant", async () => {
    await render("/district?d=rows&lite=1");
    expect(el.querySelectorAll(".dz-layer").length).toBe(1);
  });

  it("exit returns home and restores the chrome", async () => {
    await render("/district?d=rows");
    await act(async () => el.querySelector<HTMLButtonElement>(".walk-exit")!.click());
    expect(path).toBe("/");
    expect(document.documentElement.classList.contains("district-open")).toBe(false);
  });

  it("production: open to every player (not only the owner), both districts; promo stays non-interactive", async () => {
    vi.stubEnv("DEV", false);
    try {
      for (const d of ["rows", "port"]) {
        m.me = { data: { is_owner: false }, isLoading: false };
        await render(`/district?d=${d}`);
        expect(path).toBe("/district");
        expect(el.querySelector(".dz")?.getAttribute("data-district")).toBe(d);
        expect(el.querySelectorAll(".dz-idles button, .dz-idles a").length).toBe(0); // покупка в районах — PR 6
        act(() => root.unmount());
        root = createRoot(el);
      }
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("strip: Порт → Неон-ряды and Центр (walk mode on the main page); edges show the neighbours", async () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true })); // «меньше движения» — переход сразу
    await render("/district?d=port");
    expect(el.querySelector(".dz-edge.l")?.textContent).toContain("Неон-ряды");
    expect(el.querySelector(".dz-edge.r")).toBeNull(); // Порт — крайний справа
    const btn = (t: string) => [...el.querySelectorAll<HTMLButtonElement>(".dz-strip button")].find((b) => b.textContent === t)!;
    await act(async () => btn("Неон-ряды").click());
    expect(path).toBe("/district");
    await act(async () => {
      await Promise.resolve();
    });
    expect(el.querySelector(".dz-strip [aria-current=page]")?.textContent).toBe("Неон-ряды");
    expect(districtNav.takeArrival()).toBeNull(); // новая сцена забрала направление прихода для камеры
    await act(async () => btn("Центр").click());
    expect(path).toBe("/");
    expect(cityWalk.get().active).toBe(true);
    act(() => cityWalk.exit());
  });

  it("«Выйти» — на главную без «Прогулки»", async () => {
    await render("/district?d=rows");
    await act(async () => el.querySelector<HTMLButtonElement>(".walk-exit")!.click());
    expect(path).toBe("/");
    expect(cityWalk.get().active).toBe(false);
  });

  it("unknown district falls back to Неон-ряды", async () => {
    await render("/district?d=moon");
    expect(m.load).toHaveBeenLastCalledWith("rows", "night", false);
  });
});

describe("district: idle promo on free ad spots (Неон-ряды)", () => {
  it("all four free surfaces advertise themselves inside the street layer, with the price; no tap handling", async () => {
    await render("/district?d=rows");
    const idle = [...el.querySelectorAll<HTMLElement>(".dz-mid .dz-idle")];
    expect(idle.map((n) => n.dataset.spot)).toEqual(["rows_facade", "rows_line", "rows_neon", "rows_banner"]);
    const facade = idle[0];
    expect(facade.querySelector(".t")?.textContent).toBe("Место для рекламы");
    expect(facade.querySelector(".p")?.textContent).toBe("от 1,5 TON/сутки");
    expect(idle[1].textContent).toBe("Место для рекламы · от 0,5 TON/сутки");
    expect(idle[2].textContent).toBe("Засветись тут");
    expect(idle[3].textContent).toBe("Засветись тут");
    expect(el.querySelector(".dz-idles")?.getAttribute("aria-hidden")).toBe("true");
    expect(el.querySelectorAll(".dz-idles button, .dz-idles a").length).toBe(0);
  });

  it("no spot row yet — the type price is used", async () => {
    m.ads = { data: { spots: [], prices: { facade_screen: "1.5", line: "1" } } };
    await render("/district?d=rows");
    expect(el.querySelector(".k-facade_screen .p")?.textContent).toBe("от 1,5 TON/сутки");
    expect(el.querySelector(".k-line")?.textContent).toBe("Место для рекламы · от 1 TON/сутки");
  });

  it("a bought spot shows the buyer's ad in the same look (PR 6): title, caption, colour — no promo", async () => {
    m.ads.data!.spots[0].ad = { id: 1, title: "PIXEL CAFE", subtitle: "второй кофе в подарок", color: "mint" };
    m.ads.data!.spots[3].ad = { id: 2, title: "NEXUS", subtitle: "скидка 20 %", color: "magenta" };
    m.ads.data!.spots[1].ad = { id: 3, title: "БЕГУЩАЯ СТРОКА РЫНКА", subtitle: null, color: "amber" };
    await render("/district?d=rows");
    const idle = [...el.querySelectorAll<HTMLElement>(".dz-mid .dz-idle")];
    expect(idle.map((n) => n.dataset.spot)).toEqual(["rows_facade", "rows_line", "rows_neon", "rows_banner"]);
    const [facade, line, neon, banner] = idle;
    expect(facade.classList.contains("dz-ad")).toBe(true);
    expect(facade.querySelector(".tag")).toBeNull();
    expect(facade.querySelector(".t")?.textContent).toBe("PIXEL CAFE");
    expect(facade.querySelector(".p")?.textContent).toBe("второй кофе в подарок");
    expect(facade.style.getPropertyValue("--ac")).toBe("#5DFFB0");
    expect(line.classList.contains("dz-ad")).toBe(true);
    expect(line.textContent).toBe("БЕГУЩАЯ СТРОКА РЫНКА");
    expect(banner.querySelector(".t")?.textContent).toBe("NEXUS");
    expect(banner.querySelector(".s")?.textContent).toBe("скидка 20 %");
    expect(banner.style.getPropertyValue("--ac")).toBe("#FF2E7E");
    // свободное место по-прежнему рекламирует само себя
    expect(neon.classList.contains("dz-ad")).toBe(false);
    expect(neon.textContent).toBe("Засветись тут");
  });

  it("Порт: the 4 free spots show promo; the crane-boom ticker is tilted along the boom", async () => {
    m.ads = { data: { spots: [], prices: { line: "1", banner: "0.5", neon: "0.3" } } };
    await render("/district?d=port");
    const idle = [...el.querySelectorAll<HTMLElement>(".dz-mid .dz-idle")];
    expect(idle.map((n) => n.dataset.spot)).toEqual(["port_line", "port_banner_cargo", "port_banner_tram", "port_neon"]);
    expect(idle.map((n) => n.className.split(" ")[1])).toEqual(["k-line", "k-banner", "k-banner", "k-neon"]);
    expect(idle[0].style.transform).toBe("rotate(16deg)");
    expect(idle[1].style.transform).toBe("");
    expect(idle[0].textContent).toBe("Место для рекламы · от 1 TON/сутки");
  });

  it("low-end: promo stays on the flattened image, still (first slogan, no rotation)", async () => {
    document.documentElement.classList.add("low-end");
    await render("/district?d=rows");
    const idle = [...el.querySelectorAll<HTMLElement>(".dz-flat .dz-idle")];
    expect(idle.length).toBe(4);
    expect(idle.every((n) => n.classList.contains("still"))).toBe(true);
    expect(idle[1].textContent).toBe("Место для рекламы");
  });
});

describe("district: taps on ad spots (PR 6b)", () => {
  const ptr = (type: string, x: number, y: number, target: EventTarget) => {
    const e = new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, cancelable: true });
    Object.assign(e, { pointerId: 1, isPrimary: true });
    target.dispatchEvent(e);
  };
  const hit = (spot: string) => el.querySelector<HTMLElement>(`.dz-hit[data-spot="${spot}"]`)!;
  const tap = async (t: HTMLElement, dx = 3, dy = 2) =>
    act(async () => {
      ptr("pointerdown", 100, 300, t);
      ptr("pointermove", 100 + dx, 300 + dy, window);
      ptr("pointerup", 100 + dx, 300 + dy, window);
    });
  beforeEach(() => {
    m.event.mockClear();
    m.ads = {
      data: {
        day: "2026-11-10",
        spots: [
          {
            key: "rows_facade", format: "facade_screen", price_day: "1.5", on_sale: true,
            ad: { id: 11, title: "PIXEL CAFE", subtitle: "второй кофе в подарок", color: "mint", body: "Свежая обжарка", link_url: "https://t.me/pixel", link_kind: "telegram", until: "2026-11-12" },
          },
          { key: "rows_line", format: "line", price_day: "1", on_sale: false, ad: null },
          { key: "rows_neon", format: "neon", price_day: "0.3", on_sale: true, ad: null },
          { key: "rows_banner", format: "banner", price_day: "0.5", on_sale: true, ad: null },
        ],
      },
    };
  });

  it("hit areas over the spots in the street layer: bought → ad, free on sale → buy, off sale — none", async () => {
    await render("/district?d=rows");
    const hits = [...el.querySelectorAll<HTMLElement>(".dz-mid .dz-hits .dz-hit")];
    expect(hits.map((h) => [h.dataset.spot, h.dataset.kind])).toEqual([
      ["rows_facade", "ad"],
      ["rows_neon", "buy"],
      ["rows_banner", "buy"],
    ]);
    expect(hits[0].getAttribute("role")).toBe("button");
    expect(hits[0].getAttribute("aria-label")).toBe("Реклама: PIXEL CAFE, второй кофе в подарок");
    expect(hits[1].getAttribute("aria-label")).toContain("Свободное место");
    expect(hits[0].style.left).toBe("42.3%");
  });

  it("an impression is counted once the street is on screen", async () => {
    await render("/district?d=rows");
    expect(m.event).toHaveBeenCalledWith(11, "impression", "2026-11-10");
    expect(m.event).toHaveBeenCalledTimes(1);
  });

  it("tapping a bought spot opens the ad card with its link; open is counted; «Закрыть» and Back close it", async () => {
    await render("/district?d=rows");
    await tap(hit("rows_facade"));
    const card = el.querySelector(".cad-card")!;
    expect(card).not.toBeNull();
    expect(card.querySelector(".cc-title")?.textContent).toBe("PIXEL CAFE");
    expect(card.querySelector(".cc-kicker")?.textContent).toContain("ЭКРАН НА ФАСАДЕ");
    expect(card.querySelector(".cc-link")?.textContent).toContain("t.me");
    expect(m.event).toHaveBeenCalledWith(11, "open", "2026-11-10");
    expect(hit("rows_facade").getAttribute("aria-pressed")).toBe("true");
    expect(document.documentElement.classList.contains("city-walk-card")).toBe(true);
    // переход в Telegram — сразу, без подтверждения; считается
    const open = vi.fn();
    vi.stubGlobal("open", open);
    await act(async () => [...card.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Перейти")!.click());
    expect(m.event).toHaveBeenCalledWith(11, "click", "2026-11-10");
    await act(async () => [...el.querySelectorAll<HTMLButtonElement>(".cad-card button")].find((b) => b.textContent === "Закрыть")!.click());
    expect(el.querySelector(".cad-card")).toBeNull();
    expect(document.documentElement.classList.contains("city-walk-card")).toBe(false);
  });

  it("tapping empty street closes the card; a swipe over a spot pans and opens nothing", async () => {
    await render("/district?d=rows");
    await tap(hit("rows_facade"));
    expect(el.querySelector(".cad-card")).not.toBeNull();
    await tap(el.querySelector<HTMLElement>(".dz-mid img")!);
    expect(el.querySelector(".cad-card")).toBeNull();
    await tap(hit("rows_facade"), 40, 0); // протяжка
    expect(el.querySelector(".cad-card")).toBeNull();
    await tap(hit("rows_neon"), 0, 30); // вертикальный смахивающий жест — тоже не касание
    expect(path).toBe("/district");
  });

  it("tapping a free spot opens buying of that spot in that district", async () => {
    await render("/district?d=rows");
    await tap(hit("rows_neon"));
    expect(path).toBe("/ads");
    expect(new URLSearchParams(search).get("district")).toBe("rows");
    expect(new URLSearchParams(search).get("spot")).toBe("rows_neon");
  });

  it("keyboard: Enter on a spot acts like a tap", async () => {
    await render("/district?d=rows");
    await act(async () => hit("rows_facade").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(el.querySelector(".cad-card .cc-title")?.textContent).toBe("PIXEL CAFE");
  });

  it("Порт: the tilted crane line is tappable too (rotated hit area)", async () => {
    m.ads = {
      data: {
        day: "2026-11-10",
        spots: [{ key: "port_line", format: "line", price_day: "1", on_sale: true, ad: { id: 21, title: "ДОСТАВКА ГРУЗОВ", subtitle: null, color: "cyan", until: "2026-11-10" } }],
      },
    };
    await render("/district?d=port");
    expect(hit("port_line").style.transform).toBe("rotate(16deg)");
    await tap(hit("port_line"));
    expect(el.querySelector(".cad-card .cc-title")?.textContent).toBe("ДОСТАВКА ГРУЗОВ");
    expect(el.querySelector(".cad-card .cc-link")).toBeNull();
  });
});

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
}));
vi.mock("@/api/hooks", () => ({ useMe: () => m.me }));
vi.mock("@/lib/districtAssets", () => ({ loadDistrict: m.load, preloadWhenIdle: () => () => {} }));
vi.mock("@/lib/districtLife", () => ({ startDistrictLife: m.life }));
vi.mock("@/lib/cityPhase", () => ({ useCityPhase: () => ({ phase: m.phase, upcoming: null }) }));

import { District } from "./District";
import { cityWalk } from "@/lib/cityWalk";
import { districtNav } from "@/lib/districtNav";

let root: Root;
let el: HTMLDivElement;
let path = "";
function Where() {
  path = useLocation().pathname;
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
  it("final art (Неон-ряды) shows no «Черновик» badge; the sketch (Порт) still does", async () => {
    await render("/district?d=rows");
    expect(el.querySelector(".dz-badge")).toBeNull();
    expect(el.querySelector(".dz-far img")?.getAttribute("src")).toBe("/far-night");
    act(() => root.unmount());
    root = createRoot(el);
    await render("/district?d=port");
    expect(el.querySelector(".dz-badge")?.textContent).toBe("Черновик");
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

  it("production: only the owner gets in, everyone else goes home", async () => {
    vi.stubEnv("DEV", false);
    try {
      m.me = { data: { is_owner: false }, isLoading: false };
      await render("/district?d=rows");
      expect(path).toBe("/");
      expect(el.querySelector(".dz")).toBeNull();
      act(() => root.unmount());
      root = createRoot(el);
      m.me = { data: { is_owner: true }, isLoading: false };
      await render("/district?d=rows");
      expect(path).toBe("/district");
      expect(el.querySelector(".dz")).not.toBeNull();
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

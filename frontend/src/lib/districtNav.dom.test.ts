// @vitest-environment jsdom
/** Переходы между районами: протяжка за край, направление, путь экрана, затухание и проезд камеры, защита от двойного перехода. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cityWalk } from "./cityWalk";
import { dirBetween, districtNav, edgePull, EDGE_PULL, LEAVE_MS, nearEdge, neighbourOf, placePath } from "./districtNav";

beforeEach(() => districtNav.reset());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  cityWalk.exit();
});

describe("district nav: math", () => {
  it("neighbours follow the strip order Центр · Неон-ряды · Порт", () => {
    expect(neighbourOf("centre", 1)).toBe("rows");
    expect(neighbourOf("centre", -1)).toBeNull();
    expect(neighbourOf("rows", -1)).toBe("centre");
    expect(neighbourOf("rows", 1)).toBe("port");
    expect(neighbourOf("port", 1)).toBeNull();
    expect(dirBetween("centre", "port")).toBe(1);
    expect(dirBetween("port", "rows")).toBe(-1);
    expect(placePath("centre")).toBe("/");
    expect(placePath("port")).toBe("/district?d=port");
  });

  it("edge pull: past the right end → right neighbour, past the left end → left one", () => {
    expect(edgePull(0, -100, 100)).toEqual({ dir: 0, p: 0 });
    expect(edgePull(-100 - EDGE_PULL / 2, -100, 100)).toEqual({ dir: 1, p: 0.5 });
    expect(edgePull(100 + EDGE_PULL * 3, -100, 100)).toEqual({ dir: -1, p: 1 });
    expect(nearEdge(-90, -100, 100)).toEqual({ l: false, r: true });
    expect(nearEdge(95, -100, 100)).toEqual({ l: true, r: false });
  });
});

describe("district nav: going", () => {
  it("fades out, then navigates once; arrival direction is handed to the next scene", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    const nav = vi.fn();
    expect(districtNav.go("rows", "port", nav)).toBe(true);
    expect(document.documentElement.classList.contains("dz-going")).toBe(true);
    expect(districtNav.go("rows", "centre", nav)).toBe(false); // переход уже идёт
    expect(nav).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LEAVE_MS);
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav).toHaveBeenCalledWith("/district?d=port", { replace: true });
    expect(districtNav.takeArrival()).toEqual({ dir: 1 });
    expect(districtNav.takeArrival()).toBeNull();
  });

  it("to Центр: walk mode is switched on, the main page opens", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const nav = vi.fn();
    districtNav.go("rows", "centre", nav);
    expect(nav).toHaveBeenCalledWith("/", { replace: true });
    expect(cityWalk.get().active).toBe(true);
  });

  it("from Центр the district screen is pushed (not replacing the main page)", () => {
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    const nav = vi.fn();
    districtNav.go("centre", "rows", nav);
    expect(nav).toHaveBeenCalledWith("/district?d=rows", { replace: false });
    expect(districtNav.go("rows", "rows", nav)).toBe(false);
  });
});

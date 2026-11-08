// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const tg = vi.hoisted(() => ({ app: undefined as unknown }));
vi.mock("@/lib/telegram", () => ({
  get WebApp() {
    return tg.app;
  },
}));
import { motionAllowed, setTiltPref, tiltAvailable, tiltOffered, tiltOn, tiltPref } from "./walkPrefs";

const media = (q: Record<string, boolean>) =>
  vi.stubGlobal("matchMedia", (s: string) => ({ matches: Object.entries(q).some(([k, v]) => v && s.includes(k)) }));

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.classList.remove("low-end");
  localStorage.clear();
  tg.app = undefined;
});

describe("walkPrefs: наклон", () => {
  it("по умолчанию включён, выбор сохраняется", () => {
    expect(tiltPref()).toBe(true);
    setTiltPref(false);
    expect(tiltPref()).toBe(false);
    setTiltPref(true);
    expect(tiltPref()).toBe(true);
  });
  it("датчик Telegram 8.0+ — наклон предлагается", () => {
    media({});
    tg.app = { platform: "ios", isVersionAtLeast: (v: string) => v <= "8.0", DeviceOrientation: {} };
    expect(tiltAvailable()).toBe(true);
    expect(tiltOn()).toBe(true);
  });
  it("без датчика и на компьютере — не предлагается", () => {
    media({ "pointer: coarse": false });
    tg.app = { platform: "unknown", isVersionAtLeast: () => false };
    expect(tiltAvailable()).toBe(false);
    expect(tiltOffered()).toBe(false);
  });
  it("слабое устройство и «меньше движения» выключают наклон и жизнь улицы", () => {
    media({ "pointer: coarse": true });
    expect(motionAllowed()).toBe(true);
    document.documentElement.classList.add("low-end");
    expect(motionAllowed()).toBe(false);
    expect(tiltOn()).toBe(false);
    document.documentElement.classList.remove("low-end");
    media({ "pointer: coarse": true, "reduced-motion": true });
    expect(motionAllowed()).toBe(false);
    expect(tiltOffered()).toBe(false);
  });
});

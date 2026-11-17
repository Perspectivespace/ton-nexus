import { describe, expect, it } from "vitest";
import { HINT_KEYS, hintFor, hintToShow, introDecision, useOnboardingUi } from "./onboarding";

describe("знакомство: решения", () => {
  it("подсказки привязаны к четырём разделам дока", () => {
    expect(hintFor("/")).toBe("home");
    expect(hintFor("/miner")).toBe("miner");
    expect(hintFor("/tasks/")).toBe("earn");
    expect(hintFor("/wallet")).toBe("profile");
    expect(hintFor("/wheel")).toBeNull();
    expect(hintFor("/tasks/12")).toBeNull();
    expect([...HINT_KEYS]).toEqual(["home", "miner", "earn", "profile"]);
  });

  it("вводные экраны: сервер главный, устройство — запасное", () => {
    expect(introDecision({ intro_done: false, hints: [] }, false, false)).toBe("show");
    expect(introDecision({ intro_done: true, hints: [] }, false, false)).toBe("hide"); // прошёл на другом устройстве
    expect(introDecision({ intro_done: false, hints: [] }, false, true)).toBe("resync"); // сохранение не дошло
    expect(introDecision(undefined, false, false)).toBe("wait"); // /me ещё грузится
    expect(introDecision(undefined, true, true)).toBe("hide");
    expect(introDecision(undefined, true, false)).toBe("show");
  });

  it("подсказка — только после вводных экранов и один раз", () => {
    const none = new Set<string>();
    expect(hintToShow("/miner", { intro_done: false, hints: [] }, none)).toBeNull();
    expect(hintToShow("/miner", { intro_done: true, hints: [] }, none)).toBe("miner");
    expect(hintToShow("/miner", { intro_done: true, hints: ["miner"] }, none)).toBeNull();
    expect(hintToShow("/miner", { intro_done: true, hints: [] }, new Set(["miner"]))).toBeNull();
    expect(hintToShow("/miner", null, none)).toBeNull();
    expect(hintToShow("/arena", { intro_done: true, hints: [] }, none)).toBeNull();
  });

  it("повтор из Профиля открывает и закрывает знакомство", () => {
    useOnboardingUi.getState().startReplay();
    expect(useOnboardingUi.getState().replay).toBe(true);
    useOnboardingUi.getState().endReplay();
    expect(useOnboardingUi.getState().replay).toBe(false);
  });
});

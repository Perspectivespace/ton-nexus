// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const m = vi.hoisted(() => ({
  list: [] as unknown[],
  create: vi.fn(async (b: { code: string }) => ({ code: b.code, appearances_total: 21 })),
  disable: vi.fn(),
}));
vi.mock("@/api/hooks", () => ({
  useSecretPromos: () => ({ data: m.list, isLoading: false, error: null }),
  useSecretPromoCreate: () => ({ mutateAsync: m.create, isPending: false }),
  useSecretPromoDisable: () => ({ mutate: m.disable, isPending: false }),
}));

import { SecretPromosOwner } from "./SecretPromosOwner";

let root: Root;
let el: HTMLDivElement;
beforeEach(() => {
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
  m.create.mockClear();
  m.disable.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  el.remove();
});

const typeIn = (input: HTMLInputElement, v: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    set.call(input, v);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

describe("секретные промокоды в админке", () => {
  it("создание: код в верхнем регистре без лишних знаков, числа — числами; ответ — число появлений", async () => {
    m.list = [];
    act(() => root.render(<SecretPromosOwner />));
    const inputs = [...el.querySelectorAll<HTMLInputElement>("input")];
    const btn = [...el.querySelectorAll("button")].find((b) => b.textContent === "Запустить кампанию")!;
    expect(btn.disabled).toBe(true);
    typeIn(inputs[0], "neon 42!");
    typeIn(inputs[2], "100");
    expect(inputs[0].value).toBe("NEON42");
    expect(btn.disabled).toBe(false);
    await act(async () => btn.click());
    expect(m.create).toHaveBeenCalledWith({ code: "NEON42", reward_ton: "0.5", max_uses: 100, days: 7, per_day: 3 });
    expect(el.textContent).toContain("Кампания NEON42 запущена: 21 появлений");
    expect(el.textContent).toContain("Время появлений не видит никто");
  });

  it("список: только счётчики; идущую можно выключить", () => {
    m.list = [
      { id: 7, code: "GLOW-77", reward_ton: "0.25", max_uses: 50, used_count: 3, days: 2, per_day: 6, appearances_total: 12, appearances_done: 4,
        status: "active", created_at: "2026-11-12T08:00:00Z", ends_at: "2026-11-14T08:00:00Z" },
      { id: 6, code: "OLD-1", reward_ton: "1", max_uses: 5, used_count: 5, days: 1, per_day: 2, appearances_total: 2, appearances_done: 1,
        status: "exhausted", created_at: "2026-11-10T08:00:00Z", ends_at: "2026-11-11T08:00:00Z" },
    ];
    act(() => root.render(<SecretPromosOwner />));
    expect(el.textContent).toContain("0.25 TON · 3/50 акт. · 4/12 появл.");
    expect(el.textContent).toContain("активации кончились");
    const off = [...el.querySelectorAll("button")].filter((b) => b.textContent === "Выключить");
    expect(off).toHaveLength(1);
    act(() => off[0].click());
    expect(m.disable).toHaveBeenCalledWith(7);
  });
});

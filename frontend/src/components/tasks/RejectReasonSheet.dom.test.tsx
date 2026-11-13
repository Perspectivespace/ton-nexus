// @vitest-environment jsdom
/** Шторка причины отказа: без выбора кнопка неактивна, «Другое» — только с заметкой, коды уходят как есть. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { RejectReasonSheet } from "./RejectReasonSheet";

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

async function mount(kind: "submission" | "task", onConfirm: (r: string, n: string | null) => void) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(<RejectReasonSheet open kind={kind} onClose={() => {}} onConfirm={onConfirm} />);
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

const radios = () => [...document.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
const confirmBtn = () => document.querySelector<HTMLButtonElement>(".s-foot button")!;
const click = async (el: HTMLElement) => act(async () => el.click());

describe("RejectReasonSheet", () => {
  it("сдача: пять причин, без выбора нельзя, «Поддельное» уходит кодом forged", async () => {
    const onConfirm = vi.fn();
    await mount("submission", onConfirm);
    expect(radios().map((r) => r.textContent)).toEqual([
      expect.stringContaining("Низкое качество"),
      expect.stringContaining("Не то задание"),
      expect.stringContaining("Повтор"),
      expect.stringContaining("Поддельное доказательство"),
      expect.stringContaining("Другое"),
    ]);
    expect(confirmBtn().disabled).toBe(true);
    await click(radios()[3]);
    expect(radios()[3].getAttribute("aria-checked")).toBe("true");
    await click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledWith("forged", null);
  });

  it("«Другое» без заметки — нельзя, с заметкой — можно", async () => {
    const onConfirm = vi.fn();
    await mount("task", onConfirm);
    expect(radios()).toHaveLength(2);
    await click(radios()[1]);
    expect(confirmBtn().disabled).toBe(true);
    const ta = document.querySelector("textarea")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(ta, "дубль задания");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirmBtn().disabled).toBe(false);
    await click(confirmBtn());
    expect(onConfirm).toHaveBeenCalledWith("other", "дубль задания");
  });
});

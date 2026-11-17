// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setLang } from "@/i18n";
import { SectionHint } from "./SectionHint";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement;
function mount(el: React.ReactNode) {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
}

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  setLang("ru");
});

describe("SectionHint", () => {
  it("показывает текст раздела и закрывается кнопкой «Понятно» и крестиком", () => {
    const onClose = vi.fn();
    mount(<SectionHint hint="miner" onClose={onClose} />);
    expect(host.textContent).toContain("Реактор");
    expect(host.querySelector("[role=status]")).not.toBeNull();
    const ok = [...host.querySelectorAll("button")].find((b) => b.textContent === "Понятно")!;
    act(() => ok.click());
    act(() => (host.querySelector("button[aria-label='Закрыть подсказку']") as HTMLButtonElement).click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("на английском — английский текст", () => {
    setLang("en");
    mount(<SectionHint hint="earn" onClose={() => {}} />);
    expect(host.textContent).toContain("Got it");
    expect(host.textContent).toContain("once it's approved");
  });
});

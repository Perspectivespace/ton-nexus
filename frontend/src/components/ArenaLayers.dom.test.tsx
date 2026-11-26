// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ARENA_SLOTS, ArenaLayer } from "./ArenaLayers";
import { SURFACES } from "@/lib/districts";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const slots = Object.values(ARENA_SLOTS);

function mount(part: "mid" | "flat") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const root = createRoot(el);
  act(() => {
    root.render(<ArenaLayer part={part} />);
  });
  return { el, root };
}

describe("arena art slots", () => {
  it("keeps the four empty panels at the scheme coordinates on mid and flat", () => {
    for (const part of ["mid", "flat"] as const) {
      const { el, root } = mount(part);
      for (const s of slots) {
        const node = el.querySelector(`[data-spot="${s.id}"] rect`);
        expect(node, `${part} ${s.id}`).toBeTruthy();
        expect(node!.getAttribute("x")).toBe(String(s.x));
        expect(node!.getAttribute("y")).toBe(String(s.y));
        expect(node!.getAttribute("width")).toBe(String(s.w));
        expect(node!.getAttribute("height")).toBe(String(s.h));
      }
      const hud = el.querySelector("path[d='M560 300 h22 M658 300 h22 M680 300 v18 M680 382 v18 M560 400 v-18 M560 300 v18']");
      expect(hud).toBeTruthy();
      expect(el.querySelectorAll("[data-spot] button, [data-spot] a").length).toBe(0);
      act(() => root.unmount());
      el.remove();
    }
  });

  it("does not wire ad surfaces or taps yet (PR 4 / PR 5)", () => {
    expect(SURFACES.arena).toBeUndefined();
  });
});

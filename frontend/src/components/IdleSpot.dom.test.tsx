// @vitest-environment jsdom
/** Экран на фасаде с картинкой: картинка во весь экран + заголовок и подпись на плашке; без картинки — только текст. */
import { afterEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IdleSurface, type SurfaceAd } from "./IdleSpot";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = host = null;
});
function show(kind: "facade_screen" | "banner" | "neon" | "line", ad: SurfaceAd) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<IdleSurface spot="rows_facade" kind={kind} i={0} price={null} still ad={ad} />));
  return host.querySelector(".dz-idle")!;
}

const AD = { title: "PIXEL CAFE", subtitle: "второй кофе", color: "mint" };

describe("экран на фасаде с картинкой", () => {
  it("картинка и подпись на плашке", () => {
    const box = show("facade_screen", { ...AD, image: "https://x/i.webp" });
    expect(box.classList.contains("has-pic")).toBe(true);
    const img = box.querySelector<HTMLImageElement>("img.pic")!;
    expect(img.getAttribute("src")).toBe("https://x/i.webp");
    expect(img.getAttribute("alt")).toBe("");
    expect(box.querySelector(".cap .t")!.textContent).toBe("PIXEL CAFE");
    expect(box.querySelector(".cap .p")!.textContent).toBe("второй кофе");
  });

  it("картинка не загрузилась — экран только с текстом", () => {
    const box = show("facade_screen", { ...AD, image: "https://x/broken.webp" });
    act(() => {
      box.querySelector("img.pic")!.dispatchEvent(new Event("error"));
    });
    expect(box.classList.contains("has-pic")).toBe(false);
    expect(box.querySelector("img")).toBeNull();
    expect(box.querySelector(".t")!.textContent).toBe("PIXEL CAFE");
  });

  it("без картинки и у других мест картинки нет", () => {
    for (const kind of ["facade_screen", "banner", "neon", "line"] as const) {
      const box = show(kind, kind === "facade_screen" ? AD : { ...AD, image: "https://x/i.webp" });
      expect(box.querySelector("img"), kind).toBeNull();
      act(() => root!.unmount());
      host!.remove();
      root = host = null;
    }
  });
});

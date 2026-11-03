// @vitest-environment jsdom
/**
 * Экран боя в DOM (эффекты): первый кадр боя без поля, нет 2d-контекста, ошибка кадра в цикле оверлея.
 * Canvas в jsdom нет — контекст подменяем заглушкой, которая молча принимает любые вызовы.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ArenaBattle } from "./ArenaBattle";
import { battleRoom } from "@/lib/arena/battle.fixture";
import type { ArenaRoom } from "@/lib/arena/api";
import { CanvasUnavailableError, ctx2d, drawSwatch, layer } from "@/lib/arena/swatch";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const noopFn = () => {};
let broken = false;
const boom = () => {
  if (broken) throw new Error("frame");
};
const fakeCtx = (): unknown =>
  new Proxy(noopFn, {
    get: (_t, k) => {
      if (broken) return boom;
      if (k === "measureText") return () => ({ width: 10 });
      if (k === "createLinearGradient" || k === "createRadialGradient" || k === "createPattern") return () => ({ addColorStop: noopFn });
      if (k === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
      return noopFn;
    },
    set: () => true,
  });

let observed: Element[] = [];
const origGetContext = HTMLCanvasElement.prototype.getContext;
let root: Root | null = null;
let el: HTMLDivElement;
let frames: FrameRequestCallback[] = [];

beforeEach(() => {
  observed = [];
  frames = [];
  broken = false;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(t: Element) {
        observed.push(t);
      }
      disconnect() {}
      unobserve() {}
    },
  );
  vi.stubGlobal("Path2D", class {});
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => frames.push(f));
  vi.stubGlobal("cancelAnimationFrame", noopFn);
  HTMLCanvasElement.prototype.getContext = (() => fakeCtx()) as typeof origGetContext;
  vi.spyOn(console, "error").mockImplementation(noopFn);
  el = document.createElement("div");
  document.body.appendChild(el);
  root = createRoot(el);
});
afterEach(() => {
  act(() => root?.unmount());
  el.remove();
  HTMLCanvasElement.prototype.getContext = origGetContext;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const qc = new QueryClient();
const show = (r: ArenaRoom, onDone: () => void = noopFn) =>
  act(() =>
    root!.render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <ArenaBattle room={r} onDone={onDone} />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
const noField = () => battleRoom({}, { match: { id: 1, turn: 1, current: null } });

describe("экран боя в DOM", () => {
  it("первый кадр без поля (GET /rooms/{id}) — ResizeObserver цепляется к блоку поля, когда тот появился", () => {
    show(noField());
    expect(el.textContent).toContain("Загружаем поле");
    expect(observed).toHaveLength(0);
    show(battleRoom());
    expect(el.querySelector("canvas.ar-cv")).not.toBeNull();
    expect(observed).toEqual([el.querySelector(".ar-map")]);
  });

  it("обычный старт — ResizeObserver на блоке поля", () => {
    show(battleRoom());
    expect(observed).toEqual([el.querySelector(".ar-map")]);
  });

  it("нет 2d-контекста — «Поле не отрисовалось» с «Обновить», таймер и «Готово» на месте", () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof origGetContext;
    show(battleRoom());
    const fail = el.querySelector(".ar-map-fail");
    expect(fail?.textContent).toContain("Поле не отрисовалось");
    expect(fail?.textContent).toContain("Обновить");
    expect(el.querySelector("canvas.ar-cv")).toBeNull();
    expect(el.querySelector(".ar-tm")).not.toBeNull();
    const ready = [...el.querySelectorAll("button")].find((b) => b.textContent === "Готово");
    expect(ready).toBeDefined();
    expect(ready!.disabled).toBe(false);
  });

  it("ошибка кадра в цикле оверлея (rAF) — цикл гаснет, поле в запасной вид, экран боя живой", () => {
    show(battleRoom());
    expect(el.querySelector(".ar-map-fail")).toBeNull();
    const pending = frames.splice(0);
    expect(pending.length).toBeGreaterThan(0); // зона открыта — эмбиент крутится
    broken = true; // следующий кадр оверлея падает
    act(() => pending.forEach((f) => f(1e6)));
    expect(el.querySelector(".ar-map-fail")?.textContent).toContain("Поле не отрисовалось");
    expect(el.querySelector(".ar-tm")).not.toBeNull();
    // цикл остановлен: новых кадров не просили, кроме разве что одного уже запрошенного внутри падающего
    const after = frames.splice(0);
    broken = false;
    act(() => after.forEach((f) => f(2e6)));
    expect(frames).toHaveLength(0);
  });

  it("swatch: нет контекста — понятная ошибка в layer, образец легенды не падает", () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof origGetContext;
    expect(() => ctx2d(document.createElement("canvas"))).toThrow(CanvasUnavailableError);
    expect(() => layer(10, 10, 2)).toThrow(CanvasUnavailableError);
    expect(() => drawSwatch(document.createElement("canvas"), "pistol")).not.toThrow();
  });

  it("поле в запасном виде, а бой окончен — «Бой окончен» и «Итоги» поверх, к итогам выйти можно", () => {
    HTMLCanvasElement.prototype.getContext = (() => null) as typeof origGetContext;
    const done = vi.fn();
    show(battleRoom({ phase: "finished", finished: true, current: null }, { status: "finished" }), done);
    const fin = el.querySelector(".ar-map-fail .ar-out.fin");
    expect(fin?.textContent).toContain("Бой окончен");
    const btn = [...fin!.querySelectorAll("button")].find((x) => x.textContent === "Итоги")!;
    act(() => btn.click());
    expect(done).toHaveBeenCalled();
  });
});

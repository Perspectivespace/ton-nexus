// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tg = vi.hoisted(() => {
  let click: (() => void) | null = null;
  return {
    shown: false,
    press: () => click?.(),
    WebApp: {
      platform: "android",
      isVersionAtLeast: () => true,
      BackButton: {
        onClick: (f: () => void) => (click = f),
        show: () => (tg.shown = true),
        hide: () => (tg.shown = false),
      },
    },
  };
});
vi.mock("@/lib/telegram", () => ({ WebApp: tg.WebApp }));

import { useRouteBackFallback, useScreenBack } from "./backButton";

let root: Root | null = null;
let where = "";
function Where() {
  where = useLocation().pathname;
  return null;
}
function Shell({ dock, children }: { dock: boolean; children?: React.ReactNode }) {
  useRouteBackFallback(!dock);
  return <>{children}</>;
}
function Screen({ fallback }: { fallback: string }) {
  useScreenBack(fallback);
  return null;
}
function mount(url: string, el: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() =>
    root!.render(
      <MemoryRouter initialEntries={[url]}>
        <Where />
        <Routes>
          <Route path="*" element={el} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}
afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe("системная «Назад» Telegram", () => {
  it("экран вне дока без своего обработчика — кнопка всё равно есть и ведёт домой (не застрять)", () => {
    mount("/new-screen", <Shell dock={false} />);
    expect(tg.shown).toBe(true);
    act(() => tg.press());
    expect(where).toBe("/");
  });

  it("свой обработчик экрана отвечает первым, страховка — под ним", () => {
    mount("/achievements/wall", (
      <Shell dock={false}>
        <Screen fallback="/achievements" />
      </Shell>
    ));
    act(() => tg.press());
    expect(where).toBe("/achievements");
  });

  it("на экранах дока кнопки нет", () => {
    mount("/wallet", <Shell dock />);
    expect(tg.shown).toBe(false);
  });
});

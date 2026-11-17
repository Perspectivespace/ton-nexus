// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { setLang } from "@/i18n";

vi.mock("@/lib/errorReport", () => ({ reportError: vi.fn() }));
import { reportError } from "@/lib/errorReport";
import { AppErrorBoundary, CrashScreen } from "./AppErrorBoundary";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Boom(): never {
  throw new Error("render boom");
}

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

describe("экран сбоя", () => {
  it("падение рендера: «Что-то пошло не так» и отчёт", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    mount(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Что-то пошло не так");
    expect(host.querySelector("button")?.textContent).toBe("Перезагрузить");
    expect(reportError).toHaveBeenCalledWith("render", expect.any(Error), expect.any(String));
    err.mockRestore();
  });

  it("английский и кнопка перезагрузки", () => {
    setLang("en");
    const reload = vi.fn();
    mount(<CrashScreen onReload={reload} />);
    expect(host.querySelector("h1")?.textContent).toBe("Something went wrong");
    const btn = host.querySelector("button")!;
    expect(btn.textContent).toBe("Reload");
    act(() => btn.click());
    expect(reload).toHaveBeenCalled();
  });
});

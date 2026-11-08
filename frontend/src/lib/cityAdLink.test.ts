// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const tg = vi.hoisted(() => ({ WebApp: undefined as unknown }));
vi.mock("@/lib/telegram", () => ({
  get WebApp() {
    return tg.WebApp;
  },
}));

import { isSafeAdLink, linkHost, openAdLink } from "./cityAdLink";

describe("ссылка объявления", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    tg.WebApp = undefined;
  });

  it("подпись адреса", () => {
    expect(linkHost("https://t.me/nexusbar_city/")).toBe("t.me/nexusbar_city");
    expect(linkHost("https://www.example.com/a?b=1")).toBe("example.com");
  });

  it("только https", () => {
    expect(isSafeAdLink("https://example.com")).toBe(true);
    for (const bad of ["http://example.com", "javascript:alert(1)", "", null, "t.me/x"]) expect(isSafeAdLink(bad)).toBe(false);
    expect(openAdLink("javascript:alert(1)", "web")).toBe(false);
  });

  it("t.me — openTelegramLink, сайт — openLink", () => {
    const w = { platform: "ios", openTelegramLink: vi.fn(), openLink: vi.fn() };
    tg.WebApp = w;
    openAdLink("https://t.me/nexus", "telegram");
    openAdLink("https://example.com/", "web");
    expect(w.openTelegramLink).toHaveBeenCalledWith("https://t.me/nexus");
    expect(w.openLink).toHaveBeenCalledWith("https://example.com/");
  });

  it("вне Telegram или если Telegram упал — новая вкладка без opener", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);
    tg.WebApp = { platform: "unknown", openLink: vi.fn() };
    openAdLink("https://example.com/", "web");
    tg.WebApp = { platform: "android", openTelegramLink: () => { throw new Error("old"); } };
    openAdLink("https://t.me/x", "telegram");
    expect(open).toHaveBeenNthCalledWith(1, "https://example.com/", "_blank", "noopener,noreferrer");
    expect(open).toHaveBeenNthCalledWith(2, "https://t.me/x", "_blank", "noopener,noreferrer");
  });
});

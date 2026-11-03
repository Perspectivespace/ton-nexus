import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILD_ID, checkVersion, ensureFreshForBattle, fetchServerBuild, setBattleActive, versionCheckEnabled, type VersionDeps } from "./version";

function mem(): VersionDeps["storage"] & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}
const deps = (server: string | null, p: Partial<VersionDeps> = {}) => {
  const reload = vi.fn();
  return { reload, d: { build: "b1", fetchBuild: async () => server, reload, storage: mem(), ...p } as VersionDeps };
};
afterEach(() => {
  setBattleActive(false);
  vi.unstubAllGlobals();
});

describe("проверка версии сборки", () => {
  it("в тестах и dev id сборки — dev, проверка выключена", async () => {
    expect(BUILD_ID).toBe("dev");
    expect(versionCheckEnabled()).toBe(false);
    const { d, reload } = deps("b2", { build: "dev" });
    expect(await checkVersion({}, d)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("та же сборка или сервер не ответил — без перезагрузки", async () => {
    for (const s of ["b1", null]) {
      const { d, reload } = deps(s);
      expect(await checkVersion({}, d)).toBe(false);
      expect(reload).not.toHaveBeenCalled();
    }
  });

  it("новая сборка — перезагрузка; id запоминаем, второй раз ради неё не перезагружаемся (нет петли)", async () => {
    const storage = mem();
    const a = deps("b2", { storage });
    expect(await checkVersion({}, a.d)).toBe(true);
    expect(a.reload).toHaveBeenCalledTimes(1);
    const b = deps("b2", { storage });
    expect(await checkVersion({}, b.d)).toBe(false);
    expect(b.reload).not.toHaveBeenCalled();
    const c = deps("b3", { storage }); // вышла ещё одна сборка — снова можно
    expect(await checkVersion({}, c.d)).toBe(true);
  });

  it("идёт бой — фоновая проверка не перезагружает, перед боем (force) — перезагружает", async () => {
    setBattleActive(true);
    const a = deps("b2");
    expect(await checkVersion({}, a.d)).toBe(false);
    expect(a.reload).not.toHaveBeenCalled();
    expect(await ensureFreshForBattle(a.d)).toBe(true);
    expect(a.reload).toHaveBeenCalledTimes(1);
  });

  it("sessionStorage недоступен — не перезагружаем (петлю не остановить)", async () => {
    const { d, reload } = deps("b2", {
      storage: {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {},
      },
    });
    expect(await checkVersion({}, d)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("fetchServerBuild: /version.json без кэша; мусор и ошибки сети — null", async () => {
    const calls: [string, RequestInit][] = [];
    let body: unknown = { build: "b9" };
    let ok = true;
    vi.stubGlobal("fetch", async (u: string, i: RequestInit) => {
      calls.push([u, i]);
      if (body === "throw") throw new Error("offline");
      return { ok, json: async () => body } as Response;
    });
    expect(await fetchServerBuild()).toBe("b9");
    expect(calls[0][0]).toMatch(/^\/version\.json\?t=\d+$/);
    expect(calls[0][1].cache).toBe("no-store");
    body = { build: 5 };
    expect(await fetchServerBuild()).toBeNull();
    ok = false;
    body = { build: "b9" };
    expect(await fetchServerBuild()).toBeNull();
    ok = true;
    body = "throw";
    expect(await fetchServerBuild()).toBeNull();
  });
});

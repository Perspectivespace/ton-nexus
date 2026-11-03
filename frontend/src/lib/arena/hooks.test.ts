import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis;
});
import { fetchArenaRoom } from "./hooks";
import type { ArenaRoom } from "./api";

type Call = string;
function mockFetch(byUrl: (u: string) => Partial<ArenaRoom>) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ id: 7, server_time: new Date().toISOString(), ...byUrl(url) }) } as unknown as Response;
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("fetchArenaRoom — шаг опроса комнаты", () => {
  it("набор идёт — только GET /rooms/{id}", async () => {
    const calls = mockFetch(() => ({ status: "waiting", match: null }));
    expect((await fetchArenaRoom(7, undefined)).status).toBe("waiting");
    expect(calls).toEqual(["/api/v1/arena/rooms/7"]);
  });

  it("опрос впервые увидел старт — сразу /state (поле), без ожидания следующего опроса", async () => {
    const calls = mockFetch((u) => (u.includes("/state") ? { status: "running", match: { id: 1, turn: 1, n: 9, tiles: [], players: [] } as ArenaRoom["match"] } : { status: "running", match: { id: 1, turn: 1 } as ArenaRoom["match"] }));
    const prev = { id: 7, status: "waiting", match: null } as unknown as ArenaRoom;
    const r = await fetchArenaRoom(7, prev);
    expect(calls).toEqual(["/api/v1/arena/rooms/7", "/api/v1/arena/rooms/7/state?since=0"]);
    expect(r.match?.n).toBe(9);
  });

  it("бой уже идёт — /state с since = текущий ход − 2", async () => {
    const calls = mockFetch(() => ({ status: "running", match: { id: 1, turn: 6 } as ArenaRoom["match"] }));
    await fetchArenaRoom(7, { id: 7, status: "running", match: { id: 1, turn: 6 } } as unknown as ArenaRoom);
    expect(calls).toEqual(["/api/v1/arena/rooms/7/state?since=4"]);
  });

  it("комната закрыта — один GET /rooms/{id}", async () => {
    const calls = mockFetch(() => ({ status: "finished", match: { id: 1, turn: 9 } as ArenaRoom["match"] }));
    expect((await fetchArenaRoom(7, undefined)).status).toBe("finished");
    expect(calls).toEqual(["/api/v1/arena/rooms/7"]);
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  const g = globalThis as Record<string, unknown>;
  g.window ??= globalThis; // клиент API читает window.Telegram при импорте
});
import { ApiError } from "@/api/client";
import {
  arenaApi,
  arenaCard,
  arenaErrorText,
  commissionPct,
  fmtPrize,
  fmtTon,
  mmss,
  money,
  parseArenaError,
  pollMs,
  roomName,
  roomScreen,
  skewOf,
  ticking,
  type ArenaRoom,
  type ArenaType,
} from "./api";

type Call = { url: string; method: string; body: unknown };
function mockFetch(reply: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit = {}) => {
    const c = { url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = reply(c);
    const status = r.status ?? 200;
    return { ok: status < 400, status, statusText: "ERR", json: async () => r.body } as unknown as Response;
  });
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

const A4: ArenaType = { type: "a4", seats: 4, board: 9, stake_nano: "100000000", prizes_nano: ["360000000"], pot_nano: "400000000", commission_bps: 1000, waiting: 2 };
const A8: ArenaType = { type: "a8", seats: 8, board: 11, stake_nano: "100000000", prizes_nano: ["500000000", "220000000"], pot_nano: "800000000", commission_bps: 1000, waiting: 0 };

const T0 = Date.parse("2026-11-02T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();
function room(p: Partial<ArenaRoom> = {}): ArenaRoom {
  return {
    id: 7, type: "a4", status: "waiting", seats_total: 4, seats: [{ seat: 0, name: "@neo", is_me: true }, null, null, null], taken: 1, my_seat: 0,
    stake_nano: "100000000", fill_deadline: iso(T0 + 180_000), started_at: null, finished_at: null, seed_hash: "ab12cd34ef56", results: [], match: null,
    server_time: iso(T0), skew: 0, ...p,
  };
}

describe("arenaApi — запросы к /api/v1/arena", () => {
  it("rooms: GET, добавляет поправку часов", async () => {
    const calls = mockFetch(() => ({ body: { types: [A4, A8], active_room_id: null, server_time: new Date(Date.now() + 5000).toISOString() } }));
    const r = await arenaApi.rooms();
    expect(calls).toEqual([{ url: "/api/v1/arena/rooms", method: "GET", body: undefined }]);
    expect(r.types.map((t) => t.type)).toEqual(["a4", "a8"]);
    expect(r.skew).toBeGreaterThan(4000);
    expect(r.skew).toBeLessThan(6000);
  });

  it("join: POST {type}; leave: POST; room и state по id", async () => {
    const calls = mockFetch((c) => ({ body: c.url.endsWith("/leave") ? { ok: true, room_id: 7, refunded_nano: "100000000" } : room() }));
    expect((await arenaApi.join("a8")).id).toBe(7);
    expect((await arenaApi.leave()).refunded_nano).toBe("100000000");
    await arenaApi.room(7);
    await arenaApi.state(7, 3);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "POST /api/v1/arena/join",
      "POST /api/v1/arena/leave",
      "GET /api/v1/arena/rooms/7",
      "GET /api/v1/arena/rooms/7/state?since=3",
    ]);
    expect(calls[0].body).toEqual({ type: "a8" });
  });

  it("402 с объектом detail → insufficient_balance; 409 already_in_room → room_id", async () => {
    mockFetch((c) =>
      c.url.endsWith("/join")
        ? { status: 402, body: { detail: { code: "insufficient_balance", message: "Недостаточно средств" } } }
        : { status: 409, body: { detail: { code: "already_in_room", message: "x", room_id: 12 } } },
    );
    const e1 = parseArenaError(await arenaApi.join("a4").catch((e) => e));
    expect(e1).toMatchObject({ status: 402, code: "insufficient_balance" });
    expect(arenaErrorText(e1)).toMatch(/Не хватает TON/);
    const e2 = parseArenaError(await arenaApi.rooms().catch((e) => e));
    expect(e2).toEqual({ status: 409, code: "already_in_room", message: "x", roomId: 12 });
  });
});

describe("parseArenaError", () => {
  it("402 строкой — тоже нехватка; прочие строки — http_N; не ApiError — нет связи", () => {
    expect(parseArenaError(new ApiError(402, "Payment Required")).code).toBe("insufficient_balance");
    expect(parseArenaError(new ApiError(500, "boom"))).toEqual({ status: 500, code: "http_500", message: "boom" });
    expect(parseArenaError(new TypeError("Failed to fetch"))).toMatchObject({ status: 0, code: "network" });
    expect(parseArenaError(new ApiError(403, JSON.stringify({ code: "arena_disabled", message: "off" }))).code).toBe("arena_disabled");
    expect(arenaErrorText({ status: 403, code: "arena_disabled", message: "" })).toMatch(/закрыта/);
    expect(arenaErrorText({ status: 418, code: "x", message: "" })).toMatch(/Попробуйте/);
  });
});

describe("формат сумм", () => {
  it("TON, призы, комиссия, название, деньги комнаты", () => {
    expect(fmtTon("100000000")).toBe("0.1");
    expect(fmtTon(1_000_000_000)).toBe("1.0");
    expect(fmtTon("123456789")).toBe("0.1235");
    expect(fmtPrize("500000000")).toBe("0.50");
    expect(fmtPrize("360000000")).toBe("0.36");
    expect(commissionPct(1000)).toBe("10%");
    expect(commissionPct(750)).toBe("7.5%");
    expect(roomName(A8)).toBe("Арена 8");
    expect(money(A8)).toEqual({ stake: 0.1, pot: 0.8, fee: 0.08, prizes: [0.5, 0.22] });
    expect(mmss(180_000)).toBe("3:00");
    expect(mmss(61_001)).toBe("1:02");
    expect(mmss(-5)).toBe("0:00");
    expect(skewOf(undefined)).toBe(0);
    expect(skewOf(iso(T0 + 2000), T0)).toBe(2000);
  });
});

describe("roomScreen — что показать", () => {
  it("набор: остаток до fill_deadline с поправкой часов", () => {
    expect(roomScreen(room(), T0 + 60_000)).toEqual({ kind: "waiting", left: 120_000, taken: 1, seats: 4 });
    // часы клиента отстают на 10 с — поправка из ответа
    expect(roomScreen(room({ skew: 10_000 }), T0 + 50_000)).toMatchObject({ left: 120_000 });
    expect(roomScreen(room(), T0 + 999_000)).toMatchObject({ kind: "waiting", left: 0 });
  });

  it("вышел, возврат, отмена", () => {
    expect(roomScreen(room({ my_seat: null }))).toEqual({ kind: "left" });
    expect(roomScreen(room({ status: "refunded" }))).toEqual({ kind: "refunded" });
    expect(roomScreen(room({ status: "cancelled" }))).toEqual({ kind: "cancelled" });
    expect(roomScreen(room({ status: "finished" }))).toEqual({ kind: "finished" });
  });

  it("старт: отсчёт 3-2-1 до opens_at первого хода, затем бой", () => {
    const run = room({ status: "running", started_at: iso(T0), match: { id: 1, turn: 1, phase: "countdown", current: { turn: 1, opens_at: iso(T0 + 3000), deadline: iso(T0 + 13000), ready_seats: [], my_plan: null } } });
    expect(roomScreen(run, T0)).toEqual({ kind: "countdown", sec: 3 });
    expect(roomScreen(run, T0 + 1500)).toEqual({ kind: "countdown", sec: 2 });
    expect(roomScreen(run, T0 + 2999)).toEqual({ kind: "countdown", sec: 1 });
    expect(roomScreen(run, T0 + 3000)).toEqual({ kind: "battle", turn: 1 });
    // ответ /rooms/{id} без окна хода — отсчёт от started_at
    expect(roomScreen(room({ status: "running", started_at: iso(T0), match: { id: 1, turn: 0 } }), T0 + 100)).toEqual({ kind: "countdown", sec: 3 });
    expect(roomScreen(room({ status: "running", started_at: iso(T0), match: { id: 1, turn: 4, current: null } }), T0 + 60_000)).toEqual({ kind: "battle", turn: 4 });
    expect(roomScreen(room({ status: "running", match: { id: 1, turn: 9, phase: "finished" } }))).toEqual({ kind: "finished" });
  });

  it("таймер и опрос: тикают набор и отсчёт; опрос ~1 с, пока комната живая", () => {
    expect(ticking({ kind: "waiting", left: 1, taken: 1, seats: 4 })).toBe(true);
    expect(ticking({ kind: "countdown", sec: 2 })).toBe(true);
    expect(ticking({ kind: "refunded" })).toBe(false);
    expect(pollMs(room())).toBe(1000);
    expect(pollMs(room({ status: "running" }))).toBe(1000);
    expect(pollMs(room({ status: "refunded" }))).toBe(false);
    expect(pollMs(room({ status: "finished" }))).toBe(false);
  });
});

describe("arenaCard — карточка в «Играх»", () => {
  it("игрок видит, только когда лобби открыто", () => {
    expect(arenaCard({ isOwner: false, setting: undefined, lobby: "ok" })).toEqual({ show: true, test: false });
    expect(arenaCard({ isOwner: false, setting: undefined, lobby: "err" })).toEqual({ show: false, test: false });
    expect(arenaCard({ isOwner: undefined, setting: undefined, lobby: "pending" })).toEqual({ show: false, test: false });
  });
  it("владелец видит всегда; выключена — бейдж «тест»", () => {
    expect(arenaCard({ isOwner: true, setting: { enabled: false }, lobby: "ok" })).toEqual({ show: true, test: true });
    expect(arenaCard({ isOwner: true, setting: undefined, lobby: "pending" })).toEqual({ show: true, test: true });
    expect(arenaCard({ isOwner: true, setting: { enabled: true }, lobby: "ok" })).toEqual({ show: true, test: false });
  });
});

import { describe, expect, it } from "vitest";
import { arenaPosterModel } from "./poster";
import type { ArenaLobby, ArenaType } from "./api";

const typ = (waiting: number, stake = "100000000"): ArenaType => ({
  type: "a",
  seats: 4,
  board: 9,
  stake_nano: stake,
  prizes_nano: ["360000000"],
  pot_nano: "400000000",
  commission_bps: 1000,
  waiting,
});
const lobby = (types: ArenaType[]): ArenaLobby => ({
  types,
  active_room_id: null,
  server_time: "2026-11-27T12:00:00Z",
});

describe("arenaPosterModel", () => {
  it("error (Arena closed / 403 / network) — quiet closed state, no queue", () => {
    expect(arenaPosterModel({ status: "err", lobby: lobby([typ(3)]) })).toEqual({
      kind: "closed",
      waiting: 0,
      stakeNano: null,
      roomsOpen: 0,
    });
  });

  it("pending without data — open poster, no invented queue", () => {
    expect(arenaPosterModel({ status: "pending" })).toEqual({
      kind: "open",
      waiting: 0,
      stakeNano: null,
      roomsOpen: 0,
    });
  });

  it("open lobby, nobody waiting — open poster, nearest stake of all types", () => {
    expect(arenaPosterModel({ status: "ok", lobby: lobby([typ(0, "200000000"), typ(0, "100000000")]) })).toEqual({
      kind: "open",
      waiting: 0,
      stakeNano: "100000000",
      roomsOpen: 0,
    });
  });

  it("sums waiting, counts rooms in queue, nearest stake among those rooms", () => {
    expect(arenaPosterModel({ status: "ok", lobby: lobby([typ(2, "500000000"), typ(1, "100000000"), typ(0, "50000000")]) })).toEqual({
      kind: "queue",
      waiting: 3,
      stakeNano: "100000000",
      roomsOpen: 2,
    });
  });
});

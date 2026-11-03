/** Тестовый бой для vitest: вид /state, как его отдаёт сервер (поле 9×9, 4 места). */
import type { ArenaMatchView, ArenaRoom } from "./api";

/* поле 9×9: стена (4,4), укрытие (6,2); я — место 0 на (2,2), соперники 1 (3,2) рядом, 2 (7,7) далеко, 3 выбыл */
const N = 9;
const tiles = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => (x === 4 && y === 4 ? 1 : x === 6 && y === 2 ? 2 : 0)));
export const T0 = Date.parse("2026-11-02T12:00:00Z");
export const iso = (ms: number) => new Date(ms).toISOString();

export function matchView(p: Partial<ArenaMatchView> = {}): ArenaMatchView {
  return {
    id: 1,
    turn: 3,
    phase: "planning",
    finished: false,
    current: { turn: 3, opens_at: iso(T0), deadline: iso(T0 + 10_000), ready_seats: [1], my_plan: null },
    n: N,
    tiles,
    loot: [{ id: 1, x: 2, y: 4, kind: "weapon", type: "pistol" }],
    zone: { stage: 0, box: [0, 0, 8, 8], closed: false },
    players: [
      { seat: 0, slot: 0, name: "@neo", is_me: true, x: 2, y: 2, hp: 80, ap: 0, armor: null, weapon: "fists", medkits: 1, alive: true, death_turn: null, kills: 0, dealt: 0 },
      { seat: 1, slot: 1, name: "@kira", is_me: false, x: 3, y: 2, hp: 100, ap: 0, armor: null, weapon: "knife", medkits: 0, alive: true, death_turn: null, kills: 0, dealt: 0 },
      { seat: 2, slot: 2, name: "@zed", is_me: false, x: 7, y: 7, hp: 100, ap: 30, armor: "light", weapon: "rifle", medkits: 0, alive: true, death_turn: null, kills: 0, dealt: 0 },
      { seat: 3, slot: 3, name: "@ash", is_me: false, x: 0, y: 8, hp: 0, ap: 0, armor: null, weapon: "fists", medkits: 0, alive: false, death_turn: 2, kills: 0, dealt: 0 },
    ],
    last_turn: null,
    places: null,
    ...p,
  };
}
export function battleRoom(m: Partial<ArenaMatchView> = {}, p: Partial<ArenaRoom> = {}): ArenaRoom {
  return {
    id: 7, type: "a4", status: "running", seats_total: 4, seats: [], taken: 4, my_seat: 0, stake_nano: "100000000",
    fill_deadline: null, started_at: iso(T0 - 30_000), finished_at: null, seed_hash: null, results: [], match: matchView(m),
    server_time: iso(T0), skew: 0, ...p,
  };
}

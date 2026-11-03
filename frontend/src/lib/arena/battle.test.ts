import { describe, expect, it } from "vitest";
import type { ArenaErr, ArenaMatchView } from "./api";
import { ambientActive } from "@/components/arena/board/renderer";
import {
  applyView,
  checkDraft,
  draftFromApi,
  emptyDraft,
  eventText,
  initialBattle,
  meOf,
  pathTo,
  planErrorAction,
  planLine,
  planToApi,
  reachCells,
  tapCell,
  targetsOf,
  toBoard,
  toggleMedkit,
  turnClock,
  zoneInfo,
} from "./battle";

import { battleRoom, matchView, T0, iso } from "./battle.fixture";

const board = (m: Partial<ArenaMatchView> = {}) => toBoard(battleRoom(m))!;
const err = (code: string, extra: Partial<ArenaErr> = {}): ArenaErr => ({ status: 400, code, message: "", ...extra });

describe("вид боя → состояние движка", () => {
  it("места — id игроков, «я» по is_me, оружие и броня — ключи движка, last_turn в форме движка", () => {
    const b = board({
      last_turn: { turn: 2, moves: { "1": [[3, 3], [3, 2]] }, shots: [{ from: 1, to: 3, miss: false, fx: 3, fy: 3, tx: 0, ty: 8, dmg: null }], zone_hits: [], deaths: [3], picks: [], events: [] },
    });
    expect(b.N).toBe(9);
    expect(b.meId).toBe(0);
    expect(b.players.map((p) => [p.id, p.isMe, p.weapon, p.armor, p.alive])).toEqual([
      [0, true, "fists", null, true],
      [1, false, "knife", null, true],
      [2, false, "rifle", "light", true],
      [3, false, "fists", null, false],
    ]);
    expect(b.lastTurn?.moves[1]).toEqual({ from: { x: 3, y: 3 }, to: { x: 3, y: 2 } });
    expect(b.lastTurn?.shots[0].dmg).toBeUndefined();
    expect(b.lastTurn?.deaths).toEqual([3]);
    expect(toBoard(battleRoom({}, { match: { id: 1, turn: 1, current: null } }))).toBeNull();
  });
});

describe("план: тапы, превью, проверка", () => {
  const b = board();
  const me = meOf(b)!;

  it("шаг, рывок на 2 в обход занятой клетки, стена и даль — «Туда не дойти»", () => {
    expect(pathTo(b, me, { x: 2, y: 3 })).toEqual([{ x: 2, y: 3 }]);
    const dash = pathTo(b, me, { x: 4, y: 2 })!; // (3,2) занят соперником — обход
    expect(dash).toHaveLength(2);
    expect(dash[0]).not.toEqual({ x: 3, y: 2 });
    expect(pathTo(b, me, { x: 4, y: 4 })).toBeNull();
    expect(tapCell(b, me, emptyDraft(), { x: 5, y: 2 }).err).toBe("Туда не дойти за ход");
    const cells = reachCells(b, me);
    expect(cells.some((c) => c.x === 3 && c.y === 2)).toBe(false);
    expect(cells.filter((c) => c.near).length).toBe(7);
  });

  it("атака: кулаки — в упор; после рывка атаки нет; рывок снимает атаку; повторный тап — отмена", () => {
    let r = tapCell(b, me, emptyDraft(), { x: 3, y: 2 });
    expect(r).toEqual({ draft: { path: [], attack: 1, medkit: false }, err: "" });
    expect(tapCell(b, me, r.draft, { x: 3, y: 2 }).draft.attack).toBeNull();
    expect(tapCell(b, me, emptyDraft(), { x: 7, y: 7 }).err).toBe("Кулаки: бьёт на 1 кл.");
    r = tapCell(b, me, r.draft, { x: 2, y: 0 });
    expect(r.err).toBe("Рывок на 2 клетки — атака снята");
    expect(r.draft.attack).toBeNull();
    expect(tapCell(b, me, r.draft, { x: 3, y: 2 }).err).toBe("После рывка на 2 клетки атаки нет");
    expect(targetsOf(b, me, emptyDraft()).map((p) => p.id)).toEqual([1]);
    expect(targetsOf(b, me, r.draft)).toEqual([]);
    expect(tapCell(b, me, r.draft, { x: 2, y: 2 }).draft.path).toEqual([]);
  });

  it("аптечка: вместо хода, повторно — отмена; без аптечек — не включается", () => {
    const d = toggleMedkit(me, { path: [{ x: 2, y: 3 }], attack: 1, medkit: false });
    expect(d).toEqual({ path: [], attack: null, medkit: true });
    expect(toggleMedkit(me, d)).toEqual(emptyDraft());
    expect(toggleMedkit({ ...me, medkits: 0 }, emptyDraft())).toEqual(emptyDraft());
    expect(planLine({ b, me, d, err: "", anim: false, locked: false, countdown: false }).parts.map((p) => p.text).join("")).toBe("Аптечка +20 HP, без движения и атаки");
  });

  it("checkDraft — те же коды, что validate_plan на сервере", () => {
    expect(checkDraft(b, me, emptyDraft())).toBeNull();
    expect(checkDraft(b, me, { path: [{ x: 3, y: 3 }], attack: 1, medkit: false })).toBeNull();
    expect(checkDraft(b, me, { path: [{ x: 2, y: 3 }], attack: null, medkit: true })).toBe("medkit_exclusive");
    expect(checkDraft(b, { ...me, medkits: 0 }, { path: [], attack: null, medkit: true })).toBe("no_medkit");
    expect(checkDraft(b, me, { path: [{ x: 2, y: 3 }, { x: 2, y: 4 }, { x: 2, y: 5 }], attack: null, medkit: false })).toBe("path_too_long");
    expect(checkDraft(b, me, { path: [{ x: 4, y: 4 }], attack: null, medkit: false })).toBe("step_not_adjacent");
    expect(checkDraft(b, me, { path: [{ x: 3, y: 3 }, { x: 4, y: 4 }], attack: null, medkit: false })).toBe("step_into_wall");
    expect(checkDraft(b, me, { path: [{ x: 2, y: 3 }, { x: 2, y: 4 }], attack: 1, medkit: false })).toBe("dash_no_attack");
    expect(checkDraft(b, me, { path: [], attack: 0, medkit: false })).toBe("attack_self");
    expect(checkDraft(b, me, { path: [], attack: 3, medkit: false })).toBe("attack_dead");
    expect(checkDraft(b, me, { path: [], attack: 9, medkit: false })).toBe("attack_unknown");
    expect(checkDraft(b, { ...me, alive: false }, emptyDraft())).toBe("player_dead");
  });

  it("план ↔ API: path [[x,y]], обратно — клетки", () => {
    const d = { path: [{ x: 2, y: 3 }, { x: 2, y: 4 }], attack: null, medkit: false };
    expect(planToApi(d)).toEqual({ path: [[2, 3], [2, 4]], attack: null, medkit: false });
    expect(draftFromApi(planToApi(d))).toEqual(d);
    expect(draftFromApi(null)).toEqual(emptyDraft());
  });

  it("строка плана: шаг + атака с уроном; принято; выбыл", () => {
    const l = planLine({ b, me, d: { path: [], attack: 1, medkit: false }, err: "", anim: false, locked: false, countdown: false });
    expect(l.tag).toBe("План");
    expect(l.parts.map((p) => p.text).join("")).toBe("атака @kira −12");
    expect(planLine({ b, me, d: emptyDraft(), err: "", anim: false, locked: true, countdown: false }).tag).toBe("Принято");
    expect(planLine({ b, me, d: emptyDraft(), err: "x", anim: false, locked: false, countdown: false })).toMatchObject({ tag: "Нельзя", err: true });
    expect(planLine({ b, me: { ...me, alive: false }, d: emptyDraft(), err: "", anim: false, locked: false, countdown: false }).tag).toBe("Наблюдение");
  });
});

describe("зона, таймер, лента", () => {
  it("зона: размер и «сужение через»; вне зоны — урон", () => {
    expect(zoneInfo(board(), meOf(board()))).toMatchObject({ closed: false, size: 9, me: null });
    const b = board({ turn: 9, zone: { stage: 2, box: [2, 2, 6, 6], closed: false } });
    const z = zoneInfo(b, meOf(b));
    expect(z.size).toBe(5);
    expect(z.me).toEqual({ out: false, text: "в зоне" });
    const out = zoneInfo(b, { ...meOf(b)!, x: 0, y: 0 });
    expect(out.me?.out).toBe(true);
    expect(out.me?.text).toMatch(/^вне зоны −\d+$/);
  });

  it("таймер: секунды до дедлайна с поправкой часов; до opens_at — отсчёт", () => {
    const cur = { turn: 3, opens_at: iso(T0), deadline: iso(T0 + 10_000), ready_seats: [], my_plan: null };
    expect(turnClock(cur, 0, T0 + 2_500)).toEqual({ left: 8, frac: 0.75, opensIn: 0 });
    expect(turnClock(cur, 1_000, T0 + 2_500).left).toBe(7);
    expect(turnClock(cur, 0, T0 - 1_500)).toEqual({ left: 10, frac: 1, opensIn: 1_500 });
    expect(turnClock(cur, 0, T0 + 60_000).left).toBe(0);
  });

  it("тексты событий — как в прототипе, «Вы» для себя", () => {
    const b = board();
    expect(eventText(b, { t: "hit", who: 1, target: 0, dmg: 12 })).toBe("@kira → Вы: −12");
    expect(eventText(b, { t: "miss", who: 0, target: 2 })).toBe("Вы → @zed: мимо (вне досягаемости)");
    expect(eventText(b, { t: "death", who: 0, zone: true })).toBe("Вы выбыли (зона)");
    expect(eventText(b, { t: "death", who: 3 })).toBe("@ash выбыл");
    expect(eventText(b, { t: "pick", who: 2, kind: "weapon", type: "rifle" })).toBe("@zed: винтовка");
    expect(eventText(b, { t: "pick", who: 0, kind: "medkit", type: "medkit" })).toBe("Вы: подобрал аптечку");
    expect(eventText(b, { t: "zone-shrink", stage: 1, closed: false })).toBe("Зона сузилась: 7×7");
    expect(eventText(b, { t: "zone-shrink", stage: 5, closed: true })).toBe("Зона закрылась: урон всем");
    expect(eventText(b, { t: "heal", who: 0, hp: 20 })).toBe("Вы: аптечка +20");
  });
});

describe("состояние между опросами", () => {
  const lt3 = {
    turn: 3,
    moves: { "0": [[2, 2], [2, 3]] as [[number, number], [number, number]] },
    shots: [{ from: 1, to: 0, miss: false, fx: 3, fy: 2, tx: 2, ty: 3, dmg: 8 }],
    zone_hits: [],
    deaths: [],
    picks: [],
    events: [{ t: "hit", who: 1, target: 0, dmg: 8 }],
  };

  it("первая загрузка — без анимации; тот же ход — без анимации, готовность обновляется", () => {
    let s = applyView(initialBattle(), battleRoom());
    expect(s.board?.turn).toBe(3);
    expect(s.prev).toBeNull();
    expect(s.animKey).toBe(0);
    s = applyView(s, battleRoom({ current: { turn: 3, opens_at: iso(T0), deadline: iso(T0 + 10_000), ready_seats: [0, 1], my_plan: null } }));
    expect(s.animKey).toBe(0);
  });

  it("повторный опрос без изменений — тот же объект состояния (поле не перерисовывается)", () => {
    const s = applyView(initialBattle(), battleRoom());
    expect(applyView(s, battleRoom())).toBe(s);
    const moved = applyView(s, battleRoom({ players: matchView().players!.map((p) => (p.seat === 2 ? { ...p, hp: 50 } : p)) }));
    expect(moved).not.toBe(s);
    expect(moved.board?.players.find((p) => p.id === 2)?.hp).toBe(50);
  });

  it("ход разыгран (turn+1, last_turn = прошлый) — анимация от прошлого состояния, событие в ленту один раз", () => {
    const s0 = applyView(initialBattle(), battleRoom());
    const next = battleRoom(
      { turn: 4, last_turn: lt3, players: matchView().players!.map((p) => (p.seat === 0 ? { ...p, y: 3, hp: 72 } : p)) },
      { turns: [{ turn: 3, opens_at: iso(T0), deadline: iso(T0 + 10_000), resolved_at: iso(T0 + 4_000), reason: "all_ready", plans: {}, result: lt3 }] },
    );
    const s1 = applyView(s0, next);
    expect(s1.animKey).toBe(1);
    expect(s1.prev?.turn).toBe(3);
    expect(s1.board?.turn).toBe(4);
    expect(s1.feed.map((f) => [f.turn, f.text, f.mine])).toEqual([[3, "@kira → Вы: −8", true]]);
    const s2 = applyView(s1, next);
    expect(s2.feed).toHaveLength(1);
    expect(s2.animKey).toBe(1);
  });

  it("прыжок через ход (пропущенный опрос) — без анимации, но события обоих ходов в ленте", () => {
    const s0 = applyView(initialBattle(), battleRoom());
    const lt4 = { ...lt3, turn: 4, moves: {}, shots: [], events: [{ t: "zone-shrink", stage: 1, closed: false }] };
    const s1 = applyView(
      s0,
      battleRoom(
        { turn: 5, last_turn: lt4 },
        {
          turns: [
            { turn: 3, opens_at: "", deadline: "", resolved_at: "", reason: "deadline", plans: {}, result: lt3 },
            { turn: 4, opens_at: "", deadline: "", resolved_at: "", reason: "deadline", plans: {}, result: lt4 },
          ],
        },
      ),
    );
    expect(s1.animKey).toBe(0);
    expect(s1.prev).toBeNull();
    expect(s1.feed.map((f) => f.turn)).toEqual([4, 3]);
  });
});

describe("ошибки POST /plan", () => {
  it("bad_plan — сброс с причиной; match_finished — обновить; player_dead — наблюдение", () => {
    expect(planErrorAction(err("bad_plan", { reason: "step_into_wall" }))).toEqual({ kind: "reset", text: "В стену не пройти" });
    expect(planErrorAction(err("bad_plan", { reason: "что-то новое" })).kind).toBe("reset");
    expect(planErrorAction(err("bad_plan", { reason: "match_finished" })).kind).toBe("refetch");
    expect(planErrorAction(err("bad_plan", { reason: "player_dead" })).kind).toBe("spectate");
  });
  it("turn_mismatch / room_state — обновить; turn_not_open — повторить; сеть и 5xx — оставить черновик", () => {
    expect(planErrorAction(err("turn_mismatch", { status: 409, currentTurn: 8 }))).toEqual({ kind: "refetch", text: "Ход уже сменился" });
    expect(planErrorAction(err("room_state", { status: 409 })).kind).toBe("refetch");
    expect(planErrorAction(err("turn_not_open", { status: 409 })).kind).toBe("retry");
    expect(planErrorAction(err("not_playing", { status: 403 })).kind).toBe("spectate");
    expect(planErrorAction(err("network", { status: 0 }))).toEqual({ kind: "keep", text: "Нет связи — план отправим ещё раз" });
    expect(planErrorAction(err("http_502", { status: 502 })).kind).toBe("keep");
  });
});

describe("эмбиент поля", () => {
  const ring = { x: 0, y: 0, w: 10, h: 10 };
  it("цикл только пока кольцо зоны живо и бой идёт", () => {
    expect(ambientActive({ ring, finished: false, reduced: false })).toBe(true);
    expect(ambientActive({ ring: null, finished: false, reduced: false })).toBe(false); // зона закрылась
    expect(ambientActive({ ring, finished: true, reduced: false })).toBe(false);
    expect(ambientActive({ ring, finished: false, reduced: true })).toBe(false);
  });
});

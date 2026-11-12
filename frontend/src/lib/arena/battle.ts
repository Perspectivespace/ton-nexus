/**
 * Логика экрана боя «Арены» без React: вид боя из API → состояние в форме движка, черновик плана
 * (тапы по полю, превью и проверка — общим движком shared/arena/engine.js, как на сервере),
 * тексты HUD и ленты, разбор ошибок POST /plan, накопление состояния между опросами.
 */
import {
  ARMORS,
  MAX_HP,
  MEDKIT_HEAL,
  TURN_MS,
  WEAPONS,
  canHit,
  cheb,
  inBox,
  maxStage,
  passable,
  rawDamage,
  sealedCorner,
  turnsToShrink,
  zoneBox,
  zoneDmg,
  type ArmorId,
  type Cell,
  type LastTurn,
  type Plan,
  type Tile,
  type WeaponId,
} from "@shared/arena/engine.js";
import type { Board, BoardPlayer, ReachCell } from "@/components/arena/board/types";
import type { ApiPlan, ArenaErr, ArenaEventView, ArenaLastTurn, ArenaRoom, ArenaTurnInfo } from "./api";
import { t, type Key } from "@/i18n";

export type Draft = Plan;
export const emptyDraft = (): Draft => ({ path: [], attack: null, medkit: false });

// ───── вид боя из API → состояние в форме движка ─────
const WEAPON_IDS = new Set(Object.keys(WEAPONS));
const ARMOR_IDS = new Set(Object.keys(ARMORS));

/** Названия оружия и брони — из словаря (в shared/arena/engine.js — русские, для движка и векторов) */
export const weaponName = (id: WeaponId) => t(`arena.w.${id}` as Key);
export const armorName = (id: ArmorId) => t(`arena.a.${id}` as Key);

export function lastTurnOf(lt: ArenaLastTurn | null | undefined): LastTurn | null {
  if (!lt) return null;
  const moves: LastTurn["moves"] = {};
  for (const [k, mv] of Object.entries(lt.moves ?? {})) {
    if (!Array.isArray(mv) || mv.length < 2) continue;
    moves[Number(k)] = { from: { x: mv[0][0], y: mv[0][1] }, to: { x: mv[1][0], y: mv[1][1] } };
  }
  return {
    turn: lt.turn,
    moves,
    shots: (lt.shots ?? []).map((s) => ({ ...s, dmg: s.dmg ?? undefined })),
    zoneHits: lt.zone_hits ?? [],
    deaths: lt.deaths ?? [],
    picks: lt.picks ?? [],
  };
}

/** null — боя ещё нет (или вид без поля) */
export function toBoard(room: ArenaRoom): Board | null {
  const m = room.match;
  if (!m || !m.n || !m.tiles || !m.players) return null;
  let meId: number | null = null;
  const players: BoardPlayer[] = m.players.map((p) => {
    if (p.is_me) meId = p.seat;
    return {
      id: p.seat,
      name: p.name ?? t("arena.player"),
      bot: !p.is_me, // движок подписывает «Вы» / «@имя» по этому флагу
      slot: p.slot,
      isMe: !!p.is_me,
      x: p.x ?? 0,
      y: p.y ?? 0,
      hp: p.hp ?? 0,
      ap: p.ap ?? 0,
      armor: p.armor && ARMOR_IDS.has(p.armor) ? (p.armor as ArmorId) : null,
      weapon: p.weapon && WEAPON_IDS.has(p.weapon) ? (p.weapon as WeaponId) : "fists",
      medkits: p.medkits ?? 0,
      alive: p.alive ?? true,
      deathTurn: p.death_turn ?? null,
      kills: p.kills ?? 0,
      dealt: p.dealt ?? 0,
    };
  });
  if (meId == null && room.my_seat != null && players.some((p) => p.id === room.my_seat)) {
    meId = room.my_seat;
    for (const p of players) if (p.id === meId) p.isMe = true;
  }
  return {
    N: m.n,
    tiles: m.tiles as Tile[][],
    loot: (m.loot ?? []).map((l) => ({ ...l, kind: l.kind as "weapon" | "armor" | "medkit" })),
    players,
    turn: m.turn,
    stage: m.zone?.stage ?? 0,
    finished: !!m.finished || m.phase === "finished",
    lastTurn: lastTurnOf(m.last_turn),
    meId,
  };
}

export const meOf = (b: Board | null): BoardPlayer | undefined => (b && b.meId != null ? b.players.find((p) => p.id === b.meId) : undefined);

// ───── план: превью и проверка ─────
const occupied = (b: Board, me: BoardPlayer) => new Set(b.players.filter((o) => o.alive && o.id !== me.id).map((o) => o.y * 64 + o.x));

export function plannedPos(me: Cell, d: Draft): Cell {
  return d.path.length ? d.path[d.path.length - 1] : { x: me.x, y: me.y };
}

/** кратчайший путь ≤ 2 шагов в обход стен, занятых клеток и запертых углов (как в прототипе) */
export function pathTo(b: Board, me: BoardPlayer, target: Cell): Cell[] | null {
  const occ = occupied(b, me);
  const free = (x: number, y: number) => passable(b, x, y) && !occ.has(y * 64 + x);
  if (!free(target.x, target.y)) return null;
  const d = cheb(me, target);
  if (d === 1) return sealedCorner(b.tiles, me, target) ? null : [{ x: target.x, y: target.y }];
  if (d !== 2) return null;
  const mids: Cell[] = [];
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const mm = { x: me.x + dx, y: me.y + dy };
      if ((dx || dy) && free(mm.x, mm.y) && cheb(mm, target) === 1 && !sealedCorner(b.tiles, me, mm) && !sealedCorner(b.tiles, mm, target)) mids.push(mm);
    }
  if (!mids.length) return null;
  const man = (a: Cell) => Math.abs(a.x - target.x) + Math.abs(a.y - target.y);
  mids.sort((a, c) => man(a) - man(c));
  return [mids[0], { x: target.x, y: target.y }];
}

/** клетки, куда можно дойти за ход (near — соседние) */
export function reachCells(b: Board, me: BoardPlayer): ReachCell[] {
  const occ = occupied(b, me), out: ReachCell[] = [];
  for (let dx = -2; dx <= 2; dx++)
    for (let dy = -2; dy <= 2; dy++) {
      const x = me.x + dx, y = me.y + dy;
      if ((!dx && !dy) || !passable(b, x, y) || occ.has(y * 64 + x)) continue;
      if (!pathTo(b, me, { x, y })) continue;
      out.push({ x, y, near: Math.max(Math.abs(dx), Math.abs(dy)) === 1 });
    }
  return out;
}

/** соперники, по которым план бьёт с конечной клетки (рывок на 2 и аптечка — без атаки) */
export function targetsOf(b: Board, me: BoardPlayer, d: Draft): BoardPlayer[] {
  if (d.path.length >= 2 || d.medkit) return [];
  const from = plannedPos(me, d);
  return b.players.filter((o) => o.alive && o.id !== me.id && canHit(b, from, me.weapon, o));
}

export interface TapResult {
  draft: Draft;
  err: string;
}
/** тап по клетке поля → новый черновик и, если нельзя, причина */
export function tapCell(b: Board, me: BoardPlayer, d: Draft, c: Cell): TapResult {
  let plan: Draft = { path: [...d.path], attack: d.attack, medkit: d.medkit };
  const foe = b.players.find((o) => o.alive && o.id !== me.id && o.x === c.x && o.y === c.y);
  if (foe) {
    if (plan.medkit) plan = emptyDraft();
    const w = WEAPONS[me.weapon];
    if (plan.attack === foe.id) return { draft: { ...plan, attack: null }, err: "" };
    if (plan.path.length === 2) return { draft: plan, err: t("arena.bDashNoAttack") };
    if (!canHit(b, plannedPos(me, plan), me.weapon, foe)) return { draft: plan, err: t("arena.bRange", { name: weaponName(me.weapon), range: w.range, range2: w.range > 1 ? t("arena.bWalls") : "" }) };
    return { draft: { ...plan, attack: foe.id }, err: "" };
  }
  if (c.x === me.x && c.y === me.y) return { draft: { ...plan, path: [], medkit: false }, err: "" };
  const path = pathTo(b, me, c);
  if (!path) return { draft: plan, err: t("arena.bTooFar") };
  plan = { ...plan, medkit: false, path };
  if (path.length === 2 && plan.attack != null) return { draft: { ...plan, attack: null }, err: t("arena.bDashDrop") };
  return { draft: plan, err: "" };
}

/** аптечка вместо хода; повторное нажатие — отмена */
export function toggleMedkit(me: BoardPlayer, d: Draft): Draft {
  if (me.medkits <= 0) return d;
  return d.medkit ? emptyDraft() : { path: [], attack: null, medkit: true };
}

/** та же проверка, что validate_plan на сервере: код причины или null */
export function checkDraft(b: Board, me: BoardPlayer | undefined, d: Draft): string | null {
  if (b.finished) return "match_finished";
  if (!me) return "unknown_player";
  if (!me.alive) return "player_dead";
  if (d.medkit) {
    if (d.path.length || d.attack != null) return "medkit_exclusive";
    return me.medkits > 0 ? null : "no_medkit";
  }
  if (d.path.length > 2) return "path_too_long";
  let cur: Cell = me;
  for (const s of d.path) {
    if (s.x < 0 || s.y < 0 || s.x >= b.N || s.y >= b.N) return "step_out_of_bounds";
    if (cheb(cur, s) !== 1) return "step_not_adjacent";
    if (b.tiles[s.y][s.x] === 1) return "step_into_wall";
    if (sealedCorner(b.tiles, cur, s)) return "step_sealed_corner";
    cur = s;
  }
  if (d.attack != null) {
    if (d.path.length === 2) return "dash_no_attack";
    if (d.attack === me.id) return "attack_self";
    const t = b.players.find((o) => o.id === d.attack);
    if (!t) return "attack_unknown";
    if (!t.alive) return "attack_dead";
  }
  return null;
}

export const planToApi = (d: Draft): ApiPlan => ({ path: d.path.map((c) => [c.x, c.y] as [number, number]), attack: d.attack, medkit: d.medkit });
export function draftFromApi(p: ApiPlan | null | undefined): Draft {
  if (!p) return emptyDraft();
  const path = (p.path ?? []).map((s) => (Array.isArray(s) ? { x: s[0], y: s[1] } : { x: (s as Cell).x, y: (s as Cell).y }));
  return { path, attack: p.attack ?? null, medkit: !!p.medkit };
}
export const sameDraft = (a: Draft, b: Draft) => JSON.stringify(planToApi(a)) === JSON.stringify(planToApi(b));
export const isEmptyDraft = (d: Draft) => !d.path.length && d.attack == null && !d.medkit;

// ───── тексты HUD ─────
export const nameOf = (b: Board, id: number | undefined) => {
  const p = b.players.find((o) => o.id === id);
  // имя с сервера уже готово к показу: «@username» или имя из Telegram — без своего «@»
  return !p ? "?" : p.id === b.meId ? t("ratings.you") : p.name;
};

/** строка плана: tag + сегменты (b — выделить) */
export interface PlanLine {
  tag: string;
  parts: { text: string; b?: boolean }[];
  err?: boolean;
}
export function planLine(o: { b: Board; me: BoardPlayer | undefined; d: Draft; err: string; anim: boolean; locked: boolean; countdown: boolean }): PlanLine {
  const { b, me, d } = o;
  if (!me) return { tag: t("arena.bWatching"), parts: [{ text: t("arena.bWatchingSub") }] };
  if (b.finished) return { tag: t("arena.bFinal"), parts: [{ text: t("arena.over") }] };
  if (o.anim && me.alive) return { tag: t("arena.bResolve"), parts: [{ text: t("arena.bResolveSub", { turn: b.turn - 1 }) }] };
  if (!me.alive) return { tag: t("arena.bWatching"), parts: [{ text: t("arena.bOutSub") }] };
  if (o.err) return { tag: t("arena.bNo"), parts: [{ text: o.err }], err: true };
  if (o.locked) return { tag: t("arena.bAccepted"), parts: [{ text: t("arena.bWaitOthers") }] };
  if (d.medkit) return { tag: t("arena.bPlan"), parts: [{ text: t("arena.bMedkit") }, { text: `+${Math.min(MEDKIT_HEAL, MAX_HP - me.hp)} HP`, b: true }, { text: t("arena.bMedkitTail") }] };
  const parts: PlanLine["parts"] = [];
  if (d.path.length === 2) parts.push({ text: t("arena.bDash"), b: true }, { text: t("arena.bNoAttack") });
  else if (d.path.length === 1) parts.push({ text: t("arena.bStep"), b: true });
  if (d.attack != null) {
    const foe = b.players.find((x) => x.id === d.attack);
    if (foe) {
      if (parts.length) parts.push({ text: " + " });
      parts.push({ text: t("arena.bAttack") }, { text: nameOf(b, foe.id), b: true }, { text: ` −${rawDamage(b, plannedPos(me, d), me.weapon, foe)}` });
    }
  }
  if (parts.length) return { tag: t("arena.bPlan"), parts };
  return { tag: o.countdown ? t("arena.bStart") : t("arena.turn"), parts: [{ text: t("arena.bHint") }] };
}

export interface ZoneInfo {
  closed: boolean;
  size: number;
  next: string;
  /** «вне зоны −d» / «в зоне» / нет (до первого сужения) */
  me: { out: boolean; text: string } | null;
}
export function zoneInfo(b: Board, me: BoardPlayer | undefined): ZoneInfo {
  const box = zoneBox(b.N, b.stage), ms = maxStage(b.N), tts = turnsToShrink(b.turn);
  const dmg = zoneDmg(b.stage, b.N, b.turn);
  const next = b.stage > ms ? t("arena.bAllDmg", { dmg }) : b.stage === ms ? t("arena.bClosesIn", { tts: tts + 1 }) : t("arena.bShrinksIn", { tts: tts + 1 });
  const inside = !box.closed && !!me && inBox(box, me);
  let mine: ZoneInfo["me"] = null;
  if (me?.alive && b.stage > 0) mine = inside ? { out: false, text: t("arena.bInZone") } : { out: true, text: t("arena.bOutZone", { dmg }) };
  return { closed: !!box.closed, size: box.closed ? 0 : box.x1 - box.x0 + 1, next, me: mine };
}

/** таймер хода по deadline с поправкой часов: секунды, доля (1 → 0), до открытия (мс) */
export function turnClock(cur: ArenaTurnInfo | null | undefined, skew: number, nowMs: number) {
  if (!cur) return { left: 0, frac: 0, opensIn: 0 };
  const now = nowMs + skew;
  const dl = Date.parse(cur.deadline), op = Date.parse(cur.opens_at);
  const opensIn = Number.isFinite(op) ? Math.max(0, op - now) : 0;
  const leftMs = Number.isFinite(dl) ? Math.max(0, dl - Math.max(now, Number.isFinite(op) ? op : now)) : 0;
  return { left: Math.ceil(leftMs / 1000), frac: Math.max(0, Math.min(1, leftMs / TURN_MS)), opensIn };
}

// ───── лента событий ─────
export interface FeedItem {
  key: string;
  turn: number;
  t: string;
  text: string;
  mine: boolean;
}
export function eventText(b: Board, e: ArenaEventView): string {
  const nm = (id: number | undefined) => nameOf(b, id);
  switch (e.t) {
    case "heal":
      return t("arena.eMedkit", { who: nm(e.who), MEDKITHEAL: e.hp ?? MEDKIT_HEAL });
    case "bump":
      return t("arena.ePathBlocked", { who: nm(e.who) });
    case "pick":
      if (e.kind === "medkit") return t("arena.ePickMedkit", { who: nm(e.who) });
      if (e.kind === "weapon" && e.type && e.type in WEAPONS) return `${nm(e.who)}: ${weaponName(e.type as WeaponId).toLowerCase()}`;
      if (e.kind === "armor" && e.type && e.type in ARMORS) return `${nm(e.who)}: ${armorName(e.type as ArmorId).toLowerCase()}`;
      return t("arena.ePickItem", { who: nm(e.who) });
    case "miss":
      return t("arena.eMiss", { who: nm(e.who), target: nm(e.target) });
    case "hit":
      return `${nm(e.who)} → ${nm(e.target)}: −${e.dmg ?? 0}`;
    case "zone":
      return t("arena.eZone", { who: nm(e.who), dmg: e.dmg ?? 0 });
    case "death":
      return `${e.who === b.meId ? t("arena.bYouOut") : t("arena.eOut", { who: nm(e.who) })}${e.zone ? t("arena.eOutZone") : ""}`;
    case "zone-shrink": {
      const k = b.N - 2 * (e.stage ?? b.stage);
      return e.closed ? t("arena.zoneClosed") : t("arena.zoneShrank", { k, k2: k });
    }
    default:
      return e.t;
  }
}
/** события хода → строки ленты (внутри хода — по порядку розыгрыша) */
export function feedOf(b: Board, turn: number, events: ArenaEventView[] | undefined): FeedItem[] {
  return (events ?? []).map((e, i) => ({
    key: `${turn}:${i}`,
    turn,
    t: e.t,
    text: eventText(b, e),
    mine: b.meId != null && (e.who === b.meId || e.target === b.meId),
  }));
}

// ───── ошибки POST /plan ─────
const BAD_PLAN: Record<string, string> = {
  get medkit_exclusive() { return t("arena.bp.medkit_exclusive"); },
  get no_medkit() { return t("arena.bp.no_medkit"); },
  get path_too_long() { return t("arena.bp.path_too_long"); },
  get step_out_of_bounds() { return t("arena.bp.step_out_of_bounds"); },
  get step_not_adjacent() { return t("arena.bp.step_not_adjacent"); },
  get step_into_wall() { return t("arena.bp.step_into_wall"); },
  get step_sealed_corner() { return t("arena.bp.step_sealed_corner"); },
  get dash_no_attack() { return t("arena.bDashNoAttack"); },
  get attack_self() { return t("arena.bp.attack_self"); },
  get attack_unknown() { return t("arena.bp.attack_unknown"); },
  get attack_dead() { return t("arena.bp.attack_dead"); },
};
export const badPlanText = (reason: string | undefined) => (reason && BAD_PLAN[reason]) || t("arena.bp.rejected");

/**
 * Что делать после ошибки отправки плана:
 * reset — план неверен, черновик сбросить; refetch — ход сменился, взять свежее состояние;
 * retry — ход ещё не открыт, повторить у opens_at; spectate — вы уже не играете; keep — связь, оставить черновик и повторить.
 */
export type PlanErrAction = { kind: "reset" | "refetch" | "retry" | "spectate" | "keep"; text: string };
export function planErrorAction(e: ArenaErr): PlanErrAction {
  switch (e.code) {
    case "bad_plan":
      if (e.reason === "match_finished") return { kind: "refetch", text: t("arena.over2") };
      if (e.reason === "player_dead" || e.reason === "unknown_player") return { kind: "spectate", text: t("arena.bOutSub") };
      return { kind: "reset", text: badPlanText(e.reason) };
    case "turn_mismatch":
      return { kind: "refetch", text: t("arena.turnChanged") };
    case "room_state":
      return { kind: "refetch", text: t("arena.over2") };
    case "turn_not_open":
      return { kind: "retry", text: t("arena.turnNotStarted") };
    case "not_playing":
      return { kind: "spectate", text: t("arena.notPlaying") };
    default:
      return { kind: "keep", text: e.code === "network" ? t("arena.netRetry") : t("arena.serverRetry") };
  }
}

// ───── состояние экрана между опросами ─────
export interface BattleState {
  board: Board | null;
  /** состояние до последнего хода — для анимации розыгрыша (null — не анимировать) */
  prev: Board | null;
  /** растёт на каждый новый розыгрыш — сигнал «запусти анимацию» */
  animKey: number;
  feed: FeedItem[];
  /** последний ход, чьи события уже в ленте */
  seen: number;
}
export const initialBattle = (): BattleState => ({ board: null, prev: null, animKey: 0, feed: [], seen: 0 });
export const FEED_MAX = 24;

/** новый ответ /state → состояние экрана: доска, лента (журнал + last_turn без дублей), нужна ли анимация */
export function applyView(st: BattleState, room: ArenaRoom): BattleState {
  const next = toBoard(room);
  if (!next) return st;
  let seen = st.seen;
  const add: FeedItem[] = [];
  const entries = [...(room.turns ?? [])].sort((a, b) => a.turn - b.turn);
  for (const e of entries)
    if (e.result && e.turn > seen) {
      add.unshift(...feedOf(next, e.turn, e.result.events));
      seen = e.turn;
    }
  const lt = room.match?.last_turn;
  if (lt && lt.turn > seen) {
    add.unshift(...feedOf(next, lt.turn, lt.events));
    seen = lt.turn;
  }
  // лента: новые ходы сверху; внутри хода — по порядку
  const feed = add.length ? [...regroup(add), ...st.feed].slice(0, FEED_MAX) : st.feed;
  const old = st.board;
  if (old && old.turn === next.turn && old.finished === next.finished) {
    // тот же ход: опрос без изменений поля — прежнее состояние (тот же объект доски → canvas не перерисовывается)
    if (!add.length && JSON.stringify(old) === JSON.stringify(next)) return st;
    // иначе обновляем доску, анимацию не трогаем
    return { ...st, board: next, feed, seen };
  }
  const resolvedPrev = !!old && !!next.lastTurn && next.lastTurn.turn === old.turn && next.turn > old.turn;
  return {
    board: next,
    prev: resolvedPrev ? old : null,
    animKey: resolvedPrev ? st.animKey + 1 : st.animKey,
    feed,
    seen,
  };
}
/** add собран unshift'ом по ходам: [ход k (по порядку)…, ход k-1…] — оставляем как есть, только стабилизируем */
const regroup = (items: FeedItem[]) => {
  const byTurn = new Map<number, FeedItem[]>();
  for (const it of items) byTurn.set(it.turn, [...(byTurn.get(it.turn) ?? []), it]);
  return [...byTurn.keys()].sort((a, b) => b - a).flatMap((k) => byTurn.get(k)!);
};

/** место выбывшего: живые + 1 (как в прототипе) */
export const outPlace = (b: Board) => b.players.filter((o) => o.alive).length + 1;

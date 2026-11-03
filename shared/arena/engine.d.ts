/**
 * Типы для shared/arena/engine.js (движок «Арены», общий для фронтенда и векторов Python-порта).
 * Сам движок — чистый JS без сборки; здесь только то, что импортирует фронтенд.
 */
export interface Cell {
  x: number;
  y: number;
}
export type WeaponId = "fists" | "knife" | "pistol" | "rifle";
export type ArmorId = "light" | "heavy";
export type Tile = 0 | 1 | 2;

export interface Weapon {
  name: string;
  short: string;
  range: number;
  dmg: number;
  tier: number;
}
export interface Armor {
  name: string;
  ap: number;
  tier: number;
}
export interface RoomDef {
  id: string;
  name: string;
  players: number;
  size: number;
  stake: number;
  feePct: number;
  prizes: number[];
  fillSec: number;
}

export interface Loot {
  id: number | string;
  x: number;
  y: number;
  kind: "weapon" | "armor" | "medkit";
  type: string | null;
}
export interface Player {
  id: number;
  name: string;
  bot?: boolean;
  slot?: number;
  x: number;
  y: number;
  hp: number;
  ap: number;
  armor: ArmorId | null;
  weapon: WeaponId;
  medkits: number;
  alive: boolean;
  deathTurn: number | null;
  hpBefore?: number;
  dealt: number;
  kills: number;
}
export interface Shot {
  from: number;
  to: number;
  miss?: boolean;
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  dmg?: number;
}
export interface TurnEvent {
  t: "heal" | "bump" | "pick" | "miss" | "hit" | "zone" | "death" | "zone-shrink";
  who?: number;
  target?: number;
  text?: string;
  [k: string]: unknown;
}
export interface LastTurn {
  turn: number;
  moves: Record<number, { from: Cell; to: Cell }>;
  shots: Shot[];
  zoneHits: { who: number; dmg: number }[];
  deaths: number[];
  picks: { who: number; x: number; y: number; kind: string; type: string | null }[];
}
export interface MatchState {
  roomId?: string;
  seed?: number;
  N: number;
  tiles: Tile[][];
  loot: Loot[];
  players: Player[];
  turn: number;
  stage: number;
  finished: boolean;
  events?: TurnEvent[];
  lastTurn: LastTurn | null;
  places?: unknown;
}
export interface Plan {
  path: Cell[];
  attack: number | null;
  medkit: boolean;
}
export interface ZoneBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  closed?: boolean;
}

export const TURN_MS: number;
export const ZONE_EVERY: number;
export const MAX_HP: number;
export const MEDKIT_HEAL: number;
export const MEDKIT_MAX: number;
export const MAX_TURNS: number;
export const NANO: number;
export const ROOMS: Record<"a4" | "a8", RoomDef>;
export const WEAPONS: Record<WeaponId, Weapon>;
export const ARMORS: Record<ArmorId, Armor>;
export const BOT_NAMES: string[];

export function shrinksAfter(turn: number): boolean;
export function turnsToShrink(turn: number): number;
export function rng(seed: number): () => number;
export function cheb(a: Cell, b: Cell): number;
export function sealedCorner(tiles: Tile[][] | number[][], a: Cell, b: Cell): boolean;
export function zoneBox(N: number, stage: number): ZoneBox;
export function inBox(b: ZoneBox, p: Cell): boolean;
export function maxStage(N: number): number;
export function zoneDmg(stage: number, N: number, turn: number): number;
export function passable(s: Pick<MatchState, "N" | "tiles">, x: number, y: number): boolean;
export function los(s: Pick<MatchState, "tiles">, a: Cell, b: Cell): boolean;
export function canHit(s: Pick<MatchState, "tiles">, from: Cell, weapon: WeaponId, to: Cell): boolean;
export function rawDamage(s: Pick<MatchState, "tiles">, from: Cell, weapon: WeaponId, target: Cell): number;
export function damageOf(
  s: Pick<MatchState, "tiles">,
  from: Cell,
  weapon: WeaponId,
  target: Cell & { ap: number },
): { hp: number; ap: number };
export function sanitize(s: MatchState, p: Player, plan: Partial<Plan> | null | undefined): Plan;
export function resolveTurn(prev: MatchState, plans: Record<number, Partial<Plan> | null | undefined>): MatchState;
export function placements(s: MatchState): unknown;
export function botPlan(s: MatchState, id: number): Plan;
export function seatOrder(seed: number, n: number): number[];
export function createMatch(
  roomId: "a4" | "a8",
  seed: number,
  players: { id: number; name: string; bot?: boolean }[],
): MatchState;
export function spawnsFor(room: RoomDef): Cell[];

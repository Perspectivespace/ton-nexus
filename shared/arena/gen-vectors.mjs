// Векторы «Арены»: эталонный JS-движок (engine.js — копия прототипа) → shared/arena-vectors.json.
// Python-порт (backend/app/services/arena_engine.py) обязан выдать то же самое: tests/test_arena_engine.py.
// Запуск из корня репозитория: node shared/arena/gen-vectors.mjs
// Файл детерминированный: повторный запуск без изменения engine.js даёт тот же JSON байт в байт.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as E from "./engine.js";

const OUT = fileURLToPath(new URL("../arena-vectors.json", import.meta.url));
// id игроков — не 0..n-1 и не по возрастанию: порядок входа ≠ порядок id (лут и атаки идут по id)
const IDS = { a4: [41, 7, 230, 12], a8: [41, 7, 230, 12, 5, 99, 64, 18] };
const EDGE_SEEDS = [0, 1, 2147483647, 2147483648, 4294967295];

const tilesStr = (t) => t.map((row) => row.join(""));
const lootArr = (loot) => loot.map((l) => [l.id, l.kind, l.type, l.x, l.y]);
const player = (p) => [p.id, p.slot, p.x, p.y, p.hp, p.ap, p.armor, p.weapon, p.medkits, p.alive, p.deathTurn, p.hpBefore, p.dealt, p.kills, p.bumps ?? 0];
const players = (n) => IDS[n].map((id) => ({ id, name: "p" + id, bot: true }));

function maps() {
  const out = [];
  for (const room of ["a4", "a8"]) {
    const seeds = [...EDGE_SEEDS];
    for (let i = 0; i < 40; i++) seeds.push((Math.imul(i + 1, 2654435761) >>> 0)); // разброс по всему uint32
    for (const seed of seeds) {
      const s = E.createMatch(room, seed, players(room));
      out.push({ room, seed, tiles: tilesStr(s.tiles), loot: lootArr(s.loot), starts: s.players.map((p) => [p.id, p.x, p.y]) });
    }
  }
  return out;
}

// Углы: все диагонали рядом с препятствиями на картах-векторах — может ли JS-движок пройти и ударить
function corners() {
  const out = [];
  for (const room of ["a4", "a8"]) for (const seed of [0, 1, 4294967295]) {
    const s = E.createMatch(room, seed, players(room));
    for (let y = 0; y < s.N; y++) for (let x = 0; x < s.N; x++) for (const [dx, dy] of [[1, 1], [1, -1]]) {
      const a = { x, y }, b = { x: x + dx, y: y + dy };
      if (!E.passable(s, a.x, a.y) || !E.passable(s, b.x, b.y)) continue;
      if (s.tiles[a.y][b.x] === 0 && s.tiles[b.y][a.x] === 0) continue;   // интересны только углы у препятствий
      const me = { ...s.players[0], x: a.x, y: a.y };
      const step = E.sanitize(s, me, { path: [b] }).path.length === 1;
      out.push([room, seed, a.x, a.y, b.x, b.y, step, E.canHit(s, a, "fists", b), E.canHit(s, a, "rifle", b)]);
    }
  }
  return out;
}

// Линия огня: для каждой пары проходимых клеток на 2..5 по Чебышёву (a по строкам, затем b по строкам) —
// бит los(a, b); 4 бита → hex-цифра. Ловит расхождения Брезенхема и запертых углов для лучей.
// Брезенхем без правила углов — только чтобы посчитать, сколько пар закрыто именно запертым углом
function wallsOnly(s, a, b) {
  let x0 = a.x, y0 = a.y;
  const dx = Math.abs(b.x - x0), dy = -Math.abs(b.y - y0), sx = x0 < b.x ? 1 : -1, sy = y0 < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 === b.x && y0 === b.y) return true;
    if (!(x0 === a.x && y0 === a.y) && s.tiles[y0][x0] === 1) return false;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function losBits() {
  const out = [];
  for (const room of ["a4", "a8"]) {
    // seed 0 и первые три seed, где правило угла реально закрывает лучи (стены по диагонали встречаются на ~¼ карт)
    const picked = [];
    for (let seed = 0; picked.length < 4; seed++) {
      const l = losMap(room, seed);
      if (seed === 0 || l.corner > 0) picked.push(l);
    }
    out.push(...picked);
  }
  return out;
}

function losMap(room, seed) {
  const s = E.createMatch(room, seed, players(room));
  const cells = [];
  for (let y = 0; y < s.N; y++) for (let x = 0; x < s.N; x++) if (E.passable(s, x, y)) cells.push({ x, y });
  let bits = "", blocked = 0, corner = 0;
  for (const a of cells) for (const b of cells) {
    const d = E.cheb(a, b);
    if (d < 2 || d > 5) continue;
    const v = E.los(s, a, b);
    bits += v ? "1" : "0";
    if (!v) blocked++;
    if (!v && wallsOnly(s, a, b)) corner++;
  }
  const pairs = bits.length;
  while (bits.length % 4) bits += "0";
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return { room, seed, pairs, blocked, corner, hex };
}

// «Сценарий»: случайные, но валидные планы (шаг/рывок/стоять, атака по ближнему или случайному, аптечка)
function scriptedPlans(s, r) {
  const plans = {};
  const alive = s.players.filter((p) => p.alive);
  for (const p of alive) {
    const roll = r();
    if (p.medkits > 0 && roll < 0.12) { plans[p.id] = { medkit: true }; continue; }
    if (roll < 0.18) continue;                       // AFK: плана нет
    const steps = [];
    let cur = { x: p.x, y: p.y };
    const want = roll < 0.45 ? 0 : roll < 0.8 ? 1 : 2;
    for (let k = 0; k < want; k++) {
      const opts = [];
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const nx = { x: cur.x + dx, y: cur.y + dy };
        if (E.passable(s, nx.x, nx.y) && !E.sealedCorner(s.tiles, cur, nx)) opts.push({ x: cur.x + dx, y: cur.y + dy });
      }
      if (!opts.length) break;
      cur = opts[Math.floor(r() * opts.length)];
      steps.push(cur);
    }
    let attack = null;
    const foes = alive.filter((q) => q.id !== p.id);
    if (steps.length < 2 && foes.length && r() < 0.85) {
      foes.sort((a, b) => E.cheb(a, p) - E.cheb(b, p) || a.id - b.id);
      attack = r() < 0.75 ? foes[0].id : foes[Math.floor(r() * foes.length)].id;
    }
    plans[p.id] = { path: steps, attack };
  }
  return plans;
}

function botPlans(s, afk) {
  const plans = {};
  for (const p of s.players) if (p.alive && !afk.has(p.id)) plans[p.id] = E.botPlan(s, p.id);
  return plans;
}

function match(room, seed, kind) {
  let s = E.createMatch(room, seed, players(room));
  const start = { tiles: tilesStr(s.tiles), loot: lootArr(s.loot), starts: s.players.map((p) => [p.id, p.x, p.y]) };
  const r = E.rng(seed ^ 0x51ed);
  const afk = new Set(kind === "bots+afk" ? [IDS[room][1], IDS[room][3]] : []);
  const turns = [];
  while (!s.finished) {
    const plans = kind === "script" ? scriptedPlans(s, r) : botPlans(s, afk);
    const t = s.turn;
    s = E.resolveTurn(s, plans);
    const lt = s.lastTurn;
    const ev = lt.events.map((e) => (e.target != null ? [e.t, e.who ?? null, e.target] : [e.t, e.who ?? null]));
    turns.push({
      turn: t,
      plans: Object.fromEntries(Object.entries(plans).map(([id, pl]) => [id, pl.medkit ? { medkit: true } : { path: pl.path.map((q) => [q.x, q.y]), attack: pl.attack ?? null }])),
      players: s.players.map(player),
      loot: s.loot.map((l) => l.id),
      stage: s.stage,
      next: s.turn,
      finished: s.finished,
      moves: Object.entries(lt.moves).map(([id, m]) => [+id, m.from.x, m.from.y, m.to.x, m.to.y]),
      shots: lt.shots.map((x) => [x.from, x.to, x.miss, x.fx, x.fy, x.tx, x.ty, x.dmg ?? null]),
      zoneHits: lt.zoneHits.map((z) => [z.who, z.dmg]),
      deaths: lt.deaths,
      picks: lt.picks.map((q) => [q.who, q.x, q.y, q.kind, q.type]),
      events: ev,
    });
  }
  return { room, seed, kind, ids: IDS[room], start, turns, places: s.places.map((q) => [q.id, q.place, q.shared]) };
}

const matches = [];
for (const room of ["a4", "a8"]) {
  for (const seed of [3, 42, 4294967295]) matches.push(match(room, seed, "bots"));
  for (const seed of [7, 2024]) matches.push(match(room, seed, "bots+afk"));
  for (const seed of [11, 99, 123456789]) matches.push(match(room, seed, "script"));
}

const config = {
  TURN_MS: E.TURN_MS, ZONE_EVERY: E.ZONE_EVERY, MAX_HP: E.MAX_HP, MEDKIT_HEAL: E.MEDKIT_HEAL, MEDKIT_MAX: E.MEDKIT_MAX, MAX_TURNS: E.MAX_TURNS,
  WEAPONS: Object.fromEntries(Object.entries(E.WEAPONS).map(([k, w]) => [k, [w.range, w.dmg, w.tier]])),
  ARMORS: Object.fromEntries(Object.entries(E.ARMORS).map(([k, a]) => [k, [a.ap, a.tier]])),
  ROOMS: Object.fromEntries(Object.entries(E.ROOMS).map(([k, r]) => [k, [r.players, r.size]])),
};
const json = JSON.stringify({ version: 2, config, maps: maps(), corners: corners(), los: losBits(), matches });
writeFileSync(OUT, json + "\n");
console.log(`arena-vectors.json: ${maps().length} карт, ${corners().length} углов, ${losBits().reduce((a, l) => a + l.pairs, 0)} лучей (${losBits().reduce((a, l) => a + l.corner, 0)} закрыты углом), ${matches.length} матчей, ${matches.reduce((a, m) => a + m.turns.length, 0)} ходов, ${(json.length / 1024).toFixed(0)} КБ`);

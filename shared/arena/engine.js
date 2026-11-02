// Арена — детерминированный движок матча (прототип).
// Чистые функции: одинаковые seed + планы игроков → одинаковый результат. Сервер в бою крутит этот же код.

export const TURN_MS = 10000;
export const ZONE_EVERY = 3;      // зона сжимается в конце ходов 4, 7, 10… (первый ход — спокойный, на лут)
export const shrinksAfter = (turn) => turn > 1 && (turn - 1) % ZONE_EVERY === 0;
export const turnsToShrink = (turn) => { let t = turn; while (!shrinksAfter(t)) t++; return t - turn; };
export const MAX_HP = 100;
export const MEDKIT_HEAL = 35;
export const MEDKIT_MAX = 2;
export const MAX_TURNS = 40;      // предохранитель, до него матч не доживает
export const NANO = 1e9;

export const ROOMS = {
  a4: { id: "a4", name: "Арена 4", players: 4, size: 9, stake: 0.1, feePct: 10, prizes: [0.36], fillSec: 180 },
  a8: { id: "a8", name: "Арена 8", players: 8, size: 11, stake: 0.1, feePct: 10, prizes: [0.5, 0.22], fillSec: 180 },
};

export const WEAPONS = {
  fists: { name: "Кулаки", short: "Кулаки", range: 1, dmg: 12, tier: 0 },
  knife: { name: "Нож", short: "Нож", range: 1, dmg: 34, tier: 1 },
  pistol: { name: "Пистолет", short: "Пистолет", range: 3, dmg: 20, tier: 2 },
  rifle: { name: "Винтовка", short: "Винтовка", range: 5, dmg: 26, tier: 3 },
};
export const ARMORS = {
  light: { name: "Лёгкая броня", ap: 30, tier: 1 },
  heavy: { name: "Тяжёлая броня", ap: 60, tier: 2 },
};

/** mulberry32 — маленький быстрый PRNG, достаточен для генерации карты (бой без случайности) */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const cheb = (a, b) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
const key = (x, y) => y * 64 + x;
/** Запертый угол: шаг/удар по диагонали между двумя препятствиями (стена или укрытие) по бокам — нельзя */
export const sealedCorner = (tiles, a, b) => a.x !== b.x && a.y !== b.y && tiles[a.y][b.x] !== 0 && tiles[b.y][a.x] !== 0;

/** Поворот на 90° вокруг центра: карта симметрична, у всех стартов одинаковые условия */
function orbit(N, x, y) {
  const pts = [];
  let cx = x, cy = y;
  for (let i = 0; i < 4; i++) {
    if (!pts.some((p) => p.x === cx && p.y === cy)) pts.push({ x: cx, y: cy });
    [cx, cy] = [N - 1 - cy, cx];
  }
  return pts;
}

export function spawnsFor(room) {
  const N = room.size, c = (N - 1) / 2;
  const corners = orbit(N, 1, 1);
  if (room.players === 4) return corners;
  const mids = orbit(N, c, 1);
  // чередуем угол/середину — соседи по кругу
  const out = [];
  for (let i = 0; i < 4; i++) out.push(corners[i], mids[i]);
  return out;
}

export function zoneBox(N, stage) {
  if (stage > maxStage(N)) return { x0: 1, y0: 1, x1: 0, y1: 0, closed: true };   // зона закрылась — урон всем
  return { x0: stage, y0: stage, x1: N - 1 - stage, y1: N - 1 - stage };
}
export const inBox = (b, p) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1;
/** Последняя стадия — 3×3 в центре (на 1 клетку все не влезут: столкновения отменяют ход). Дальше урон растёт каждый ход */
export const maxStage = (N) => (N - 3) / 2;
export const zoneDmg = (stage, N, turn) => {
  const base = 6 + 6 * stage;                                    // 6 · 12 · 18 · 24 …
  const over = stage > maxStage(N) ? Math.max(0, turn - 2 - (maxStage(N) + 1) * ZONE_EVERY) : 0;
  return base + 8 * over;                                        // после закрытия +8 за ход
};

/** Лут по стороне поля: [вид, тип, кольцо от, до] — каждая строка = орбита из 4 предметов (+ винтовка в центре) */
export const LOOT = {
  9: [["weapon", "knife", 2, 3], ["weapon", "pistol", 1, 2], ["armor", "light", 2, 3], ["medkit", "medkit", 1, 3], ["armor", "heavy", 1, 1]],
  11: [
    ["weapon", "knife", 3, 4], ["weapon", "knife", 2, 4], ["weapon", "pistol", 2, 3], ["weapon", "pistol", 1, 3],
    ["armor", "light", 2, 4], ["armor", "heavy", 1, 2], ["medkit", "medkit", 2, 4], ["medkit", "medkit", 1, 3],
  ],
};

/** Генерация карты: стены (непроходимы, режут линию огня) и укрытия (−50% урона от выстрелов издалека) */
function genMap(room, seed) {
  const N = room.size, c = (N - 1) / 2;
  const spawns = spawnsFor(room);
  for (let attempt = 0; attempt < 50; attempt++) {
    const r = rng(seed + attempt * 7919);
    const tiles = Array.from({ length: N }, () => Array(N).fill(0)); // 0 пол, 1 стена, 2 укрытие
    const reserved = new Set();
    for (const s of spawns) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) reserved.add(key(s.x + dx, s.y + dy));
    reserved.add(key(c, c));
    // Плотность — к краям: центр 3×3 пустой, в кольце 5×5 только одна орбита укрытий (4 клетки),
    // стены — только в среднем кольце и по краям (dc ≥ 3). Итого ~20% клеток: 9×9 — 16, 11×11 — 24.
    const ring = (x, y) => Math.max(Math.abs(x - c), Math.abs(y - c));
    const orbitsIn = (dmin, dmax) => {           // представители орбит по 4 клетки в кольцах [dmin, dmax]
      const out = [], seenO = new Set();
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const d = ring(x, y);
        if (d < dmin || d > dmax || seenO.has(key(x, y))) continue;
        const o = orbit(N, x, y);
        for (const p of o) seenO.add(key(p.x, p.y));
        if (o.length === 4) out.push(o);
      }
      return out;
    };
    const place = (n, v, dmin, dmax) => {
      const pool = orbitsIn(dmin, dmax);
      while (n > 0) {
        const free = pool.filter((o) => o.every((p) => tiles[p.y][p.x] === 0 && !reserved.has(key(p.x, p.y))));
        if (!free.length) return false;
        for (const p of free[Math.floor(r() * free.length)]) tiles[p.y][p.x] = v;
        n--;
      }
      return true;
    };
    const big = N === 11;
    if (!place(big ? 3 : 2, 1, 3, c)) continue;   // стены: 12 / 8 клеток
    if (!place(big ? 2 : 1, 2, 3, c)) continue;   // укрытия снаружи: 8 / 4
    if (!place(1, 2, 2, 2)) continue;             // укрытия в кольце финальной 5×5: 4
    // связность: из каждого старта достижим каждый пол (ходами по правилам: без запертых углов)
    const seen = new Set([key(spawns[0].x, spawns[0].y)]);
    const q = [spawns[0]];
    while (q.length) {
      const p = q.pop();
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const x = p.x + dx, y = p.y + dy;
        if (x < 0 || y < 0 || x >= N || y >= N || tiles[y][x] === 1 || seen.has(key(x, y)) || sealedCorner(tiles, p, { x, y })) continue;
        seen.add(key(x, y));
        q.push({ x, y });
      }
    }
    let floor = 0;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (tiles[y][x] !== 1) floor++;
    if (floor !== seen.size) continue;

    // лут: орбиты по 4 + центр; сильнее — ближе к центру. Состав всегда полный (LOOT[N]).
    const loot = [];
    const taken = new Set(reserved);
    const freeOrbit = (o) => o.length === 4 && o.every((p) => tiles[p.y][p.x] !== 1 && !taken.has(key(p.x, p.y)));
    const putLoot = (kind, type, dmin, dmax) => {
      const put = (o) => { for (const p of o) { taken.add(key(p.x, p.y)); loot.push({ id: loot.length, kind, type, x: p.x, y: p.y }); } };
      for (let guard = 0; guard < 400; guard++) {
        const x = Math.floor(r() * N), y = Math.floor(r() * N);
        const dc = Math.max(Math.abs(x - c), Math.abs(y - c));
        if (dc < dmin || dc > dmax) continue;
        const o = orbit(N, x, y);
        if (!freeOrbit(o)) continue;
        put(o);
        return true;
      }
      // запасной путь (детерминированный): свободная орбита в кольцах [dmin, dmax], иначе — в ближайших к ним
      const all = orbitsIn(1, c).filter(freeOrbit);
      for (let w = 0; w <= c; w++) {
        const cands = all.filter((o) => { const d = ring(o[0].x, o[0].y); return d >= dmin - w && d <= dmax + w; });
        if (cands.length) { put(cands[Math.floor(r() * cands.length)]); return true; }
      }
      return false;
    };
    loot.push({ id: 0, kind: "weapon", type: "rifle", x: c, y: c });
    taken.add(key(c, c));
    if (!LOOT[N].every(([kind, type, dmin, dmax]) => putLoot(kind, type, dmin, dmax))) continue;
    return { tiles, loot, spawns };
  }
  throw new Error("map gen failed");
}

/** Места в комнате по seed (RULES §3): seatOrder(seed, n)[i] — номер места (id в движке) игрока, вошедшего i-м.
 *  Фишер–Йетс на rng(seed ^ 0x85ebca6b) — поток отдельный от карты и стартов. */
export function seatOrder(seed, n) {
  const r = rng(seed ^ 0x85ebca6b);
  const s = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [s[i], s[j]] = [s[j], s[i]]; }
  return s;
}

export const BOT_NAMES = ["kira_ton", "volt", "shade", "mira_x", "ox", "zed_77", "nova", "rook", "lynx", "echo"];

/** Новый матч. players: [{id, name, bot}] в порядке входа; места на карте — по seed */
export function createMatch(roomId, seed, players) {
  const room = ROOMS[roomId];
  const { tiles, loot, spawns } = genMap(room, seed);
  const r = rng(seed ^ 0x9e3779b9);
  const order = players.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
  const ps = players.map((p, i) => ({
    id: p.id, name: p.name, bot: !!p.bot, slot: i,
    x: spawns[order[i]].x, y: spawns[order[i]].y,
    hp: MAX_HP, ap: 0, armor: null, weapon: "fists", medkits: 0,
    alive: true, deathTurn: null, hpBefore: MAX_HP, dealt: 0, kills: 0,
  }));
  return { roomId, seed, N: room.size, tiles, loot, players: ps, turn: 1, stage: 0, finished: false, events: [], lastTurn: null, places: null };
}

export const passable = (s, x, y) => x >= 0 && y >= 0 && x < s.N && y < s.N && s.tiles[y][x] !== 1;

/** Линия огня: стены между стрелком и целью (Брезенхэм, без концов) */
export function los(s, a, b) {
  let x0 = a.x, y0 = a.y;
  const dx = Math.abs(b.x - x0), dy = -Math.abs(b.y - y0), sx = x0 < b.x ? 1 : -1, sy = y0 < b.y ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x0 === b.x && y0 === b.y) return true;
    if (!(x0 === a.x && y0 === a.y) && s.tiles[y0][x0] === 1) return false;
    const e2 = 2 * err;
    let nx = x0, ny = y0;
    if (e2 >= dy) { err += dy; nx += sx; }
    if (e2 <= dx) { err += dx; ny += sy; }
    // диагональный шаг луча между двумя ортогонально соседними стенами — запертый угол, выстрел не проходит
    if (nx !== x0 && ny !== y0 && s.tiles[y0][nx] === 1 && s.tiles[ny][x0] === 1) return false;
    x0 = nx; y0 = ny;
  }
}

export function canHit(s, from, weapon, to) {
  const d = cheb(from, to);
  return d >= 1 && d <= WEAPONS[weapon].range && (d === 1 ? !sealedCorner(s.tiles, from, to) : los(s, from, to));
}

/** Урон с учётом укрытия и брони (без случайности) */
export function rawDamage(s, from, weapon, target) {
  const d = WEAPONS[weapon].dmg;
  return cheb(from, target) >= 2 && s.tiles[target.y][target.x] === 2 ? Math.floor(d / 2) : d;
}
export function damageOf(s, from, weapon, target) {
  const d = rawDamage(s, from, weapon, target);
  const absorbed = Math.min(target.ap, Math.floor(d / 2));
  return { hp: d - absorbed, ap: absorbed };
}

/** Проверка плана: что сервер примет. Неверный план = «стоять» */
export function sanitize(s, p, plan) {
  const out = { path: [], attack: null, medkit: false };
  if (!plan || !p.alive) return out;
  if (plan.medkit) { if (p.medkits > 0) out.medkit = true; return out; }
  let cur = { x: p.x, y: p.y };
  for (const st of (plan.path || []).slice(0, 2)) {
    if (cheb(cur, st) !== 1 || !passable(s, st.x, st.y) || sealedCorner(s.tiles, cur, st)) break;
    out.path.push({ x: st.x, y: st.y });
    cur = st;
  }
  if (out.path.length < 2 && plan.attack != null) {
    const t = s.players.find((q) => q.id === plan.attack && q.alive && q.id !== p.id);
    if (t) out.attack = t.id;
  }
  return out;
}

/**
 * Разрешение хода. Порядок фиксирован:
 * 1 аптечки → 2 движение (2 подшага, конфликты отменяются) → 3 подбор лута →
 * 4 атаки одновременно по позициям после движения → 5 урон зоны → 6 смерти → 7 сжатие зоны
 */
export function resolveTurn(prev, rawPlans) {
  const s = structuredClone(prev);
  s.lastTurn = { turn: s.turn, moves: {}, shots: [], zoneHits: [], deaths: [], picks: [] };
  const ev = [];
  const alive = s.players.filter((p) => p.alive);
  const plans = {};
  for (const p of alive) { plans[p.id] = sanitize(s, p, rawPlans[p.id]); p.hpBefore = p.hp; }
  const name = (p) => (p.bot ? "@" + p.name : "Вы");

  // 1. аптечки
  for (const p of alive) if (plans[p.id].medkit) {
    const h = Math.min(MEDKIT_HEAL, MAX_HP - p.hp);
    p.medkits--; p.hp += h;
    ev.push({ t: "heal", who: p.id, text: `${name(p)}: аптечка +${h}` });
  }

  // 2. движение
  const from = {};
  for (const p of alive) from[p.id] = { x: p.x, y: p.y };
  const blocked = new Set();
  for (let k = 0; k < 2; k++) {
    const want = {};
    for (const p of alive) {
      const st = !blocked.has(p.id) && plans[p.id].path[k];
      want[p.id] = st ? { x: st.x, y: st.y } : { x: p.x, y: p.y };
    }
    for (let guard = 0; guard < 20; guard++) {
      let changed = false;
      const byCell = new Map();
      for (const p of alive) { const kk = key(want[p.id].x, want[p.id].y); byCell.set(kk, [...(byCell.get(kk) || []), p]); }
      for (const [, ps] of byCell) if (ps.length > 1) for (const p of ps) {
        if (want[p.id].x !== p.x || want[p.id].y !== p.y) { want[p.id] = { x: p.x, y: p.y }; blocked.add(p.id); changed = true; }
      }
      for (const a of alive) for (const b of alive) if (a.id < b.id) {
        if (want[a.id].x === b.x && want[a.id].y === b.y && want[b.id].x === a.x && want[b.id].y === a.y && (a.x !== b.x || a.y !== b.y)) {
          want[a.id] = { x: a.x, y: a.y }; want[b.id] = { x: b.x, y: b.y }; blocked.add(a.id); blocked.add(b.id); changed = true;
        }
      }
      if (!changed) break;
    }
    for (const p of alive) { p.x = want[p.id].x; p.y = want[p.id].y; }
  }
  for (const p of alive) {
    s.lastTurn.moves[p.id] = { from: from[p.id], to: { x: p.x, y: p.y } };
    p.bumps = blocked.has(p.id) && plans[p.id].path.length ? (p.bumps || 0) + 1 : 0;
    if (blocked.has(p.id) && plans[p.id].path.length) ev.push({ t: "bump", who: p.id, text: `${name(p)}: путь перекрыт` });
  }

  // 3. лут
  for (const p of [...alive].sort((a, b) => a.id - b.id)) {
    const i = s.loot.findIndex((l) => l.x === p.x && l.y === p.y);
    if (i < 0) continue;
    const l = s.loot[i];
    if (l.kind === "medkit") {
      if (p.medkits >= MEDKIT_MAX) continue;
      p.medkits++;
      ev.push({ t: "pick", who: p.id, text: `${name(p)}: подобрал аптечку` });
    } else if (l.kind === "weapon") {
      if (WEAPONS[l.type].tier <= WEAPONS[p.weapon].tier) continue;
      p.weapon = l.type;
      ev.push({ t: "pick", who: p.id, text: `${name(p)}: ${WEAPONS[l.type].name.toLowerCase()}` });
    } else {
      if (ARMORS[l.type].ap <= p.ap) continue;
      p.armor = l.type; p.ap = ARMORS[l.type].ap;
      ev.push({ t: "pick", who: p.id, text: `${name(p)}: ${ARMORS[l.type].name.toLowerCase()}` });
    }
    s.lastTurn.picks.push({ who: p.id, x: l.x, y: l.y, kind: l.kind, type: l.type });
    s.loot.splice(i, 1);
  }

  // 4. атаки — по снимку после движения, урон применяется разом
  const dmg = {};
  for (const a of [...alive].sort((x, y) => x.id - y.id)) {
    const tid = plans[a.id].attack;
    if (tid == null) continue;
    const t = s.players.find((q) => q.id === tid);
    if (!t || !alive.includes(t)) continue;
    if (!canHit(s, a, a.weapon, t)) {
      s.lastTurn.shots.push({ from: a.id, to: t.id, miss: true, fx: a.x, fy: a.y, tx: t.x, ty: t.y });
      ev.push({ t: "miss", who: a.id, text: `${name(a)} → ${name(t)}: мимо (вне досягаемости)` });
      continue;
    }
    dmg[t.id] = dmg[t.id] || { hp: 0, ap: 0, by: [] };
    // броня снимается по порядку id атакующих: каждый удар — не больше половины в броню, пока она есть
    const raw = rawDamage(s, a, a.weapon, t);
    const abs = Math.min(t.ap - dmg[t.id].ap, Math.floor(raw / 2));
    dmg[t.id].hp += raw - abs; dmg[t.id].ap += abs; dmg[t.id].by.push(a.id);
    a.dealt += raw;
    s.lastTurn.shots.push({ from: a.id, to: t.id, miss: false, fx: a.x, fy: a.y, tx: t.x, ty: t.y, dmg: raw });
    ev.push({ t: "hit", who: a.id, target: t.id, text: `${name(a)} → ${name(t)}: −${raw}` });
  }
  for (const id in dmg) { const t = s.players.find((q) => q.id === +id); t.hp -= dmg[id].hp; t.ap -= dmg[id].ap; if (t.ap <= 0) { t.ap = 0; t.armor = null; } }

  // 5. зона
  const box = zoneBox(s.N, s.stage);
  for (const p of alive) if (!inBox(box, p)) {
    const z = zoneDmg(s.stage, s.N, s.turn);
    p.hp -= z;
    s.lastTurn.zoneHits.push({ who: p.id, dmg: z });
    ev.push({ t: "zone", who: p.id, text: `${name(p)}: зона −${z}` });
  }

  // 6. смерти
  for (const p of alive) if (p.hp <= 0) {
    p.hp = 0; p.alive = false; p.deathTurn = s.turn;
    s.lastTurn.deaths.push(p.id);
    const killers = dmg[p.id]?.by || [];
    for (const k of killers) { const kp = s.players.find((q) => q.id === k); if (kp) kp.kills++; }
    ev.push({ t: "death", who: p.id, text: `${name(p)} выбыл${killers.length ? "" : " (зона)"}` });
  }

  // 7. зона
  const left = s.players.filter((p) => p.alive);
  if (shrinksAfter(s.turn) && s.stage <= maxStage(s.N)) {
    s.stage++;
    ev.push({ t: "zone-shrink", text: s.stage > maxStage(s.N) ? "Зона закрылась: урон всем" : `Зона сузилась: ${s.N - 2 * s.stage}×${s.N - 2 * s.stage}` });
  }
  s.lastTurn.events = ev;                                                     // все события хода
  s.events = [...ev.map((e) => ({ ...e, turn: s.turn })), ...prev.events].slice(0, 40);   // лента для клиента
  if (left.length <= 1 || s.turn >= MAX_TURNS) { s.finished = true; s.places = placements(s); }
  else s.turn++;
  return s;
}

/** Места: живые — по HP (обычно один), выбывшие — по ходу смерти, затем по HP до хода. Равные делят место */
export function placements(s) {
  const room = ROOMS[s.roomId];
  const rank = (p) => [p.alive ? 1 : 0, p.alive ? p.hp : p.deathTurn, p.alive ? p.ap : p.hpBefore];
  const sorted = [...s.players].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    for (let i = 0; i < 3; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i];
    return 0;
  });
  const out = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && rank(sorted[j + 1]).join() === rank(sorted[i]).join()) j++;
    // делим призы мест i..j поровну, в нано-TON, остаток (пыль) — в журнал комиссии
    let pot = 0;
    for (let k = i; k <= j; k++) pot += Math.round((room.prizes[k] || 0) * NANO);
    const each = Math.floor(pot / (j - i + 1));
    for (let k = i; k <= j; k++) out.push({ id: sorted[k].id, place: i + 1, shared: j > i, prizeNano: each });
    i = j + 1;
  }
  return out;
}

// ───────────────────────── боты ─────────────────────────
const process_aggr = (s, id) => (globalThis.__AGGR__ ? globalThis.__AGGR__(id) : id % 2 === 0);

const DIRS = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];

function bfs(s, start, occupied) {
  const dist = new Map([[key(start.x, start.y), 0]]);
  const prev = new Map();
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const p = q[h];
    for (const [dx, dy] of DIRS) {
      const x = p.x + dx, y = p.y + dy, k = key(x, y);
      if (!passable(s, x, y) || dist.has(k) || occupied.has(k) || sealedCorner(s.tiles, p, { x, y })) continue;
      dist.set(k, dist.get(key(p.x, p.y)) + 1);
      prev.set(k, p);
      q.push({ x, y });
    }
  }
  const pathTo = (t) => {
    const path = [];
    let cur = t;
    while (cur && !(cur.x === start.x && cur.y === start.y)) { path.unshift(cur); cur = prev.get(key(cur.x, cur.y)); }
    return path;
  };
  return { dist, pathTo };
}

/** Простой бот: оценивает «стоять / шаг+атака / рывок / аптечка» и берёт лучший вариант */
export function botPlan(s, id) {
  const me = s.players.find((p) => p.id === id);
  const foes = s.players.filter((p) => p.alive && p.id !== id);
  const aggressive = process_aggr(s, id);
  const shrinkSoon = shrinksAfter(s.turn);
  const safe = zoneBox(s.N, Math.min(maxStage(s.N), s.stage + (shrinkSoon ? 1 : 0)));
  const noise = rng((s.seed * 131 + s.turn * 977 + id * 7) >>> 0);
  // равные цели — не «первый в списке», а детерминированная лотерея на этот ход
  const tb = {}; for (const f of foes) tb[f.id] = noise() * 3;
  const tieBreak = (fid) => tb[fid];
  const occupied = new Set(foes.map((f) => key(f.x, f.y)));
  const { dist, pathTo } = bfs(s, me, occupied);
  const threat = (pos) => foes.reduce((acc, f) => acc + (canHit(s, f, f.weapon, pos) || cheb(f, pos) <= WEAPONS[f.weapon].range + 1 && cheb(f, pos) <= 2 ? WEAPONS[f.weapon].dmg : 0), 0);
  const lootScore = (pos) => {
    const l = s.loot.find((q) => q.x === pos.x && q.y === pos.y);
    if (!l) return 0;
    if (l.kind === "weapon") return WEAPONS[l.type].tier > WEAPONS[me.weapon].tier ? 18 + 10 * WEAPONS[l.type].tier : 0;
    if (l.kind === "armor") return ARMORS[l.type].ap > me.ap ? 14 + ARMORS[l.type].ap / 4 : 0;
    return me.medkits < MEDKIT_MAX ? 12 : 0;
  };
  const near = (pos) => foes.reduce((m, f) => Math.min(m, cheb(f, pos)), 99);
  const zonePen = (pos) => (inBox(safe, pos) ? 0 : 40 + 6 * Math.max(safe.x0 - pos.x, pos.x - safe.x1, safe.y0 - pos.y, pos.y - safe.y1));
  // ближайший полезный лут и центр зоны как дальние цели
  let goal = null, goalVal = 0;
  for (const l of s.loot) {
    const d = dist.get(key(l.x, l.y));
    if (d == null) continue;
    const v = lootScore(l) - d * 4;
    if (v > goalVal) { goalVal = v; goal = l; }
  }
  const c = (s.N - 1) / 2;
  const options = [];
  const cands = [{ path: [], pos: { x: me.x, y: me.y } }];
  for (const [dx, dy] of DIRS) {
    const p1 = { x: me.x + dx, y: me.y + dy };
    if (!dist.has(key(p1.x, p1.y)) || dist.get(key(p1.x, p1.y)) !== 1) continue;
    cands.push({ path: [p1], pos: p1 });
    for (const [ex, ey] of DIRS) {
      const p2 = { x: p1.x + ex, y: p1.y + ey };
      if (!passable(s, p2.x, p2.y) || occupied.has(key(p2.x, p2.y)) || cheb(p2, me) < 2 || sealedCorner(s.tiles, p1, p2)) continue;
      cands.push({ path: [p1, p2], pos: p2, dash: true });
    }
  }
  for (const cd of cands) {
    let best = null, bestV = 0;
    if (!cd.dash) for (const f of foes) if (canHit(s, cd.pos, me.weapon, f)) {
      const d = damageOf(s, cd.pos, me.weapon, f);
      const v = d.hp + d.ap * 0.5 + (f.hp <= d.hp ? 40 : 0) + (100 - f.hp) * 0.1 + tieBreak(f.id);
      if (v > bestV) { bestV = v; best = f.id; }
    }
    let v = bestV * (aggressive ? 1.2 : 0.9);
    v -= threat(cd.pos) * (aggressive ? 0.35 : 0.7) * (me.hp < 40 ? 1.6 : 1) / (1 + s.stage * 0.5);
    v -= zonePen(cd.pos);
    v += lootScore(cd.pos);
    if (s.tiles[cd.pos.y][cd.pos.x] === 2) v += 4;
    // клетку, куда может шагнуть и соперник, скорее всего отменит столкновение — штраф растёт с повторами
    const rivals = cd.path.length ? foes.filter((f) => cheb(f, cd.pos) <= (cd.dash ? 2 : 1)).length : 0;
    if (rivals) v -= rivals * (10 + 6 * (me.bumps || 0));
    if (goal) { const dg = Math.max(Math.abs(goal.x - cd.pos.x), Math.abs(goal.y - cd.pos.y)); v -= dg * 2.5; }
    if (!best) v -= near(cd.pos) * (aggressive ? 2 : 0.8) * (1 + s.stage);
    v -= Math.max(Math.abs(cd.pos.x - c), Math.abs(cd.pos.y - c)) * (s.stage >= 2 ? 3 : 0.5);
    options.push({ v: v + noise() * 6, plan: { path: cd.path, attack: best } });
  }
  if (me.medkits > 0 && me.hp <= 60) {
    const v = Math.min(MEDKIT_HEAL, MAX_HP - me.hp) * (me.hp < 35 ? 1.4 : 0.8) - threat(me) * 0.5 - zonePen(me) - 6;
    options.push({ v, plan: { medkit: true } });
  }
  options.sort((a, b) => b.v - a.v);
  return options[0].plan;
}

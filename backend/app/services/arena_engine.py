"""«Арена»: игровой движок на сервере — точный порт эталонного JS-движка shared/arena/engine.js.

Чистые функции, без БД и I/O. Матч целиком определяется seed комнаты, порядком входа игроков и журналом планов:
seed → карта, лут, стартовые места; планы → ходы. В бою случайности нет (RNG только для карты и стартов).

Сервер — единственный источник истины, поэтому проверка планов строгая (`validate_plan`): невалидный план
отклоняется с кодом ошибки, а не «обрезается», как в прототипе. Нет плана — игрок стоит (AFK).

Арифметика целочисленная: `>>>`/`Math.imul` из JS — маски 32 бита, `Math.floor(d / 2)` — `//`.
Генератор карты (mulberry32) отдаёт те же float, что и JS, — `int(r() * n)` совпадает с `Math.floor`.
Правило меняется только вместе с engine.js; общие векторы shared/arena-vectors.json (их пишет
shared/arena/gen-vectors.mjs) проверяет tests/test_arena_engine.py.

Призы здесь не считаются: движок отдаёт места (`placements`), деньги делит `arena_escrow.settle`.
"""

from __future__ import annotations

import copy
import json
from dataclasses import asdict, dataclass, field
from typing import Any, Mapping, Optional

from app.services.arena_config import room_type as _room_type

M32 = 0xFFFFFFFF

TURN_MS = 10_000
ZONE_EVERY = 3  # зона сжимается после ходов 4, 7, 10…
MAX_HP = 100
MEDKIT_HEAL = 35
MEDKIT_MAX = 2
MAX_TURNS = 40  # предохранитель

FLOOR, WALL, COVER = 0, 1, 2


@dataclass(frozen=True)
class Weapon:
    range: int
    dmg: int
    tier: int


@dataclass(frozen=True)
class Armor:
    ap: int
    tier: int


WEAPONS: dict[str, Weapon] = {
    "fists": Weapon(1, 12, 0),
    "knife": Weapon(1, 34, 1),
    "pistol": Weapon(3, 20, 2),
    "rifle": Weapon(5, 26, 3),
}
ARMORS: dict[str, Armor] = {"light": Armor(30, 1), "heavy": Armor(60, 2)}

# состав карты по стороне поля: (орбиты стен, орбиты укрытий снаружи) и лут (вид, тип, кольцо от, до)
_OBSTACLES = {9: (2, 1), 11: (3, 2)}
_LOOT = {
    9: (
        ("weapon", "knife", 2, 3),
        ("weapon", "pistol", 1, 2),
        ("armor", "light", 2, 3),
        ("medkit", "medkit", 1, 3),
        ("armor", "heavy", 1, 1),
    ),
    11: (
        ("weapon", "knife", 3, 4),
        ("weapon", "knife", 2, 4),
        ("weapon", "pistol", 2, 3),
        ("weapon", "pistol", 1, 3),
        ("armor", "light", 2, 4),
        ("armor", "heavy", 1, 2),
        ("medkit", "medkit", 2, 4),
        ("medkit", "medkit", 1, 3),
    ),
}


def shrinks_after(turn: int) -> bool:
    return turn > 1 and (turn - 1) % ZONE_EVERY == 0


def max_stage(n: int) -> int:
    """Последняя стадия — 3×3 в центре; дальше зона закрыта."""
    return (n - 3) // 2


def zone_box(n: int, stage: int) -> tuple[int, int, int, int]:
    """(x0, y0, x1, y1) включительно; закрытая зона — пустой прямоугольник (урон всем)."""
    if stage > max_stage(n):
        return (1, 1, 0, 0)
    return (stage, stage, n - 1 - stage, n - 1 - stage)


def in_box(box: tuple[int, int, int, int], x: int, y: int) -> bool:
    return box[0] <= x <= box[2] and box[1] <= y <= box[3]


def zone_damage(stage: int, n: int, turn: int) -> int:
    base = 6 + 6 * stage
    ms = max_stage(n)
    over = max(0, turn - 2 - (ms + 1) * ZONE_EVERY) if stage > ms else 0
    return base + 8 * over


class Mulberry32:
    """mulberry32 из engine.js; числа — те же float, что в JS."""

    def __init__(self, seed: int):
        self.a = seed & M32

    def __call__(self) -> float:
        self.a = (self.a + 0x6D2B79F5) & M32
        t = self.a
        t = ((t ^ (t >> 15)) * (t | 1)) & M32
        t ^= (t + (((t ^ (t >> 7)) * (t | 61)) & M32)) & M32
        return ((t ^ (t >> 14)) & M32) / 4294967296


def cheb(ax: int, ay: int, bx: int, by: int) -> int:
    return max(abs(ax - bx), abs(ay - by))


def sealed_corner(tiles: Any, ax: int, ay: int, bx: int, by: int) -> bool:
    """Запертый угол: диагональ между двумя препятствиями (стена или укрытие) по бокам — ни шага, ни удара."""
    return ax != bx and ay != by and tiles[ay][bx] != FLOOR and tiles[by][ax] != FLOOR


def _orbit(n: int, x: int, y: int) -> list[tuple[int, int]]:
    """Орбита клетки при повороте на 90° вокруг центра (1 или 4 клетки при нечётном n)."""
    pts: list[tuple[int, int]] = []
    cx, cy = x, y
    for _ in range(4):
        if (cx, cy) not in pts:
            pts.append((cx, cy))
        cx, cy = n - 1 - cy, cx
    return pts


def spawns_for(seats: int, n: int) -> list[tuple[int, int]]:
    c = (n - 1) // 2
    corners = _orbit(n, 1, 1)
    if seats == 4:
        return corners
    if seats != 8:
        raise ValueError(f"нет спавнов на {seats} мест")
    mids = _orbit(n, c, 1)
    out: list[tuple[int, int]] = []
    for i in range(4):
        out += [corners[i], mids[i]]
    return out


@dataclass(frozen=True)
class Loot:
    id: int
    kind: str  # weapon | armor | medkit
    type: str
    x: int
    y: int


@dataclass(frozen=True)
class GameMap:
    tiles: tuple[tuple[int, ...], ...]  # [y][x]: 0 пол, 1 стена, 2 укрытие
    loot: tuple[Loot, ...]
    spawns: tuple[tuple[int, int], ...]


class MapGenError(RuntimeError):
    pass


def _check_seed(seed: int) -> int:
    if isinstance(seed, bool) or not isinstance(seed, int) or not 0 <= seed <= M32:
        raise ValueError("seed — целое 0…2^32−1")
    return seed


def generate_map(room_code: str, seed: int) -> GameMap:
    """Карта по seed: стены и укрытия орбитами по 4 (симметрия 90°), связность, лут к центру сильнее."""
    rt = _room_type(room_code)
    _check_seed(seed)
    n = rt.board
    c = (n - 1) // 2
    spawns = spawns_for(rt.seats, n)
    walls, covers = _OBSTACLES[n]

    def ring(x: int, y: int) -> int:
        return max(abs(x - c), abs(y - c))

    for attempt in range(50):
        r = Mulberry32(seed + attempt * 7919)
        tiles = [[FLOOR] * n for _ in range(n)]
        reserved = {(sx + dx, sy + dy) for sx, sy in spawns for dx in (-1, 0, 1) for dy in (-1, 0, 1)}
        reserved.add((c, c))

        def orbits_in(dmin: int, dmax: int) -> list[list[tuple[int, int]]]:
            out, seen = [], set()
            for y in range(n):
                for x in range(n):
                    d = ring(x, y)
                    if d < dmin or d > dmax or (x, y) in seen:
                        continue
                    o = _orbit(n, x, y)
                    seen.update(o)
                    if len(o) == 4:
                        out.append(o)
            return out

        def place(count: int, value: int, dmin: int, dmax: int) -> bool:
            pool = orbits_in(dmin, dmax)
            while count > 0:
                free = [o for o in pool if all(tiles[py][px] == FLOOR and (px, py) not in reserved for px, py in o)]
                if not free:
                    return False
                for px, py in free[int(r() * len(free))]:
                    tiles[py][px] = value
                count -= 1
            return True

        if not place(walls, WALL, 3, c):
            continue
        if not place(covers, COVER, 3, c):
            continue
        if not place(1, COVER, 2, 2):  # укрытия в кольце финальной 5×5
            continue
        # связность: из первого старта достижима каждая не-стена (8 соседей, без запертых углов)
        seen = {spawns[0]}
        stack = [spawns[0]]
        while stack:
            px, py = stack.pop()
            for dx in (-1, 0, 1):
                for dy in (-1, 0, 1):
                    x, y = px + dx, py + dy
                    if (
                        0 <= x < n
                        and 0 <= y < n
                        and tiles[y][x] != WALL
                        and (x, y) not in seen
                        and not sealed_corner(tiles, px, py, x, y)
                    ):
                        seen.add((x, y))
                        stack.append((x, y))
        if sum(1 for row in tiles for t in row if t != WALL) != len(seen):
            continue

        loot: list[Loot] = [Loot(0, "weapon", "rifle", c, c)]
        taken = set(reserved)
        taken.add((c, c))

        def free_orbit(o: list[tuple[int, int]]) -> bool:
            return len(o) == 4 and all(tiles[py][px] != WALL and (px, py) not in taken for px, py in o)

        def put_loot(kind: str, typ: str, dmin: int, dmax: int) -> bool:
            def put(o: list[tuple[int, int]]) -> None:
                for px, py in o:
                    taken.add((px, py))
                    loot.append(Loot(len(loot), kind, typ, px, py))

            for _ in range(400):
                x, y = int(r() * n), int(r() * n)
                if not dmin <= ring(x, y) <= dmax:
                    continue
                o = _orbit(n, x, y)
                if not free_orbit(o):
                    continue
                put(o)
                return True
            # запасной путь (детерминированный): свободная орбита в кольцах [dmin, dmax], иначе — в ближайших
            free = [o for o in orbits_in(1, c) if free_orbit(o)]
            for w in range(c + 1):
                cands = [o for o in free if dmin - w <= ring(*o[0]) <= dmax + w]
                if cands:
                    put(cands[int(r() * len(cands))])
                    return True
            return False

        # состав лута всегда полный; не влез — другая попытка карты
        if not all(put_loot(*row) for row in _LOOT[n]):
            continue
        return GameMap(tuple(tuple(row) for row in tiles), tuple(loot), tuple(spawns))
    raise MapGenError("map gen failed")


@dataclass
class Player:
    id: int
    slot: int  # порядок входа
    x: int
    y: int
    hp: int = MAX_HP
    ap: int = 0
    armor: Optional[str] = None
    weapon: str = "fists"
    medkits: int = 0
    alive: bool = True
    death_turn: Optional[int] = None
    hp_before: int = MAX_HP  # HP в начале последнего хода (для мест погибших в один ход)
    dealt: int = 0
    kills: int = 0
    bumps: int = 0  # ходов подряд с перекрытым путём


@dataclass(frozen=True)
class Place:
    id: int
    place: int  # 1 — лучший; общие места — «1, 1, 3»
    shared: bool


@dataclass
class MatchState:
    room: str
    seed: int
    n: int
    tiles: tuple[tuple[int, ...], ...]
    loot: list[Loot]
    players: list[Player]
    turn: int = 1
    stage: int = 0
    finished: bool = False
    last_turn: Optional[dict[str, Any]] = None
    places: Optional[list[Place]] = None

    def player(self, pid: int) -> Optional[Player]:
        for p in self.players:
            if p.id == pid:
                return p
        return None


def create_match(room_code: str, seed: int, player_ids: list[int]) -> MatchState:
    """Новый матч. player_ids — в порядке входа (слоты); места на карте раздаёт seed."""
    rt = _room_type(room_code)
    ids = list(player_ids)
    if len(ids) != rt.seats:
        raise ValueError(f"нужно ровно {rt.seats} игроков")
    if len(set(ids)) != len(ids) or any(isinstance(i, bool) or not isinstance(i, int) for i in ids):
        raise ValueError("id игроков — разные целые")
    gm = generate_map(room_code, seed)
    r = Mulberry32((seed & M32) ^ 0x9E3779B9)
    order = list(range(len(ids)))
    for i in range(len(order) - 1, 0, -1):
        j = int(r() * (i + 1))
        order[i], order[j] = order[j], order[i]
    players = [Player(id=pid, slot=i, x=gm.spawns[order[i]][0], y=gm.spawns[order[i]][1]) for i, pid in enumerate(ids)]
    return MatchState(room=room_code, seed=seed, n=rt.board, tiles=gm.tiles, loot=list(gm.loot), players=players)


def passable(s: MatchState, x: int, y: int) -> bool:
    return 0 <= x < s.n and 0 <= y < s.n and s.tiles[y][x] != WALL


def los(s: MatchState, ax: int, ay: int, bx: int, by: int) -> bool:
    """Линия огня: стены между стрелком и целью (Брезенхэм, концы не считаются); луч не проходит по диагонали
    между двумя ортогонально соседними стенами (запертый угол)."""
    x0, y0 = ax, ay
    dx, dy = abs(bx - x0), -abs(by - y0)
    sx = 1 if x0 < bx else -1
    sy = 1 if y0 < by else -1
    err = dx + dy
    while True:
        if x0 == bx and y0 == by:
            return True
        if not (x0 == ax and y0 == ay) and s.tiles[y0][x0] == WALL:
            return False
        e2 = 2 * err
        nx, ny = x0, y0
        if e2 >= dy:
            err += dy
            nx += sx
        if e2 <= dx:
            err += dx
            ny += sy
        # диагональный шаг луча между двумя ортогонально соседними стенами — запертый угол, выстрел не проходит
        if nx != x0 and ny != y0 and s.tiles[y0][nx] == WALL and s.tiles[ny][x0] == WALL:
            return False
        x0, y0 = nx, ny


def can_hit(s: MatchState, ax: int, ay: int, weapon: str, bx: int, by: int) -> bool:
    d = cheb(ax, ay, bx, by)
    if not 1 <= d <= WEAPONS[weapon].range:
        return False
    return not sealed_corner(s.tiles, ax, ay, bx, by) if d == 1 else los(s, ax, ay, bx, by)


def raw_damage(s: MatchState, ax: int, ay: int, weapon: str, bx: int, by: int) -> int:
    """Урон оружия; цель в укрытии и выстрел с 2+ клеток — вдвое меньше (вниз)."""
    d = WEAPONS[weapon].dmg
    return d // 2 if cheb(ax, ay, bx, by) >= 2 and s.tiles[by][bx] == COVER else d


# ───────────────────────── планы ─────────────────────────


@dataclass(frozen=True)
class Plan:
    """Один из вариантов: шаг (≤1 клетка) + атака, рывок (2 клетки) без атаки, аптечка; пустой — стоять."""

    path: tuple[tuple[int, int], ...] = ()
    attack: Optional[int] = None
    medkit: bool = False


STAND = Plan()


class InvalidPlan(ValueError):
    def __init__(self, code: str, detail: str = ""):
        super().__init__(f"{code}: {detail}" if detail else code)
        self.code = code


def _is_int(v: Any) -> bool:
    return isinstance(v, int) and not isinstance(v, bool)


def parse_plan(raw: Any) -> Plan:
    """Строгий разбор плана из JSON: {"path": [[x, y], …], "attack": id|null} или {"medkit": true}."""
    if raw is None:
        return STAND
    if not isinstance(raw, Mapping):
        raise InvalidPlan("bad_plan", "ожидается объект")
    extra = set(raw) - {"path", "attack", "medkit"}
    if extra:
        raise InvalidPlan("bad_plan", f"лишние поля {sorted(extra)}")
    medkit = raw.get("medkit", False)
    if not isinstance(medkit, bool):
        raise InvalidPlan("bad_plan", "medkit — bool")
    path_raw = raw.get("path", [])
    if not isinstance(path_raw, (list, tuple)):
        raise InvalidPlan("bad_plan", "path — список")
    path: list[tuple[int, int]] = []
    for st in path_raw:
        if isinstance(st, Mapping) and set(st) == {"x", "y"}:
            x, y = st["x"], st["y"]
        elif isinstance(st, (list, tuple)) and len(st) == 2:
            x, y = st
        else:
            raise InvalidPlan("bad_plan", "шаг — [x, y]")
        if not (_is_int(x) and _is_int(y)):
            raise InvalidPlan("bad_plan", "координаты — целые")
        path.append((x, y))
    attack = raw.get("attack")
    if attack is not None and not _is_int(attack):
        raise InvalidPlan("bad_plan", "attack — id игрока или null")
    return Plan(tuple(path), attack, medkit)


def validate_plan(s: MatchState, player_id: int, plan: Plan) -> Plan:
    """Строгая проверка на сервере. Возвращает тот же план или бросает InvalidPlan с кодом.

    Дальность атаки не проверяется: атака разрешается по позициям после движения, цель могла уйти — это промах.
    Клетка, занятая другим игроком, не ошибка: столкновения решает движение.
    """
    if s.finished:
        raise InvalidPlan("match_finished")
    me = s.player(player_id)
    if me is None:
        raise InvalidPlan("unknown_player")
    if not me.alive:
        raise InvalidPlan("player_dead")
    if plan.medkit:
        if plan.path or plan.attack is not None:
            raise InvalidPlan("medkit_exclusive", "аптечка вместо движения и атаки")
        if me.medkits <= 0:
            raise InvalidPlan("no_medkit")
        return plan
    if len(plan.path) > 2:
        raise InvalidPlan("path_too_long")
    cx, cy = me.x, me.y
    for x, y in plan.path:
        if not (0 <= x < s.n and 0 <= y < s.n):
            raise InvalidPlan("step_out_of_bounds", f"({x}, {y})")
        if cheb(cx, cy, x, y) != 1:
            raise InvalidPlan("step_not_adjacent", f"({cx}, {cy}) → ({x}, {y})")
        if s.tiles[y][x] == WALL:
            raise InvalidPlan("step_into_wall", f"({x}, {y})")
        if sealed_corner(s.tiles, cx, cy, x, y):
            raise InvalidPlan("step_sealed_corner", f"({cx}, {cy}) → ({x}, {y})")
        cx, cy = x, y
    if plan.attack is not None:
        if len(plan.path) == 2:
            raise InvalidPlan("dash_no_attack", "рывок без атаки")
        if plan.attack == player_id:
            raise InvalidPlan("attack_self")
        target = s.player(plan.attack)
        if target is None:
            raise InvalidPlan("attack_unknown")
        if not target.alive:
            raise InvalidPlan("attack_dead")
    return plan


# ───────────────────────── ход ─────────────────────────


def resolve_turn(prev: MatchState, plans: Mapping[int, Optional[Plan]]) -> MatchState:
    """Разрешение хода. Порядок фиксирован:
    1 аптечки → 2 движение (2 подшага, конфликты отменяются) → 3 подбор лута →
    4 атаки одновременно по позициям после движения → 5 урон зоны → 6 смерти → 7 сжатие зоны.

    plans: id → план (None или нет ключа — стоять). Невалидный план — InvalidPlan (проверяйте при приёме).
    Исходное состояние не меняется.
    """
    for pid, pl in plans.items():
        if pl is not None:
            validate_plan(prev, pid, pl)
    if prev.finished:
        raise InvalidPlan("match_finished")
    s = copy.deepcopy(prev)
    turn = s.turn
    lt: dict[str, Any] = {"turn": turn, "moves": {}, "shots": [], "zone_hits": [], "deaths": [], "picks": [], "events": []}
    ev: list[dict[str, Any]] = lt["events"]
    alive = [p for p in s.players if p.alive]
    alive_ids = {p.id for p in alive}
    by_id = {p.id: p for p in s.players}
    plan_of: dict[int, Plan] = {}
    for p in alive:
        plan_of[p.id] = plans.get(p.id) or STAND
        p.hp_before = p.hp

    # 1. аптечки
    for p in alive:
        if plan_of[p.id].medkit:
            h = min(MEDKIT_HEAL, MAX_HP - p.hp)
            p.medkits -= 1
            p.hp += h
            ev.append({"t": "heal", "who": p.id, "hp": h})

    # 2. движение: два подшага; в одну клетку или обмен местами — все участники стоят (и дальше в этом ходу)
    start = {p.id: (p.x, p.y) for p in alive}
    blocked: set[int] = set()
    for k in range(2):
        want: dict[int, tuple[int, int]] = {}
        for p in alive:
            path = plan_of[p.id].path
            want[p.id] = path[k] if p.id not in blocked and k < len(path) else (p.x, p.y)
        for _ in range(20):
            changed = False
            by_cell: dict[tuple[int, int], list[Player]] = {}
            for p in alive:
                by_cell.setdefault(want[p.id], []).append(p)
            for ps in by_cell.values():
                if len(ps) > 1:
                    for p in ps:
                        if want[p.id] != (p.x, p.y):
                            want[p.id] = (p.x, p.y)
                            blocked.add(p.id)
                            changed = True
            for a in alive:
                for b in alive:
                    if (
                        a.id < b.id
                        and want[a.id] == (b.x, b.y)
                        and want[b.id] == (a.x, a.y)
                        and (a.x, a.y) != (b.x, b.y)
                    ):
                        want[a.id] = (a.x, a.y)
                        want[b.id] = (b.x, b.y)
                        blocked.update((a.id, b.id))
                        changed = True
            if not changed:
                break
        for p in alive:
            p.x, p.y = want[p.id]
    for p in alive:
        lt["moves"][p.id] = (start[p.id], (p.x, p.y))
        bumped = p.id in blocked and bool(plan_of[p.id].path)
        p.bumps = p.bumps + 1 if bumped else 0
        if bumped:
            ev.append({"t": "bump", "who": p.id})

    # 3. лут на конечной клетке, по id; хуже текущего — остаётся лежать
    for p in sorted(alive, key=lambda q: q.id):
        i = next((i for i, item in enumerate(s.loot) if item.x == p.x and item.y == p.y), -1)
        if i < 0:
            continue
        item = s.loot[i]
        if item.kind == "medkit":
            if p.medkits >= MEDKIT_MAX:
                continue
            p.medkits += 1
        elif item.kind == "weapon":
            if WEAPONS[item.type].tier <= WEAPONS[p.weapon].tier:
                continue
            p.weapon = item.type
        else:
            if ARMORS[item.type].ap <= p.ap:
                continue
            p.armor = item.type
            p.ap = ARMORS[item.type].ap
        ev.append({"t": "pick", "who": p.id, "kind": item.kind, "type": item.type})
        lt["picks"].append({"who": p.id, "x": item.x, "y": item.y, "kind": item.kind, "type": item.type})
        del s.loot[i]

    # 4. атаки по снимку после движения, урон разом; броня снимается по порядку id атакующих
    dmg: dict[int, dict[str, Any]] = {}
    for a in sorted(alive, key=lambda q: q.id):
        tid = plan_of[a.id].attack
        if tid is None or tid not in alive_ids:
            continue
        t = by_id[tid]
        if not can_hit(s, a.x, a.y, a.weapon, t.x, t.y):
            lt["shots"].append({"from": a.id, "to": t.id, "miss": True, "fx": a.x, "fy": a.y, "tx": t.x, "ty": t.y, "dmg": None})
            ev.append({"t": "miss", "who": a.id, "target": t.id})
            continue
        acc = dmg.setdefault(t.id, {"hp": 0, "ap": 0, "by": []})
        raw = raw_damage(s, a.x, a.y, a.weapon, t.x, t.y)
        absorbed = min(t.ap - acc["ap"], raw // 2)
        acc["hp"] += raw - absorbed
        acc["ap"] += absorbed
        acc["by"].append(a.id)
        a.dealt += raw
        lt["shots"].append({"from": a.id, "to": t.id, "miss": False, "fx": a.x, "fy": a.y, "tx": t.x, "ty": t.y, "dmg": raw})
        ev.append({"t": "hit", "who": a.id, "target": t.id, "dmg": raw})
    for tid, acc in dmg.items():
        t = by_id[tid]
        t.hp -= acc["hp"]
        t.ap -= acc["ap"]
        if t.ap <= 0:
            t.ap = 0
            t.armor = None

    # 5. зона (бьёт и тех, кого только что убили атакой, — как в engine.js)
    box = zone_box(s.n, s.stage)
    for p in alive:
        if not in_box(box, p.x, p.y):
            z = zone_damage(s.stage, s.n, turn)
            p.hp -= z
            lt["zone_hits"].append({"who": p.id, "dmg": z})
            ev.append({"t": "zone", "who": p.id, "dmg": z})

    # 6. смерти; убийство засчитывается каждому, кто попал в этом ходу
    for p in alive:
        if p.hp <= 0:
            p.hp = 0
            p.alive = False
            p.death_turn = turn
            lt["deaths"].append(p.id)
            killers = dmg.get(p.id, {}).get("by", [])
            for k in killers:
                by_id[k].kills += 1
            ev.append({"t": "death", "who": p.id, "zone": not killers})

    # 7. сжатие зоны
    left = sum(1 for p in s.players if p.alive)
    if shrinks_after(turn) and s.stage <= max_stage(s.n):
        s.stage += 1
        ev.append({"t": "zone-shrink", "stage": s.stage, "closed": s.stage > max_stage(s.n)})
    s.last_turn = lt
    if left <= 1 or turn >= MAX_TURNS:
        s.finished = True
        s.places = placements(s)
    else:
        s.turn += 1
    return s


def placements(s: MatchState) -> list[Place]:
    """Места: живые — по HP, затем броне; выбывшие — по ходу смерти (позже — выше), затем HP до этого хода.
    Совпало всё — место общее (1, 1, 3). Порядок внутри общего места — порядок входа."""

    def rank(p: Player) -> tuple[int, int, int]:
        if p.alive:
            return (1, p.hp, p.ap)
        return (0, p.death_turn or 0, p.hp_before)

    ordered = sorted(s.players, key=lambda p: tuple(-v for v in rank(p)))
    out: list[Place] = []
    i = 0
    while i < len(ordered):
        j = i
        while j + 1 < len(ordered) and rank(ordered[j + 1]) == rank(ordered[i]):
            j += 1
        out += [Place(ordered[k].id, i + 1, j > i) for k in range(i, j + 1)]
        i = j + 1
    return out


def run_match(room_code: str, seed: int, player_ids: list[int], turns: list[Mapping[int, Optional[Plan]]]) -> MatchState:
    """Проиграть журнал планов (для повтора и споров). Ходы после конца матча — ошибка."""
    s = create_match(room_code, seed, player_ids)
    for plans in turns:
        s = resolve_turn(s, plans)
    return s


# ───────── хранение состояния (arena_matches.state_json) ─────────

STATE_VERSION = 1


def state_to_dict(s: MatchState) -> dict[str, Any]:
    """Состояние матча → JSON-совместимый dict (для БД). Обратное — state_from_dict."""
    d = asdict(s)
    d["v"] = STATE_VERSION
    d["tiles"] = [list(row) for row in s.tiles]
    # last_turn — уже JSON-подобный (списки и dict со строковыми ключами); кортежи станут списками
    d["last_turn"] = json.loads(json.dumps(s.last_turn)) if s.last_turn is not None else None
    return d


def state_from_dict(d: Mapping[str, Any]) -> MatchState:
    if d.get("v") != STATE_VERSION:
        raise ValueError(f"неизвестная версия состояния: {d.get('v')!r}")
    return MatchState(
        room=d["room"],
        seed=int(d["seed"]),
        n=int(d["n"]),
        tiles=tuple(tuple(int(c) for c in row) for row in d["tiles"]),
        loot=[Loot(**x) for x in d["loot"]],
        players=[Player(**p) for p in d["players"]],
        turn=int(d["turn"]),
        stage=int(d["stage"]),
        finished=bool(d["finished"]),
        last_turn=d.get("last_turn"),
        places=[Place(**x) for x in d["places"]] if d.get("places") is not None else None,
    )


def state_to_json(s: MatchState) -> str:
    return json.dumps(state_to_dict(s), separators=(",", ":"))


def state_from_json(raw: str) -> MatchState:
    return state_from_dict(json.loads(raw))

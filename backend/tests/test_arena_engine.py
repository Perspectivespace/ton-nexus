"""«Арена»: Python-движок = эталонному JS-движку (shared/arena/engine.js).

Векторы shared/arena-vectors.json пишет `node shared/arena/gen-vectors.mjs` (из корня репозитория):
карты по seed (a4/a8, края uint32) и целые матчи ход за ходом — боты, боты с AFK, случайные валидные планы.
Здесь те же планы проигрываются портом — состояние после каждого хода обязано совпасть полностью.
Плюс инварианты карты на многих seed и крайние случаи правил. Запуск из backend: python -m unittest discover -s tests
"""

import copy
import json
import unittest
from collections import Counter
from pathlib import Path

from app.services import arena_config
from app.services import arena_engine as eng
from app.services.arena_engine import InvalidPlan, Loot, MatchState, Plan, Player

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "shared" / "arena-vectors.json").read_text(encoding="utf-8"))


def py_player(p: Player) -> list:
    return [p.id, p.slot, p.x, p.y, p.hp, p.ap, p.armor, p.weapon, p.medkits, p.alive, p.death_turn, p.hp_before, p.dealt, p.kills, p.bumps]


def py_event(e: dict) -> list:
    out = [e["t"], e.get("who")]
    if e["t"] == "hit":  # в JS target есть только у попадания
        out.append(e["target"])
    return out


def js_plans(raw: dict) -> dict[int, Plan]:
    return {int(pid): eng.parse_plan(pl) for pid, pl in raw.items()}


class ConfigParityTest(unittest.TestCase):
    def test_vectors_file(self):
        self.assertEqual(VECTORS["version"], 2)
        self.assertGreaterEqual(len(VECTORS["maps"]), 80)
        self.assertGreaterEqual(len(VECTORS["matches"]), 12)
        self.assertEqual({m["kind"] for m in VECTORS["matches"]}, {"bots", "bots+afk", "script"})

    def test_constants_match_js(self):
        cfg = VECTORS["config"]
        for name in ("TURN_MS", "ZONE_EVERY", "MAX_HP", "MEDKIT_HEAL", "MEDKIT_MAX", "MAX_TURNS"):
            self.assertEqual(getattr(eng, name), cfg[name], name)
        self.assertEqual({k: [w.range, w.dmg, w.tier] for k, w in eng.WEAPONS.items()}, cfg["WEAPONS"])
        self.assertEqual({k: [a.ap, a.tier] for k, a in eng.ARMORS.items()}, cfg["ARMORS"])
        # места и сторона поля — из arena_config (единая таблица комнат)
        for code, (seats, size) in cfg["ROOMS"].items():
            rt = arena_config.room_type(code)
            self.assertEqual((rt.seats, rt.board), (seats, size), code)

    def test_mulberry32_matches_js_reference(self):
        # первые числа mulberry32(1) в node: E.rng(1)() × 3
        r = eng.Mulberry32(1)
        got = [r() for _ in range(3)]
        self.assertEqual(got, [0.6270739405881613, 0.002735721180215478, 0.5274470399599522])


class MapParityTest(unittest.TestCase):
    def test_maps_match_js(self):
        for v in VECTORS["maps"]:
            with self.subTest(room=v["room"], seed=v["seed"]):
                gm = eng.generate_map(v["room"], v["seed"])
                self.assertEqual(["".join(map(str, row)) for row in gm.tiles], v["tiles"])
                self.assertEqual([[l.id, l.kind, l.type, l.x, l.y] for l in gm.loot], v["loot"])
                ids = [s[0] for s in v["starts"]]
                s = eng.create_match(v["room"], v["seed"], ids)
                self.assertEqual([[p.id, p.x, p.y] for p in s.players], v["starts"])


class CornerParityTest(unittest.TestCase):
    def test_corners_match_js(self):
        sealed = 0
        for room, seed, ax, ay, bx, by, can_step, fists, rifle in VECTORS["corners"]:
            with self.subTest(room=room, seed=seed, a=(ax, ay), b=(bx, by)):
                s = eng.create_match(room, seed, list(range(arena_config.room_type(room).seats)))
                me = s.players[0]
                me.x, me.y = ax, ay
                try:
                    eng.validate_plan(s, me.id, Plan(((bx, by),)))
                    ok = True
                except InvalidPlan as e:
                    self.assertEqual(e.code, "step_sealed_corner")
                    ok = False
                self.assertEqual(ok, can_step)
                self.assertEqual(eng.can_hit(s, ax, ay, "fists", bx, by), fists)
                self.assertEqual(eng.can_hit(s, ax, ay, "rifle", bx, by), rifle)
                sealed += not can_step
        self.assertGreater(sealed, 0)


class LosParityTest(unittest.TestCase):
    def test_los_matches_js(self):
        corner = 0
        for v in VECTORS["los"]:
            with self.subTest(room=v["room"], seed=v["seed"]):
                s = eng.create_match(v["room"], v["seed"], list(range(arena_config.room_type(v["room"]).seats)))
                cells = [(x, y) for y in range(s.n) for x in range(s.n) if eng.passable(s, x, y)]
                bits = "".join("1" if eng.los(s, ax, ay, bx, by) else "0" for ax, ay in cells for bx, by in cells if 2 <= eng.cheb(ax, ay, bx, by) <= 5)
                self.assertEqual(len(bits), v["pairs"])
                js = "".join(f"{int(c, 16):04b}" for c in v["hex"])[: v["pairs"]]
                self.assertEqual(bits, js)
                corner += v["corner"]
        self.assertGreater(corner, 0)  # в векторах есть лучи, закрытые именно запертым углом


class StateStorageTest(unittest.TestCase):
    """Состояние в БД (arena_matches.state_json): JSON → состояние → дальше ходы как без сохранения."""

    def test_roundtrip_every_turn(self):
        for m in VECTORS["matches"][:6]:
            with self.subTest(room=m["room"], seed=m["seed"], kind=m["kind"]):
                direct = eng.create_match(m["room"], m["seed"], m["ids"])
                stored = eng.state_from_json(eng.state_to_json(direct))
                for t in m["turns"]:
                    direct = eng.resolve_turn(direct, js_plans(t["plans"]))
                    stored = eng.state_from_json(eng.state_to_json(eng.resolve_turn(stored, js_plans(t["plans"]))))
                    self.assertEqual(eng.state_to_dict(stored), eng.state_to_dict(direct))
                self.assertTrue(stored.finished)
                self.assertEqual(stored.places, direct.places)

    def test_rejects_unknown_version(self):
        d = eng.state_to_dict(eng.create_match("a4", 1, [1, 2, 3, 4]))
        d["v"] = 99
        with self.assertRaises(ValueError):
            eng.state_from_dict(d)


class MatchParityTest(unittest.TestCase):
    def test_matches_turn_by_turn(self):
        for m in VECTORS["matches"]:
            s = eng.create_match(m["room"], m["seed"], m["ids"])
            with self.subTest(room=m["room"], seed=m["seed"], kind=m["kind"], turn=0):
                self.assertEqual(["".join(map(str, row)) for row in s.tiles], m["start"]["tiles"])
                self.assertEqual([[l.id, l.kind, l.type, l.x, l.y] for l in s.loot], m["start"]["loot"])
                self.assertEqual([[p.id, p.x, p.y] for p in s.players], m["start"]["starts"])
            for t in m["turns"]:
                with self.subTest(room=m["room"], seed=m["seed"], kind=m["kind"], turn=t["turn"]):
                    self.assertEqual(s.turn, t["turn"])
                    s = eng.resolve_turn(s, js_plans(t["plans"]))
                    lt = s.last_turn
                    self.assertEqual([py_player(p) for p in s.players], t["players"])
                    self.assertEqual([l.id for l in s.loot], t["loot"])
                    self.assertEqual((s.stage, s.turn, s.finished), (t["stage"], t["next"], t["finished"]))
                    self.assertEqual([[pid, *a, *b] for pid, (a, b) in sorted(lt["moves"].items())], t["moves"])  # JS: ключи-числа по возрастанию
                    self.assertEqual(
                        [[x["from"], x["to"], x["miss"], x["fx"], x["fy"], x["tx"], x["ty"], x["dmg"]] for x in lt["shots"]], t["shots"]
                    )
                    self.assertEqual([[z["who"], z["dmg"]] for z in lt["zone_hits"]], t["zoneHits"])
                    self.assertEqual(lt["deaths"], t["deaths"])
                    self.assertEqual([[q["who"], q["x"], q["y"], q["kind"], q["type"]] for q in lt["picks"]], t["picks"])
                    # все события хода (lastTurn.events), не клиентская лента из 40
                    self.assertEqual([py_event(e) for e in lt["events"]], t["events"])
                    self.assertEqual(s.places is None, not t["finished"])
            self.assertTrue(s.finished)
            self.assertEqual([[p.id, p.place, p.shared] for p in s.places], m["places"])

    def test_run_match_replays_log(self):
        m = VECTORS["matches"][0]
        s = eng.run_match(m["room"], m["seed"], m["ids"], [js_plans(t["plans"]) for t in m["turns"]])
        self.assertEqual([[p.id, p.place, p.shared] for p in s.places], m["places"])

    def test_vectors_cover_the_rules(self):
        seen = Counter()
        for m in VECTORS["matches"]:
            for t in m["turns"]:
                for e in t["events"]:
                    seen[e[0]] += 1
                for pl in t["plans"].values():
                    seen["dash" if len(pl.get("path", [])) == 2 else "medkit" if pl.get("medkit") else "step"] += 1
            seen["shared_place"] += any(p[2] for p in m["places"])
        for kind in ("heal", "bump", "pick", "hit", "miss", "zone", "death", "zone-shrink", "dash", "medkit", "step", "shared_place"):
            self.assertGreater(seen[kind], 0, kind)


def _ring(n, x, y):
    c = (n - 1) // 2
    return max(abs(x - c), abs(y - c))


class MapInvariantsTest(unittest.TestCase):
    SEEDS = list(range(0, 300)) + [2**31 - 1, 2**31, 2**32 - 1]

    def test_invariants(self):
        expect = {"a4": {"walls": 8, "covers": 8}, "a8": {"walls": 12, "covers": 12}}
        loot_full = {
            "a4": {"rifle": 1, "knife": 4, "pistol": 4, "light": 4, "medkit": 4, "heavy": 4},
            "a8": {"rifle": 1, "knife": 8, "pistol": 8, "light": 4, "heavy": 4, "medkit": 8},
        }
        for code in ("a4", "a8"):
            rt = arena_config.room_type(code)
            n, c = rt.board, (rt.board - 1) // 2
            for seed in self.SEEDS:
                with self.subTest(room=code, seed=seed):
                    gm = eng.generate_map(code, seed)
                    T = gm.tiles
                    cells = [(x, y) for y in range(n) for x in range(n)]
                    # симметрия поворота на 90°
                    for x, y in cells:
                        self.assertEqual(T[x][n - 1 - y], T[y][x])
                    rot = lambda x, y: (n - 1 - y, x)  # noqa: E731
                    loot = {(l.kind, l.type, l.x, l.y) for l in gm.loot}
                    self.assertEqual({(k, t, *rot(x, y)) for k, t, x, y in loot}, loot)
                    self.assertEqual({rot(*sp) for sp in gm.spawns}, set(gm.spawns))
                    # счёт препятствий
                    self.assertEqual(sum(T[y][x] == eng.WALL for x, y in cells), expect[code]["walls"])
                    self.assertEqual(sum(T[y][x] == eng.COVER for x, y in cells), expect[code]["covers"])
                    # центр: 3×3 пустой, в 5×5 нет стен и ровно 4 укрытия; винтовка в центре
                    for x, y in cells:
                        if _ring(n, x, y) <= 1:
                            self.assertEqual(T[y][x], eng.FLOOR)
                        if _ring(n, x, y) <= 2:
                            self.assertNotEqual(T[y][x], eng.WALL)
                    self.assertEqual(sum(T[y][x] == eng.COVER for x, y in cells if _ring(n, x, y) == 2), 4)
                    self.assertEqual(gm.loot[0], Loot(0, "weapon", "rifle", c, c))
                    # старты: 3×3 вокруг без препятствий и лута
                    loot_cells = [(l.x, l.y) for l in gm.loot]
                    self.assertEqual(len(loot_cells), len(set(loot_cells)))
                    for sx, sy in gm.spawns:
                        for dx in (-1, 0, 1):
                            for dy in (-1, 0, 1):
                                self.assertEqual(T[sy + dy][sx + dx], eng.FLOOR)
                                self.assertNotIn((sx + dx, sy + dy), loot_cells)
                    for l in gm.loot:
                        self.assertNotEqual(T[l.y][l.x], eng.WALL)
                    self.assertEqual(Counter(l.type for l in gm.loot), loot_full[code])
                    self.assertEqual([l.id for l in gm.loot], list(range(len(gm.loot))))
                    # связность: все не-стены в одной компоненте (8 соседей, запертые углы не проходятся)
                    free = {(x, y) for x, y in cells if T[y][x] != eng.WALL}
                    seen, stack = {(c, c)}, [(c, c)]
                    while stack:
                        px, py = stack.pop()
                        for dx in (-1, 0, 1):
                            for dy in (-1, 0, 1):
                                q = (px + dx, py + dy)
                                if q not in free or q in seen:
                                    continue
                                if dx and dy and T[py][px + dx] != eng.FLOOR and T[py + dy][px] != eng.FLOOR:
                                    continue  # запертый угол
                                seen.add(q)
                                stack.append(q)
                    self.assertEqual(seen, free)
                    # старты: каждый спавн занят ровно одним игроком
                    s = eng.create_match(code, seed, list(range(100, 100 + rt.seats)))
                    self.assertEqual(sorted((p.x, p.y) for p in s.players), sorted(gm.spawns))

    def test_loot_always_complete_20000_seeds(self):
        """Честность: на каждой карте полный состав лута (раньше на части карт орбита молча пропадала)."""
        full = {"a4": 21, "a8": 33}  # винтовка + орбиты по 4
        for code, total in full.items():
            want = Counter()
            for kind, typ, *_ in eng._LOOT[arena_config.room_type(code).board]:
                want[(kind, typ)] += 4
            want[("weapon", "rifle")] = 1
            bad = []
            for seed in range(20_000):
                gm = eng.generate_map(code, seed)
                if len(gm.loot) != total or Counter((l.kind, l.type) for l in gm.loot) != want:
                    bad.append(seed)
            self.assertEqual(bad, [], code)

    def test_deterministic_and_seed_sensitive(self):
        a = eng.create_match("a8", 42, list(range(8)))
        b = eng.create_match("a8", 42, list(range(8)))
        self.assertEqual(a, b)
        self.assertGreater(len({eng.generate_map("a4", s).tiles for s in range(50)}), 25)

    def test_bad_input(self):
        for seed in (-1, 2**32, 1.5, True, "1"):
            with self.assertRaises(ValueError):
                eng.generate_map("a4", seed)
        with self.assertRaises(ValueError):
            eng.create_match("a4", 1, [1, 2, 3])  # не полный состав
        with self.assertRaises(ValueError):
            eng.create_match("a4", 1, [1, 1, 2, 3])


# ───────────────────────── крайние случаи ─────────────────────────


def board(players, *, walls=(), covers=(), loot=(), stage=0, turn=1, n=9):
    """Пустое поле 9×9 a4 со своими стенами/укрытиями/лутом. players: Player или (id, x, y, {поля})."""
    tiles = [[0] * n for _ in range(n)]
    for x, y in walls:
        tiles[y][x] = eng.WALL
    for x, y in covers:
        tiles[y][x] = eng.COVER
    ps = []
    for i, p in enumerate(players):
        if not isinstance(p, Player):
            pid, x, y, *rest = p
            p = Player(id=pid, slot=i, x=x, y=y, **(rest[0] if rest else {}))
        ps.append(p)
    return MatchState(
        room="a4", seed=1, n=n, tiles=tuple(tuple(r) for r in tiles), loot=list(loot), players=ps, turn=turn, stage=stage
    )


def step(*path, attack=None):
    return Plan(tuple(path), attack)


class TurnRulesTest(unittest.TestCase):
    def test_simultaneous_kill_shares_first_place(self):
        s = board([(1, 4, 4, {"hp": 10}), (2, 5, 4, {"hp": 10}), (3, 0, 0, {"alive": False, "hp": 0, "death_turn": 1})], turn=2)
        s = eng.resolve_turn(s, {1: step(attack=2), 2: step(attack=1)})
        self.assertTrue(s.finished)
        self.assertEqual(s.last_turn["deaths"], [1, 2])
        self.assertEqual([(p.kills, p.death_turn, p.hp) for p in s.players[:2]], [(1, 2, 0), (1, 2, 0)])
        self.assertEqual([(p.id, p.place, p.shared) for p in s.places], [(1, 1, True), (2, 1, True), (3, 3, False)])

    def test_same_turn_deaths_ranked_by_hp_before(self):
        s = board([(1, 4, 4, {"hp": 10}), (2, 5, 4, {"hp": 11}), (3, 0, 0, {"alive": False, "hp": 0, "death_turn": 1, "hp_before": 50})], turn=3)
        s = eng.resolve_turn(s, {1: step(attack=2), 2: step(attack=1)})
        self.assertEqual([(p.id, p.place, p.shared) for p in s.places], [(2, 1, False), (1, 2, False), (3, 3, False)])

    def test_medkit_on_death_turn_does_not_change_hp_before(self):
        s = board([(1, 4, 4, {"hp": 10, "medkits": 1}), (2, 5, 4, {"hp": 10}), (3, 6, 4, {"weapon": "rifle"}), (4, 0, 8, {})], turn=2)
        # 1 лечится 10 → 45, затем винтовка 26 + кулак 12: остаётся 7; hp_before — 10 (до аптечки)
        s = eng.resolve_turn(s, {1: Plan(medkit=True), 2: step(attack=1), 3: step(attack=1)})
        p1 = s.player(1)
        self.assertEqual((p1.hp, p1.hp_before, p1.medkits, p1.alive), (7, 10, 0, True))

    def test_zone_death_no_killer(self):
        s = board([(1, 0, 0, {"hp": 5}), (2, 4, 4), (3, 5, 5)], stage=1, turn=5)
        s = eng.resolve_turn(s, {})
        self.assertEqual(s.last_turn["zone_hits"], [{"who": 1, "dmg": 12}])
        self.assertIn({"t": "death", "who": 1, "zone": True}, s.last_turn["events"])
        self.assertEqual([p.kills for p in s.players], [0, 0, 0])
        self.assertFalse(s.player(1).alive)

    def test_zone_damage_table(self):
        self.assertEqual([eng.zone_damage(st, 9, 0) for st in range(4)], [6, 12, 18, 24])
        self.assertEqual(eng.zone_box(9, 3), (3, 3, 5, 5))
        self.assertEqual(eng.zone_box(9, 4), (1, 1, 0, 0))  # закрыта
        # закрыта после хода 13 (a4): урон 30 + 8 за каждый ход после 14
        self.assertEqual([eng.zone_damage(4, 9, t) for t in (14, 15, 16)], [30, 38, 46])
        self.assertEqual([t for t in range(1, 20) if eng.shrinks_after(t)], [4, 7, 10, 13, 16, 19])
        # закрытая зона бьёт всех, даже в центре
        s = board([(1, 4, 4), (2, 3, 3)], stage=4, turn=15)
        s = eng.resolve_turn(s, {})
        self.assertEqual([p.hp for p in s.players], [62, 62])
        # стадия не растёт выше закрытой
        s2 = board([(1, 4, 4), (2, 3, 3)], stage=4, turn=16)
        self.assertEqual(eng.resolve_turn(s2, {}).stage, 4)

    def test_shrink_after_turn_4(self):
        s = board([(1, 4, 4), (2, 3, 3)], turn=4)
        s = eng.resolve_turn(s, {})
        self.assertEqual((s.stage, s.turn), (1, 5))
        self.assertEqual(s.last_turn["events"][-1], {"t": "zone-shrink", "stage": 1, "closed": False})

    def test_collisions(self):
        # двое в одну клетку — оба стоят, bump
        s = eng.resolve_turn(board([(1, 2, 2), (2, 4, 2)]), {1: step((3, 2)), 2: step((3, 2))})
        self.assertEqual([(p.x, p.y, p.bumps) for p in s.players], [(2, 2, 1), (4, 2, 1)])
        # обмен местами — оба стоят
        s = eng.resolve_turn(board([(1, 2, 2), (2, 3, 2)]), {1: step((3, 2)), 2: step((2, 2))})
        self.assertEqual([(p.x, p.y) for p in s.players], [(2, 2), (3, 2)])
        # «паровозик»: 2 уходит, 1 занимает его клетку
        s = eng.resolve_turn(board([(1, 2, 2), (2, 3, 2)]), {1: step((3, 2)), 2: step((4, 2))})
        self.assertEqual([(p.x, p.y, p.bumps) for p in s.players], [(3, 2, 0), (4, 2, 0)])
        # в клетку стоящего нельзя; цепочка отмен: 3 → 2 → 1(стоит)
        s = eng.resolve_turn(board([(1, 2, 2), (2, 3, 2), (3, 4, 2)]), {2: step((2, 2)), 3: step((3, 2))})
        self.assertEqual([(p.x, p.y) for p in s.players], [(2, 2), (3, 2), (4, 2)])
        # рывок: первый шаг прошёл, на втором столкновение — стоит на промежуточной; дальше в ходу не идёт
        s = eng.resolve_turn(board([(1, 0, 4), (2, 4, 4)]), {1: step((1, 4), (2, 4)), 2: step((3, 4), (2, 4))})
        self.assertEqual([(p.x, p.y, p.bumps) for p in s.players], [(1, 4, 1), (3, 4, 1)])
        # повтор столкновений копит bumps, свободный ход обнуляет
        st = board([(1, 2, 2, {"bumps": 2}), (2, 4, 2)])
        st = eng.resolve_turn(st, {1: step((3, 2)), 2: step((3, 2))})
        self.assertEqual(st.player(1).bumps, 3)
        st = eng.resolve_turn(st, {1: step((2, 3))})
        self.assertEqual(st.player(1).bumps, 0)

    def test_dash_cannot_attack_and_attack_resolves_after_move(self):
        # 2 убегает на 2 клетки — удар кулаком промахивается
        s = eng.resolve_turn(board([(1, 4, 4), (2, 5, 4)]), {1: step(attack=2), 2: step((6, 4), (7, 4))})
        self.assertEqual(s.last_turn["shots"][0]["miss"], True)
        self.assertEqual(s.player(2).hp, 100)
        # шаг навстречу и удар — попадание по позиции после движения
        s = eng.resolve_turn(board([(1, 2, 4), (2, 4, 4)]), {1: step((3, 4), attack=2)})
        self.assertEqual(s.player(2).hp, 88)

    def test_armor_and_cover(self):
        # тяжёлая броня 60: два пистолета (20) с 3 клеток: по 10 в броню — броня 40, HP −20
        s = board([(1, 1, 4, {"weapon": "pistol"}), (2, 4, 4, {"ap": 60, "armor": "heavy"}), (3, 7, 4, {"weapon": "pistol"})])
        s = eng.resolve_turn(s, {1: step(attack=2), 3: step(attack=2)})
        self.assertEqual((s.player(2).hp, s.player(2).ap, s.player(2).armor), (80, 40, "heavy"))
        # броня кончается в середине залпа: остаток 5, удары по id атакующих
        s = board([(1, 3, 4, {"weapon": "knife"}), (2, 4, 4, {"ap": 5, "armor": "light"}), (3, 5, 4, {"weapon": "knife"})])
        s = eng.resolve_turn(s, {3: step(attack=2), 1: step(attack=2)})
        self.assertEqual((s.player(2).hp, s.player(2).ap, s.player(2).armor), (100 - 29 - 34, 0, None))
        # укрытие: винтовка 26 → 13 с дистанции; вплотную укрытие не помогает
        s = board([(1, 1, 4, {"weapon": "rifle"}), (2, 4, 4), (3, 5, 4)], covers=[(4, 4)])
        s = eng.resolve_turn(s, {1: step(attack=2), 3: step(attack=2)})
        self.assertEqual(s.player(2).hp, 100 - 13 - 12)
        self.assertEqual(s.player(1).dealt, 13)

    def test_line_of_sight(self):
        s = board([(1, 1, 4, {"weapon": "rifle"}), (2, 5, 4)], walls=[(3, 4)])
        s = eng.resolve_turn(s, {1: step(attack=2)})
        self.assertTrue(s.last_turn["shots"][0]["miss"])
        # вплотную линия огня не нужна: стена сбоку не мешает
        s = board([(1, 4, 4), (2, 5, 5)], walls=[(5, 4)])
        s = eng.resolve_turn(s, {1: step(attack=2)})
        self.assertEqual(s.player(2).hp, 88)
        # луч по диагонали между двумя ортогонально соседними стенами (запертый угол) — промах
        s = board([(1, 2, 2, {"weapon": "rifle"}), (2, 5, 5)], walls=[(4, 3), (3, 4)])
        self.assertFalse(eng.los(s, 2, 2, 5, 5))
        s = eng.resolve_turn(s, {1: step(attack=2)})
        self.assertTrue(s.last_turn["shots"][0]["miss"])
        # одна стена у диагонали луч не закрывает, укрытия — тоже (они только режут урон)
        for walls, covers in (([(4, 3)], []), ([], [(4, 3), (3, 4)])):
            s = board([(1, 2, 2, {"weapon": "rifle"}), (2, 5, 5)], walls=walls, covers=covers)
            self.assertTrue(eng.los(s, 2, 2, 5, 5), (walls, covers))
        # дальность пистолета 3 — с 4 клеток мимо
        s = eng.resolve_turn(board([(1, 0, 4, {"weapon": "pistol"}), (2, 4, 4)]), {1: step(attack=2)})
        self.assertTrue(s.last_turn["shots"][0]["miss"])

    def test_sealed_corner(self):
        # запертый угол: по бокам диагонали два препятствия (стена/укрытие в любом сочетании)
        for walls, covers in (([(5, 4), (4, 5)], []), ([(5, 4)], [(4, 5)]), ([], [(5, 4), (4, 5)])):
            with self.subTest(walls=walls, covers=covers):
                s = board([(1, 4, 4, {"weapon": "rifle"}), (2, 5, 5), (3, 0, 0)], walls=walls, covers=covers)
                # ни удара (любым оружием на d=1) ...
                out = eng.resolve_turn(s, {1: step(attack=2), 2: step(attack=1)})
                self.assertEqual([x["miss"] for x in out.last_turn["shots"]], [True, True])
                self.assertEqual((out.player(1).hp, out.player(2).hp), (100, 100))
                # ... ни шага через угол
                with self.assertRaises(InvalidPlan) as cm:
                    eng.validate_plan(s, 1, step((5, 5)))
                self.assertEqual(cm.exception.code, "step_sealed_corner")
        # одно препятствие — угол открыт: шаг и удар проходят
        s = board([(1, 4, 4), (2, 5, 5), (3, 0, 0)], covers=[(5, 4)])
        self.assertEqual(eng.validate_plan(s, 1, step((5, 3))), step((5, 3)))
        out = eng.resolve_turn(s, {1: step(attack=2)})
        self.assertEqual(out.player(2).hp, 88)
        # рывок: второй шаг через запертый угол — весь план отклонён
        s = board([(1, 3, 4), (2, 0, 0)], walls=[(5, 4)], covers=[(4, 5)])
        with self.assertRaises(InvalidPlan) as cm:
            eng.validate_plan(s, 1, step((4, 4), (5, 5)))
        self.assertEqual(cm.exception.code, "step_sealed_corner")

    def test_medkit(self):
        s = eng.resolve_turn(board([(1, 4, 4, {"hp": 80, "medkits": 2}), (2, 0, 0)]), {1: Plan(medkit=True)})
        self.assertEqual((s.player(1).hp, s.player(1).medkits), (100, 1))
        self.assertEqual(s.last_turn["events"][0], {"t": "heal", "who": 1, "hp": 20})
        # при полном HP аптечка тратится впустую (как в engine.js)
        s = eng.resolve_turn(s, {1: Plan(medkit=True)})
        self.assertEqual((s.player(1).hp, s.player(1).medkits), (100, 0))

    def test_auto_pickup(self):
        loot = [Loot(0, "weapon", "rifle", 3, 4), Loot(2, "weapon", "knife", 5, 4), Loot(3, "medkit", "medkit", 4, 3), Loot(4, "armor", "light", 4, 5)]
        s = board([(1, 2, 4), (2, 6, 4, {"weapon": "pistol"}), (3, 4, 2, {"medkits": 2}), (4, 4, 6, {"ap": 40, "armor": "heavy"})], loot=loot)
        s = eng.resolve_turn(s, {1: step((3, 4)), 2: step((5, 4)), 3: step((4, 3)), 4: step((4, 5))})
        self.assertEqual(s.player(1).weapon, "rifle")
        self.assertEqual(s.player(2).weapon, "pistol")  # нож хуже — остался лежать
        self.assertEqual(s.player(3).medkits, 2)  # больше 2 не несёт
        self.assertEqual((s.player(4).ap, s.player(4).armor), (40, "heavy"))  # лёгкая (30) хуже 40
        self.assertEqual([l.id for l in s.loot], [2, 3, 4])
        # потрёпанная тяжёлая (20) меняется на лёгкую (30)
        s = board([(1, 4, 4, {"ap": 20, "armor": "heavy"}), (2, 0, 0)], loot=[Loot(4, "armor", "light", 4, 5)])
        s = eng.resolve_turn(s, {1: step((4, 5))})
        self.assertEqual((s.player(1).ap, s.player(1).armor), (30, "light"))

    def test_afk_stands_and_takes_zone(self):
        s = board([(1, 0, 4), (2, 4, 4), (3, 5, 5)], stage=1, turn=5)
        s = eng.resolve_turn(s, {2: None})
        self.assertEqual((s.player(1).x, s.player(1).y, s.player(1).hp), (0, 4, 88))
        self.assertEqual(s.last_turn["moves"][2], ((4, 4), (4, 4)))

    def test_max_turns_ranks_alive_by_hp_then_armor(self):
        s = board([(1, 4, 4, {"hp": 50, "ap": 10}), (2, 3, 3, {"hp": 50, "ap": 30}), (3, 5, 5, {"hp": 70})], turn=eng.MAX_TURNS, stage=1)
        s = eng.resolve_turn(s, {})
        self.assertTrue(s.finished)
        self.assertEqual([(p.id, p.place) for p in s.places], [(3, 1), (2, 2), (1, 3)])

    def test_prev_state_not_mutated(self):
        s = eng.create_match("a4", 5, [1, 2, 3, 4])
        snap = copy.deepcopy(s)
        p = s.players[0]
        x, y = next((p.x + dx, p.y + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1) if (dx or dy) and eng.passable(s, p.x + dx, p.y + dy))
        eng.resolve_turn(s, {p.id: step((x, y))})
        self.assertEqual(s, snap)


class StrictValidationTest(unittest.TestCase):
    def setUp(self):
        self.s = board(
            [(1, 4, 4), (2, 6, 4), (3, 0, 0, {"alive": False, "hp": 0, "death_turn": 1}), (4, 8, 8, {"medkits": 1})],
            walls=[(5, 4), (4, 6)],
        )

    def code(self, pid, plan):
        with self.assertRaises(InvalidPlan) as cm:
            eng.validate_plan(self.s, pid, plan)
        return cm.exception.code

    def test_rejects(self):
        cases = [
            (1, step((6, 4)), "step_not_adjacent"),  # прыжок через клетку
            (1, step((4, 4)), "step_not_adjacent"),  # шаг на месте
            (1, step((5, 4)), "step_into_wall"),
            (1, step((4, 5), (4, 6)), "step_into_wall"),  # рывок в стену
            (1, step((5, 4), (6, 5)), "step_into_wall"),  # рывок сквозь стену
            (1, step((4, 5), (4, 7)), "step_not_adjacent"),  # рывок через стену прыжком
            (1, step((3, 4), (2, 4), (1, 4)), "path_too_long"),
            (1, step((3, 4), (2, 4), attack=2), "dash_no_attack"),
            (4, step((9, 8)), "step_out_of_bounds"),
            (4, step((8, 9)), "step_out_of_bounds"),
            (1, step(attack=1), "attack_self"),
            (1, step(attack=77), "attack_unknown"),
            (1, step(attack=3), "attack_dead"),
            (1, Plan(medkit=True), "no_medkit"),
            (4, Plan(path=((7, 7),), medkit=True), "medkit_exclusive"),
            (4, Plan(attack=1, medkit=True), "medkit_exclusive"),
            (3, step(), "player_dead"),
            (99, step(), "unknown_player"),
        ]
        for pid, plan, code in cases:
            with self.subTest(code=code, plan=plan):
                self.assertEqual(self.code(pid, plan), code)

    def test_accepts(self):
        for pid, plan in [
            (1, step()),
            (1, step(attack=2)),  # вне дальности — не ошибка, будет промах
            (1, step((3, 3), attack=2)),
            (1, step((4, 5), (3, 6))),
            (1, step((3, 4), (4, 4))),  # рывок туда-обратно (как в engine.js)
            (1, step((5, 5))),  # в клетку рядом со стеной по диагонали
            (4, Plan(medkit=True)),
        ]:
            with self.subTest(plan=plan):
                self.assertEqual(eng.validate_plan(self.s, pid, plan), plan)

    def test_resolve_rejects_invalid_and_keeps_state(self):
        snap = copy.deepcopy(self.s)
        with self.assertRaises(InvalidPlan) as cm:
            eng.resolve_turn(self.s, {1: step((3, 4)), 2: step((5, 4))})
        self.assertEqual(cm.exception.code, "step_into_wall")
        self.assertEqual(self.s, snap)
        with self.assertRaises(InvalidPlan):
            eng.resolve_turn(self.s, {3: step()})  # план мёртвого
        done = eng.resolve_turn(board([(1, 4, 4, {"hp": 5}), (2, 5, 4)]), {2: step(attack=1)})
        self.assertTrue(done.finished)
        with self.assertRaises(InvalidPlan) as cm:
            eng.resolve_turn(done, {})
        self.assertEqual(cm.exception.code, "match_finished")

    def test_parse_plan(self):
        self.assertEqual(eng.parse_plan({"path": [[3, 4], {"x": 2, "y": 4}], "attack": None}), step((3, 4), (2, 4)))
        self.assertEqual(eng.parse_plan({"medkit": True}), Plan(medkit=True))
        self.assertEqual(eng.parse_plan(None), eng.STAND)
        self.assertEqual(eng.parse_plan({}), eng.STAND)
        for raw in (
            "stand",
            [1, 2],
            {"path": [[1, 2]], "fire": 1},
            {"path": [[1.0, 2]]},
            {"path": [[True, 2]]},
            {"path": [[1, 2, 3]]},
            {"path": [{"x": 1}]},
            {"path": "1,2"},
            {"attack": "2"},
            {"attack": True},
            {"medkit": 1},
        ):
            with self.subTest(raw=raw):
                with self.assertRaises(InvalidPlan) as cm:
                    eng.parse_plan(raw)
                self.assertEqual(cm.exception.code, "bad_plan")


if __name__ == "__main__":
    unittest.main()

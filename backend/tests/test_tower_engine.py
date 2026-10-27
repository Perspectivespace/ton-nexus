"""«Башня»: Python-движок = JS-движку.

Общие векторы (seed, бустер, журнал тапов → ожидаемый итог) лежат в shared/tower-vectors.json: их пишет vitest
по JS-движку (frontend/src/lib/tower/vectors.test.ts). Здесь тот же журнал проигрывается портом на Python —
итог обязан совпасть до единицы. Запуск из backend: python -m unittest discover -s tests
"""

import json
import unittest
from pathlib import Path

from app.services import tower_engine as eng

VECTORS = json.loads((Path(__file__).resolve().parents[2] / "shared" / "tower-vectors.json").read_text(encoding="utf-8"))


class ParityTest(unittest.TestCase):
    def test_vectors_file_is_not_empty(self):
        self.assertEqual(VECTORS["version"], 1)
        self.assertGreaterEqual(len(VECTORS["cases"]), 30)
        names = {c["name"] for c in VECTORS["cases"]}
        self.assertEqual(len(names), len(VECTORS["cases"]))

    def test_config_matches_js(self):
        cfg = VECTORS["config"]
        for key, value in cfg.items():
            self.assertEqual(getattr(eng, key), value, key)

    def test_replay_matches_js_on_every_vector(self):
        for c in VECTORS["cases"]:
            with self.subTest(c["name"]):
                r = eng.replay(c["seed"], c["taps"], c["booster"])
                e = c["expected"]
                self.assertEqual(
                    (r.score, r.height, r.perfects, r.best_combo, r.over, r.accepted),
                    (e["score"], e["height"], e["perfects"], e["bestCombo"], e["over"], e["accepted"]),
                )


class EngineRulesTest(unittest.TestCase):
    def test_mulberry32_reference(self):
        g = eng.new_game(1)
        self.assertEqual(g.rng, (1 + 0x6D2B79F5) & 0xFFFFFFFF)
        self.assertEqual(g.phase, 2693262067 % (eng.SPAN * 2))
        self.assertEqual(g.phase, 947)

    def test_slow_booster_speed(self):
        self.assertEqual(eng.speed_for(0), 480)
        self.assertEqual(eng.speed_for(0, "slow"), 408)
        self.assertEqual(eng.speed_for(9, "slow"), (480 + 11 * 9) * 85 // 100)
        for placed in (10, 11, 50, 200):
            self.assertEqual(eng.speed_for(placed, "slow"), eng.speed_for(placed))
        for placed in (0, 3, 10, 100):
            self.assertEqual(eng.speed_for(placed, "aim"), eng.speed_for(placed))

    def test_aim_does_not_change_replay(self):
        case = next(c for c in VECTORS["cases"] if c["name"] == "s42-mixed-40")
        self.assertEqual(eng.replay(42, case["taps"], "aim"), eng.replay(42, case["taps"], None))

    def test_slow_changes_replay(self):
        case = next(c for c in VECTORS["cases"] if c["name"] == "s42-jitter-60")
        self.assertNotEqual(eng.replay(42, case["taps"], "slow"), eng.replay(42, case["taps"], None))

    def test_seed_is_masked_to_32_bits(self):
        self.assertEqual(eng.new_game(2**32 + 5).seed, 5)
        self.assertEqual(eng.new_game(2**32 + 5).phase, eng.new_game(5).phase)


if __name__ == "__main__":
    unittest.main()

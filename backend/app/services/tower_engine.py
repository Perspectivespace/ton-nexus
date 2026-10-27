"""«Башня»: игровая логика на сервере — точный порт frontend/src/lib/tower/engine.ts.

Результат забега целиком определяется (seed, booster, taps): seed выдаёт сервер при старте, taps — журнал тапов
в целых миллисекундах от начала забега по игровым часам клиента. Сервер проигрывает журнал этим же кодом и берёт
счёт из своего проигрывания, а не из присланного.

Вся арифметика целочисленная: JS-операции `>>>`, `Math.imul`, `|0` здесь — маски 32 бита, `Math.floor(a / b)` — `//`.
Правило игры меняется только вместе с JS-движком; общие векторы shared/tower-vectors.json (их пишет vitest)
проверяет tests/test_tower_engine.py — расхождение ловится тестом.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional, Sequence

Booster = Literal["slow", "aim"]
BOOSTERS: tuple[str, ...] = ("slow", "aim")

FIELD = 1000
BLOCK_H = 60
W0 = 360
RANGE = 440
PERFECT_TOL = 14
REGROW = 10
REGROW_FROM = 3
V0 = 480
DV = 11
VMAX = 1400
PTS_DROP = 1
PTS_PERFECT = 2
COMBO_CAP = 4
SLOW_BLOCKS = 10
SLOW_PCT = 85
AIM_BLOCKS = 5
SPAN = RANGE * 2

_M32 = 0xFFFFFFFF


@dataclass
class Game:
    seed: int
    booster: Optional[str]
    rng: int
    blocks: list[tuple[int, int]]  # (x, w), blocks[0] — опора
    score: int = 0
    combo: int = 0
    best_combo: int = 0
    perfects: int = 0
    over: bool = False
    spawn_t: int = 0
    w: int = W0
    phase: int = 0
    taps: list[int] = field(default_factory=list)


@dataclass(frozen=True)
class ReplayResult:
    score: int
    height: int  # сколько блоков поставлено (без опоры)
    perfects: int
    best_combo: int
    over: bool
    accepted: int  # сколько тапов из журнала принято (остальные после конца забега или «назад во времени» отброшены)


def _next(state: int) -> tuple[int, int]:
    """mulberry32: (следующее uint32, новое состояние)."""
    s = (state + 0x6D2B79F5) & _M32
    t = ((s ^ (s >> 15)) * (1 | s)) & _M32
    t = ((t + (((t ^ (t >> 7)) * (61 | t)) & _M32)) & _M32) ^ t
    return (t ^ (t >> 14)) & _M32, s


def _spawn(g: Game, t: int) -> None:
    r, s = _next(g.rng)
    g.rng = s
    g.spawn_t = t
    g.w = g.blocks[-1][1]
    g.phase = r % (SPAN * 2)


def new_game(seed: int, booster: Optional[str] = None) -> Game:
    seed &= _M32
    g = Game(seed=seed, booster=booster, rng=seed, blocks=[((FIELD - W0) // 2, W0)], w=W0)
    _spawn(g, 0)
    return g


def speed_for(placed: int, booster: Optional[str] = None) -> int:
    v = min(VMAX, V0 + DV * placed)
    if booster == "slow" and placed < SLOW_BLOCKS:
        return v * SLOW_PCT // 100
    return v


def _tri(d: int) -> int:
    m = d % (SPAN * 2)
    return m if m <= SPAN else SPAN * 2 - m


def slider_x(g: Game, t: int) -> int:
    dt = max(0, t - g.spawn_t)
    d = (speed_for(len(g.blocks) - 1, g.booster) * dt) // 1000 + g.phase
    return FIELD // 2 - RANGE - (g.w >> 1) + _tri(d)


def drop(g: Game, t: int) -> bool:
    """Тап в игровое время t (целые мс). False — тап не принят: забег окончен или время идёт назад."""
    if g.over or t < g.spawn_t:
        return False
    cur_x, cur_w = slider_x(g, t), g.w
    base_x, base_w = g.blocks[-1]
    g.taps.append(t)

    left = max(cur_x, base_x)
    right = min(cur_x + cur_w, base_x + base_w)
    if right <= left:
        g.over = True
        g.combo = 0
        return True

    if abs(cur_x - base_x) <= PERFECT_TOL:
        g.combo += 1
        g.perfects += 1
        g.best_combo = max(g.best_combo, g.combo)
        points = PTS_PERFECT + min(g.combo - 1, COMBO_CAP)
        px, pw = base_x, cur_w
        if g.combo >= REGROW_FROM:
            grow = min(REGROW, W0 - pw)
            px, pw = px - (grow >> 1), pw + grow
        g.score += points
        g.blocks.append((px, pw))
        _spawn(g, t)
        return True

    g.combo = 0
    g.score += PTS_DROP
    g.blocks.append((left, right - left))
    _spawn(g, t)
    return True


def replay(seed: int, taps: Sequence[int], booster: Optional[str] = None) -> ReplayResult:
    """Проиграть забег заново по seed, бустеру и журналу тапов."""
    g = new_game(seed, booster)
    for t in taps:
        if not drop(g, t):
            break
    return ReplayResult(
        score=g.score,
        height=len(g.blocks) - 1,
        perfects=g.perfects,
        best_combo=g.best_combo,
        over=g.over,
        accepted=len(g.taps),
    )

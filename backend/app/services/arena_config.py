"""«Арена»: таблица комнат — единственное место, где заданы ставка, комиссия, призы и время набора.

Все суммы — в нанотонах (1 TON = 10^9). Призы — доля банка комнаты (ставка × мест) по местам:
a4 — 1-е место 36 % банка (0,36 TON), a8 — 1-е 50 % (0,50 TON), 2-е 22 % (0,22 TON).
Остальное (10 %) — комиссия платформы. Условия копируются в комнату при её создании.
"""

from dataclasses import dataclass

NANO_PER_TON = 10**9
# баланс хранится как Numeric(18,8) в TON → наименьшая сумма, которую можно провести через balance, — 10 нанотонов
LEDGER_QUANTUM_NANO = 10

# время набора комнаты: не набралась за 180 с — всем возврат ставки
FILL_TIMEOUT_S = 180


@dataclass(frozen=True)
class ArenaRoomType:
    code: str
    seats: int
    board: int  # сторона поля (9×9, 11×11) — для движка из следующих PR
    stake_nano: int
    commission_bps: int  # 1000 = 10 %
    prizes_nano: tuple[int, ...]  # приз за 1-е, 2-е, … место; места дальше — без приза

    @property
    def pot_nano(self) -> int:
        return self.stake_nano * self.seats


ARENA_ROOMS: dict[str, ArenaRoomType] = {
    "a4": ArenaRoomType(
        code="a4", seats=4, board=9, stake_nano=100_000_000, commission_bps=1000, prizes_nano=(360_000_000,)
    ),
    "a8": ArenaRoomType(
        code="a8",
        seats=8,
        board=11,
        stake_nano=100_000_000,
        commission_bps=1000,
        prizes_nano=(500_000_000, 220_000_000),
    ),
}


def room_type(code: str) -> ArenaRoomType:
    try:
        return ARENA_ROOMS[code]
    except KeyError:
        raise ValueError(f"unknown arena room type: {code!r}") from None


def _check(ok: bool, code: str, what: str) -> None:
    if not ok:
        raise RuntimeError(f"arena_config: комната {code}: {what}")


def _validate() -> None:
    for rt in ARENA_ROOMS.values():
        _check(rt.seats >= 2 and 0 < len(rt.prizes_nano) < rt.seats, rt.code, "места и призы")
        _check(rt.stake_nano > 0 and rt.stake_nano % LEDGER_QUANTUM_NANO == 0, rt.code, "ставка")
        _check(all(p > 0 and p % LEDGER_QUANTUM_NANO == 0 for p in rt.prizes_nano), rt.code, "призы")
        _check((rt.pot_nano * rt.commission_bps) % 10_000 == 0, rt.code, "комиссия не целая")
        # призы + комиссия = банк, ровно
        _check(sum(rt.prizes_nano) + rt.pot_nano * rt.commission_bps // 10_000 == rt.pot_nano, rt.code, "сумма")


_validate()

"""«Арена»: таблица комнат — единственное место, где заданы ставка, комиссия, призы и время набора.

Все суммы — в нанотонах (1 TON = 10^9). Комиссия платформы — в bp (1000 = 10 %), её задаёт владелец
в настройке «arena» (commission_bp, 0…30 %); здесь — значение по умолчанию. Призовой фонд = банк
(ставка × мест) − комиссия; он делится между призовыми местами по весам: a4 — всё 1-му месту,
a8 — 50 : 22. При комиссии 10 % это ровно 0,36 TON (a4) и 0,50 / 0,22 TON (a8).
Призы округляются вниз до 10 нанотонов, пыль остаётся в комиссии. Комиссия копируется в комнату
при её создании: смена настройки не трогает уже собранные комнаты.
"""

from dataclasses import dataclass

NANO_PER_TON = 10**9
# баланс хранится как Numeric(18,8) в TON → наименьшая сумма, которую можно провести через balance, — 10 нанотонов
LEDGER_QUANTUM_NANO = 10

# комиссия по умолчанию и допустимые границы настройки (bp)
DEFAULT_COMMISSION_BPS = 1000
MIN_COMMISSION_BPS = 0
MAX_COMMISSION_BPS = 3000

# время набора комнаты: не набралась за 180 с — всем возврат ставки
FILL_TIMEOUT_S = 180


@dataclass(frozen=True)
class ArenaRoomType:
    code: str
    seats: int
    board: int  # сторона поля (9×9, 11×11) — для движка из следующих PR
    stake_nano: int
    prize_weights: tuple[int, ...]  # доли призового фонда за 1-е, 2-е, … место; места дальше — без приза
    commission_bps: int = DEFAULT_COMMISSION_BPS  # 1000 = 10 %

    @property
    def pot_nano(self) -> int:
        return self.stake_nano * self.seats

    @property
    def prizes_nano(self) -> tuple[int, ...]:
        """Призы при комиссии по умолчанию."""
        return prizes_for(self, self.commission_bps)


ARENA_ROOMS: dict[str, ArenaRoomType] = {
    "a4": ArenaRoomType(code="a4", seats=4, board=9, stake_nano=100_000_000, prize_weights=(1,)),
    "a8": ArenaRoomType(code="a8", seats=8, board=11, stake_nano=100_000_000, prize_weights=(50, 22)),
}


def clamp_commission_bps(v: object) -> int:
    """Комиссия из настройки → целые bp в границах; мусор — значение по умолчанию."""
    if isinstance(v, bool):
        return DEFAULT_COMMISSION_BPS
    try:
        n = int(v)  # type: ignore[call-overload]
    except (TypeError, ValueError):
        return DEFAULT_COMMISSION_BPS
    return min(max(n, MIN_COMMISSION_BPS), MAX_COMMISSION_BPS)


def prizes_for(rt: "ArenaRoomType", commission_bps: int) -> tuple[int, ...]:
    """Призы по местам при комиссии commission_bps: фонд = банк × (1 − комиссия), по весам, вниз до кванта."""
    bps = clamp_commission_bps(commission_bps)
    pool = rt.pot_nano * (10_000 - bps) // 10_000
    total = sum(rt.prize_weights)
    q = LEDGER_QUANTUM_NANO
    return tuple(pool * w // total // q * q for w in rt.prize_weights)


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
        _check(rt.seats >= 2 and 0 < len(rt.prize_weights) < rt.seats, rt.code, "места и призы")
        _check(all(w > 0 for w in rt.prize_weights), rt.code, "веса призов")
        _check(rt.stake_nano > 0 and rt.stake_nano % LEDGER_QUANTUM_NANO == 0, rt.code, "ставка")
        _check(all(p > 0 and p % LEDGER_QUANTUM_NANO == 0 for p in rt.prizes_nano), rt.code, "призы")
        _check((rt.pot_nano * rt.commission_bps) % 10_000 == 0, rt.code, "комиссия не целая")
        # при комиссии по умолчанию призы + комиссия = банк, ровно
        _check(sum(rt.prizes_nano) + rt.pot_nano * rt.commission_bps // 10_000 == rt.pot_nano, rt.code, "сумма")
        # при любой допустимой комиссии призы не превышают фонд, у 1-го места приз есть
        for bps in (MIN_COMMISSION_BPS, MAX_COMMISSION_BPS):
            ps = prizes_for(rt, bps)
            _check(ps[0] > 0 and sum(ps) <= rt.pot_nano * (10_000 - bps) // 10_000, rt.code, f"призы при {bps} bp")


_validate()

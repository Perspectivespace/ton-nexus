"""Тариф заданий — настройка `task_tariff` (расчёт; создание/публикация заданий его ещё не читает).

Три типа заданий (без уровней сложности):

- ``visit`` «Переход на сторонний ресурс» — цену и комиссию задаёт тариф.
  Исполнитель получает ``reward`` TON за выполнение; заказчик платит
  ``reward × slots + commission`` (commission_bp % сверху). Создавать могут
  пользователи и амбассадоры (когда подключим).
- ``campaign`` «Кампания» — цену вводит владелец вручную на задании; в тарифе
  только комиссия по умолчанию (bp) и XP. Только владелец.
- ``partner`` «Партнёрская услуга» — покупатель (исполнитель) платит сумму
  из баланса в приложении; партнёр получает сумму минус ``fee_bp`` % платформы.
  Только владелец.

Комиссия по типам живёт в ``task_tariff`` (visit.commission_bp, campaign.commission_bp,
partner.fee_bp), чтобы на экране тарифа было видно «стоимость и комиссию владельца».
Старый ключ ``task_platform_commission_bp`` — запасной для уже опубликованных заданий
старого формата, пока их не перенесём; для новых типов источник правды — тариф.

Суммы в расчёте — целые нанотоны (1 TON = 10⁹), кратные LEDGER_QUANTUM_NANO (10),
чтобы совпасть с Numeric(18, 8) баланса.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any

KEY = "task_tariff"
TYPES = ("visit", "campaign", "partner")

NANO_PER_TON = 10**9
LEDGER_QUANTUM_NANO = 10
MAX_REWARD_NANO = 100 * NANO_PER_TON
MAX_AMOUNT_NANO = 10_000 * NANO_PER_TON
MAX_XP = 100_000
MAX_SLOTS = 10_000
MIN_SLOTS = 1
MAX_BP = 10_000

DEFAULT: dict[str, Any] = {
    "visit": {
        "reward": "0.01",
        "commission_bp": 1000,
        "xp": 5,
        "min_slots": 1,
        "max_slots": 10_000,
    },
    "campaign": {
        "commission_bp": 1000,
        "xp": 10,
    },
    "partner": {
        "fee_bp": 1000,
        "xp": 5,
    },
}


class TaskTariffError(ValueError):
    pass


def ton_to_nano(value: Any, *, name: str = "сумма", allow_zero: bool = False) -> int:
    """Строка TON → нанотоны; не больше 8 знаков после точки, кратно кванту баланса."""
    if isinstance(value, bool) or not isinstance(value, (str, int, Decimal)):
        raise TaskTariffError(f"{name}: сумма TON строкой, например \"0.01\"")
    s = str(value).strip().replace(",", ".")
    try:
        d = Decimal(s)
    except InvalidOperation as e:
        raise TaskTariffError(f"{name}: сумма TON — число") from e
    if not d.is_finite():
        raise TaskTariffError(f"{name}: сумма TON — число")
    if d < 0 or (d == 0 and not allow_zero):
        raise TaskTariffError(f"{name}: должна быть больше 0")
    if d == 0:
        return 0
    scaled = d * NANO_PER_TON
    if scaled != scaled.to_integral_value():
        raise TaskTariffError(f"{name}: не больше 9 знаков после точки")
    nano = int(scaled)
    if nano % LEDGER_QUANTUM_NANO != 0:
        raise TaskTariffError(f"{name}: не больше 8 знаков после точки")
    return nano


def nano_to_ton(nano: int) -> str:
    if nano < 0:
        raise TaskTariffError("отрицательная сумма")
    whole, frac = divmod(int(nano), NANO_PER_TON)
    f = f"{frac:09d}".rstrip("0")
    return f"{whole}.{f}" if f else f"{whole}"


def _bp(v: Any, name: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise TaskTariffError(f"{name}: целые bp (1000 = 10%)")
    if not 0 <= v <= MAX_BP:
        raise TaskTariffError(f"{name}: от 0 до {MAX_BP} bp")
    return v


def _xp(v: Any, name: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise TaskTariffError(f"{name}: XP — целое число")
    if not 0 <= v <= MAX_XP:
        raise TaskTariffError(f"{name}: XP от 0 до {MAX_XP}")
    return v


def _slots(v: Any, name: str) -> int:
    if isinstance(v, bool) or not isinstance(v, int):
        raise TaskTariffError(f"{name}: целое число")
    if not MIN_SLOTS <= v <= MAX_SLOTS:
        raise TaskTariffError(f"{name}: от {MIN_SLOTS} до {MAX_SLOTS}")
    return v


def _commission_nano(payout_nano: int, bp: int) -> int:
    """floor(payout × bp / 10000) вниз до кванта баланса."""
    raw = payout_nano * bp // 10_000
    return raw - (raw % LEDGER_QUANTUM_NANO)


def normalize(value: Any) -> dict[str, Any]:
    """Канонический тариф: три типа, строки TON, int bp/XP/места."""
    if not isinstance(value, dict):
        raise TaskTariffError("Тариф заданий должен быть объектом")
    extra = set(value) - set(TYPES)
    if extra:
        raise TaskTariffError(f"тариф: лишние поля {sorted(extra)}")
    missing = [t for t in TYPES if t not in value]
    if missing:
        raise TaskTariffError(f"тариф: нет типа {', '.join(missing)}")

    out: dict[str, Any] = {}

    visit = value["visit"]
    if not isinstance(visit, dict):
        raise TaskTariffError("visit: нужен объект")
    extra_v = set(visit) - {"reward", "commission_bp", "xp", "min_slots", "max_slots"}
    if extra_v:
        raise TaskTariffError(f"visit: лишние поля {sorted(extra_v)}")
    reward_nano = ton_to_nano(visit.get("reward"), name="visit · цена выполнения")
    if reward_nano > MAX_REWARD_NANO:
        raise TaskTariffError("visit · цена выполнения: не больше 100 TON")
    min_slots = _slots(visit.get("min_slots", MIN_SLOTS), "visit · min_slots")
    max_slots = _slots(visit.get("max_slots", MAX_SLOTS), "visit · max_slots")
    if min_slots > max_slots:
        raise TaskTariffError("visit: min_slots не может быть больше max_slots")
    out["visit"] = {
        "reward": nano_to_ton(reward_nano),
        "commission_bp": _bp(visit.get("commission_bp"), "visit · комиссия"),
        "xp": _xp(visit.get("xp"), "visit · XP"),
        "min_slots": min_slots,
        "max_slots": max_slots,
    }

    campaign = value["campaign"]
    if not isinstance(campaign, dict):
        raise TaskTariffError("campaign: нужен объект")
    extra_c = set(campaign) - {"commission_bp", "xp"}
    if extra_c:
        raise TaskTariffError(f"campaign: лишние поля {sorted(extra_c)}")
    out["campaign"] = {
        "commission_bp": _bp(campaign.get("commission_bp"), "campaign · комиссия"),
        "xp": _xp(campaign.get("xp"), "campaign · XP"),
    }

    partner = value["partner"]
    if not isinstance(partner, dict):
        raise TaskTariffError("partner: нужен объект")
    extra_p = set(partner) - {"fee_bp", "xp"}
    if extra_p:
        raise TaskTariffError(f"partner: лишние поля {sorted(extra_p)}")
    out["partner"] = {
        "fee_bp": _bp(partner.get("fee_bp"), "partner · комиссия с продажи"),
        "xp": _xp(partner.get("xp"), "partner · XP"),
    }
    return out


@dataclass(frozen=True)
class VisitQuote:
    slots: int
    reward_nano: int
    payout_nano: int
    commission_nano: int
    total_nano: int
    xp: int
    commission_bp: int

    @property
    def reward(self) -> str:
        return nano_to_ton(self.reward_nano)

    @property
    def payout(self) -> str:
        return nano_to_ton(self.payout_nano)

    @property
    def commission(self) -> str:
        return nano_to_ton(self.commission_nano)

    @property
    def total(self) -> str:
        return nano_to_ton(self.total_nano)


@dataclass(frozen=True)
class PartnerQuote:
    amount_nano: int
    fee_nano: int
    partner_gets_nano: int
    xp: int
    fee_bp: int

    @property
    def amount(self) -> str:
        return nano_to_ton(self.amount_nano)

    @property
    def fee(self) -> str:
        return nano_to_ton(self.fee_nano)

    @property
    def partner_gets(self) -> str:
        return nano_to_ton(self.partner_gets_nano)


def quote_visit(tariff: dict[str, Any], *, slots: int) -> VisitQuote:
    """Заказчик платит payout + commission; исполнители суммарно получают payout."""
    cfg = normalize(tariff)["visit"]
    if isinstance(slots, bool) or not isinstance(slots, int):
        raise TaskTariffError("число выполнений — целое")
    if not cfg["min_slots"] <= slots <= cfg["max_slots"]:
        raise TaskTariffError(f"число выполнений: от {cfg['min_slots']} до {cfg['max_slots']}")
    reward_nano = ton_to_nano(cfg["reward"], name="цена")
    payout_nano = reward_nano * slots
    bp = int(cfg["commission_bp"])
    commission_nano = _commission_nano(payout_nano, bp)
    return VisitQuote(
        slots=slots,
        reward_nano=reward_nano,
        payout_nano=payout_nano,
        commission_nano=commission_nano,
        total_nano=payout_nano + commission_nano,
        xp=int(cfg["xp"]),
        commission_bp=bp,
    )


def quote_campaign(
    tariff: dict[str, Any],
    *,
    reward: Any,
    slots: int,
    commission_bp: Any = None,
) -> VisitQuote:
    """Кампания: награду вводит владелец вручную; комиссия — override или тариф.

    Заказчик платит reward × slots + commission; payout + commission == total до нанотона.
    """
    cfg = normalize(tariff)["campaign"]
    reward_nano = ton_to_nano(reward, name="награда за выполнение")
    if reward_nano > MAX_REWARD_NANO:
        raise TaskTariffError("награда за выполнение: не больше 100 TON")
    slots = _slots(slots, "число выполнений")
    bp = int(cfg["commission_bp"]) if commission_bp is None else _bp(commission_bp, "комиссия")
    payout_nano = reward_nano * slots
    commission_nano = _commission_nano(payout_nano, bp)
    return VisitQuote(
        slots=slots,
        reward_nano=reward_nano,
        payout_nano=payout_nano,
        commission_nano=commission_nano,
        total_nano=payout_nano + commission_nano,
        xp=int(cfg["xp"]),
        commission_bp=bp,
    )


def quote_partner(tariff: dict[str, Any], *, amount: Any) -> PartnerQuote:
    """Покупатель платит amount; партнёр получает amount − fee; fee — платформе."""
    cfg = normalize(tariff)["partner"]
    amount_nano = ton_to_nano(amount, name="сумма покупки")
    if amount_nano > MAX_AMOUNT_NANO:
        raise TaskTariffError("сумма покупки: не больше 10000 TON")
    bp = int(cfg["fee_bp"])
    fee_nano = _commission_nano(amount_nano, bp)
    partner_gets_nano = amount_nano - fee_nano
    if partner_gets_nano < 0:
        raise TaskTariffError("комиссия больше суммы")
    return PartnerQuote(
        amount_nano=amount_nano,
        fee_nano=fee_nano,
        partner_gets_nano=partner_gets_nano,
        xp=int(cfg["xp"]),
        fee_bp=bp,
    )

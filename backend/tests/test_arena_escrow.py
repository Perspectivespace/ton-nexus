"""«Арена»: эскроу ставок — вход (холд), выход, возврат по таймауту набора, расчёт призов, общие места, округление.

Последовательные проверки — на SQLite в памяти (всегда).
Параллельные — на настоящем Postgres, только если задан TEST_PG_URL (как в tests/test_double_payouts.py).
ВНИМАНИЕ: параллельный тест пересоздаёт все таблицы в этой базе — только локальная пустая тестовая база.
"""

import asyncio
import itertools
import os
import random
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import ArenaEntry, ArenaRoom, BalanceHistory, User
from app.services import arena_escrow as ae
from app.services import balance_history as bh
from app.services.arena_config import ARENA_ROOMS, FILL_TIMEOUT_S, NANO_PER_TON

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")

D = Decimal
UTC = timezone.utc
NOW = datetime(2026, 11, 2, 12, 0, tzinfo=UTC)
PG_URL = os.environ.get("TEST_PG_URL")


def run_sqlite(fn):
    async def main():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        try:
            async with async_sessionmaker(engine, expire_on_commit=False, autoflush=False)() as s:
                await fn(s)
        finally:
            await engine.dispose()

    asyncio.run(main())


_TG = itertools.count(1000)


async def users(s, n, balance="1"):
    out = [User(telegram_id=next(_TG), balance=D(balance)) for _ in range(n)]
    s.add_all(out)
    await s.flush()
    return [u.id for u in out]


async def bal(s, uid) -> Decimal:
    await s.flush()
    return D(await s.scalar(select(User.balance).where(User.id == uid).execution_options(populate_existing=True)))


async def ledger(s, uid=None, balance_type=None):
    q = select(BalanceHistory).order_by(BalanceHistory.id)
    if uid is not None:
        q = q.where(BalanceHistory.user_id == uid)
    if balance_type is not None:
        q = q.where(BalanceHistory.balance_type == balance_type)
    return list((await s.scalars(q)).all())


async def full_room(s, code, *, balance="1"):
    rt = ARENA_ROOMS[code]
    ids = await users(s, rt.seats, balance)
    room = await ae.create_room(s, code, now=NOW)
    for uid in ids:
        await ae.join(s, room_id=room.id, user_id=uid, now=NOW)
    await ae.start(s, room.id, now=NOW + timedelta(seconds=5))
    return room, ids


class ConfigTests(unittest.TestCase):
    def test_room_table(self):
        a4, a8 = ARENA_ROOMS["a4"], ARENA_ROOMS["a8"]
        self.assertEqual((a4.seats, a4.stake_nano, a4.commission_bps, a4.prizes_nano), (4, 10**8, 1000, (36 * 10**7,)))
        self.assertEqual(a8.prizes_nano, (50 * 10**7, 22 * 10**7))
        self.assertEqual(FILL_TIMEOUT_S, 180)
        for rt in ARENA_ROOMS.values():
            self.assertEqual(sum(rt.prizes_nano) + rt.pot_nano * rt.commission_bps // 10_000, rt.pot_nano)

    def test_nano_to_ton(self):
        self.assertEqual(ae.nano_to_ton(100_000_000), D("0.1"))
        self.assertEqual(ae.nano_to_ton(73_333_330), D("0.07333333"))
        with self.assertRaises(ValueError):
            ae.nano_to_ton(73_333_333)

    def test_history_labels(self):
        for op, bt in (("debit", "arena_hold"), ("credit", "arena_refund"), ("credit", "arena_prize")):
            k = bh.kind_of(op, bt)
            self.assertEqual(k, bt)
            self.assertIn(k, bh.LABELS)


class SplitTests(unittest.TestCase):
    A4 = ARENA_ROOMS["a4"].prizes_nano
    A8 = ARENA_ROOMS["a8"].prizes_nano

    def test_plain(self):
        self.assertEqual(ae.split_prizes(self.A4, {1: 1, 2: 2, 3: 3, 4: 4}), {1: 360_000_000, 2: 0, 3: 0, 4: 0})
        got = ae.split_prizes(self.A8, {u: u for u in range(1, 9)})
        self.assertEqual((got[1], got[2]), (500_000_000, 220_000_000))
        self.assertEqual(sum(got.values()), 720_000_000)

    def test_ties(self):
        # двое на 1-м месте в a8: (0.50 + 0.22) / 2
        got = ae.split_prizes(self.A8, {1: 1, 2: 1, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8})
        self.assertEqual((got[1], got[2], got[3]), (360_000_000, 360_000_000, 0))
        # трое на 2-м месте: 0.22 / 3 = 0.0733333333… → вниз до 10 нано
        got = ae.split_prizes(self.A8, {1: 1, 2: 2, 3: 2, 4: 2, 5: 5, 6: 6, 7: 7, 8: 8})
        self.assertEqual(got[1], 500_000_000)
        self.assertEqual({got[2], got[3], got[4]}, {73_333_330})
        # все четверо вместе в a4
        self.assertEqual(set(ae.split_prizes(self.A4, {1: 1, 2: 1, 3: 1, 4: 1}).values()), {90_000_000})
        # двое на 2-м в a4 — призов за 2-е нет
        self.assertEqual(ae.split_prizes(self.A4, {1: 1, 2: 2, 3: 2, 4: 4}), {1: 360_000_000, 2: 0, 3: 0, 4: 0})

    def test_bad_places(self):
        for bad in ({1: 1, 2: 1, 3: 2, 4: 4}, {1: 2, 2: 3, 3: 4, 4: 5}, {1: 0, 2: 1, 3: 2, 4: 3}, {}, {1: "1"}):
            with self.assertRaises(ae.ArenaPlacementError, msg=bad):
                ae.split_prizes(self.A4, bad)

    def test_rounding_invariant_all_tie_patterns(self):
        """Любое разбиение на общие места: призы кратны 10 нано, призы + комиссия = банк ровно, призы ≤ таблицы."""
        for code, rt in ARENA_ROOMS.items():
            n = rt.seats
            # все композиции n (размеры групп по местам подряд)
            for cuts in itertools.product((0, 1), repeat=n - 1):
                sizes, cur = [], 1
                for c in cuts:
                    if c:
                        sizes.append(cur)
                        cur = 1
                    else:
                        cur += 1
                sizes.append(cur)
                placements, pos, uid = {}, 1, 1
                for k in sizes:
                    for _ in range(k):
                        placements[uid] = pos
                        uid += 1
                    pos += k
                got = ae.split_prizes(rt.prizes_nano, placements)
                paid = sum(got.values())
                commission = rt.pot_nano - paid
                self.assertTrue(all(v % 10 == 0 for v in got.values()), (code, sizes))
                self.assertEqual(paid + commission, rt.pot_nano)
                self.assertLessEqual(paid, sum(rt.prizes_nano))
                self.assertLess(sum(rt.prizes_nano) - paid, 10 * n, (code, sizes))  # остаток — пыль


class EscrowTests(unittest.TestCase):
    def test_join_holds_stake(self):
        async def body(s):
            (u,) = await users(s, 1, "1")
            room = await ae.create_room(s, "a4", now=NOW)
            self.assertEqual(room.fill_deadline, NOW + timedelta(seconds=180))
            self.assertEqual(len(room.seed_hash), 64)
            self.assertEqual(room.seed_hash, ae.seed_commit(room.seed, room.seed_salt))
            e = await ae.join(s, room_id=room.id, user_id=u, now=NOW)
            self.assertEqual((e.seat, e.status, e.held_nano), (0, "held", 100_000_000))
            self.assertEqual(await bal(s, u), D("0.9"))
            (h,) = await ledger(s, u)
            self.assertEqual((h.operation_type, h.balance_type, D(h.amount)), ("debit", "arena_hold", D("0.1")))
            self.assertEqual((h.reference_type, h.reference_id), ("arena_entry", e.id))
        run_sqlite(body)

    def test_double_join_no_second_debit(self):
        async def body(s):
            (u,) = await users(s, 1, "1")
            room = await ae.create_room(s, "a4", now=NOW)
            e = await ae.join(s, room_id=room.id, user_id=u, now=NOW)
            with self.assertRaises(ae.ArenaAlreadyJoined) as cm:
                await ae.join(s, room_id=room.id, user_id=u, now=NOW)
            self.assertEqual(cm.exception.entry_id, e.id)
            self.assertEqual(await bal(s, u), D("0.9"))
            self.assertEqual(len(await ledger(s, u)), 1)
        run_sqlite(body)

    def test_insufficient_funds(self):
        async def body(s):
            (u,) = await users(s, 1, "0.09999999")
            room = await ae.create_room(s, "a4", now=NOW)
            with self.assertRaises(ae.ArenaInsufficientBalance):
                await ae.join(s, room_id=room.id, user_id=u, now=NOW)
            self.assertEqual(await bal(s, u), D("0.09999999"))
            self.assertEqual(await s.scalar(select(func.count()).select_from(ArenaEntry)), 0)
            self.assertEqual(await ledger(s, u), [])
        run_sqlite(body)

    def test_full_room(self):
        async def body(s):
            ids = await users(s, 5)
            room = await ae.create_room(s, "a4", now=NOW)
            for uid in ids[:4]:
                await ae.join(s, room_id=room.id, user_id=uid, now=NOW)
            with self.assertRaises(ae.ArenaRoomFull):
                await ae.join(s, room_id=room.id, user_id=ids[4], now=NOW)
            self.assertEqual(await bal(s, ids[4]), D("1"))
            seats = sorted((await s.scalars(select(ArenaEntry.seat))).all())
            self.assertEqual(seats, [0, 1, 2, 3])
        run_sqlite(body)

    def test_leave_refund_and_rejoin(self):
        async def body(s):
            a, b, c = await users(s, 3)
            room = await ae.create_room(s, "a4", now=NOW)
            await ae.join(s, room_id=room.id, user_id=a, now=NOW)
            await ae.join(s, room_id=room.id, user_id=b, now=NOW)
            e = await ae.leave(s, room_id=room.id, user_id=a, now=NOW)
            self.assertEqual((e.status, e.seat), ("refunded", None))
            self.assertEqual(await bal(s, a), D("1"))
            kinds = [(h.operation_type, h.balance_type) for h in await ledger(s, a)]
            self.assertEqual(kinds, [("debit", "arena_hold"), ("credit", "arena_refund")])
            with self.assertRaises(ae.ArenaNotJoined):  # второй выход — без второго возврата
                await ae.leave(s, room_id=room.id, user_id=a, now=NOW)
            self.assertEqual(await bal(s, a), D("1"))
            # освободившееся место 0 занимает следующий; вышедший может вернуться (та же строка)
            self.assertEqual((await ae.join(s, room_id=room.id, user_id=c, now=NOW)).seat, 0)
            again = await ae.join(s, room_id=room.id, user_id=a, now=NOW)
            self.assertEqual((again.id, again.seat, again.status), (e.id, 2, "held"))
            self.assertEqual(await bal(s, a), D("0.9"))
        run_sqlite(body)

    def test_no_leave_or_join_after_start(self):
        async def body(s):
            room, ids = await full_room(s, "a4")
            (extra,) = await users(s, 1)
            with self.assertRaises(ae.ArenaStateError):
                await ae.leave(s, room_id=room.id, user_id=ids[0])
            with self.assertRaises(ae.ArenaStateError):
                await ae.join(s, room_id=room.id, user_id=extra)
            self.assertEqual((await ae.start(s, room.id)).status, "running")  # повтор start — без изменений
        run_sqlite(body)

    def test_start_needs_full_room(self):
        async def body(s):
            (u,) = await users(s, 1)
            room = await ae.create_room(s, "a4", now=NOW)
            await ae.join(s, room_id=room.id, user_id=u, now=NOW)
            with self.assertRaises(ae.ArenaStateError):
                await ae.start(s, room.id, now=NOW)
        run_sqlite(body)

    def test_timeout_refund_all_idempotent(self):
        async def body(s):
            ids = await users(s, 3)
            room = await ae.create_room(s, "a8", now=NOW)
            for uid in ids:
                await ae.join(s, room_id=room.id, user_id=uid, now=NOW)
            # до дедлайна — ничего
            self.assertEqual(await ae.refund_if_expired(s, room.id, now=NOW + timedelta(seconds=179)), 0)
            late = NOW + timedelta(seconds=180)
            # вход в просроченную комнату — отказ без списания
            (late_user,) = await users(s, 1)
            with self.assertRaises(ae.ArenaRoomExpired):
                await ae.join(s, room_id=room.id, user_id=late_user, now=late)
            self.assertEqual(await bal(s, late_user), D("1"))
            self.assertEqual(await ae.refund_expired(s, now=late), 3)
            for _ in range(3):  # повторы — ничего
                self.assertEqual(await ae.refund_if_expired(s, room.id, now=late), 0)
                self.assertEqual(await ae.refund_expired(s, now=late), 0)
                self.assertEqual(await ae.cancel(s, room.id, now=late), 0)
            await s.refresh(room)
            self.assertEqual((room.status, room.commission_nano), ("refunded", 0))
            for uid in ids:
                self.assertEqual(await bal(s, uid), D("1"))
                self.assertEqual(len(await ledger(s, uid, "arena_refund")), 1)
            with self.assertRaises(ae.ArenaStateError):
                await ae.join(s, room_id=room.id, user_id=late_user, now=late)
        run_sqlite(body)

    def test_full_room_not_refunded_on_timeout(self):
        async def body(s):
            ids = await users(s, 4)
            room = await ae.create_room(s, "a4", now=NOW)
            for uid in ids:
                await ae.join(s, room_id=room.id, user_id=uid, now=NOW)
            self.assertEqual(await ae.refund_if_expired(s, room.id, now=NOW + timedelta(hours=1)), 0)
            self.assertEqual(room.status, "waiting")
        run_sqlite(body)

    def test_settle_a4(self):
        async def body(s):
            room, ids = await full_room(s, "a4")
            res = await ae.settle(s, room.id, {ids[0]: 4, ids[1]: 1, ids[2]: 3, ids[3]: 2}, now=NOW + timedelta(minutes=3))
            self.assertEqual(res.prizes_nano, {ids[1]: 360_000_000})
            self.assertEqual((res.pot_nano, res.commission_nano, res.already), (400_000_000, 40_000_000, False))
            self.assertEqual(await bal(s, ids[1]), D("1.26"))
            for uid in (ids[0], ids[2], ids[3]):
                self.assertEqual(await bal(s, uid), D("0.9"))
            await s.refresh(room)
            self.assertEqual((room.status, room.commission_nano), ("finished", 40_000_000))
            statuses = {e.user_id: (e.status, e.place) for e in (await s.scalars(select(ArenaEntry))).all()}
            self.assertEqual(statuses[ids[1]], ("paid", 1))
            self.assertEqual(statuses[ids[0]], ("lost", 4))
            (p,) = await ledger(s, ids[1], "arena_prize")
            self.assertEqual((D(p.amount), p.description), (D("0.36"), f"Комната #{room.id}, 1 место"))
            self.assertEqual(await ae.house_revenue_nano(s), 40_000_000)
        run_sqlite(body)

    def test_settle_a8_and_idempotent(self):
        async def body(s):
            room, ids = await full_room(s, "a8")
            places = {uid: i + 1 for i, uid in enumerate(ids)}
            res = await ae.settle(s, room.id, places)
            self.assertEqual(res.prizes_nano, {ids[0]: 500_000_000, ids[1]: 220_000_000})
            self.assertEqual(res.commission_nano, 80_000_000)
            again = await ae.settle(s, room.id, places)
            self.assertTrue(again.already)
            self.assertEqual((again.prizes_nano, again.commission_nano, again.pot_nano), (res.prizes_nano, 80_000_000, 800_000_000))
            self.assertEqual(len(await ledger(s, balance_type="arena_prize")), 2)
            self.assertEqual(await bal(s, ids[0]), D("1.4"))
            self.assertEqual(await bal(s, ids[1]), D("1.12"))
            with self.assertRaises(ae.ArenaStateError):
                await ae.cancel(s, room.id)
        run_sqlite(body)

    def test_settle_tie_with_dust(self):
        async def body(s):
            room, ids = await full_room(s, "a8")
            places = {ids[0]: 1, ids[1]: 2, ids[2]: 2, ids[3]: 2, ids[4]: 5, ids[5]: 6, ids[6]: 7, ids[7]: 8}
            res = await ae.settle(s, room.id, places)
            self.assertEqual(res.prizes_nano, {ids[0]: 500_000_000, ids[1]: 73_333_330, ids[2]: 73_333_330, ids[3]: 73_333_330})
            self.assertEqual(res.commission_nano, 80_000_010)  # 10 нано пыли — в комиссию
            for uid in ids[1:4]:
                self.assertEqual(await bal(s, uid), D("0.97333333"))
            # деньги сходятся: сумма всех проводок «Арены» = −комиссия
            hist = await ledger(s)
            net = sum((D(h.amount) if h.operation_type == "credit" else -D(h.amount)) for h in hist)
            self.assertEqual(net * NANO_PER_TON, -res.commission_nano)
        run_sqlite(body)

    def test_settle_validation(self):
        async def body(s):
            room, ids = await full_room(s, "a4")
            (stranger,) = await users(s, 1)
            for bad in ({ids[0]: 1, ids[1]: 2, ids[2]: 3}, {ids[0]: 1, ids[1]: 2, ids[2]: 3, stranger: 4}):
                with self.assertRaises(ae.ArenaPlacementError):
                    await ae.settle(s, room.id, bad)
            await s.refresh(room)
            self.assertEqual(room.status, "running")
            self.assertEqual(await ledger(s, balance_type="arena_prize"), [])
            waiting = await ae.create_room(s, "a4", now=NOW)
            with self.assertRaises(ae.ArenaStateError):
                await ae.settle(s, waiting.id, {})
            with self.assertRaises(ae.ArenaRoomNotFound):
                await ae.settle(s, 9999, {})
        run_sqlite(body)

    def test_cancel_running_refunds(self):
        async def body(s):
            room, ids = await full_room(s, "a4")
            self.assertEqual(await ae.cancel(s, room.id), 4)
            self.assertEqual(await ae.cancel(s, room.id), 0)
            for uid in ids:
                self.assertEqual(await bal(s, uid), D("1"))
            with self.assertRaises(ae.ArenaStateError):
                await ae.settle(s, room.id, {uid: 1 for uid in ids})
        run_sqlite(body)

    def test_random_matches_money_conserved(self):
        """Случайные комнаты (выходы, таймауты, расчёты с общими местами): деньги не появляются и не исчезают."""
        async def body(s):
            rnd = random.Random(7)
            ids = await users(s, 20, "5")
            start_total = D(5) * 20
            for _ in range(30):
                code = rnd.choice(("a4", "a8"))
                room = await ae.create_room(s, code, now=NOW)
                pool = rnd.sample(ids, ARENA_ROOMS[code].seats)
                for uid in pool:
                    await ae.join(s, room_id=room.id, user_id=uid, now=NOW)
                if rnd.random() < 0.3:
                    await ae.leave(s, room_id=room.id, user_id=pool[0], now=NOW)
                    await ae.refund_if_expired(s, room.id, now=NOW + timedelta(seconds=FILL_TIMEOUT_S))
                    continue
                await ae.start(s, room.id, now=NOW)
                order = pool[:]
                rnd.shuffle(order)
                places, pos, i = {}, 1, 0
                while i < len(order):
                    k = rnd.choice((1, 1, 1, 2, 3))
                    group = order[i:i + k]
                    for uid in group:
                        places[uid] = pos
                    pos += len(group)
                    i += len(group)
                await ae.settle(s, room.id, places, now=NOW)
                await ae.settle(s, room.id, places, now=NOW)
            total = sum([await bal(s, uid) for uid in ids], D(0))
            house = D(await ae.house_revenue_nano(s)) / NANO_PER_TON
            self.assertEqual(total + house, start_total)
            stakes = await s.scalar(select(func.coalesce(func.sum(ArenaEntry.held_nano), 0)).where(ArenaEntry.status.in_(("paid", "lost"))))
            prizes = await s.scalar(select(func.coalesce(func.sum(ArenaEntry.prize_nano), 0)))
            self.assertEqual(int(prizes) + await ae.house_revenue_nano(s), int(stakes))
        run_sqlite(body)

    def test_seat_unique_constraint(self):
        async def body(s):
            a, b = await users(s, 2)
            room = await ae.create_room(s, "a4", now=NOW)
            s.add_all([ArenaEntry(room_id=room.id, user_id=a, seat=0, created_at=NOW),
                       ArenaEntry(room_id=room.id, user_id=b, seat=0, created_at=NOW)])
            with self.assertRaises(IntegrityError):
                await s.flush()
        run_sqlite(body)


@unittest.skipUnless(PG_URL, "нет TEST_PG_URL — параллельные тесты на Postgres пропущены")
class PostgresConcurrencyTest(unittest.TestCase):
    """Одновременные запросы в разных сессиях (как HTTP-запросы)."""

    def _run(self, scenario):
        async def main():
            engine = create_async_engine(PG_URL, pool_size=10, max_overflow=10)
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
                await conn.run_sync(Base.metadata.create_all)
            maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
            try:
                await scenario(maker)
            finally:
                await engine.dispose()

        asyncio.run(main())

    @staticmethod
    async def _tx(maker, fn, errors=(ae.ArenaError,)):
        async with maker() as s:
            try:
                r = await fn(s)
                await s.commit()
                return r if r is not None else "ok"
            except errors as e:
                await s.rollback()
                return type(e).__name__

    def test_parallel_joins_fill_exactly(self):
        async def scenario(maker):
            async with maker() as s:
                ids = await users(s, 10)
                room = await ae.create_room(s, "a4")
                await s.commit()
            res = await asyncio.gather(*(self._tx(maker, lambda s, u=u: ae.join(s, room_id=room.id, user_id=u)) for u in ids))
            self.assertEqual(sum(isinstance(r, ArenaEntry) for r in res), 4, res)
            self.assertEqual(sum(r == "ArenaRoomFull" for r in res), 6, res)
            async with maker() as s:
                seats = sorted((await s.scalars(select(ArenaEntry.seat).where(ArenaEntry.status == "held"))).all())
                self.assertEqual(seats, [0, 1, 2, 3])
                total = sum([await bal(s, u) for u in ids], D(0))
                self.assertEqual(total, D(10) - D("0.4"))

        self._run(scenario)

    def test_parallel_double_join_same_user(self):
        async def scenario(maker):
            async with maker() as s:
                (u,) = await users(s, 1)
                room = await ae.create_room(s, "a8")
                await s.commit()
            res = await asyncio.gather(*(self._tx(maker, lambda s: ae.join(s, room_id=room.id, user_id=u)) for _ in range(5)))
            self.assertEqual(sum(isinstance(r, ArenaEntry) for r in res), 1, res)
            async with maker() as s:
                self.assertEqual(await bal(s, u), D("0.9"))
                self.assertEqual(len(await ledger(s, u, "arena_hold")), 1)

        self._run(scenario)

    def test_parallel_settle_and_refund_pay_once(self):
        async def scenario(maker):
            async with maker() as s:
                room, ids = await full_room(s, "a8")
                expired_ids = await users(s, 2)
                expired = await ae.create_room(s, "a4", now=NOW)
                for u in expired_ids:
                    await ae.join(s, room_id=expired.id, user_id=u, now=NOW)
                await s.commit()
            places = {u: i + 1 for i, u in enumerate(ids)}

            async def settle(s):
                r = await ae.settle(s, room.id, places)
                return "already" if r.already else "paid"

            late = NOW + timedelta(seconds=FILL_TIMEOUT_S)
            res = await asyncio.gather(
                *(self._tx(maker, settle) for _ in range(4)),
                *(self._tx(maker, lambda s: ae.refund_expired(s, now=late)) for _ in range(4)),
                *(self._tx(maker, lambda s: ae.refund_if_expired(s, expired.id, now=late)) for _ in range(4)),
            )
            self.assertEqual(res[:4].count("paid"), 1, res)
            self.assertEqual(res[:4].count("already"), 3, res)
            self.assertEqual(sum(res[4:]), 2, res)
            async with maker() as s:
                self.assertEqual(len(await ledger(s, balance_type="arena_prize")), 2)
                self.assertEqual(len(await ledger(s, balance_type="arena_refund")), 2)
                self.assertEqual(await bal(s, ids[0]), D("1.4"))
                for u in expired_ids:
                    self.assertEqual(await bal(s, u), D("1"))

        self._run(scenario)

    def test_parallel_join_vs_leave_and_timeout(self):
        async def scenario(maker):
            async with maker() as s:
                ids = await users(s, 6)
                room = await ae.create_room(s, "a8", now=NOW)
                for u in ids[:3]:
                    await ae.join(s, room_id=room.id, user_id=u, now=NOW)
                await s.commit()
            late = NOW + timedelta(seconds=FILL_TIMEOUT_S)
            ops = [lambda s, u=u: ae.join(s, room_id=room.id, user_id=u, now=late) for u in ids[3:]]
            ops += [lambda s, u=u: ae.leave(s, room_id=room.id, user_id=u, now=late) for u in ids[:3]]
            ops += [lambda s: ae.refund_if_expired(s, room.id, now=late)] * 3
            await asyncio.gather(*(self._tx(maker, op) for op in ops))
            async with maker() as s:
                for u in ids:  # кто бы ни успел — у всех ровно исходный баланс, ни одной двойной проводки
                    self.assertEqual(await bal(s, u), D("1"), u)
                self.assertEqual(await s.scalar(select(ArenaRoom.status).where(ArenaRoom.id == room.id)), "refunded")
                self.assertEqual(await s.scalar(select(func.count()).select_from(ArenaEntry).where(ArenaEntry.status == "held")), 0)

        self._run(scenario)


if __name__ == "__main__":
    unittest.main()

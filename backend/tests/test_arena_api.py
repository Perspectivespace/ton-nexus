"""«Арена»: API комнат — авторизация, флаг (и обход для владельцев), список, вход/старт, выход,
возврат по таймауту, гонка входов. Ходы боя — tests/test_arena_match.py.

Последовательные проверки — SQLite в памяти через HTTP (httpx + ASGI), авторизация настоящая (dev-вход в debug).
Гонка «найти или создать» — на настоящем Postgres, только если задан TEST_PG_URL (как в test_arena_escrow).
ВНИМАНИЕ: тест на Postgres пересоздаёт все таблицы в этой базе — только локальная пустая тестовая база.
"""

import asyncio
import itertools
import json
import os
import unittest
import warnings
from datetime import timedelta
from decimal import Decimal
from unittest import mock

import httpx
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.core.config import settings
from app.db.base import Base
from app.models import ArenaEntry, ArenaMatch, ArenaRoom, ArenaTurn, User
from app.services import arena_engine as eng
from app.services import arena_escrow as ae
from app.services import arena_rooms
from app.services.economy_admin import set_setting

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")

D = Decimal
PG_URL = os.environ.get("TEST_PG_URL")
_TG = itertools.count(5000)


class ApiBase(unittest.IsolatedAsyncioTestCase):
    url = "sqlite+aiosqlite:///:memory:"
    enabled = True

    async def asyncSetUp(self):
        from app.db.session import get_db
        from app.main import app

        kw = {"poolclass": StaticPool} if self.url.startswith("sqlite") else {"pool_size": 10, "max_overflow": 10}
        self.engine = create_async_engine(self.url, **kw)
        async with self.engine.begin() as conn:
            if not self.url.startswith("sqlite"):
                await conn.run_sync(Base.metadata.drop_all)
            await conn.run_sync(Base.metadata.create_all)
        self.addAsyncCleanup(self.engine.dispose)
        self.S = async_sessionmaker(self.engine, expire_on_commit=False, autoflush=False)

        async def _db():
            async with self.S() as s:
                yield s

        app.dependency_overrides[get_db] = _db
        self.addCleanup(app.dependency_overrides.clear)
        p = mock.patch.object(settings, "debug", True)
        p.start()
        self.addCleanup(p.stop)
        self.client = httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")
        self.addAsyncCleanup(self.client.aclose)
        if self.enabled:
            async with self.S() as s:
                await set_setting(s, key="arena", value={"enabled": True})
                await s.commit()

    async def user(self, balance="1", **kw) -> int:
        """Пользователь с балансом; возвращает telegram_id (для dev-входа)."""
        tg = next(_TG)
        async with self.S() as s:
            s.add(User(telegram_id=tg, balance=D(balance), **kw))
            await s.commit()
        return tg

    @staticmethod
    def h(tg: int) -> dict:
        return {"X-Telegram-Init-Data": f"dev:{tg}"}

    async def get(self, path, tg):
        return await self.client.get(f"/api/v1/arena{path}", headers=self.h(tg))

    async def post(self, path, tg, body=None):
        return await self.client.post(f"/api/v1/arena{path}", headers=self.h(tg), json=body)

    async def balance(self, tg) -> Decimal:
        async with self.S() as s:
            return D(await s.scalar(select(User.balance).where(User.telegram_id == tg)))

    async def rooms(self):
        async with self.S() as s:
            return list((await s.scalars(select(ArenaRoom).order_by(ArenaRoom.id))).all())


class AuthAndFlagTest(ApiBase):
    enabled = False

    async def test_auth_required(self):
        with mock.patch.object(settings, "debug", False):
            for method, path in (
                ("get", "/rooms"), ("post", "/join"), ("post", "/leave"), ("get", "/rooms/1"),
                ("get", "/rooms/1/state"), ("post", "/rooms/1/plan"), ("post", "/rooms/1/cancel"),
            ):
                r = await getattr(self.client, method)(f"/api/v1/arena{path}")
                self.assertEqual(r.status_code, 401, (method, path))
            r = await self.client.get("/api/v1/arena/rooms", headers={"X-Telegram-Init-Data": "query_id=x&hash=bad"})
            self.assertEqual(r.status_code, 401)

    async def test_disabled_by_default(self):
        tg = await self.user()
        for r in (await self.get("/rooms", tg), await self.post("/join", tg, {"type": "a4"})):
            self.assertEqual(r.status_code, 403, r.text)
            self.assertEqual(r.json()["detail"]["code"], "arena_disabled")
        self.assertEqual(await self.rooms(), [])
        # комнату видят только её участники (флаг тут не важен): нет комнаты — 404
        r = await self.get("/rooms/1", tg)
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (404, "room_not_found"))
        self.assertEqual(await self.balance(tg), D(1))
        # выход (возврат денег) открыт и при выключенной «Арене»
        r = await self.post("/leave", tg)
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (409, "not_joined"))

    async def test_leave_works_when_switched_off(self):
        tg = await self.user()
        owner = await self.user(is_owner=True)
        put = lambda v: self.client.put("/api/v1/economy/settings/arena", headers=self.h(owner), json={"value": v})  # noqa: E731
        self.assertEqual((await put({"enabled": True})).status_code, 200)
        self.assertEqual((await self.post("/join", tg, {"type": "a4"})).status_code, 200)
        self.assertEqual((await put({"enabled": False})).status_code, 200)
        r = await self.post("/leave", tg)
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(await self.balance(tg), D(1))

    async def test_owner_plays_while_switched_off(self):
        """Флаг выключен: владельцы входят и играют (тест до открытия), остальные — arena_disabled."""
        owners = [await self.user(is_owner=True) for _ in range(4)]
        tg = await self.user()
        j = (await self.get("/rooms", owners[0])).json()
        self.assertEqual({t["type"] for t in j["types"]}, {"a4", "a8"})
        views = [(await self.post("/join", o, {"type": "a4"})).json() for o in owners]
        self.assertEqual(views[-1]["status"], "running")
        rid = views[0]["id"]
        r = await self.post("/join", tg, {"type": "a4"})
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (403, "arena_disabled"))
        self.assertEqual((await self.get(f"/rooms/{rid}/state", owners[1])).status_code, 200)
        r = await self.get(f"/rooms/{rid}", tg)  # не участник и не владелец
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (403, "not_participant"))
        self.assertEqual(await self.balance(tg), D(1))

    async def test_only_owner_toggles(self):
        tg = await self.user()
        owner = await self.user(is_owner=True)
        r = await self.client.put("/api/v1/economy/settings/arena", headers=self.h(tg), json={"value": {"enabled": True}})
        self.assertEqual(r.status_code, 403)
        for bad in (
            {"enabled": "yes"},
            {"enabled": 1},
            [True],
            True,
            {"enabled": True, "commission_bp": 3001},
            {"enabled": True, "commission_bp": -1},
            {"enabled": True, "commission_bp": "10"},
            {"enabled": True, "commission_bp": 10.5},
            {"enabled": True, "commission_bp": True},
        ):
            r = await self.client.put("/api/v1/economy/settings/arena", headers=self.h(owner), json={"value": bad})
            self.assertEqual(r.status_code, 400, bad)
        self.assertEqual((await self.get("/rooms", tg)).status_code, 403)
        r = await self.client.put(
            "/api/v1/economy/settings/arena", headers=self.h(owner), json={"value": {"enabled": True, "junk": 1}}
        )
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual((r.json()["value"], r.json()["group"]), ({"enabled": True, "commission_bp": 1000}, "arena"))
        r = await self.client.put(
            "/api/v1/economy/settings/arena", headers=self.h(owner), json={"value": {"enabled": True, "commission_bp": 1250}}
        )
        self.assertEqual((r.status_code, r.json()["value"]), (200, {"enabled": True, "commission_bp": 1250}))
        self.assertEqual((await self.get("/rooms", tg)).status_code, 200)
        listing = (await self.client.get("/api/v1/economy/settings", headers=self.h(owner))).json()
        self.assertIn("arena", {x["key"] for x in listing})


class DisplayNameTest(unittest.TestCase):
    def test_names(self):
        n = arena_rooms.display_name
        self.assertEqual(n(User(telegram_id=1, username="bob", first_name="Боб")), "@bob")
        self.assertEqual(n(User(telegram_id=1, first_name="  Боб ")), "Боб")
        self.assertEqual(n(User(telegram_id=1, first_name="x" * 50)), "x" * 24)
        self.assertEqual(n(User(telegram_id=1)), "Игрок")
        self.assertEqual(n(None), "Игрок")


class RoomsApiTest(ApiBase):
    async def test_list_rooms(self):
        tg = await self.user()
        j = (await self.get("/rooms", tg)).json()
        self.assertIsNone(j["active_room_id"])
        a4 = next(t for t in j["types"] if t["type"] == "a4")
        self.assertEqual(
            (a4["seats"], a4["stake_nano"], a4["prizes_nano"], a4["pot_nano"], a4["waiting"]),
            (4, "100000000", ["360000000"], "400000000", 0),
        )
        self.assertEqual({t["type"] for t in j["types"]}, {"a4", "a8"})
        room = (await self.post("/join", tg, {"type": "a4"})).json()
        j = (await self.get("/rooms", tg)).json()
        self.assertEqual(j["active_room_id"], room["id"])
        self.assertEqual({t["type"]: t["waiting"] for t in j["types"]}, {"a4": 1, "a8": 0})

    async def test_commission_setting(self):
        """Лобби — по текущей комиссии; комната держит свою (снимок при создании)."""
        tg = await self.user()
        async with self.S() as s:
            await set_setting(s, key="arena", value={"enabled": True, "commission_bp": 2000})
            await s.commit()
        a4 = next(t for t in (await self.get("/rooms", tg)).json()["types"] if t["type"] == "a4")
        self.assertEqual((a4["prizes_nano"], a4["commission_bps"]), (["320000000"], 2000))
        room = (await self.post("/join", tg, {"type": "a4"})).json()
        self.assertEqual((room["prizes_nano"], room["commission_bps"]), (["320000000"], 2000))
        async with self.S() as s:
            await set_setting(s, key="arena", value={"enabled": True, "commission_bp": 500})
            await s.commit()
        room = (await self.get(f"/rooms/{room['id']}", tg)).json()
        self.assertEqual((room["prizes_nano"], room["commission_bps"]), (["320000000"], 2000))
        a4 = next(t for t in (await self.get("/rooms", tg)).json()["types"] if t["type"] == "a4")
        self.assertEqual((a4["prizes_nano"], a4["commission_bps"]), (["380000000"], 500))
        # старая настройка без ключа — 10 %
        async with self.S() as s:
            await set_setting(s, key="arena", value={"enabled": True})
            await s.commit()
        a4 = next(t for t in (await self.get("/rooms", tg)).json()["types"] if t["type"] == "a4")
        self.assertEqual((a4["prizes_nano"], a4["commission_bps"]), (["360000000"], 1000))

    async def test_join_errors(self):
        tg = await self.user()
        poor = await self.user(balance="0.05")
        r = await self.post("/join", tg, {"type": "a5"})
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (400, "unknown_room_type"))
        self.assertEqual((await self.post("/join", tg, {})).status_code, 422)
        r = await self.post("/join", poor, {"type": "a4"})
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (402, "insufficient_balance"))
        self.assertEqual(await self.rooms(), [])  # пустая комната не остаётся
        room = (await self.post("/join", tg, {"type": "a4"})).json()
        for t in ("a4", "a8"):
            r = await self.post("/join", tg, {"type": t})
            self.assertEqual(r.status_code, 409)
            self.assertEqual(r.json()["detail"], {"code": "already_in_room", "message": "Вы уже в комнате", "room_id": room["id"]})
        self.assertEqual(len(await self.rooms()), 1)
        self.assertEqual(await self.balance(tg), D("0.9"))
        r = await self.get("/rooms/999", tg)
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (404, "room_not_found"))

    async def test_room_view_waiting(self):
        a = await self.user(username="alice", first_name="Алиса")
        b = await self.user(first_name="Борис")
        r = await self.post("/join", a, {"type": "a4"})
        self.assertEqual(r.status_code, 200, r.text)
        room = r.json()
        await self.post("/join", b, {"type": "a4"})
        v = (await self.get(f"/rooms/{room['id']}", b)).json()
        self.assertEqual((v["status"], v["type"], v["seats_total"], v["taken"], v["my_seat"]), ("waiting", "a4", 4, 2, 1))
        # dev-вход ставит username "dev_user": имя берётся из профиля Telegram в БД
        self.assertEqual([s and s["is_me"] for s in v["seats"]], [False, True, None, None])
        self.assertTrue(all(s["name"].startswith("@") for s in v["seats"] if s))
        self.assertIsNone(v["match"])
        self.assertTrue(v["fill_deadline"] and len(v["seed_hash"]) == 64)
        raw = json.dumps(v)
        for leak in (str(a), str(b), '"seed"', "salt", "telegram"):
            self.assertNotIn(leak, raw)

    async def test_fill_starts_match(self):
        tgs = [await self.user() for _ in range(5)]
        views = [(await self.post("/join", tg, {"type": "a4"})).json() for tg in tgs[:4]]
        rid = views[0]["id"]
        self.assertEqual({v["id"] for v in views}, {rid})
        self.assertEqual([v["status"] for v in views], ["waiting"] * 3 + ["running"])
        self.assertIsNotNone(views[-1]["match"])
        async with self.S() as s:
            room = await s.get(ArenaRoom, rid)
            m = await s.scalar(select(ArenaMatch).where(ArenaMatch.room_id == rid))
            seats = (await s.scalars(select(ArenaEntry.seat).where(ArenaEntry.room_id == rid).order_by(ArenaEntry.seat))).all()
            t1 = await s.scalar(select(ArenaTurn).where(ArenaTurn.room_id == rid))
        self.assertEqual((room.status, m.turn, views[-1]["match"]["id"]), ("running", 1, m.id))
        st = eng.state_from_json(m.state_json)
        # игроки в движке — номера мест (в публичном журнале нет id пользователей)
        # места перемешаны seed'ом: вошедший i-м сидит на seat_order(seed, 4)[i], не по порядку входа
        order = eng.seat_order(room.seed, 4)
        self.assertEqual(list(seats), [0, 1, 2, 3])
        async with self.S() as s:
            by_user = dict((await s.execute(select(ArenaEntry.user_id, ArenaEntry.seat).where(ArenaEntry.room_id == rid))).all())
            uid = {u.telegram_id: u.id for u in (await s.scalars(select(User))).all()}
        self.assertEqual([by_user[uid[tg]] for tg in tgs[:4]], order)
        self.assertEqual([(await self.get(f"/rooms/{rid}", tg)).json()["my_seat"] for tg in tgs[:4]], order)
        self.assertEqual(eng.state_to_dict(st), eng.state_to_dict(eng.create_match("a4", room.seed, order)))
        self.assertEqual([(p.id, p.slot) for p in st.players], [(seat, slot) for slot, seat in enumerate(order)])
        # 1-й ход: отсчёт 3 с после старта, затем 10 с на план
        self.assertEqual(t1.turn, 1)
        self.assertEqual(ae._aware(t1.opens_at) - ae._aware(room.started_at), timedelta(seconds=3))
        self.assertEqual(ae._aware(t1.deadline) - ae._aware(t1.opens_at), timedelta(seconds=10))
        self.assertEqual(ae.seed_commit(st.seed, room.seed_salt), room.seed_hash)  # seed тот, что обещан хэшем
        # бой идёт: выйти нельзя; пятый игрок попадает в новую комнату
        r = await self.post("/leave", tgs[0])
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (409, "room_state"))
        v5 = (await self.post("/join", tgs[4], {"type": "a4"})).json()
        self.assertNotEqual(v5["id"], rid)
        self.assertEqual((v5["status"], v5["taken"]), ("waiting", 1))
        for tg in tgs:
            self.assertEqual(await self.balance(tg), D("0.9"))
        r = await self.post("/join", tgs[0], {"type": "a8"})
        self.assertEqual(r.json()["detail"]["room_id"], rid)
        # повторный start — тот же бой
        async with self.S() as s:
            again = await arena_rooms.start_match(s, rid)
            self.assertEqual(again.id, m.id)
            await s.commit()
            self.assertEqual(await s.scalar(select(func.count()).select_from(ArenaTurn)), 1)

    async def test_leave(self):
        a, b = await self.user(), await self.user()
        room = (await self.post("/join", a, {"type": "a8"})).json()
        await self.post("/join", b, {"type": "a8"})
        r = await self.post("/leave", a)
        self.assertEqual(r.json(), {"ok": True, "room_id": room["id"], "refunded_nano": "100000000"})
        self.assertEqual(await self.balance(a), D(1))
        v = (await self.get(f"/rooms/{room['id']}", b)).json()
        self.assertEqual((v["taken"], v["seats"][0], v["seats"][1]["is_me"]), (1, None, True))
        r = await self.post("/leave", a)
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (409, "not_joined"))
        # снова в ту же комнату — первое свободное место
        again = (await self.post("/join", a, {"type": "a8"})).json()
        self.assertEqual((again["id"], again["my_seat"]), (room["id"], 0))

    async def test_timeout_refund_by_poller(self):
        a, b = await self.user(), await self.user()
        room = (await self.post("/join", a, {"type": "a4"})).json()
        await self.post("/join", b, {"type": "a4"})
        self.assertEqual(await self.balance(a), D("0.9"))
        self.assertEqual(await arena_rooms.poll_once(self.S), 0)  # ещё не истекла
        async with self.S() as s:
            await s.execute(
                update(ArenaRoom).where(ArenaRoom.id == room["id"]).values(fill_deadline=ae.utcnow() - timedelta(seconds=1))
            )
            await s.commit()
        self.assertEqual(await arena_rooms.poll_once(self.S), 2)
        self.assertEqual(await arena_rooms.poll_once(self.S), 0)  # повтор ничего не платит
        self.assertEqual((await self.balance(a), await self.balance(b)), (D(1), D(1)))
        v = (await self.get(f"/rooms/{room['id']}", a)).json()
        self.assertEqual((v["status"], v["taken"]), ("refunded", 0))
        j = (await self.get("/rooms", a)).json()
        self.assertIsNone(j["active_room_id"])
        self.assertEqual(j["types"][0]["waiting"], 0)
        new = (await self.post("/join", a, {"type": "a4"})).json()
        self.assertNotEqual(new["id"], room["id"])

    async def test_lazy_refund_on_join(self):
        """Без опросчика: вход сам возвращает ставку из просроченной комнаты и сажает в новую."""
        a = await self.user()
        room = (await self.post("/join", a, {"type": "a4"})).json()
        async with self.S() as s:
            await s.execute(
                update(ArenaRoom).where(ArenaRoom.id == room["id"]).values(fill_deadline=ae.utcnow() - timedelta(seconds=1))
            )
            await s.commit()
        r = await self.post("/join", a, {"type": "a8"})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json()["type"], "a8")
        self.assertEqual(await self.balance(a), D("0.9"))
        statuses = [x.status for x in await self.rooms()]
        self.assertEqual(statuses, ["refunded", "waiting"])

    async def test_arena_loop_runs_poller(self):
        """Свой цикл «Арены» (шаг 2 с — ходы по 10 с); цикл пополнений «Арену» больше не трогает."""
        import app.main as main

        called = asyncio.Event()

        async def fake_arena(factory):
            called.set()
            return 0

        async def noop(_f):
            return 0

        async def stop(_s):
            raise asyncio.CancelledError

        with mock.patch.object(main, "poll_once", noop), mock.patch.object(main, "poll_payouts_once", noop), \
             mock.patch.object(main, "arena_poll_once", fake_arena), mock.patch.object(main, "SessionLocal", self.S), \
             mock.patch.object(main.asyncio, "sleep", stop):
            with self.assertRaises(asyncio.CancelledError):
                await main.deposit_loop()
            self.assertFalse(called.is_set())
            with self.assertRaises(asyncio.CancelledError):
                await main.arena_loop()
        self.assertTrue(called.is_set())
        self.assertEqual(main.ARENA_TICK_S, 2)


@unittest.skipUnless(PG_URL, "нет TEST_PG_URL — гонка входов на Postgres пропущена")
class PostgresJoinRaceTest(ApiBase):
    url = PG_URL or ""

    async def test_parallel_joins_one_room(self):
        for attempt in range(3):
            tgs = [await self.user() for _ in range(5)]
            res = await asyncio.gather(*(self.post("/join", tg, {"type": "a4"}) for tg in tgs))
            self.assertEqual([r.status_code for r in res], [200] * 5, [r.text for r in res])
            async with self.S() as s:
                rows = (
                    await s.execute(
                        select(ArenaRoom.id, ArenaRoom.status, func.count(ArenaEntry.id))
                        .join(ArenaEntry, ArenaEntry.room_id == ArenaRoom.id)
                        .where(ArenaEntry.status == "held", ArenaRoom.status.in_(("waiting", "running")))
                        .group_by(ArenaRoom.id, ArenaRoom.status)
                        .order_by(ArenaRoom.id)
                    )
                ).all()
                running = [r for r in rows if r[1] == "running"]
                waiting = [r for r in rows if r[1] == "waiting"]
                total = 5 * (attempt + 1)  # все входы до сих пор: полные комнаты по 4 + одна в наборе
                self.assertEqual([r[2] for r in running], [4] * (total // 4), rows)
                self.assertEqual([r[2] for r in waiting], [total % 4], rows)
                self.assertEqual(await s.scalar(select(func.count()).select_from(ArenaMatch)), len(running))
                self.assertEqual(await s.scalar(select(func.count()).select_from(ArenaRoom)), len(rows))
            for tg in tgs:
                self.assertEqual(await self.balance(tg), D("0.9"))


if __name__ == "__main__":
    unittest.main()

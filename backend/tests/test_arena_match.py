"""«Арена»: цикл ходов — отсчёт, окно плана 10 с, «Готово», дедлайн (нет плана — стоять), журнал ходов,
ленивое продвижение и опросчик, конец боя и расчёт (призы + комиссия = ставки до нанотона), commit–reveal seed
и пересчёт боя по публичным данным, доступ только участникам, отмена комнаты владельцем.

SQLite в памяти через HTTP, как tests/test_arena_api. Время двигается правкой окна хода в БД (или now= в сервисе).
Параллельные планы и продвижение — на Postgres, только если задан TEST_PG_URL (база пересоздаётся!).
"""

import asyncio
import hashlib
import json
import unittest
from datetime import timedelta
from decimal import Decimal

from sqlalchemy import func, select, update

from app.models import ArenaEntry, ArenaMatch, ArenaRoom, ArenaTurn, BalanceHistory, User
from app.services import arena_engine as eng
from app.services import arena_escrow as ae
from app.services import arena_match as am
from app.services import arena_rooms
from app.services.arena_config import room_type
from tests.test_arena_api import PG_URL, ApiBase

D = Decimal
NANO = 10**9


class MatchBase(ApiBase):
    async def full_room(self, code="a4", n=4, **kw):
        tgs = [await self.user(**kw) for _ in range(n)]
        views = [(await self.post("/join", tg, {"type": code})).json() for tg in tgs]
        self.assertEqual(views[-1]["status"], "running", views[-1])
        rid = views[0]["id"]
        # на старте места перемешиваются seed'ом: вернуть игроков по местам (tgs[i] — место i), порядок входа — в joined
        seat = {tg: (await self.get(f"/rooms/{rid}", tg)).json()["my_seat"] for tg in tgs}
        self.assertEqual(sorted(seat.values()), list(range(n)))
        self.joined = tgs
        return sorted(tgs, key=seat.__getitem__), rid

    async def open_turn(self, rid):
        """Закончить отсчёт: окно текущего хода открыто 1 с назад (дедлайн через 9 с)."""
        now = ae.utcnow()
        async with self.S() as s:
            await s.execute(
                update(ArenaTurn)
                .where(ArenaTurn.room_id == rid, ArenaTurn.resolved_at.is_(None))
                .values(opens_at=now - timedelta(seconds=1), deadline=now + timedelta(seconds=9))
            )
            await s.commit()

    async def expire(self, rid):
        """Дедлайн текущего хода прошёл."""
        now = ae.utcnow()
        async with self.S() as s:
            await s.execute(
                update(ArenaTurn)
                .where(ArenaTurn.room_id == rid, ArenaTurn.resolved_at.is_(None))
                .values(opens_at=now - timedelta(seconds=11), deadline=now - timedelta(seconds=1))
            )
            await s.commit()

    async def engine_state(self, rid) -> eng.MatchState:
        async with self.S() as s:
            m = await s.scalar(select(ArenaMatch).where(ArenaMatch.room_id == rid))
            return eng.state_from_json(m.state_json)

    async def state(self, rid, tg, since=0):
        r = await self.get(f"/rooms/{rid}/state?since={since}", tg)
        self.assertEqual(r.status_code, 200, r.text)
        return r.json()

    async def plan(self, rid, tg, turn, plan=None, ready=True):
        return await self.post(f"/rooms/{rid}/plan", tg, {"turn": turn, "plan": plan, "ready": ready})

    @staticmethod
    def bot(s: eng.MatchState, seat: int) -> dict | None:
        """Простой бот: бьёт ближайшего, кого достаёт; иначе шаг к центру; иначе стоит."""
        me = s.player(seat)
        foes = sorted((p for p in s.players if p.alive and p.id != seat), key=lambda p: eng.cheb(me.x, me.y, p.x, p.y))
        for f in foes:
            if eng.can_hit(s, me.x, me.y, me.weapon, f.x, f.y):
                return {"path": [], "attack": f.id}
        c = s.n // 2
        sx = (c > me.x) - (c < me.x)
        sy = (c > me.y) - (c < me.y)
        for dx, dy in ((sx, sy), (sx, 0), (0, sy)):
            if (dx, dy) == (0, 0):
                continue
            cand = {"path": [[me.x + dx, me.y + dy]], "attack": foes[0].id if foes else None}
            try:
                eng.validate_plan(s, seat, eng.parse_plan(cand))
                return cand
            except eng.InvalidPlan:
                continue
        return None


class AccessTest(MatchBase):
    async def test_participants_only(self):
        tgs, rid = await self.full_room()
        outsider = await self.user()
        owner = await self.user(is_owner=True)
        for path in (f"/rooms/{rid}", f"/rooms/{rid}/state"):
            r = await self.get(path, outsider)
            self.assertEqual((r.status_code, r.json()["detail"]["code"]), (403, "not_participant"), path)
            self.assertEqual((await self.get(path, owner)).status_code, 200, path)
            self.assertEqual((await self.get(path, tgs[2])).status_code, 200, path)
        r = await self.get("/rooms/999/state", tgs[0])
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (404, "room_not_found"))
        await self.open_turn(rid)
        for who in (outsider, owner):  # владелец смотрит, но не играет
            r = await self.plan(rid, who, 1)
            self.assertEqual((r.status_code, r.json()["detail"]["code"]), (403, "not_playing"))
        r = await self.plan(999, tgs[0], 1)
        self.assertEqual(r.status_code, 404)
        # владелец видит бой «со стороны»: моего места нет
        v = await self.state(rid, owner)
        self.assertIsNone(v["my_seat"])
        self.assertFalse(any(p["is_me"] for p in v["match"]["players"]))

    async def test_left_player_still_sees_waiting_room(self):
        a, b = await self.user(), await self.user()
        room = (await self.post("/join", a, {"type": "a4"})).json()
        await self.post("/join", b, {"type": "a4"})
        await self.post("/leave", a)
        self.assertEqual((await self.get(f"/rooms/{room['id']}", a)).status_code, 200)
        r = await self.get(f"/rooms/{room['id']}/state", a)
        self.assertEqual(r.json()["match"], None)


class TurnLoopTest(MatchBase):
    async def test_countdown_then_planning(self):
        tgs, rid = await self.full_room()
        v = await self.state(rid, tgs[0])
        m = v["match"]
        self.assertEqual((m["phase"], m["turn"], m["current"]["turn"]), ("countdown", 1, 1))
        self.assertEqual((m["n"], len(m["players"]), m["my_seat"] if "my_seat" in m else v["my_seat"]), (9, 4, 0))
        self.assertEqual(sorted(p["seat"] for p in m["players"]), [0, 1, 2, 3])
        self.assertNotIn("seed", v)
        self.assertEqual(v["turns"], [])
        r = await self.plan(rid, tgs[0], 1)
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (409, "turn_not_open"))
        await self.open_turn(rid)
        self.assertEqual((await self.state(rid, tgs[0]))["match"]["phase"], "planning")
        self.assertEqual((await self.plan(rid, tgs[0], 1)).status_code, 200)

    async def test_plan_errors(self):
        tgs, rid = await self.full_room()
        await self.open_turn(rid)
        s = await self.engine_state(rid)
        me = s.player(0)
        cases = [
            ({"junk": 1}, "bad_plan"),
            ({"path": [[-1, 0]]}, "step_out_of_bounds"),
            ({"path": [[me.x + 3 if me.x < s.n // 2 else me.x - 3, me.y]]}, "step_not_adjacent"),
            ({"path": [], "attack": 0}, "attack_self"),
            ({"path": [], "attack": 7}, "attack_unknown"),
            ({"medkit": True}, "no_medkit"),
            ({"path": [[me.x, me.y]] * 3}, "path_too_long"),
        ]
        for plan, reason in cases:
            r = await self.plan(rid, tgs[0], 1, plan)
            self.assertEqual(r.status_code, 400, (plan, r.text))
            self.assertEqual((r.json()["detail"]["code"], r.json()["detail"]["reason"]), ("bad_plan", reason), plan)
        r = await self.plan(rid, tgs[0], 2)
        self.assertEqual(r.status_code, 409)
        self.assertEqual((r.json()["detail"]["code"], r.json()["detail"]["current_turn"]), ("turn_mismatch", 1))
        self.assertEqual((await self.post(f"/rooms/{rid}/plan", tgs[0], {"turn": 0})).status_code, 422)
        self.assertEqual((await self.post(f"/rooms/{rid}/plan", tgs[0], {"plan": None})).status_code, 422)
        # отклонённые планы не сохранились
        self.assertEqual((await self.state(rid, tgs[0]))["match"]["current"]["my_plan"], None)

    async def test_all_ready_resolves_early(self):
        tgs, rid = await self.full_room()
        await self.open_turn(rid)
        s = await self.engine_state(rid)
        p0 = self.bot(s, 0)
        # перезапись до дедлайна: сначала «думаю», потом «Готово»
        r = await self.plan(rid, tgs[0], 1, None, ready=False)
        self.assertEqual(r.json(), {"ok": True, "turn": 1, "seat": 0, "ready": False, "resolved": False})
        r = await self.plan(rid, tgs[0], 1, p0)
        self.assertEqual(r.json()["ready"], True)
        for i in (1, 2):
            self.assertFalse((await self.plan(rid, tgs[i], 1, self.bot(s, i))).json()["resolved"])
        v1 = await self.state(rid, tgs[1])
        cur = v1["match"]["current"]
        self.assertEqual((cur["turn"], cur["ready_seats"]), (1, [0, 1, 2]))
        self.assertEqual(cur["my_plan"]["ready"], True)
        self.assertNotIn(json.dumps(p0["path"]), json.dumps(v1["match"]["current"]))  # чужой план не виден
        r = await self.plan(rid, tgs[3], 1, self.bot(s, 3))
        self.assertTrue(r.json()["resolved"])
        v = await self.state(rid, tgs[0])
        m = v["match"]
        self.assertEqual((m["turn"], m["current"]["turn"], m["current"]["ready_seats"], m["current"]["my_plan"]), (2, 2, [], None))
        self.assertEqual(len(v["turns"]), 1)
        t1 = v["turns"][0]
        self.assertEqual((t1["turn"], t1["reason"]), (1, "ready"))
        self.assertEqual(t1["plans"]["0"], eng.plan_to_dict(eng.parse_plan(p0)) if p0 else None)
        self.assertEqual(t1["result"], m["last_turn"])
        # окно 2-го хода — от момента разрешения
        dl = ae._aware(__import__("datetime").datetime.fromisoformat(m["current"]["deadline"]))
        ra = ae._aware(__import__("datetime").datetime.fromisoformat(t1["resolved_at"]))
        self.assertEqual(dl - ra, timedelta(seconds=10))
        self.assertEqual((await self.state(rid, tgs[0], since=1))["turns"], [])
        # опоздавший план на 1-й ход
        r = await self.plan(rid, tgs[0], 1)
        self.assertEqual((r.status_code, r.json()["detail"]["current_turn"]), (409, 2))

    async def test_deadline_missing_plan_is_stand(self):
        tgs, rid = await self.full_room()
        await self.open_turn(rid)
        s = await self.engine_state(rid)
        p1 = self.bot(s, 1)
        self.assertIsNotNone(p1)
        # не «Готово», но план сохранён — на дедлайне он засчитывается; остальные стоят
        self.assertEqual((await self.plan(rid, tgs[1], 1, p1, ready=False)).status_code, 200)
        v = await self.state(rid, tgs[0])
        self.assertEqual((v["match"]["turn"], v["turns"]), (1, []))  # дедлайн не наступил
        await self.expire(rid)
        v = await self.state(rid, tgs[0])  # ленивое продвижение на чтении
        t1 = v["turns"][0]
        self.assertEqual((t1["reason"], v["match"]["turn"]), ("deadline", 2))
        self.assertEqual(t1["plans"], {"0": None, "1": eng.plan_to_dict(eng.parse_plan(p1)), "2": None, "3": None})
        after = await self.engine_state(rid)
        for seat in (0, 2, 3):
            self.assertEqual((after.player(seat).x, after.player(seat).y), (s.player(seat).x, s.player(seat).y))
        expect = eng.resolve_turn(s, {1: eng.parse_plan(p1)})
        self.assertEqual(eng.state_to_dict(after), eng.state_to_dict(expect))

    async def test_poller_and_late_plan(self):
        tgs, rid = await self.full_room()
        self.assertEqual(await arena_rooms.poll_once(self.S), 0)  # отсчёт: ничего
        await self.expire(rid)
        self.assertEqual(await arena_rooms.poll_once(self.S), 1)
        self.assertEqual(await arena_rooms.poll_once(self.S), 0)  # следующий ход только открылся
        self.assertEqual((await self.engine_state(rid)).turn, 2)
        # план, пришедший после дедлайна, не попадает в следующий ход: сначала разрешается просроченный
        await self.expire(rid)
        r = await self.plan(rid, tgs[0], 2)
        self.assertEqual((r.status_code, r.json()["detail"]["current_turn"]), (409, 3))
        async with self.S() as s:
            rows = (await s.execute(select(ArenaTurn.turn, ArenaTurn.reason).where(ArenaTurn.room_id == rid).order_by(ArenaTurn.turn))).all()
        self.assertEqual([tuple(r) for r in rows], [(1, "deadline"), (2, "deadline"), (3, None)])

    async def test_service_window_one_turn_per_call(self):
        tgs, rid = await self.full_room()
        async with self.S() as s:
            t1 = await s.scalar(select(ArenaTurn).where(ArenaTurn.room_id == rid))
            dl = ae._aware(t1.deadline)
            self.assertFalse(await am.is_due(s, rid, now=dl - timedelta(milliseconds=1)))
            self.assertFalse(await am.advance(s, rid, now=dl - timedelta(milliseconds=1)))
            self.assertTrue(await am.is_due(s, rid, now=dl))
            far = dl + timedelta(minutes=5)
            self.assertTrue(await am.advance(s, rid, now=far))
            self.assertFalse(await am.advance(s, rid, now=far))  # 2-й ход открылся в момент разрешения
            self.assertTrue(await am.advance(s, rid, now=far + timedelta(seconds=10)))
            await s.commit()
        self.assertEqual((await self.engine_state(rid)).turn, 3)


class FinishTest(MatchBase):
    async def play_out(self, rid, tgs):
        """Бои ботами до конца: обычно все «Готово», каждый 3-й ход место 0 молчит (дедлайн + опросчик)."""
        await self.open_turn(rid)
        for _ in range(eng.MAX_TURNS + 2):
            s = await self.engine_state(rid)
            if s.finished:
                return s
            for p in s.players:
                if not p.alive or (s.turn % 3 == 0 and p.id == 0):
                    continue
                r = await self.plan(rid, tgs[p.id], s.turn, self.bot(s, p.id))
                self.assertEqual(r.status_code, 200, r.text)
            now = await self.engine_state(rid)
            if not now.finished and now.turn == s.turn:
                await self.expire(rid)
                self.assertEqual(await arena_rooms.poll_once(self.S), 1)
        self.fail("бой не закончился")

    async def test_full_match_a4(self):
        """a4 ботами: все гибнут в зоне в один ход — общее 1-е место, приз делится на четверых."""
        await self.full_match("a4", 4)

    async def test_full_match_a8(self):
        """a8 ботами: убийства, общие и отдельные места, два приза."""
        await self.full_match("a8", 8)

    async def full_match(self, code, n):
        rt = room_type(code)
        tgs, rid = await self.full_room(code, n)
        final = await self.play_out(rid, tgs)
        v = await self.state(rid, tgs[0])
        seat_of = {tg: seat for seat, tg in enumerate(tgs)}
        self.assertEqual((v["status"], v["match"]["phase"], v["match"]["current"]), ("finished", "finished", None))
        # деньги: призы + комиссия = ставки до нанотона; история баланса — arena_prize
        async with self.S() as s:
            room = await s.get(ArenaRoom, rid)
            entries = (await s.scalars(select(ArenaEntry).where(ArenaEntry.room_id == rid).order_by(ArenaEntry.seat))).all()
            hist = (await s.scalars(select(BalanceHistory).where(BalanceHistory.balance_type == "arena_prize"))).all()
            users = {u.telegram_id: u for u in (await s.scalars(select(User))).all()}
        prizes = sum(e.prize_nano for e in entries)
        self.assertEqual(prizes + room.commission_nano, n * rt.stake_nano)
        self.assertEqual(prizes, sum(rt.prizes_nano))
        self.assertEqual(room.commission_nano, rt.pot_nano * rt.commission_bps // 10_000)
        self.assertEqual({e.status for e in entries} <= {"paid", "lost"}, True)
        paid = [e for e in entries if e.prize_nano > 0]
        self.assertEqual(sorted((h.user_id, int(h.amount * NANO), h.reference_id) for h in hist),
                         sorted((e.user_id, e.prize_nano, e.id) for e in paid))
        for seat, tg in enumerate(tgs):
            e = entries[seat]
            self.assertEqual(users[tg].id, e.user_id)
            self.assertEqual(await self.balance(tg), D("0.9") + D(e.prize_nano) / NANO)
        # итоги в виде комнаты = места движка
        places = {pl.id: pl.place for pl in final.places}
        self.assertEqual({r["seat"]: r["place"] for r in v["results"]}, places)
        self.assertEqual({r["seat"]: int(r["prize_nano"]) for r in v["results"]}, {e.seat: e.prize_nano for e in entries})
        self.assertEqual({p["seat"]: p["place"] for p in v["match"]["places"]}, places)
        # итоги: убийства, урон и ход гибели — из финального состояния
        fin = {p.id: (p.kills, p.dealt, p.death_turn) for p in final.players}
        self.assertEqual({r["seat"]: (r["kills"], r["dealt"], r["death_turn"]) for r in v["results"]}, fin)
        # история боёв игрока: этот бой, место, приз, итог, убийства, ходы
        h = (await self.client.get("/api/v1/arena/history", headers=self.h(tgs[0]))).json()
        (it,) = h["items"]
        me = entries[0]
        self.assertEqual(
            (it["room_id"], it["type"], it["status"], it["place"], int(it["prize_nano"]), int(it["net_nano"]), it["kills"]),
            (rid, code, "finished", me.place, me.prize_nano, me.prize_nano - rt.stake_nano, fin[0][0]),
        )
        self.assertEqual(it["turns"], len(v["turns"]))
        self.assertEqual(
            h["summary"],
            {"played": 1, "wins": int(me.place == 1), "prizes_nano": str(me.prize_nano),
             "net_nano": str(me.prize_nano - rt.stake_nano)},
        )
        self.assertIsNone(h["next_before"])
        # commit–reveal: только публичные данные — seed, соль, хэш до старта и журнал ходов
        self.assertEqual(hashlib.sha256(f"{v['seed_salt']}:{v['seed']}".encode()).hexdigest(), v["seed_hash"])
        log = v["turns"]
        self.assertEqual([t["turn"] for t in log], list(range(1, len(log) + 1)))
        self.assertIn("deadline", {t["reason"] for t in log})
        self.assertIn("ready", {t["reason"] for t in log})
        # рассадка: места = seat_order(seed, n) по слотам входа; слот каждого места — в публичном виде боя
        order = eng.seat_order(v["seed"], v["seats_total"])
        self.assertEqual({p["seat"]: p["slot"] for p in v["match"]["players"]}, {seat: slot for slot, seat in enumerate(order)})
        self.assertEqual([seat_of[tg] for tg in self.joined], order)
        replay = eng.run_match(
            v["type"], v["seed"], order,
            [{int(k): eng.parse_plan(p) if p else None for k, p in t["plans"].items()} for t in log],
        )
        self.assertTrue(replay.finished)
        self.assertEqual({pl.id: pl.place for pl in replay.places}, places)
        self.assertEqual(eng.state_to_dict(replay), eng.state_to_dict(final))
        raw = json.dumps(v)
        for tg in tgs:
            self.assertNotIn(f'"{tg}"', raw)
        # повторы ничего не платят; бой окончен — планы и отмена не принимаются
        async with self.S() as s:
            self.assertFalse(await am.advance(s, rid))
            again = await ae.settle(s, rid, {e.user_id: 1 for e in entries})
            self.assertTrue(again.already)
            await s.commit()
        self.assertEqual(await arena_rooms.poll_once(self.S), 0)
        for seat, tg in enumerate(tgs):
            self.assertEqual(await self.balance(tg), D("0.9") + D(entries[seat].prize_nano) / NANO)
        async with self.S() as s:
            self.assertEqual(await s.scalar(select(func.count()).select_from(BalanceHistory).where(BalanceHistory.balance_type == "arena_prize")), len(paid))
        r = await self.plan(rid, tgs[0], final.turn)
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (409, "room_state"))
        owner = await self.user(is_owner=True)
        r = await self.post(f"/rooms/{rid}/cancel", owner)
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (409, "room_state"))
        # игроки свободны — можно в новую комнату
        self.assertIsNone((await self.get("/rooms", tgs[0])).json()["active_room_id"])


class OwnerCancelTest(MatchBase):
    async def test_cancel_running_refunds_all(self):
        tgs, rid = await self.full_room()
        owner = await self.user(is_owner=True)
        await self.open_turn(rid)
        await self.plan(rid, tgs[0], 1, None)
        await self.expire(rid)
        self.assertEqual(await arena_rooms.poll_once(self.S), 1)
        r = await self.post(f"/rooms/{rid}/cancel", tgs[0])
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (403, "owner_only"))
        r = await self.post(f"/rooms/{rid}/cancel", owner)
        self.assertEqual(r.json(), {"ok": True, "room_id": rid, "status": "cancelled", "refunded": 4})
        for tg in tgs:
            self.assertEqual(await self.balance(tg), D(1))
        self.assertEqual((await self.post(f"/rooms/{rid}/cancel", owner)).json()["refunded"], 0)
        self.assertEqual((await self.post("/rooms/999/cancel", owner)).status_code, 404)
        v = await self.state(rid, tgs[1])  # участник видит отменённую комнату и раскрытый seed
        self.assertEqual((v["status"], v["match"]["phase"], v["match"]["current"]), ("cancelled", "cancelled", None))
        self.assertEqual(ae.seed_commit(v["seed"], v["seed_salt"]), v["seed_hash"])
        self.assertEqual(len(v["turns"]), 1)
        self.assertEqual(await arena_rooms.poll_once(self.S), 0)  # отменённый бой не продвигается
        r = await self.plan(rid, tgs[0], 2)
        self.assertEqual((r.status_code, r.json()["detail"]["code"]), (403, "not_playing"))
        self.assertIsNone((await self.get("/rooms", tgs[0])).json()["active_room_id"])

    async def test_cancel_waiting(self):
        a = await self.user()
        owner = await self.user(is_owner=True)
        room = (await self.post("/join", a, {"type": "a8"})).json()
        r = await self.post(f"/rooms/{room['id']}/cancel", owner)
        self.assertEqual((r.json()["status"], r.json()["refunded"]), ("cancelled", 1))
        self.assertEqual(await self.balance(a), D(1))


@unittest.skipUnless(PG_URL, "нет TEST_PG_URL — параллельные ходы на Postgres пропущены")
class PostgresTurnRaceTest(MatchBase):
    url = PG_URL or ""

    async def test_parallel_ready_and_advance(self):
        tgs, rid = await self.full_room()
        await self.open_turn(rid)
        s = await self.engine_state(rid)

        async def advance():
            async with self.S() as ss:
                ok = await am.advance(ss, rid)
                await ss.commit()
                return ok

        res = await asyncio.gather(
            *(self.plan(rid, tg, 1, self.bot(s, i)) for i, tg in enumerate(tgs)), *(advance() for _ in range(4))
        )
        codes = [r.status_code for r in res[:4]]
        self.assertEqual(codes, [200] * 4, [r.text for r in res[:4]])
        self.assertEqual(sum(r.json()["resolved"] for r in res[:4]), 1)
        self.assertEqual(sum(res[4:]), 0)  # дедлайн не наступил — продвигает только «Готово»
        async with self.S() as ss:
            rows = (await ss.execute(select(ArenaTurn.turn, ArenaTurn.reason).where(ArenaTurn.room_id == rid).order_by(ArenaTurn.turn))).all()
        self.assertEqual([tuple(r) for r in rows], [(1, "ready"), (2, None)])
        # дедлайн: опросчик и чтения одновременно — ход разрешается один раз
        await self.expire(rid)
        res = await asyncio.gather(
            arena_rooms.poll_once(self.S), *(self.get(f"/rooms/{rid}/state", tg) for tg in tgs), *(advance() for _ in range(3))
        )
        self.assertTrue(all(r.status_code == 200 for r in res[1:5]))
        self.assertEqual((await self.engine_state(rid)).turn, 3)
        async with self.S() as ss:
            n = await ss.scalar(select(func.count()).select_from(ArenaTurn).where(ArenaTurn.room_id == rid))
        self.assertEqual(n, 3)


if __name__ == "__main__":
    unittest.main()

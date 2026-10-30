"""«Башня»: попытки (сброс 00:00 МСК), старт, проверка забега, лучший счёт месяца, топ, API.

На SQLite в памяти (всегда). Запуск из backend: python -m unittest discover -s tests
"""

import asyncio
import json
import os
import re
import unittest
import warnings
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.models import TowerDailyAttempts, TowerGame, TowerMonthlyBest, User  # noqa: F401 — регистрирует таблицы
from app.services import gameday
from app.services import tower as tw
from app.services import tower_prizes as tp
from app.services import tower_engine as eng

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")

UTC = timezone.utc
VECTORS = json.loads((Path(__file__).resolve().parents[2] / "shared" / "tower-vectors.json").read_text(encoding="utf-8"))

# 27 окт 2026, 12:00 МСК = 09:00 UTC
NOON = datetime(2026, 10, 27, 9, 0, tzinfo=UTC)


def run_db(fn):
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


async def make_user(s, n, **kw) -> User:
    u = User(telegram_id=1000 + n, first_name=kw.pop("first_name", f"P{n}"), **kw)
    s.add(u)
    await s.flush()
    return u


def play_taps(seed, booster=None, plan=(), end_with_miss=True, gap=120, jitter=0):
    """Журнал бота: план — отступы от верха (0 — идеально), потом промах. Возвращает (taps, итог движка)."""
    g = eng.new_game(seed, booster)

    def find(want):
        for t in range(g.spawn_t + gap, g.spawn_t + gap + 30000):
            if want(eng.slider_x(g, t)):
                return t
        raise AssertionError("момент не найден")

    for step in plan:
        bx, bw = g.blocks[-1]
        if step == 0:
            t = find(lambda x: abs(x - bx) <= eng.PERFECT_TOL)
        else:
            t = find(lambda x: step <= x - bx <= step + 8 and abs(x - bx) > eng.PERFECT_TOL)
        eng.drop(g, t + jitter)
        if g.over:
            break
    if end_with_miss and not g.over:
        bx, bw = g.blocks[-1]
        eng.drop(g, find(lambda x: x >= bx + bw or x + g.w <= bx))
    return list(g.taps), eng.replay(seed, g.taps, booster)


async def finish_ok(s, user, game, plan=(0, 0, 0, 60, 0), at=None):
    taps, res = play_taps(game.seed, game.booster, plan)
    at = at or (gameday._aware(game.started_at) + timedelta(milliseconds=taps[-1] + 500))
    r = await tw.finish_game(s, user=user, game_id=game.id, taps=taps, claimed_score=res.score, now=at)
    return r, taps, res


class AttemptsTest(unittest.TestCase):
    def test_three_free_attempts_then_no_more(self):
        async def body(s):
            u = await make_user(s, 1)
            seeds = set()
            for i in range(3):
                g = await tw.start_game(s, user=u, now=NOON + timedelta(minutes=i))
                self.assertGreater(g.id, 0)
                self.assertTrue(0 <= g.seed < 2**32)
                seeds.add(g.seed)
            self.assertEqual(len(seeds), 3)
            with self.assertRaises(tw.NoAttemptsError) as cm:
                await tw.start_game(s, user=u, now=NOON + timedelta(minutes=5))
            self.assertEqual(cm.exception.status, 409)
            st = await tw.my_status(s, user_id=u.id, now=NOON + timedelta(minutes=5))
            self.assertEqual((st["used_today"], st["left_today"], st["free_per_day"]), (3, 0, 3))
            # отказ не создал лишнюю игру и не сдвинул счётчик
            games = (await s.scalars(select(TowerGame).where(TowerGame.user_id == u.id))).all()
            self.assertEqual(len(games), 3)

        run_db(body)

    def test_attempt_is_charged_at_start_not_at_finish(self):
        async def body(s):
            u = await make_user(s, 1)
            await tw.start_game(s, user=u, now=NOON)
            st = await tw.my_status(s, user_id=u.id, now=NOON)
            self.assertEqual(st["left_today"], 2)  # забег брошен, не завершён — попытка всё равно потрачена

        run_db(body)

    def test_reset_at_moscow_midnight(self):
        async def body(s):
            u = await make_user(s, 1)
            # 23:59:59 МСК (20:59:59 UTC) 27 октября — день ещё тот же
            late = datetime(2026, 10, 27, 20, 59, 59, tzinfo=UTC)
            for _ in range(3):
                await tw.start_game(s, user=u, now=late - timedelta(minutes=10))
            with self.assertRaises(tw.NoAttemptsError):
                await tw.start_game(s, user=u, now=late)
            st = await tw.my_status(s, user_id=u.id, now=late)
            self.assertEqual(st["left_today"], 0)
            self.assertEqual(datetime.fromisoformat(st["next_reset_at"]), datetime(2026, 10, 27, 21, 0, tzinfo=UTC))
            # 00:00:00 МСК (21:00:00 UTC) 28 октября — снова 3 попытки
            midnight = datetime(2026, 10, 27, 21, 0, 0, tzinfo=UTC)
            st = await tw.my_status(s, user_id=u.id, now=midnight)
            self.assertEqual((st["used_today"], st["left_today"]), (0, 3))
            for _ in range(3):
                await tw.start_game(s, user=u, now=midnight)
            with self.assertRaises(tw.NoAttemptsError):
                await tw.start_game(s, user=u, now=midnight + timedelta(hours=1))

        run_db(body)

    def test_utc_midnight_does_not_reset(self):
        async def body(s):
            u = await make_user(s, 1)
            before = datetime(2026, 10, 27, 20, 0, tzinfo=UTC)  # 23:00 МСК
            for _ in range(3):
                await tw.start_game(s, user=u, now=before)
            # 00:00 UTC = 03:00 МСК того же дня... но уже следующего по Москве? нет: 23:00 МСК → 00:30 UTC = 03:30 МСК 28-го
            utc_midnight = datetime(2026, 10, 28, 0, 0, tzinfo=UTC)  # 03:00 МСК 28 октября: новый игровой день
            self.assertEqual(gameday.game_day(utc_midnight).isoformat(), "2026-10-28")
            st = await tw.my_status(s, user_id=u.id, now=utc_midnight)
            self.assertEqual(st["left_today"], 3)
            # а 00:00 UTC *до* московской полуночи — тот же день, сброса нет
            same_day = datetime(2026, 10, 27, 0, 0, tzinfo=UTC)  # 03:00 МСК 27-го
            self.assertEqual(gameday.game_day(same_day).isoformat(), "2026-10-27")
            st = await tw.my_status(s, user_id=u.id, now=same_day)
            self.assertEqual(st["left_today"], 0)

        run_db(body)

    def test_attempts_are_per_user(self):
        async def body(s):
            a, b = await make_user(s, 1), await make_user(s, 2)
            for _ in range(3):
                await tw.start_game(s, user=a, now=NOON)
            g = await tw.start_game(s, user=b, now=NOON)
            self.assertEqual(g.user_id, b.id)

        run_db(body)

    def test_booster_not_available_yet(self):
        async def body(s):
            u = await make_user(s, 1)
            for b in ("slow", "aim", "x"):
                with self.assertRaises(tw.TowerError) as cm:
                    await tw.start_game(s, user=u, booster=b, now=NOON)
                self.assertEqual(cm.exception.code, "booster_unavailable")
            self.assertEqual((await tw.my_status(s, user_id=u.id, now=NOON))["left_today"], 3)  # попытка не списана

        run_db(body)


class FinishTest(unittest.TestCase):
    def test_valid_run_is_stored_with_server_score(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            r, taps, res = await finish_ok(s, u, g, plan=(0, 0, 0, 60, 0, 25, 0))
            self.assertEqual(r.game.status, "finished")
            self.assertEqual((r.game.score, r.game.height, r.game.perfects), (res.score, res.height, res.perfects))
            self.assertGreater(res.score, 5)
            self.assertTrue(r.new_best)
            self.assertEqual((r.best_month, r.rank), (res.score, 1))
            self.assertEqual(r.game.taps, taps)

        run_db(body)

    def test_one_finish_per_game(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            _, taps, res = await finish_ok(s, u, g)
            with self.assertRaises(tw.TowerError) as cm:
                await tw.finish_game(s, user=u, game_id=g.id, taps=taps, claimed_score=res.score, now=NOON + timedelta(minutes=2))
            self.assertEqual((cm.exception.code, cm.exception.status), ("already_finished", 409))

        run_db(body)

    def test_other_users_game_is_not_found(self):
        async def body(s):
            a, b = await make_user(s, 1), await make_user(s, 2)
            g = await tw.start_game(s, user=a, now=NOON)
            taps, res = play_taps(g.seed, None, (0, 0))
            with self.assertRaises(tw.TowerError) as cm:
                await tw.finish_game(s, user=b, game_id=g.id, taps=taps, claimed_score=res.score, now=NOON + timedelta(minutes=1))
            self.assertEqual(cm.exception.status, 404)
            with self.assertRaises(tw.TowerError) as cm:
                await tw.finish_game(s, user=a, game_id=999, taps=taps, claimed_score=res.score, now=NOON)
            self.assertEqual(cm.exception.status, 404)

        run_db(body)

    def test_wrong_claimed_score_is_rejected_and_game_closed(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            taps, res = play_taps(g.seed, None, (0, 0, 0))
            at = NOON + timedelta(seconds=60)
            with self.assertRaises(tw.RejectedError) as cm:
                await tw.finish_game(s, user=u, game_id=g.id, taps=taps, claimed_score=res.score + 5, now=at)
            self.assertEqual(cm.exception.code, "replay_mismatch")
            self.assertEqual((g.status, g.reject_reason, g.score), ("rejected", "replay_mismatch", 0))
            # второй заход с правильным счётом уже не пройдёт: одна попытка финиша на игру
            with self.assertRaises(tw.TowerError) as cm:
                await tw.finish_game(s, user=u, game_id=g.id, taps=taps, claimed_score=res.score, now=at)
            self.assertEqual(cm.exception.status, 409)
            self.assertIsNone(await s.scalar(select(TowerMonthlyBest).where(TowerMonthlyBest.user_id == u.id)))

        run_db(body)

    def test_log_for_another_seed_is_a_mismatch(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            # идеальная партия, подобранная под чужой seed, на этом seed не даст заявленного счёта
            taps, res = play_taps((g.seed + 1) & 0xFFFFFFFF, None, (0,) * 12)
            self.assertGreater(res.score, 20)
            with self.assertRaises(tw.RejectedError) as cm:
                await tw.finish_game(s, user=u, game_id=g.id, taps=taps, claimed_score=res.score, now=NOON + timedelta(minutes=5))
            self.assertIn(cm.exception.code, ("replay_mismatch", "bad_taps"))

        run_db(body)

    def test_impossibly_fast_taps_rejected(self):
        async def body(s):
            for n, taps in enumerate(([200, 230], [150, 150], [200, 400, 460], [200, 269]), start=1):
                u = await make_user(s, n)
                g = await tw.start_game(s, user=u, now=NOON)
                with self.assertRaises(tw.RejectedError, msg=str(taps)) as cm:
                    await tw.finish_game(s, user=u, game_id=g.id, taps=taps, claimed_score=0, now=NOON + timedelta(minutes=1))
                self.assertEqual(cm.exception.code, "taps_too_fast")
                self.assertEqual(g.status, "rejected")
            # ровно на пределе (100 мс до первого тапа, 70 мс между тапами) — ещё можно, на 1 мс меньше — нельзя
            tw._check_taps([100, 170, 240], 10**6)
            for bad in ([99], [100, 169], [100, 170, 239]):
                with self.assertRaises(tw.RejectedError):
                    tw._check_taps(bad, 10**6)

        run_db(body)

    def test_fast_first_tap_rejected(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            with self.assertRaises(tw.RejectedError) as cm:
                await tw.finish_game(s, user=u, game_id=g.id, taps=[40], claimed_score=0, now=NOON + timedelta(minutes=1))
            self.assertEqual(cm.exception.code, "taps_too_fast")

        run_db(body)

    def test_game_clock_cannot_outrun_wall_clock(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            taps, res = play_taps(g.seed, None, (0,) * 25)
            self.assertGreater(taps[-1], 15_000)
            # финиш через 5 секунд после старта, а в журнале 15+ секунд игры
            with self.assertRaises(tw.RejectedError) as cm:
                await tw.finish_game(s, user=u, game_id=g.id, taps=taps, claimed_score=res.score, now=NOON + timedelta(seconds=5))
            self.assertEqual(cm.exception.code, "bad_duration")

        run_db(body)

    def test_duration_slack_allows_small_lag(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            taps, res = play_taps(g.seed, None, (0, 0, 0))
            # финиш на 1 с «раньше» последнего тапа по игровым часам — в пределах запаса
            at = NOON + timedelta(milliseconds=taps[-1] - 1000)
            r = await tw.finish_game(s, user=u, game_id=g.id, taps=taps, claimed_score=res.score, now=at)
            self.assertEqual(r.game.status, "finished")

        run_db(body)

    def test_taps_after_game_over_rejected(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            taps, res = play_taps(g.seed, None, (0, 0))
            self.assertTrue(res.over)
            with self.assertRaises(tw.RejectedError) as cm:
                await tw.finish_game(s, user=u, game_id=g.id, taps=taps + [taps[-1] + 500], claimed_score=res.score, now=NOON + timedelta(minutes=2))
            self.assertEqual(cm.exception.code, "bad_taps")

        run_db(body)

    def test_expired_game_closed(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            taps, res = play_taps(g.seed, None, (0, 0))
            with self.assertRaises(tw.RejectedError) as cm:
                await tw.finish_game(s, user=u, game_id=g.id, taps=taps, claimed_score=res.score, now=NOON + timedelta(hours=3))
            self.assertEqual(cm.exception.code, "expired")

        run_db(body)

    def test_too_many_taps_and_negative(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            with self.assertRaises(tw.RejectedError) as cm:
                await tw.finish_game(s, user=u, game_id=g.id, taps=list(range(200, 200 + 80 * 3001, 80)), claimed_score=0, now=NOON + timedelta(hours=1))
            self.assertEqual(cm.exception.code, "too_many_taps")
            g2 = await tw.start_game(s, user=u, now=NOON)
            with self.assertRaises(tw.RejectedError) as cm:
                await tw.finish_game(s, user=u, game_id=g2.id, taps=[-5], claimed_score=0, now=NOON + timedelta(minutes=1))
            self.assertEqual(cm.exception.code, "bad_taps")

        run_db(body)

    def test_empty_log_is_a_zero_game(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=NOON)
            r = await tw.finish_game(s, user=u, game_id=g.id, taps=[], claimed_score=0, now=NOON + timedelta(seconds=3))
            self.assertEqual((r.game.status, r.game.score, r.new_best, r.rank), ("finished", 0, False, None))

        run_db(body)

    def test_limits_match_js(self):
        self.assertEqual(VECTORS["limits"]["MIN_FIRST_TAP_MS"], tw.MIN_FIRST_TAP_MS)
        self.assertEqual(VECTORS["limits"]["MIN_TAP_GAP_MS"], tw.MIN_TAP_GAP_MS)


class MonthlyBestTest(unittest.TestCase):
    def test_keeps_max_not_sum_and_ignores_lower_score(self):
        async def body(s):
            u = await make_user(s, 1)
            scores = []
            for plan in ((0, 0, 0, 0, 0, 0), (0,), (0, 0, 0, 0, 0, 0, 0, 0)):
                g = await tw.start_game(s, user=u, now=NOON)
                r, _, res = await finish_ok(s, u, g, plan=plan, at=NOON + timedelta(minutes=3))
                scores.append(res.score)
            self.assertEqual(len(set(scores)), 3)
            row = await s.scalar(select(TowerMonthlyBest).where(TowerMonthlyBest.user_id == u.id))
            self.assertEqual(row.best_score, max(scores))
            self.assertNotEqual(row.best_score, sum(scores))
            self.assertEqual(row.month.isoformat(), "2026-10-01")

        run_db(body)

    def test_month_changes_at_moscow_midnight(self):
        async def body(s):
            u = await make_user(s, 1)
            g = await tw.start_game(s, user=u, now=datetime(2026, 10, 31, 20, 0, tzinfo=UTC))
            # 31 окт 23:59:30 МСК — ещё октябрь
            r, _, res1 = await finish_ok(s, u, g, plan=(0, 0), at=datetime(2026, 10, 31, 20, 59, 30, tzinfo=UTC))
            g = await tw.start_game(s, user=u, now=datetime(2026, 10, 31, 21, 0, tzinfo=UTC))
            # 1 ноя 00:00:10 МСК — ноябрь, и это другой игровой день: попытки снова 3
            r2, _, res2 = await finish_ok(s, u, g, plan=(0, 0, 0), at=datetime(2026, 10, 31, 21, 0, 10, tzinfo=UTC))
            rows = (await s.scalars(select(TowerMonthlyBest).where(TowerMonthlyBest.user_id == u.id).order_by(TowerMonthlyBest.month))).all()
            self.assertEqual([r.month.isoformat() for r in rows], ["2026-10-01", "2026-11-01"])
            self.assertEqual([r.best_score for r in rows], [res1.score, res2.score])

        run_db(body)


class LeaderboardTest(unittest.TestCase):
    async def _set(self, s, user, score, minute, month="2026-10-01"):
        from datetime import date

        s.add(TowerMonthlyBest(user_id=user.id, month=date.fromisoformat(month), best_score=score,
                               achieved_at=NOON + timedelta(minutes=minute)))
        await s.flush()

    def test_order_ties_and_me(self):
        async def body(s):
            us = [await make_user(s, i, first_name=f"Игрок{i}") for i in range(1, 7)]
            # счёт, минута набора
            await self._set(s, us[0], 50, 10)
            await self._set(s, us[1], 90, 30)
            await self._set(s, us[2], 90, 20)  # тот же счёт, набран раньше → выше
            await self._set(s, us[3], 10, 1)
            await self._set(s, us[4], 70, 5)
            # шестой без результата
            lb = await tw.leaderboard(s, user_id=us[0].id, limit=10, now=NOON)
            self.assertEqual([e["name"] for e in lb["entries"]], ["Игрок3", "Игрок2", "Игрок5", "Игрок1", "Игрок4"])
            self.assertEqual([e["rank"] for e in lb["entries"]], [1, 2, 3, 4, 5])
            self.assertEqual([e["score"] for e in lb["entries"]], [90, 90, 70, 50, 10])
            self.assertEqual([e["is_me"] for e in lb["entries"]], [False, False, False, True, False])
            self.assertEqual(lb["me"], {"rank": 4, "score": 50})
            self.assertEqual((lb["total_players"], lb["month"]), (5, "2026-10"))
            # игрок без счёта: места нет
            lb6 = await tw.leaderboard(s, user_id=us[5].id, limit=10, now=NOON)
            self.assertIsNone(lb6["me"])

        run_db(body)

    def test_me_rank_outside_top_n(self):
        async def body(s):
            us = [await make_user(s, i) for i in range(1, 8)]
            for i, u in enumerate(us):
                await self._set(s, u, 100 - i * 10, i)
            lb = await tw.leaderboard(s, user_id=us[6].id, limit=3, now=NOON)
            self.assertEqual(len(lb["entries"]), 3)
            self.assertFalse(any(e["is_me"] for e in lb["entries"]))
            self.assertEqual(lb["me"], {"rank": 7, "score": 40})
            self.assertEqual(lb["total_players"], 7)

        run_db(body)

    def test_equal_score_and_time_falls_back_to_user_id(self):
        async def body(s):
            a, b = await make_user(s, 1), await make_user(s, 2)
            await self._set(s, b, 30, 5)
            await self._set(s, a, 30, 5)
            lb = await tw.leaderboard(s, user_id=b.id, limit=10, now=NOON)
            self.assertEqual([e["is_me"] for e in lb["entries"]], [False, True])  # a (меньший id) выше
            self.assertEqual(lb["me"]["rank"], 2)

        run_db(body)

    def test_month_filter_and_banned_hidden(self):
        async def body(s):
            a = await make_user(s, 1)
            cheat = await make_user(s, 2, is_banned=True)
            await self._set(s, a, 20, 1)
            await self._set(s, cheat, 999, 1)
            await self._set(s, a, 500, 1, month="2026-09-01")
            lb = await tw.leaderboard(s, user_id=a.id, limit=10, now=NOON)
            self.assertEqual([(e["score"]) for e in lb["entries"]], [20])
            old = await tw.leaderboard(s, user_id=a.id, month=tw.parse_month("2026-09"), limit=10)
            self.assertEqual([(e["score"]) for e in old["entries"]], [500])
            with self.assertRaises(tw.TowerError):
                tw.parse_month("октябрь")

        run_db(body)

    def test_leaderboard_after_real_runs(self):
        async def body(s):
            a, b = await make_user(s, 1), await make_user(s, 2)
            ga = await tw.start_game(s, user=a, now=NOON)
            gb = await tw.start_game(s, user=b, now=NOON)
            _, _, ra = await finish_ok(s, a, ga, plan=(0,) * 3, at=NOON + timedelta(minutes=2))
            _, _, rb = await finish_ok(s, b, gb, plan=(0,) * 9, at=NOON + timedelta(minutes=2))
            lb = await tw.leaderboard(s, user_id=a.id, now=NOON)
            self.assertEqual([e["score"] for e in lb["entries"]], [rb.score, ra.score])
            self.assertEqual(lb["me"]["rank"], 2)

        run_db(body)


class PrizesTest(unittest.TestCase):
    """Настройка tower_prizes: бюджет, места (лесенка и %), гармонические доли, группы, округление вниз."""

    ON = {**tp.DEFAULT, "enabled": True, "budget_ton": "100"}

    @staticmethod
    def flat(plan):
        """Суммы по каждому месту: [TON места 1, места 2, …]."""
        out = []
        for g in plan["prizes"]:
            out += [Decimal(g["ton"])] * (g["to_place"] - g["from_place"] + 1)
        return out

    def test_legacy_row_migrates(self):
        old = {"enabled": True, "budget_ton": "10", "min_participants": 10, "base_places": 3, "extra_place_every": 20,
               "max_places": 5, "shares": {"3": [50, 30, 20]}, "min_score": 1, "payout_mode": "review"}
        cfg = tp.normalize(old)
        self.assertNotIn("shares", cfg)
        self.assertEqual((cfg["ladder_max_places"], cfg["max_places"]), (5, 200))
        self.assertEqual(cfg["bands"], [20, 50, 100, 200])

    def test_default_is_off_and_valid(self):
        from app.services.economy_seed import DEFAULTS

        self.assertEqual(DEFAULTS["tower_prizes"][0], tp.DEFAULT)
        self.assertEqual(tp.normalize(tp.DEFAULT), tp.DEFAULT)
        self.assertFalse(tp.DEFAULT["enabled"])
        self.assertEqual(tp.DEFAULT["budget_ton"], "0")
        self.assertEqual((tp.DEFAULT["places_percent"], tp.DEFAULT["max_places"], tp.DEFAULT["min_prize_ton"]), (5, 200, "0.1"))
        self.assertEqual((tp.DEFAULT["individual_places"], tp.DEFAULT["bands"]), (10, [20, 50, 100, 200]))
        # черновой формат с таблицами долей отбрасывается без ошибки
        legacy = {**tp.DEFAULT, "shares": {"3": [50, 30, 20]}}
        self.assertEqual(tp.normalize(legacy), tp.DEFAULT)

    def test_places_ladder_and_percent(self):
        cfg = tp.normalize(self.ON)
        want = {0: 0, 9: 0, 10: 3, 15: 3, 20: 3, 21: 4, 40: 4, 41: 5, 100: 5, 119: 5, 120: 6,
                500: 25, 2000: 100, 4000: 200, 10**6: 200}
        for n, places in want.items():
            with self.subTest(n=n):
                self.assertEqual(tp.places_for(cfg, n)[0], places)
        nxt = {0: 10, 9: 10, 10: 21, 20: 21, 21: 41, 41: 120, 120: 140, 500: 520, 3999: 4000, 4000: None}
        for n, at in nxt.items():
            with self.subTest(n=n):
                self.assertEqual(tp.next_place_at(cfg, n), at)
        self.assertEqual(tp.places_for(cfg, 4000), (200, "max"))
        # настраивается: 10 % мест, потолок 30
        cfg2 = tp.normalize({**self.ON, "places_percent": 10, "max_places": 30})
        self.assertEqual([tp.places_for(cfg2, n)[0] for n in (10, 21, 60, 299, 1000)], [3, 4, 6, 29, 30])
        # без процента — только лесенка
        cfg3 = tp.normalize({**self.ON, "places_percent": 0})
        self.assertEqual((tp.places_for(cfg3, 10**5)[0], tp.next_place_at(cfg3, 41)), (5, None))

    def test_harmonic_split_and_groups(self):
        cfg = tp.normalize(self.ON)
        p = tp.plan(cfg, 15)
        self.assertEqual([g["ton"] for g in p["prizes"]], ["54.5454", "27.2727", "18.1818"])
        self.assertEqual((p["total_ton"], p["unspent_ton"]), ("99.9999", "0.0001"))
        self.assertEqual([g["ton"] for g in tp.plan(cfg, 21)["prizes"]], ["48", "24", "16", "12"])
        p = tp.plan(cfg, 2000)
        rng = [(g["from_place"], g["to_place"]) for g in p["prizes"]]
        self.assertEqual(rng, [(i, i) for i in range(1, 11)] + [(11, 20), (21, 50), (51, 100)])
        self.assertEqual(p["prizes"][-1]["ton"], "0.2653")
        # хвост за последней границей — одна группа; группа обрезается по числу мест
        cfg4 = tp.normalize({**self.ON, "bands": [20], "places_percent": 10})
        self.assertEqual([(g["from_place"], g["to_place"]) for g in tp.plan(cfg4, 450)["prizes"]][-2:], [(11, 20), (21, 45)])

    def test_min_prize_cuts_places_not_below_base(self):
        # 5 TON на 4000 игроков: 200 мест по 0.1 не выйдет — мест меньше, у последнего ≥ 0.1
        cfg = tp.normalize({**self.ON, "budget_ton": "5"})
        n, why = tp.places_for(cfg, 4000)
        self.assertEqual(why, "budget")
        self.assertLess(n, 200)
        p = tp.plan(cfg, 4000)
        self.assertGreaterEqual(min(self.flat(p)), Decimal("0.1"))
        self.assertIsNone(p["next_place_at"])
        # на одно место больше — уже кто-то ниже 0.1
        self.assertLess(tp.amounts(cfg, Decimal(5), n + 1)[-1][2], Decimal("0.1"))
        # минимум для 3 мест: 0.1 × 3 × H3 = 0.55 TON
        self.assertEqual(tp.min_budget(cfg), Decimal("0.55"))
        self.assertEqual(tp.places_for({**cfg, "budget_ton": "0.55"}, 1000), (3, "budget"))
        # меньше — включить нельзя, а если в базе так оказалось — призов нет, бюджет не тратится
        with self.assertRaises(tp.PrizeConfigError):
            tp.normalize({**self.ON, "budget_ton": "0.5499"})
        broken = {**cfg, "budget_ton": "0.5"}
        p = tp.plan(broken, 1000)
        self.assertEqual((p["places"], p["prizes"], p["unspent_ton"], p["limited_by"]), (0, [], "0.5", "budget"))
        self.assertIsNone(tp.next_place_at(broken, 1000))

    def test_invariants_random(self):
        """Свойства на тысячах случайных бюджетов и составов: итог ≤ бюджета, не растут, ≥ min_prize."""
        import random

        rnd = random.Random(20261030)
        cfgs = [tp.normalize(self.ON)]
        for _ in range(40):
            ind = rnd.randint(1, 30)
            bands = sorted(rnd.sample(range(ind + 1, 400), rnd.randint(0, 5)))
            cfgs.append(tp.normalize({
                **self.ON, "budget_ton": "100000",
                "places_percent": rnd.randint(0, 30), "max_places": rnd.randint(5, 400),
                "min_prize_ton": str(Decimal(rnd.randint(1, 5000)) / 10000),
                "individual_places": ind, "bands": bands,
                "extra_place_every": rnd.randint(0, 50),
            }))
        checked = 0
        for _ in range(1500):
            cfg = dict(rnd.choice(cfgs))
            budget = (Decimal(rnd.randint(1, 10**9)) / 10000).quantize(tp.STEP)  # до 100000 TON
            if rnd.random() < 0.3:
                budget = (Decimal(rnd.randint(1, 50000)) / 10000)
            cfg["budget_ton"] = tp.ton_str(budget)
            players = rnd.choice([rnd.randint(0, 60), rnd.randint(0, 5000), rnd.randint(0, 10**6)])
            p = tp.plan(cfg, players)
            flat = self.flat(p)
            with self.subTest(budget=str(budget), players=players, cfg=cfg):
                self.assertLessEqual(sum(flat, Decimal(0)), budget)
                self.assertEqual(Decimal(p["total_ton"]) + Decimal(p["unspent_ton"]), budget)
                self.assertEqual(len(flat), p["places"])
                self.assertTrue(all(b <= a for a, b in zip(flat, flat[1:])), "суммы не растут")
                self.assertTrue(all(x == x.quantize(tp.STEP) for x in flat))
                if flat:
                    self.assertGreaterEqual(flat[-1], Decimal(cfg["min_prize_ton"]))
                    self.assertGreaterEqual(p["places"], cfg["base_places"])
                    self.assertLessEqual(p["places"], min(cfg["max_places"], players))
                    checked += 1
                if p["limited_by"] == "budget" and flat:
                    # бюджет режет места ровно до предела: на одно место больше — кто-то ниже min_prize
                    more = tp.amounts(cfg, budget, p["places"] + 1)
                    self.assertLess(more[-1][2], Decimal(cfg["min_prize_ton"]))
                if players < cfg["min_participants"]:
                    self.assertEqual(flat, [])
        self.assertGreater(checked, 500)

    def test_rejects_bad_values(self):
        ok = self.ON
        bad = [
            "x",
            {**ok, "extra": 1},
            {**ok, "places": []},  # самый старый формат
            {**ok, "enabled": "yes"},
            {**ok, "budget_ton": "0"},  # включено без бюджета
            {**ok, "budget_ton": "0.3"},  # не хватает на 3 места по 0.1
            {**ok, "budget_ton": "-1"},
            {**ok, "budget_ton": "abc"},
            {**ok, "budget_ton": "NaN"},
            {**ok, "budget_ton": "100001"},
            {**ok, "budget_ton": "0.00001"},
            {**ok, "budget_ton": True},
            {**ok, "min_prize_ton": "0"},
            {**ok, "min_prize_ton": "0.00001"},
            {**ok, "base_places": 0},
            {**ok, "ladder_max_places": 2},  # меньше base
            {**ok, "max_places": 4},  # меньше лесенки
            {**ok, "max_places": 1001},
            {**ok, "places_percent": 101},
            {**ok, "places_percent": -1},
            {**ok, "extra_place_every": -1},
            {**ok, "min_participants": 2},  # меньше числа мест
            {**ok, "individual_places": 0},
            {**ok, "bands": [10, 50]},  # первая граница не больше individual_places
            {**ok, "bands": [50, 20]},
            {**ok, "bands": [20, 20]},
            {**ok, "bands": "20 50"},
            {**ok, "bands": [20.5]},
            {**ok, "bands": list(range(11, 40))},  # больше 20 групп
            {**ok, "min_score": 0},
            {**ok, "payout_mode": "auto"},
        ]
        for v in bad:
            with self.subTest(v=v), self.assertRaises(tp.PrizeConfigError):
                tp.normalize(v)
        self.assertEqual(tp.normalize({**ok, "budget_ton": 25})["budget_ton"], "25")
        self.assertEqual(tp.normalize({**ok, "budget_ton": "12.5000"})["budget_ton"], "12.5")
        self.assertEqual(tp.normalize({**ok, "bands": []})["bands"], [])
        # битая запись в базе не роняет топ — призы выключены
        self.assertEqual(tp.safe({"enabled": True}), tp.DEFAULT)
        self.assertEqual(tp.safe({"enabled": True, "places": [{"place": 1, "ton": "1"}]}), tp.DEFAULT)

    def test_owner_save_validates_and_normalizes(self):
        from app.services.economy_admin import EconomyAdminError, set_setting

        async def body(s):
            with self.assertRaises(EconomyAdminError):
                await set_setting(s, key="tower_prizes", value={**tp.DEFAULT, "enabled": True})
            with self.assertRaises(EconomyAdminError):
                await set_setting(s, key="tower_prizes", value={**self.ON, "budget_ton": "0.4"})
            v = await set_setting(s, key="tower_prizes", value={**self.ON, "budget_ton": "20.50", "min_prize_ton": "0.10"})
            self.assertEqual((v.value["budget_ton"], v.value["min_prize_ton"]), ("20.5", "0.1"))

        run_db(body)

    def test_leaderboard_prizes_follow_participants(self):
        from datetime import date

        from app.services.economy_admin import set_setting

        async def body(s):
            users = [await make_user(s, i) for i in range(1, 46)]
            me = users[0]

            async def add(n0, n1, month="2026-10-01"):
                for i, u in enumerate(users[n0:n1], start=n0):
                    s.add(TowerMonthlyBest(user_id=u.id, month=date.fromisoformat(month), best_score=1000 - i,
                                           achieved_at=NOON + timedelta(minutes=i)))
                await s.flush()

            lb = await tw.leaderboard(s, user_id=me.id, now=NOON)
            self.assertIsNone(lb["prizes"])
            self.assertIsNone(lb["prize_budget_ton"])
            self.assertEqual((lb["min_participants"], lb["prize_places"], lb["max_places"]), (10, 0, 200))
            self.assertEqual(lb["month_ends_at"], "2026-10-31T21:00:00+00:00")
            await set_setting(s, key="tower_prizes", value={**self.ON, "budget_ton": "10"})
            await add(0, 9)
            lb = await tw.leaderboard(s, user_id=me.id, now=NOON)
            self.assertEqual((lb["participants"], lb["prize_places"], lb["prizes"], lb["next_place_at"]), (9, 0, [], 10))
            self.assertEqual((lb["prize_budget_ton"], lb["prize_cutoff_score"]), ("10", None))
            await add(9, 20)
            lb = await tw.leaderboard(s, user_id=me.id, now=NOON)
            self.assertEqual((lb["participants"], lb["prize_places"], lb["next_place_at"]), (20, 3, 21))
            self.assertEqual([p["ton"] for p in lb["prizes"]], ["5.4545", "2.7272", "1.8181"])
            self.assertEqual((lb["prize_total_ton"], lb["min_prize_ton"], lb["prize_limited_by"]), ("9.9998", "0.1", None))
            self.assertEqual(lb["prize_cutoff_score"], 1000 - 2)  # счёт 3-го места
            await add(20, 21)
            lb = await tw.leaderboard(s, user_id=me.id, now=NOON)
            self.assertEqual((lb["prize_places"], lb["next_place_at"]), (4, 41))
            self.assertEqual([p["ton"] for p in lb["prizes"]], ["4.8", "2.4", "1.6", "1.2"])
            await add(21, 41)
            lb = await tw.leaderboard(s, user_id=me.id, now=NOON)
            self.assertEqual((lb["participants"], lb["prize_places"], lb["next_place_at"]), (41, 5, 120))
            self.assertEqual(lb["prizes"][0], {"from_place": 1, "to_place": 1, "ton": "4.3795"})
            self.assertEqual(lb["prize_cutoff_score"], 1000 - 4)
            # min_score: участник — с лучшим счётом не меньше порога
            await set_setting(s, key="tower_prizes", value={**self.ON, "min_score": 1000 - 19})
            lb = await tw.leaderboard(s, user_id=me.id, now=NOON)
            self.assertEqual((lb["total_players"], lb["participants"], lb["prize_places"]), (41, 20, 3))
            # выключено — призов нет, бюджет не показываем
            await set_setting(s, key="tower_prizes", value={**tp.DEFAULT, "budget_ton": "10"})
            lb = await tw.leaderboard(s, user_id=me.id, now=NOON)
            self.assertIsNone(lb["prizes"])
            self.assertIsNone(lb["prize_cutoff_score"])
            # прошлый месяц: истории бюджета нет — без призов
            await set_setting(s, key="tower_prizes", value=self.ON)
            old = await tw.leaderboard(s, user_id=me.id, month=tw.parse_month("2026-09"), now=NOON)
            self.assertIsNone(old["prizes"])
            self.assertEqual(old["month_ends_at"], "2026-09-30T21:00:00+00:00")

        run_db(body)


class ApiTest(unittest.TestCase):
    """Через HTTP: подмена БД и авторизации, ответы и коды."""

    def test_flow(self):
        from app.api.deps import get_current_user
        from app.db.session import get_db
        from app.main import app

        async def main():
            engine = create_async_engine("sqlite+aiosqlite:///:memory:", poolclass=StaticPool)
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
            async with maker() as s:
                me = await make_user(s, 1, first_name="Сергей")
                other = await make_user(s, 2, first_name="Аня")
                await s.commit()
                me_id, other_id = me.id, other.id
            who = {"id": me_id}

            async def db_dep():
                async with maker() as session:
                    yield session

            async def user_dep():
                async with maker() as session:
                    return await session.get(User, who["id"])

            app.dependency_overrides[get_db] = db_dep
            app.dependency_overrides[get_current_user] = user_dep
            try:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
                    r = await c.get("/api/v1/tower/me")
                    self.assertEqual(r.status_code, 200, r.text)
                    j = r.json()
                    self.assertEqual((j["free_per_day"], j["left_today"], j["best_month"], j["rank"]), (3, 3, None, None))
                    self.assertTrue(re.match(r"^\d{4}-\d{2}$", j["month"]))
                    self.assertTrue(j["next_reset_at"].endswith("+00:00"))

                    r = await c.post("/api/v1/tower/start", json={"booster": "slow"})
                    self.assertEqual((r.status_code, r.json()["detail"]["code"]), (400, "booster_unavailable"))

                    r = await c.post("/api/v1/tower/start")
                    self.assertEqual(r.status_code, 200, r.text)
                    g = r.json()
                    self.assertEqual(g["status"]["left_today"], 2)
                    self.assertIsNone(g["booster"])

                    taps, res = play_taps(g["seed"], None, (0, 0, 0, 60, 0))
                    # настенные часы тестов: игра «длилась» дольше нуля мс, подвинем старт назад
                    async with maker() as s:
                        gm = await s.get(TowerGame, g["game_id"])
                        gm.started_at = gameday.now_utc() - timedelta(milliseconds=taps[-1] + 1000)
                        await s.commit()

                    bad = await c.post("/api/v1/tower/finish", json={"game_id": g["game_id"], "taps": taps, "score": res.score + 1})
                    self.assertEqual((bad.status_code, bad.json()["detail"]["code"]), (422, "replay_mismatch"))
                    again = await c.post("/api/v1/tower/finish", json={"game_id": g["game_id"], "taps": taps, "score": res.score})
                    self.assertEqual((again.status_code, again.json()["detail"]["code"]), (409, "already_finished"))

                    # новая игра, теперь честно
                    g = (await c.post("/api/v1/tower/start")).json()
                    taps, res = play_taps(g["seed"], None, (0, 0, 0, 60, 0))
                    async with maker() as s:
                        gm = await s.get(TowerGame, g["game_id"])
                        gm.started_at = gameday.now_utc() - timedelta(milliseconds=taps[-1] + 1000)
                        await s.commit()
                    r = await c.post("/api/v1/tower/finish", json={"game_id": g["game_id"], "taps": taps, "score": res.score})
                    self.assertEqual(r.status_code, 200, r.text)
                    f = r.json()
                    self.assertEqual((f["score"], f["best_month"], f["rank"], f["new_best"], f["over"]), (res.score, res.score, 1, True, True))
                    self.assertEqual(f["status"]["left_today"], 1)

                    # нецелые тапы не принимаются схемой
                    g = (await c.post("/api/v1/tower/start")).json()
                    r = await c.post("/api/v1/tower/finish", json={"game_id": g["game_id"], "taps": [200.5], "score": 0})
                    self.assertEqual(r.status_code, 422)

                    # попытки кончились: 409 с кодом и временем сброса
                    r = await c.post("/api/v1/tower/start")
                    self.assertEqual(r.status_code, 409)
                    d = r.json()["detail"]
                    self.assertEqual(d["code"], "no_attempts")
                    self.assertTrue(d["next_reset_at"])

                    lb = (await c.get("/api/v1/tower/leaderboard", params={"limit": 5})).json()
                    self.assertEqual([(e["name"], e["score"], e["is_me"]) for e in lb["entries"]], [("Сергей", res.score, True)])
                    self.assertEqual(lb["me"]["rank"], 1)
                    # призы не назначены — null; конец месяца и порог участников есть всегда
                    self.assertIsNone(lb["prizes"])
                    self.assertEqual(lb["min_participants"], 10)
                    self.assertTrue(lb["month_ends_at"].endswith("T21:00:00+00:00"))
                    self.assertEqual((await c.get("/api/v1/tower/leaderboard", params={"month": "xx"})).status_code, 400)
                    self.assertEqual((await c.get("/api/v1/tower/leaderboard", params={"limit": 0})).status_code, 422)

                    # чужой игрок не видит мою игру
                    who["id"] = other_id
                    r = await c.post("/api/v1/tower/finish", json={"game_id": g["game_id"], "taps": [], "score": 0})
                    self.assertEqual(r.status_code, 404)
            finally:
                app.dependency_overrides.clear()
                await engine.dispose()

        asyncio.run(main())


PG_URL = os.environ.get("TEST_PG_URL")


@unittest.skipUnless(PG_URL, "нужен TEST_PG_URL (локальная пустая тестовая база Postgres: таблицы пересоздаются)")
class PostgresConcurrencyTest(unittest.TestCase):
    """Параллельные запросы на настоящем Postgres: лимит попыток и один финиш не обходятся гонкой."""

    def _run(self, fn):
        async def main():
            engine = create_async_engine(PG_URL)
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.drop_all)
                await conn.run_sync(Base.metadata.create_all)
            maker = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
            try:
                await fn(maker)
            finally:
                await engine.dispose()

        asyncio.run(main())

    def test_parallel_starts_never_exceed_three(self):
        async def body(maker):
            async with maker() as s:
                u = await make_user(s, 1)
                await s.commit()
                uid = u.id

            async def one():
                async with maker() as s:
                    user = await s.get(User, uid)
                    try:
                        await tw.start_game(s, user=user, now=NOON)
                        await s.commit()
                        return True
                    except tw.NoAttemptsError:
                        await s.rollback()
                        return False

            got = await asyncio.gather(*[one() for _ in range(8)])
            self.assertEqual(sum(got), 3)
            async with maker() as s:
                self.assertEqual(await tw.used_today(s, uid, NOON), 3)
                self.assertEqual(len((await s.scalars(select(TowerGame))).all()), 3)

        self._run(body)

    def test_parallel_finish_counts_once(self):
        async def body(maker):
            async with maker() as s:
                u = await make_user(s, 1)
                g = await tw.start_game(s, user=u, now=NOON)
                await s.commit()
                uid, gid, seed = u.id, g.id, g.seed
            taps, res = play_taps(seed, None, (0, 0, 0, 60, 0))
            at = NOON + timedelta(milliseconds=taps[-1] + 500)

            async def one():
                async with maker() as s:
                    user = await s.get(User, uid)
                    try:
                        await tw.finish_game(s, user=user, game_id=gid, taps=taps, claimed_score=res.score, now=at)
                        await s.commit()
                        return "ok"
                    except tw.TowerError as e:
                        await s.rollback()
                        return e.code

            got = await asyncio.gather(*[one() for _ in range(5)])
            self.assertEqual(sorted(got), ["already_finished"] * 4 + ["ok"])
            async with maker() as s:
                rows = (await s.scalars(select(TowerMonthlyBest))).all()
                self.assertEqual([(r.user_id, r.best_score) for r in rows], [(uid, res.score)])

        self._run(body)


if __name__ == "__main__":
    unittest.main()

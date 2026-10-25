"""Ежедневная отметка и колесо: игровой день по Москве (00:00 МСК), переход с UTC-суток, серия.

Запуск из папки backend: python -m unittest discover -s tests
"""

import asyncio
import unittest
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest import mock

from app.services import daily, gameday

UTC = timezone.utc
MSK = timezone(timedelta(hours=3))


def _session(*scalars):
    return SimpleNamespace(
        scalar=mock.AsyncMock(side_effect=list(scalars)),
        add=mock.Mock(),
        flush=mock.AsyncMock(),
    )


def _row(day, streak, created=None, ton="0.01"):
    return SimpleNamespace(check_date=day, streak=streak, created_at=created, reward_ton=Decimal(ton))


def _user():
    return SimpleNamespace(id=1, xp=0, level=1, focus_tokens=0)


CFG = {"day_1": {"ton": "0.01", "xp": 0}, "day_2": {"ton": "0.02", "xp": 0}}


def _claim(prev, now):
    s = _session(prev)
    with mock.patch.object(daily, "get_setting", mock.AsyncMock(return_value=CFG)), \
         mock.patch.object(daily.balance_svc, "credit", mock.AsyncMock()) as credit:
        r = asyncio.run(daily.claim_daily(s, user=_user(), now=now))
    return r, s, credit


class GameDayTest(unittest.TestCase):
    def test_day_is_moscow_date(self):
        # 21:00 UTC — это уже 00:00 следующего дня по Москве
        self.assertEqual(gameday.game_day(datetime(2026, 10, 25, 20, 59, 59, tzinfo=UTC)), date(2026, 10, 25))
        self.assertEqual(gameday.game_day(datetime(2026, 10, 25, 21, 0, tzinfo=UTC)), date(2026, 10, 26))

    def test_boundary_2359_0000_msk(self):
        before = datetime(2026, 10, 25, 23, 59, 59, tzinfo=MSK)
        after = datetime(2026, 10, 26, 0, 0, 0, tzinfo=MSK)
        self.assertEqual(gameday.game_day(before), date(2026, 10, 25))
        self.assertEqual(gameday.game_day(after), date(2026, 10, 26))
        self.assertEqual(gameday.next_reset(before), after)
        self.assertEqual(gameday.next_reset(after), datetime(2026, 10, 27, tzinfo=MSK))

    def test_next_reset_is_msk_midnight_in_utc(self):
        now = datetime(2026, 10, 25, 9, 30, tzinfo=UTC)
        nr = gameday.next_reset(now)
        self.assertEqual(nr, datetime(2026, 10, 25, 21, 0, tzinfo=UTC))
        self.assertEqual(nr.isoformat(), "2026-10-25T21:00:00+00:00")

    def test_naive_is_utc(self):
        self.assertEqual(gameday.game_day(datetime(2026, 10, 25, 22, 0)), date(2026, 10, 26))

    def test_month_end(self):
        self.assertEqual(gameday.reset_after(date(2026, 10, 31)), datetime(2026, 10, 31, 21, 0, tzinfo=UTC))

    def test_day_start(self):
        self.assertEqual(gameday.day_start_of(datetime(2026, 10, 25, 22, 0, tzinfo=UTC)),
                         datetime(2026, 10, 25, 21, 0, tzinfo=UTC))


class StatusTest(unittest.TestCase):
    now = datetime(2026, 10, 25, 9, 30, tzinfo=UTC)  # 12:30 МСК 25-го

    def test_not_claimed_can_claim_now(self):
        prev = _row(date(2026, 10, 24), 4, datetime(2026, 10, 24, 8, 0, tzinfo=UTC))
        s = asyncio.run(daily.daily_status(_session(prev), user_id=1, now=self.now))
        self.assertFalse(s["claimed_today"])
        self.assertIsNone(s["next_claim_at"])
        self.assertEqual(s["streak"], 4)
        self.assertEqual(s["server_time"], self.now.isoformat())

    def test_claimed_returns_next_msk_midnight(self):
        today = _row(date(2026, 10, 25), 5, datetime(2026, 10, 25, 7, 0, tzinfo=UTC))
        s = asyncio.run(daily.daily_status(_session(today), user_id=1, now=self.now))
        self.assertTrue(s["claimed_today"])
        self.assertEqual(s["next_claim_at"], "2026-10-25T21:00:00+00:00")
        self.assertEqual(s["streak"], 5)

    def test_gap_resets_streak_display(self):
        prev = _row(date(2026, 10, 22), 9, datetime(2026, 10, 22, 8, 0, tzinfo=UTC))
        s = asyncio.run(daily.daily_status(_session(prev), user_id=1, now=self.now))
        self.assertEqual(s["streak"], 0)


class TransitionTest(unittest.TestCase):
    """Переход с UTC-суток: check_date старых отметок записан по UTC."""

    # отметка в 22:30 UTC 25-го = 01:30 МСК 26-го, записана старым кодом как 25-е (UTC)
    late_old = _row(date(2026, 10, 25), 3, datetime(2026, 10, 25, 22, 30, tzinfo=UTC))

    def test_no_double_claim_same_msk_day(self):
        # выкатка в 23:00 UTC; в 23:30 UTC (02:30 МСК 26-го) повторная попытка — это тот же московский день
        now = datetime(2026, 10, 25, 23, 30, tzinfo=UTC)
        r, s, credit = _claim(self.late_old, now)
        self.assertTrue(r.already_claimed)
        credit.assert_not_awaited()
        s.add.assert_not_called()
        st = asyncio.run(daily.daily_status(_session(self.late_old), user_id=1, now=now))
        self.assertTrue(st["claimed_today"])
        self.assertEqual(st["next_claim_at"], "2026-10-26T21:00:00+00:00")

    def test_streak_continues_next_msk_day(self):
        # следующий московский день (27-е): серия продолжается, а не рвётся из-за UTC-даты 25-го
        now = datetime(2026, 10, 27, 9, 0, tzinfo=MSK)
        r, s, credit = _claim(self.late_old, now)
        self.assertFalse(r.already_claimed)
        self.assertEqual(r.streak, 4)
        self.assertEqual(r.check_date, date(2026, 10, 27))

    def test_daytime_old_claim_unchanged(self):
        # отметка днём (10:00 UTC 25-го = 13:00 МСК 25-го): даты совпадают, 26-го по Москве можно отметиться
        old = _row(date(2026, 10, 25), 2, datetime(2026, 10, 25, 10, 0, tzinfo=UTC))
        r, *_ = _claim(old, datetime(2026, 10, 26, 0, 5, tzinfo=MSK))
        self.assertFalse(r.already_claimed)
        self.assertEqual(r.streak, 3)

    def test_old_row_without_created_at(self):
        old = _row(date(2026, 10, 25), 2, None)
        r, *_ = _claim(old, datetime(2026, 10, 26, 12, 0, tzinfo=MSK))
        self.assertEqual(r.streak, 3)


class ClaimTest(unittest.TestCase):
    def test_first_claim(self):
        r, s, credit = _claim(None, datetime(2026, 10, 25, 12, 0, tzinfo=MSK))
        self.assertFalse(r.already_claimed)
        self.assertEqual(r.streak, 1)
        credit.assert_awaited_once()
        s.add.assert_called_once()

    def test_boundary_2359_then_0000(self):
        # отметка в 23:59 МСК 25-го, следующая — в 00:00 МСК 26-го: можно, серия +1
        t1 = datetime(2026, 10, 25, 23, 59, tzinfo=MSK)
        r1, *_ = _claim(None, t1)
        self.assertEqual(r1.check_date, date(2026, 10, 25))
        row = _row(r1.check_date, r1.streak, t1.astimezone(UTC))
        r_same, *_ = _claim(row, datetime(2026, 10, 25, 23, 59, 59, tzinfo=MSK))
        self.assertTrue(r_same.already_claimed)
        r2, *_ = _claim(row, datetime(2026, 10, 26, 0, 0, tzinfo=MSK))
        self.assertFalse(r2.already_claimed)
        self.assertEqual(r2.streak, 2)

    def test_missed_day_resets(self):
        row = _row(date(2026, 10, 23), 6, datetime(2026, 10, 23, 9, 0, tzinfo=UTC))
        r, *_ = _claim(row, datetime(2026, 10, 25, 9, 0, tzinfo=MSK))
        self.assertEqual(r.streak, 1)


class ClaimEndpointTest(unittest.TestCase):
    def _claim(self, already):
        from app.api import engagement
        r = daily.DailyResult(already, 5, Decimal("0.01"), 10, 0, date(2026, 10, 25))
        db = SimpleNamespace(commit=mock.AsyncMock())
        with mock.patch.object(daily, "claim_daily", mock.AsyncMock(return_value=r)):
            return asyncio.run(engagement.daily_claim(user=SimpleNamespace(id=1), db=db))

    def test_new_claim_has_next_time(self):
        self.assertEqual(self._claim(False).next_claim_at, "2026-10-25T21:00:00+00:00")

    def test_repeat_claim_has_same_next_time(self):
        out = self._claim(True)
        self.assertTrue(out.already_claimed)
        self.assertEqual(out.next_claim_at, "2026-10-25T21:00:00+00:00")


class WheelResetTest(unittest.TestCase):
    def test_wheel_next_reset_and_window(self):
        from app.services import prize_wheel
        now = datetime(2026, 10, 25, 22, 0, tzinfo=UTC)  # 01:00 МСК 26-го
        captured = {}

        async def fake_scalar(q):
            captured["sql"] = str(q.compile(compile_kwargs={"literal_binds": True}))
            return 0

        with mock.patch.object(gameday, "now_utc", return_value=now), \
             mock.patch.object(prize_wheel, "get_setting", mock.AsyncMock(return_value={"free_spins_per_day": 1})):
            st = asyncio.run(prize_wheel.wheel_status(SimpleNamespace(scalar=fake_scalar), user_id=1))
        self.assertEqual(st["next_reset_at"], "2026-10-26T21:00:00+00:00")
        self.assertEqual(st["left_today"], 1)
        # окно вращений — с 00:00 МСК 26-го (21:00 UTC 25-го): вращение в 21:30 UTC уже сегодняшнее
        self.assertIn("2026-10-25 21:00:00", captured["sql"])


if __name__ == "__main__":
    unittest.main()

"""Ежедневная отметка: правило «календарный день UTC» и время следующей отметки в ответах API.

Запуск из папки backend: python -m unittest discover -s tests
"""

import asyncio
import unittest
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from app.services import daily

UTC = timezone.utc
MSK = timezone(timedelta(hours=3))


def _session(*scalars):
    return SimpleNamespace(scalar=mock.AsyncMock(side_effect=list(scalars)))


class ResetRuleTest(unittest.TestCase):
    def test_next_reset_is_next_utc_midnight(self):
        now = datetime(2026, 10, 25, 9, 30, tzinfo=UTC)
        self.assertEqual(daily.next_reset_utc(now), datetime(2026, 10, 26, tzinfo=UTC))

    def test_just_before_midnight(self):
        now = datetime(2026, 10, 25, 23, 59, 59, tzinfo=UTC)
        self.assertEqual(daily.next_reset_utc(now), datetime(2026, 10, 26, tzinfo=UTC))

    def test_other_timezone_uses_utc_day(self):
        # 01:00 по Москве 26-го — это ещё 25-е по UTC: сброс в полночь UTC 26-го (03:00 МСК)
        now = datetime(2026, 10, 26, 1, 0, tzinfo=MSK)
        self.assertEqual(daily.next_reset_utc(now), datetime(2026, 10, 26, tzinfo=UTC))

    def test_reset_after_month_end(self):
        self.assertEqual(daily.reset_after(date(2026, 10, 31)), datetime(2026, 11, 1, tzinfo=UTC))


class StatusTest(unittest.TestCase):
    now = datetime(2026, 10, 25, 9, 30, tzinfo=UTC)

    def test_not_claimed_can_claim_now(self):
        prev = SimpleNamespace(check_date=date(2026, 10, 24), streak=4)
        s = asyncio.run(daily.daily_status(_session(None, prev), user_id=1, now=self.now))
        self.assertFalse(s["claimed_today"])
        self.assertIsNone(s["next_claim_at"])
        self.assertEqual(s["streak"], 4)
        self.assertEqual(s["server_time"], self.now.isoformat())

    def test_claimed_returns_next_midnight(self):
        today = SimpleNamespace(check_date=date(2026, 10, 25), streak=5)
        s = asyncio.run(daily.daily_status(_session(today, today), user_id=1, now=self.now))
        self.assertTrue(s["claimed_today"])
        self.assertEqual(s["next_claim_at"], "2026-10-26T00:00:00+00:00")
        # то же правило, что в claim_daily: отметка за сегодня блокирует до начала следующего дня UTC
        self.assertEqual(s["next_claim_at"], daily.reset_after(daily._today_utc(self.now)).isoformat())

    def test_status_matches_claim_rule(self):
        # claim_daily ищет отметку с check_date == _today_utc(); статус — тот же день
        self.assertEqual(daily._today_utc(self.now), date(2026, 10, 25))


class ClaimEndpointTest(unittest.TestCase):
    def _claim(self, already):
        from decimal import Decimal
        from app.api import engagement
        r = daily.DailyResult(already, 5, Decimal("0.01"), 10, 0, date(2026, 10, 25))
        db = SimpleNamespace(commit=mock.AsyncMock())
        with mock.patch.object(daily, "claim_daily", mock.AsyncMock(return_value=r)):
            return asyncio.run(engagement.daily_claim(user=SimpleNamespace(id=1), db=db))

    def test_new_claim_has_next_time(self):
        out = self._claim(False)
        self.assertEqual(out.next_claim_at, "2026-10-26T00:00:00+00:00")

    def test_repeat_claim_has_same_next_time(self):
        out = self._claim(True)
        self.assertTrue(out.already_claimed)
        self.assertEqual(out.next_claim_at, "2026-10-26T00:00:00+00:00")


if __name__ == "__main__":
    unittest.main()

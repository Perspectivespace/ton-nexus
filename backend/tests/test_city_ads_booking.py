"""Реклама в городе (PR 2): бронь с оплатой, двойная бронь, модерация, возвраты, смена ссылки, истечение срока.

Деньги сверяются до нанотона: баланс (TON, 8 знаков) и суммы объявления (нанотоны) — точное равенство.
"""

from __future__ import annotations

import asyncio
import unittest
import warnings
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import city_ads as ads_api
from app.db.base import Base
from app.models import CityAd, CityAdDay, CityAdEvent, CityAdSpot, User  # noqa: F401
from app.models.balance import BalanceHistory
from app.services import balance_history as bh
from app.services import city_ads as ads
from app.services.economy_admin import set_setting
from app.services.economy_seed import seed_economy

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
NANO = 10**9
TODAY = ads.game_day()
D = lambda n: TODAY + timedelta(days=n)  # noqa: E731


def _run(fn):
    async def wrap():
        engine = create_async_engine("sqlite+aiosqlite:///:memory:")
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
        Session = async_sessionmaker(engine, expire_on_commit=False)
        try:
            async with Session() as s:
                await seed_economy(s)
                await ads.ensure_spots(s)
                await s.commit()
                await fn(s)
        finally:
            await engine.dispose()

    asyncio.run(wrap())


_tg = [9000]


async def _user(s, level=3, balance="10", **kw):
    _tg[0] += 1
    u = User(telegram_id=_tg[0], level=level, balance=Decimal(balance), **kw)
    s.add(u)
    await s.commit()
    return u


async def _rb(s):
    """rollback, как в API при ошибке; объекты теста перечитываются (после rollback они «протухают»)."""
    await s.rollback()
    for o in list(s.identity_map.values()):
        await s.refresh(o)


def _c(title="NEXUS BAR", color="magenta", **kw):
    return ads.AdContent(title=title, color=color, **kw)


async def _bal(s, u) -> Decimal:
    await s.refresh(u)
    return Decimal(u.balance)


async def _book(s, u, spot="banner_sky", start=1, days=3, **kw):
    ad = await ads.book(s, user=u, spot_key=spot, start=D(start), days=days, content=_c(**kw), today=TODAY)
    await s.commit()
    return ad


async def _days(s, ad_id) -> int:
    return int(await s.scalar(select(func.count()).select_from(CityAdDay).where(CityAdDay.ad_id == ad_id)))


def _inv(t, ad):
    """Инвариант денег объявления: возврат + доход + удержание = оплачено."""
    t.assertEqual(ad.refunded_nano + ad.revenue_nano + ads.held_nano(ad), ad.paid_nano)
    t.assertGreaterEqual(ads.held_nano(ad), 0)


class Booking(unittest.TestCase):
    def test_book_debits_exactly(self):
        async def body(s):
            u = await _user(s)
            ad = await _book(s, u, "banner_sky", 1, 3)  # 0.5 × 3
            self.assertEqual((ad.status, ad.paid_nano, ad.total_nano, ad.price_day_nano), ("pending", 1_500_000_000, 1_500_000_000, 500_000_000))
            self.assertEqual((ad.revenue_nano, ad.refunded_nano), (0, 0))
            self.assertEqual(await _bal(s, u), Decimal("8.5"))
            self.assertEqual(await _days(s, ad.id), 3)
            ad2 = await _book(s, u, "neon_right", 2, 7)  # 0.3 × 7
            self.assertEqual(ad2.paid_nano, 2_100_000_000)
            self.assertEqual(await _bal(s, u), Decimal("6.4"))
            h = (await s.execute(select(BalanceHistory).where(BalanceHistory.user_id == u.id).order_by(BalanceHistory.id))).scalars().all()
            self.assertEqual([(x.operation_type, x.balance_type, x.amount) for x in h],
                             [("debit", "city_ads", Decimal("1.5")), ("debit", "city_ads", Decimal("2.1"))])
            self.assertEqual((h[0].reference_type, h[0].reference_id), ("city_ad", ad.id))
            self.assertIn("Голо-баннер", h[0].description)
            self.assertEqual(bh.LABELS[bh.kind_of("debit", "city_ads")], "Реклама в городе")
            self.assertEqual(bh.LABELS[bh.kind_of("credit", "city_ads_refund")], "Возврат за рекламу в городе")
            _inv(self, ad)

        _run(body)

    def test_odd_price_exact_to_nanoton(self):
        async def body(s):
            await set_setting(s, key="city_ads", value={"spots": {"neon_left": {"price_day": "0.33333333"}}})
            await s.commit()
            u = await _user(s, balance="20")
            ad = await _book(s, u, "neon_left", 1, 30, title="КОФЕ 24/7", color="mint")
            self.assertEqual(ad.paid_nano, 333_333_330 * 30)
            self.assertEqual(await _bal(s, u), Decimal("20") - Decimal("9.9999999"))
            # снять на 11-е сутки после одобрения: возврат ровно за 20 непоказанных суток
            owner = await _user(s, is_owner=True)
            await ads.approve(s, owner=owner, ad_id=ad.id, today=TODAY)
            await ads.reject(s, owner=owner, ad_id=ad.id, today=D(11))
            await s.commit()
            self.assertEqual(ad.refunded_nano, 333_333_330 * 20)
            self.assertEqual(ad.revenue_nano, 333_333_330 * 10)
            self.assertEqual(await _bal(s, u), Decimal("20") - Decimal("3.3333333"))
            _inv(self, ad)

        _run(body)

    def test_server_recomputes_price(self):
        async def body(s):
            u = await _user(s)
            await set_setting(s, key="city_ads", value={"spots": {"tower_line": {"price_day": "1.25"}}})
            await s.commit()
            ad = await _book(s, u, "tower_line", 1, 2, title="NEXUS BAR · коктейли до утра", color="amber")
            self.assertEqual((ad.price_day_nano, ad.paid_nano), (1_250_000_000, 2_500_000_000))
            # снимок цены: смена тарифа после брони не трогает объявление
            await set_setting(s, key="city_ads", value={"spots": {"tower_line": {"price_day": "3"}}})
            await s.commit()
            await s.refresh(ad)
            self.assertEqual(ad.paid_nano, 2_500_000_000)

        _run(body)

    def test_double_booking_refused(self):
        async def body(s):
            a, b = await _user(s), await _user(s)
            await _book(s, a, "banner_street", 3, 5)  # D3..D7
            with self.assertRaises(ads.CityAdBusyError):
                await ads.book(s, user=b, spot_key="banner_street", start=D(7), days=2, content=_c(), today=TODAY)
            await _rb(s)
            self.assertEqual(await _bal(s, b), Decimal("10"))
            self.assertEqual(await s.scalar(select(func.count()).select_from(CityAd)), 1)
            # соседние сутки и другое место — можно
            await _book(s, b, "banner_street", 8, 1)
            await _book(s, b, "banner_sky", 3, 5)
            self.assertEqual(await _bal(s, b), Decimal("10") - Decimal("0.5") * 6)

        _run(body)

    def test_race_hits_unique_and_charges_nothing(self):
        async def body(s):
            a, b = await _user(s), await _user(s)
            ad = await _book(s, a, "neon_left", 4, 1)
            # гонка: занятые сутки «не видны» расчёту (статус уже не держит), но строка ещё стоит → UNIQUE(spot, day)
            ad.status = "rejected"
            await s.commit()
            with self.assertRaises(ads.CityAdBusyError):
                await ads.book(s, user=b, spot_key="neon_left", start=D(3), days=3, content=_c(), today=TODAY)
            await _rb(s)
            self.assertEqual(await _bal(s, b), Decimal("10"))
            self.assertEqual(await s.scalar(select(func.count()).select_from(CityAd).where(CityAd.advertiser_id == b.id)), 0)
            self.assertEqual(await s.scalar(select(func.count()).select_from(CityAdDay)), 1)
            self.assertEqual(await s.scalar(select(func.count()).select_from(BalanceHistory).where(BalanceHistory.user_id == b.id)), 0)

        _run(body)

    def test_insufficient_funds(self):
        async def body(s):
            u = await _user(s, balance="1.49")
            with self.assertRaises(ads.CityAdFundsError):
                await ads.book(s, user=u, spot_key="banner_sky", start=D(1), days=3, content=_c(), today=TODAY)
            await _rb(s)
            self.assertEqual(await s.scalar(select(func.count()).select_from(CityAdDay)), 0)
            self.assertEqual(await _bal(s, u), Decimal("1.49"))
            u2 = await _user(s, balance="1.5")  # ровно хватает
            await _book(s, u2, "banner_sky", 1, 3)
            self.assertEqual(await _bal(s, u2), Decimal("0"))

        _run(body)

    def test_level_gate(self):
        async def body(s):
            first = await _user(s, level=1)
            await _book(s, first, "tower_line", 1, 1)  # по умолчанию — любой уровень
            await set_setting(s, key="city_ads", value={"min_level": 3})
            await s.commit()
            low = await _user(s, level=2)
            with self.assertRaises(ads.CityAdPermissionError):
                await ads.book(s, user=low, spot_key="neon_left", start=D(1), days=1, content=_c(), today=TODAY)
            await _rb(s)
            await set_setting(s, key="city_ads", value={"min_level": 2})
            await s.commit()
            await _book(s, low, "neon_left", 1, 1)
            await set_setting(s, key="city_ads", value={"min_level": 5})
            await s.commit()
            mid = await _user(s, level=4)
            with self.assertRaises(ads.CityAdPermissionError):
                await ads.book(s, user=mid, spot_key="neon_right", start=D(1), days=1, content=_c(), today=TODAY)

        _run(body)

    def test_content_and_link_rules(self):
        async def body(s):
            u = await _user(s)
            bad = [
                dict(link_url="http://example.com"),
                dict(link_url="https://bit.ly/abc"),
                dict(link_url="https://user:pw@example.com/"),
                dict(link_url="https://example.com:8443/"),
                dict(link_url="javascript:alert(1)"),
                dict(link_url="https://t.me/"),
                dict(title=""),
                dict(color="red"),
                dict(title="X" * 13),  # неон — 12 символов
                dict(subtitle="подпись"),  # подпись — только у баннера
            ]
            for kw in bad:
                with self.subTest(kw=kw), self.assertRaises(ads.CityAdError):
                    await ads.book(s, user=u, spot_key="neon_left", start=D(1), days=1, content=_c(**kw), today=TODAY)
                await _rb(s)
            ad = await _book(s, u, "neon_left", 1, 1, link_url="t.me/nexusbar_city")
            self.assertEqual(ad.link_url, "https://t.me/nexusbar_city")
            ad = await _book(s, u, "banner_sky", 1, 1, title="КУПИ СТИКЕРЫ", subtitle="пак «Ночной контур»"[:18],
                             link_url="https://example.com/stickers", color="cyan", body="Подробности\nв канале")
            self.assertEqual((ad.link_url, ad.subtitle), ("https://example.com/stickers", "пак «Ночной контур"))
            with self.assertRaises(ads.CityAdError):  # начать сегодня нельзя
                await ads.book(s, user=u, spot_key="neon_right", start=TODAY, days=1, content=_c(), today=TODAY)

        _run(body)


class Moderation(unittest.TestCase):
    def test_cancel_before_moderation_full_refund(self):
        async def body(s):
            u, other = await _user(s), await _user(s)
            ad = await _book(s, u, "tower_line", 2, 4, title="NEXUS", color="amber")
            self.assertEqual(await _bal(s, u), Decimal("6"))
            with self.assertRaises(ads.CityAdNotFoundError):
                await ads.cancel(s, user=other, ad_id=ad.id)
            await _rb(s)
            await ads.cancel(s, user=u, ad_id=ad.id)
            await s.commit()
            self.assertEqual((ad.status, ad.refunded_nano, ad.revenue_nano), ("cancelled", 4 * NANO, 0))
            self.assertEqual(await _bal(s, u), Decimal("10"))
            self.assertEqual(await _days(s, ad.id), 0)
            _inv(self, ad)
            await _book(s, other, "tower_line", 2, 4, title="SKY", color="cyan")  # сутки свободны
            with self.assertRaises(ads.CityAdError):
                await ads.cancel(s, user=u, ad_id=ad.id)  # повторно — нельзя, денег второй раз нет

        _run(body)

    def test_cancel_after_moderation_refused(self):
        async def body(s):
            u, owner = await _user(s), await _user(s, is_owner=True)
            ad = await _book(s, u)
            await ads.approve(s, owner=owner, ad_id=ad.id, today=TODAY)
            await s.commit()
            with self.assertRaises(ads.CityAdError):
                await ads.cancel(s, user=u, ad_id=ad.id)

        _run(body)

    def test_approve_makes_revenue_and_board(self):
        async def body(s):
            u, owner = await _user(s), await _user(s, is_owner=True)
            ad = await _book(s, u, "banner_sky", 1, 3, title="КУПИ СТИКЕРЫ", color="cyan")
            board = await ads.board(s, today=D(1))
            self.assertIsNone(next(x for x in board["spots"] if x["key"] == "banner_sky")["ad"])  # на проверке — не видно
            self.assertEqual(await ads.revenue_total_nano(s), 0)
            await ads.approve(s, owner=owner, ad_id=ad.id, today=TODAY)
            await s.commit()
            self.assertEqual((ad.status, ad.revenue_nano, ads.held_nano(ad), ad.moderated_by_id), ("approved", 1_500_000_000, 0, owner.id))
            self.assertEqual(await ads.revenue_total_nano(s), 1_500_000_000)
            for day, shown in ((TODAY, False), (D(1), True), (D(3), True), (D(4), False)):
                b = await ads.board(s, today=day)
                got = next(x for x in b["spots"] if x["key"] == "banner_sky")["ad"]
                self.assertEqual(got is not None, shown, day)
            with self.assertRaises(ads.CityAdError):
                await ads.approve(s, owner=owner, ad_id=ad.id, today=TODAY)  # уже одобрено
            _inv(self, ad)

        _run(body)

    def test_reject_pending_full_refund(self):
        async def body(s):
            u, owner = await _user(s), await _user(s, is_owner=True)
            ad = await _book(s, u, "neon_right", 1, 10)
            self.assertEqual(await _bal(s, u), Decimal("7"))
            await ads.reject(s, owner=owner, ad_id=ad.id, note="ставки — запрещённая тема", today=D(2))  # даже после старта
            await s.commit()
            self.assertEqual((ad.status, ad.refunded_nano, ad.revenue_nano), ("rejected", 3 * NANO, 0))
            self.assertEqual(ad.moderation_note, "ставки — запрещённая тема")
            self.assertEqual(await _bal(s, u), Decimal("10"))
            self.assertEqual(await _days(s, ad.id), 0)
            h = await s.scalar(select(BalanceHistory).where(BalanceHistory.user_id == u.id, BalanceHistory.operation_type == "credit"))
            self.assertEqual((h.balance_type, h.amount, h.reference_id), ("city_ads_refund", Decimal("3"), ad.id))
            with self.assertRaises(ads.CityAdError):
                await ads.reject(s, owner=owner, ad_id=ad.id, today=D(2))  # второй возврат невозможен
            _inv(self, ad)

        _run(body)

    def test_link_edit_back_to_moderation(self):
        async def body(s):
            u, owner = await _user(s), await _user(s, is_owner=True)
            ad = await _book(s, u, "banner_street", 1, 5, link_url="https://example.com/a")
            await ads.approve(s, owner=owner, ad_id=ad.id, today=TODAY)
            await s.commit()
            # та же ссылка — ничего не меняется
            await ads.edit_link(s, user=u, ad_id=ad.id, link_url="https://example.com/a", today=D(2))
            self.assertEqual(ad.status, "approved")
            with self.assertRaises(ads.CityAdError):
                await ads.edit_link(s, user=u, ad_id=ad.id, link_url="https://bit.ly/x", today=D(2))
            await _rb(s)
            await ads.edit_link(s, user=u, ad_id=ad.id, link_url="t.me/new_channel", today=D(2))
            await s.commit()
            self.assertEqual((ad.status, ad.link_url), ("pending", "https://t.me/new_channel"))
            self.assertIsNotNone(ad.link_changed_at)
            b = await ads.board(s, today=D(2))
            self.assertIsNone(next(x for x in b["spots"] if x["key"] == "banner_street")["ad"])  # снова на проверке
            with self.assertRaises(ads.CityAdError):
                await ads.cancel(s, user=u, ad_id=ad.id)  # уже проверялось — отменить самому нельзя
            await _rb(s)
            await ads.approve(s, owner=owner, ad_id=ad.id, today=D(2))
            await s.commit()
            self.assertEqual(ad.revenue_nano, 2_500_000_000)  # доход не задвоился
            self.assertEqual(await ads.revenue_total_nano(s), 2_500_000_000)
            # новая ссылка снова на проверке → владелец отклоняет: возврат за непоказанные сутки D3..D5
            await ads.edit_link(s, user=u, ad_id=ad.id, link_url="https://example.com/b", today=D(3))
            await ads.reject(s, owner=owner, ad_id=ad.id, today=D(3))
            await s.commit()
            self.assertEqual((ad.refunded_nano, ad.revenue_nano), (1_500_000_000, 1_000_000_000))
            self.assertEqual(await _bal(s, u), Decimal("10") - Decimal("1"))
            _inv(self, ad)

        _run(body)

    def test_reject_running_ad_on_last_day_and_after(self):
        async def body(s):
            u, owner = await _user(s), await _user(s, is_owner=True)
            ad = await _book(s, u, "neon_left", 1, 2)
            await ads.approve(s, owner=owner, ad_id=ad.id, today=TODAY)
            await ads.reject(s, owner=owner, ad_id=ad.id, today=D(2))
            await s.commit()
            self.assertEqual((ad.refunded_nano, ad.revenue_nano), (300_000_000, 300_000_000))
            _inv(self, ad)

        _run(body)


class Expiry(unittest.TestCase):
    def test_expire_once(self):
        async def body(s):
            u, owner = await _user(s), await _user(s, is_owner=True)
            done = await _book(s, u, "banner_sky", 1, 2)  # D1..D2, одобрено
            late = await _book(s, u, "neon_left", 1, 3)  # D1..D3, так и не проверено
            live = await _book(s, u, "neon_right", 1, 5)  # D1..D5, одобрено, ещё идёт
            for a in (done, live):
                await ads.approve(s, owner=owner, ad_id=a.id, today=TODAY)
            await s.commit()
            self.assertEqual(await _bal(s, u), Decimal("10") - Decimal("1") - Decimal("0.9") - Decimal("1.5"))
            self.assertEqual(await ads.expire_once(s, today=D(3)), 1)  # только done
            await s.commit()
            self.assertEqual((done.status, late.status, live.status), ("expired", "pending", "approved"))
            self.assertEqual(await ads.expire_once(s, today=D(4)), 1)  # late
            await s.commit()
            self.assertEqual((late.status, late.refunded_nano, late.revenue_nano), ("expired", 900_000_000, 0))
            self.assertEqual(await _days(s, late.id), 0)
            self.assertEqual(await _days(s, done.id), 2)  # история показа остаётся
            self.assertEqual(await _bal(s, u), Decimal("10") - Decimal("1") - Decimal("1.5"))
            self.assertEqual(await ads.revenue_total_nano(s), 2_500_000_000)
            self.assertEqual(await ads.expire_once(s, today=D(4)), 0)  # повторный прогон ничего не делает
            self.assertEqual(await ads.expire_once(s, today=D(6)), 1)
            await s.commit()
            self.assertEqual(live.status, "expired")
            for a in (done, late, live):
                _inv(self, a)
            with self.assertRaises(ads.CityAdError):
                await ads.approve(s, owner=owner, ad_id=late.id, today=D(6))
            await _rb(s)
            with self.assertRaises(ads.CityAdError):
                await ads.edit_link(s, user=u, ad_id=live.id, link_url="https://example.com", today=D(6))

        _run(body)


class Api(unittest.TestCase):
    def test_endpoints(self):
        async def body(s):
            u, other = await _user(s), await _user(s)
            owner = await _user(s, is_owner=True)
            mk = lambda **kw: ads_api.BookBody(**{"spot": "banner_sky", "start": D(1), "days": 2, "title": "КУПИ СТИКЕРЫ",  # noqa: E731
                                                "subtitle": "пак стикеров", "color": "cyan", "link_url": "t.me/stickers", **kw})
            out = await ads_api.city_ads_book(mk(), user=u, db=s)
            self.assertEqual((out.status, out.paid, out.paid_nano, out.link_kind, out.moderated), ("pending", "1", NANO, "telegram", False))
            for kw, code in ((dict(), 409), (dict(start=D(5), link_url="https://bit.ly/x"), 400), (dict(start=D(5), days=21), 402)):
                with self.subTest(kw=kw), self.assertRaises(HTTPException) as cm:
                    await ads_api.city_ads_book(mk(**kw), user=other, db=s)
                self.assertEqual(cm.exception.status_code, code)
                await _rb(s)
            self.assertEqual(await _bal(s, other), Decimal("10"))
            low = await _user(s, level=1)
            await set_setting(s, key="city_ads", value={"min_level": 3})  # порог задаёт владелец
            await s.commit()
            with self.assertRaises(HTTPException) as cm:
                await ads_api.city_ads_book(mk(start=D(9)), user=low, db=s)
            self.assertEqual(cm.exception.status_code, 403)
            await _rb(s)
            # владелец — только владелец
            with self.assertRaises(HTTPException) as cm:
                await ads_api.city_ads_approve(out.id, user=u, db=s)
            self.assertEqual(cm.exception.status_code, 403)
            q = await ads_api.city_ads_moderation(status="pending", user=owner, db=s)
            self.assertEqual([i.id for i in q.items], [out.id])
            self.assertEqual(q.items[0].held_nano, NANO)
            a = await ads_api.city_ads_approve(out.id, user=owner, db=s)
            self.assertEqual((a.status, a.revenue_nano, a.held_nano), ("approved", NANO, 0))
            q = await ads_api.city_ads_moderation(status="approved", user=owner, db=s)
            self.assertEqual((q.revenue_total, q.revenue_total_nano), ("1", NANO))
            with self.assertRaises(HTTPException) as cm:
                await ads_api.city_ads_cancel(out.id, user=u, db=s)
            self.assertEqual(cm.exception.status_code, 400)
            await _rb(s)
            with self.assertRaises(HTTPException) as cm:
                await ads_api.city_ads_link(out.id, ads_api.LinkBody(link_url="https://x.example.com"), user=other, db=s)
            self.assertEqual(cm.exception.status_code, 404)
            await _rb(s)
            mine = await ads_api.city_ads_mine(user=u, db=s)
            self.assertEqual([(m.id, m.spot, m.status) for m in mine], [(out.id, "banner_sky", "approved")])
            r = await ads_api.city_ads_reject(out.id, ads_api.RejectBody(note="снято"), user=owner, db=s)
            self.assertEqual((r.status, r.refunded_nano, r.revenue_nano), ("rejected", NANO, 0))  # не начато — всё назад
            self.assertEqual(await _bal(s, u), Decimal("10"))

        _run(body)


if __name__ == "__main__":
    unittest.main()

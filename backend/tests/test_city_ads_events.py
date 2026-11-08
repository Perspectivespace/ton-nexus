"""Реклама в городе (PR 3): события «Прогулки» — показ, открытие карточки, переход; дедуп и потолок."""

from __future__ import annotations

import asyncio
import unittest
import warnings
from datetime import timedelta
from decimal import Decimal

from fastapi import HTTPException
from pydantic import ValidationError
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import city_ads as ads_api
from app.db.base import Base
from app.models import CityAd, CityAdDay, CityAdEvent, CityAdSpot, User  # noqa: F401
from app.services import city_ads as ads
from app.services.economy_seed import seed_economy

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
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


_tg = [12000]


async def _user(s, **kw):
    _tg[0] += 1
    u = User(telegram_id=_tg[0], level=3, balance=Decimal("10"), **kw)
    s.add(u)
    await s.commit()
    return u


async def _live_ad(s, spot="neon_left", start=0, days=3, status="approved"):
    """Объявление, которое показывается с D(start) (бронь — через сервис, затем одобрение)."""
    u = await _user(s)
    owner = await _user(s, is_owner=True)
    ad = await ads.book(s, user=u, spot_key=spot, start=D(start + 1), days=days,
                        content=ads.AdContent(title="NEXUS BAR", color="magenta"), today=D(start))
    if status == "approved":
        await ads.approve(s, owner=owner, ad_id=ad.id, today=D(start))
    await s.commit()
    return ad


class Events(unittest.TestCase):
    def test_dedup_per_user_ad_day_kind(self):
        async def body(s):
            ad = await _live_ad(s)
            a, b = await _user(s), await _user(s)
            day = D(1)
            self.assertTrue(await ads.record_event(s, user=a, ad_id=ad.id, kind="impression", today=day))
            self.assertFalse(await ads.record_event(s, user=a, ad_id=ad.id, kind="impression", today=day))
            self.assertTrue(await ads.record_event(s, user=a, ad_id=ad.id, kind="open", today=day))
            self.assertTrue(await ads.record_event(s, user=a, ad_id=ad.id, kind="click", today=day))
            self.assertTrue(await ads.record_event(s, user=b, ad_id=ad.id, kind="impression", today=day))
            self.assertTrue(await ads.record_event(s, user=a, ad_id=ad.id, kind="impression", today=D(2)))  # новые сутки
            await s.commit()
            self.assertEqual((await ads.event_counts(s, [ad.id]))[ad.id], {"impression": 3, "open": 1, "click": 1})

        _run(body)

    def test_only_live_approved_ads(self):
        async def body(s):
            pending = await _live_ad(s, spot="banner_sky", status="pending")
            ad = await _live_ad(s, spot="neon_right", days=2)  # D1..D2
            u = await _user(s)
            for ad_id, day in ((pending.id, D(1)), (ad.id, TODAY), (ad.id, D(3)), (999, D(1))):
                with self.subTest(ad_id=ad_id, day=day), self.assertRaises(ads.CityAdNotFoundError):
                    await ads.record_event(s, user=u, ad_id=ad_id, kind="open", today=day)
            with self.assertRaises(ads.CityAdError):
                await ads.record_event(s, user=u, ad_id=ad.id, kind="like", today=D(1))
            self.assertEqual(await s.scalar(select(func.count()).select_from(CityAdEvent)), 0)

        _run(body)

    def test_daily_cap(self):
        async def body(s):
            ad = await _live_ad(s)
            u = await _user(s)
            day = D(1)
            old = ads.EVENTS_PER_USER_DAY
            ads.EVENTS_PER_USER_DAY = 2
            try:
                self.assertTrue(await ads.record_event(s, user=u, ad_id=ad.id, kind="impression", today=day))
                self.assertTrue(await ads.record_event(s, user=u, ad_id=ad.id, kind="open", today=day))
                self.assertFalse(await ads.record_event(s, user=u, ad_id=ad.id, kind="click", today=day))  # потолок
                self.assertTrue(await ads.record_event(s, user=u, ad_id=ad.id, kind="click", today=D(2)))
            finally:
                ads.EVENTS_PER_USER_DAY = old

        _run(body)

    def test_api(self):
        async def body(s):
            ad = await _live_ad(s, start=-1)  # показывается с сегодня
            u = await _user(s)
            out = await ads_api.city_ads_event(ad.id, ads_api.EventBody(kind="open"), user=u, db=s)
            self.assertTrue(out.counted)
            out = await ads_api.city_ads_event(ad.id, ads_api.EventBody(kind="open"), user=u, db=s)
            self.assertFalse(out.counted)
            with self.assertRaises(HTTPException) as cm:
                await ads_api.city_ads_event(424242, ads_api.EventBody(kind="open"), user=u, db=s)
            self.assertEqual(cm.exception.status_code, 404)
            with self.assertRaises(ValidationError):
                ads_api.EventBody(kind="impression; drop")
            for o in list(s.identity_map.values()):  # после rollback в _tx объекты теста «протухли»
                await s.refresh(o)
            adv = await s.get(User, ad.advertiser_id)
            mine = await ads_api.city_ads_mine(user=adv, db=s)
            self.assertEqual(mine[0].stats, {"impression": 0, "open": 1, "click": 0})

        _run(body)


if __name__ == "__main__":
    unittest.main()

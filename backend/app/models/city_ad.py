"""Реклама в городе: места, объявления, занятые дни (одно объявление на место в сутки МСК), события для статистики.

Суммы — в нанотонах (1 TON = 10⁹). Оплата списывается с баланса при брони (paid_nano) и до одобрения
только удерживается; при одобрении становится доходом платформы (revenue_nano), возвраты — refunded_nano.
Всегда refunded_nano + revenue_nano ≤ paid_nano (остаток — удержание по объявлению на модерации).
"""

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    false,
    func,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base

AD_STATUSES = ("pending", "approved", "rejected", "cancelled", "expired")
AD_EVENT_KINDS = ("impression", "open", "click")
SPOT_FORMATS = ("line", "banner", "neon", "facade_screen")
DISTRICTS = ("centre", "rows", "port")  # Центр, «Неон-ряды», «Порт»


class CityAdSpot(Base):
    """Рекламное место в кадре города. Координаты живут во фронтенде, здесь — ключ, формат и район.

    enabled — технический выключатель места (например, место убрано из рисунка); продажу места владелец
    включает и выключает в настройке city_ads. Место продаётся, только если включено и там, и там.
    """

    __tablename__ = "city_ad_spots"
    __table_args__ = (
        CheckConstraint("format IN ('line', 'banner', 'neon', 'facade_screen')", name="ck_city_ad_spots_format"),
        CheckConstraint("district IN ('centre', 'rows', 'port')", name="ck_city_ad_spots_district"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    format: Mapped[str] = mapped_column(String(16), nullable=False)
    title: Mapped[str] = mapped_column(String(64), nullable=False)
    sort: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, server_default=true(), nullable=False)
    # район города: centre — главная страница (все места до районов), rows — «Неон-ряды», port — «Порт»
    district: Mapped[str] = mapped_column(String(16), default="centre", server_default="centre", nullable=False)


class CityAd(Base):
    __tablename__ = "city_ads"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected', 'cancelled', 'expired')", name="ck_city_ads_status"
        ),
        CheckConstraint("end_day >= start_day", name="ck_city_ads_days"),
        CheckConstraint(
            "paid_nano >= 0 AND refunded_nano >= 0 AND revenue_nano >= 0 AND refunded_nano + revenue_nano <= paid_nano",
            name="ck_city_ads_money",
        ),
        Index("ix_city_ads_status_start", "status", "start_day"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    advertiser_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    spot_id: Mapped[int] = mapped_column(ForeignKey("city_ad_spots.id", ondelete="RESTRICT"), index=True, nullable=False)
    format: Mapped[str] = mapped_column(String(16), nullable=False)  # снимок формата места
    # что видно в городе: строка/вывеска — title; баннер — title + subtitle
    title: Mapped[str] = mapped_column(String(64), nullable=False)
    subtitle: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # подробное объявление (карточка в «Прогулке»)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    link_url: Mapped[str | None] = mapped_column(String(512), nullable=True)
    color: Mapped[str] = mapped_column(String(16), nullable=False)  # ключ палитры города
    status: Mapped[str] = mapped_column(String(16), default="pending", server_default="pending", nullable=False)
    # сутки МСК, оба края включительно
    start_day: Mapped[date] = mapped_column(Date, nullable=False)
    end_day: Mapped[date] = mapped_column(Date, nullable=False)
    days: Mapped[int] = mapped_column(Integer, nullable=False)
    # снимок цены на момент брони и суммы в нанотонах
    price_day_nano: Mapped[int] = mapped_column(BigInteger, nullable=False)
    total_nano: Mapped[int] = mapped_column(BigInteger, nullable=False)
    paid_nano: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", nullable=False)
    refunded_nano: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", nullable=False)
    revenue_nano: Mapped[int] = mapped_column(BigInteger, default=0, server_default="0", nullable=False)  # доход платформы
    is_free: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false(), nullable=False)  # промо владельца
    # модерация
    moderated_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    moderated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    moderation_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    link_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    # картинка экрана на фасаде (city_ad_images.ad_id → это объявление); смена картинки — снова на проверку
    image_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    cancelled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class CityAdDay(Base):
    """Занятые сутки места: строка на каждый день брони. UNIQUE(spot, day) — двух объявлений на месте в один день нет."""

    __tablename__ = "city_ad_days"
    __table_args__ = (UniqueConstraint("spot_id", "day", name="uq_city_ad_days_spot_day"),)

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    spot_id: Mapped[int] = mapped_column(ForeignKey("city_ad_spots.id", ondelete="RESTRICT"), nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    ad_id: Mapped[int] = mapped_column(ForeignKey("city_ads.id", ondelete="CASCADE"), index=True, nullable=False)


class CityAdEvent(Base):
    """Статистика: показ / открытие карточки / переход. Одно событие вида на человека, объявление и сутки МСК."""

    __tablename__ = "city_ad_events"
    __table_args__ = (
        UniqueConstraint("ad_id", "user_id", "day", "kind", name="uq_city_ad_events_once"),
        CheckConstraint("kind IN ('impression', 'open', 'click')", name="ck_city_ad_events_kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    ad_id: Mapped[int] = mapped_column(ForeignKey("city_ads.id", ondelete="CASCADE"), index=True, nullable=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    day: Mapped[date] = mapped_column(Date, nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class CityAdImage(Base):
    """Картинка экрана на фасаде: уже пережатая сервером в WebP фиксированного размера (без метаданных).

    Хранится прямо в базе (bytea): ни папки на сервере, ни правок nginx. key — случайное имя в адресе картинки
    (по id перебрать нельзя). ad_id пуст, пока картинку загрузили, но ещё не приложили к объявлению (или её заменили):
    такие строки удаляет фоновый цикл через час. Игрокам картинка видна, только пока её объявление одобрено.
    """

    __tablename__ = "city_ad_images"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    key: Mapped[str] = mapped_column(String(32), unique=True, nullable=False)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False)
    ad_id: Mapped[int | None] = mapped_column(ForeignKey("city_ads.id", ondelete="CASCADE"), index=True, nullable=True)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    size: Mapped[int] = mapped_column(Integer, nullable=False)
    width: Mapped[int] = mapped_column(Integer, nullable=False)
    height: Mapped[int] = mapped_column(Integer, nullable=False)
    sha256: Mapped[str] = mapped_column(String(64), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

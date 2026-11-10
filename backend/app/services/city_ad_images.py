"""Картинка на экране фасада «Неон-рядов»: проверка, пережатие в WebP, лимиты, привязка к объявлению, доступ.

Загрузка — сырые байты PNG / JPEG / WebP до 5 МБ. Тип определяется по содержимому (сигнатура + разбор Pillow),
заявленный Content-Type должен с ним совпасть. Картинка всегда перекодируется: поворот по EXIF, кадр по центру
под пропорцию экрана, 640×520, WebP (качество 80). Новый файл собирается из пикселей, поэтому EXIF/GPS/XMP/ICC
и всё, что было «приклеено» к файлу (замаскированные архивы и скрипты), не переживают пережатия.

Хранение — в базе (city_ad_images.data): ни папки на сервере, ни правок nginx. Адрес — случайный key.
Игрокам картинка отдаётся, только пока её объявление одобрено и не закончилось; до этого — автору и владельцу.
Замена картинки у одобренного объявления отправляет его снова на проверку (как смена ссылки).
"""

from __future__ import annotations

import hashlib
import io
import secrets
import warnings
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.city_ad import CityAd, CityAdImage
from app.models.user import User
from app.services.gameday import game_day
from app.services.roles import is_platform_owner
from app.services.task_proofs import detect_mime

MAX_BYTES = 5 * 1024 * 1024  # до пережатия
OUT_W, OUT_H = 640, 520  # пропорция экрана на фасаде (~1,23 : 1), вдвое плотнее, чем он виден на телефоне
MIN_W, MIN_H = 320, 260  # меньше — на экране будет мыло
MAX_PIXELS = 40_000_000  # защита от «бомб» (картинки-гиганты при малом размере файла)
QUALITY = 80
UPLOADS_PER_HOUR = 10  # на человека
UNATTACHED_TTL = timedelta(hours=1)
FINAL_TTL = timedelta(days=30)  # картинки отклонённых / отменённых / закончившихся — ещё месяц для истории
FORMAT = "facade_screen"
PIL_FORMAT = {"image/png": "PNG", "image/jpeg": "JPEG", "image/webp": "WEBP"}
PLATE = (10, 7, 22)  # тёмный экран под прозрачными частями (#0A0716, как фон экрана)
FINAL_STATUSES = ("rejected", "cancelled", "expired")


class ImageError(ValueError):
    pass


class ImageTooLarge(ImageError):
    pass


class ImageRateLimited(ImageError):
    pass


class ImageUnavailable(RuntimeError):
    """На сервере нет Pillow — загрузка картинок выключена, остальная реклама работает (только текст)."""


class ImageForbidden(PermissionError):
    pass


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def available() -> bool:
    try:
        from PIL import features  # noqa: F401

        return bool(features.check("webp"))
    except Exception:
        return False


def public_path(key: str) -> str:
    return f"/api/v1/city-ads/images/{key}.webp"


def private_path(key: str) -> str:
    return f"/api/v1/city-ads/images/{key}/private"


def process(data: bytes, declared: str | None = None) -> tuple[bytes, int, int]:
    """Проверить и пережать: → (WebP OUT_W×OUT_H без метаданных, ширина, высота)."""
    if not data:
        raise ImageError("пустой файл")
    if len(data) > MAX_BYTES:
        raise ImageTooLarge("файл больше 5 МБ")
    mime = detect_mime(data)
    if mime is None:
        raise ImageError("нужна картинка PNG, JPG или WebP")
    if declared:
        d = declared.split(";")[0].strip().lower()
        if d == "image/jpg":
            d = "image/jpeg"
        if d not in (mime, "application/octet-stream", ""):
            raise ImageError("тип файла не совпадает с содержимым")
    try:
        from PIL import Image, ImageOps
    except Exception as e:  # pragma: no cover - зависит от установки
        raise ImageUnavailable("загрузка картинок пока недоступна") from e
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(data), formats=[PIL_FORMAT[mime]])
            w, h = img.size
            if w * h > MAX_PIXELS:
                raise ImageError("картинка слишком большая по пикселям")
            if w < MIN_W or h < MIN_H:
                raise ImageError(f"картинка слишком маленькая — нужно хотя бы {MIN_W}×{MIN_H}")
            img.seek(0)  # анимация — только первый кадр
            img.load()
    except ImageError:
        raise
    except (Image.DecompressionBombError, Image.DecompressionBombWarning) as e:
        raise ImageError("картинка слишком большая по пикселям") from e
    except Exception as e:
        raise ImageError("картинка повреждена или это не картинка") from e
    img = ImageOps.exif_transpose(img)
    if img.mode in ("RGBA", "LA", "PA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        base = Image.new("RGB", rgba.size, PLATE)
        base.paste(rgba, mask=rgba.getchannel("A"))
        img = base
    else:
        img = img.convert("RGB")
    out = ImageOps.fit(img, (OUT_W, OUT_H), Image.LANCZOS, centering=(0.5, 0.5))
    out.info = {}
    buf = io.BytesIO()
    out.save(buf, "WEBP", quality=QUALITY, method=4)
    return buf.getvalue(), OUT_W, OUT_H


async def store_upload(
    session: AsyncSession, *, user: User, data: bytes, declared: str | None, now: datetime | None = None
) -> CityAdImage:
    """Загрузка покупателя: уровень (как у покупки), не больше UPLOADS_PER_HOUR в час, пережатие, запись в базу.

    Лимит в час ограничивает и место в базе: картинка после пережатия — десятки КБ, неприложенные живут час."""
    from app.services import city_ads as ads_svc

    now = now or _now()
    cfg = await ads_svc.load_config(session)
    if int(user.level or 1) < cfg["min_level"]:
        raise ImageForbidden(f"Реклама в городе доступна с {cfg['min_level']}-го уровня")
    recent = await session.scalar(
        select(func.count(CityAdImage.id)).where(
            CityAdImage.owner_id == user.id, CityAdImage.created_at >= now - timedelta(hours=1)
        )
    )
    if int(recent or 0) >= UPLOADS_PER_HOUR:
        raise ImageRateLimited("слишком много загрузок — попробуйте через час")
    clean, w, h = process(data, declared)
    img = CityAdImage(
        key=secrets.token_hex(16),
        owner_id=user.id,
        data=clean,
        size=len(clean),
        width=w,
        height=h,
        sha256=hashlib.sha256(clean).hexdigest(),
        created_at=now,
    )
    session.add(img)
    await session.flush()
    return img


async def _own_fresh(session: AsyncSession, *, user: User, image_id: int, now: datetime) -> CityAdImage:
    img = await session.get(CityAdImage, image_id)
    if (
        img is None
        or img.owner_id != user.id
        or img.ad_id is not None
        or _aware(img.created_at) < now - UNATTACHED_TTL
    ):
        raise ImageError("картинка не найдена — загрузите её заново")
    return img


async def attach(session: AsyncSession, *, user: User, image_id: int, ad: CityAd, now: datetime | None = None) -> CityAdImage:
    """Приложить загруженную картинку к объявлению; прежняя картинка отвязывается (её удалит фоновый цикл)."""
    now = now or _now()
    if ad.format != FORMAT:
        raise ImageError("картинка — только для экрана на фасаде")
    img = await _own_fresh(session, user=user, image_id=image_id, now=now)
    await session.execute(update(CityAdImage).where(CityAdImage.ad_id == ad.id).values(ad_id=None))
    img.ad_id = ad.id
    await session.flush()
    return img


async def set_image(
    session: AsyncSession, *, user: User, ad_id: int, image_id: int | None, today: date | None = None
) -> CityAd:
    """Заменить или убрать картинку. Новая картинка у одобренного объявления — снова на проверку и до одобрения
    не видна; убрать картинку можно без проверки (остаётся одобренный текст)."""
    from app.services import city_ads as ads_svc

    today = today or game_day()
    ad = await ads_svc._lock_ad(session, ad_id)
    if ad.advertiser_id != user.id:
        raise ads_svc.CityAdNotFoundError("объявление не найдено")
    if ad.status not in ads_svc.BUSY_STATUSES or ad.end_day < today:
        raise ads_svc.CityAdError("Картинку можно менять только у действующего объявления")
    if ad.format != FORMAT:
        raise ads_svc.CityAdError("Картинка — только для экрана на фасаде")
    if image_id is None:
        await session.execute(update(CityAdImage).where(CityAdImage.ad_id == ad.id).values(ad_id=None))
        ad.image_changed_at = _now()
        await session.flush()
        return ad
    try:
        await attach(session, user=user, image_id=image_id, ad=ad)
    except ImageError as e:
        raise ads_svc.CityAdError(str(e)) from e
    ad.image_changed_at = _now()
    if ad.status == "approved":
        ad.status = "pending"
        ad.moderation_note = None
    await session.flush()
    return ad


async def keys_for(session: AsyncSession, ad_ids: list[int]) -> dict[int, str]:
    """Текущая картинка объявлений: ad_id → key."""
    if not ad_ids:
        return {}
    rows = await session.execute(
        select(CityAdImage.ad_id, CityAdImage.key, CityAdImage.id).where(CityAdImage.ad_id.in_(ad_ids))
        .order_by(CityAdImage.id)
    )
    return {ad_id: key for ad_id, key, _ in rows.all()}


async def read_public(session: AsyncSession, key: str, *, today: date | None = None) -> bytes | None:
    """Картинка для игроков: только у одобренного и ещё не закончившегося объявления."""
    today = today or game_day()
    row = await session.execute(
        select(CityAdImage.data)
        .join(CityAd, CityAd.id == CityAdImage.ad_id)
        .where(CityAdImage.key == key, CityAd.status == "approved", CityAd.end_day >= today)
    )
    return row.scalar_one_or_none()


async def read_private(session: AsyncSession, key: str, *, actor: User) -> bytes:
    """Картинка до одобрения — автору (превью) и владельцу (модерация)."""
    img = (await session.execute(select(CityAdImage).where(CityAdImage.key == key))).scalar_one_or_none()
    if img is None:
        raise ImageError("картинка не найдена")
    if img.owner_id != actor.id and not is_platform_owner(actor):
        raise ImageForbidden("нет доступа")
    return img.data


async def purge_once(session: AsyncSession, *, now: datetime | None = None) -> int:
    """Неприложенные дольше часа и картинки закрытых объявлений старше месяца — удалить."""
    now = now or _now()
    a = await session.execute(
        delete(CityAdImage).where(CityAdImage.ad_id.is_(None), CityAdImage.created_at < now - UNATTACHED_TTL)
    )
    old = select(CityAd.id).where(CityAd.status.in_(FINAL_STATUSES), CityAd.updated_at < now - FINAL_TTL)
    b = await session.execute(delete(CityAdImage).where(CityAdImage.ad_id.in_(old)))
    return int(a.rowcount or 0) + int(b.rowcount or 0)

"""Скриншоты-подтверждения заданий: проверка, очистка метаданных, хранение, доступ и очередь удаления.

Файлы лежат на диске вне web root (settings.proof_upload_dir или backend/var/proofs), имена — случайные,
отдаются только проверяющему через API с авторизацией. В БД (task_proofs) — только метаданные.

Сроки удаления (поле delete_after, его разбирает фоновый цикл в app.main каждые 10 минут):
- после проверки заявки (одобрена или отклонена) — через 23 ч, то есть не позже 24 ч с учётом шага цикла;
- загружен, но не приложен к заявке — через 1 ч;
- заявка так и не проверена — через 14 дней после загрузки (заявка остаётся, скриншот пропадает).
Удаление идемпотентно: файла может уже не быть, deleted_at ставится один раз, каждое удаление в логе.
"""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
import struct
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.task import Task, TaskProof, TaskSubmission
from app.models.user import User
from app.services.roles import can_manage_any_task

log = logging.getLogger(__name__)

MAX_BYTES = 5 * 1024 * 1024
MIME_EXT = {"image/png": "png", "image/jpeg": "jpg", "image/webp": "webp"}
AFTER_REVIEW = timedelta(hours=23)
UNATTACHED = timedelta(hours=1)
NEVER_REVIEWED = timedelta(days=14)
MAX_OPEN_UPLOADS = 5  # непривязанных загрузок на человека и задание


class ProofError(ValueError):
    pass


class ProofTooLarge(ProofError):
    pass


class ProofForbidden(PermissionError):
    pass


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _aware(dt: datetime | None) -> datetime | None:
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


# ── Хранилище ─────────────────────────────────────────────────────────────────

_DEFAULT_DIR = Path(__file__).resolve().parents[2] / "var" / "proofs"


def storage_dir() -> Path:
    candidates = []
    if settings.proof_upload_dir:
        candidates.append(Path(settings.proof_upload_dir))
    candidates += [_DEFAULT_DIR, Path.home() / ".local" / "state" / "ton-nexus" / "proofs"]
    for d in candidates:
        try:
            d.mkdir(parents=True, exist_ok=True, mode=0o700)
            if os.access(d, os.W_OK | os.X_OK):
                return d
        except OSError:
            continue
    raise ProofError("хранилище скриншотов недоступно")


def _path(filename: str) -> Path:
    # имя из БД: только hex + расширение, без путей
    if not filename or "/" in filename or "\\" in filename or filename.startswith("."):
        raise ProofError("bad filename")
    return storage_dir() / filename


# ── Проверка формата и удаление метаданных (EXIF/XMP/текст) без сторонних библиотек ──


def detect_mime(data: bytes) -> str | None:
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    return None


def _strip_png(data: bytes) -> bytes:
    out = [data[:8]]
    pos = 8
    seen_ihdr = seen_iend = False
    drop = {b"eXIf", b"tEXt", b"iTXt", b"zTXt", b"tIME"}
    while pos + 12 <= len(data):
        (length,) = struct.unpack(">I", data[pos : pos + 4])
        ctype = data[pos + 4 : pos + 8]
        end = pos + 12 + length
        if end > len(data):
            raise ProofError("PNG повреждён")
        if not seen_ihdr and ctype != b"IHDR":
            raise ProofError("PNG повреждён")
        seen_ihdr = True
        if ctype not in drop:
            out.append(data[pos:end])
        pos = end
        if ctype == b"IEND":
            seen_iend = True
            break
    if not seen_iend:
        raise ProofError("PNG повреждён")
    return b"".join(out)


def _strip_jpeg(data: bytes) -> bytes:
    out = [b"\xff\xd8"]
    pos = 2
    while pos + 4 <= len(data):
        if data[pos] != 0xFF:
            raise ProofError("JPEG повреждён")
        marker = data[pos + 1]
        if marker == 0xFF:  # заполнитель
            pos += 1
            continue
        if marker == 0xDA:  # начало сканирования — дальше данные изображения
            out.append(data[pos:])
            return b"".join(out)
        if 0xD0 <= marker <= 0xD9 or marker == 0x01:
            out.append(data[pos : pos + 2])
            pos += 2
            continue
        (length,) = struct.unpack(">H", data[pos + 2 : pos + 4])
        end = pos + 2 + length
        if length < 2 or end > len(data):
            raise ProofError("JPEG повреждён")
        # APP1..APP15 (EXIF, XMP, ICC и др.) и комментарии — выкидываем; APP0 (JFIF) оставляем
        if not (0xE1 <= marker <= 0xEF or marker == 0xFE):
            out.append(data[pos:end])
        pos = end
    raise ProofError("JPEG повреждён")


def _strip_webp(data: bytes) -> bytes:
    (riff_size,) = struct.unpack("<I", data[4:8])
    if riff_size + 8 > len(data) or riff_size < 4:
        raise ProofError("WebP повреждён")
    body = data[12 : 8 + riff_size]
    chunks = []
    pos = 0
    while pos + 8 <= len(body):
        ctype = body[pos : pos + 4]
        (size,) = struct.unpack("<I", body[pos + 4 : pos + 8])
        end = pos + 8 + size + (size & 1)
        if pos + 8 + size > len(body):
            raise ProofError("WebP повреждён")
        chunk = bytearray(body[pos:min(end, len(body))])
        if ctype == b"VP8X" and size >= 1:
            chunk[8] &= ~(0x08 | 0x04) & 0xFF  # флаги EXIF и XMP
        if ctype not in (b"EXIF", b"XMP "):
            chunks.append(bytes(chunk))
        pos = end
    if not chunks:
        raise ProofError("WebP повреждён")
    payload = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(payload)) + payload


def sanitize(data: bytes, declared: str | None = None) -> tuple[bytes, str]:
    """Проверить картинку (PNG/JPEG/WebP по сигнатуре, до 5 МБ) и убрать метаданные."""
    if not data:
        raise ProofError("пустой файл")
    if len(data) > MAX_BYTES:
        raise ProofTooLarge("файл больше 5 МБ")
    mime = detect_mime(data)
    if mime is None:
        raise ProofError("нужна картинка PNG, JPG или WebP")
    if declared and declared.split(";")[0].strip().lower() not in (mime, "application/octet-stream", ""):
        if not (declared.startswith("image/jpg") and mime == "image/jpeg"):
            raise ProofError("тип файла не совпадает с содержимым")
    clean = {"image/png": _strip_png, "image/jpeg": _strip_jpeg, "image/webp": _strip_webp}[mime](data)
    return clean, mime


# ── Загрузка, привязка, доступ ───────────────────────────────────────────────


async def store_upload(
    session: AsyncSession, *, user: User, task: Task, data: bytes, declared: str | None, now: datetime | None = None
) -> TaskProof:
    now = now or utcnow()
    if task.status != "active":
        raise ProofError("задание неактивно")
    if task.creator_id == user.id:
        raise ProofError("нельзя сдавать своё задание")
    open_cnt = await session.scalar(
        select(func.count(TaskProof.id)).where(
            TaskProof.task_id == task.id,
            TaskProof.user_id == user.id,
            TaskProof.submission_id.is_(None),
            TaskProof.deleted_at.is_(None),
        )
    )
    if int(open_cnt or 0) >= MAX_OPEN_UPLOADS:
        raise ProofError("слишком много загрузок — отправьте заявку или подождите час")
    clean, mime = sanitize(data, declared)
    name = f"{secrets.token_hex(16)}.{MIME_EXT[mime]}"
    path = _path(name)
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "wb") as f:
        f.write(clean)
    proof = TaskProof(
        task_id=task.id,
        user_id=user.id,
        filename=name,
        mime=mime,
        size=len(clean),
        sha256=hashlib.sha256(clean).hexdigest(),
        created_at=now,
        delete_after=now + UNATTACHED,
    )
    session.add(proof)
    try:
        await session.flush()
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return proof


async def attach(session: AsyncSession, *, proof_id: int, user: User, task_id: int, submission: TaskSubmission) -> TaskProof:
    proof = await session.get(TaskProof, proof_id)
    if (
        not proof
        or proof.user_id != user.id
        or proof.task_id != task_id
        or proof.submission_id is not None
        or proof.deleted_at is not None
    ):
        raise ProofError("скриншот не найден — загрузите заново")
    proof.submission_id = submission.id
    proof.delete_after = _aware(proof.created_at) + NEVER_REVIEWED
    await session.flush()
    return proof


async def schedule_after_review(session: AsyncSession, submission_id: int, now: datetime | None = None) -> None:
    """Заявка проверена → скриншот в очередь на удаление (не позже 24 ч)."""
    now = now or utcnow()
    await session.execute(
        update(TaskProof)
        .where(TaskProof.submission_id == submission_id, TaskProof.deleted_at.is_(None))
        .values(reviewed_at=now, delete_after=now + AFTER_REVIEW)
    )


async def for_submissions(session: AsyncSession, submission_ids: list[int]) -> dict[int, TaskProof]:
    if not submission_ids:
        return {}
    rows = (
        await session.execute(select(TaskProof).where(TaskProof.submission_id.in_(submission_ids)).order_by(TaskProof.id))
    ).scalars().all()
    return {p.submission_id: p for p in rows}


async def read_for_reviewer(session: AsyncSession, *, proof_id: int, actor: User) -> tuple[bytes, str]:
    """Файл отдаётся только проверяющему: админ/владелец или создатель задания. Не исполнителю, не всем."""
    proof = await session.get(TaskProof, proof_id)
    if not proof or proof.submission_id is None:
        raise ProofError("not found")
    task = await session.get(Task, proof.task_id)
    if not task or not (can_manage_any_task(actor) or task.creator_id == actor.id):
        raise ProofForbidden("нет доступа")
    if proof.deleted_at is not None:
        raise ProofError("скриншот уже удалён")
    try:
        return _path(proof.filename).read_bytes(), proof.mime
    except FileNotFoundError as e:
        raise ProofError("файл не найден") from e


# ── Очередь удаления ─────────────────────────────────────────────────────────


def _reason(p: TaskProof) -> str:
    if p.reviewed_at is not None:
        return "reviewed"
    if p.submission_id is None:
        return "unattached"
    return "never_reviewed"


async def cleanup_due(session: AsyncSession, *, now: datetime | None = None, limit: int = 500) -> int:
    """Удалить файлы с наступившим delete_after. Повторный запуск безопасен. Возвращает число удалённых."""
    now = now or utcnow()
    due = (
        await session.execute(
            select(TaskProof)
            .where(TaskProof.deleted_at.is_(None), TaskProof.delete_after <= now)
            .order_by(TaskProof.delete_after)
            .limit(limit)
        )
    ).scalars().all()
    n = 0
    for p in due:
        reason = _reason(p)
        try:
            _path(p.filename).unlink(missing_ok=True)
        except OSError:
            log.exception("[proofs] не удалось удалить файл proof=%s", p.id)
            continue
        p.deleted_at = now
        p.delete_reason = reason
        n += 1
        log.info("[proofs] удалён скриншот proof=%s task=%s submission=%s reason=%s", p.id, p.task_id, p.submission_id, reason)
    await session.flush()
    return n


async def cleanup_once(session_factory) -> int:
    async with session_factory() as s:
        n = await cleanup_due(s)
        await s.commit()
        return n

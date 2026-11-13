"""Скриншоты-подтверждения: проверка загрузки, доступ к картинке, очередь удаления (24 ч), перенос старых типов."""

from __future__ import annotations

import asyncio
import os
import struct
import tempfile
import unittest
import warnings
import zlib
from datetime import timedelta
from decimal import Decimal
from pathlib import Path

from fastapi import HTTPException
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from app.api import tasks as tasks_api
from app.core.config import settings
from app.db.base import Base
from app.models import BalanceHistory, Task, TaskProof, TaskSubmission, User  # noqa: F401
from app.services import task_legacy
from app.services import task_proofs as pf
from app.services import tasks as t_svc
from app.services.economy_admin import set_setting
from app.services.economy_seed import seed_economy

warnings.filterwarnings("ignore", message=".*Decimal objects natively.*")
D = Decimal


# ── тестовые картинки ──

def _png_chunk(t: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + t + data + struct.pack(">I", zlib.crc32(t + data) & 0xFFFFFFFF)


def png(with_meta=True) -> bytes:
    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    parts = [b"\x89PNG\r\n\x1a\n", _png_chunk(b"IHDR", ihdr)]
    if with_meta:
        parts += [_png_chunk(b"tEXt", b"Author\x00secret-gps"), _png_chunk(b"eXIf", b"MM\x00*GPSDATA")]
    parts += [_png_chunk(b"IDAT", zlib.compress(b"\x00\xff\x00\x00")), _png_chunk(b"IEND", b"")]
    return b"".join(parts)


def jpeg() -> bytes:
    app0 = b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    exif = b"Exif\x00\x00GPSDATA-secret"
    seg = lambda m, d: bytes([0xFF, m]) + struct.pack(">H", len(d) + 2) + d  # noqa: E731
    return (b"\xff\xd8" + seg(0xE0, app0) + seg(0xE1, exif) + seg(0xFE, b"comment-secret")
            + seg(0xDB, b"\x00" + bytes(64)) + seg(0xDA, b"\x01\x01\x00\x00\x3f\x00") + b"\x12\x34" + b"\xff\xd9")


def webp() -> bytes:
    ch = lambda t, d: t + struct.pack("<I", len(d)) + d + (b"\x00" if len(d) & 1 else b"")  # noqa: E731
    vp8x = bytes([0x08 | 0x04 | 0x10, 0, 0, 0]) + b"\x00\x00\x00" + b"\x00\x00\x00"
    body = b"WEBP" + ch(b"VP8X", vp8x) + ch(b"VP8L", b"\x2f\x00\x00\x00\x00") + ch(b"EXIF", b"GPSDATA-secret") + ch(b"XMP ", b"<x/>")
    return b"RIFF" + struct.pack("<I", len(body)) + body


class FakeRequest:
    def __init__(self, data: bytes, ctype: str):
        self.headers = {"content-type": ctype, "content-length": str(len(data))}
        self._data = data

    async def stream(self):
        for i in range(0, len(self._data), 65536):
            yield self._data[i : i + 65536]
        yield b""


# ── окружение ──

_tg = [9000]


async def _user(s, *, balance="10", **flags):
    _tg[0] += 1
    u = User(telegram_id=_tg[0], balance=D(balance), **flags)
    s.add(u)
    await s.flush()
    return u


class Base_(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self._old = settings.proof_upload_dir
        settings.proof_upload_dir = self._tmp.name

    def tearDown(self):
        settings.proof_upload_dir = self._old
        self._tmp.cleanup()

    def files(self):
        return sorted(os.listdir(self._tmp.name))

    def run_db(self, fn):
        async def wrap():
            engine = create_async_engine("sqlite+aiosqlite:///:memory:")
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
            Session = async_sessionmaker(engine, expire_on_commit=False)
            try:
                async with Session() as s:
                    await seed_economy(s)
                    await set_setting(s, key="task_platform_commission_bp", value={"bp": 1000})
                    await fn(s)
            finally:
                await engine.dispose()

        asyncio.run(wrap())


async def _visit(s, creator, *, proof=True, slots=10):
    v = await t_svc.create_task(s, creator=creator, title="Переход", description="Открой сайт и пришли скрин",
                                reward=None, total_slots=slots, task_type="visit",
                                target_url="https://example.com", publish=True, proof_required=proof)
    return await s.get(Task, v.id)


class Validation(Base_):
    def test_formats_and_metadata_stripped(self):
        for raw, mime in ((png(), "image/png"), (jpeg(), "image/jpeg"), (webp(), "image/webp")):
            clean, got = pf.sanitize(raw, mime)
            self.assertEqual(got, mime)
            self.assertNotIn(b"secret", clean)
            self.assertNotIn(b"GPSDATA", clean)
            self.assertEqual(pf.detect_mime(clean), mime)
        clean, _ = pf.sanitize(png(), "image/png")
        self.assertIn(b"IHDR", clean)
        self.assertTrue(clean.endswith(_png_chunk(b"IEND", b"")))
        w, _ = pf.sanitize(webp(), "image/webp")
        self.assertEqual(struct.unpack("<I", w[4:8])[0], len(w) - 8)
        self.assertEqual(w[20] & 0x0C, 0)  # флаги EXIF/XMP сняты
        j, _ = pf.sanitize(jpeg(), "image/jpeg")
        self.assertIn(b"JFIF", j)

    def test_rejects_bad_input(self):
        with self.assertRaises(pf.ProofError):
            pf.sanitize(b"", "image/png")
        with self.assertRaises(pf.ProofError):
            pf.sanitize(b"GIF89a....", "image/gif")
        with self.assertRaises(pf.ProofError):
            pf.sanitize(b"<svg xmlns='http://www.w3.org/2000/svg'/>", "image/svg+xml")
        with self.assertRaises(pf.ProofError):  # тип в заголовке не совпадает с содержимым
            pf.sanitize(png(), "image/jpeg")
        with self.assertRaises(pf.ProofError):  # обрезанный PNG
            pf.sanitize(png()[:40], "image/png")
        with self.assertRaises(pf.ProofTooLarge):
            pf.sanitize(png() + b"\x00" * pf.MAX_BYTES, "image/png")

    def test_upload_endpoint(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            task = await _visit(s, owner)
            w = await _user(s, balance="0")
            await s.commit()
            tid, wid = task.id, w.id
            w = await s.get(User, wid)
            # больше 5 МБ → 413, ничего не сохранено
            with self.assertRaises(HTTPException) as cm:
                await tasks_api.upload_proof(tid, FakeRequest(b"\x89PNG" + b"\x00" * (pf.MAX_BYTES + 10), "image/png"), user=w, db=s)
            self.assertEqual(cm.exception.status_code, 413)
            w = await s.get(User, wid)
            with self.assertRaises(HTTPException) as cm:
                await tasks_api.upload_proof(tid, FakeRequest(b"not an image", "image/png"), user=w, db=s)
            self.assertEqual(cm.exception.status_code, 400)
            self.assertEqual(self.files(), [])
            w = await s.get(User, wid)
            out = await tasks_api.upload_proof(tid, FakeRequest(jpeg(), "image/jpeg"), user=w, db=s)
            self.assertEqual(out.mime, "image/jpeg")
            names = self.files()
            self.assertEqual(len(names), 1)
            self.assertRegex(names[0], r"^[0-9a-f]{32}\.jpg$")
            self.assertNotIn(b"GPSDATA", (Path(self._tmp.name) / names[0]).read_bytes())
            mode = os.stat(Path(self._tmp.name) / names[0]).st_mode & 0o777
            self.assertEqual(mode, 0o600)
            # без скриншота заявку не принять
            w = await s.get(User, wid)
            with self.assertRaises(HTTPException):
                await tasks_api.submit_task(tid, tasks_api.SubmitBody(proof_text="готово"), user=w, db=s)
            w = await s.get(User, wid)
            sub = await tasks_api.submit_task(tid, tasks_api.SubmitBody(proof_upload_id=out.id), user=w, db=s)
            self.assertEqual(sub.proof_image_id, out.id)
            self.assertEqual(sub.proof_image_state, "available")
            # чужую загрузку прикрепить нельзя
            other = await _user(s, balance="0")
            await s.commit()
            oid = other.id
            other = await s.get(User, oid)
            o_up = await tasks_api.upload_proof(tid, FakeRequest(png(), "image/png"), user=other, db=s)
            w2 = await _user(s, balance="0")
            await s.commit()
            w2 = await s.get(User, w2.id)
            with self.assertRaises(HTTPException):
                await tasks_api.submit_task(tid, tasks_api.SubmitBody(proof_upload_id=o_up.id), user=w2, db=s)

        self.run_db(body)

    def test_proof_only_for_visit_and_campaign(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            with self.assertRaises(t_svc.TaskError):
                await t_svc.create_task(s, creator=owner, title="Партнёр", description="Услуга", reward=D("1"),
                                        total_slots=5, task_type="partner", partner_telegram_id=owner.telegram_id,
                                        proof_required=True)

        self.run_db(body)


class Access(Base_):
    def test_image_only_for_reviewers(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            amb = await _user(s, balance="10", is_ambassador=True)
            task = await _visit(s, amb)  # создатель — амбассадор
            w = await _user(s, balance="0")
            stranger = await _user(s)
            admin = await _user(s, is_admin=True)
            await t_svc.approve_task(s, task_id=task.id, actor=admin)
            await t_svc.publish_task(s, task_id=task.id, actor=amb)
            await s.refresh(task)
            self.assertEqual(task.status, "active")
            proof = await pf.store_upload(s, user=w, task=task, data=png(), declared="image/png")
            await t_svc.submit(s, user=w, task_id=task.id, proof_upload_id=proof.id)
            await s.commit()
            pid = proof.id
            for u_id, code in ((w.id, 403), (stranger.id, 403)):
                u = await s.get(User, u_id)
                with self.assertRaises(HTTPException) as cm:
                    await tasks_api.proof_image(pid, user=u, db=s)
                self.assertEqual(cm.exception.status_code, code)
            for u_id in (amb.id, admin.id, owner.id):
                u = await s.get(User, u_id)
                r = await tasks_api.proof_image(pid, user=u, db=s)
                self.assertEqual(r.media_type, "image/png")
                self.assertEqual(r.headers["cache-control"], "no-store, private")
                self.assertEqual(r.headers["x-content-type-options"], "nosniff")
                self.assertTrue(r.body.startswith(b"\x89PNG"))
            u = await s.get(User, owner.id)
            with self.assertRaises(HTTPException) as cm:
                await tasks_api.proof_image(999999, user=u, db=s)
            self.assertEqual(cm.exception.status_code, 404)
            # непривязанную загрузку не отдаём никому
            loose = await pf.store_upload(s, user=w, task=task, data=png(), declared="image/png")
            await s.commit()
            with self.assertRaises(HTTPException) as cm:
                await tasks_api.proof_image(loose.id, user=await s.get(User, owner.id), db=s)
            self.assertEqual(cm.exception.status_code, 404)

        self.run_db(body)


class Cleanup(Base_):
    def test_review_schedules_delete_within_24h(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            task = await _visit(s, owner)
            for approve in (True, False):
                w = await _user(s, balance="0")
                p = await pf.store_upload(s, user=w, task=task, data=png(), declared="image/png")
                sub = await t_svc.submit(s, user=w, task_id=task.id, proof_upload_id=p.id)
                self.assertEqual(pf._aware(p.delete_after) - pf._aware(p.created_at), pf.NEVER_REVIEWED)
                await t_svc.review_submission(s, actor=owner, submission_id=sub.id, approve=approve,
                                              reject_reason=None if approve else "low_quality")
                await s.refresh(p)
                reviewed = pf._aware(p.reviewed_at)
                self.assertIsNotNone(reviewed)
                self.assertLessEqual(pf._aware(p.delete_after) - reviewed, timedelta(hours=24))
                # через час после проверки — ещё на месте
                self.assertEqual(await pf.cleanup_due(s, now=reviewed + timedelta(hours=1)), 0)
                self.assertIn(p.filename, self.files())
                # худший случай: срок + шаг фонового цикла — всё ещё раньше 24 ч
                worst = pf._aware(p.delete_after) + timedelta(seconds=600)
                self.assertLess(worst - reviewed, timedelta(hours=24))
                self.assertEqual(await pf.cleanup_due(s, now=worst), 1)
                self.assertNotIn(p.filename, self.files())
                await s.refresh(p)
                self.assertEqual(p.delete_reason, "reviewed")
                self.assertIsNotNone(p.deleted_at)
            sub_ids = (await s.execute(select(TaskSubmission.id))).scalars().all()
            out = await tasks_api.pending_submissions(user=owner, db=s)
            self.assertEqual(out, [])  # обе проверены; заявки остаются в БД
            self.assertEqual(len(sub_ids), 2)

        self.run_db(body)

    def test_orphans_and_never_reviewed(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            task = await _visit(s, owner)
            w = await _user(s, balance="0")
            loose = await pf.store_upload(s, user=w, task=task, data=png(), declared="image/png")
            w2 = await _user(s, balance="0")
            p = await pf.store_upload(s, user=w2, task=task, data=webp(), declared="image/webp")
            await t_svc.submit(s, user=w2, task_id=task.id, proof_upload_id=p.id)
            t0 = pf._aware(loose.created_at)
            self.assertEqual(await pf.cleanup_due(s, now=t0 + timedelta(minutes=30)), 0)
            self.assertEqual(await pf.cleanup_due(s, now=t0 + timedelta(hours=1, seconds=1)), 1)
            await s.refresh(loose)
            self.assertEqual(loose.delete_reason, "unattached")
            self.assertEqual(await pf.cleanup_due(s, now=t0 + timedelta(days=13)), 0)
            self.assertEqual(await pf.cleanup_due(s, now=t0 + timedelta(days=14, minutes=1)), 1)
            await s.refresh(p)
            self.assertEqual(p.delete_reason, "never_reviewed")
            self.assertEqual(self.files(), [])
            sub = await s.scalar(select(TaskSubmission).where(TaskSubmission.user_id == w2.id))
            self.assertEqual(sub.status, "pending")  # заявка остаётся на проверке

        self.run_db(body)

    def test_cleanup_idempotent(self):
        async def body(s):
            owner = await _user(s, is_owner=True)
            task = await _visit(s, owner)
            w = await _user(s, balance="0")
            p = await pf.store_upload(s, user=w, task=task, data=png(), declared="image/png")
            sub = await t_svc.submit(s, user=w, task_id=task.id, proof_upload_id=p.id)
            await t_svc.review_submission(s, actor=owner, submission_id=sub.id, approve=True)
            await s.refresh(p)
            later = pf._aware(p.delete_after) + timedelta(minutes=1)
            # файл уже удалён кем-то вручную — очистка всё равно проходит
            (Path(self._tmp.name) / p.filename).unlink()
            self.assertEqual(await pf.cleanup_due(s, now=later), 1)
            await s.refresh(p)
            first = p.deleted_at
            self.assertEqual(await pf.cleanup_due(s, now=later + timedelta(hours=5)), 0)
            await s.refresh(p)
            self.assertEqual(p.deleted_at, first)
            # повторная проверка после удаления не возвращает в очередь
            await pf.schedule_after_review(s, sub.id, now=later + timedelta(hours=6))
            await s.refresh(p)
            self.assertEqual(p.deleted_at, first)
            with self.assertRaises(HTTPException) as cm:
                await tasks_api.proof_image(p.id, user=owner, db=s)
            self.assertEqual(cm.exception.status_code, 404)

        self.run_db(body)


class Legacy(Base_):
    def test_mapping_keeps_money_and_submissions(self):
        async def body(s):
            owner = await _user(s, balance="20", is_owner=True)
            admin = await _user(s, balance="20", is_admin=True)
            amb = await _user(s, balance="20", is_ambassador=True)

            async def mk(creator, ttype, url=None):
                v = await t_svc.create_task(s, creator=creator, title="Старое", description="Сделай",
                                            reward=D("0.1"), total_slots=5, task_type=ttype, target_url=url,
                                            publish=True)
                return v.id

            t_owner = await mk(owner, "manual_proof")
            t_admin = await mk(admin, "manual_proof", "https://example.com/a")
            t_link = await mk(admin, "link", "https://example.com/b")
            t_amb = await mk(amb, "manual_proof")
            t_visit = (await _visit(s, admin, proof=False)).id
            w = await _user(s, balance="0")
            sub_p = await t_svc.submit(s, user=w, task_id=t_admin, proof_text="pending")
            sub_a = await t_svc.submit(s, user=w, task_id=t_owner, proof_text="ok")
            await t_svc.review_submission(s, actor=owner, submission_id=sub_a.id, approve=True)
            await s.commit()

            async def snapshot():
                users = {u.id: D(u.balance) for u in (await s.execute(select(User))).scalars()}
                tasks = {t.id: (D(t.reward), t.total_slots, t.filled_slots, D(t.budget_locked or 0), t.commission_bp,
                                t.creator_payout_nano, t.platform_payout_nano, t.status)
                         for t in (await s.execute(select(Task))).scalars()}
                subs = {x.id: (x.status, x.task_id, x.user_id) for x in (await s.execute(select(TaskSubmission))).scalars()}
                hist = len((await s.execute(select(BalanceHistory))).scalars().all())
                return users, tasks, subs, hist

            before = await snapshot()
            for _ in range(2):  # повторный запуск ничего не меняет
                for stmt in task_legacy.upgrade_sql(set()):
                    await s.execute(text(stmt))
                await s.commit()
                s.expire_all()
                got = {t.id: (t.task_type, bool(t.proof_required), t.legacy_type)
                       for t in (await s.execute(select(Task))).scalars()}
                self.assertEqual(got[t_owner], ("campaign", True, "manual_proof"))
                self.assertEqual(got[t_admin], ("visit", True, "manual_proof"))
                self.assertEqual(got[t_amb], ("visit", True, "manual_proof"))
                self.assertEqual(got[t_link], ("visit", False, "link"))
                self.assertEqual(got[t_visit], ("visit", False, None))
                self.assertEqual(await snapshot(), before)

            # заявка на проверке по-прежнему проверяется и платит старую награду
            w = await s.get(User, w.id)
            bal = D(w.balance)
            await t_svc.review_submission(s, actor=admin, submission_id=sub_p.id, approve=True)
            await s.refresh(w)
            self.assertEqual(D(w.balance) - bal, D("0.1"))

            # откат возвращает старые типы
            for stmt in task_legacy.downgrade_sql():
                await s.execute(text(stmt))
            await s.commit()
            s.expire_all()
            types = {t.id: (t.task_type, t.legacy_type) for t in (await s.execute(select(Task))).scalars()}
            self.assertEqual(types[t_owner], ("manual_proof", None))
            self.assertEqual(types[t_link], ("link", None))
            self.assertEqual(types[t_visit], ("visit", None))

        self.run_db(body)

    def test_env_owner_counts_as_owner(self):
        async def body(s):
            boss = await _user(s, balance="20", is_admin=True)  # владелец из TELEGRAM_OWNER_IDS, флаг в БД не стоит
            v = await t_svc.create_task(s, creator=boss, title="Старое", description="Сделай", reward=D("0.1"),
                                        total_slots=5, task_type="manual_proof", publish=True)
            for stmt in task_legacy.upgrade_sql({boss.telegram_id}):
                await s.execute(text(stmt))
            await s.commit()
            s.expire_all()
            self.assertEqual((await s.get(Task, v.id)).task_type, "campaign")

        self.run_db(body)

    def test_api_rejects_legacy_create(self):
        async def body(s):
            admin = await _user(s, balance="20", is_admin=True)
            await s.commit()
            for tt in ("manual_proof", "link"):
                with self.assertRaises(HTTPException) as cm:
                    await tasks_api.create_task(tasks_api.TaskCreateBody(
                        title="Старое", description="Сделай", reward=D("0.1"), total_slots=5, task_type=tt),
                        user=admin, db=s)
                self.assertEqual(cm.exception.status_code, 400)
            self.assertEqual(tasks_api.TaskCreateBody(title="abc", description="abc", total_slots=1).task_type, "visit")

        self.run_db(body)


if __name__ == "__main__":
    unittest.main()

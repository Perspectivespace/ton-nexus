"""Deploy queue: the API side.

The API never runs shell. It drops a JSON request into
``<spool>/requests/<id>.json``; the root-owned systemd unit
``ton-nexus-deploy.path`` wakes ``ton-nexus-deploy.service`` which runs
``scripts/deploy-runner.sh`` and writes ``<spool>/jobs/<id>.json`` +
``<spool>/logs/<id>.log``. Here we only read those files.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from app.core.config import settings

JOB_ID_RE = re.compile(r"^[0-9]{8}T[0-9]{6}Z-[0-9a-f]{6}$")
TARGETS = {"test"}  # "prod" will be added when /opt/taskbot_prod is set up
STALE_RUNNING_SEC = 45 * 60


def spool() -> Path:
    return Path(settings.deploy_spool_dir)


def runner_installed() -> bool:
    req = spool() / "requests"
    return req.is_dir() and os.access(req, os.W_OK)


def _read_json(path: Path) -> dict[str, Any] | None:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def new_job_id() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + secrets.token_hex(3)


def queued_requests() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for p in sorted((spool() / "requests").glob("*.json")):
        data = _read_json(p)
        if data and JOB_ID_RE.match(p.stem):
            data.update({"id": p.stem, "status": "queued", "step": None, "commits": []})
            out.append(data)
    return out


def read_job(job_id: str) -> dict[str, Any] | None:
    if not JOB_ID_RE.match(job_id):
        return None
    data = _read_json(spool() / "jobs" / f"{job_id}.json")
    if data:
        return data
    for q in queued_requests():
        if q["id"] == job_id:
            return q
    return None


def list_jobs(limit: int = 10) -> list[dict[str, Any]]:
    jobs_dir = spool() / "jobs"
    files = sorted(
        (p for p in jobs_dir.glob("*.json") if JOB_ID_RE.match(p.stem)),
        key=lambda p: p.stem,
        reverse=True,
    ) if jobs_dir.is_dir() else []
    jobs = [j for j in (_read_json(p) for p in files[:limit]) if j]
    queued = list(reversed(queued_requests())) if (spool() / "requests").is_dir() else []
    return (queued + jobs)[:limit]


def _is_active(job: dict[str, Any]) -> bool:
    if job.get("status") == "queued":
        return True
    if job.get("status") != "running":
        return False
    path = spool() / "jobs" / f"{job['id']}.json"
    try:
        return time.time() - path.stat().st_mtime < STALE_RUNNING_SEC
    except OSError:
        return False


def active_job(target: str) -> dict[str, Any] | None:
    for job in list_jobs(limit=5):
        if job.get("target") == target and _is_active(job):
            return job
    return None


def create_request(target: str, force: bool, telegram_id: int, name: str | None) -> dict[str, Any]:
    job_id = new_job_id()
    req = {
        "id": job_id,
        "target": target,
        "force": bool(force),
        "requested_by": int(telegram_id),
        "requested_by_name": (name or "")[:64],
        "requested_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    req_dir = spool() / "requests"
    tmp = req_dir / f".{job_id}.tmp"
    tmp.write_text(json.dumps(req), encoding="utf-8")
    os.chmod(tmp, 0o660)
    os.replace(tmp, req_dir / f"{job_id}.json")  # atomic: runner never sees half a file
    req.update({"status": "queued", "step": None, "commits": []})
    return req


def log_tail(job_id: str, lines: int = 200) -> str:
    if not JOB_ID_RE.match(job_id):
        return ""
    path = spool() / "logs" / f"{job_id}.log"
    try:
        with path.open("rb") as f:
            f.seek(0, os.SEEK_END)
            size = f.tell()
            f.seek(max(0, size - 64 * 1024))
            data = f.read().decode("utf-8", errors="replace")
    except OSError:
        return ""
    return "\n".join(data.splitlines()[-lines:])


def _git_head(app_dir: Path) -> str | None:
    """Read HEAD sha from .git without running git."""
    git = app_dir / ".git"
    try:
        head = (git / "HEAD").read_text().strip()
        if not head.startswith("ref: "):
            return head or None
        ref = head[5:]
        ref_file = git / ref
        if ref_file.exists():
            return ref_file.read_text().strip() or None
        packed = git / "packed-refs"
        if packed.exists():
            for line in packed.read_text().splitlines():
                if line.endswith(" " + ref):
                    return line.split(" ", 1)[0]
    except OSError:
        return None
    return None


def deployed_info(target: str) -> dict[str, Any]:
    data = _read_json(spool() / f"deployed-{target}.json") or {}
    head = _git_head(Path(settings.deploy_test_app_dir)) if target == "test" else None
    commit = data.get("commit") or head
    return {
        "commit": commit,
        "subject": data.get("subject"),
        "deployed_at": data.get("deployed_at"),
        "job_id": data.get("job_id"),
        "head_matches": (head == commit) if head and commit else None,
    }


# ---------- GitHub (public API, cached) ----------
_GH_CACHE: dict[str, tuple[float, Any]] = {}
_GH_TTL = 120.0
_gh_lock = asyncio.Lock()


async def _gh_get(path: str, force: bool = False) -> Any:
    now = time.monotonic()
    hit = _GH_CACHE.get(path)
    if hit and not force and now - hit[0] < _GH_TTL:
        return hit[1]
    async with _gh_lock:
        hit = _GH_CACHE.get(path)
        if hit and now - hit[0] < (15.0 if force else _GH_TTL):
            return hit[1]
        headers = {"Accept": "application/vnd.github+json", "User-Agent": "ton-nexus-deploy"}
        if settings.github_token:
            headers["Authorization"] = f"Bearer {settings.github_token}"
        async with httpx.AsyncClient(timeout=6.0) as client:
            r = await client.get(f"https://api.github.com/repos/{settings.github_repo}{path}", headers=headers)
            r.raise_for_status()
            data = r.json()
        _GH_CACHE[path] = (time.monotonic(), data)
        return data


def _commit_brief(c: dict[str, Any]) -> dict[str, Any]:
    msg = (c.get("commit", {}).get("message") or "").splitlines()
    return {
        "sha": (c.get("sha") or "")[:7],
        "subject": msg[0] if msg else "",
        "author": c.get("commit", {}).get("author", {}).get("name"),
        "date": c.get("commit", {}).get("author", {}).get("date"),
    }


async def latest_vs_deployed(deployed_commit: str | None, refresh: bool = False) -> dict[str, Any]:
    branch = settings.deploy_branch
    try:
        head = await _gh_get(f"/commits/{branch}", force=refresh)
        latest = {**_commit_brief(head), "commit": head.get("sha")}
        pending: list[dict[str, Any]] = []
        ahead: int | None = None
        if deployed_commit and latest["commit"] and deployed_commit != latest["commit"]:
            cmp = await _gh_get(f"/compare/{deployed_commit}...{latest['commit']}", force=refresh)
            ahead = int(cmp.get("ahead_by") or 0)
            pending = [_commit_brief(c) for c in reversed(cmp.get("commits") or [])][:30]
        elif deployed_commit:
            ahead = 0
        return {
            "latest": latest,
            "ahead_by": ahead,
            "pending": pending,
            "update_available": (ahead > 0) if ahead is not None else None,
            "github_error": None,
        }
    except (httpx.HTTPError, ValueError, KeyError) as e:
        return {
            "latest": None,
            "ahead_by": None,
            "pending": [],
            "update_available": None,
            "github_error": str(e)[:200] or e.__class__.__name__,
        }

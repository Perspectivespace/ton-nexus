"""Знакомство игрока: вводные экраны при первом входе и разовые подсказки в разделах.

Состояние хранится у игрока на сервере (users.onboarding), чтобы не повторяться на другом устройстве.
Повторить знакомство можно из Профиля → «Настройки» (сброс).
"""

from __future__ import annotations

from typing import Any

from app.models.user import User

# разделы дока: Главная, Майнер, Заработок, Профиль
HINTS = ("home", "miner", "earn", "profile")


def state(user: User) -> dict[str, Any]:
    raw = user.onboarding if isinstance(user.onboarding, dict) else {}
    hints = [h for h in HINTS if h in (raw.get("hints") or [])]
    return {"intro_done": bool(raw.get("intro")), "hints": hints}


def apply(user: User, *, intro_done: bool | None = None, hint: str | None = None, reset: bool = False) -> dict[str, Any]:
    """Отметить показанное. reset — начать знакомство заново (вводные экраны и все подсказки)."""
    if hint is not None and hint not in HINTS:
        raise ValueError("unknown hint")
    cur = {"intro": False, "hints": []} if reset else {"intro": state(user)["intro_done"], "hints": state(user)["hints"]}
    if intro_done is not None:
        cur["intro"] = bool(intro_done)
    if hint is not None and hint not in cur["hints"]:
        cur["hints"] = [h for h in HINTS if h in cur["hints"] or h == hint]
    user.onboarding = cur  # новый объект — SQLAlchemy видит изменение JSON
    return state(user)

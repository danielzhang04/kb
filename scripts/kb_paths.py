"""Shared runtime-state path resolution for Python producers and readers."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Mapping


def resolve_state_root(
    env: Mapping[str, str] | None = None,
    platform: str | None = None,
    *,
    override_key: str = "KB_CODEX_DISPATCH_STATE",
    default_name: str | None = "kb-codex-dispatch",
) -> Path | None:
    """Resolve an explicit state root, with an optional platform-local fallback."""
    values = os.environ if env is None else env
    override = (values.get(override_key) or "").strip()
    if override:
        return Path(override).expanduser()
    if default_name is None:
        return None
    if (platform or os.name) == "nt":
        return Path(values.get("LOCALAPPDATA", str(Path.home()))) / default_name
    return Path.home() / ".local" / "state" / default_name


def resolve_dashboard_state_path(
    family: str,
    *parts: str,
    env: Mapping[str, str] | None = None,
    fallback: Path | None = None,
) -> Path | None:
    """Resolve ``DASHBOARD_STATE_ROOT/family/...`` or the caller's pre-existing fallback."""
    root = resolve_dashboard_state_root(env)
    if root is not None:
        return root.joinpath(family, *parts)
    return fallback


def resolve_dashboard_state_root(
    env: Mapping[str, str] | None = None, *, fallback: Path | None = None
) -> Path | None:
    """Resolve the dashboard state root, retaining a caller-owned fallback."""
    root = resolve_state_root(
        env, override_key="DASHBOARD_STATE_ROOT", default_name=None
    )
    return root if root is not None else fallback

"""Explicit timestamped one-way export; no import path exists."""

from __future__ import annotations

import csv
import os
import re
import sqlite3
from pathlib import Path

EXPORT_MARKER = "# kb-prospecting-one-way-export reimport=false"
EXPORT_VIEWS = frozenset({"company_tranche", "person_tranche"})
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def _export_root() -> Path:
    local_app_data = os.environ.get("LOCALAPPDATA")
    if not local_app_data:
        raise RuntimeError("LOCALAPPDATA is required for exports")
    if local_app_data.startswith(("\\\\", "//")):
        raise ValueError("UNC export roots are prohibited")
    root = Path(local_app_data) / "kb-prospecting" / "exports"
    for candidate in (Path(local_app_data), Path(local_app_data) / "kb-prospecting", root):
        if candidate.exists() and candidate.is_symlink():
            raise ValueError("symlinked export roots are prohibited")
    resolved = root.resolve()
    if resolved == REPOSITORY_ROOT or resolved.is_relative_to(REPOSITORY_ROOT):
        raise ValueError("export root must not be inside the repository")
    return resolved


def export_csv(connection: sqlite3.Connection, view: str, at: str) -> Path:
    if view not in EXPORT_VIEWS:
        raise ValueError("view is not exportable")
    if re.fullmatch(r"\d{8}T\d{6}Z", at) is None:
        raise ValueError("timestamp must be compact UTC")
    root = _export_root()
    destination = (root / f"{view}-{at}.csv").resolve()
    if not destination.is_relative_to(root):
        raise ValueError("export destination must stay within the export root")
    root.mkdir(parents=True, exist_ok=True)
    if root.is_symlink() or root.resolve() != root:
        raise ValueError("symlinked export roots are prohibited")
    cursor = connection.execute(f"SELECT * FROM {view}")
    with destination.open("x", encoding="utf-8", newline="") as handle:
        handle.write(EXPORT_MARKER + "\n")
        writer = csv.writer(handle)
        writer.writerow(column[0] for column in cursor.description)
        writer.writerows(cursor)
    return destination

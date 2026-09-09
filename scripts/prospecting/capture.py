"""Manual LinkedIn URL and CSV intake into the desktop-local prospecting store."""

from __future__ import annotations

import csv
from dataclasses import dataclass
import hashlib
import io
import json
import sqlite3
from typing import Callable, Iterable, Literal, TextIO
from urllib.parse import urlsplit
import uuid

from scripts.prospecting.pii_guard import assert_vm_safe
from scripts.prospecting.store import (
    Company,
    Person,
    SourceObservation,
    insert_company,
    insert_person,
    insert_source_observation,
)


_LIVE_LINKEDIN_HOSTS = ("linkedin.com", "www.linkedin.com")
_FIXTURE_LINKEDIN_HOSTS = ("professional-network.invalid",)


@dataclass(frozen=True)
class CaptureResult:
    entity_ids: tuple[str, ...]
    inserted: int
    duplicates: int


def normalize_linkedin_url(
    raw: str,
    kind: Literal["person", "company"],
    *,
    allowed_hosts: tuple[str, ...] = _LIVE_LINKEDIN_HOSTS,
) -> str:
    """Return a canonical LinkedIn profile or company URL without tracking fields."""
    parsed = urlsplit(raw.strip())
    host = parsed.hostname.lower() if parsed.hostname else ""
    if host not in set(allowed_hosts):
        raise ValueError("invalid_linkedin_host")
    prefix = (
        ("/in/" if kind == "person" else "/company/")
        if host in _LIVE_LINKEDIN_HOSTS
        else ("/profile/" if kind == "person" else "/organization/")
    )
    path = parsed.path.lower().rstrip("/")
    slug = path.removeprefix(prefix).split("/", 1)[0]
    if not path.startswith(prefix) or not slug:
        raise ValueError("invalid_linkedin_path")
    canonical_host = "www.linkedin.com" if host in _LIVE_LINKEDIN_HOSTS else host
    return f"https://{canonical_host}{prefix}{slug}"


def make_dedupe_key(
    kind: str,
    canonical_url: str,
    *,
    name: str = "",
    location: str = "",
) -> str:
    basis = canonical_url if kind == "person" else f"{name.strip().casefold()}|{location.strip().casefold()}"
    return hashlib.sha256(f"{kind}:v1:{basis}".encode()).hexdigest()


def capture_urls(
    connection: sqlite3.Connection,
    urls: Iterable[str],
    seen_at: str,
    id_factory: Callable[[], str] = lambda: str(uuid.uuid4()),
) -> CaptureResult:
    source = io.StringIO()
    writer = csv.writer(source)
    writer.writerow(("kind", "linkedin_url", "name", "first_name"))
    for url in urls:
        writer.writerow(("person", url, "Captured", "Captured"))
    source.seek(0)
    return capture_csv(connection, source, seen_at, id_factory)


def capture_csv(
    connection: sqlite3.Connection,
    source: TextIO,
    seen_at: str,
    id_factory: Callable[[], str] = lambda: str(uuid.uuid4()),
) -> CaptureResult:
    ids: list[str] = []
    duplicates = 0
    allowed_hosts = _LIVE_LINKEDIN_HOSTS + _FIXTURE_LINKEDIN_HOSTS
    with connection:
        for row in csv.DictReader(source):
            kind = row.get("kind", "").strip().lower()
            if kind not in {"person", "company"}:
                raise ValueError("invalid_capture_kind")
            canonical = normalize_linkedin_url(
                row.get("linkedin_url", ""), kind, allowed_hosts=allowed_hosts
            )
            name = row.get("name", "")
            key = make_dedupe_key(
                kind, canonical, name=name, location=row.get("location", "")
            )
            existing = connection.execute(
                f"SELECT {kind}_id FROM {kind} WHERE dedupe_key=?", (key,)
            ).fetchone()
            if existing is not None:
                duplicates += 1
                ids.append(existing[0])
                continue

            entity_id = id_factory()
            if kind == "company":
                insert_company(connection, Company(
                    entity_id, name, None, canonical, None, None,
                    row.get("location") or None, "manual", key,
                ))
            else:
                insert_person(connection, Person(
                    entity_id, row.get("first_name", ""), name, canonical,
                    row.get("location") or None, None, "manual", key,
                ))
            insert_source_observation(connection, SourceObservation(
                id_factory(), kind, entity_id, "linkedin_url", json.dumps(canonical),
                "manual", seen_at, seen_at, 1.0, None,
            ))
            ids.append(entity_id)

    result = CaptureResult(tuple(ids), len(ids) - duplicates, duplicates)
    assert_vm_safe(
        {"kind": "stdout", "fields": {"inserted": result.inserted, "duplicates": result.duplicates}},
        "stdout",
    )
    return result

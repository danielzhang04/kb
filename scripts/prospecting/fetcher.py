"""Deterministic, allow-listed public-page snapshot storage."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
import hashlib
import json
from pathlib import Path
import sqlite3
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, build_opener
import uuid

from .pii_guard import assert_vm_safe


@dataclass(frozen=True)
class FetchPolicy:
    allowed_hosts: tuple[str, ...]
    allowlist_version: str
    snapshot_dir: Path


@dataclass(frozen=True)
class FetchResponse:
    body: bytes
    content_type: str
    final_url: str


@dataclass(frozen=True)
class SnapshotMeta:
    snapshot_id: str
    entity_id: str
    source_domain: str
    retrieved_at: datetime
    content_type: str
    content_sha256: str
    allowlist_version: str
    body_ref: str
    expires_at: datetime
    retention_delete_at: datetime


def _allowed(url: str, policy: FetchPolicy) -> bool:
    parsed = urlsplit(url)
    return parsed.scheme == "https" and parsed.hostname in policy.allowed_hosts


def _offline(url: str) -> FetchResponse:
    repo_root = Path(__file__).resolve().parents[2]
    data = _load_finder_pages(repo_root / "orgs/prospecting/fixtures")
    row = data["snapshots"][url]
    return FetchResponse(row["body"].encode("utf-8"), row["content_type"], row["final_url"])


def _load_finder_pages(fixture_dir: Path) -> dict[str, object]:
    data = json.loads((fixture_dir / "finder-pages.json").read_text(encoding="utf-8"))
    for row in data.get("linkedin_local_pages", ()):  # type: ignore[union-attr]
        url = row.get("url")  # type: ignore[union-attr]
        if isinstance(url, str) and url.startswith("file:///fixtures/"):
            row["url"] = (fixture_dir / url.removeprefix("file:///fixtures/")).resolve().as_uri()  # type: ignore[index,union-attr]
    return data


class _AllowlistRedirect(HTTPRedirectHandler):
    def __init__(self, policy: FetchPolicy) -> None:
        self.policy = policy

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        if not _allowed(newurl, self.policy):
            raise ValueError("fetch_domain_blocked")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _http(url: str, policy: FetchPolicy) -> FetchResponse:
    with build_opener(_AllowlistRedirect(policy)).open(url, timeout=20) as response:
        return FetchResponse(
            response.read(), response.headers.get_content_type(), response.geturl()
        )


def _stored_url(connection: sqlite3.Connection, entity_id: str) -> str:
    row = connection.execute(
        "SELECT website_url FROM company WHERE company_id=?", (entity_id,)
    ).fetchone()
    if row is None:
        row = connection.execute(
            "SELECT linkedin_url FROM person WHERE person_id=?", (entity_id,)
        ).fetchone()
    if row is None or not row[0]:
        raise ValueError("snapshot_entity_url_missing")
    return str(row[0])


def fetch_snapshot(
    connection: sqlite3.Connection,
    entity_id: str,
    policy: FetchPolicy,
    retrieved_at: datetime,
    transport: Callable[[str], FetchResponse] | None = None,
) -> SnapshotMeta:
    """Fetch the entity's stored URL and retain its inert bytes for exactly 30 days."""
    source_url = _stored_url(connection, entity_id)
    if not _allowed(source_url, policy):
        raise ValueError("fetch_domain_blocked")

    fetch = transport or _offline
    response = fetch(source_url)
    if not _allowed(response.final_url, policy):
        raise ValueError("fetch_domain_blocked")

    digest = hashlib.sha256(response.body).hexdigest()
    snapshot_id = str(uuid.uuid4())
    policy.snapshot_dir.mkdir(parents=True, exist_ok=True)
    body_ref = f"{snapshot_id}.body"
    final_path = policy.snapshot_dir / body_ref
    staged = policy.snapshot_dir / f".{snapshot_id}.tmp"
    delete_at = retrieved_at + timedelta(days=30)
    source_domain = urlsplit(source_url).hostname or ""
    meta = SnapshotMeta(
        snapshot_id,
        entity_id,
        source_domain,
        retrieved_at,
        response.content_type,
        digest,
        policy.allowlist_version,
        body_ref,
        delete_at,
        delete_at,
    )
    assert_vm_safe(
        {
            "kind": "stdout",
            "fields": {
                "snapshot_id": snapshot_id,
                "entity_id": entity_id,
                "content_sha256": digest,
                "body_ref": body_ref,
                "result_code": "snapshot_stored",
            },
        },
        "stdout",
    )

    try:
        staged.write_bytes(response.body)
    except OSError as exc:
        staged.unlink(missing_ok=True)
        raise RuntimeError("snapshot_stage_failed") from exc

    savepoint_open = False
    try:
        connection.execute("SAVEPOINT snap")
        savepoint_open = True
        connection.execute(
            """INSERT INTO source_snapshot(
                snapshot_id,entity_id,source_url,source_domain,retrieved_at,content_type,
                content_sha256,allowlist_version,body_ref,expires_at,retention_delete_at
            ) VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (
                snapshot_id,
                entity_id,
                source_url,
                source_domain,
                retrieved_at.isoformat(),
                response.content_type,
                digest,
                policy.allowlist_version,
                body_ref,
                delete_at.isoformat(),
                delete_at.isoformat(),
            ),
        )
        staged.replace(final_path)
        connection.execute("RELEASE SAVEPOINT snap")
        savepoint_open = False
    except BaseException:
        if savepoint_open:
            try:
                connection.execute("ROLLBACK TO SAVEPOINT snap")
            finally:
                connection.execute("RELEASE SAVEPOINT snap")
        staged.unlink(missing_ok=True)
        final_path.unlink(missing_ok=True)
        raise
    return meta


def purge_expired(
    connection: sqlite3.Connection, snapshot_dir: Path, now: datetime
) -> int:
    """Remove expired snapshot bodies while preserving immutable metadata and hashes."""
    rows = connection.execute(
        "SELECT snapshot_id,body_ref FROM source_snapshot WHERE retention_delete_at<=?",
        (now.isoformat(),),
    ).fetchall()
    for _, body_ref in rows:
        (snapshot_dir / body_ref).unlink(missing_ok=True)
    return len(rows)

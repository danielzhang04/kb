"""P8's person-bio branch for the frozen snapshot executor operation."""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timedelta
import hashlib
from pathlib import Path
import socket
import sqlite3
import ssl
from urllib import error, request as urlrequest
from urllib.parse import urlsplit
import uuid

from scripts.prospecting.executor import Adapter, Executor
from scripts.prospecting.fetcher import FetchPolicy, FetchResponse, SnapshotMeta, _AllowlistRedirect, _allowed
from scripts.prospecting.operator import vendors
from scripts.prospecting.pii_guard import assert_vm_safe


BROWSER_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
}
_BODY_CAP = 2 * 1024 * 1024


def _browser_http(url: str, policy: FetchPolicy) -> FetchResponse:
    """Fetch a bounded browser-like response without weakening redirect checks."""
    request = urlrequest.Request(url, headers=BROWSER_HEADERS)
    with urlrequest.build_opener(_AllowlistRedirect(policy)).open(request, timeout=20) as response:
        return FetchResponse(
            response.read(_BODY_CAP), response.headers.get_content_type(), response.geturl()
        )


def _snapshot_dir(connection: sqlite3.Connection) -> Path:
    database = next(
        (str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"), ""
    )
    return Path(database).parent / "snapshots"


def capture_p6_snapshot_adapter(connection: sqlite3.Connection) -> Adapter:
    """Capture P6's public company snapshot closure without touching executor internals."""
    captured: dict[str, Adapter] = {}

    class _CaptureProxy:
        """Expose only the two attributes P6's registration helper uses."""

        def __init__(self) -> None:
            self.connection = connection

        def register_adapter(self, operation: str, adapter: Adapter, *, replace: bool = False) -> None:
            del replace
            captured[operation] = adapter

    vendors._register_snapshot_adapter(_CaptureProxy())
    return captured["fetch_snapshot"]


def _fetch_person_page(
    connection: sqlite3.Connection,
    entity_id: str,
    url: str,
    policy: FetchPolicy,
    now: datetime,
    transport: Callable[[str], FetchResponse] | None,
) -> SnapshotMeta:
    """Store an inert person bio page using the frozen snapshot row contract."""
    if not _allowed(url, policy):
        raise ValueError("fetch_domain_blocked")
    response = (transport or (lambda requested: _browser_http(requested, policy)))(url)
    if not _allowed(response.final_url, policy):
        raise ValueError("fetch_domain_blocked")

    snapshot_id = str(uuid.uuid4())
    digest = hashlib.sha256(response.body).hexdigest()
    snapshot_dir = policy.snapshot_dir
    snapshot_dir.mkdir(parents=True, exist_ok=True)
    body_ref = f"{snapshot_id}.body"
    final_path = snapshot_dir / body_ref
    staged = snapshot_dir / f".{snapshot_id}.tmp"
    delete_at = now + timedelta(days=30)
    meta = SnapshotMeta(
        snapshot_id, entity_id, urlsplit(url).hostname or "", now, response.content_type,
        digest, policy.allowlist_version, body_ref, delete_at, delete_at,
    )
    assert_vm_safe(
        {"kind": "stdout", "fields": {
            "snapshot_id": snapshot_id, "entity_id": entity_id, "content_sha256": digest,
            "body_ref": body_ref, "result_code": "snapshot_stored",
        }},
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
                snapshot_id, entity_id, url, meta.source_domain, now.isoformat(), response.content_type,
                digest, policy.allowlist_version, body_ref, delete_at.isoformat(), delete_at.isoformat(),
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


def register_bio_adapter(
    executor: Executor,
    resolve_person_url: Callable[[str], str | None], *, now: datetime,
    transport: Callable[[str], FetchResponse] | None = None,
) -> None:
    """Install a company-preserving, person-bio-aware snapshot dispatcher."""
    company_adapter = capture_p6_snapshot_adapter(executor.connection)

    def _adapter(request) -> tuple[str, str]:
        entity_id = str(request.payload["entity_id"])
        if entity_id.startswith("cmp_"):
            return company_adapter(request)
        if not entity_id.startswith("per_"):
            return "rejected", "snapshot_entity_type_unsupported"
        url = resolve_person_url(entity_id)
        if not url:
            return "rejected", "snapshot_entity_url_missing"
        host = urlsplit(url).hostname or ""
        if not host:
            return "rejected", "fetch_domain_blocked"
        hosts = (host, host[4:]) if host.startswith("www.") else (host, f"www.{host}")
        policy = FetchPolicy(hosts, "p8-bio-v1", _snapshot_dir(executor.connection))
        try:
            _fetch_person_page(executor.connection, entity_id, url, policy, now, transport)
        except error.HTTPError:
            return "rejected", "fetch_http_error"
        except ValueError:
            return "rejected", "fetch_domain_blocked"
        except (error.URLError, ssl.SSLError, socket.timeout, OSError):
            return "rejected", "fetch_transport_error"
        return "succeeded", "snapshot_profiled"

    executor.register_adapter("fetch_snapshot", _adapter, replace=True)

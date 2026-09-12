"""Local snapshot import and verification for current-role source review."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from hashlib import sha256
from html.parser import HTMLParser
import json
import os
from pathlib import Path
import stat
import sqlite3
import uuid
from urllib.parse import urlsplit


MAX_SOURCE_BYTES = 2 * 1024 * 1024
MAX_OPERATOR_SNAPSHOTS = 128
MAX_OPERATOR_SNAPSHOT_BYTES = 64 * 1024 * 1024


class _Text(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.hidden = 0

    def handle_starttag(self, tag: str, _attrs: list[tuple[str, str | None]]) -> None:
        if tag.casefold() in {"head", "script", "style", "template", "noscript"}:
            self.hidden += 1

    def handle_endtag(self, tag: str) -> None:
        if tag.casefold() in {"head", "script", "style", "template", "noscript"} and self.hidden:
            self.hidden -= 1

    def handle_data(self, data: str) -> None:
        if not self.hidden:
            self.parts.append(data)


def plain_text(value: str) -> str:
    parser = _Text()
    parser.feed(value)
    parser.close()
    return " ".join(" ".join(parser.parts).split())


def normalized(value: str) -> str:
    return " ".join("".join(c.casefold() if c.isalnum() else " " for c in value).split())


def contains_identity(value: str, *parts: str) -> bool:
    haystack = f" {normalized(value)} "
    return all((term := normalized(part)) and f" {term} " in haystack for part in parts)


def identity_excerpt(value: str, *parts: str) -> str | None:
    """Return source text only when a bounded excerpt contains every identity token."""
    text = plain_text(value)
    if len(text) <= 240:
        return text if contains_identity(text, *parts) else None
    folded = normalized(text)
    positions = [folded.find(normalized(part)) for part in parts]
    if any(position < 0 for position in positions):
        return None
    # Preserve source wording. Search bounded windows rather than synthesizing a claim.
    for start in range(0, len(text), 80):
        excerpt = text[start:start + 240]
        if contains_identity(excerpt, *parts):
            return excerpt
    return None


def _snapshot_dir(connection: sqlite3.Connection) -> Path:
    database = next((str(row[2]) for row in connection.execute("PRAGMA database_list") if row[1] == "main"), "")
    if not database:
        raise ValueError("snapshot_store_required")
    return Path(database).parent / "snapshots"


def _reject_reparse_ancestors(path: Path) -> None:
    current = path.absolute()
    chain = [current, *current.parents]
    for candidate in chain:
        try:
            info = candidate.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or (
            getattr(info, "st_file_attributes", 0)
            & getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0)
        ):
            raise ValueError("unsafe_source_path")


def _bounded_regular_read(path: Path, expected: tuple[int, int] | None = None) -> bytes:
    _reject_reparse_ancestors(path)
    try:
        before = path.lstat()
        if stat.S_ISLNK(before.st_mode) or not stat.S_ISREG(before.st_mode) or before.st_nlink != 1:
            raise ValueError
        if expected is not None and expected != (before.st_dev, before.st_ino):
            raise ValueError
        flags = os.O_RDONLY | getattr(os, "O_BINARY", 0) | getattr(os, "O_NOFOLLOW", 0)
        with os.fdopen(os.open(path, flags), "rb") as handle:
            opened = os.fstat(handle.fileno())
            if (
                not stat.S_ISREG(opened.st_mode) or opened.st_nlink != 1
                or (before.st_dev, before.st_ino) != (opened.st_dev, opened.st_ino)
            ):
                raise ValueError
            value = handle.read(MAX_SOURCE_BYTES + 1)
            after = os.fstat(handle.fileno())
        named = path.lstat()
        if (
            (opened.st_dev, opened.st_ino) != (named.st_dev, named.st_ino)
            or opened.st_size != after.st_size or opened.st_mtime_ns != after.st_mtime_ns
            or after.st_size != named.st_size or after.st_mtime_ns != named.st_mtime_ns
        ):
            raise ValueError
        if len(value) > MAX_SOURCE_BYTES or after.st_size != len(value):
            raise ValueError
        return value
    except (OSError, ValueError):
        raise ValueError("unsafe_source_path") from None


def read_operator_page(folder: Path, person_id: str) -> bytes | None:
    """Read only the expected bounded regular file from the selected import directory."""
    try:
        root = folder.resolve(strict=True)
        candidate = (folder / f"{person_id}.txt").resolve(strict=True)
        if candidate.parent != root:
            raise ValueError
        _reject_reparse_ancestors(folder)
        _reject_reparse_ancestors(folder / f"{person_id}.txt")
        return _bounded_regular_read(candidate)
    except FileNotFoundError:
        return None
    except (OSError, ValueError):
        raise ValueError("operator_source_invalid") from None


def _owned_snapshot_usage(connection: sqlite3.Connection, folder: Path) -> tuple[int, int]:
    rows = connection.execute(
        """SELECT body_ref,content_sha256 FROM source_snapshot
             WHERE allowlist_version='operator-local-v1' ORDER BY snapshot_id""",
    ).fetchall()
    seen: set[str] = set()
    total = 0
    try:
        for row in rows:
            body_ref = str(row["body_ref"])
            if (
                Path(body_ref).name != body_ref or any(c in body_ref for c in "/\\")
                or body_ref in seen
            ):
                raise ValueError
            seen.add(body_ref)
            body = _bounded_regular_read(folder / body_ref)
            if sha256(body).hexdigest() != str(row["content_sha256"]):
                raise ValueError
            total += len(body)
    except (OSError, ValueError):
        raise ValueError("operator_source_store_invalid") from None
    return len(rows), total


def import_operator_page(
    connection: sqlite3.Connection, *, person_id: str, company_id: str,
    source_url: str, body: bytes, now: datetime,
) -> str:
    """Copy an operator-provided page into the selected store's snapshot boundary."""
    parsed_url = urlsplit(source_url)
    if (
        len(body) > MAX_SOURCE_BYTES or len(source_url.encode("utf-8")) > 2048
        or parsed_url.scheme != "https" or not parsed_url.hostname
        or parsed_url.username is not None or parsed_url.password is not None
        or any(character in source_url for character in "\r\n\x00")
    ):
        raise ValueError("operator_source_invalid")
    if now.tzinfo is None:
        raise ValueError("aware_now_required")
    snapshot_id = "snap_" + uuid.uuid4().hex
    observation_id = "obs_" + uuid.uuid4().hex
    body_ref = f"{snapshot_id}.body"
    folder = _snapshot_dir(connection)
    _reject_reparse_ancestors(folder.parent)
    folder.mkdir(parents=True, exist_ok=True)
    _reject_reparse_ancestors(folder)
    folder_info = folder.lstat()
    folder_identity = (folder_info.st_dev, folder_info.st_ino)
    if connection.in_transaction:
        raise ValueError("operator_source_transaction_active")
    try:
        connection.execute("BEGIN IMMEDIATE")
    except sqlite3.Error:
        raise ValueError("operator_source_busy") from None
    staged, final = folder / f".{snapshot_id}.tmp", folder / body_ref
    staged_identity: tuple[int, int] | None = None
    final_identity: tuple[int, int] | None = None
    try:
        owned_count, owned_bytes = _owned_snapshot_usage(connection, folder)
        identity = connection.execute(
            """SELECT p.full_name,c.name,e.title FROM person AS p
                 JOIN employment AS e ON e.person_id=p.person_id AND e.valid_to IS NULL
                 JOIN company AS c ON c.company_id=e.company_id
                WHERE p.person_id=? AND c.company_id=?""", (person_id, company_id),
        ).fetchall()
        if len(identity) != 1:
            raise ValueError("evidence_identity_missing")
        stamp = now.astimezone(timezone.utc).isoformat()
        expires = (now.astimezone(timezone.utc) + timedelta(days=30)).isoformat()
        digest = sha256(body).hexdigest()
        text = body.decode("utf-8", errors="replace")
        row = identity[0]
        excerpt = identity_excerpt(
            text, str(row["full_name"]), str(row["name"]), str(row["title"]),
        )
        matches = connection.execute(
            """SELECT snapshot.snapshot_id,snapshot.expires_at,observation.value
                 FROM source_snapshot AS snapshot
                 JOIN source_observation AS observation
                   ON observation.snapshot_id=snapshot.snapshot_id
                 WHERE snapshot.entity_id=? AND snapshot.source_url=?
                   AND snapshot.content_sha256=? AND snapshot.allowlist_version='operator-local-v1'
                   AND observation.entity_type='person' AND observation.entity_id=?
                   AND observation.field='source_review_candidate'
                 ORDER BY snapshot.retrieved_at DESC,snapshot.snapshot_id DESC""",
            (person_id, source_url, digest, person_id),
        ).fetchall()
        for match in matches:
            try:
                candidate = json.loads(str(match["value"]))
                if candidate != {"excerpt": excerpt}:
                    continue
                expiry = datetime.fromisoformat(str(match["expires_at"]).replace("Z", "+00:00"))
                if (
                    expiry.tzinfo is not None
                    and expiry.astimezone(timezone.utc) >= now.astimezone(timezone.utc)
                ):
                    connection.commit()
                    return str(match["snapshot_id"])
            except ValueError:
                continue
        if (
            owned_count >= MAX_OPERATOR_SNAPSHOTS
            or owned_bytes + len(body) > MAX_OPERATOR_SNAPSHOT_BYTES
        ):
            raise ValueError("operator_source_store_cap")
        flags = os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0)
        descriptor = os.open(staged, flags, 0o600)
        opened_staged = os.fstat(descriptor)
        staged_identity = (opened_staged.st_dev, opened_staged.st_ino)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
            written = os.fstat(handle.fileno())
            if not stat.S_ISREG(written.st_mode) or written.st_nlink != 1 or written.st_size != len(body):
                raise ValueError("operator_source_invalid")
            if staged_identity != (written.st_dev, written.st_ino):
                raise ValueError("operator_source_invalid")
        current_folder = folder.lstat()
        if folder_identity != (current_folder.st_dev, current_folder.st_ino):
            raise ValueError("operator_source_invalid")
        connection.execute("SAVEPOINT operator_source")
        connection.execute(
            """INSERT INTO source_snapshot(snapshot_id,entity_id,source_url,source_domain,retrieved_at,
                   content_type,content_sha256,allowlist_version,body_ref,expires_at,retention_delete_at)
               VALUES(?,?,?,?,?,?,?,?,?,?,?)""",
            (snapshot_id, person_id, source_url, parsed_url.hostname, stamp,
             "text/html", digest, "operator-local-v1", body_ref, expires, expires),
        )
        if excerpt is not None:
            connection.execute(
                """INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,
                       source,seen_at,retrieved_at,confidence,snapshot_id)
                   VALUES(?,?,?,?,?,?,?,?,?,?)""",
                (observation_id, "person", person_id, "source_review_candidate",
                 json.dumps({"excerpt": excerpt}, sort_keys=True, separators=(",", ":")),
                 snapshot_id, stamp, stamp, 1.0, snapshot_id),
            )
        _reject_reparse_ancestors(staged)
        current_folder = folder.lstat()
        if folder_identity != (current_folder.st_dev, current_folder.st_ino):
            raise ValueError("operator_source_invalid")
        os.link(staged, final)
        linked = final.lstat()
        final_identity = (linked.st_dev, linked.st_ino)
        if staged_identity != (linked.st_dev, linked.st_ino) or linked.st_nlink != 2:
            raise ValueError("operator_source_invalid")
        staged.unlink()
        connection.execute("RELEASE SAVEPOINT operator_source")
        connection.commit()
    except BaseException:
        try:
            connection.execute("ROLLBACK TO SAVEPOINT operator_source")
            connection.execute("RELEASE SAVEPOINT operator_source")
        except sqlite3.Error:
            pass
        for path, identity in ((staged, staged_identity), (final, final_identity)):
            if identity is None:
                continue
            try:
                found = path.lstat()
                if (found.st_dev, found.st_ino) == identity:
                    path.unlink()
            except FileNotFoundError:
                pass
        connection.rollback()
        raise
    return snapshot_id


@dataclass(frozen=True)
class SnapshotProof:
    snapshot_id: str
    body_ref: str
    content_sha256: str
    expires_at: str
    excerpt: str


def verify_snapshot(root: Path, proof: SnapshotProof, *, now: datetime) -> None:
    """Fail closed unless the displayed excerpt is present in the authentic local snapshot."""
    if now.tzinfo is None:
        raise ValueError("source_verification_failed")
    try:
        expires = datetime.fromisoformat(proof.expires_at.replace("Z", "+00:00"))
        if expires.tzinfo is None or expires.astimezone(timezone.utc) < now.astimezone(timezone.utc):
            raise ValueError
        if Path(proof.body_ref).name != proof.body_ref or any(c in proof.body_ref for c in "/\\"):
            raise ValueError
        original = root / proof.body_ref
        _reject_reparse_ancestors(root)
        _reject_reparse_ancestors(original)
        root_before = root.lstat()
        original_before = original.lstat()
        resolved_root = root.resolve(strict=True)
        resolved = original.resolve(strict=True)
        if resolved.parent != resolved_root:
            raise ValueError
        body = _bounded_regular_read(
            original, expected=(original_before.st_dev, original_before.st_ino),
        )
        root_after = root.lstat()
        if (root_before.st_dev, root_before.st_ino) != (root_after.st_dev, root_after.st_ino):
            raise ValueError
        if sha256(body).hexdigest() != proof.content_sha256:
            raise ValueError
        if normalized(proof.excerpt) not in normalized(plain_text(body.decode("utf-8", errors="replace"))):
            raise ValueError
    except (OSError, UnicodeError, ValueError):
        raise ValueError("source_verification_failed") from None

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import sha256
import json
import os
from pathlib import Path
import uuid

import pytest

from scripts.prospecting.affinity import source_review
from scripts.prospecting.affinity.source_review import (
    SnapshotProof, identity_excerpt, import_operator_page, verify_snapshot,
)
from scripts.prospecting.store import open_store


FIXTURE = json.loads(
    (Path(__file__).parents[3] / "orgs" / "prospecting" / "fixtures" / "source-review-synthetic.json")
    .read_text(encoding="utf-8")
)
NOW = datetime(2026, 9, 9, 12, tzinfo=timezone.utc)


def _seed(path: Path):
    connection = open_store(path)
    connection.execute(
        "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
        ("company-source", FIXTURE["company"], "manual", "company-source"),
    )
    connection.execute(
        "INSERT INTO person(person_id,first_name,full_name,linkedin_url,source_lane,dedupe_key) VALUES(?,?,?,?,?,?)",
        ("person-source", FIXTURE["first_name"], FIXTURE["full_name"], FIXTURE["operator_profile_url"],
         "manual", "person-source"),
    )
    connection.execute(
        "INSERT INTO source_observation(observation_id,entity_type,entity_id,field,value,source,retrieved_at,confidence) VALUES(?,?,?,?,?,?,?,?)",
        ("observation-prior", "employment", "person-source", "seed", "{}", "manual",
         NOW.isoformat(), 1.0),
    )
    connection.execute(
        "INSERT INTO employment(employment_id,person_id,company_id,title,source_observation_id,confidence) VALUES(?,?,?,?,?,?)",
        ("employment-source", "person-source", "company-source", FIXTURE["title"],
         "observation-prior", 1.0),
    )
    connection.commit()
    return connection


def test_visible_excerpt_ignores_hidden_document_content() -> None:
    hidden = f"<script>{FIXTURE['identity_excerpt']}</script><p>Visible unrelated text</p>"
    assert identity_excerpt(hidden, FIXTURE["full_name"], FIXTURE["company"], FIXTURE["title"]) is None
    assert identity_excerpt(FIXTURE["identity_excerpt"], FIXTURE["full_name"],
                            FIXTURE["company"], FIXTURE["title"]) == FIXTURE["identity_excerpt"]


def test_snapshot_verification_rejects_hardlinks_and_tampering(tmp_path: Path) -> None:
    root = tmp_path / "snapshots"
    root.mkdir()
    body = FIXTURE["identity_excerpt"].encode()
    target = root / "source.body"
    target.write_bytes(body)
    proof = SnapshotProof("snapshot-source", target.name, sha256(body).hexdigest(),
                          "2099-01-01T00:00:00Z", FIXTURE["identity_excerpt"])
    verify_snapshot(root, proof, now=NOW)
    linked = root / "linked.body"
    os.link(target, linked)
    with pytest.raises(ValueError, match="source_verification_failed"):
        verify_snapshot(root, proof, now=NOW)
    linked.unlink()
    target.write_bytes(body + b" changed")
    with pytest.raises(ValueError, match="source_verification_failed"):
        verify_snapshot(root, proof, now=NOW)


def test_bounded_read_rejects_a_leaf_swapped_between_lstat_and_open(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch,
) -> None:
    target = tmp_path / "source.body"
    replacement = tmp_path / "replacement.body"
    target.write_bytes(FIXTURE["identity_excerpt"].encode())
    replacement.write_bytes(b"replacement")
    real_open = source_review.os.open
    swapped = False

    def swapping_open(path, flags, *args):
        nonlocal swapped
        if not swapped and Path(path) == target:
            swapped = True
            os.replace(replacement, target)
        return real_open(path, flags, *args)

    monkeypatch.setattr(source_review.os, "open", swapping_open)
    with pytest.raises(ValueError, match="unsafe_source_path"):
        source_review._bounded_regular_read(target)


def test_import_never_replaces_or_deletes_an_existing_target(tmp_path: Path, monkeypatch) -> None:
    connection = _seed(tmp_path / "store.sqlite")
    fixed = uuid.UUID(int=17)
    monkeypatch.setattr(source_review.uuid, "uuid4", lambda: fixed)
    folder = tmp_path / "snapshots"
    folder.mkdir()
    target = folder / f"snap_{fixed.hex}.body"
    target.write_bytes(b"preexisting")
    with pytest.raises(FileExistsError):
        import_operator_page(
            connection, person_id="person-source", company_id="company-source",
            source_url=FIXTURE["source_url"], body=FIXTURE["identity_excerpt"].encode(), now=NOW,
        )
    assert target.read_bytes() == b"preexisting"
    assert connection.execute(
        "SELECT count(*) FROM source_snapshot WHERE snapshot_id=?", (f"snap_{fixed.hex}",)
    ).fetchone()[0] == 0


def test_import_cleans_its_exclusive_staging_file_when_write_fails(tmp_path: Path, monkeypatch) -> None:
    connection = _seed(tmp_path / "store.sqlite")
    monkeypatch.setattr(
        source_review.os, "fsync",
        lambda _descriptor: (_ for _ in ()).throw(OSError("synthetic write failure")),
    )
    with pytest.raises(OSError, match="synthetic write failure"):
        import_operator_page(
            connection, person_id="person-source", company_id="company-source",
            source_url=FIXTURE["source_url"], body=FIXTURE["identity_excerpt"].encode(), now=NOW,
        )
    assert list((tmp_path / "snapshots").iterdir()) == []
    assert connection.execute(
        "SELECT count(*) FROM source_snapshot WHERE allowlist_version='operator-local-v1'"
    ).fetchone()[0] == 0
    assert not connection.in_transaction


def test_failure_after_reservation_rolls_back_and_next_import_succeeds(tmp_path: Path, monkeypatch) -> None:
    connection = _seed(tmp_path / "store.sqlite")
    real_excerpt = source_review.identity_excerpt
    monkeypatch.setattr(
        source_review, "identity_excerpt",
        lambda *_args: (_ for _ in ()).throw(ValueError("synthetic parse failure")),
    )
    with pytest.raises(ValueError, match="synthetic parse failure"):
        import_operator_page(
            connection, person_id="person-source", company_id="company-source",
            source_url=FIXTURE["source_url"], body=FIXTURE["identity_excerpt"].encode(), now=NOW,
        )
    assert not connection.in_transaction
    assert list((tmp_path / "snapshots").iterdir()) == []
    monkeypatch.setattr(source_review, "identity_excerpt", real_excerpt)
    snapshot_id = import_operator_page(
        connection, person_id="person-source", company_id="company-source",
        source_url=FIXTURE["source_url"], body=FIXTURE["identity_excerpt"].encode(), now=NOW,
    )
    assert connection.execute(
        "SELECT count(*) FROM source_snapshot WHERE snapshot_id=?", (snapshot_id,),
    ).fetchone()[0] == 1


def test_operator_store_cap_is_reserved_across_connections(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "store.sqlite"
    first = _seed(path)
    second = open_store(path)
    second.execute("PRAGMA busy_timeout=1")
    monkeypatch.setattr(source_review, "MAX_OPERATOR_SNAPSHOTS", 1)
    real_usage = source_review._owned_snapshot_usage
    interleaved = False

    def check_usage(connection, folder):
        nonlocal interleaved
        if connection is first and not interleaved:
            interleaved = True
            with pytest.raises(ValueError, match="operator_source_busy"):
                import_operator_page(
                    second, person_id="person-source", company_id="company-source",
                    source_url=FIXTURE["source_url"],
                    body=FIXTURE["identity_excerpt"].encode(), now=NOW,
                )
        return real_usage(connection, folder)

    monkeypatch.setattr(source_review, "_owned_snapshot_usage", check_usage)
    import_operator_page(
        first, person_id="person-source", company_id="company-source",
        source_url=FIXTURE["source_url"], body=FIXTURE["identity_excerpt"].encode(), now=NOW,
    )
    with pytest.raises(ValueError, match="operator_source_store_cap"):
        import_operator_page(
            second, person_id="person-source", company_id="company-source",
            source_url=FIXTURE["source_url"],
            body=FIXTURE["identity_excerpt"].encode() + b" second capture", now=NOW,
        )
    assert len(list((tmp_path / "snapshots").glob("*.body"))) == 1
    assert second.execute(
        "SELECT count(*) FROM source_snapshot WHERE allowlist_version='operator-local-v1'"
    ).fetchone()[0] == 1


def test_exact_retry_reuses_owned_snapshot_and_distinct_imports_survive_reopen(tmp_path: Path) -> None:
    path = tmp_path / "store.sqlite"
    connection = _seed(path)
    first = import_operator_page(
        connection, person_id="person-source", company_id="company-source",
        source_url=FIXTURE["source_url"], body=FIXTURE["identity_excerpt"].encode(), now=NOW,
    )
    assert not connection.in_transaction
    retry = import_operator_page(
        connection, person_id="person-source", company_id="company-source",
        source_url=FIXTURE["source_url"], body=FIXTURE["identity_excerpt"].encode(), now=NOW,
    )
    assert retry == first and not connection.in_transaction
    second = import_operator_page(
        connection, person_id="person-source", company_id="company-source",
        source_url=FIXTURE["source_url"] + "?capture=2",
        body=FIXTURE["identity_excerpt"].encode(), now=NOW,
    )
    assert second != first and not connection.in_transaction
    connection.close()
    reopened = open_store(path)
    rows = reopened.execute(
        "SELECT snapshot_id FROM source_snapshot WHERE allowlist_version='operator-local-v1'"
    ).fetchall()
    assert {row["snapshot_id"] for row in rows} == {first, second}
    assert len(list((tmp_path / "snapshots").glob("*.body"))) == 2


def test_same_page_after_current_role_change_creates_current_candidate(tmp_path: Path) -> None:
    connection = _seed(tmp_path / "store.sqlite")
    text = (
        FIXTURE["identity_excerpt"] + " " + ("Background detail. " * 20)
        + FIXTURE["second_identity_excerpt"]
    )
    body = text.encode()
    first = import_operator_page(
        connection, person_id="person-source", company_id="company-source",
        source_url=FIXTURE["source_url"], body=body, now=NOW,
    )
    connection.execute(
        "INSERT INTO company(company_id,name,source_lane,dedupe_key) VALUES(?,?,?,?)",
        ("company-second", FIXTURE["second_company"], "manual", "company-second"),
    )
    connection.execute(
        "UPDATE employment SET company_id=?,title=? WHERE employment_id=?",
        ("company-second", FIXTURE["second_title"], "employment-source"),
    )
    connection.commit()

    second = import_operator_page(
        connection, person_id="person-source", company_id="company-second",
        source_url=FIXTURE["source_url"], body=body, now=NOW,
    )
    retry = import_operator_page(
        connection, person_id="person-source", company_id="company-second",
        source_url=FIXTURE["source_url"], body=body, now=NOW,
    )

    assert second != first and retry == second
    candidates = {
        row["snapshot_id"]: json.loads(row["value"])["excerpt"]
        for row in connection.execute(
            "SELECT snapshot_id,value FROM source_observation "
            "WHERE field='source_review_candidate'"
        )
    }
    assert set(candidates) == {first, second}
    assert identity_excerpt(
        candidates[second], FIXTURE["full_name"],
        FIXTURE["second_company"], FIXTURE["second_title"],
    ) is not None


def test_expired_exact_content_creates_fresh_provenance(tmp_path: Path) -> None:
    path = tmp_path / "store.sqlite"
    connection = _seed(path)
    first = import_operator_page(
        connection, person_id="person-source", company_id="company-source",
        source_url=FIXTURE["source_url"], body=FIXTURE["identity_excerpt"].encode(), now=NOW,
    )
    second = import_operator_page(
        connection, person_id="person-source", company_id="company-source",
        source_url=FIXTURE["source_url"], body=FIXTURE["identity_excerpt"].encode(),
        now=NOW + timedelta(days=31),
    )
    assert second != first
    expiries = dict(connection.execute(
        "SELECT snapshot_id,expires_at FROM source_snapshot WHERE snapshot_id IN (?,?)", (first, second),
    ))
    assert datetime.fromisoformat(expiries[first]) < datetime.fromisoformat(expiries[second])

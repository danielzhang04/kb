from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
import os
import shutil
import sqlite3

import pytest

from scripts.prospecting.control_protocol import ControlRequest, ControlResult, encode_request, encode_result
from scripts.prospecting.control_spool import ControlSpool, SpoolError

NOW = datetime(2099, 1, 1, 12, tzinfo=timezone.utc)
LEASE = "lease_" + "1" * 32
OWNER_A = "desk_" + "2" * 32
OWNER_B = "desk_" + "3" * 32


def request(control: str = "4", *, request_digit: str = "5") -> ControlRequest:
    return ControlRequest(
        1, "ctlreq_" + request_digit * 32, "ctl_" + control * 32, "status",
        "2099-01-01T12:00:00Z", "2099-01-01T13:00:00Z",
    )


def spool(tmp_path) -> ControlSpool:
    item = ControlSpool(tmp_path / "runtime", LEASE)
    item.initialize(NOW + timedelta(hours=2), now=NOW)
    return item


def test_spool_claim_complete_and_identical_retries(tmp_path) -> None:
    item = spool(tmp_path)
    raw = encode_request(request())
    assert item.enqueue(raw) == request().request_id
    assert item.enqueue(raw) == request().request_id
    assert item.claim_next(OWNER_A, now=NOW) == raw
    assert item.claim_next(OWNER_B, now=NOW) is None
    result = ControlResult(1, request().request_id, request().digest, "succeeded", "status", {"due": 0})
    item.complete(OWNER_A, encode_result(result), now=NOW)
    item.complete(OWNER_A, encode_result(result), now=NOW)
    assert item.result(request().request_id) == encode_result(result)


def test_spool_rejects_changed_request_at_same_id(tmp_path) -> None:
    item = spool(tmp_path)
    item.enqueue(encode_request(request()))
    with pytest.raises(SpoolError, match="^request_conflict$"):
        item.enqueue(encode_request(request("6")))


def test_request_cannot_outlive_ephemeral_lease(tmp_path) -> None:
    item = ControlSpool(tmp_path / "runtime", LEASE)
    item.initialize(NOW + timedelta(minutes=30), now=NOW)
    with pytest.raises(SpoolError, match="^request_outlives_lease$"):
        item.enqueue(encode_request(request()))


def test_expired_claim_is_recovered_by_another_owner(tmp_path) -> None:
    item = spool(tmp_path)
    raw = encode_request(request())
    item.enqueue(raw)
    assert item.claim_next(OWNER_A, now=NOW, lease_seconds=1) == raw
    assert item.claim_next(OWNER_B, now=NOW + timedelta(seconds=2)) == raw


def test_bound_claim_recovers_only_the_selected_matching_request(tmp_path) -> None:
    item = spool(tmp_path)
    neighbor = request("6", request_digit="6")
    selected = request()
    item.enqueue(encode_request(neighbor))
    item.enqueue(encode_request(selected))
    assert item.claim_next(
        OWNER_A,
        now=NOW,
        lease_seconds=1,
        request_id=neighbor.request_id,
        control_ref=neighbor.control_ref,
        operation=neighbor.operation,
    ) == encode_request(neighbor)

    with pytest.raises(SpoolError, match="^claim_selector_mismatch$"):
        item.claim_next(
            OWNER_B,
            now=NOW + timedelta(seconds=2),
            request_id=selected.request_id,
            control_ref=neighbor.control_ref,
            operation=selected.operation,
        )
    assert item.claim_next(
        OWNER_B,
        now=NOW + timedelta(seconds=2),
        request_id=selected.request_id,
        control_ref=selected.control_ref,
        operation=selected.operation,
    ) == encode_request(selected)

    connection = sqlite3.connect(item.database)
    rows = connection.execute(
        "SELECT request_id,state,owner_id FROM request ORDER BY request_id"
    ).fetchall()
    connection.close()
    assert rows == [
        (selected.request_id, "claimed", OWNER_B),
        (neighbor.request_id, "claimed", OWNER_A),
    ]


def test_concurrent_claimers_serialize_to_one_owner(tmp_path) -> None:
    item = spool(tmp_path)
    raw = encode_request(request())
    item.enqueue(raw)

    def claim(owner: str):
        return ControlSpool(item.base, LEASE).claim_next(owner, now=NOW)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(claim, (OWNER_A, OWNER_B)))
    assert results.count(raw) == 1
    assert results.count(None) == 1


def test_result_must_match_claim_owner_and_request_hash(tmp_path) -> None:
    item = spool(tmp_path)
    item.enqueue(encode_request(request()))
    item.claim_next(OWNER_A, now=NOW)
    result = ControlResult(1, request().request_id, request().digest, "failed", "control_failed", {})
    with pytest.raises(SpoolError, match="^claim_owner_mismatch$"):
        item.complete(OWNER_B, encode_result(result), now=NOW)
    result = ControlResult(1, request().request_id, "a" * 64, "failed", "control_failed", {})
    with pytest.raises(SpoolError, match="^result_binding_mismatch$"):
        item.complete(OWNER_A, encode_result(result), now=NOW)


def test_expired_claim_cannot_complete_until_reclaimed(tmp_path) -> None:
    item = spool(tmp_path)
    raw = encode_request(request())
    item.enqueue(raw)
    item.claim_next(OWNER_A, now=NOW, lease_seconds=1)
    result = ControlResult(1, request().request_id, request().digest, "succeeded", "status", {})
    with pytest.raises(SpoolError, match="^claim_expired$"):
        item.complete(OWNER_A, encode_result(result), now=NOW + timedelta(seconds=2))
    assert item.claim_next(OWNER_B, now=NOW + timedelta(seconds=2)) == raw
    item.complete(OWNER_B, encode_result(result), now=NOW + timedelta(seconds=2))


def test_misplaced_database_refuses_operations_and_cleanup(tmp_path) -> None:
    original = spool(tmp_path)
    other_lease = "lease_" + "9" * 32
    other_root = original.base / other_lease
    other_root.mkdir()
    shutil.copy2(original.database, other_root / "spool.sqlite")
    misplaced = ControlSpool(original.base, other_lease)
    with pytest.raises(SpoolError, match="^spool_metadata_invalid$"):
        misplaced.result(request().request_id)
    with pytest.raises(SpoolError, match="^spool_metadata_invalid$"):
        misplaced.cleanup_expired(now=NOW + timedelta(hours=3))
    assert other_root.exists()


def test_cleanup_refuses_multiple_lease_rows(tmp_path) -> None:
    item = spool(tmp_path)
    connection = sqlite3.connect(item.database)
    try:
        connection.execute(
            "INSERT INTO lease VALUES(?,?,'active')",
            ("lease_" + "8" * 32, "2099-01-01T14:00:00Z"),
        )
        connection.commit()
    finally:
        connection.close()
    with pytest.raises(SpoolError, match="^spool_metadata_invalid$"):
        item.cleanup_expired(now=NOW + timedelta(hours=3))
    assert item.root.exists()


def test_unexpected_and_linked_entries_fail_closed(tmp_path) -> None:
    item = spool(tmp_path)
    (item.root / "unexpected.txt").write_text("x", encoding="utf-8")
    with pytest.raises(SpoolError, match="^spool_entry_unexpected$"):
        item.claim_next(OWNER_A, now=NOW)


def test_hardlinked_entry_is_rejected_when_supported(tmp_path) -> None:
    item = spool(tmp_path)
    linked = tmp_path / "linked.json"
    try:
        os.link(item.database, linked)
    except OSError:
        pytest.skip("hardlinks unavailable")
    with pytest.raises(SpoolError, match="^spool_file_unsafe$"):
        item.claim_next(OWNER_A, now=NOW)


def test_expired_lease_cleanup_removes_only_owned_regular_files(tmp_path) -> None:
    item = spool(tmp_path)
    item.enqueue(encode_request(request()))
    assert item.cleanup_expired(now=NOW + timedelta(minutes=1)) == 0
    assert item.cleanup_expired(now=NOW + timedelta(hours=2)) >= 1
    assert not item.root.exists()
    assert item.base.exists()


def test_symlinked_lease_root_is_rejected_when_supported(tmp_path) -> None:
    target = tmp_path / "target"
    target.mkdir()
    base = tmp_path / "runtime"
    base.mkdir()
    root = base / LEASE
    try:
        root.symlink_to(target, target_is_directory=True)
    except OSError:
        pytest.skip("directory symlinks unavailable")
    with pytest.raises(SpoolError, match="^spool_root_unsafe$"):
        ControlSpool(base, LEASE).initialize(NOW + timedelta(hours=1), now=NOW)

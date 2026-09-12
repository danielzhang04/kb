from __future__ import annotations

from datetime import timedelta
import sqlite3

import pytest

from scripts.prospecting.control_desktop import (
    ControlError,
    DesktopControl,
    create_disabled_grant,
    set_grant_state,
)
from scripts.prospecting.control_protocol import (
    ControlRequest,
    encode_request,
    encode_result,
)
from scripts.prospecting.control_review import (
    ControlReviewAdapter,
    ControlReviewConfig,
    ControlReviewError,
)
from scripts.prospecting.control_spool import ControlSpool, SpoolError
from scripts.prospecting.tests.p6_support import migrated_t1_store


CAMPAIGN = "camp_0000000000000001"
OTHER_CAMPAIGN = "camp_0000000000000002"
CONTROL_REF = "ctl_" + "1" * 32
REQUEST_ID = "ctlreq_" + "4" * 32
OWNER = "desk_" + "2" * 32
LEASE = "lease_" + "3" * 32


def _request(now, *, request_id: str = REQUEST_ID, control_ref: str = CONTROL_REF):
    return ControlRequest(
        1,
        request_id,
        control_ref,
        "status",
        now.isoformat().replace("+00:00", "Z"),
        (now + timedelta(hours=1)).isoformat().replace("+00:00", "Z"),
    )


class Transport:
    def __init__(self, raw: bytes | None, *, fail_complete: bool = False):
        self.raw = raw
        self.fail_complete = fail_complete
        self.claims: list[dict[str, str]] = []
        self.completed = []

    def claim_next(self, **selector):
        self.claims.append(selector)
        raw, self.raw = self.raw, None
        return raw

    def complete(self, result):
        if self.fail_complete:
            self.fail_complete = False
            raise ControlError("transport_failed")
        self.completed.append(result)


def _adapter(tmp_path, *, transport=None, grant_hours: int = 2):
    fixture = migrated_t1_store(tmp_path / "store.sqlite", tier="T0")
    create_disabled_grant(
        fixture.connection,
        control_ref=CONTROL_REF,
        campaign_id=CAMPAIGN,
        operation="status",
        expires_at=fixture.now + timedelta(hours=grant_hours),
        now=fixture.now,
    )
    set_grant_state(fixture.connection, CONTROL_REF, "active")
    control = DesktopControl(fixture.connection, OWNER, now=lambda: fixture.now)
    item = _request(fixture.now)
    selected_transport = transport or Transport(encode_request(item))
    adapter = ControlReviewAdapter(
        fixture.connection,
        ControlReviewConfig(
            CAMPAIGN,
            CONTROL_REF,
            "status",
            item.request_id,
            control,
            selected_transport,
        ),
    )
    return fixture, control, selected_transport, adapter, item


def _clone_campaign(connection: sqlite3.Connection) -> None:
    columns = [row[1] for row in connection.execute("PRAGMA table_info(campaign)")]
    values = list(
        connection.execute(
            "SELECT * FROM campaign WHERE campaign_id=?", (CAMPAIGN,)
        ).fetchone()
    )
    values[columns.index("campaign_id")] = OTHER_CAMPAIGN
    connection.execute(
        f"INSERT INTO campaign({','.join(columns)}) VALUES({','.join('?' for _ in columns)})",
        values,
    )


def test_absent_config_is_disabled_and_cannot_process(tmp_path) -> None:
    fixture = migrated_t1_store(tmp_path / "store.sqlite", tier="T0")
    adapter = ControlReviewAdapter(fixture.connection)

    status = adapter.status("campaign-a")

    assert status.enabled is False
    assert status.code == "disabled"
    assert status.configured_request_id is None
    assert status.counts == {}
    with pytest.raises(ControlReviewError, match="^control_unavailable$"):
        adapter.process(CAMPAIGN, REQUEST_ID)


def test_status_exposes_only_configured_opaque_binding_and_counts(tmp_path) -> None:
    _fixture, _control, _transport, adapter, item = _adapter(tmp_path)

    before = adapter.status(CAMPAIGN)
    after = adapter.process(CAMPAIGN, item.request_id)

    assert (
        before.enabled,
        before.configured_request_id,
        before.control_ref,
        before.operation,
        before.code,
    ) == (True, item.request_id, CONTROL_REF, "status", "ready")
    assert after.receipt_state == "succeeded"
    assert after.code == "status"
    assert after.counts == {"due": 2, "paused": 0, "replied": 0}


def test_wrong_campaign_or_request_is_rejected_before_transport(tmp_path) -> None:
    fixture, _control, transport, adapter, _item = _adapter(tmp_path)
    _clone_campaign(fixture.connection)

    with pytest.raises(ControlReviewError, match="^control_campaign_mismatch$"):
        adapter.process(OTHER_CAMPAIGN, REQUEST_ID)
    with pytest.raises(ControlReviewError, match="^control_request_mismatch$"):
        adapter.process(CAMPAIGN, "ctlreq_" + "8" * 32)

    assert transport.claims == []
    assert adapter.status(OTHER_CAMPAIGN).code == "campaign_unavailable"
    assert fixture.connection.execute(
        "SELECT count(*) FROM remote_control_receipt"
    ).fetchone()[0] == 0


def test_expired_grant_blocks_before_claim_or_local_receipt(tmp_path) -> None:
    fixture, control, transport, adapter, item = _adapter(tmp_path, grant_hours=1)
    control.now = lambda: fixture.now + timedelta(hours=2)

    with pytest.raises(ControlReviewError, match="^grant_expired$"):
        adapter.process(CAMPAIGN, item.request_id)

    assert transport.claims == []
    assert fixture.connection.execute(
        "SELECT count(*) FROM remote_control_receipt"
    ).fetchone()[0] == 0


def test_missing_grant_is_visible_and_blocks_before_transport(tmp_path) -> None:
    fixture = migrated_t1_store(tmp_path / "store.sqlite", tier="T0")
    item = _request(fixture.now)
    transport = Transport(encode_request(item))
    control = DesktopControl(fixture.connection, OWNER, now=lambda: fixture.now)
    adapter = ControlReviewAdapter(
        fixture.connection,
        ControlReviewConfig(
            CAMPAIGN, CONTROL_REF, "status", item.request_id, control, transport
        ),
    )

    assert adapter.status(CAMPAIGN).code == "grant_missing"
    with pytest.raises(ControlReviewError, match="^grant_missing$"):
        adapter.process(CAMPAIGN, item.request_id)
    assert transport.claims == []


@pytest.mark.parametrize(
    "assignment,value",
    (("policy_hash", "f" * 64), ("approval_tier", "T1")),
)
def test_store_or_current_authorization_drift_blocks_new_effect_before_transport(
    tmp_path, assignment: str, value: str
) -> None:
    fixture, _control, transport, adapter, item = _adapter(tmp_path / "selected")
    other = migrated_t1_store(tmp_path / "other" / "store.sqlite", tier="T0")
    other_control = DesktopControl(other.connection, OWNER, now=lambda: other.now)

    with pytest.raises(ControlReviewError, match="^control_store_mismatch$"):
        ControlReviewAdapter(
            fixture.connection,
            ControlReviewConfig(
                CAMPAIGN,
                CONTROL_REF,
                "status",
                item.request_id,
                other_control,
                transport,
            ),
        )

    fixture.connection.execute(
        f"UPDATE campaign SET {assignment}=? WHERE campaign_id=?",
        (value, CAMPAIGN),
    )
    with pytest.raises(ControlReviewError, match="^control_binding_mismatch$"):
        adapter.process(CAMPAIGN, item.request_id)
    assert transport.claims == []


def test_lost_completion_ack_replays_terminal_receipt_without_execute(tmp_path) -> None:
    fixture, control, _unused, _adapter_value, item = _adapter(tmp_path)
    transport = Transport(encode_request(item), fail_complete=True)
    adapter = ControlReviewAdapter(
        fixture.connection,
        ControlReviewConfig(
            CAMPAIGN, CONTROL_REF, "status", item.request_id, control, transport
        ),
    )

    with pytest.raises(ControlError, match="^transport_failed$"):
        adapter.process(CAMPAIGN, item.request_id)
    retry = adapter.process(CAMPAIGN, item.request_id)

    assert retry.receipt_state == "succeeded"
    assert retry.code == "status"
    assert retry.remote_acknowledgement == "confirmed"
    assert len(transport.claims) == 1
    assert fixture.connection.execute(
        "SELECT count(*) FROM remote_control_receipt"
    ).fetchone()[0] == 1


def test_mixed_queue_processes_only_selected_and_leaves_expired_neighbor(
    tmp_path,
) -> None:
    fixture = migrated_t1_store(tmp_path / "store.sqlite", tier="T0")
    selected = _request(fixture.now)
    neighbor = _request(
        fixture.now,
        request_id="ctlreq_" + "3" * 32,
        control_ref="ctl_" + "9" * 32,
    )
    spool = ControlSpool(tmp_path / "runtime", LEASE)
    spool.initialize(fixture.now + timedelta(hours=2), now=fixture.now)
    spool.enqueue(encode_request(neighbor))
    spool.enqueue(encode_request(selected))
    neighbor_owner = "desk_" + "9" * 32
    assert spool.claim_next(
        neighbor_owner,
        now=fixture.now,
        lease_seconds=1,
        request_id=neighbor.request_id,
        control_ref=neighbor.control_ref,
        operation=neighbor.operation,
    ) == encode_request(neighbor)

    class SpoolTransport:
        def claim_next(self, **selector):
            return spool.claim_next(
                OWNER, now=fixture.now + timedelta(seconds=2), **selector
            )

        def complete(self, result):
            spool.complete(
                OWNER,
                encode_result(result),
                now=fixture.now + timedelta(seconds=2),
            )

    create_disabled_grant(
        fixture.connection,
        control_ref=CONTROL_REF,
        campaign_id=CAMPAIGN,
        operation="status",
        expires_at=fixture.now + timedelta(hours=2),
        now=fixture.now,
    )
    set_grant_state(fixture.connection, CONTROL_REF, "active")
    control = DesktopControl(
        fixture.connection, OWNER, now=lambda: fixture.now + timedelta(seconds=2)
    )
    adapter = ControlReviewAdapter(
        fixture.connection,
        ControlReviewConfig(
            CAMPAIGN,
            CONTROL_REF,
            "status",
            selected.request_id,
            control,
            SpoolTransport(),
        ),
    )

    result = adapter.process(CAMPAIGN, selected.request_id)

    assert result.receipt_state == "succeeded"
    database = sqlite3.connect(spool.database)
    rows = database.execute(
        "SELECT request_id,state,owner_id FROM request ORDER BY request_id"
    ).fetchall()
    database.close()
    assert rows == [
        (neighbor.request_id, "claimed", neighbor_owner),
        (selected.request_id, "complete", OWNER),
    ]


def test_expired_remote_claim_reconciles_stored_result_without_reexecution(
    tmp_path,
) -> None:
    fixture = migrated_t1_store(tmp_path / "store.sqlite", tier="T0")
    item = _request(fixture.now)
    spool = ControlSpool(tmp_path / "runtime", LEASE)
    spool.initialize(fixture.now + timedelta(hours=2), now=fixture.now)
    spool.enqueue(encode_request(item))
    clock = [fixture.now]

    class InterruptedTransport:
        claim_calls = 0
        complete_calls = 0
        interrupt = True

        def claim_next(self, **selector):
            self.claim_calls += 1
            return spool.claim_next(OWNER, now=clock[0], **selector)

        def complete(self, result):
            self.complete_calls += 1
            if self.interrupt:
                self.interrupt = False
                raise ControlError("transport_failed")
            try:
                spool.complete(OWNER, encode_result(result), now=clock[0])
            except SpoolError:
                raise ControlError("transport_failed") from None

    transport = InterruptedTransport()
    create_disabled_grant(
        fixture.connection,
        control_ref=CONTROL_REF,
        campaign_id=CAMPAIGN,
        operation="status",
        expires_at=fixture.now + timedelta(hours=2),
        now=fixture.now,
    )
    set_grant_state(fixture.connection, CONTROL_REF, "active")
    control = DesktopControl(fixture.connection, OWNER, now=lambda: clock[0])
    executions = [0]
    execute = control.execute

    def counted_execute(data):
        executions[0] += 1
        return execute(data)

    control.execute = counted_execute
    adapter = ControlReviewAdapter(
        fixture.connection,
        ControlReviewConfig(
            CAMPAIGN,
            CONTROL_REF,
            "status",
            item.request_id,
            control,
            transport,
        ),
    )

    with pytest.raises(ControlError, match="^transport_failed$"):
        adapter.process(CAMPAIGN, item.request_id)
    assert adapter.status(CAMPAIGN).remote_acknowledgement == "unverified"
    assert spool.result(item.request_id) is None
    fixture.connection.execute(
        "UPDATE campaign SET policy_hash=?,approval_tier=? WHERE campaign_id=?",
        ("f" * 64, "T1", CAMPAIGN),
    )
    clock[0] += timedelta(seconds=301)

    reconciled = adapter.process(CAMPAIGN, item.request_id)

    assert reconciled.remote_acknowledgement == "confirmed"
    assert executions == [1]
    assert transport.claim_calls == 2
    assert transport.complete_calls == 3
    assert spool.result(item.request_id) is not None

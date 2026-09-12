"""Temporary-only boundary stubs for Phase 6 approval tests."""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from contextlib import redirect_stdout
import hashlib
from io import StringIO
import json
from pathlib import Path
import sqlite3
from types import SimpleNamespace
import sys

import cards
import scripts.prospecting.approval.verify as approval_verify
from scripts.prospecting.approval.release_t1 import FenceUnavailable, attach_t1_send
from scripts.prospecting.campaigner.fake_gmail import ArrivalPoint, FakeGmail
from scripts.prospecting.executor import Executor
from scripts.prospecting.executor_campaigner import build_live_service
from scripts.prospecting.store import approval_scope_hash, open_store
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


_FIXTURES = Path(__file__).resolve().parents[3] / "orgs" / "prospecting" / "fixtures"
SYNTHETIC = legacy_fixture("p6_support")
NOW = datetime(2099, 6, 1, 12, tzinfo=timezone.utc)
_REASONS = {
    "valid": "valid",
    "expired": "expired",
    "replayed": "replayed",
    "wrong_credential": "wrong_credential",
}


@dataclass(frozen=True)
class TestApproval:
    card_ref: str
    approval_path: Path
    repo_root: Path
    expected_call: dict[str, object]
    calls: list[dict[str, object]]


class SendFakeGmail(FakeGmail):
    """Synthetic send backend that records T1 sends without a live adapter."""

    def __init__(self) -> None:
        super().__init__()
        self.send_count = 0
        self.fence_available = True
        self.arrive_before_send = False

    def history_fence(self) -> str:
        if not self.fence_available:
            raise FenceUnavailable("fence_unavailable")
        return str(self._next_history - 1)

    def messages_list(self, query: str):
        if query == "in:inbox":
            return tuple(
                message for thread in self._threads.values() for message in thread.messages
                if message.inbound
            )
        return super().messages_list(query)

    def inject_inbox_message(
        self,
        subject: str,
        headers: dict[str, str],
        body: str = "Synthetic mailbox notice",
    ):
        """Add an inbound warning or bounce to the mailbox-wide synthetic scan."""
        anchor = self.seed_outbound(
            "Synthetic mailbox anchor", f"<mailbox-{self._next_message}@fixture.test>"
        )
        self.queue_inbound(
            ArrivalPoint.BEFORE_REFRESH, anchor.thread_id, subject, headers, body
        )
        return self.arrive(ArrivalPoint.BEFORE_REFRESH)[0]

    def send(
        self, *, delivery_id: str, logical_key: str, rfc_message_id: str, history_id: str
    ):
        del delivery_id, logical_key
        if self.arrive_before_send:
            self.arrive_before_send = False
            self.arrive(ArrivalPoint.AFTER_CAS)
        if self.history_list(history_id):
            raise FenceUnavailable("fence_unavailable")
        existing = self.messages_list(f"rfc822msgid:{rfc_message_id}")
        if existing:
            return existing[0]
        self.send_count += 1
        return self.seed_outbound("Synthetic", rfc_message_id)


@dataclass(frozen=True)
class T1Store:
    connection: sqlite3.Connection
    d0_delivery_id: str
    followup_delivery_id: str
    now: datetime


def _freeze_sqlite_clock(connection: sqlite3.Connection, now: datetime) -> None:
    """Make executor validation use the fixture's injected logical time."""
    stamp = now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    connection.create_function("strftime", -1, lambda *_args: stamp)


def migrated_t1_store(path: Path, *, tier: str = "T1") -> T1Store:
    """Create one P6-approved D0 and one due P4 follow-up in a migrated store."""
    now = NOW
    connection = open_store(path)
    _freeze_sqlite_clock(connection, now)
    policy_hash = "a" * 64
    campaign_id = "camp_0000000000000001"
    mailbox_id = "pol_0000000000000001"
    person_id = "per_0000000000000001"
    contact_id = "cp_0000000000000001"
    enrollment_id = "enr_0000000000000001"
    d0_delivery_id = "req_0000000000000002"
    followup_delivery_id = "req_0000000000000003"
    start = (now - timedelta(minutes=1)).isoformat()
    end = (now + timedelta(hours=2)).isoformat()
    policy = {
        "approval_tier": "T0", "mailbox_id": mailbox_id, "timezone": "UTC",
        "send_window": "00:00-23:59", "daily_cap": 25, "hourly_cap": 6,
        "firm_collision_cap": 2,
    }
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        (mailbox_id, "Synthetic", None, "Synthetic", "Synthetic", "Synthetic", "[]"),
    )
    connection.execute(
        "INSERT INTO company VALUES(?,?,?,?,?,?,?,?,?)",
        ("cmp_0000000000000001", "Synthetic", "https://fixture.test", None, None, None, None, "manual", "synthetic-company"),
    )
    connection.execute(
        "INSERT INTO campaign VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (campaign_id, "networking", mailbox_id, json.dumps(policy), "relationship", 15,
         "warm", "fixture", "[]", "00:00-23:59", "UTC", 25, 6, 2, tier, mailbox_id,
         "{}", 0, "active", policy_hash),
    )
    connection.execute(
        "INSERT INTO person VALUES(?,?,?,?,?,?,?,?)",
        (person_id, "Synthetic", "Synthetic", None, None, None, "manual", "synthetic-person"),
    )
    connection.execute(
        "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("obs_0000000000000001", "employment", person_id, "source", '"fixture"', "fixture", None, now.isoformat(), 1.0, None),
    )
    connection.execute(
        "INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)",
        ("emp_0000000000000001", person_id, "cmp_0000000000000001", "Synthetic", None, None, "obs_0000000000000001", 1.0),
    )
    connection.execute(
        "INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (contact_id, person_id, "cmp_0000000000000001", SYNTHETIC["contact_email"], "manual", "fixture", None, None, "valid", 1.0, 0),
    )
    hashes = ("b" * 64, "c" * 64)
    for step, revision_hash in enumerate(hashes):
        connection.execute(
            "INSERT INTO revision VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (f"rev_{step + 1:016x}", person_id, campaign_id, step, "Synthetic", "Synthetic",
             "why_them", "bespoke", None, "Synthetic", "[]", "[]", "[]", "fixture", 1,
             "fixture", "fixture", '{"qa_score":100}', revision_hash),
        )
    connection.execute(
        "INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)",
        (enrollment_id, campaign_id, person_id, 0, now.isoformat(), "scheduled", None, None, None),
    )
    approval = {
        "assertion_ref": "assertion-fixture", "campaign_id": campaign_id,
        "policy_hash": policy_hash, "content_kind": "revision", "revision_hash": hashes[0],
        "contact_id": contact_id, "mailbox_id": mailbox_id, "approver": "human:fixture",
        "approved_at": start, "expires_at": end, "tier": "T1",
        "send_window": json.dumps({"start": start, "end": end}, sort_keys=True, separators=(",", ":")),
        "nonce": "nonce-fixture", "permitted_action": "send_revision",
    }
    connection.execute(
        "INSERT INTO approval VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("apr_0000000000000001", approval["assertion_ref"], campaign_id, policy_hash,
         approval["content_kind"], approval["revision_hash"], contact_id, mailbox_id,
         approval["approver"], start, end, "T1", approval["send_window"], approval["nonce"],
         approval["permitted_action"], None, approval_scope_hash(approval), None),
    )
    for delivery_id, step, revision_hash, logical_key in (
        (d0_delivery_id, 0, hashes[0], "d" * 64),
        (followup_delivery_id, 1, hashes[1], "e" * 64),
    ):
        connection.execute(
            "INSERT INTO delivery VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (delivery_id, campaign_id, enrollment_id, step, revision_hash, contact_id, mailbox_id,
             logical_key, None, None, f"<{delivery_id}@fixture.test>", start, None, None, "reserved"),
        )
    connection.execute(
        "INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)",
        ("fit-fixture", "fixture", "{}", "f" * 64, now.isoformat(), now.isoformat()),
    )
    connection.execute(
        "INSERT INTO eligibility_decision VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (f"elig_{1:016x}", campaign_id, person_id, "fixture", "fit-fixture",
         "eligible", "[]", "[]", now.isoformat(), None, None, None, None),
    )
    connection.commit()
    return T1Store(connection, d0_delivery_id, followup_delivery_id, now)


@dataclass(frozen=True)
class P6RefireStore:
    """Migrated synthetic store wired to the P4 service and P6 T1 adapter."""

    connection: sqlite3.Connection
    gmail: SendFakeGmail
    service: object
    inbound_thread_id: str
    desktop_root: Path


class LocalDesktopProcess:
    """Popen-shaped local transport that executes the P5 desktop entrypoint."""

    def __init__(self, argv: list[str], stdout: str, returncode: int) -> None:
        self.args = argv
        self.stdout, self.stderr = StringIO(stdout), StringIO()
        self.returncode, self.pid = returncode, 71

    def wait(self, timeout: int) -> int:
        del timeout
        return self.returncode


class LocalCampaignerTransport:
    """Test-only local P5 transport through desktop_stage and campaigner CLI."""

    def __init__(self, service: object) -> None:
        self.service = service
        self.calls: list[list[str]] = []

    def __call__(self, argv: list[str], **kwargs) -> LocalDesktopProcess:
        from scripts.prospecting.campaigner import cli as campaigner_cli
        from scripts.prospecting.manager import desktop_stage

        assert kwargs["shell"] is False
        assert kwargs["env"]["KB_PROSPECTING_NO_NETWORK"] == "1"
        assert argv[:5] == [
            "py", "-3", "-m", "scripts.prospecting.manager.desktop_stage", "--job",
        ]
        self.calls.append(argv)

        def launch_campaigner(child_argv, **child_kwargs):
            assert child_kwargs["env"]["KB_PROSPECTING_NO_NETWORK"] == "1"
            assert child_kwargs["shell"] is False
            assert child_argv[:3] == [
                sys.executable, "-m", "scripts.prospecting.campaigner.cli",
            ]
            output: list[str] = []
            exit_code = campaigner_cli.main(
                child_argv[3:], service=self.service, emit=output.append,
            )
            return LocalDesktopProcess(
                child_argv, "".join(output), exit_code,
            )

        original_popen = desktop_stage.subprocess.Popen
        desktop_stage.subprocess.Popen = launch_campaigner
        output = StringIO()
        try:
            with redirect_stdout(output):
                exit_code = desktop_stage.main(argv[4:])
        finally:
            desktop_stage.subprocess.Popen = original_popen
        return LocalDesktopProcess(argv, output.getvalue(), exit_code)


def build_p6_refire_store(tmp_path: Path) -> P6RefireStore:
    """Attach local fake-backed P4/P6 execution for cadence re-fire tests."""
    desktop_root = tmp_path / "kb-prospecting"
    desktop_root.mkdir()
    seeded = migrated_t1_store(desktop_root / "store.sqlite")
    gmail = SendFakeGmail()
    root = gmail.seed_outbound("Synthetic", SYNTHETIC["root_message_id"])
    seeded.connection.execute(
        "UPDATE delivery SET gmail_thread_id=?,gmail_message_id=? WHERE delivery_id=?",
        (root.thread_id, root.message_id, seeded.d0_delivery_id),
    )
    seeded.connection.commit()
    executor = Executor(seeded.connection)
    attach_t1_send(executor, gmail)
    service = build_live_service(
        seeded.connection, executor=executor, backend=gmail,
        now=lambda: seeded.now.isoformat(),
    )

    # The cadence hands the queued P4 operation to its attached executor before
    # a same-minute re-fire observes the next scheduler state.
    release = service.release

    def release_and_drain(delivery_id: str):
        before_drafts = seeded.connection.execute(
            "SELECT count(*) FROM audit WHERE action='gmail_draft'"
        ).fetchone()[0]
        result = release(delivery_id)
        while executor.process_one():
            pass
        after_drafts = seeded.connection.execute(
            "SELECT count(*) FROM audit WHERE action='gmail_draft'"
        ).fetchone()[0]
        return type(result)("drafted") if after_drafts > before_drafts else result

    service.release = release_and_drain
    return P6RefireStore(seeded.connection, gmail, service, root.thread_id, desktop_root)


def fixture_snapshot() -> dict[str, str]:
    """Return a content hash for every checked-in approval fixture."""
    return {
        path.relative_to(_FIXTURES).as_posix(): hashlib.sha256(path.read_bytes()).hexdigest()
        for path in sorted(_FIXTURES.glob("approval-*.json"))
    }


def stubbed_test_approval(
    monkeypatch,
    tmp_path: Path,
    work_order: str,
    expected_scope_hash: str,
    now,
    *,
    owner: str = "human:daniel",
    verdict: str = "valid",
) -> TestApproval:
    """Stub the imported WebAuthn boundary with one deterministic verdict."""
    if verdict not in _REASONS:
        raise ValueError("unsupported_stub_verdict")
    card_ref = f"approval-{expected_scope_hash[:12]}"
    approval_path = _FIXTURES / "approval-scopes.json"
    repo_root = tmp_path / "approval-repo"
    card = cards.new_card(
        "dash",
        "approve-prospecting-send",
        "campaign-1",
        "T3",
        body=f"## Work order\n{work_order}\n",
        state="approvals",
        owner=owner,
        id="approval-stub",
    )
    expected_call = {"card_path": approval_path, "repo_root": repo_root, "ref": card_ref}
    calls: list[dict[str, object]] = []

    def verify_boundary(card_path, root, *, ref=None):
        observed = {"card_path": card_path, "repo_root": root, "ref": ref}
        calls.append(observed)
        assert observed == expected_call
        ok = verdict == "valid"
        return SimpleNamespace(ok=ok, reason=_REASONS[verdict], card=card if ok else None)

    monkeypatch.setattr(approval_verify, "verify_webauthn_approval", verify_boundary)
    return TestApproval(
        card_ref,
        approval_path,
        repo_root,
        expected_call,
        calls,
    )

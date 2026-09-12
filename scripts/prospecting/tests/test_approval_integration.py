from dataclasses import FrozenInstanceError
from datetime import datetime, timedelta, timezone
import json
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

import approvals
import cards
from scripts.prospecting import store
from scripts.prospecting.approval.scope import (
    BatchItem,
    build_scope,
    deserialize,
    materialized_send_scopes,
    scope_hash,
    serialize,
)
from scripts.prospecting.approval import verify as approval_verify
from scripts.prospecting.approval import scope as approval_scope
from scripts.prospecting.approval import batch as approval_batch
from scripts.prospecting.approval import schedule_t1 as approval_schedule
from scripts.prospecting.approval import release_t1 as approval_release
from scripts.prospecting.approval.verify import verify_and_insert
from scripts.prospecting.tests.p6_support import (
    fixture_snapshot,
    migrated_t1_store,
    stubbed_test_approval,
)
from scripts.prospecting.approval.batch import (
    ContactSelectionError,
    apply_batch,
    build_batch,
    stage_scope,
    summarize,
)
from scripts.prospecting.approval import cli as approval_cli
from scripts.prospecting.tests.synthetic_fixtures import legacy_fixture


NOW = datetime(2099, 5, 31, 22, tzinfo=timezone.utc)
SYNTHETIC = legacy_fixture("test_approval_integration")
_REAL_BATCH_REVISION_READY = approval_batch._revision_ready
_REAL_VERIFY_REVISION_READY = approval_verify._require_revision_ready
_REAL_STORE_REVISION_READY = store._require_revision_ready


@pytest.fixture(autouse=True)
def isolate_existing_approval_tests_from_editorial_pipeline(monkeypatch) -> None:
    """These unit tests exercise approval mechanics, not P16 receipt validity."""
    monkeypatch.setattr(approval_batch, "_revision_ready", lambda *_args: True)
    monkeypatch.setattr(approval_verify, "_require_revision_ready", lambda *_args: None)
    monkeypatch.setattr(store, "_require_revision_ready", lambda *_args: None)


def _temporary_git_repo(root: Path) -> None:
    """Create an isolated repository for tests that exercise approval staging."""
    for argv in (
        ["git", "init"],
        ["git", "config", "user.name", "test"],
        ["git", "config", "user.email", SYNTHETIC["git_email"]],
    ):
        subprocess.run(argv, cwd=root, check=True, capture_output=True, text=True)
    (root / "README.md").write_text("temporary test repository\n", encoding="utf-8")
    subprocess.run(["git", "add", "README.md"], cwd=root, check=True, capture_output=True, text=True)
    subprocess.run(
        ["git", "commit", "-m", "initial test commit"],
        cwd=root, check=True, capture_output=True, text=True,
    )


def _scope(items=None):
    return build_scope(
        campaign_id="campaign-1",
        policy_hash="a" * 64,
        items=items
        or (BatchItem("c" * 64, "contact-2"), BatchItem("b" * 64, "contact-1")),
        mailbox_id="mailbox-1",
        tier="T1",
        window_start="2099-06-01T11:30:00+00:00",
        window_end="2099-06-01T14:30:00+00:00",
        expires_at="2099-06-01T14:30:00+00:00",
        nonce="nonce-parent-001",
        now=NOW,
    )


def test_canonicalization_is_order_stable() -> None:
    left = _scope()
    right = _scope(tuple(reversed(left.items)))
    assert serialize(left) == serialize(right)
    assert scope_hash(left) == scope_hash(right)
    value = json.loads(serialize(left))
    assert value["items"][0]["revision_hash"] == "b" * 64
    assert value["batch_hash"] != value["items"][0]["revision_hash"]
    reordered = {key: value[key] for key in reversed(value)}
    assert (
        scope_hash(deserialize(json.dumps(reordered, indent=2), scope_hash(left), NOW))
        == scope_hash(left)
    )


def test_scope_is_deeply_immutable_and_modified_copy_does_not_match() -> None:
    original = _scope()
    with pytest.raises(FrozenInstanceError):
        original.nonce = "nonce-parent-002"  # type: ignore[misc]
    with pytest.raises(TypeError):
        original.send_window["end"] = "2099-06-01T15:30:00+00:00"

    modified = original.replace(nonce="nonce-parent-002")
    assert modified is not original
    assert scope_hash(modified) != scope_hash(original)
    with pytest.raises(ValueError) as raised:
        deserialize(serialize(modified), scope_hash(original), NOW)
    assert type(raised.value) is ValueError
    assert raised.value.args == ("scope_hash_mismatch",)


@pytest.mark.parametrize(
    ("field", "value"),
    (
        ("campaign_id", "campaign-2"),
        ("policy_hash", "d" * 64),
        ("items", (BatchItem("d" * 64, "contact-3"),)),
        ("mailbox_id", "mailbox-2"),
        ("tier", "T2"),
        (
            "send_window",
            {
                "start": "2099-06-01T12:30:00+00:00",
                "end": "2099-06-01T14:30:00+00:00",
            },
        ),
        ("expires_at", "2099-06-01T14:00:00+00:00"),
        ("nonce", "nonce-parent-002"),
        ("permitted_action", "other_action"),
        ("content_kind", "other_content"),
    ),
    ids=(
        "campaign_id", "policy_hash", "items", "mailbox_id", "tier", "send_window",
        "expires_at", "nonce", "permitted_action", "content_kind",
    ),
)
def test_every_bound_field_changes_approval_hash(field: str, value: object) -> None:
    original = _scope()
    modified = original.replace(**{field: value})
    assert scope_hash(modified) != scope_hash(original)


def test_same_scope_hashes_identically_in_a_new_process() -> None:
    scope = _scope()
    code = """
from datetime import datetime, timezone
from scripts.prospecting.approval.scope import BatchItem, build_scope, scope_hash
scope = build_scope(
    'campaign-1', 'a' * 64,
    (BatchItem('c' * 64, 'contact-2'), BatchItem('b' * 64, 'contact-1')),
    'mailbox-1', 'T1', '2099-06-01T11:30:00+00:00',
    '2099-06-01T14:30:00+00:00', '2099-06-01T14:30:00+00:00',
    'nonce-parent-001', datetime(2099, 5, 31, 22, tzinfo=timezone.utc),
)
print(scope_hash(scope))
"""
    result = subprocess.run(
        [sys.executable, "-c", code], capture_output=True, check=True, text=True
    )
    assert result.stdout.strip() == scope_hash(scope)


def test_mutating_any_bound_field_is_detected() -> None:
    for field in (
        "campaign_id",
        "policy_hash",
        "items",
        "mailbox_id",
        "tier",
        "send_window",
        "expires_at",
        "nonce",
        "permitted_action",
        "batch_hash",
        "schema",
        "content_kind",
        "approval_hash",
    ):
        original = _scope()
        value = json.loads(serialize(original))
        if field == "items":
            value[field][0]["contact_id"] = "contact-tampered"
        elif field == "send_window":
            value[field]["end"] = "2099-06-01T15:30:00+00:00"
        else:
            value[field] = "tampered"
        with pytest.raises(ValueError):
            deserialize(json.dumps(value), scope_hash(original), NOW)


def test_expiry_is_positive_and_at_most_24_hours() -> None:
    with pytest.raises(ValueError, match="scope_expiry"):
        build_scope(
            "campaign-1",
            "a" * 64,
            (BatchItem("b" * 64, "contact-1"),),
            "mailbox-1",
            "T1",
            "2099-06-01T11:30:00+00:00",
            "2099-06-01T14:30:00+00:00",
            (NOW + timedelta(hours=24, seconds=1)).isoformat(),
            "nonce",
            NOW,
        )


def test_explicit_now_is_independent_of_the_wall_clock(tmp_path: Path, monkeypatch) -> None:
    """Every P6 approval boundary must honor its supplied logical clock."""
    class FakeDatetime:
        fromisoformat = staticmethod(datetime.fromisoformat)
        strptime = staticmethod(datetime.strptime)
        combine = staticmethod(datetime.combine)

        @staticmethod
        def now(tz=None):
            del tz
            return wall_clock

    outcomes = []
    for wall_clock in (
        datetime(2001, 1, 1, tzinfo=timezone.utc),
        datetime(2999, 1, 1, tzinfo=timezone.utc),
    ):
        with monkeypatch.context() as isolated:
            for module in (
                approval_cli,
                approval_batch,
                approval_scope,
                approval_verify,
                approval_schedule,
                approval_release,
            ):
                isolated.setattr(module, "datetime", FakeDatetime)
            db, scope = _batch_store(), _scope()
            fixture = stubbed_test_approval(
                isolated, tmp_path, serialize(scope), scope_hash(scope), NOW
            )
            result = apply_batch(
                db, fixture.card_ref, fixture.approval_path, fixture.repo_root,
                scope_hash(scope), NOW,
            )
            release_fixture = migrated_t1_store(tmp_path / f"{wall_clock.year}.sqlite")
            outcomes.append((
                result.ids,
                tuple(row[0] for row in db.execute(
                    "SELECT scheduled_at FROM delivery ORDER BY delivery_id"
                )),
                approval_release.queue_due_t1(
                    release_fixture.connection, release_fixture.now
                ),
            ))
    assert outcomes[0] == outcomes[1]


def test_materialized_child_nonces_are_unique_and_stable() -> None:
    rows = materialized_send_scopes(_scope())
    assert rows[0]["nonce"] == "nonce-parent-001"
    assert len({row["nonce"] for row in rows}) == len(rows)
    assert len({row["scope_hash"] for row in rows}) == len(rows)


def _approval_store() -> sqlite3.Connection:
    db = sqlite3.connect(":memory:", isolation_level=None)
    db.executescript("""
    CREATE TABLE campaign(
      campaign_id TEXT PRIMARY KEY,policy_hash TEXT,approval_tier TEXT,
      send_window TEXT,timezone TEXT,status TEXT
    );
    CREATE TABLE person(person_id TEXT PRIMARY KEY);
    CREATE TABLE contact_point(contact_id TEXT PRIMARY KEY,person_id TEXT,state TEXT);
    CREATE TABLE revision(
      hash TEXT PRIMARY KEY,person_id TEXT,campaign_id TEXT,step INTEGER,qa TEXT
    );
    CREATE TABLE approval(
      approval_id TEXT PRIMARY KEY,assertion_ref TEXT,campaign_id TEXT,policy_hash TEXT,
      content_kind TEXT,revision_hash TEXT,contact_id TEXT,mailbox_id TEXT,approver TEXT,
      approved_at TEXT,expires_at TEXT,tier TEXT,send_window TEXT,nonce TEXT UNIQUE,
      permitted_action TEXT,consumed_at TEXT,scope_hash TEXT UNIQUE,invalidation_reason TEXT
    );
    INSERT INTO campaign VALUES(
      'campaign-1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      'T1','07:30-10:30','America/New_York','active'
    );
    INSERT INTO person VALUES('person-1'); INSERT INTO person VALUES('person-2');
    INSERT INTO contact_point VALUES('contact-1','person-1','valid');
    INSERT INTO contact_point VALUES('contact-2','person-2','valid');
    INSERT INTO revision VALUES('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','person-1','campaign-1',0,'{"qa_score":90}');
    INSERT INTO revision VALUES('cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc','person-2','campaign-1',0,'{"qa_score":90}');
    """)
    return db


def test_valid_boundary_verdict_materializes_exact_rows(tmp_path: Path, monkeypatch) -> None:
    db, scope = _approval_store(), _scope()
    fixture = stubbed_test_approval(
        monkeypatch, tmp_path, serialize(scope), scope_hash(scope), NOW, owner="human:daniel"
    )
    ids = verify_and_insert(
        db, fixture.card_ref, fixture.approval_path, fixture.repo_root,
        scope_hash(scope), NOW,
    )
    assert len(ids) == 2
    rows = db.execute(
        "SELECT content_kind,permitted_action,approver,consumed_at FROM approval ORDER BY revision_hash"
    ).fetchall()
    assert rows == [
        ("revision", "send_revision", "human:daniel", None),
        ("revision", "send_revision", "human:daniel", None),
    ]
    assert fixture.calls == [fixture.expected_call]


def test_replay_and_scope_hash_mismatch_write_nothing(tmp_path: Path, monkeypatch) -> None:
    db, scope = _approval_store(), _scope()
    fixture = stubbed_test_approval(monkeypatch, tmp_path, serialize(scope), scope_hash(scope), NOW)
    args = (
        db, fixture.card_ref, fixture.approval_path, fixture.repo_root,
        scope_hash(scope), NOW,
    )
    verify_and_insert(*args)
    with pytest.raises(ValueError, match="approval_replay"):
        verify_and_insert(*args)
    assert db.execute("SELECT count(*) FROM approval").fetchone()[0] == 2
    fresh = _approval_store()
    with pytest.raises(ValueError) as raised:
        verify_and_insert(
            fresh, fixture.card_ref, fixture.approval_path, fixture.repo_root,
            "0" * 64, NOW,
        )
    assert type(raised.value) is ValueError
    assert raised.value.args == ("scope_hash_mismatch",)
    assert fresh.execute("SELECT count(*) FROM approval").fetchone()[0] == 0


@pytest.mark.parametrize(
    ("verdict", "code"),
    (("expired", "approval_expired"), ("replayed", "approval_replay"), ("wrong_credential", "webauthn_rejected")),
)
def test_boundary_rejections_write_nothing(tmp_path: Path, monkeypatch, verdict: str, code: str) -> None:
    db, scope = _approval_store(), _scope()
    fixture = stubbed_test_approval(
        monkeypatch, tmp_path, serialize(scope), scope_hash(scope), NOW, verdict=verdict
    )
    with pytest.raises(ValueError, match=code):
        verify_and_insert(
            db, fixture.card_ref, fixture.approval_path, fixture.repo_root,
            scope_hash(scope), NOW,
        )
    assert fixture.calls == [fixture.expected_call]
    assert db.execute("SELECT count(*) FROM approval").fetchone()[0] == 0


def test_machine_owner_fails(tmp_path: Path, monkeypatch) -> None:
    db, scope = _approval_store(), _scope()
    machine = stubbed_test_approval(
        monkeypatch, tmp_path, serialize(scope), scope_hash(scope), NOW,
        owner="prospecting-campaigner",
    )
    with pytest.raises(ValueError, match="human_approver_required"):
        verify_and_insert(
            db, machine.card_ref, machine.approval_path, machine.repo_root,
            scope_hash(scope), NOW,
        )
    assert db.execute("SELECT count(*) FROM approval").fetchone()[0] == 0


def test_expired_scope_writes_nothing(tmp_path: Path, monkeypatch) -> None:
    db, scope = _approval_store(), _scope()
    expired_now = NOW + timedelta(days=2)
    fixture = stubbed_test_approval(
        monkeypatch, tmp_path, serialize(scope), scope_hash(scope), expired_now
    )
    with pytest.raises(ValueError, match="scope_expiry"):
        verify_and_insert(
            db, fixture.card_ref, fixture.approval_path, fixture.repo_root,
            scope_hash(scope), expired_now,
        )
    assert db.execute("SELECT count(*) FROM approval").fetchone()[0] == 0


def test_savepoint_rolls_back_an_incomplete_multi_row_insert(tmp_path: Path, monkeypatch) -> None:
    db, scope = _approval_store(), _scope()
    fixture = stubbed_test_approval(monkeypatch, tmp_path, serialize(scope), scope_hash(scope), NOW)
    db.execute("UPDATE contact_point SET state='invalid' WHERE contact_id='contact-2'")
    db.execute("BEGIN IMMEDIATE")
    with pytest.raises(ValueError, match="scope_mismatch"):
        verify_and_insert(
            db, fixture.card_ref, fixture.approval_path, fixture.repo_root,
            scope_hash(scope), NOW, manage_transaction=False,
        )
    assert db.execute("SELECT count(*) FROM approval").fetchone()[0] == 0
    db.rollback()


def test_fixture_directory_is_unchanged_by_boundary_stubs(tmp_path: Path, monkeypatch) -> None:
    scope = _scope()
    before = fixture_snapshot()
    db = _approval_store()
    fixture = stubbed_test_approval(monkeypatch, tmp_path, serialize(scope), scope_hash(scope), NOW)
    verify_and_insert(
        db, fixture.card_ref, fixture.approval_path, fixture.repo_root,
        scope_hash(scope), NOW,
    )
    assert fixture_snapshot() == before


def test_real_webauthn_primitive_refuses_unsigned_pinned_card(tmp_path: Path, monkeypatch) -> None:
    """The production verifier, not the boundary stub, fails closed before insert."""
    import os as _os
    from scripts import webauthn_verify as _primitive
    _original_run = _primitive.subprocess.run

    def _guarded_run(*args, **kwargs):  # the frozen primitive spawns git with its own env
        env = dict(kwargs.get("env") or _os.environ)
        env["KB_PROSPECTING_NO_NETWORK"] = "1"
        kwargs["env"] = env
        return _original_run(*args, **kwargs)

    monkeypatch.setattr(_primitive.subprocess, "run", _guarded_run)
    db, scope = _approval_store(), _scope()
    _temporary_git_repo(tmp_path)
    staged = stage_scope(scope, tmp_path, approval_cli._local_stage_opener)
    card = cards.parse(staged.card_path)
    assert staged.ref.startswith("approval/")
    # Model the dashboard's yet-unsigned WebAuthn record on the committed
    # approval branch.  This remains an isolated temporary git repository.
    card.meta["assurance"] = "webauthn"
    card.meta.pop("approval", None)
    cards.save(card, tmp_path / "queue")
    subprocess.run(
        ["git", "add", "queue/approvals"], cwd=tmp_path,
        check=True, capture_output=True, text=True,
    )
    subprocess.run(
        ["git", "commit", "-m", "unsigned webauthn test card"], cwd=tmp_path,
        check=True, capture_output=True, text=True,
    )
    assert card.meta["assurance"] == "webauthn"
    assert card.meta["webauthn"]["signature"] == ""

    real_verify = approval_verify.verify_webauthn_approval
    calls: list[tuple[Path, Path, str | None]] = []

    def observe_verify(card_path, repo_root, *, ref=None):
        calls.append((Path(card_path), Path(repo_root), ref))
        return real_verify(card_path, repo_root, ref=ref)

    monkeypatch.setattr(approval_verify, "verify_webauthn_approval", observe_verify)

    with pytest.raises(ValueError, match="webauthn_rejected"):
        approval_cli.main(
            [
                "materialize", "--store", str(tmp_path / "store.sqlite"),
                "--card-ref", staged.ref, "--stage-root", str(tmp_path),
            ],
            open_store_fn=lambda _path: db,
            now=lambda: NOW,
        )
    assert calls == [(staged.card_path, tmp_path, staged.ref)]
    assert db.execute("SELECT count(*) FROM approval").fetchone()[0] == 0


def _batch_store() -> sqlite3.Connection:
    db = _approval_store()
    db.executescript("""
    ALTER TABLE campaign ADD COLUMN mailbox_id TEXT;
    ALTER TABLE campaign ADD COLUMN daily_cap INTEGER;
    ALTER TABLE campaign ADD COLUMN hourly_cap INTEGER;
    ALTER TABLE campaign ADD COLUMN firm_collision_cap INTEGER;
    ALTER TABLE campaign ADD COLUMN policy_json TEXT;
    ALTER TABLE campaign ADD COLUMN intent TEXT;
    UPDATE campaign SET mailbox_id='mailbox-1', timezone='UTC', daily_cap=25,
      hourly_cap=6, firm_collision_cap=2, policy_json='{}', intent='networking';
    CREATE TABLE enrollment(
      enrollment_id TEXT PRIMARY KEY,campaign_id TEXT,person_id TEXT,current_step INTEGER,
      next_due_at TEXT,status TEXT,stop_reason TEXT,block_reason TEXT,variant_id TEXT
    );
    CREATE TABLE delivery(
      delivery_id TEXT PRIMARY KEY,campaign_id TEXT,enrollment_id TEXT,step INTEGER,
      revision_hash TEXT,contact_id TEXT,mailbox_id TEXT,logical_key TEXT UNIQUE,
      gmail_message_id TEXT,gmail_thread_id TEXT,rfc_message_id TEXT UNIQUE,
      scheduled_at TEXT,attempted_at TEXT,sent_at TEXT,state TEXT
    );
    CREATE TABLE audit(
      event_id TEXT PRIMARY KEY,actor TEXT,action TEXT,entity_type TEXT,entity_id TEXT,
      at TEXT,before_hash TEXT,after_hash TEXT,reason TEXT
    );
    CREATE TABLE t1_delivery_batch(delivery_id TEXT PRIMARY KEY,batch_hash TEXT);
    CREATE TABLE employment(person_id TEXT,company_id TEXT);
    CREATE VIEW person_tranche AS
      SELECT p.person_id,c.campaign_id,cp.contact_id AS email
      FROM person AS p CROSS JOIN campaign AS c
      LEFT JOIN contact_point AS cp ON cp.person_id=p.person_id AND cp.state='valid';
    INSERT INTO enrollment VALUES('enrollment-1','campaign-1','person-1',0,'2099-05-31T12:00:00+00:00','approved',NULL,NULL,'v1');
    INSERT INTO enrollment VALUES('enrollment-2','campaign-1','person-2',0,'2099-05-31T12:00:00+00:00','approved',NULL,NULL,'v1');
    """)
    db.row_factory = sqlite3.Row
    return db


def test_batch_prepare_is_stable_and_summary_is_pii_free() -> None:
    db = _batch_store()
    one = build_batch(db, "campaign-1", "mailbox-1", NOW, "nonce-parent-001")
    two = build_batch(db, "campaign-1", "mailbox-1", NOW, "nonce-parent-001")
    assert serialize(one) == serialize(two)
    summary = summarize(one)
    assert set(summary) == {
        "campaign_id", "batch_hash", "scope_hash", "count", "revision_ids", "contact_ids",
    }
    assert set(summary["contact_ids"]) == {"contact-1", "contact-2"}


def test_passed_mailbox_is_bound_to_the_scope_hash() -> None:
    db = _batch_store()
    one = build_batch(db, "campaign-1", "mailbox-1", NOW, "nonce-parent-001")
    two = build_batch(db, "campaign-1", "mailbox-2", NOW, "nonce-parent-001")
    assert one.batch_hash == two.batch_hash
    assert scope_hash(one) != scope_hash(two)


def test_approval_cli_stages_scope_and_emits_counts_only(tmp_path: Path) -> None:
    db = _batch_store()
    output: list[str] = []
    _temporary_git_repo(tmp_path)

    assert approval_cli.main(
        [
            "approve-batch", "--store", str(tmp_path / "store.sqlite"),
            "--campaign", "campaign-1", "--mailbox", "mailbox-1",
            "--stage-root", str(tmp_path),
        ],
        open_store_fn=lambda path: db,
        now=lambda: NOW,
        nonce_factory=lambda _size: "nonce-parent-001",
        emit=output.append,
    ) == 0
    emitted = json.loads(output[0])
    assert set(emitted) == {"count", "batch_hash", "scope_hash", "card_ref", "next"}
    assert emitted["next"] == "approve_in_kb_dashboard"
    assert emitted["count"] == 2
    assert emitted["card_ref"] == f"approval/prospecting-t1-{emitted['batch_hash'][:16]}"
    assert (tmp_path / "queue" / "approvals").joinpath(
        f"prospecting-t1-{emitted['batch_hash'][:16]}.md"
    ).is_file()


def test_approval_cli_refuses_missing_store_in_a_subprocess() -> None:
    result = subprocess.run(
        [
            sys.executable, "-m", "scripts.prospecting.approval.cli", "approve-batch",
            "--campaign", "campaign-1",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "--store" in result.stderr


def test_approval_cli_refuses_empty_batch_without_staging(tmp_path: Path) -> None:
    db = _batch_store()
    db.execute("UPDATE enrollment SET status='closed'")
    argv = [
        "approve-batch", "--store", str(tmp_path / "store.sqlite"), "--campaign", "campaign-1",
        "--mailbox", "mailbox-1",
    ]
    with pytest.raises(ValueError, match="empty_batch"):
        approval_cli.main(
            argv,
            open_store_fn=lambda path: db,
            now=lambda: NOW,
            nonce_factory=lambda _size: "nonce-parent-001",
        )
    _temporary_git_repo(tmp_path)
    assert approval_cli.main(
        argv + ["--stage-root", str(tmp_path)], open_store_fn=lambda path: _batch_store(),
        now=lambda: NOW, nonce_factory=lambda _size: "nonce-parent-001",
    ) == 0


def _migrated_batch_store(path: Path) -> sqlite3.Connection:
    db = store.open_store(path)
    db.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        ("sender-1", "Sender", None, "focus", "background", "proof", "{}"),
    )
    db.execute(
        """INSERT INTO campaign(
               campaign_id,intent,sender_profile_id,policy_json,ask_type,tone,template_family,cadence,
               send_window,timezone,daily_cap,hourly_cap,firm_collision_cap,approval_tier,mailbox_id,
               evidence_rules,credit_budget,status,policy_hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        (
            "campaign-1", "networking", "sender-1", "{}", "informational_call", "warm", "intro",
            "[]", "07:30-10:30", "UTC", 25, 6, 2, "T1", "mailbox-1", "{}", 0, "active",
            "a" * 64,
        ),
    )
    db.execute(
        "INSERT INTO company VALUES(?,?,?,?,?,?,?,?,?)",
        ("company-1", "Example Co", "https://example.test", None, None, "software", None,
         "manual", "company-example"),
    )
    db.execute(
        "INSERT INTO person VALUES(?,?,?,?,?,?,?,?)",
        ("person-1", "Casey", "Casey Example", None, None, None, "manual", "person-example"),
    )
    db.execute(
        "INSERT INTO source_snapshot VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("snapshot-1", "person-1", "https://example.test/source", "example.test", "2026-09-01T00:00:00+00:00",
         "text/html", "b" * 64, "allowlist-1", "snapshot-ref", "2026-10-01T00:00:00+00:00",
         "2027-09-01T00:00:00+00:00"),
    )
    db.execute(
        "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,?)",
        ("observation-1", "employment", "person-1", "title", "\"operator\"", "manual", None,
         "2026-09-01T00:00:00+00:00", 1.0, "snapshot-1"),
    )
    db.execute(
        "INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)",
        ("employment-1", "person-1", "company-1", "operator", None, None, "observation-1", 1.0),
    )
    db.execute(
        "INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)",
        ("fit-version-1", "v1", "{}", "c" * 64, "2026-09-01T00:00:00+00:00", "2026-09-01T00:00:00+00:00"),
    )
    db.execute(
        "INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)",
        ("fit-score-1", "campaign-1", "person-1", "fit-version-1", 90, "{}", "2026-09-01T00:00:00+00:00"),
    )
    db.execute(
        "INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("contact-1", "person-1", "company-1", SYNTHETIC["contact_email"], "manual", "v1", None, None,
         "valid", 1.0, 0),
    )
    db.execute(
        """INSERT INTO revision(
               revision_id,person_id,campaign_id,step,subject,body,angle,generation_mode,purpose,ask,
               evidence_ids,recipient_relevance_points,sender_proof_points,template_id,template_version,
               prompt_version,model_version,qa,hash
           ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ("revision-1", "person-1", "campaign-1", 0, "Subject", "Body", "why_them", "bespoke", None,
         "Ask", "[]", "[]", "[]", "template-1", 1, "prompt-1", "model-1", "{\"qa_score\":90}",
         "b" * 64),
    )
    db.execute(
        "INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)",
        ("enrollment-1", "campaign-1", "person-1", 0, "2099-01-01T00:00:00+00:00", "approved",
         None, None, "variant-1"),
    )
    return db


def test_approval_cli_subprocess_blocks_store_without_editorial_receipts(tmp_path: Path) -> None:
    store_path = tmp_path / "store.sqlite"
    db = _migrated_batch_store(store_path)
    _temporary_git_repo(tmp_path)
    selected = db.execute(
        """SELECT e.enrollment_id,cp.contact_id
           FROM enrollment AS e
           JOIN person_tranche AS pt ON pt.person_id=e.person_id AND pt.campaign_id=e.campaign_id
           JOIN contact_point AS cp ON cp.person_id=pt.person_id AND cp.state='valid'"""
    ).fetchall()
    assert [tuple(row) for row in selected] == [("enrollment-1", "contact-1")]
    result = subprocess.run(
        [
            sys.executable, "-m", "scripts.prospecting.approval.cli", "approve-batch",
            "--store", str(store_path), "--campaign", "campaign-1", "--mailbox", "mailbox-1",
            "--now", "2099-05-31T22:00:00Z", "--stage-root", str(tmp_path),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 1
    assert json.loads(result.stdout) == {"error": "approval_failed"}
    assert result.stderr == ""
    assert not (tmp_path / "queue" / "approvals").exists()


def test_materialize_subprocess_uses_pinned_verifier_boundary(tmp_path: Path) -> None:
    store_path = tmp_path / "store.sqlite"
    _migrated_batch_store(store_path)
    _temporary_git_repo(tmp_path)
    staged_output: list[str] = []
    assert approval_cli.main(
        [
            "approve-batch", "--store", str(store_path), "--campaign", "campaign-1",
            "--mailbox", "mailbox-1", "--now", "2099-05-31T22:00:00Z",
            "--stage-root", str(tmp_path),
        ],
        emit=staged_output.append,
    ) == 0
    staged = json.loads(staged_output[0])
    code = """
import json
import sys
from pathlib import Path
from types import SimpleNamespace
root = Path(sys.argv[3])
sys.path.insert(0, str(Path.cwd() / 'scripts'))
import cards
import scripts.prospecting.approval.verify as verification
from scripts.prospecting.approval import cli
verification._require_revision_ready = lambda *_args: None
original_apply = cli.batch.apply_batch
verified = False
def verify(card_path, repo_root, *, ref=None):
    global verified
    assert repo_root == root
    assert ref == sys.argv[2]
    verified = True
    return SimpleNamespace(ok=True, reason='ok', card=cards.parse(card_path))
def apply(*args, **kwargs):
    result = original_apply(*args, **kwargs)
    assert verified
    return result
verification.verify_webauthn_approval = verify
cli.batch.apply_batch = apply
raise SystemExit(cli.main([
    'materialize', '--store', sys.argv[1], '--card-ref', sys.argv[2],
    '--stage-root', sys.argv[3], '--now', '2099-05-31T22:00:00Z',
]))
"""
    result = subprocess.run(
        [sys.executable, "-c", code, str(store_path), staged["card_ref"], str(tmp_path)],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "count": 1, "scope_hash": staged["scope_hash"], "state": "materialized",
    }
    row = store.open_store(store_path).execute(
        "SELECT approval_id,approver FROM approval"
    ).fetchone()
    assert row[1] == "human:daniel"
    assert row[0].startswith("apr_") and len(row[0]) == 20
    delivery = store.open_store(store_path).execute("SELECT delivery_id FROM delivery").fetchone()[0]
    assert delivery.startswith("req_") and len(delivery) == 20


def test_approval_cli_subprocess_reports_an_opaque_failure_when_too_early(tmp_path: Path) -> None:
    store_path = tmp_path / "store.sqlite"
    _migrated_batch_store(store_path)
    result = subprocess.run(
        [
            sys.executable, "-m", "scripts.prospecting.approval.cli", "approve-batch",
            "--store", str(store_path), "--campaign", "campaign-1", "--mailbox", "mailbox-1",
            "--now", "2099-05-29T22:00:00Z", "--stage-root", str(tmp_path),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode != 0
    assert json.loads(result.stdout) == {"error": "approval_failed"}
    assert "scope_prepared_too_early" not in result.stdout


def test_partial_invalid_batch_is_all_or_nothing(tmp_path: Path, monkeypatch) -> None:
    db, scope = _batch_store(), _scope()
    db.execute("UPDATE contact_point SET state='stale' WHERE contact_id='contact-2'")
    fixture = stubbed_test_approval(
        monkeypatch, tmp_path, serialize(scope), scope_hash(scope), NOW, owner="human:daniel"
    )
    with pytest.raises(ValueError, match="scope_mismatch"):
        apply_batch(
            db, fixture.card_ref, fixture.approval_path, fixture.repo_root,
            scope_hash(scope), NOW,
        )
    assert db.execute("SELECT count(*) FROM approval").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM delivery").fetchone()[0] == 0
    assert db.execute("SELECT count(*) FROM enrollment WHERE status='approved'").fetchone()[0] == 2
    assert db.execute("SELECT count(*) FROM audit").fetchone()[0] == 0


@pytest.mark.parametrize("selected_count", (0, 2))
def test_campaign_tranche_contact_must_be_exactly_one(selected_count: int) -> None:
    db = _batch_store()
    if selected_count == 0:
        db.execute("UPDATE contact_point SET state='invalid' WHERE contact_id='contact-1'")
    else:
        db.execute("INSERT INTO contact_point VALUES('contact-1b','person-1','valid')")
    with pytest.raises(ContactSelectionError, match="selected_contact_count:enrollment-1"):
        build_batch(db, "campaign-1", "mailbox-1", NOW, "nonce-parent-001")


def test_identical_completed_batch_is_explicit_noop(tmp_path: Path, monkeypatch) -> None:
    db, scope = _batch_store(), _scope()
    fixture = stubbed_test_approval(
        monkeypatch, tmp_path, serialize(scope), scope_hash(scope), NOW, owner="human:daniel"
    )
    first = apply_batch(
        db, fixture.card_ref, fixture.approval_path, fixture.repo_root,
        scope_hash(scope), NOW,
    )
    second = apply_batch(
        db, fixture.card_ref, fixture.approval_path, fixture.repo_root,
        scope_hash(scope), NOW,
    )
    assert first.state == "materialized"
    assert second.state == "identical_completed_noop"


def test_actual_chain_materializes_then_unready_blocks_queued_send(
    tmp_path: Path, monkeypatch,
) -> None:
    from scripts.prospecting.pipeline_stage_service import PipelineStageService
    from scripts.prospecting.executor import Executor
    from scripts.prospecting.review_service import (
        EditDraftRequest,
        EditorialRequest,
        ReviewService,
    )
    from scripts.prospecting.tests.test_pipeline_stage_service import (
        NOW as PIPELINE_NOW,
        _adapters,
        _run_to_review,
        _seed,
    )

    monkeypatch.setattr(approval_batch, "_revision_ready", _REAL_BATCH_REVISION_READY)
    monkeypatch.setattr(approval_verify, "_require_revision_ready", _REAL_VERIFY_REVISION_READY)
    monkeypatch.setattr(store, "_require_revision_ready", _REAL_STORE_REVISION_READY)
    connection, revision = _seed(tmp_path)
    now = datetime.fromisoformat(PIPELINE_NOW.replace("Z", "+00:00"))
    pipeline = PipelineStageService(connection, adapters=_adapters(), now=lambda: now)
    item = pipeline.start_from_saved_revision(
        "campaign-a", revision.revision_id, "approval-chain-start",
    )
    _run_to_review(pipeline, item.item_id)
    accepted = pipeline.accept_suggestion(
        item.item_id, "approval-chain-accept", revision.revision_id, "human:fixture",
    )
    review = ReviewService(connection, now=lambda: PIPELINE_NOW)
    review.set_editorial_ready(EditorialRequest(
        "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeea1",
        "campaign-a", accepted.revision_id, True,
    ))
    connection.execute(
        "UPDATE campaign SET status='approved',approval_tier='T1',mailbox_id='mailbox-a',"
        "send_window='09:00-11:30',timezone='UTC',daily_cap=25,hourly_cap=6 "
        "WHERE campaign_id='campaign-a'"
    )
    policy_hash = connection.execute(
        "SELECT policy_hash FROM campaign WHERE campaign_id='campaign-a'",
    ).fetchone()[0]
    activation = {
        "assertion_ref": "approval-activation",
        "campaign_id": "campaign-a",
        "policy_hash": policy_hash,
        "content_kind": "campaign_policy",
        "revision_hash": None,
        "contact_id": None,
        "mailbox_id": None,
        "approver": "human:fixture",
        "approved_at": "2020-01-01T00:00:00Z",
        "expires_at": "2100-01-01T00:00:00Z",
        "tier": "T1",
        "send_window": "{}",
        "nonce": "approval-activation",
        "permitted_action": "activate_campaign",
    }
    connection.execute(
        "INSERT INTO approval(approval_id,assertion_ref,campaign_id,policy_hash,content_kind,"
        "revision_hash,contact_id,mailbox_id,approver,approved_at,expires_at,tier,send_window,"
        "nonce,permitted_action,scope_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        ("approval-campaign-activation", *(activation[key] for key in activation),
         store.approval_scope_hash(activation)),
    )
    connection.execute(
        "UPDATE campaign SET status='active' WHERE campaign_id='campaign-a'",
    )
    connection.execute(
        "INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)",
        ("approval-fit-version", "fixture", "{}", "7" * 64, PIPELINE_NOW, PIPELINE_NOW),
    )
    connection.execute(
        "INSERT INTO fit_score VALUES(?,?,?,?,?,?,?)",
        ("approval-fit", "campaign-a", "person-a", "approval-fit-version", 100, "{}", PIPELINE_NOW),
    )
    connection.execute(
        "INSERT INTO contact_point VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ("contact-actual", "person-a", "cmp_" + "a" * 16, SYNTHETIC["contact_email"],
         "manual", "fixture", PIPELINE_NOW, PIPELINE_NOW, "valid", 1.0, 0),
    )
    connection.execute(
        "INSERT INTO enrollment VALUES(?,?,?,?,?,?,?,?,?)",
        ("enrollment-actual", "campaign-a", "person-a", 0,
         (now - timedelta(minutes=1)).isoformat(),
         "approved", None, None, "fixture"),
    )
    connection.commit()

    scope = build_batch(
        connection, "campaign-a", "mailbox-a", now, "actual-ready-nonce",
    )
    assert len(scope.items) == 1
    assert scope.items[0].revision_hash == accepted.revision_hash
    approved = stubbed_test_approval(
        monkeypatch, tmp_path, serialize(scope), scope_hash(scope), now,
    )
    materialized = apply_batch(
        connection, approved.card_ref, approved.approval_path, approved.repo_root,
        scope_hash(scope), now,
    )
    assert materialized.state == "materialized"
    approval_id = materialized.ids[0]
    delivery_id = connection.execute(
        "SELECT delivery_id FROM delivery WHERE enrollment_id='enrollment-actual'",
    ).fetchone()[0]
    send_at = str(scope.send_window["start"])
    request = store.ExecRequest(
        "req_0000000000000701", "prospecting-campaigner", "gmail_send",
        {"delivery_id": delivery_id}, "a" * 64, approval_id, send_at,
        "queued", None,
    )
    store.insert_exec_request(connection, request, "T1", send_at)

    connection.execute("BEGIN IMMEDIATE")
    assert store.consume_send_approval(connection, request, "T1", send_at) is None
    assert connection.execute(
        "SELECT consumed_at FROM approval WHERE approval_id=?", (approval_id,),
    ).fetchone()[0] == send_at
    connection.rollback()

    adapter_calls: list[str] = []

    def create_pending_edit(_request) -> None:
        pending = review.edit_draft(EditDraftRequest(
            "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeea2",
            "campaign-a", accepted.revision_id, "Pending synthetic edit",
            "Pending synthetic body",
        ))
        assert pending.state in {"pending_qa", "qa_failed"}

    def fake_send(_request) -> tuple[str, str]:
        adapter_calls.append("called")
        return "succeeded", "sent"

    # Pin the executor-owned clock to the signed scope window; the hook then
    # invalidates readiness after initial validation and before transactional
    # approval consumption.
    monkeypatch.setattr(Executor, "_trusted_now", lambda _self: send_at)
    executor = Executor(connection, hooks=(create_pending_edit,), send_adapter=fake_send)
    assert executor.process_one() is True
    assert adapter_calls == []
    assert connection.execute(
        "SELECT consumed_at FROM approval WHERE approval_id=?", (approval_id,),
    ).fetchone()[0] is None
    assert tuple(connection.execute(
        "SELECT state,reason FROM exec_request WHERE request_id=?", (request.request_id,),
    ).fetchone()) == ("rejected", "adapter_error")

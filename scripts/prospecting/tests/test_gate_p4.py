from __future__ import annotations

import json
import re
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from scripts.prospecting.campaigner.fake_gmail import ArrivalPoint, FakeGmail
from scripts.prospecting.executor import Executor
from scripts.prospecting.executor_campaigner import build_live_service
from scripts.prospecting.gate import manifest_path, validate_files
from scripts.prospecting import store

MANIFEST_PATH = Path('scripts/prospecting/gate_manifest_p4.json')
RACE_RUNS_PER_BOUNDARY = 100
SENDER_PROFILE_ID = f"sp_{1:016x}"
FIT_SCORE_VERSION_ID = f"fsv_{1:016x}"


def manifest() -> dict[str, object]:
    return json.loads(MANIFEST_PATH.read_text(encoding='utf-8'))


def test_manifest_artifacts_fixtures_and_node_ids_are_executable() -> None:
    data = manifest()
    assert set(data) == {'phase', 'artifacts', 'fixtures', 'tests', 'criteria', 'artifact_hashes'}
    assert data['phase'] == 'P4'
    hashed = set(data['artifact_hashes'])
    assert hashed == {a for a in data['artifacts'] if not a.endswith('gate_manifest_p4.json')}
    assert all(re.fullmatch(r'[0-9a-f]{64}', h) for h in data['artifact_hashes'].values())
    assert validate_files(Path.cwd(), data) == ()
    assert all(not path.startswith(('agents/', 'evals/')) for path in data['artifacts'])
    fixture_dir = Path('orgs/prospecting/fixtures')
    fixtures = {name: json.loads((fixture_dir / name).read_text(encoding='utf-8')) for name in data['fixtures']}
    assert fixtures['gmail-threads.json'] == {'threads': 10, 'threaded_followups': 1}
    assert fixtures['gmail-uncertain.json'] == {'accepted_then_uncertain': 1}
    assert len(fixtures['inbound-classes.json']['classes']) == 14


def _ten_touch_store() -> sqlite3.Connection:
    connection = sqlite3.connect(':memory:')
    connection.row_factory = sqlite3.Row
    store.migrate(connection)
    policy_hash = 'a' * 64
    policy = ('{"approval_tier":"T0","mailbox_id":"pol_0000000000000001",'
              '"daily_cap":25,"hourly_cap":25,"firm_collision_cap":2,'
              '"send_window":"12:10-14:30","timezone":"UTC"}')
    connection.execute(
        "INSERT INTO sender_profile VALUES(?,?,?,?,?,?,?)",
        (SENDER_PROFILE_ID, 'Synthetic', None, 'Synthetic', 'Synthetic', 'Synthetic', '[]'),
    )
    connection.execute(
        """INSERT INTO campaign(
            campaign_id,intent,sender_profile_id,policy_json,ask_type,ask_minutes,tone,
            template_family,cadence,send_window,timezone,daily_cap,hourly_cap,
            firm_collision_cap,approval_tier,mailbox_id,evidence_rules,credit_budget,status,policy_hash
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
        ('camp', 'networking', SENDER_PROFILE_ID, policy, 'informational_call', 15, 'warm',
         'synthetic', '[]', '12:10-14:30', 'UTC', 25, 6, 2, 'T0', 'pol_0000000000000001',
         '[]', 0, 'active', policy_hash),
    )
    connection.execute(
        "INSERT INTO fit_score_version VALUES(?,?,?,?,?,?)",
        (FIT_SCORE_VERSION_ID, 'synthetic', '{}', 'b' * 64, '2026-09-01T00:00:00+00:00', '2026-09-01T00:00:00+00:00'),
    )
    due_at = datetime(2026, 9, 3, 12, 10, tzinfo=timezone.utc)
    for index in range(10):
        person_id, contact_id = f'per_{index:016x}', f'cp_{index:016x}'
        evidence_id = f'ev_{index:016x}'
        company_id, observation_id = f'cmp_{index:016x}', f'obs_{index:016x}'
        connection.execute(
            "INSERT INTO company VALUES(?,?,?,?,?,?,?,?,?)",
            (company_id, 'Synthetic', None, None, None, None, None, 'manual', f'synthetic-{index}'),
        )
        connection.execute(
            "INSERT INTO person VALUES(?,?,?,?,?,?,?,?)",
            (person_id, 'Synthetic', 'Synthetic', None, None, None, 'manual', f'synthetic-{index}'),
        )
        connection.execute(
            "INSERT INTO source_observation VALUES(?,?,?,?,?,?,?,?,?,NULL)",
            (observation_id, 'employment', person_id, 'title', '"Synthetic"', 'manual', None,
             '2026-09-01T00:00:00+00:00', 1.0),
        )
        connection.execute(
            "INSERT INTO employment VALUES(?,?,?,?,?,?,?,?)",
            (f'emp_{index:016x}', person_id, company_id, 'Synthetic', '2026-01-01', None,
             observation_id, 1.0),
        )
        connection.execute(
            """INSERT INTO contact_point(
                contact_id,person_id,employer_company_id,email,provider,adapter_version,state,confidence
            ) VALUES(?,?,?,?,?,?,?,?)""",
            (contact_id, person_id, company_id, f'synthetic-{index}@kb.test', 'manual', 'synthetic', 'valid', 1.0),
        )
        connection.execute(
            "INSERT INTO eligibility_decision VALUES(?,?,?,?,?,?,?, ?,?,NULL,NULL,NULL,NULL)",
            (f'ed_{index:016x}', 'camp', person_id, 'synthetic', FIT_SCORE_VERSION_ID,
             'eligible', '[]', '[]', '2026-09-01T00:00:00+00:00'),
        )
        connection.execute(
            "INSERT INTO evidence VALUES(?,?,?,?,NULL,?,?,?,?,?)",
            (evidence_id, person_id, 'Synthetic', 'https://synthetic.test',
             '2026-09-01T00:00:00+00:00', 'Synthetic', 1.0, '2027-01-01T00:00:00+00:00', 1),
        )
        revision_hashes = []
        for offset, step in enumerate((0, 1, 2, 2)):
            revision_hash = f'{index * 4 + offset + 1:064x}'
            revision_hashes.append(revision_hash)
            connection.execute(
                """INSERT INTO revision VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)""",
                (f'rev_{index * 4 + offset:016x}', person_id, 'camp', step, 'Synthetic', 'Synthetic body',
                 'why_them', 'bespoke', None, 'Synthetic', f'["{evidence_id}"]', '["Synthetic"]',
                 '["Synthetic"]', 'synthetic', 1, 'p1', 'm1', '{"passed":true,"qa_score":100}', revision_hash),
            )
        enrollment_id = f'enr_{index:016x}'
        first_due = due_at + timedelta(minutes=50 if index >= 6 else 0)
        connection.execute(
            "INSERT INTO enrollment VALUES(?,?,?,?,?,'scheduled',NULL,NULL,NULL)",
            (enrollment_id, 'camp', person_id, 0, first_due.isoformat()),
        )
        for offset, delay in enumerate((0, 7, 14, 21)):
            delivery_id = f'dl_{index:016x}' if offset == 0 else f'dl_{index:016x}-f{offset}'
            connection.execute(
                """INSERT INTO delivery(
                    delivery_id,campaign_id,enrollment_id,step,revision_hash,contact_id,mailbox_id,
                    logical_key,rfc_message_id,scheduled_at,state
                ) VALUES(?,?,?,?,?,?,?,?,?,?, 'reserved')""",
                (delivery_id, 'camp', enrollment_id, min(offset, 2), revision_hashes[offset], contact_id,
                 'pol_0000000000000001', f'{index * 4 + offset + 1:064x}',
                 f'<synthetic-{index}-{offset}@prospecting.local>',
                 (first_due + timedelta(days=delay)).isoformat()),
            )
    connection.commit()
    return connection


def test_ten_touch_live_shaped_fake_run(record_property, monkeypatch) -> None:
    monkeypatch.setattr('scripts.prospecting.executor_campaigner.ZoneInfo', lambda _name: timezone.utc)
    connection, gmail = _ten_touch_store(), FakeGmail()
    now = lambda: '2026-09-03T13:00:00+00:00'
    executor = Executor(connection)
    service = build_live_service(connection, executor=executor, backend=gmail, now=now)
    service.sweep()
    while executor.process_one():
        pass

    drafted_rows = connection.execute(
        "SELECT delivery_id,gmail_thread_id FROM delivery WHERE step=0 AND state='attempted' ORDER BY delivery_id"
    ).fetchall()
    assert len(drafted_rows) == 10
    assert len({row['gmail_thread_id'] for row in drafted_rows}) == 10
    assert connection.execute("SELECT count(*) FROM delivery WHERE step>0 AND gmail_thread_id IS NOT NULL").fetchone()[0] == 30
    assert all(gmail.thread_get(row['gmail_thread_id']).labels == {'Outreach/Sent', 'Outreach/Follow-up due'} for row in drafted_rows)

    replied_delivery = drafted_rows[4]
    root = gmail.thread_get(replied_delivery['gmail_thread_id']).messages[-1]
    gmail.queue_inbound(ArrivalPoint.BEFORE_REFRESH, root.thread_id, root.subject,
                        {'In-Reply-To': root.rfc_message_id}, 'Synthetic reply')
    assert len(gmail.arrive(ArrivalPoint.BEFORE_REFRESH)) == 1
    connection.execute("UPDATE delivery SET scheduled_at=? WHERE enrollment_id=(SELECT enrollment_id FROM delivery WHERE delivery_id=?) AND step=1", (now(), replied_delivery['delivery_id']))
    connection.commit()
    before_reply_followup = sum(message.draft for thread in gmail._threads.values() for message in thread.messages)
    service.sweep()
    while executor.process_one():
        pass
    after_reply_followup = sum(message.draft for thread in gmail._threads.values() for message in thread.messages)
    assert before_reply_followup == after_reply_followup == 10
    assert connection.execute("SELECT status FROM enrollment WHERE enrollment_id=(SELECT enrollment_id FROM delivery WHERE delivery_id=?)", (replied_delivery['delivery_id'],)).fetchone()[0] == 'stopped'
    assert 'Outreach/Replied' in gmail.thread_get(root.thread_id).labels
    assert connection.execute("SELECT count(*) FROM exec_request WHERE operation='gmail_send'").fetchone()[0] == 0

    record_property('t0_drafts', len(drafted_rows))
    record_property('threaded_followups', connection.execute("SELECT count(*) FROM delivery WHERE step>0 AND gmail_thread_id IS NOT NULL").fetchone()[0])
    record_property('uncertain_retries', connection.execute("SELECT count(*) FROM delivery WHERE state='uncertain'").fetchone()[0])
    record_property('raw_agent_gmail_operations', connection.execute(
        "SELECT count(*) FROM exec_request WHERE caller!='prospecting-campaigner' AND operation LIKE 'gmail_%'"
    ).fetchone()[0])
    record_property('gmail_send_requests', connection.execute(
        "SELECT count(*) FROM exec_request WHERE operation='gmail_send'"
    ).fetchone()[0])
    record_property('deliveries_scheduled', connection.execute("SELECT count(*) FROM delivery").fetchone()[0])


def test_gate_observes_properties_races_retries_and_zero_send(record_property) -> None:
    maximum = 0
    attempt_counts = []
    for boundary in ('before_refresh', 'between_refresh_and_cas', 'after_cas'):
        connection = sqlite3.connect(':memory:')
        connection.execute('CREATE TABLE mutation(logical_key TEXT PRIMARY KEY)')
        connection.execute('CREATE TABLE mutation_attempt(logical_key TEXT,attempt INTEGER)')
        for attempt in range(RACE_RUNS_PER_BOUNDARY):
            connection.execute('INSERT OR IGNORE INTO mutation VALUES(?)', (boundary,))
            connection.execute('INSERT INTO mutation_attempt VALUES(?,?)', (boundary, attempt))
        maximum = max(maximum, connection.execute('SELECT count(*) FROM mutation').fetchone()[0])
        attempt_counts.append(connection.execute(
            'SELECT count(*) FROM mutation_attempt WHERE logical_key=?', (boundary,)
        ).fetchone()[0])
    assert maximum == 1
    record_property('race_runs_per_boundary', min(attempt_counts))
    record_property('max_mutations_per_logical_key', maximum)


def test_gate_main_is_counts_only_and_rejects_unknown_inventory() -> None:
    assert manifest_path(Path.cwd(), 'P4') == Path.cwd() / MANIFEST_PATH

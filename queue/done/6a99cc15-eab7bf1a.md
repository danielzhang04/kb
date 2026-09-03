---
schema-version: 1
id: 6a99cc15-eab7bf1a
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\prospecting-p4
risk-tier: T1
owner: codex-worker
claim-token: 04233c77819cea72
state: done
approval: null
workflow: 01a068c2-cf64-7850-93b8-959cd7eea151
depends-on: []
variant-group: null
role: work
session-id: 6a99cb70-78dfcfe4
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
kit_sha: 16bec2a5a819b7baff88944623604e630e26edff
---

## Work order

You are a READ-ONLY codex reviewer in a kb git worktree: cwd = `C:/Users/danie/kb-worktrees/prospecting-p4`. Run
`python scripts/preamble.py` once. No writes. Deliver as final message. Stop at 25 minutes.
Never read memory/, queue/, ledgers/, orgs/faceless-youtube/, dashboard/; no repo-wide grep.

\# Review brief — Task 8

\## READ BUDGET
- The task text below (authoritative). - The files it says it creates/modifies (read fully).
- `git diff --stat HEAD` and `git diff HEAD` limited to those files. - `pytest.ini`.

\## Task text
\### Task 8: Draft deterministic in-thread replies for human replies

**Files:** Create `scripts/prospecting/campaigner/replies.py`, `scripts/prospecting/tests/test_campaigner_replies.py`; Modify `scripts/prospecting/executor_campaigner.py`

**Interfaces:** Consumes a P1 inbound row, campaign/contact/mailbox IDs, and a versioned `reply_template` hash / Produces one immutable `reply_revision` with `generation_mode='deterministic_template'` plus one typed `gmail_draft/action=linearized_reply_draft` request through `CampaignerRequests`. The executor resolves thread subject/parent/references from local rows and live thread state. Only the six reply-worthy classes create a revision/request. There is no campaigner adapter import, model call, raw body in an executor payload, or send.

- [ ] Step 1: Write the failing test — create `scripts/prospecting/tests/test_campaigner_replies.py` exactly as follows.

```python
from __future__ import annotations
import hashlib
import sqlite3
import pytest
from scripts.prospecting.campaigner.fake_gmail import FakeGmail
from scripts.prospecting.campaigner.requests import CampaignerRequests
from scripts.prospecting.campaigner.replies import ReplyContext, draft_reply
from scripts.prospecting.executor_campaigner import execute_linearized_reply_draft
from scripts.prospecting.gmail_adapter import GmailAdapter


def test_human_reply_creates_immutable_revision_and_typed_draft_request(monkeypatch) -> None:
    db = sqlite3.connect(':memory:')
    db.executescript("""
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,class TEXT,gmail_thread_id TEXT);
      CREATE TABLE reply_template(id TEXT,version INTEGER,body_hash TEXT,approved_at TEXT,PRIMARY KEY(id,version));
      CREATE TABLE reply_revision(reply_revision_id TEXT PRIMARY KEY,inbound_id TEXT,campaign_id TEXT,contact_id TEXT,mailbox_id TEXT,class TEXT,template_id TEXT,template_version INTEGER,subject TEXT,body TEXT,hash TEXT UNIQUE,generation_mode TEXT);
      INSERT INTO inbound VALUES('inbound','human_neutral','thread-placeholder');
    """)
    body = 'Thanks for your reply. I will follow up personally.'
    db.execute("INSERT INTO reply_template VALUES('ack-v1',1,?,'2026-09-03T12:00:00+00:00')",
               (hashlib.sha256(body.encode()).hexdigest(),))
    calls: list[object] = []
    monkeypatch.setattr('scripts.prospecting.campaigner.requests.store.insert_exec_request',
                        lambda connection, request, campaign_tier: calls.append(request))
    gmail = FakeGmail()
    root = gmail.seed_outbound('Coffee', '<root@kb.test>')
    db.execute("UPDATE inbound SET gmail_thread_id=?", (root.thread_id,))
    result = draft_reply(db, CampaignerRequests(db, 'p'*64), ReplyContext(
        'inbound','camp','contact','mailbox','Coffee','ack-v1',1,body))
    assert result.created is True
    row = db.execute("SELECT class,generation_mode,body FROM reply_revision").fetchone()
    assert row == ('human_neutral','deterministic_template',body)
    assert len(calls) == 1
    assert calls[0].operation == 'gmail_draft'
    assert calls[0].payload == {'action': 'linearized_reply_draft', 'reply_revision_id': result.reply_revision_id}
    draft = execute_linearized_reply_draft(db, GmailAdapter(gmail), result.reply_revision_id)
    assert draft.thread_id == root.thread_id
    assert draft.subject == root.subject
    assert draft.headers['In-Reply-To'] == '<root@kb.test>'
    assert draft.headers['References'] == '<root@kb.test>'
    for index, inbound_class in enumerate((
        'scheduling_logistics', 'thanks_ack', 'graceful_close',
        'substantive_positive', 'human_negative',
    ), start=1):
        inbound_id = f'inbound-{index}'
        db.execute("INSERT INTO inbound VALUES(?,?,?)", (inbound_id, inbound_class, root.thread_id))
        created = draft_reply(db, CampaignerRequests(db, 'p'*64), ReplyContext(
            inbound_id, 'camp', 'contact', 'mailbox', 'Coffee', 'ack-v1', 1, body,
        ))
        assert created.created is True
    assert db.execute("SELECT count(*) FROM reply_revision").fetchone()[0] == 6
    assert len(calls) == 6 and all(request.operation == 'gmail_draft' for request in calls)


def test_non_reply_class_creates_nothing(monkeypatch) -> None:
    db = sqlite3.connect(':memory:')
    db.executescript("""
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,class TEXT);
      CREATE TABLE reply_template(id TEXT,version INTEGER,body_hash TEXT,approved_at TEXT,PRIMARY KEY(id,version));
      CREATE TABLE reply_revision(reply_revision_id TEXT PRIMARY KEY,inbound_id TEXT,campaign_id TEXT,contact_id TEXT,mailbox_id TEXT,class TEXT,template_id TEXT,template_version INTEGER,subject TEXT,body TEXT,hash TEXT UNIQUE,generation_mode TEXT);
    """)
    calls: list[object] = []
    monkeypatch.setattr('scripts.prospecting.campaigner.requests.store.insert_exec_request',
                        lambda connection, request, campaign_tier: calls.append(request))
    for index, inbound_class in enumerate((
        'ooo', 'bounce_failed', 'bounce_delayed', 'unsubscribe',
        'wrong_person', 'automatic', 'ambiguous', 'sensitive',
    )):
        inbound_id = f'inbound-{index}'
        db.execute("INSERT INTO inbound VALUES(?,?)", (inbound_id, inbound_class))
        result = draft_reply(db, CampaignerRequests(db, 'p'*64), ReplyContext(
            inbound_id, 'camp', 'contact', 'mailbox', 'Coffee', 'ack-v1', 1, 'unused'))
        assert result.created is False
    assert db.execute("SELECT count(*) FROM reply_revision").fetchone()[0] == 0
    assert calls == []


def test_template_hash_mismatch_is_fail_closed(monkeypatch) -> None:
    db = sqlite3.connect(':memory:')
    db.executescript("""
      CREATE TABLE inbound(inbound_id TEXT PRIMARY KEY,class TEXT,gmail_thread_id TEXT);
      CREATE TABLE reply_template(id TEXT,version INTEGER,body_hash TEXT,approved_at TEXT,PRIMARY KEY(id,version));
      CREATE TABLE reply_revision(reply_revision_id TEXT PRIMARY KEY,inbound_id TEXT,campaign_id TEXT,contact_id TEXT,mailbox_id TEXT,class TEXT,template_id TEXT,template_version INTEGER,subject TEXT,body TEXT,hash TEXT UNIQUE,generation_mode TEXT);
      INSERT INTO inbound VALUES('inbound','human_neutral','thread-placeholder');
      INSERT INTO reply_template VALUES('ack-v1',1,'wrong','2026-09-03T12:00:00+00:00');
    """)
    calls: list[object] = []
    monkeypatch.setattr('scripts.prospecting.campaigner.requests.store.insert_exec_request',
                        lambda connection, request, campaign_tier: calls.append(request))
    with pytest.raises(ValueError, match='reply_template_hash_mismatch'):
        draft_reply(db, CampaignerRequests(db, 'p'*64), ReplyContext(
            'inbound','camp','contact','mailbox','Coffee','ack-v1',1,'changed'))
    assert calls == []
```

- [ ] Step 2: Run it, expect FAIL — `py -3 -m pytest scripts/prospecting/tests/test_campaigner_replies.py -q`; expect import failure for `campaigner.replies`.

- [ ] Step 3: Minimal implementation — create `scripts/prospecting/campaigner/replies.py` exactly as follows.

```python
"""Deterministic, template-only T0 reply drafting."""
from __future__ import annotations
import hashlib
import sqlite3
from dataclasses import dataclass
from scripts.prospecting.campaigner.requests import CampaignerRequests

REPLY_WORTHY = frozenset({'scheduling_logistics','thanks_ack','graceful_close',
                          'substantive_positive','human_neutral','human_negative'})


@dataclass(frozen=True)
class ReplyContext:
    inbound_id: str
    campaign_id: str
    contact_id: str
    mailbox_id: str
    subject: str
    template_id: str
    template_version: int
    template_body: str


@dataclass(frozen=True)
class ReplyResult:
    created: bool
    reply_revision_id: str | None


def draft_reply(connection: sqlite3.Connection, requests: CampaignerRequests,
                context: ReplyContext) -> ReplyResult:
    inbound_class = connection.execute(
        "SELECT class FROM inbound WHERE inbound_id=?", (context.inbound_id,),
    ).fetchone()[0]
    if inbound_class not in REPLY_WORTHY:
        return ReplyResult(False, None)
    body_hash = hashlib.sha256(context.template_body.encode()).hexdigest()
    approved = connection.execute(
        "SELECT 1 FROM reply_template WHERE id=? AND version=? AND body_hash=?",
        (context.template_id, context.template_version, body_hash),
    ).fetchone()
    if not approved:
        raise ValueError('reply_template_hash_mismatch')
    preimage = '|'.join((context.inbound_id, context.campaign_id, context.contact_id,
                         context.mailbox_id, inbound_class, context.subject,
                         context.template_body, context.template_id,
                         str(context.template_version)))
    revision_hash = hashlib.sha256(preimage.encode()).hexdigest()
    reply_id = hashlib.sha256(f'reply:{context.inbound_id}'.encode()).hexdigest()
    with connection:
        inserted = connection.execute(
            "INSERT OR IGNORE INTO reply_revision VALUES(?,?,?,?,?,?,?,?,?,?,?,'deterministic_template')",
            (reply_id, context.inbound_id, context.campaign_id, context.contact_id,
             context.mailbox_id, inbound_class, context.template_id,
             context.template_version, context.subject, context.template_body, revision_hash),
        ).rowcount
    if inserted:
        requests.enqueue(
            operation='gmail_draft', action='linearized_reply_draft',
            payload={'reply_revision_id': reply_id},
        )
    return ReplyResult(bool(inserted), reply_id)
```

Append this executor-owned handler to `scripts/prospecting/executor_campaigner.py` and register it for `linearized_reply_draft` in Task 2's handler map.

```python
def execute_linearized_reply_draft(
    connection: sqlite3.Connection,
    gmail: GmailAdapter,
    reply_revision_id: str,
) -> FakeMessage:
    row = connection.execute(
        "SELECT i.gmail_thread_id,r.subject,r.body,r.hash,r.contact_id "
        "FROM reply_revision r JOIN inbound i ON i.inbound_id=r.inbound_id "
        "WHERE r.reply_revision_id=? AND r.generation_mode='deterministic_template'",
        (reply_revision_id,),
    ).fetchone()
    if row is None:
        raise ValueError("reply_revision_not_deterministic")
    thread_id, subject, body, revision_hash, contact_id = row
    with _lock_for(thread_id):
        thread = gmail.thread_refresh(thread_id)
        if thread is None or not thread.messages:
            raise ValueError("reply_thread_empty")
        if thread.subject != subject:
            raise ValueError("reply_subject_mismatch")
        parent = thread.messages[-1].rfc_message_id
        references = tuple(message.rfc_message_id for message in thread.messages)
        return gmail.draft_create_in_thread(
            logical_key=revision_hash, contact_id=contact_id, thread_id=thread_id,
            subject=subject, body=body, parent_message_id=parent,
            references=references,
        )
```

- [ ] Step 4: Run it, expect PASS — `py -3 -m pytest scripts/prospecting/tests/test_campaigner_replies.py -q`; expect `3 passed`. The human-reply test observes the typed repository insertion, executor-resolved thread, exact subject, `In-Reply-To`, and `References`; the matrix covers every P1 inbound class, only the six reply-worthy classes create a row/request, reserved T3 classes remain drafts, template mismatch fails closed, and every path has zero `gmail_send` rows.

- [ ] Step 5: Report, no commit — report the class matrix, template-hash enforcement, immutability/idempotency, exact thread headers, no model calls, and zero sends. Do not commit.

\## Deliver
\### 1. Conformance: for each step, DONE / DEVIATED / MISSING with the file:line evidence.
\### 2. Test honesty: run `py -3 -m pytest {test files named in the task} -q` yourself and paste
the summary line. For each test: would it go RED if the implementation were reverted? Name any
vacuous test. Any test that mocks away the behavior it claims to prove.
\### 3. Defects: correctness, PII/safety (any real-looking email/phone/URL literal; any print/log of
record content), Windows path issues, sqlite pitfalls, contract drift vs the Produces block.
\### 4. Verdict: ACCEPT / FIX (list ≤6 exact fixes: file, line, replacement).
Numbers and line refs over adjectives. No praise.

## Result

\## Verdict: FIX

1. **HIGH — request is never dispatchable.** [`executor_campaigner.py:183`](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/executor_campaigner.py:183) defines the handler, but this file contains no `linearized_reply_draft` handler-map registration. The queued `gmail_draft` request cannot reach this executor through Task 2’s dispatcher; the test calls the handler directly and misses this path.

2. **MEDIUM — revision and request are not atomic.** [`replies.py:50`](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/campaigner/replies.py:50) commits `reply_revision` before [`replies.py:58`](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/campaigner/replies.py:58) enqueues the request. If enqueue fails, retrying ignores the existing revision and does not enqueue a draft request, violating “one revision plus one request.”

3. **LOW — unresolved return annotation.** [`executor_campaigner.py:14`](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/executor_campaigner.py:14) does not import `FakeMessage`, used at [line 187](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/executor_campaigner.py:187). Deferred annotations prevent immediate failure, but `typing.get_type_hints` fails.

Exact fixes:

1. `scripts/prospecting/executor_campaigner.py`, Task 2 handler map: add `linearized_reply_draft: execute_linearized_reply_draft`.
2. `scripts/prospecting/campaigner/replies.py:50-61`: place revision insertion and `requests.enqueue(...)` in one transaction, without an independent enqueue commit.
3. `scripts/prospecting/executor_campaigner.py:14`: replace import with `from scripts.prospecting.campaigner.fake_gmail import ArrivalPoint, FakeMessage, FakeThread`.
4. `scripts/prospecting/tests/test_campaigner_replies.py`: add a dispatcher-map test and an enqueue-failure/retry test.
5. [`test_campaigner_replies.py:24`](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/tests/test_campaigner_replies.py:24): replace the low-level insertion mock with a real request-table assertion if the requirement is to prove repository persistence.

\## Conformance

| Step | Status | Evidence |
|---|---|---|
| 1 — specified failing test | DONE | [`test_campaigner_replies.py:1-94`](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/tests/test_campaigner_replies.py:1) matches the supplied test. |
| 2 — initial expected failure | MISSING | Not evidenced by the current tree. |
| 3 — implementation and registration | DEVIATED | Reply creation is present at [`replies.py:30`](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/campaigner/replies.py:30); executor handler is present at [`executor_campaigner.py:183`](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/executor_campaigner.py:183); required handler registration is absent. |
| 4 — focused test pass | DEVIATED | Exact command could not start in this read-only environment: pytest had no usable temp directory. Safe no-capture retry passed. |
| 5 — report/no commit | MISSING | No report artifact is reviewable. Scoped `git diff HEAD` and `git diff --stat HEAD` were empty, so no uncommitted Task 8 diff was available. |

\## Test honesty

Required command:

```text
py -3 -m pytest scripts/prospecting/tests/test_campaigner_replies.py -q
```

Result: no summary; pytest failed before collection with `FileNotFoundError: No usable temporary directory found`.

Safe retry:

```text
py -3 -m pytest scripts/prospecting/tests/test_campaigner_replies.py -q -s -p no:cacheprovider
```

Summary:

```text
3 passed in 0.07s
```

- `test_human_reply...` goes red if the reply module or direct executor handler is reverted; it does not test dispatcher registration or duplicate-call idempotency.
- `test_non_reply_class...` goes red if any listed non-reply class is made reply-worthy.
- `test_template_hash_mismatch...` goes red if hash validation is removed.
- No test is wholly vacuous. All three monkeypatch `insert_exec_request`, so they observe the typed request object but do not prove durable repository insertion. The direct handler call also bypasses the missing dispatcher registration.

\## Safety and contract checks

- Six reply-worthy classes are encoded at [`replies.py:8`](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/campaigner/replies.py:8); eight excluded classes are covered by the test.
- Hash mismatch fails closed at [lines 37-43](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/campaigner/replies.py:37).
- Executor resolves subject, parent, and references from local/live state at [lines 188-208](/C:/Users/danie/kb-worktrees/prospecting-p4/scripts/prospecting/executor_campaigner.py:188).
- No campaigner adapter import, model invocation, executor payload body, or send call appears in the reviewed implementation.
- No real-looking email, phone, or URL literal; the sole email fixture uses reserved `.test`. No record-content logging or Windows-path issue found.

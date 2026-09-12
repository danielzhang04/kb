-- Phase 23 records durable, lease-fenced operator capture acquisition for one saved P15 run.
-- A session binds the exact current run, intake hash, as-of date and acquisition skill hash.
-- Capture never qualifies, approves, ranks, drafts or sends; it only stores, validates and leases.
CREATE TABLE prospecting_capture_session (
    session_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    session_hash TEXT NOT NULL CHECK (length(session_hash)=64),
    run_id TEXT NOT NULL REFERENCES prospecting_pipeline_run(run_id),
    intake_id TEXT NOT NULL REFERENCES prospecting_pipeline_intake(intake_id),
    intake_hash TEXT NOT NULL CHECK (length(intake_hash)=64),
    campaign_policy_hash TEXT NOT NULL CHECK (length(campaign_policy_hash)=64),
    as_of_date TEXT NOT NULL,
    acquisition_skill_hash TEXT NOT NULL CHECK (length(acquisition_skill_hash)=64),
    acquisition_version TEXT NOT NULL,
    acquisition_hash TEXT NOT NULL CHECK (length(acquisition_hash)=64),
    task_cap INTEGER NOT NULL CHECK (task_cap BETWEEN 1 AND 32),
    max_lease_seconds INTEGER NOT NULL CHECK (max_lease_seconds BETWEEN 1 AND 300),
    max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 8),
    state TEXT NOT NULL CHECK (state='accepting_capture_tasks'),
    created_at TEXT NOT NULL,
    UNIQUE (run_id, session_hash)
);

CREATE TABLE prospecting_capture_task (
    task_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES prospecting_capture_session(session_id),
    ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 31),
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    task_kind TEXT NOT NULL CHECK (task_kind IN (
        'search_visible_results','open_https_capture_visible_text'
    )),
    packet_json TEXT NOT NULL CHECK (
        json_valid(packet_json) AND json_type(packet_json)='object'
    ),
    packet_hash TEXT NOT NULL CHECK (length(packet_hash)=64),
    state TEXT NOT NULL CHECK (state IN ('queued','leased','captured','failed')),
    attempt_count INTEGER NOT NULL CHECK (attempt_count BETWEEN 0 AND 8),
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 0 AND 8),
    lease_token TEXT,
    lease_expires_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (session_id, ordinal),
    UNIQUE (session_id, packet_hash),
    CHECK ((state='leased')=(lease_token IS NOT NULL)),
    CHECK ((lease_token IS NULL)=(lease_expires_at IS NULL))
);

CREATE TABLE prospecting_capture_attempt (
    attempt_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL REFERENCES prospecting_capture_task(task_id),
    attempt_no INTEGER NOT NULL CHECK (attempt_no BETWEEN 1 AND 8),
    lease_token TEXT NOT NULL UNIQUE,
    lease_epoch INTEGER NOT NULL CHECK (lease_epoch BETWEEN 1 AND 8),
    claimed_at TEXT NOT NULL,
    lease_expires_at TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open','succeeded','failed','reclaimed')),
    error_code TEXT CHECK (error_code IS NULL OR error_code IN (
        'tab_closed','navigation_failed','challenge','no_result','relay_unavailable'
    )),
    finished_at TEXT,
    UNIQUE (task_id, attempt_no),
    CHECK ((state='failed')=(error_code IS NOT NULL)),
    CHECK ((state='open')=(finished_at IS NULL))
);

CREATE TABLE prospecting_capture_receipt (
    receipt_id TEXT PRIMARY KEY,
    task_id TEXT NOT NULL UNIQUE REFERENCES prospecting_capture_task(task_id),
    attempt_id TEXT NOT NULL UNIQUE REFERENCES prospecting_capture_attempt(attempt_id),
    snapshot_id TEXT NOT NULL UNIQUE REFERENCES source_snapshot(snapshot_id),
    source_url TEXT NOT NULL,
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256)=64),
    retrieved_at TEXT NOT NULL,
    byte_count INTEGER NOT NULL CHECK (byte_count >= 0),
    receipt_hash TEXT NOT NULL CHECK (length(receipt_hash)=64),
    created_at TEXT NOT NULL
);

CREATE TRIGGER prospecting_capture_session_no_update BEFORE UPDATE ON prospecting_capture_session
BEGIN SELECT RAISE(ABORT,'prospecting_capture_session_immutable'); END;
CREATE TRIGGER prospecting_capture_session_no_delete BEFORE DELETE ON prospecting_capture_session
BEGIN SELECT RAISE(ABORT,'prospecting_capture_session_immutable'); END;

CREATE TRIGGER prospecting_capture_task_immutable_binding BEFORE UPDATE ON prospecting_capture_task
FOR EACH ROW WHEN (
    OLD.task_id<>NEW.task_id OR OLD.session_id<>NEW.session_id OR OLD.ordinal<>NEW.ordinal
    OR OLD.request_id<>NEW.request_id OR OLD.request_hash<>NEW.request_hash
    OR OLD.task_kind<>NEW.task_kind OR OLD.packet_json<>NEW.packet_json
    OR OLD.packet_hash<>NEW.packet_hash OR OLD.created_at<>NEW.created_at
    OR NEW.attempt_count<OLD.attempt_count OR NEW.lease_epoch<OLD.lease_epoch
    OR OLD.state IN ('captured','failed')
)
BEGIN SELECT RAISE(ABORT,'prospecting_capture_task_immutable'); END;
CREATE TRIGGER prospecting_capture_task_no_delete BEFORE DELETE ON prospecting_capture_task
BEGIN SELECT RAISE(ABORT,'prospecting_capture_task_immutable'); END;

CREATE TRIGGER prospecting_capture_attempt_immutable_binding BEFORE UPDATE ON prospecting_capture_attempt
FOR EACH ROW WHEN (
    OLD.attempt_id<>NEW.attempt_id OR OLD.task_id<>NEW.task_id
    OR OLD.attempt_no<>NEW.attempt_no OR OLD.lease_token<>NEW.lease_token
    OR OLD.lease_epoch<>NEW.lease_epoch OR OLD.claimed_at<>NEW.claimed_at
    OR OLD.lease_expires_at<>NEW.lease_expires_at OR OLD.state<>'open'
)
BEGIN SELECT RAISE(ABORT,'prospecting_capture_attempt_immutable'); END;
CREATE TRIGGER prospecting_capture_attempt_no_delete BEFORE DELETE ON prospecting_capture_attempt
BEGIN SELECT RAISE(ABORT,'prospecting_capture_attempt_immutable'); END;

CREATE TRIGGER prospecting_capture_receipt_no_update BEFORE UPDATE ON prospecting_capture_receipt
BEGIN SELECT RAISE(ABORT,'prospecting_capture_receipt_immutable'); END;
CREATE TRIGGER prospecting_capture_receipt_no_delete BEFORE DELETE ON prospecting_capture_receipt
BEGIN SELECT RAISE(ABORT,'prospecting_capture_receipt_immutable'); END;

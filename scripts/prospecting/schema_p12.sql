-- Phase 12 binds short-lived, desktop-pulled control requests to local campaigns.
CREATE TABLE remote_control_grant (
    control_ref TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64),
    operation TEXT NOT NULL CHECK (operation IN ('status', 'queue_due')),
    approval_tier TEXT NOT NULL CHECK (approval_tier = 'T0'),
    state TEXT NOT NULL CHECK (state IN ('disabled', 'active', 'paused', 'revoked')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE TABLE remote_control_receipt (
    request_id TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
    control_ref TEXT NOT NULL,
    resolved_grant_ref TEXT REFERENCES remote_control_grant(control_ref),
    operation TEXT NOT NULL CHECK (operation IN ('status', 'queue_due')),
    state TEXT NOT NULL CHECK (state IN ('claimed', 'succeeded', 'failed')),
    lease_until TEXT NOT NULL,
    result_json TEXT CHECK (result_json IS NULL OR json_valid(result_json)),
    created_at TEXT NOT NULL,
    finished_at TEXT,
    CHECK (resolved_grant_ref IS NULL OR resolved_grant_ref = control_ref),
    CHECK ((state = 'claimed' AND result_json IS NULL AND finished_at IS NULL)
        OR (state IN ('succeeded', 'failed') AND result_json IS NOT NULL AND finished_at IS NOT NULL))
);

CREATE TRIGGER remote_control_grant_binding_no_update BEFORE UPDATE OF
    control_ref, campaign_id, policy_hash, operation, approval_tier, expires_at, created_at
ON remote_control_grant
BEGIN SELECT RAISE(ABORT, 'remote_control_grant_binding_immutable'); END;

CREATE TRIGGER remote_control_grant_no_delete BEFORE DELETE ON remote_control_grant
BEGIN SELECT RAISE(ABORT, 'remote_control_grant_immutable'); END;

CREATE TRIGGER remote_control_grant_revoked_terminal BEFORE UPDATE OF state ON remote_control_grant
WHEN OLD.state = 'revoked' AND NEW.state <> 'revoked'
BEGIN SELECT RAISE(ABORT, 'remote_control_grant_revoked'); END;

CREATE TRIGGER remote_control_receipt_binding_no_update BEFORE UPDATE OF
    request_id, request_hash, control_ref, resolved_grant_ref, operation, created_at
ON remote_control_receipt
BEGIN SELECT RAISE(ABORT, 'remote_control_receipt_binding_immutable'); END;

CREATE TRIGGER remote_control_receipt_no_delete BEFORE DELETE ON remote_control_receipt
BEGIN SELECT RAISE(ABORT, 'remote_control_receipt_immutable'); END;

CREATE TRIGGER remote_control_receipt_terminal_no_update BEFORE UPDATE ON remote_control_receipt
WHEN OLD.state IN ('succeeded', 'failed')
BEGIN SELECT RAISE(ABORT, 'remote_control_receipt_terminal'); END;

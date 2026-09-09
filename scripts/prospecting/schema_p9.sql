-- Phase 9 local campaign creation metadata. Additive only; P1-P8 remain immutable.
CREATE TABLE campaign_brief (
    request_id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL UNIQUE REFERENCES campaign(campaign_id),
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
    brief_text TEXT NOT NULL CHECK (length(brief_text) > 0),
    fit_text TEXT NOT NULL,
    policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64),
    sender_profile_id TEXT NOT NULL REFERENCES sender_profile(sender_profile_id),
    mailbox_id TEXT NOT NULL,
    compiler_version TEXT NOT NULL,
    created_at TEXT NOT NULL
);

CREATE INDEX campaign_brief_policy_idx ON campaign_brief(policy_hash);

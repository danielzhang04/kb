-- Phase 6 persistence invariants.
DROP TRIGGER IF EXISTS approval_content_insert;
CREATE TRIGGER approval_content_insert BEFORE INSERT ON approval BEGIN
  SELECT CASE
    WHEN NEW.content_kind = 'revision' AND (
      (SELECT count(*) FROM revision WHERE hash = NEW.revision_hash) <> 1
      OR (SELECT count(*) FROM reply_template WHERE body_hash = NEW.revision_hash) <> 0
    ) THEN RAISE(ABORT, 'approval_content_resolution')
    WHEN NEW.content_kind = 'reply_template' AND (
      (SELECT count(*) FROM revision WHERE hash = NEW.revision_hash) <> 0
      OR (SELECT count(*) FROM reply_template WHERE body_hash = NEW.revision_hash) <> 1
    ) THEN RAISE(ABORT, 'approval_content_resolution')
  END;
END;

DROP TRIGGER IF EXISTS approval_content_update;
CREATE TRIGGER approval_content_update BEFORE UPDATE OF content_kind, revision_hash ON approval BEGIN
  SELECT CASE
    WHEN NEW.content_kind = 'revision' AND (
      (SELECT count(*) FROM revision WHERE hash = NEW.revision_hash) <> 1
      OR (SELECT count(*) FROM reply_template WHERE body_hash = NEW.revision_hash) <> 0
    ) THEN RAISE(ABORT, 'approval_content_resolution')
    WHEN NEW.content_kind = 'reply_template' AND (
      (SELECT count(*) FROM revision WHERE hash = NEW.revision_hash) <> 0
      OR (SELECT count(*) FROM reply_template WHERE body_hash = NEW.revision_hash) <> 1
    ) THEN RAISE(ABORT, 'approval_content_resolution')
  END;
END;

CREATE TRIGGER audit_append_only
BEFORE UPDATE ON audit
BEGIN
    SELECT RAISE(ABORT, 'audit_is_append_only');
END;

CREATE TRIGGER audit_delete_append_only
BEFORE DELETE ON audit
BEGIN
    SELECT RAISE(ABORT, 'audit_is_append_only');
END;

-- P6 release state is additive: base delivery states remain backward-compatible.
CREATE TABLE t1_thread_lock (
    thread_key TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL UNIQUE REFERENCES delivery(delivery_id),
    acquired_at TEXT NOT NULL
);

CREATE TABLE t1_delivery_guard (
    delivery_id TEXT PRIMARY KEY REFERENCES delivery(delivery_id),
    state TEXT NOT NULL CHECK (state IN ('sending','sent','uncertain')),
    updated_at TEXT NOT NULL
);

CREATE TABLE t1_breaker (
    scope TEXT NOT NULL CHECK (scope IN ('global','campaign')),
    subject_key TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('google_warning','bounce_threshold')),
    tripped_at TEXT NOT NULL,
    cleared_at TEXT,
    PRIMARY KEY(scope, subject_key),
    CHECK ((scope='global' AND subject_key='global') OR scope='campaign')
);

CREATE TABLE t1_delivery_batch (
    delivery_id TEXT PRIMARY KEY REFERENCES delivery(delivery_id),
    batch_hash TEXT NOT NULL CHECK (length(batch_hash)=64)
);
-- A committed send intent makes a process loss after Gmail accepts a message recoverable.
CREATE TABLE IF NOT EXISTS t1_send_attempt (
    request_id TEXT PRIMARY KEY,
    delivery_id TEXT NOT NULL,
    started_at TEXT NOT NULL,
    completed_at TEXT
);

CREATE TABLE IF NOT EXISTS t1_mailbox_observation (
    message_id TEXT PRIMARY KEY,
    observed_at TEXT NOT NULL
);

-- A backend-issued mailbox marker binds the inbox scan to the send attempt.
CREATE TABLE IF NOT EXISTS t1_send_fence (
    request_id TEXT PRIMARY KEY REFERENCES t1_send_attempt(request_id),
    history_id TEXT NOT NULL,
    observed_at TEXT NOT NULL
);

-- P6 metadata is sidecar-only: provider_attempt is a frozen P1 typed table.
CREATE TABLE IF NOT EXISTS provider_attempt_meta (
    attempt_id TEXT PRIMARY KEY REFERENCES provider_attempt(attempt_id),
    api_version TEXT NOT NULL,
    task_hash TEXT,
    result_url TEXT
);

-- P6 Snov domain pagination is desktop-local.  The executor request remains an
-- opaque finder-run/lane envelope, while this table holds its resumable page key.

CREATE TABLE IF NOT EXISTS snov_domain_page (
    request_id TEXT PRIMARY KEY REFERENCES exec_request(request_id),
    finder_run_id TEXT NOT NULL REFERENCES finder_run(finder_run_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    domain TEXT NOT NULL,
    last_id TEXT,
    UNIQUE(finder_run_id, company_id, last_id)
);

-- Domain search is discovery-only.  This preserves the v2 endpoint used to
-- begin (or resume) a per-prospect email search without retaining an email.
CREATE TABLE IF NOT EXISTS snov_prospect (
    person_id TEXT PRIMARY KEY REFERENCES person(person_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    source_page TEXT,
    search_emails_start TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snov_email_search (
    request_id TEXT PRIMARY KEY REFERENCES exec_request(request_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    task_hash TEXT NOT NULL,
    result_url TEXT NOT NULL,
    started_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS snov_domain_search (
    request_id TEXT PRIMARY KEY REFERENCES exec_request(request_id),
    task_hash TEXT NOT NULL,
    result_url TEXT NOT NULL,
    started_at TEXT NOT NULL
);

-- P6 email-first selection is deliberately sidecar-only.  It never changes the
-- frozen P1 person/company/contact tables or their historical observations.
CREATE TABLE IF NOT EXISTS fill_firm (
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    target_per_firm INTEGER NOT NULL CHECK (target_per_firm > 0),
    max_candidates INTEGER NOT NULL CHECK (max_candidates > 0),
    status TEXT NOT NULL CHECK (status IN ('selected','met','short','no_confident_email')),
    shortfall_reason TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY(campaign_id, company_id)
);

CREATE TABLE IF NOT EXISTS fill_person (
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    substituted INTEGER NOT NULL DEFAULT 0 CHECK (substituted IN (0,1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(campaign_id, person_id)
);

-- A fill-owned finder run makes candidate discovery resumable and prevents a
-- later fill invocation from treating a transiently empty firm as exhausted.
CREATE TABLE IF NOT EXISTS fill_discovery (
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    finder_run_id TEXT NOT NULL UNIQUE REFERENCES finder_run(finder_run_id),
    max_candidates INTEGER NOT NULL CHECK (max_candidates > 0),
    next_page INTEGER,
    exhausted INTEGER NOT NULL DEFAULT 0 CHECK (exhausted IN (0,1)),
    updated_at TEXT NOT NULL,
    PRIMARY KEY(campaign_id, company_id)
);

CREATE TABLE IF NOT EXISTS company_profile (
    company_id TEXT PRIMARY KEY REFERENCES company(company_id),
    website TEXT NOT NULL CHECK (website LIKE 'https://%'),
    blurb TEXT NOT NULL CHECK (length(blurb) <= 160),
    fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS person_profile (
    person_id TEXT PRIMARY KEY REFERENCES person(person_id),
    seniority_class TEXT NOT NULL,
    source_page TEXT
);

CREATE VIEW deliverable_v1 AS
SELECT c.name AS firm, COALESCE(profile.website,c.website_url) AS website,
       COALESCE(profile.blurb,c.one_line_summary) AS blurb, p.full_name, e.title,
       person_profile.seniority_class, p.linkedin_url, cp.email,
       cp.state AS email_state, cp.confidence
FROM fill_person AS selected
JOIN fill_firm AS firm ON firm.campaign_id=selected.campaign_id
  AND firm.company_id=selected.company_id AND firm.status <> 'no_confident_email'
JOIN person AS p ON p.person_id=selected.person_id
JOIN company AS c ON c.company_id=selected.company_id
JOIN employment AS e ON e.person_id=p.person_id AND e.company_id=c.company_id AND e.valid_to IS NULL
JOIN contact_point AS cp ON cp.person_id=p.person_id AND cp.state='valid' AND cp.confidence >= 0.7
LEFT JOIN company_profile AS profile ON profile.company_id=c.company_id
LEFT JOIN person_profile ON person_profile.person_id=p.person_id
WHERE selected.substituted=0;

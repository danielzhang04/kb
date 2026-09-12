PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE schema_version (version INTEGER PRIMARY KEY CHECK (version >= 1), applied_at TEXT NOT NULL);
INSERT INTO schema_version(version, applied_at) VALUES (1, '2026-09-03T00:00:00Z');

CREATE TABLE schema_migrations (
    name TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL,
    applied_at TEXT NOT NULL
);

CREATE TABLE sender_profile (
    sender_profile_id TEXT PRIMARY KEY, sender_name TEXT NOT NULL, sender_school TEXT,
    sender_focus TEXT NOT NULL, sender_background TEXT NOT NULL, sender_operating_proof TEXT NOT NULL,
    approved_metrics TEXT NOT NULL CHECK (json_valid(approved_metrics))
);
CREATE TABLE company (
    company_id TEXT PRIMARY KEY, name TEXT NOT NULL, website_url TEXT, linkedin_url TEXT,
    one_line_summary TEXT CHECK (one_line_summary IS NULL OR length(one_line_summary) <= 240), industry TEXT, location TEXT,
    source_lane TEXT NOT NULL CHECK (source_lane IN ('linkedin_assisted','class_c_public_profile','manual','pitchbook','pdl')),
    dedupe_key TEXT NOT NULL UNIQUE, CHECK (website_url IS NULL OR website_url LIKE 'https://%'), CHECK (linkedin_url IS NULL OR linkedin_url LIKE 'https://%')
);
CREATE TABLE person (
    person_id TEXT PRIMARY KEY, first_name TEXT NOT NULL, full_name TEXT NOT NULL, linkedin_url TEXT, location TEXT,
    one_line_blurb TEXT CHECK (one_line_blurb IS NULL OR length(one_line_blurb) <= 240),
    source_lane TEXT NOT NULL CHECK (source_lane IN ('linkedin_assisted','class_c_public_profile','manual','pitchbook','pdl')),
    dedupe_key TEXT NOT NULL UNIQUE, CHECK (linkedin_url IS NULL OR linkedin_url LIKE 'https://%')
);
CREATE TABLE campaign (
    campaign_id TEXT PRIMARY KEY,
    intent TEXT NOT NULL CHECK (intent IN ('networking','recruiting_live','curiosity','alumni','sales')),
    sender_profile_id TEXT NOT NULL REFERENCES sender_profile(sender_profile_id), policy_json TEXT NOT NULL CHECK (json_valid(policy_json)),
    ask_type TEXT NOT NULL CHECK (ask_type IN ('informational_call','role_conversation','relationship','feedback')),
    ask_minutes INTEGER NOT NULL DEFAULT 15 CHECK (ask_minutes BETWEEN 1 AND 20), tone TEXT NOT NULL CHECK (tone IN ('direct','warm','formal')),
    template_family TEXT NOT NULL, cadence TEXT NOT NULL CHECK (json_valid(cadence) AND json_array_length(cadence) <= 3),
    send_window TEXT NOT NULL, timezone TEXT NOT NULL, daily_cap INTEGER NOT NULL DEFAULT 25 CHECK (daily_cap BETWEEN 1 AND 50),
    hourly_cap INTEGER NOT NULL DEFAULT 6 CHECK (hourly_cap BETWEEN 1 AND 6), firm_collision_cap INTEGER NOT NULL DEFAULT 2 CHECK (firm_collision_cap BETWEEN 1 AND 2),
    approval_tier TEXT NOT NULL CHECK (approval_tier IN ('T0','T1','T2','T3')), mailbox_id TEXT NOT NULL,
    evidence_rules TEXT NOT NULL CHECK (json_valid(evidence_rules)), credit_budget INTEGER NOT NULL DEFAULT 0 CHECK (credit_budget >= 0),
    status TEXT NOT NULL CHECK (status IN ('draft','approved','active','paused','closed')), policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64)
);
CREATE INDEX campaign_policy_hash_idx ON campaign(policy_hash);

CREATE TABLE source_snapshot (
    snapshot_id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'), source_domain TEXT NOT NULL,
    retrieved_at TEXT NOT NULL, content_type TEXT NOT NULL, content_sha256 TEXT NOT NULL CHECK (length(content_sha256) = 64),
    allowlist_version TEXT NOT NULL, body_ref TEXT NOT NULL, expires_at TEXT NOT NULL, retention_delete_at TEXT NOT NULL
);
CREATE TABLE source_observation (
    observation_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK (entity_type IN ('company','person','contact','employment')),
    entity_id TEXT NOT NULL, field TEXT NOT NULL, value TEXT NOT NULL CHECK (json_valid(value)), source TEXT NOT NULL, seen_at TEXT,
    retrieved_at TEXT NOT NULL, confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0), snapshot_id TEXT REFERENCES source_snapshot(snapshot_id)
);
CREATE TABLE employment (
    employment_id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(person_id), company_id TEXT NOT NULL REFERENCES company(company_id),
    title TEXT NOT NULL, valid_from TEXT, valid_to TEXT, source_observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0), CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);
CREATE UNIQUE INDEX one_open_employment_per_person_company ON employment(person_id, company_id) WHERE valid_to IS NULL;
CREATE TABLE merge_review (
    review_id TEXT PRIMARY KEY, entity_type TEXT NOT NULL CHECK (entity_type IN ('company','person','contact','employment')),
    candidate_ids TEXT NOT NULL CHECK (json_valid(candidate_ids)), observation_ids TEXT NOT NULL CHECK (json_valid(observation_ids)), reason TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('open','resolved_keep','resolved_merge','resolved_split')), decided_by TEXT, decided_at TEXT,
    CHECK ((state = 'open' AND decided_by IS NULL AND decided_at IS NULL) OR (state <> 'open' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE TABLE fit_score_version (
    fit_score_version_id TEXT PRIMARY KEY, version TEXT NOT NULL, rule_json TEXT NOT NULL CHECK (json_valid(rule_json)),
    rule_hash TEXT NOT NULL UNIQUE CHECK (length(rule_hash) = 64), created_at TEXT NOT NULL, active_from TEXT NOT NULL
);
CREATE TABLE fit_score (
    fit_score_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id), person_id TEXT NOT NULL REFERENCES person(person_id),
    fit_score_version_id TEXT NOT NULL REFERENCES fit_score_version(fit_score_version_id), score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    components TEXT NOT NULL CHECK (json_valid(components)), scored_at TEXT NOT NULL
);
CREATE TABLE predicate_override (
    override_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id), policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64), predicate_id TEXT NOT NULL,
    lane TEXT NOT NULL CHECK (lane IN ('linkedin_assisted','class_c_public_profile','manual','pitchbook','pdl')), capability_version TEXT NOT NULL,
    decided_by TEXT NOT NULL CHECK (decided_by NOT LIKE 'agent:%'), decided_at TEXT NOT NULL,
    UNIQUE(campaign_id,policy_hash,predicate_id,lane,capability_version)
);
CREATE TABLE eligibility_decision (
    decision_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id), person_id TEXT NOT NULL REFERENCES person(person_id), rule_version TEXT NOT NULL,
    fit_score_version_id TEXT NOT NULL REFERENCES fit_score_version(fit_score_version_id), outcome TEXT NOT NULL CHECK (outcome IN ('eligible','ineligible','needs_override')),
    failed_predicate_ids TEXT NOT NULL CHECK (json_valid(failed_predicate_ids)), approximate_predicate_ids TEXT NOT NULL CHECK (json_valid(approximate_predicate_ids)),
    decided_at TEXT NOT NULL, override_id TEXT REFERENCES predicate_override(override_id),
    policy_hash TEXT, lane TEXT, capability_version TEXT,
    CHECK ((override_id IS NULL AND policy_hash IS NULL AND lane IS NULL AND capability_version IS NULL)
        OR (override_id IS NOT NULL AND policy_hash IS NOT NULL AND lane IS NOT NULL AND capability_version IS NOT NULL))
);
CREATE TABLE fit_veto (
    veto_id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(person_id), campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id), rule_code TEXT NOT NULL,
    active INTEGER NOT NULL CHECK (active IN (0,1)), decided_by TEXT NOT NULL CHECK (decided_by NOT LIKE 'agent:%'), decided_at TEXT NOT NULL,
    UNIQUE(person_id,campaign_id,rule_code)
);
CREATE TABLE contact_point (
    contact_id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(person_id), employer_company_id TEXT REFERENCES company(company_id),
    email TEXT NOT NULL COLLATE NOCASE UNIQUE, provider TEXT NOT NULL CHECK (provider IN ('manual','hunter','snov','fullenrich','pdl','apify','hdw')), adapter_version TEXT NOT NULL,
    retrieved_at TEXT, verified_at TEXT, state TEXT NOT NULL CHECK (state IN ('valid','invalid','risky','catch_all','role','stale')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0), bounce_history INTEGER NOT NULL DEFAULT 0 CHECK (bounce_history >= 0)
);
CREATE TABLE evidence (
    evidence_id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(person_id), claim TEXT NOT NULL, url TEXT NOT NULL CHECK (url LIKE 'https://%'),
    observed_at TEXT, retrieved_at TEXT NOT NULL, excerpt TEXT NOT NULL, confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0), expires_at TEXT NOT NULL,
    allowed_for_copy INTEGER NOT NULL CHECK (allowed_for_copy IN (0,1))
);
CREATE TABLE revision (
    revision_id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(person_id), campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    step INTEGER NOT NULL CHECK (step BETWEEN 0 AND 2), subject TEXT NOT NULL, body TEXT NOT NULL,
    angle TEXT NOT NULL CHECK (angle IN ('why_them','signal_led','offer_led','follow_up_value')),
    generation_mode TEXT NOT NULL CHECK (generation_mode IN ('bespoke','template_with_purpose')), purpose TEXT, ask TEXT NOT NULL,
    evidence_ids TEXT NOT NULL CHECK (json_valid(evidence_ids)), recipient_relevance_points TEXT NOT NULL CHECK (json_valid(recipient_relevance_points)),
    sender_proof_points TEXT NOT NULL CHECK (json_valid(sender_proof_points)), template_id TEXT NOT NULL, template_version INTEGER NOT NULL CHECK (template_version >= 1),
    prompt_version TEXT NOT NULL, model_version TEXT NOT NULL, qa TEXT NOT NULL CHECK (json_valid(qa)), hash TEXT NOT NULL UNIQUE CHECK (length(hash) = 64),
    CHECK ((generation_mode = 'bespoke') OR (purpose IS NOT NULL AND length(purpose) > 0))
);
CREATE TABLE reply_template (id TEXT NOT NULL, version INTEGER NOT NULL CHECK (version >= 1), body_hash TEXT NOT NULL UNIQUE CHECK (length(body_hash) = 64), approved_at TEXT NOT NULL, PRIMARY KEY(id, version));
CREATE TABLE approval (
    approval_id TEXT PRIMARY KEY, assertion_ref TEXT NOT NULL, campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id), policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64),
    content_kind TEXT NOT NULL CHECK (content_kind IN ('revision','reply_template','campaign_policy')), revision_hash TEXT CHECK (revision_hash IS NULL OR length(revision_hash) = 64),
    contact_id TEXT REFERENCES contact_point(contact_id), mailbox_id TEXT, approver TEXT NOT NULL, approved_at TEXT NOT NULL, expires_at TEXT NOT NULL,
    tier TEXT NOT NULL CHECK (tier IN ('T0','T1','T2','T3')), send_window TEXT NOT NULL CHECK (json_valid(send_window)), nonce TEXT NOT NULL UNIQUE,
    permitted_action TEXT NOT NULL CHECK (permitted_action IN ('send_revision','send_preapproved_reply_template','activate_campaign')), consumed_at TEXT,
    scope_hash TEXT NOT NULL UNIQUE CHECK (length(scope_hash) = 64), invalidation_reason TEXT CHECK (invalidation_reason IS NULL OR invalidation_reason IN ('edited','rescheduled_outside_window','policy_changed','recipient_changed','mailbox_changed','expired','consumed','revoked')),
    CHECK (
        (content_kind = 'revision' AND permitted_action = 'send_revision' AND revision_hash IS NOT NULL AND contact_id IS NOT NULL AND mailbox_id IS NOT NULL)
        OR (content_kind = 'reply_template' AND permitted_action = 'send_preapproved_reply_template' AND revision_hash IS NOT NULL AND contact_id IS NOT NULL AND mailbox_id IS NOT NULL)
        OR (content_kind = 'campaign_policy' AND permitted_action = 'activate_campaign' AND revision_hash IS NULL AND contact_id IS NULL AND mailbox_id IS NULL)
    )
);
CREATE TABLE exec_request (
    request_id TEXT PRIMARY KEY, caller TEXT NOT NULL,
    operation TEXT NOT NULL CHECK (operation IN ('fetch_snapshot','finder_page','vendor_lookup','gmail_draft','gmail_send','gmail_label','gmail_thread_refresh')),
    payload TEXT NOT NULL CHECK (json_valid(payload)), policy_hash TEXT NOT NULL CHECK (length(policy_hash) = 64), approval_id TEXT REFERENCES approval(approval_id),
    created_at TEXT NOT NULL, claimed_at TEXT, state TEXT NOT NULL CHECK (state IN ('queued','claimed','succeeded','rejected','uncertain')), reason TEXT
);
CREATE TABLE provider_attempt (
    attempt_id TEXT PRIMARY KEY, person_id TEXT NOT NULL REFERENCES person(person_id), provider TEXT NOT NULL CHECK (provider IN ('hunter','snov','fullenrich','pdl','apify','hdw','pattern')),
    call TEXT NOT NULL, input_hash TEXT NOT NULL CHECK (length(input_hash) = 64), priority INTEGER NOT NULL CHECK (priority >= 0), credits INTEGER NOT NULL CHECK (credits >= 0),
    result TEXT NOT NULL CHECK (result IN ('valid','invalid','risky','catch_all','role','not_found','error','skipped_budget')), started_at TEXT NOT NULL, finished_at TEXT NOT NULL, raw_response_ref INTEGER
);
CREATE TABLE credit_reservation (
    reservation_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id), provider TEXT NOT NULL CHECK (provider IN ('hunter','snov','fullenrich','pdl','apify','hdw','pattern')),
    exec_request_id TEXT NOT NULL UNIQUE REFERENCES exec_request(request_id), max_cost INTEGER NOT NULL CHECK (max_cost >= 0), actual_cost INTEGER CHECK (actual_cost IS NULL OR actual_cost >= 0),
    state TEXT NOT NULL CHECK (state IN ('reserved','settled','released','overage_error')), created_at TEXT NOT NULL, settled_at TEXT,
    CHECK ((state = 'reserved' AND actual_cost IS NULL AND settled_at IS NULL) OR state <> 'reserved')
);
CREATE TABLE finder_run (
    finder_run_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id), policy_hash TEXT NOT NULL,
    requested_companies INTEGER NOT NULL CHECK (requested_companies >= 0), requested_people INTEGER NOT NULL CHECK (requested_people >= 0),
    state TEXT NOT NULL CHECK (state IN ('queued','running','paused','completed')), started_at TEXT, updated_at TEXT NOT NULL, completed_at TEXT,
    shortfall_reason TEXT CHECK (shortfall_reason IS NULL OR shortfall_reason IN ('lane_exhausted','cap_reached','checkpoint','unsupported_predicate','credit_budget'))
);
CREATE TABLE finder_cursor (
    finder_run_id TEXT NOT NULL REFERENCES finder_run(finder_run_id), lane TEXT NOT NULL, cursor TEXT, processed INTEGER NOT NULL DEFAULT 0 CHECK (processed >= 0),
    yielded INTEGER NOT NULL DEFAULT 0 CHECK (yielded >= 0), capability_version TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(finder_run_id, lane)
);
CREATE TABLE enrollment (
    enrollment_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id), person_id TEXT NOT NULL REFERENCES person(person_id),
    current_step INTEGER NOT NULL CHECK (current_step BETWEEN 0 AND 2), next_due_at TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued','drafted','approved','scheduled','sent','blocked','stopped','closed')),
    stop_reason TEXT CHECK (stop_reason IS NULL OR stop_reason IN ('human_reply','ooo','hard_bounce','decline','unsubscribe','wrong_person','manual_dnc','exhausted_touches','closed_no_reply')),
    block_reason TEXT CHECK (block_reason IS NULL OR block_reason IN ('manual_hold','campaign_paused','suppression_active','daily_cap','hourly_cap','send_window','google_warning','delayed_dsn','approval_missing','approval_expired','approval_mismatch','hash_mismatch','firm_collision','machine_unavailable','gmail_uncertain','inbound_refresh_error')),
    variant_id TEXT, UNIQUE(campaign_id, person_id)
);
CREATE TABLE delivery (
    delivery_id TEXT PRIMARY KEY, campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id), enrollment_id TEXT NOT NULL REFERENCES enrollment(enrollment_id),
    step INTEGER NOT NULL CHECK (step BETWEEN 0 AND 2), revision_hash TEXT NOT NULL REFERENCES revision(hash), contact_id TEXT NOT NULL REFERENCES contact_point(contact_id),
    mailbox_id TEXT NOT NULL, logical_key TEXT NOT NULL UNIQUE CHECK (length(logical_key) = 64), gmail_message_id TEXT UNIQUE, gmail_thread_id TEXT, rfc_message_id TEXT NOT NULL UNIQUE,
    scheduled_at TEXT, attempted_at TEXT, sent_at TEXT, state TEXT NOT NULL CHECK (state IN ('reserved','claimed','attempted','sent','failed','cancelled','uncertain'))
);
CREATE TABLE inbound (
    inbound_id TEXT PRIMARY KEY, gmail_message_id TEXT NOT NULL UNIQUE, gmail_thread_id TEXT NOT NULL, enrollment_id TEXT NOT NULL REFERENCES enrollment(enrollment_id), received_at TEXT NOT NULL,
    class TEXT NOT NULL CHECK (class IN ('scheduling_logistics','thanks_ack','graceful_close','substantive_positive','human_neutral','human_negative','ooo','bounce_failed','bounce_delayed','unsubscribe','wrong_person','automatic','ambiguous','sensitive')),
    confidence REAL NOT NULL CHECK (confidence BETWEEN 0.0 AND 1.0), explanation_code TEXT NOT NULL, reviewed_by TEXT,
    correction_class TEXT CHECK (correction_class IS NULL OR correction_class IN ('scheduling_logistics','thanks_ack','graceful_close','substantive_positive','human_neutral','human_negative','ooo','bounce_failed','bounce_delayed','unsubscribe','wrong_person','automatic','ambiguous','sensitive'))
);
CREATE TABLE reply_revision (
    reply_revision_id TEXT PRIMARY KEY, inbound_id TEXT NOT NULL REFERENCES inbound(inbound_id), campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id), contact_id TEXT NOT NULL REFERENCES contact_point(contact_id),
    mailbox_id TEXT NOT NULL, class TEXT NOT NULL CHECK (class IN ('scheduling_logistics','thanks_ack','graceful_close','substantive_positive','human_neutral','human_negative','ooo','bounce_failed','bounce_delayed','unsubscribe','wrong_person','automatic','ambiguous','sensitive')),
    template_id TEXT, template_version INTEGER, subject TEXT NOT NULL, body TEXT NOT NULL, hash TEXT NOT NULL UNIQUE CHECK (length(hash) = 64),
    generation_mode TEXT NOT NULL CHECK (generation_mode IN ('deterministic_template','model_draft')),
    CHECK ((generation_mode = 'model_draft') OR (template_id IS NOT NULL AND template_version IS NOT NULL))
);
CREATE TABLE suppression (
    suppression_id TEXT PRIMARY KEY, scope TEXT NOT NULL CHECK (scope IN ('global','email','person','company','campaign')), subject_key TEXT NOT NULL,
    reason TEXT NOT NULL CHECK (reason IN ('bounce','decline','unsubscribe','wrong_person','manual_dnc','google_warning')),
    created_at TEXT NOT NULL, created_by TEXT NOT NULL, released_at TEXT, released_by TEXT,
    CHECK ((released_at IS NULL AND released_by IS NULL) OR (released_at IS NOT NULL AND released_by IS NOT NULL))
);
CREATE TABLE relationship (
    person_id TEXT PRIMARY KEY REFERENCES person(person_id), affinity_type TEXT, why_them TEXT, introduced_by TEXT, first_touch_at TEXT, response_at TEXT,
    call_at TEXT, thank_you_at TEXT, insights TEXT, promised_action TEXT, next_appropriate_touch TEXT, outcome TEXT
);
CREATE TABLE audit (
    event_id TEXT PRIMARY KEY, actor TEXT NOT NULL, action TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, at TEXT NOT NULL,
    before_hash TEXT, after_hash TEXT, reason TEXT NOT NULL
);

CREATE VIEW company_tranche AS SELECT company_id, name, website_url, linkedin_url, one_line_summary, industry, location, source_lane FROM company;
CREATE VIEW person_tranche AS
SELECT p.person_id, fs.campaign_id, p.first_name, p.full_name, e.title, c.name AS company, p.linkedin_url, p.location, cp.email, cp.state AS verification_state,
       p.one_line_blurb, fs.score AS fit_score, p.source_lane
FROM person AS p JOIN employment AS e ON e.person_id = p.person_id AND e.valid_to IS NULL
JOIN company AS c ON c.company_id = e.company_id LEFT JOIN contact_point AS cp ON cp.person_id = p.person_id AND cp.state = 'valid'
LEFT JOIN fit_score AS fs ON fs.person_id = p.person_id AND fs.scored_at = (SELECT max(fs2.scored_at) FROM fit_score AS fs2 WHERE fs2.person_id = p.person_id AND fs2.campaign_id = fs.campaign_id);
CREATE UNIQUE INDEX one_valid_contact_per_person ON contact_point(person_id) WHERE state = 'valid';

CREATE TRIGGER employment_overlap_review AFTER INSERT ON employment
WHEN NEW.valid_to IS NULL AND EXISTS (SELECT 1 FROM employment AS prior WHERE prior.person_id = NEW.person_id AND prior.employment_id <> NEW.employment_id AND prior.valid_to IS NULL)
BEGIN
  INSERT INTO merge_review(review_id,entity_type,candidate_ids,observation_ids,reason,state)
  SELECT 'mr_' || lower(hex(randomblob(8))), 'employment', json_array(prior.employment_id, NEW.employment_id), json_array(prior.source_observation_id, NEW.source_observation_id), 'overlapping_open_employment', 'open'
  FROM employment AS prior WHERE prior.person_id = NEW.person_id AND prior.employment_id <> NEW.employment_id AND prior.valid_to IS NULL ORDER BY prior.employment_id LIMIT 1;
END;
CREATE TRIGGER campaign_sales_no_activate BEFORE UPDATE OF status ON campaign WHEN NEW.status = 'active' AND NEW.intent = 'sales'
BEGIN SELECT RAISE(ABORT, 'sales activation is disabled in P1-P6'); END;
CREATE TRIGGER campaign_activate_requires_approval BEFORE UPDATE OF status ON campaign
WHEN NEW.status = 'active' AND NEW.intent <> 'sales' AND (OLD.status <> 'approved' OR NOT EXISTS (
  SELECT 1 FROM approval AS a
  WHERE a.campaign_id = NEW.campaign_id AND a.policy_hash = NEW.policy_hash
    AND a.content_kind = 'campaign_policy' AND a.permitted_action = 'activate_campaign'
    AND a.tier = NEW.approval_tier AND a.approver LIKE 'human:%'
    AND a.invalidation_reason IS NULL AND a.consumed_at IS NULL
    AND julianday(a.approved_at) <= julianday('now')
    AND julianday(a.expires_at) >= julianday('now')
))
BEGIN SELECT RAISE(ABORT, 'active requires approved status and current human approval'); END;
CREATE TRIGGER approval_campaign_policy_insert BEFORE INSERT ON approval WHEN NOT EXISTS (SELECT 1 FROM campaign AS c WHERE c.campaign_id = NEW.campaign_id AND c.policy_hash = NEW.policy_hash)
BEGIN SELECT RAISE(ABORT, 'approval campaign and policy hash mismatch'); END;
CREATE TRIGGER approval_campaign_policy_update BEFORE UPDATE OF campaign_id,policy_hash ON approval WHEN NOT EXISTS (SELECT 1 FROM campaign AS c WHERE c.campaign_id = NEW.campaign_id AND c.policy_hash = NEW.policy_hash)
BEGIN SELECT RAISE(ABORT, 'approval campaign and policy hash mismatch'); END;
CREATE TRIGGER exec_request_approval_insert BEFORE INSERT ON exec_request
WHEN (NEW.operation = 'gmail_send' AND NOT EXISTS (
  SELECT 1 FROM approval AS a
  JOIN campaign AS c ON c.campaign_id = a.campaign_id
  WHERE a.approval_id = NEW.approval_id
    AND a.policy_hash = NEW.policy_hash
    AND c.approval_tier IN ('T1')
    AND a.approver NOT LIKE 'agent:%'
    AND a.consumed_at IS NULL
    AND a.invalidation_reason IS NULL
    AND julianday(a.expires_at) > julianday('now')
)) OR (NEW.operation <> 'gmail_send' AND NEW.approval_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'operation-specific approval applicability'); END;
CREATE TRIGGER exec_request_approval_update BEFORE UPDATE OF operation,approval_id,policy_hash ON exec_request
WHEN (NEW.operation = 'gmail_send' AND NOT EXISTS (
  SELECT 1 FROM approval AS a
  JOIN campaign AS c ON c.campaign_id = a.campaign_id
  WHERE a.approval_id = NEW.approval_id
    AND a.policy_hash = NEW.policy_hash
    AND c.approval_tier IN ('T1')
    AND a.approver NOT LIKE 'agent:%'
    AND a.consumed_at IS NULL
    AND a.invalidation_reason IS NULL
    AND julianday(a.expires_at) > julianday('now')
)) OR (NEW.operation <> 'gmail_send' AND NEW.approval_id IS NOT NULL)
BEGIN SELECT RAISE(ABORT, 'operation-specific approval applicability'); END;

CREATE TRIGGER source_observation_no_update BEFORE UPDATE ON source_observation BEGIN SELECT RAISE(ABORT, 'source_observation is immutable'); END;
CREATE TRIGGER source_observation_no_delete BEFORE DELETE ON source_observation BEGIN SELECT RAISE(ABORT, 'source_observation is immutable'); END;
CREATE TRIGGER fit_score_version_no_update BEFORE UPDATE ON fit_score_version BEGIN SELECT RAISE(ABORT, 'fit_score_version is immutable'); END;
CREATE TRIGGER fit_score_version_no_delete BEFORE DELETE ON fit_score_version BEGIN SELECT RAISE(ABORT, 'fit_score_version is immutable'); END;
CREATE TRIGGER fit_score_no_update BEFORE UPDATE ON fit_score BEGIN SELECT RAISE(ABORT, 'fit_score is immutable'); END;
CREATE TRIGGER fit_score_no_delete BEFORE DELETE ON fit_score BEGIN SELECT RAISE(ABORT, 'fit_score is immutable'); END;
CREATE TRIGGER provider_attempt_no_update BEFORE UPDATE ON provider_attempt BEGIN SELECT RAISE(ABORT, 'provider_attempt is immutable'); END;
CREATE TRIGGER provider_attempt_no_delete BEFORE DELETE ON provider_attempt BEGIN SELECT RAISE(ABORT, 'provider_attempt is immutable'); END;
CREATE TRIGGER revision_no_update BEFORE UPDATE ON revision BEGIN SELECT RAISE(ABORT, 'revision is immutable'); END;
CREATE TRIGGER revision_no_delete BEFORE DELETE ON revision BEGIN SELECT RAISE(ABORT, 'revision is immutable'); END;
CREATE TRIGGER reply_template_no_update BEFORE UPDATE ON reply_template BEGIN SELECT RAISE(ABORT, 'reply_template is immutable'); END;
CREATE TRIGGER reply_template_no_delete BEFORE DELETE ON reply_template BEGIN SELECT RAISE(ABORT, 'reply_template is immutable'); END;
CREATE TRIGGER reply_revision_no_update BEFORE UPDATE ON reply_revision BEGIN SELECT RAISE(ABORT, 'reply_revision is immutable'); END;
CREATE TRIGGER reply_revision_no_delete BEFORE DELETE ON reply_revision BEGIN SELECT RAISE(ABORT, 'reply_revision is immutable'); END;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER approval_content_insert BEFORE INSERT ON approval BEGIN
  SELECT CASE WHEN NEW.content_kind = 'revision' AND (SELECT count(*) FROM revision WHERE hash = NEW.revision_hash) <> 1 THEN RAISE(ABORT, 'approval revision hash must resolve exactly once')
              WHEN NEW.content_kind = 'reply_template' AND (SELECT count(*) FROM reply_template WHERE body_hash = NEW.revision_hash) <> 1 THEN RAISE(ABORT, 'approval reply-template hash must resolve exactly once') END;
END;
CREATE TRIGGER approval_content_update BEFORE UPDATE OF content_kind, revision_hash ON approval BEGIN
  SELECT CASE WHEN NEW.content_kind = 'revision' AND (SELECT count(*) FROM revision WHERE hash = NEW.revision_hash) <> 1 THEN RAISE(ABORT, 'approval revision hash must resolve exactly once')
              WHEN NEW.content_kind = 'reply_template' AND (SELECT count(*) FROM reply_template WHERE body_hash = NEW.revision_hash) <> 1 THEN RAISE(ABORT, 'approval reply-template hash must resolve exactly once') END;
END;
CREATE TRIGGER eligibility_override_insert BEFORE INSERT ON eligibility_decision
WHEN (
  NEW.outcome = 'eligible'
  AND json_array_length(NEW.approximate_predicate_ids) > 0
  AND NEW.override_id IS NULL
) OR (
  NEW.override_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM predicate_override AS po
  JOIN campaign AS c ON c.campaign_id = NEW.campaign_id
  WHERE po.override_id = NEW.override_id
    AND po.campaign_id = NEW.campaign_id
    AND po.policy_hash = NEW.policy_hash
    AND po.policy_hash = c.policy_hash
    AND po.predicate_id = json_extract(NEW.approximate_predicate_ids, '$[0]')
    AND json_array_length(NEW.approximate_predicate_ids) = 1
    AND po.lane = NEW.lane
    AND po.capability_version = NEW.capability_version
    AND po.decided_by LIKE 'human:%'
)
)
BEGIN SELECT RAISE(ABORT, 'eligibility override binding mismatch'); END;

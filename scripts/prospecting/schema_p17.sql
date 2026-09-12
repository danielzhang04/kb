-- Phase 17 records immutable, source-bound provisional funding research batches.
CREATE TABLE prospecting_funding_batch (
    batch_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    batch_hash TEXT NOT NULL CHECK (length(batch_hash)=64),
    run_id TEXT NOT NULL REFERENCES prospecting_pipeline_run(run_id),
    intake_id TEXT NOT NULL REFERENCES prospecting_pipeline_intake(intake_id),
    intake_hash TEXT NOT NULL CHECK (length(intake_hash)=64),
    campaign_policy_hash TEXT NOT NULL CHECK (length(campaign_policy_hash)=64),
    predecessor_batch_id TEXT REFERENCES prospecting_funding_batch(batch_id),
    predecessor_hash TEXT CHECK (predecessor_hash IS NULL OR length(predecessor_hash)=64),
    importer_version TEXT NOT NULL,
    importer_hash TEXT NOT NULL CHECK (length(importer_hash)=64),
    classifier_version TEXT NOT NULL,
    classifier_hash TEXT NOT NULL CHECK (length(classifier_hash)=64),
    created_at TEXT NOT NULL,
    CHECK ((predecessor_batch_id IS NULL)=(predecessor_hash IS NULL))
);

CREATE TABLE prospecting_funding_company (
    result_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES prospecting_funding_batch(batch_id),
    ordinal INTEGER NOT NULL CHECK (ordinal>=0),
    company_id TEXT REFERENCES company(company_id),
    candidate_name TEXT NOT NULL,
    candidate_identity_json TEXT NOT NULL CHECK (
        json_valid(candidate_identity_json) AND json_type(candidate_identity_json)='object'
    ),
    candidate_key TEXT NOT NULL CHECK (length(candidate_key)=64),
    company_identity_hash TEXT NOT NULL CHECK (length(company_identity_hash)=64),
    rule_outcome TEXT NOT NULL CHECK (rule_outcome IN (
        'provisional_match','provisional_excluded','unknown','collision_refused'
    )),
    reason_codes_json TEXT NOT NULL CHECK (
        json_valid(reason_codes_json) AND json_type(reason_codes_json)='array'
    ),
    latest_stage TEXT,
    latest_announced_at TEXT,
    source_set_hash TEXT NOT NULL CHECK (length(source_set_hash)=64),
    created_at TEXT NOT NULL,
    UNIQUE (batch_id,ordinal),
    CHECK ((rule_outcome='collision_refused')=(company_id IS NULL))
);

CREATE TABLE prospecting_funding_source (
    result_id TEXT NOT NULL REFERENCES prospecting_funding_company(result_id),
    ordinal INTEGER NOT NULL CHECK (ordinal>=0),
    binding_kind TEXT NOT NULL CHECK (binding_kind IN (
        'company_identity','funding_event','coverage','collision_capture'
    )),
    source_kind TEXT NOT NULL CHECK (source_kind IN (
        'issuer','participating_investor','independent_report','search_coverage'
    )),
    snapshot_id TEXT NOT NULL REFERENCES source_snapshot(snapshot_id),
    observation_id TEXT REFERENCES source_observation(observation_id),
    expected_source_url TEXT NOT NULL,
    expected_retrieved_at TEXT NOT NULL,
    expected_content_sha256 TEXT NOT NULL CHECK (length(expected_content_sha256)=64),
    expected_observation_hash TEXT CHECK (
        expected_observation_hash IS NULL OR length(expected_observation_hash)=64
    ),
    excerpt_sha256 TEXT CHECK (excerpt_sha256 IS NULL OR length(excerpt_sha256)=64),
    query_text TEXT,
    searched_at TEXT,
    coverage_status TEXT CHECK (coverage_status IN ('found','empty','blocked','error')),
    result_count INTEGER CHECK (result_count IS NULL OR result_count BETWEEN 0 AND 20),
    result_cap INTEGER CHECK (result_cap IS NULL OR result_cap BETWEEN 1 AND 20),
    PRIMARY KEY (result_id,ordinal),
    CHECK (
      (binding_kind='collision_capture' AND observation_id IS NULL)
      OR (binding_kind<>'collision_capture' AND observation_id IS NOT NULL)
    ),
    CHECK (
      (binding_kind='coverage' AND query_text IS NOT NULL AND searched_at IS NOT NULL
       AND coverage_status IS NOT NULL AND result_count IS NOT NULL AND result_cap IS NOT NULL)
      OR
      (binding_kind<>'coverage' AND query_text IS NULL AND searched_at IS NULL
       AND coverage_status IS NULL AND result_count IS NULL AND result_cap IS NULL)
    )
);

CREATE TRIGGER prospecting_funding_batch_no_update BEFORE UPDATE ON prospecting_funding_batch
BEGIN SELECT RAISE(ABORT,'prospecting_funding_batch_immutable'); END;
CREATE TRIGGER prospecting_funding_batch_no_delete BEFORE DELETE ON prospecting_funding_batch
BEGIN SELECT RAISE(ABORT,'prospecting_funding_batch_immutable'); END;
CREATE TRIGGER prospecting_funding_company_no_update BEFORE UPDATE ON prospecting_funding_company
BEGIN SELECT RAISE(ABORT,'prospecting_funding_company_immutable'); END;
CREATE TRIGGER prospecting_funding_company_no_delete BEFORE DELETE ON prospecting_funding_company
BEGIN SELECT RAISE(ABORT,'prospecting_funding_company_immutable'); END;
CREATE TRIGGER prospecting_funding_source_no_update BEFORE UPDATE ON prospecting_funding_source
BEGIN SELECT RAISE(ABORT,'prospecting_funding_source_immutable'); END;
CREATE TRIGGER prospecting_funding_source_no_delete BEFORE DELETE ON prospecting_funding_source
BEGIN SELECT RAISE(ABORT,'prospecting_funding_source_immutable'); END;

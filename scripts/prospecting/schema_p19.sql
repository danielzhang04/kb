-- Phase 19 records source-bound machine qualification work.  It does not rank,
-- select, enrich contacts, create drafts, or grant human/outbound approval.
CREATE TABLE prospecting_qualification_batch (
    batch_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    batch_hash TEXT NOT NULL CHECK (length(batch_hash)=64),
    run_id TEXT NOT NULL REFERENCES prospecting_pipeline_run(run_id),
    intake_hash TEXT NOT NULL CHECK (length(intake_hash)=64),
    campaign_policy_hash TEXT NOT NULL CHECK (length(campaign_policy_hash)=64),
    funding_batch_id TEXT NOT NULL REFERENCES prospecting_funding_batch(batch_id),
    funding_batch_hash TEXT NOT NULL CHECK (length(funding_batch_hash)=64),
    person_batch_id TEXT NOT NULL REFERENCES prospecting_person_batch(batch_id),
    person_batch_hash TEXT NOT NULL CHECK (length(person_batch_hash)=64),
    predecessor_batch_id TEXT REFERENCES prospecting_qualification_batch(batch_id),
    predecessor_hash TEXT CHECK (predecessor_hash IS NULL OR length(predecessor_hash)=64),
    input_context_hash TEXT NOT NULL CHECK (length(input_context_hash)=64),
    controller_policy_version TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK ((predecessor_batch_id IS NULL)=(predecessor_hash IS NULL)),
    UNIQUE(run_id,input_context_hash)
);

CREATE TABLE prospecting_qualification_item (
    item_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES prospecting_qualification_batch(batch_id),
    ordinal INTEGER NOT NULL CHECK (ordinal>=0),
    funding_result_id TEXT NOT NULL REFERENCES prospecting_funding_company(result_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    funding_source_set_hash TEXT NOT NULL CHECK (length(funding_source_set_hash)=64),
    candidate_ids_json TEXT NOT NULL CHECK (
        json_valid(candidate_ids_json) AND json_type(candidate_ids_json)='array'
    ),
    candidate_set_hash TEXT NOT NULL CHECK (length(candidate_set_hash)=64),
    context_codes_json TEXT NOT NULL CHECK (
        json_valid(context_codes_json) AND json_type(context_codes_json)='array'
    ),
    source_binding_hash TEXT NOT NULL CHECK (length(source_binding_hash)=64),
    max_attempts INTEGER NOT NULL CHECK (max_attempts BETWEEN 1 AND 2),
    created_at TEXT NOT NULL,
    UNIQUE(batch_id,ordinal),
    UNIQUE(batch_id,funding_result_id)
);

CREATE TABLE prospecting_qualification_source (
    source_key TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES prospecting_qualification_item(item_id),
    ordinal INTEGER NOT NULL CHECK (ordinal>=0),
    origin_kind TEXT NOT NULL CHECK (origin_kind IN ('funding','person')),
    context_relation TEXT NOT NULL CHECK (
        context_relation IN (
          'current','predecessor','predecessor_title_disagreement','potential_conflict'
        )
    ),
    subject_candidate_id TEXT REFERENCES prospecting_person_candidate(candidate_id),
    origin_batch_id TEXT NOT NULL,
    origin_row_id TEXT NOT NULL,
    snapshot_id TEXT NOT NULL REFERENCES source_snapshot(snapshot_id),
    observation_id TEXT REFERENCES source_observation(observation_id),
    source_kind TEXT,
    binding_kind TEXT,
    expected_source_url TEXT NOT NULL,
    expected_retrieved_at TEXT NOT NULL,
    expected_expires_at TEXT NOT NULL,
    expected_content_sha256 TEXT NOT NULL CHECK (length(expected_content_sha256)=64),
    expected_body_ref TEXT NOT NULL,
    expected_manifest_hash TEXT CHECK (
        expected_manifest_hash IS NULL OR length(expected_manifest_hash)=64
    ),
    created_at TEXT NOT NULL,
    UNIQUE(item_id,ordinal),
    CHECK (
      (origin_kind='funding' AND subject_candidate_id IS NULL
       AND source_kind IS NOT NULL AND binding_kind IS NOT NULL)
      OR
      (origin_kind='person' AND subject_candidate_id IS NOT NULL
       AND source_kind IS NULL AND binding_kind IS NULL)
    )
);

CREATE TABLE prospecting_qualification_attempt (
    attempt_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    item_id TEXT NOT NULL REFERENCES prospecting_qualification_item(item_id),
    claim_epoch INTEGER NOT NULL CHECK (claim_epoch>=1),
    input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
    worker_role TEXT NOT NULL CHECK (worker_role='qualification_factchecker'),
    worker_identity TEXT NOT NULL,
    worker_job_id TEXT NOT NULL,
    attempt_token_hash TEXT NOT NULL CHECK (length(attempt_token_hash)=64),
    runtime_id TEXT NOT NULL,
    runtime_version TEXT NOT NULL,
    runtime_hash TEXT NOT NULL CHECK (length(runtime_hash)=64),
    schema_hash TEXT NOT NULL CHECK (length(schema_hash)=64),
    skill_name TEXT NOT NULL,
    skill_version TEXT NOT NULL,
    skill_content_hash TEXT NOT NULL CHECK (length(skill_content_hash)=64),
    skill_manifest_hash TEXT NOT NULL CHECK (length(skill_manifest_hash)=64),
    state TEXT NOT NULL CHECK (state IN ('claimed','succeeded','failed','expired')),
    lease_until TEXT NOT NULL,
    failure_code TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT,
    UNIQUE(item_id,claim_epoch),
    CHECK (
      (state='claimed' AND finished_at IS NULL AND failure_code IS NULL)
      OR (state='succeeded' AND finished_at IS NOT NULL AND failure_code IS NULL)
      OR (state IN ('failed','expired') AND finished_at IS NOT NULL AND failure_code IS NOT NULL)
    )
);

CREATE TABLE prospecting_qualification_artifact (
    artifact_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES prospecting_qualification_attempt(attempt_id),
    item_id TEXT NOT NULL UNIQUE REFERENCES prospecting_qualification_item(item_id),
    input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
    output_hash TEXT NOT NULL CHECK (length(output_hash)=64),
    source_binding_hash TEXT NOT NULL CHECK (length(source_binding_hash)=64),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json)='object'),
    derived_json TEXT NOT NULL CHECK (json_valid(derived_json) AND json_type(derived_json)='object'),
    producer_role TEXT NOT NULL CHECK (producer_role='qualification_factchecker'),
    producer_identity TEXT NOT NULL,
    producer_job_id TEXT NOT NULL,
    runtime_id TEXT NOT NULL,
    runtime_hash TEXT NOT NULL CHECK (length(runtime_hash)=64),
    schema_hash TEXT NOT NULL CHECK (length(schema_hash)=64),
    skill_name TEXT NOT NULL,
    skill_version TEXT NOT NULL,
    skill_content_hash TEXT NOT NULL CHECK (length(skill_content_hash)=64),
    skill_manifest_hash TEXT NOT NULL CHECK (length(skill_manifest_hash)=64),
    created_at TEXT NOT NULL
);

CREATE TRIGGER prospecting_qualification_batch_no_update
BEFORE UPDATE ON prospecting_qualification_batch
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_batch_immutable'); END;
CREATE TRIGGER prospecting_qualification_batch_no_delete
BEFORE DELETE ON prospecting_qualification_batch
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_batch_immutable'); END;
CREATE TRIGGER prospecting_qualification_item_no_update
BEFORE UPDATE ON prospecting_qualification_item
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_item_immutable'); END;
CREATE TRIGGER prospecting_qualification_item_no_delete
BEFORE DELETE ON prospecting_qualification_item
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_item_immutable'); END;
CREATE TRIGGER prospecting_qualification_source_no_update
BEFORE UPDATE ON prospecting_qualification_source
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_source_immutable'); END;
CREATE TRIGGER prospecting_qualification_source_no_delete
BEFORE DELETE ON prospecting_qualification_source
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_source_immutable'); END;
CREATE TRIGGER prospecting_qualification_attempt_binding_no_update
BEFORE UPDATE OF attempt_id,request_id,request_hash,item_id,claim_epoch,input_hash,
  worker_role,worker_identity,worker_job_id,attempt_token_hash,runtime_id,runtime_version,
  runtime_hash,schema_hash,skill_name,skill_version,skill_content_hash,skill_manifest_hash,
  lease_until,created_at
ON prospecting_qualification_attempt
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_attempt_binding_immutable'); END;
CREATE TRIGGER prospecting_qualification_attempt_terminal_no_update
BEFORE UPDATE ON prospecting_qualification_attempt
WHEN OLD.state IN ('succeeded','failed','expired')
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_attempt_terminal'); END;
CREATE TRIGGER prospecting_qualification_attempt_no_delete
BEFORE DELETE ON prospecting_qualification_attempt
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_attempt_immutable'); END;
CREATE TRIGGER prospecting_qualification_artifact_no_update
BEFORE UPDATE ON prospecting_qualification_artifact
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_artifact_immutable'); END;
CREATE TRIGGER prospecting_qualification_artifact_no_delete
BEFORE DELETE ON prospecting_qualification_artifact
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_artifact_immutable'); END;

CREATE TRIGGER prospecting_qualification_artifact_scope_insert
BEFORE INSERT ON prospecting_qualification_artifact
WHEN NOT EXISTS (
  SELECT 1 FROM prospecting_qualification_attempt a
   WHERE a.attempt_id=NEW.attempt_id AND a.item_id=NEW.item_id
     AND a.input_hash=NEW.input_hash AND a.worker_role=NEW.producer_role
     AND a.worker_identity=NEW.producer_identity
     AND a.worker_job_id=NEW.producer_job_id
     AND a.runtime_id=NEW.runtime_id AND a.runtime_hash=NEW.runtime_hash
     AND a.schema_hash=NEW.schema_hash AND a.skill_name=NEW.skill_name
     AND a.skill_version=NEW.skill_version
     AND a.skill_content_hash=NEW.skill_content_hash
     AND a.skill_manifest_hash=NEW.skill_manifest_hash AND a.state='succeeded'
)
BEGIN SELECT RAISE(ABORT,'prospecting_qualification_artifact_scope'); END;

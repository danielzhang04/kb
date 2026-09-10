-- Phase 16 records exact-revision model-stage work and human acceptance.
CREATE TABLE prospecting_pipeline_item (
    item_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    run_id TEXT NOT NULL REFERENCES prospecting_pipeline_run(run_id),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    intake_hash TEXT NOT NULL CHECK (length(intake_hash)=64),
    campaign_policy_hash TEXT NOT NULL CHECK (length(campaign_policy_hash)=64),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    step INTEGER NOT NULL CHECK (step BETWEEN 0 AND 2),
    base_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    base_revision_hash TEXT NOT NULL CHECK (length(base_revision_hash)=64),
    lineage_root_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    evidence_manifest_hash TEXT NOT NULL CHECK (length(evidence_manifest_hash)=64),
    state TEXT NOT NULL CHECK (state IN (
        'awaiting_humanizer_adapter','humanizer_running',
        'awaiting_post_factcheck_adapter','post_factcheck_running',
        'awaiting_critic_adapter','critic_running','human_review','accepted','parked'
    )),
    next_stage TEXT CHECK (next_stage IN (
        'humanizer','post_humanization_factcheck','independent_critic','human_review'
    )),
    repair_cycle INTEGER NOT NULL CHECK (repair_cycle BETWEEN 0 AND 2),
    max_repair_cycles INTEGER NOT NULL CHECK (max_repair_cycles BETWEEN 0 AND 2),
    claim_epoch INTEGER NOT NULL CHECK (claim_epoch >= 0),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(run_id,base_revision_id)
);

CREATE TABLE prospecting_stage_attempt (
    attempt_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    item_id TEXT NOT NULL REFERENCES prospecting_pipeline_item(item_id),
    stage TEXT NOT NULL CHECK (stage IN (
        'humanizer','post_humanization_factcheck','independent_critic'
    )),
    cycle INTEGER NOT NULL CHECK (cycle BETWEEN 0 AND 2),
    claim_epoch INTEGER NOT NULL CHECK (claim_epoch >= 1),
    input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
    worker_role TEXT NOT NULL CHECK (worker_role IN (
        'humanizer','post_factchecker','independent_critic'
    )),
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
    UNIQUE(item_id,stage,cycle,claim_epoch),
    CHECK ((state='claimed' AND finished_at IS NULL AND failure_code IS NULL)
        OR (state='succeeded' AND finished_at IS NOT NULL AND failure_code IS NULL)
        OR (state IN ('failed','expired') AND finished_at IS NOT NULL AND failure_code IS NOT NULL))
);

CREATE TABLE prospecting_stage_artifact (
    artifact_id TEXT PRIMARY KEY,
    attempt_id TEXT NOT NULL UNIQUE REFERENCES prospecting_stage_attempt(attempt_id),
    item_id TEXT NOT NULL REFERENCES prospecting_pipeline_item(item_id),
    stage TEXT NOT NULL,
    cycle INTEGER NOT NULL CHECK (cycle BETWEEN 0 AND 2),
    input_hash TEXT NOT NULL CHECK (length(input_hash)=64),
    output_hash TEXT NOT NULL CHECK (length(output_hash)=64),
    subject_body_hash TEXT NOT NULL CHECK (length(subject_body_hash)=64),
    proposed_revision_hash TEXT NOT NULL CHECK (length(proposed_revision_hash)=64),
    evidence_manifest_hash TEXT NOT NULL CHECK (length(evidence_manifest_hash)=64),
    decision TEXT NOT NULL CHECK (decision IN ('proposed','no_change','pass','repair','fail')),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND json_type(payload_json)='object'),
    producer_role TEXT NOT NULL,
    producer_identity TEXT NOT NULL,
    producer_job_id TEXT NOT NULL,
    runtime_id TEXT NOT NULL,
    runtime_hash TEXT NOT NULL CHECK (length(runtime_hash)=64),
    schema_hash TEXT NOT NULL CHECK (length(schema_hash)=64),
    skill_name TEXT NOT NULL,
    skill_version TEXT NOT NULL,
    skill_content_hash TEXT NOT NULL CHECK (length(skill_content_hash)=64),
    skill_manifest_hash TEXT NOT NULL CHECK (length(skill_manifest_hash)=64),
    created_at TEXT NOT NULL,
    UNIQUE(item_id,stage,cycle)
);

CREATE TABLE prospecting_pipeline_suggestion (
    suggestion_id TEXT PRIMARY KEY,
    item_id TEXT NOT NULL REFERENCES prospecting_pipeline_item(item_id),
    cycle INTEGER NOT NULL CHECK (cycle BETWEEN 0 AND 2),
    humanizer_artifact_id TEXT NOT NULL UNIQUE REFERENCES prospecting_stage_artifact(artifact_id),
    parent_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    parent_revision_hash TEXT NOT NULL CHECK (length(parent_revision_hash)=64),
    subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 998),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 65536),
    subject_body_hash TEXT NOT NULL CHECK (length(subject_body_hash)=64),
    proposed_revision_hash TEXT NOT NULL CHECK (length(proposed_revision_hash)=64),
    candidate_payload_json TEXT NOT NULL CHECK (json_valid(candidate_payload_json) AND json_type(candidate_payload_json)='object'),
    candidate_context_json TEXT NOT NULL CHECK (json_valid(candidate_context_json) AND json_type(candidate_context_json)='object'),
    created_at TEXT NOT NULL,
    UNIQUE(item_id,cycle)
);

CREATE TABLE prospecting_suggestion_decision (
    decision_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    suggestion_id TEXT NOT NULL UNIQUE REFERENCES prospecting_pipeline_suggestion(suggestion_id),
    item_id TEXT NOT NULL REFERENCES prospecting_pipeline_item(item_id),
    expected_parent_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    decision TEXT NOT NULL CHECK (decision IN ('accepted','rejected')),
    actor TEXT NOT NULL CHECK (actor LIKE 'human:%' AND actor <> 'human:'),
    accepted_revision_id TEXT REFERENCES revision(revision_id),
    accepted_revision_hash TEXT CHECK (accepted_revision_hash IS NULL OR length(accepted_revision_hash)=64),
    created_at TEXT NOT NULL,
    CHECK ((decision='accepted' AND accepted_revision_id IS NOT NULL AND accepted_revision_hash IS NOT NULL)
        OR (decision='rejected' AND accepted_revision_id IS NULL AND accepted_revision_hash IS NULL))
);

CREATE TABLE prospecting_agent_revision_lineage (
    child_revision_id TEXT PRIMARY KEY REFERENCES revision(revision_id),
    parent_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    suggestion_id TEXT NOT NULL UNIQUE REFERENCES prospecting_pipeline_suggestion(suggestion_id),
    decision_id TEXT NOT NULL UNIQUE REFERENCES prospecting_suggestion_decision(decision_id),
    origin TEXT NOT NULL CHECK (origin='accepted_agent_suggestion'),
    created_at TEXT NOT NULL,
    CHECK (child_revision_id<>parent_revision_id)
);

CREATE TRIGGER prospecting_stage_attempt_role_insert BEFORE INSERT ON prospecting_stage_attempt
WHEN (NEW.stage='humanizer' AND NEW.worker_role<>'humanizer')
  OR (NEW.stage='post_humanization_factcheck' AND NEW.worker_role<>'post_factchecker')
  OR (NEW.stage='independent_critic' AND NEW.worker_role<>'independent_critic')
BEGIN SELECT RAISE(ABORT,'prospecting_stage_role'); END;

CREATE TRIGGER prospecting_stage_artifact_scope_insert BEFORE INSERT ON prospecting_stage_artifact
WHEN NOT EXISTS (
    SELECT 1 FROM prospecting_stage_attempt a
     WHERE a.attempt_id=NEW.attempt_id AND a.item_id=NEW.item_id
       AND a.stage=NEW.stage AND a.cycle=NEW.cycle AND a.input_hash=NEW.input_hash
       AND a.worker_role=NEW.producer_role AND a.worker_identity=NEW.producer_identity
       AND a.worker_job_id=NEW.producer_job_id
       AND a.runtime_id=NEW.runtime_id AND a.runtime_hash=NEW.runtime_hash
       AND a.schema_hash=NEW.schema_hash AND a.skill_name=NEW.skill_name
       AND a.skill_version=NEW.skill_version AND a.skill_content_hash=NEW.skill_content_hash
       AND a.skill_manifest_hash=NEW.skill_manifest_hash AND a.state='succeeded'
)
BEGIN SELECT RAISE(ABORT,'prospecting_stage_artifact_scope'); END;

CREATE TRIGGER prospecting_pipeline_item_binding_no_update BEFORE UPDATE OF
    item_id,request_id,request_hash,run_id,campaign_id,intake_hash,campaign_policy_hash,person_id,step,
    base_revision_id,base_revision_hash,lineage_root_revision_id,evidence_manifest_hash,max_repair_cycles,created_at
ON prospecting_pipeline_item BEGIN SELECT RAISE(ABORT,'prospecting_pipeline_item_binding_immutable'); END;
CREATE TRIGGER prospecting_stage_attempt_binding_no_update BEFORE UPDATE OF
    attempt_id,request_id,request_hash,item_id,stage,cycle,claim_epoch,input_hash,
    worker_role,worker_identity,worker_job_id,attempt_token_hash,runtime_id,runtime_version,runtime_hash,
    schema_hash,skill_name,skill_version,skill_content_hash,skill_manifest_hash,lease_until,created_at
ON prospecting_stage_attempt BEGIN SELECT RAISE(ABORT,'prospecting_stage_attempt_binding_immutable'); END;
CREATE TRIGGER prospecting_stage_attempt_terminal_no_update BEFORE UPDATE ON prospecting_stage_attempt
WHEN OLD.state IN ('succeeded','failed','expired') BEGIN SELECT RAISE(ABORT,'prospecting_stage_attempt_terminal'); END;
CREATE TRIGGER prospecting_stage_artifact_no_update BEFORE UPDATE ON prospecting_stage_artifact BEGIN SELECT RAISE(ABORT,'prospecting_stage_artifact_immutable'); END;
CREATE TRIGGER prospecting_stage_artifact_no_delete BEFORE DELETE ON prospecting_stage_artifact BEGIN SELECT RAISE(ABORT,'prospecting_stage_artifact_immutable'); END;
CREATE TRIGGER prospecting_pipeline_suggestion_no_update BEFORE UPDATE ON prospecting_pipeline_suggestion BEGIN SELECT RAISE(ABORT,'prospecting_pipeline_suggestion_immutable'); END;
CREATE TRIGGER prospecting_pipeline_suggestion_no_delete BEFORE DELETE ON prospecting_pipeline_suggestion BEGIN SELECT RAISE(ABORT,'prospecting_pipeline_suggestion_immutable'); END;
CREATE TRIGGER prospecting_suggestion_decision_no_update BEFORE UPDATE ON prospecting_suggestion_decision BEGIN SELECT RAISE(ABORT,'prospecting_suggestion_decision_immutable'); END;
CREATE TRIGGER prospecting_suggestion_decision_no_delete BEFORE DELETE ON prospecting_suggestion_decision BEGIN SELECT RAISE(ABORT,'prospecting_suggestion_decision_immutable'); END;
CREATE TRIGGER prospecting_agent_lineage_no_update BEFORE UPDATE ON prospecting_agent_revision_lineage BEGIN SELECT RAISE(ABORT,'prospecting_agent_lineage_immutable'); END;
CREATE TRIGGER prospecting_agent_lineage_no_delete BEFORE DELETE ON prospecting_agent_revision_lineage BEGIN SELECT RAISE(ABORT,'prospecting_agent_lineage_immutable'); END;

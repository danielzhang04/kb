-- Phase 18 records immutable, source-bound provisional current-person imports.
CREATE TABLE prospecting_person_batch (
    batch_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    batch_hash TEXT NOT NULL CHECK (length(batch_hash)=64),
    run_id TEXT NOT NULL REFERENCES prospecting_pipeline_run(run_id),
    intake_id TEXT NOT NULL REFERENCES prospecting_pipeline_intake(intake_id),
    intake_hash TEXT NOT NULL CHECK (length(intake_hash)=64),
    campaign_policy_hash TEXT NOT NULL CHECK (length(campaign_policy_hash)=64),
    funding_batch_id TEXT NOT NULL REFERENCES prospecting_funding_batch(batch_id),
    funding_batch_hash TEXT NOT NULL CHECK (length(funding_batch_hash)=64),
    research_result_ids_json TEXT NOT NULL CHECK (
        json_valid(research_result_ids_json) AND json_type(research_result_ids_json)='array'
    ),
    research_result_ids_hash TEXT NOT NULL CHECK (length(research_result_ids_hash)=64),
    predecessor_batch_id TEXT REFERENCES prospecting_person_batch(batch_id),
    predecessor_hash TEXT CHECK (predecessor_hash IS NULL OR length(predecessor_hash)=64),
    importer_version TEXT NOT NULL,
    importer_hash TEXT NOT NULL CHECK (length(importer_hash)=64),
    candidate_count INTEGER NOT NULL CHECK (candidate_count>=0),
    imported_count INTEGER NOT NULL CHECK (imported_count>=0),
    collision_count INTEGER NOT NULL CHECK (collision_count>=0),
    source_unknown_count INTEGER NOT NULL CHECK (source_unknown_count>=0),
    requested_people_total INTEGER NOT NULL CHECK (requested_people_total>=0),
    provisional_shortfall INTEGER NOT NULL CHECK (provisional_shortfall>=0),
    state TEXT NOT NULL CHECK (state='awaiting_person_qualification_factcheck'),
    created_at TEXT NOT NULL,
    CHECK ((predecessor_batch_id IS NULL)=(predecessor_hash IS NULL)),
    CHECK (candidate_count=imported_count+collision_count+source_unknown_count)
);

CREATE TABLE prospecting_person_candidate (
    candidate_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES prospecting_person_batch(batch_id),
    ordinal INTEGER NOT NULL CHECK (ordinal>=0),
    funding_result_id TEXT NOT NULL REFERENCES prospecting_funding_company(result_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    candidate_identity_json TEXT NOT NULL CHECK (
        json_valid(candidate_identity_json) AND json_type(candidate_identity_json)='object'
    ),
    candidate_identity_hash TEXT NOT NULL CHECK (length(candidate_identity_hash)=64),
    person_id TEXT REFERENCES person(person_id),
    employment_id TEXT REFERENCES employment(employment_id),
    outcome TEXT NOT NULL CHECK (outcome IN (
        'provisional_import','identity_collision','source_unknown'
    )),
    reason_codes_json TEXT NOT NULL CHECK (
        json_valid(reason_codes_json) AND json_type(reason_codes_json)='array'
    ),
    snapshot_id TEXT NOT NULL REFERENCES source_snapshot(snapshot_id),
    observation_id TEXT REFERENCES source_observation(observation_id),
    source_manifest_json TEXT NOT NULL CHECK (
        json_valid(source_manifest_json) AND json_type(source_manifest_json)='object'
    ),
    source_manifest_hash TEXT NOT NULL CHECK (length(source_manifest_hash)=64),
    created_at TEXT NOT NULL,
    UNIQUE(batch_id,ordinal),
    UNIQUE(batch_id,funding_result_id,candidate_identity_hash),
    CHECK (
        (outcome='provisional_import' AND person_id IS NOT NULL
         AND employment_id IS NOT NULL AND observation_id IS NOT NULL)
        OR
        (outcome<>'provisional_import' AND person_id IS NULL
         AND employment_id IS NULL AND observation_id IS NULL)
    )
);

CREATE TRIGGER prospecting_person_batch_no_update BEFORE UPDATE ON prospecting_person_batch
BEGIN SELECT RAISE(ABORT,'prospecting_person_batch_immutable'); END;
CREATE TRIGGER prospecting_person_batch_no_delete BEFORE DELETE ON prospecting_person_batch
BEGIN SELECT RAISE(ABORT,'prospecting_person_batch_immutable'); END;
CREATE TRIGGER prospecting_person_candidate_no_update BEFORE UPDATE ON prospecting_person_candidate
BEGIN SELECT RAISE(ABORT,'prospecting_person_candidate_immutable'); END;
CREATE TRIGGER prospecting_person_candidate_no_delete BEFORE DELETE ON prospecting_person_candidate
BEGIN SELECT RAISE(ABORT,'prospecting_person_candidate_immutable'); END;

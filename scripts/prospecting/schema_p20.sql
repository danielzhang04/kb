-- Phase 20 records deterministic role ordering over exact P19-supported scope.
-- It does not create affinity, fill, contact, draft, approval, or send authority.
CREATE TABLE prospecting_ranking_batch (
    batch_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    batch_hash TEXT NOT NULL CHECK (length(batch_hash)=64),
    input_context_hash TEXT NOT NULL CHECK (length(input_context_hash)=64),
    run_id TEXT NOT NULL REFERENCES prospecting_pipeline_run(run_id),
    intake_hash TEXT NOT NULL CHECK (length(intake_hash)=64),
    campaign_policy_hash TEXT NOT NULL CHECK (length(campaign_policy_hash)=64),
    funding_batch_id TEXT NOT NULL REFERENCES prospecting_funding_batch(batch_id),
    funding_batch_hash TEXT NOT NULL CHECK (length(funding_batch_hash)=64),
    person_batch_id TEXT NOT NULL REFERENCES prospecting_person_batch(batch_id),
    person_batch_hash TEXT NOT NULL CHECK (length(person_batch_hash)=64),
    qualification_batch_id TEXT NOT NULL REFERENCES prospecting_qualification_batch(batch_id),
    qualification_batch_hash TEXT NOT NULL CHECK (length(qualification_batch_hash)=64),
    predecessor_batch_id TEXT REFERENCES prospecting_ranking_batch(batch_id),
    predecessor_hash TEXT CHECK (predecessor_hash IS NULL OR length(predecessor_hash)=64),
    role_policy_version TEXT NOT NULL,
    role_policy_hash TEXT NOT NULL CHECK (length(role_policy_hash)=64),
    requested_role_families_json TEXT NOT NULL CHECK (
      json_valid(requested_role_families_json) AND json_type(requested_role_families_json)='array'
    ),
    requested_role_families_hash TEXT NOT NULL CHECK (length(requested_role_families_hash)=64),
    desired_people_per_company INTEGER NOT NULL CHECK (desired_people_per_company BETWEEN 1 AND 20),
    state TEXT NOT NULL CHECK (state='deterministic_role_ordered'),
    created_at TEXT NOT NULL,
    CHECK ((predecessor_batch_id IS NULL)=(predecessor_hash IS NULL)),
    UNIQUE(run_id,input_context_hash)
);

CREATE TABLE prospecting_ranking_company (
    company_rank_id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES prospecting_ranking_batch(batch_id),
    ordinal INTEGER NOT NULL CHECK (ordinal>=0),
    qualification_item_id TEXT NOT NULL REFERENCES prospecting_qualification_item(item_id),
    qualification_artifact_id TEXT NOT NULL REFERENCES prospecting_qualification_artifact(artifact_id),
    qualification_output_hash TEXT NOT NULL CHECK (length(qualification_output_hash)=64),
    funding_result_id TEXT NOT NULL REFERENCES prospecting_funding_company(result_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    company_outcome TEXT NOT NULL CHECK (company_outcome IN ('source_supported','contradicted','unknown')),
    desired_count INTEGER NOT NULL CHECK (desired_count BETWEEN 1 AND 20),
    eligible_count INTEGER NOT NULL CHECK (eligible_count>=0),
    selected_count INTEGER NOT NULL CHECK (selected_count>=0),
    shortfall INTEGER NOT NULL CHECK (shortfall>=0),
    reason_codes_json TEXT NOT NULL CHECK (json_valid(reason_codes_json) AND json_type(reason_codes_json)='array'),
    created_at TEXT NOT NULL,
    UNIQUE(batch_id,ordinal),
    UNIQUE(batch_id,qualification_item_id),
    CHECK (selected_count<=eligible_count AND selected_count<=desired_count),
    CHECK (shortfall=desired_count-selected_count)
);

CREATE TABLE prospecting_ranking_person (
    person_rank_id TEXT PRIMARY KEY,
    company_rank_id TEXT NOT NULL REFERENCES prospecting_ranking_company(company_rank_id),
    ordinal INTEGER NOT NULL CHECK (ordinal>=0),
    representative_candidate_id TEXT NOT NULL REFERENCES prospecting_person_candidate(candidate_id),
    source_candidate_ids_json TEXT NOT NULL CHECK (json_valid(source_candidate_ids_json) AND json_type(source_candidate_ids_json)='array'),
    source_candidate_ids_hash TEXT NOT NULL CHECK (length(source_candidate_ids_hash)=64),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    employment_id TEXT NOT NULL REFERENCES employment(employment_id),
    candidate_observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    employment_observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    title TEXT NOT NULL,
    title_hash TEXT NOT NULL CHECK (length(title_hash)=64),
    qualification_outcome TEXT NOT NULL CHECK (qualification_outcome IN ('current_role_supported','contradicted','unknown')),
    mapped_family TEXT,
    match_kind TEXT NOT NULL CHECK (match_kind IN ('direct','compound','generic','excluded','unknown')),
    match_tier INTEGER CHECK (match_tier IS NULL OR match_tier BETWEEN 0 AND 2),
    rank_ordinal INTEGER CHECK (rank_ordinal IS NULL OR rank_ordinal>=0),
    selected INTEGER NOT NULL CHECK (selected IN (0,1)),
    reason_codes_json TEXT NOT NULL CHECK (json_valid(reason_codes_json) AND json_type(reason_codes_json)='array'),
    created_at TEXT NOT NULL,
    UNIQUE(company_rank_id,person_id),
    UNIQUE(company_rank_id,ordinal),
    UNIQUE(company_rank_id,rank_ordinal),
    CHECK (
      (selected=1 AND qualification_outcome='current_role_supported'
       AND mapped_family IS NOT NULL AND match_tier IS NOT NULL AND rank_ordinal IS NOT NULL)
      OR selected=0
    )
);

CREATE TRIGGER prospecting_ranking_batch_no_update
BEFORE UPDATE ON prospecting_ranking_batch
BEGIN SELECT RAISE(ABORT,'prospecting_ranking_batch_immutable'); END;
CREATE TRIGGER prospecting_ranking_batch_no_delete
BEFORE DELETE ON prospecting_ranking_batch
BEGIN SELECT RAISE(ABORT,'prospecting_ranking_batch_immutable'); END;
CREATE TRIGGER prospecting_ranking_company_no_update
BEFORE UPDATE ON prospecting_ranking_company
BEGIN SELECT RAISE(ABORT,'prospecting_ranking_company_immutable'); END;
CREATE TRIGGER prospecting_ranking_company_no_delete
BEFORE DELETE ON prospecting_ranking_company
BEGIN SELECT RAISE(ABORT,'prospecting_ranking_company_immutable'); END;
CREATE TRIGGER prospecting_ranking_person_no_update
BEFORE UPDATE ON prospecting_ranking_person
BEGIN SELECT RAISE(ABORT,'prospecting_ranking_person_immutable'); END;
CREATE TRIGGER prospecting_ranking_person_no_delete
BEFORE DELETE ON prospecting_ranking_person
BEGIN SELECT RAISE(ABORT,'prospecting_ranking_person_immutable'); END;

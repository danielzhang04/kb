-- Phase 15 stores versioned desktop-local intake and an honest initial pipeline state.
CREATE TABLE prospecting_pipeline_intake (
    intake_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    campaign_policy_hash TEXT NOT NULL CHECK (length(campaign_policy_hash) = 64),
    intake_revision INTEGER NOT NULL CHECK (intake_revision >= 1),
    intake_hash TEXT NOT NULL CHECK (length(intake_hash) = 64),
    as_of_date TEXT NOT NULL,
    funding_stage_min TEXT NOT NULL CHECK (funding_stage_min IN (
        'pre_seed','seed','series_a','series_b','series_c','series_d','series_e',
        'series_f','series_g','growth'
    )),
    funding_stage_max TEXT NOT NULL CHECK (funding_stage_max IN (
        'pre_seed','seed','series_a','series_b','series_c','series_d','series_e',
        'series_f','series_g','growth'
    )),
    funding_window_years INTEGER NOT NULL CHECK (funding_window_years BETWEEN 1 AND 25),
    funding_stage_interpretation TEXT NOT NULL CHECK (funding_stage_interpretation IN (
        'latest_known','any_eligible_within_window'
    )),
    geography_mode TEXT NOT NULL CHECK (geography_mode IN ('specific','any','unknown')),
    geography_json TEXT NOT NULL CHECK (json_valid(geography_json) AND json_type(geography_json) = 'array'),
    sector_mode TEXT NOT NULL CHECK (sector_mode IN ('specific','any','unknown')),
    sector_json TEXT NOT NULL CHECK (json_valid(sector_json) AND json_type(sector_json) = 'array'),
    requested_companies INTEGER NOT NULL CHECK (requested_companies BETWEEN 1 AND 200),
    requested_people_per_company INTEGER NOT NULL CHECK (requested_people_per_company BETWEEN 1 AND 20),
    role_families_json TEXT NOT NULL CHECK (json_valid(role_families_json) AND json_type(role_families_json) = 'array'),
    original_specification TEXT NOT NULL,
    outreach_goal TEXT NOT NULL,
    cutoff_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE (campaign_id, intake_revision)
);

CREATE TABLE prospecting_pipeline_run (
    run_id TEXT PRIMARY KEY,
    intake_id TEXT NOT NULL UNIQUE REFERENCES prospecting_pipeline_intake(intake_id),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    intake_hash TEXT NOT NULL CHECK (length(intake_hash) = 64),
    campaign_policy_hash TEXT NOT NULL CHECK (length(campaign_policy_hash) = 64),
    workflow_id TEXT NOT NULL,
    workflow_version INTEGER NOT NULL CHECK (workflow_version >= 1),
    workflow_hash TEXT NOT NULL CHECK (length(workflow_hash) = 64),
    state TEXT NOT NULL CHECK (state IN ('input_pending','awaiting_research_adapter')),
    next_stage TEXT NOT NULL,
    repair_cycle INTEGER NOT NULL CHECK (repair_cycle >= 0),
    max_repair_cycles INTEGER NOT NULL CHECK (max_repair_cycles BETWEEN 0 AND 10),
    pending_fields_json TEXT NOT NULL CHECK (json_valid(pending_fields_json) AND json_type(pending_fields_json) = 'array'),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE prospecting_pipeline_stage_state (
    run_id TEXT NOT NULL REFERENCES prospecting_pipeline_run(run_id),
    stage_id TEXT NOT NULL,
    cycle INTEGER NOT NULL CHECK (cycle >= 0),
    state TEXT NOT NULL CHECK (state IN ('input_pending','awaiting_adapter')),
    input_hash TEXT NOT NULL CHECK (length(input_hash) = 64),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (run_id, stage_id, cycle)
);

CREATE TRIGGER prospecting_pipeline_intake_no_update BEFORE UPDATE ON prospecting_pipeline_intake
BEGIN SELECT RAISE(ABORT, 'prospecting_pipeline_intake_immutable'); END;
CREATE TRIGGER prospecting_pipeline_intake_no_delete BEFORE DELETE ON prospecting_pipeline_intake
BEGIN SELECT RAISE(ABORT, 'prospecting_pipeline_intake_immutable'); END;

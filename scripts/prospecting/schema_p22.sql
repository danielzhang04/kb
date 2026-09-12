-- Phase 22 binds one durable selected-draft receipt to one exact request and one
-- exact rendered revision.  It grants no readiness, source-attestation, approval or
-- send authority, mints no evidence, and never mutates employment, fill, contact or
-- approval state.  Rows here are append-only receipts: regeneration appends a new
-- binding whose predecessor_binding_hash names the exact binding it replaces.
CREATE TABLE selected_draft_binding (
    binding_id TEXT PRIMARY KEY,
    binding_hash TEXT NOT NULL UNIQUE CHECK (length(binding_hash)=64),
    request_id TEXT NOT NULL UNIQUE,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    run_id TEXT NOT NULL REFERENCES prospecting_pipeline_run(run_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    person_rank_id TEXT NOT NULL,
    ranking_batch_hash TEXT NOT NULL CHECK (length(ranking_batch_hash)=64),
    qualification_artifact_id TEXT NOT NULL,
    qualification_output_hash TEXT NOT NULL CHECK (length(qualification_output_hash)=64),
    source_context_digest TEXT NOT NULL CHECK (length(source_context_digest)=64),
    render_context_digest TEXT NOT NULL CHECK (length(render_context_digest)=64),
    revision_id TEXT NOT NULL UNIQUE REFERENCES revision(revision_id),
    revision_hash TEXT NOT NULL CHECK (length(revision_hash)=64),
    prompt_version TEXT NOT NULL,
    predecessor_binding_hash TEXT REFERENCES selected_draft_binding(binding_hash),
    created_at TEXT NOT NULL,
    CHECK (predecessor_binding_hash IS NULL OR predecessor_binding_hash<>binding_hash)
);

CREATE TABLE selected_draft_request (
    request_id TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    operation TEXT NOT NULL CHECK (operation IN ('materialize','regenerate')),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    run_id TEXT NOT NULL REFERENCES prospecting_pipeline_run(run_id),
    person_rank_id TEXT NOT NULL,
    expected_revision_id TEXT REFERENCES revision(revision_id),
    expected_predecessor_binding_hash TEXT,
    result_state TEXT NOT NULL CHECK (result_state IN ('bound','unchanged','regenerated')),
    binding_id TEXT NOT NULL REFERENCES selected_draft_binding(binding_id),
    created_at TEXT NOT NULL,
    CHECK ((operation='materialize' AND expected_revision_id IS NULL
            AND expected_predecessor_binding_hash IS NULL)
        OR (operation='regenerate' AND expected_revision_id IS NOT NULL
            AND expected_predecessor_binding_hash IS NOT NULL))
);
-- SQLite refuses to name the implicit rowid in CREATE INDEX, and every index entry
-- already carries that rowid, so scoping this index to (campaign_id, person_id) is
-- exactly what the newest-binding lookup needs.  No surrogate ordering column is
-- invented here: rowid order remains the only order this phase relies on.
CREATE INDEX selected_draft_binding_scope_idx
    ON selected_draft_binding(campaign_id, person_id);

-- A binding may only name a revision that is the exact step-0 selected render for
-- the same campaign and person, carrying the renderer's own canonical identity.
CREATE TRIGGER selected_draft_binding_scope_insert BEFORE INSERT ON selected_draft_binding
WHEN NOT EXISTS (
    SELECT 1 FROM revision AS r
     WHERE r.revision_id=NEW.revision_id AND r.hash=NEW.revision_hash
       AND r.campaign_id=NEW.campaign_id AND r.person_id=NEW.person_id AND r.step=0
       AND r.prompt_version=NEW.prompt_version
       AND r.prompt_version LIKE 'selected-person-render-v1:%'
)
BEGIN SELECT RAISE(ABORT,'selected_draft_binding_scope'); END;

CREATE TRIGGER selected_draft_request_scope_insert BEFORE INSERT ON selected_draft_request
WHEN NOT EXISTS (
    SELECT 1 FROM selected_draft_binding AS binding
     WHERE binding.binding_id=NEW.binding_id AND binding.campaign_id=NEW.campaign_id
       AND binding.run_id=NEW.run_id AND binding.person_rank_id=NEW.person_rank_id
)
BEGIN SELECT RAISE(ABORT,'selected_draft_request_scope'); END;

CREATE TRIGGER selected_draft_binding_no_update BEFORE UPDATE ON selected_draft_binding BEGIN SELECT RAISE(ABORT,'selected_draft_binding_immutable'); END;
CREATE TRIGGER selected_draft_binding_no_delete BEFORE DELETE ON selected_draft_binding BEGIN SELECT RAISE(ABORT,'selected_draft_binding_immutable'); END;
CREATE TRIGGER selected_draft_request_no_update BEFORE UPDATE ON selected_draft_request BEGIN SELECT RAISE(ABORT,'selected_draft_request_immutable'); END;
CREATE TRIGGER selected_draft_request_no_delete BEFORE DELETE ON selected_draft_request BEGIN SELECT RAISE(ABORT,'selected_draft_request_immutable'); END;

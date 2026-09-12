-- Phase 24 records one explicit human confirmation of the exact P22 selected-person
-- source context behind one selected draft.  (Phase 23 is reserved for the separate
-- acquisition slice and is deliberately absent here.)
--
-- A row grants no readiness, approval or send authority, mints no evidence and never
-- mutates employment, fill, contact, approval or P18/P19/P20 source identity.  It
-- stores only opaque references, digests, time and a server actor label: no private
-- name, title, excerpt or source URL text is duplicated into this table.
--
-- Rows are append-only and immutable.  Uniqueness is keyed on the exact source
-- context, so a fresh request over an unchanged context reuses the existing
-- attestation rather than minting new authority.
CREATE TABLE selected_source_attestation (
    attestation_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    employment_id TEXT NOT NULL REFERENCES employment(employment_id),
    head_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    revision_hash TEXT NOT NULL CHECK (length(revision_hash)=64),
    binding_id TEXT NOT NULL REFERENCES selected_draft_binding(binding_id),
    binding_hash TEXT NOT NULL REFERENCES selected_draft_binding(binding_hash)
        CHECK (length(binding_hash)=64),
    source_context_digest TEXT NOT NULL CHECK (length(source_context_digest)=64),
    candidate_observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    employment_observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    snapshot_id TEXT NOT NULL REFERENCES source_snapshot(snapshot_id),
    content_sha256 TEXT NOT NULL CHECK (length(content_sha256)=64),
    expires_at TEXT NOT NULL,
    attested INTEGER NOT NULL CHECK (attested=1),
    attested_by TEXT NOT NULL CHECK (attested_by LIKE 'human:%' AND attested_by<>'human:'),
    created_at TEXT NOT NULL,
    UNIQUE (campaign_id, person_id, source_context_digest, snapshot_id,
            candidate_observation_id)
);

-- Scoped to the exact (campaign, person, source context) lookup this phase performs.
-- No ordering column is invented and no other table's index is relied on: the two
-- columns plus the implicit rowid already answer the reuse lookup.
CREATE INDEX selected_source_attestation_scope_idx
    ON selected_source_attestation(campaign_id, person_id, source_context_digest);

-- An attestation may only name the exact binding, revisions, employment row,
-- observations and snapshot that already agree with each other in the store.
CREATE TRIGGER selected_source_attestation_scope_insert
BEFORE INSERT ON selected_source_attestation
WHEN NOT EXISTS (
    SELECT 1
      FROM selected_draft_binding AS binding
      JOIN revision AS root ON root.revision_id=binding.revision_id
      JOIN revision AS head ON head.revision_id=NEW.head_revision_id
      JOIN employment AS e ON e.employment_id=NEW.employment_id
      JOIN source_observation AS candidate
        ON candidate.observation_id=NEW.candidate_observation_id
      JOIN source_observation AS employment_source
        ON employment_source.observation_id=NEW.employment_observation_id
      JOIN source_snapshot AS s ON s.snapshot_id=NEW.snapshot_id
     WHERE binding.binding_id=NEW.binding_id AND binding.binding_hash=NEW.binding_hash
       AND binding.campaign_id=NEW.campaign_id AND binding.person_id=NEW.person_id
       AND binding.revision_id=NEW.revision_id
       AND binding.revision_hash=NEW.revision_hash
       AND binding.source_context_digest=NEW.source_context_digest
       AND root.campaign_id=NEW.campaign_id AND root.person_id=NEW.person_id
       AND root.step=0 AND root.hash=NEW.revision_hash
       AND head.campaign_id=NEW.campaign_id AND head.person_id=NEW.person_id
       AND head.step=0
       AND e.person_id=NEW.person_id AND e.company_id=NEW.company_id
       AND e.valid_to IS NULL AND e.source_observation_id=NEW.employment_observation_id
       AND candidate.entity_type='person' AND candidate.entity_id=NEW.person_id
       AND candidate.field='source_review_candidate'
       AND candidate.snapshot_id=NEW.snapshot_id
       AND employment_source.entity_type='person'
       AND employment_source.entity_id=NEW.person_id
       AND s.entity_id=NEW.person_id AND s.allowlist_version='operator-local-v1'
       AND s.content_sha256=NEW.content_sha256 AND s.expires_at=NEW.expires_at
)
BEGIN SELECT RAISE(ABORT,'selected_source_attestation_scope'); END;

CREATE TRIGGER selected_source_attestation_no_update
BEFORE UPDATE ON selected_source_attestation
BEGIN SELECT RAISE(ABORT,'selected_source_attestation_immutable'); END;
CREATE TRIGGER selected_source_attestation_no_delete
BEFORE DELETE ON selected_source_attestation
BEGIN SELECT RAISE(ABORT,'selected_source_attestation_immutable'); END;

-- Every successful request is bound here, immutably, whether it minted a new
-- attestation or reused the existing one for an unchanged source context.  The
-- attestation table still holds exactly one row per source context; this ledger
-- holds exactly one row per request UUID, so an exact replay of any successful
-- request can always be answered with its original receipt, and any changed payload
-- under an already bound UUID is a conflict rather than new authority.
--
-- Like its parent, a row here grants no readiness, approval or send authority and
-- stores only opaque references, digests and time.
CREATE TABLE selected_source_attestation_request (
    request_id TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    expected_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    expected_source_context_digest TEXT NOT NULL
        CHECK (length(expected_source_context_digest)=64),
    expected_candidate_observation_id TEXT NOT NULL
        REFERENCES source_observation(observation_id),
    result_state TEXT NOT NULL CHECK (result_state IN ('attested','reused')),
    attestation_id TEXT NOT NULL REFERENCES selected_source_attestation(attestation_id),
    created_at TEXT NOT NULL
);

CREATE INDEX selected_source_attestation_request_receipt_idx
    ON selected_source_attestation_request(attestation_id);

-- A request row may only cite an attestation that already holds the exact context
-- the request named, so the ledger can never point a replay at another selection.
CREATE TRIGGER selected_source_attestation_request_scope_insert
BEFORE INSERT ON selected_source_attestation_request
WHEN NOT EXISTS (
    SELECT 1 FROM selected_source_attestation AS a
     WHERE a.attestation_id=NEW.attestation_id AND a.attested=1
       AND a.campaign_id=NEW.campaign_id AND a.person_id=NEW.person_id
       AND a.source_context_digest=NEW.expected_source_context_digest
       AND a.candidate_observation_id=NEW.expected_candidate_observation_id
)
BEGIN SELECT RAISE(ABORT,'selected_source_attestation_request_scope'); END;

CREATE TRIGGER selected_source_attestation_request_no_update
BEFORE UPDATE ON selected_source_attestation_request
BEGIN SELECT RAISE(ABORT,'selected_source_attestation_request_immutable'); END;
CREATE TRIGGER selected_source_attestation_request_no_delete
BEFORE DELETE ON selected_source_attestation_request
BEGIN SELECT RAISE(ABORT,'selected_source_attestation_request_immutable'); END;

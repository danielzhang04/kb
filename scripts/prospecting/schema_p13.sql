-- Phase 13 records explicit human confirmation of a current-role source binding.
CREATE TABLE identity_source_review (
    request_id TEXT PRIMARY KEY,
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    company_id TEXT NOT NULL REFERENCES company(company_id),
    employment_id TEXT NOT NULL REFERENCES employment(employment_id),
    prior_observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    candidate_observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    name_observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    snapshot_id TEXT NOT NULL REFERENCES source_snapshot(snapshot_id),
    attested INTEGER NOT NULL CHECK (attested = 1),
    created_at TEXT NOT NULL
);

CREATE TRIGGER identity_source_review_scope_insert BEFORE INSERT ON identity_source_review
WHEN NOT EXISTS (
    SELECT 1
      FROM fill_person AS fp
      JOIN employment AS e ON e.employment_id=NEW.employment_id
      JOIN source_observation AS candidate ON candidate.observation_id=NEW.candidate_observation_id
      JOIN source_observation AS o ON o.observation_id=NEW.observation_id
      JOIN source_observation AS name ON name.observation_id=NEW.name_observation_id
      JOIN source_snapshot AS s ON s.snapshot_id=NEW.snapshot_id
     WHERE fp.campaign_id=NEW.campaign_id AND fp.person_id=NEW.person_id
       AND fp.company_id=NEW.company_id AND fp.substituted=0
       AND e.person_id=NEW.person_id AND e.company_id=NEW.company_id
       AND e.valid_to IS NULL AND e.source_observation_id=NEW.observation_id
       AND candidate.snapshot_id=NEW.snapshot_id
       AND candidate.field IN ('employment','employer','current_employer','source_review_candidate')
       AND candidate.entity_type='person' AND candidate.entity_id=NEW.person_id
       AND o.snapshot_id=NEW.snapshot_id AND o.field='current_employer'
       AND name.snapshot_id=NEW.snapshot_id AND name.field='name'
       AND o.entity_type='person' AND o.entity_id=NEW.person_id AND s.entity_id=NEW.person_id
       AND name.entity_type='person' AND name.entity_id=NEW.person_id AND s.entity_id=NEW.person_id
)
BEGIN SELECT RAISE(ABORT, 'identity_source_review_scope'); END;

CREATE TRIGGER identity_source_review_no_update BEFORE UPDATE ON identity_source_review
BEGIN SELECT RAISE(ABORT, 'identity_source_review_immutable'); END;
CREATE TRIGGER identity_source_review_no_delete BEFORE DELETE ON identity_source_review
BEGIN SELECT RAISE(ABORT, 'identity_source_review_immutable'); END;

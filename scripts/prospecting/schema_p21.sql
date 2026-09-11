-- Phase 21 records one explicit human-edit restart after an exhausted P16 repair lineage.
-- The boundary and its ordinary waiting item commit together. It grants no readiness,
-- source-confirmation, approval, or send authority.
CREATE TABLE prospecting_pipeline_reset (
    reset_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash)=64),
    item_id TEXT NOT NULL UNIQUE
        REFERENCES prospecting_pipeline_item(item_id) DEFERRABLE INITIALLY DEFERRED,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    step INTEGER NOT NULL CHECK (step BETWEEN 0 AND 2),
    exhausted_item_id TEXT NOT NULL UNIQUE REFERENCES prospecting_pipeline_item(item_id),
    exhausted_root_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    exhausted_base_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    edited_revision_id TEXT NOT NULL UNIQUE REFERENCES revision(revision_id),
    edited_revision_hash TEXT NOT NULL CHECK (length(edited_revision_hash)=64),
    edit_parent_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    edit_candidate_id TEXT NOT NULL REFERENCES review_candidate(candidate_id),
    edit_request_id TEXT NOT NULL REFERENCES review_request(request_id),
    actor TEXT NOT NULL CHECK (actor LIKE 'human:%' AND actor <> 'human:'),
    created_at TEXT NOT NULL,
    CHECK (edited_revision_id<>exhausted_base_revision_id)
);

CREATE TRIGGER prospecting_pipeline_reset_scope_insert BEFORE INSERT ON prospecting_pipeline_reset
WHEN NOT EXISTS (
    SELECT 1 FROM prospecting_pipeline_item AS exhausted
     WHERE exhausted.item_id=NEW.exhausted_item_id
       AND exhausted.campaign_id=NEW.campaign_id AND exhausted.person_id=NEW.person_id
       AND exhausted.step=NEW.step AND exhausted.state='parked'
       AND exhausted.repair_cycle>=exhausted.max_repair_cycles
       AND exhausted.base_revision_id=NEW.exhausted_base_revision_id
       AND exhausted.lineage_root_revision_id=NEW.exhausted_root_revision_id
) OR NOT EXISTS (
    SELECT 1
      FROM revision AS child
      JOIN review_revision_lineage AS lineage ON lineage.child_revision_id=child.revision_id
      JOIN review_candidate AS candidate ON candidate.candidate_id=lineage.candidate_id
      JOIN review_request AS request ON request.request_id=lineage.request_id
      JOIN revision AS parent ON parent.revision_id=lineage.parent_revision_id
      JOIN revision AS base ON base.revision_id=NEW.exhausted_base_revision_id
      JOIN revision_qa_context AS qa_context ON qa_context.revision_id=child.revision_id
     WHERE child.revision_id=NEW.edited_revision_id AND child.hash=NEW.edited_revision_hash
       AND child.campaign_id=NEW.campaign_id AND child.person_id=NEW.person_id AND child.step=NEW.step
       AND lineage.parent_revision_id=NEW.edit_parent_revision_id
       AND lineage.candidate_id=NEW.edit_candidate_id AND lineage.request_id=NEW.edit_request_id
       AND lineage.campaign_id=NEW.campaign_id AND lineage.person_id=NEW.person_id AND lineage.step=NEW.step
       AND candidate.request_id=lineage.request_id
       AND candidate.parent_revision_id=lineage.parent_revision_id
       AND candidate.qa_state='revision_created' AND json_extract(candidate.qa_json,'$.passed')=1
       AND request.operation='edit' AND request.result_state='revision_created'
       AND request.expected_revision_id=lineage.parent_revision_id
       AND request.result_id=candidate.candidate_id
       AND child.subject=candidate.subject AND child.body=candidate.body
       AND json_extract(child.qa,'$.passed')=1
       AND qa_context.inherited_from_revision_id=lineage.parent_revision_id
       AND (child.subject<>parent.subject OR child.body<>parent.body)
       AND (child.subject<>base.subject OR child.body<>base.body)
) OR EXISTS (
    SELECT 1 FROM prospecting_agent_revision_lineage WHERE child_revision_id=NEW.edited_revision_id
) OR EXISTS (
    SELECT 1 FROM prospecting_pipeline_item WHERE item_id=NEW.item_id OR request_id=NEW.request_id
)
BEGIN SELECT RAISE(ABORT,'prospecting_pipeline_reset_scope'); END;

-- A reserved item is exactly the cycle-0 waiting item on the edited revision. Any other
-- item may use a lineage root with a parent only when a committed reset owns that root.
CREATE TRIGGER prospecting_pipeline_reset_item_insert BEFORE INSERT ON prospecting_pipeline_item
WHEN (
    EXISTS (
        SELECT 1 FROM prospecting_pipeline_reset
         WHERE item_id=NEW.item_id OR request_id=NEW.request_id
    ) AND NOT EXISTS (
        SELECT 1 FROM prospecting_pipeline_reset AS reset
         WHERE reset.item_id=NEW.item_id AND reset.request_id=NEW.request_id
           AND reset.campaign_id=NEW.campaign_id AND reset.person_id=NEW.person_id
           AND reset.step=NEW.step AND reset.edited_revision_id=NEW.base_revision_id
           AND reset.edited_revision_hash=NEW.base_revision_hash
           AND NEW.lineage_root_revision_id=reset.edited_revision_id
           AND NEW.state='awaiting_humanizer_adapter' AND NEW.next_stage='humanizer'
           AND NEW.repair_cycle=0 AND NEW.claim_epoch=0
    )
) OR (
    (
        EXISTS (SELECT 1 FROM review_revision_lineage WHERE child_revision_id=NEW.lineage_root_revision_id)
        OR EXISTS (SELECT 1 FROM prospecting_agent_revision_lineage WHERE child_revision_id=NEW.lineage_root_revision_id)
    ) AND NOT EXISTS (
        SELECT 1 FROM prospecting_pipeline_reset AS reset
         WHERE reset.edited_revision_id=NEW.lineage_root_revision_id
           AND reset.campaign_id=NEW.campaign_id AND reset.person_id=NEW.person_id
           AND reset.step=NEW.step
    )
)
BEGIN SELECT RAISE(ABORT,'prospecting_pipeline_reset_item_scope'); END;

CREATE TRIGGER prospecting_pipeline_reset_no_update BEFORE UPDATE ON prospecting_pipeline_reset BEGIN SELECT RAISE(ABORT,'prospecting_pipeline_reset_immutable'); END;
CREATE TRIGGER prospecting_pipeline_reset_no_delete BEFORE DELETE ON prospecting_pipeline_reset BEGIN SELECT RAISE(ABORT,'prospecting_pipeline_reset_immutable'); END;

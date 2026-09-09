-- Phase 14 records a human-confirmed fulfillment of one immutable feedback request.
CREATE TABLE draft_feedback_outcome (
    outcome_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
    feedback_id TEXT NOT NULL UNIQUE REFERENCES draft_feedback(feedback_id),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    original_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    child_revision_id TEXT NOT NULL UNIQUE REFERENCES revision(revision_id),
    edit_request_id TEXT NOT NULL UNIQUE REFERENCES review_request(request_id),
    state TEXT NOT NULL CHECK (state = 'fulfilled'),
    created_at TEXT NOT NULL,
    CHECK (child_revision_id <> original_revision_id)
);

CREATE TRIGGER draft_feedback_outcome_scope_insert BEFORE INSERT ON draft_feedback_outcome
WHEN NOT EXISTS (
    SELECT 1
      FROM draft_feedback AS feedback
      JOIN revision AS original ON original.revision_id=feedback.revision_id
      JOIN review_revision_lineage AS lineage
        ON lineage.child_revision_id=NEW.child_revision_id
       AND lineage.parent_revision_id=feedback.revision_id
      JOIN review_candidate AS candidate ON candidate.candidate_id=lineage.candidate_id
      JOIN review_request AS request ON request.request_id=lineage.request_id
      JOIN revision AS child ON child.revision_id=lineage.child_revision_id
      JOIN revision_qa_context AS qa_context ON qa_context.revision_id=child.revision_id
     WHERE feedback.feedback_id=NEW.feedback_id
       AND feedback.campaign_id=NEW.campaign_id
       AND feedback.person_id=NEW.person_id
       AND feedback.revision_id=NEW.original_revision_id
       AND feedback.attempt_state='pending'
       AND original.campaign_id=NEW.campaign_id AND original.person_id=NEW.person_id
       AND child.campaign_id=NEW.campaign_id AND child.person_id=NEW.person_id
       AND child.step=original.step
       AND child.subject=candidate.subject AND child.body=candidate.body
       AND json_extract(child.qa,'$.passed')=1
       AND qa_context.inherited_from_revision_id=NEW.original_revision_id
       AND lineage.campaign_id=NEW.campaign_id AND lineage.person_id=NEW.person_id
       AND lineage.request_id=NEW.edit_request_id
       AND candidate.request_id=NEW.edit_request_id
       AND candidate.campaign_id=NEW.campaign_id AND candidate.person_id=NEW.person_id
       AND candidate.parent_revision_id=NEW.original_revision_id
       AND candidate.qa_state='revision_created'
       AND json_extract(candidate.qa_json,'$.passed')=1
       AND request.operation='edit' AND request.result_state='revision_created'
       AND request.campaign_id=NEW.campaign_id AND request.person_id=NEW.person_id
       AND request.expected_revision_id=NEW.original_revision_id
       AND request.result_id=candidate.candidate_id
       AND NOT EXISTS (
           SELECT 1 FROM revision AS newer
            WHERE newer.campaign_id=child.campaign_id AND newer.person_id=child.person_id
              AND newer.step=child.step AND newer.rowid>child.rowid
       )
)
BEGIN SELECT RAISE(ABORT, 'draft_feedback_outcome_scope'); END;

CREATE TRIGGER draft_feedback_outcome_no_update BEFORE UPDATE ON draft_feedback_outcome
BEGIN SELECT RAISE(ABORT, 'draft_feedback_outcome_immutable'); END;
CREATE TRIGGER draft_feedback_outcome_no_delete BEFORE DELETE ON draft_feedback_outcome
BEGIN SELECT RAISE(ABORT, 'draft_feedback_outcome_immutable'); END;

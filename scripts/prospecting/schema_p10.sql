-- Phase 10 desktop-local draft review state. Existing revision and approval owners remain authoritative.
CREATE TABLE review_request (
    request_id TEXT PRIMARY KEY,
    operation TEXT NOT NULL CHECK (operation IN ('edit','feedback','editorial')),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    expected_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    request_hash TEXT NOT NULL CHECK (length(request_hash) = 64),
    result_state TEXT NOT NULL CHECK (result_state IN (
        'pending_qa','qa_failed','revision_created','pending','ready','review_required'
    )),
    result_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    CHECK ((operation = 'edit' AND result_state IN ('pending_qa','qa_failed','revision_created'))
        OR (operation = 'feedback' AND result_state = 'pending')
        OR (operation = 'editorial' AND result_state IN ('ready','review_required')))
);

CREATE TABLE review_candidate (
    candidate_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    step INTEGER NOT NULL CHECK (step BETWEEN 0 AND 2),
    parent_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    subject TEXT NOT NULL CHECK (length(subject) BETWEEN 1 AND 998),
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 65536),
    qa_state TEXT NOT NULL CHECK (qa_state IN ('pending_qa','qa_failed','revision_created')),
    qa_json TEXT CHECK (qa_json IS NULL OR json_valid(qa_json)),
    created_at TEXT NOT NULL,
    CHECK ((qa_state = 'pending_qa' AND qa_json IS NULL)
        OR (qa_state <> 'pending_qa' AND qa_json IS NOT NULL))
);

CREATE TABLE review_revision_lineage (
    child_revision_id TEXT PRIMARY KEY REFERENCES revision(revision_id),
    parent_revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    candidate_id TEXT NOT NULL UNIQUE REFERENCES review_candidate(candidate_id),
    request_id TEXT NOT NULL UNIQUE,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    step INTEGER NOT NULL CHECK (step BETWEEN 0 AND 2),
    created_at TEXT NOT NULL,
    CHECK (child_revision_id <> parent_revision_id)
);

CREATE TABLE draft_feedback (
    feedback_id TEXT PRIMARY KEY,
    request_id TEXT NOT NULL UNIQUE,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    disposition TEXT NOT NULL CHECK (disposition IN (
        'tone','length','specificity','accuracy','ask','other'
    )),
    tags_json TEXT NOT NULL CHECK (json_valid(tags_json)),
    feedback_text TEXT CHECK (feedback_text IS NULL OR length(feedback_text) <= 16384),
    attempt_state TEXT NOT NULL CHECK (attempt_state = 'pending'),
    created_at TEXT NOT NULL,
    UNIQUE(campaign_id, revision_id)
);

CREATE TABLE draft_editorial_event (
    sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    request_id TEXT NOT NULL UNIQUE,
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    person_id TEXT NOT NULL REFERENCES person(person_id),
    revision_id TEXT NOT NULL REFERENCES revision(revision_id),
    state TEXT NOT NULL CHECK (state IN ('ready','review_required')),
    created_at TEXT NOT NULL
);
CREATE INDEX draft_editorial_scope_idx
    ON draft_editorial_event(campaign_id, person_id, revision_id, sequence DESC);

CREATE TRIGGER review_candidate_scope_insert BEFORE INSERT ON review_candidate
WHEN NOT EXISTS (
    SELECT 1 FROM revision AS r
     WHERE r.revision_id = NEW.parent_revision_id
       AND r.campaign_id = NEW.campaign_id
       AND r.person_id = NEW.person_id
       AND r.step = NEW.step
)
BEGIN SELECT RAISE(ABORT, 'review_candidate_scope'); END;

CREATE TRIGGER review_lineage_scope_insert BEFORE INSERT ON review_revision_lineage
WHEN NOT EXISTS (
    SELECT 1
      FROM revision AS child
      JOIN revision AS parent ON parent.revision_id = NEW.parent_revision_id
      JOIN review_candidate AS candidate ON candidate.candidate_id = NEW.candidate_id
     WHERE child.revision_id = NEW.child_revision_id
       AND child.campaign_id = NEW.campaign_id AND child.person_id = NEW.person_id AND child.step = NEW.step
       AND parent.campaign_id = NEW.campaign_id AND parent.person_id = NEW.person_id AND parent.step = NEW.step
       AND candidate.request_id = NEW.request_id
       AND candidate.campaign_id = NEW.campaign_id AND candidate.person_id = NEW.person_id
       AND candidate.step = NEW.step AND candidate.parent_revision_id = NEW.parent_revision_id
       AND candidate.qa_state = 'revision_created'
)
BEGIN SELECT RAISE(ABORT, 'review_lineage_scope'); END;

CREATE TRIGGER draft_feedback_scope_insert BEFORE INSERT ON draft_feedback
WHEN NOT EXISTS (
    SELECT 1 FROM revision AS r
     WHERE r.revision_id = NEW.revision_id
       AND r.campaign_id = NEW.campaign_id AND r.person_id = NEW.person_id
)
BEGIN SELECT RAISE(ABORT, 'draft_feedback_scope'); END;

CREATE TRIGGER draft_editorial_scope_insert BEFORE INSERT ON draft_editorial_event
WHEN NOT EXISTS (
    SELECT 1 FROM revision AS r
     WHERE r.revision_id = NEW.revision_id
       AND r.campaign_id = NEW.campaign_id AND r.person_id = NEW.person_id
)
BEGIN SELECT RAISE(ABORT, 'draft_editorial_scope'); END;

CREATE TRIGGER review_request_scope_insert BEFORE INSERT ON review_request
WHEN NOT EXISTS (
    SELECT 1 FROM revision AS r
     WHERE r.revision_id = NEW.expected_revision_id
       AND r.campaign_id = NEW.campaign_id AND r.person_id = NEW.person_id
) OR (NEW.operation = 'edit' AND NOT EXISTS (
    SELECT 1 FROM review_candidate AS candidate
     WHERE candidate.candidate_id = NEW.result_id AND candidate.request_id = NEW.request_id
       AND candidate.campaign_id = NEW.campaign_id AND candidate.person_id = NEW.person_id
       AND candidate.parent_revision_id = NEW.expected_revision_id
       AND candidate.qa_state = NEW.result_state
)) OR (NEW.operation = 'feedback' AND NOT EXISTS (
    SELECT 1 FROM draft_feedback AS feedback
     WHERE feedback.feedback_id = NEW.result_id AND feedback.request_id = NEW.request_id
       AND feedback.campaign_id = NEW.campaign_id AND feedback.person_id = NEW.person_id
       AND feedback.revision_id = NEW.expected_revision_id
)) OR (NEW.operation = 'editorial' AND NOT EXISTS (
    SELECT 1 FROM draft_editorial_event AS event
     WHERE event.event_id = NEW.result_id AND event.request_id = NEW.request_id
       AND event.campaign_id = NEW.campaign_id AND event.person_id = NEW.person_id
       AND event.revision_id = NEW.expected_revision_id AND event.state = NEW.result_state
))
BEGIN SELECT RAISE(ABORT, 'review_request_scope'); END;

CREATE TRIGGER review_request_no_update BEFORE UPDATE ON review_request BEGIN SELECT RAISE(ABORT, 'review_request_immutable'); END;
CREATE TRIGGER review_request_no_delete BEFORE DELETE ON review_request BEGIN SELECT RAISE(ABORT, 'review_request_immutable'); END;
CREATE TRIGGER review_candidate_no_update BEFORE UPDATE ON review_candidate BEGIN SELECT RAISE(ABORT, 'review_candidate_immutable'); END;
CREATE TRIGGER review_candidate_no_delete BEFORE DELETE ON review_candidate BEGIN SELECT RAISE(ABORT, 'review_candidate_immutable'); END;
CREATE TRIGGER review_lineage_no_update BEFORE UPDATE ON review_revision_lineage BEGIN SELECT RAISE(ABORT, 'review_lineage_immutable'); END;
CREATE TRIGGER review_lineage_no_delete BEFORE DELETE ON review_revision_lineage BEGIN SELECT RAISE(ABORT, 'review_lineage_immutable'); END;
CREATE TRIGGER draft_feedback_no_update BEFORE UPDATE ON draft_feedback BEGIN SELECT RAISE(ABORT, 'draft_feedback_immutable'); END;
CREATE TRIGGER draft_feedback_no_delete BEFORE DELETE ON draft_feedback BEGIN SELECT RAISE(ABORT, 'draft_feedback_immutable'); END;
CREATE TRIGGER draft_editorial_no_update BEFORE UPDATE ON draft_editorial_event BEGIN SELECT RAISE(ABORT, 'draft_editorial_immutable'); END;
CREATE TRIGGER draft_editorial_no_delete BEFORE DELETE ON draft_editorial_event BEGIN SELECT RAISE(ABORT, 'draft_editorial_immutable'); END;

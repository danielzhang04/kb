-- Phase 11 records the exact local QA inputs that produced a P3 revision.
CREATE TABLE revision_qa_context (
    revision_id TEXT PRIMARY KEY REFERENCES revision(revision_id),
    context_version INTEGER NOT NULL CHECK (context_version = 1),
    bindings_json TEXT NOT NULL CHECK (json_valid(bindings_json) AND json_type(bindings_json) = 'object'),
    qa_policy_json TEXT NOT NULL CHECK (json_valid(qa_policy_json) AND json_type(qa_policy_json) = 'object'),
    context_sha256 TEXT NOT NULL CHECK (length(context_sha256) = 64),
    inherited_from_revision_id TEXT REFERENCES revision(revision_id),
    created_at TEXT NOT NULL,
    CHECK (inherited_from_revision_id IS NULL OR inherited_from_revision_id <> revision_id)
);

CREATE TRIGGER revision_qa_context_scope_insert BEFORE INSERT ON revision_qa_context
WHEN NOT EXISTS (SELECT 1 FROM revision WHERE revision_id = NEW.revision_id)
  OR (NEW.inherited_from_revision_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
        FROM revision AS child
        JOIN revision AS parent ON parent.revision_id = NEW.inherited_from_revision_id
        JOIN revision_qa_context AS parent_context
          ON parent_context.revision_id = parent.revision_id
       WHERE child.revision_id = NEW.revision_id
         AND child.campaign_id = parent.campaign_id
         AND child.person_id = parent.person_id
         AND child.step = parent.step
         AND parent_context.context_sha256 = NEW.context_sha256
  ))
BEGIN SELECT RAISE(ABORT, 'revision_qa_context_scope'); END;

CREATE TRIGGER revision_qa_context_no_update BEFORE UPDATE ON revision_qa_context
BEGIN SELECT RAISE(ABORT, 'revision_qa_context_immutable'); END;
CREATE TRIGGER revision_qa_context_no_delete BEFORE DELETE ON revision_qa_context
BEGIN SELECT RAISE(ABORT, 'revision_qa_context_immutable'); END;

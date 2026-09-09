-- P2 vendor executor operations; this is applied by store.migrate after P1 schema.sql.
PRAGMA defer_foreign_keys=ON;
CREATE TABLE linkedin_checkpoint_stop(
    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
    reason TEXT NOT NULL,
    stopped_at TEXT NOT NULL,
    cleared_at TEXT,
    cleared_by TEXT CHECK(cleared_by IS NULL OR cleared_by GLOB 'human:*')
);
CREATE TABLE exec_request_p2(
    request_id TEXT PRIMARY KEY, caller TEXT NOT NULL,
    operation TEXT NOT NULL CHECK(operation IN (
        'fetch_snapshot','finder_page','vendor_lookup','gmail_draft','gmail_send',
        'gmail_label','gmail_thread_refresh','vendor.pdl.person_search',
        'vendor.apify.profile_batch','vendor.hunter.find','vendor.hunter.verify',
        'vendor.snov.find','vendor.snov.verify'
    )),
    payload TEXT NOT NULL CHECK(json_valid(payload)),
    policy_hash TEXT NOT NULL CHECK(length(policy_hash)=64),
    approval_id TEXT REFERENCES approval(approval_id),
    created_at TEXT NOT NULL, claimed_at TEXT,
    state TEXT NOT NULL CHECK(state IN ('queued','claimed','succeeded','rejected','uncertain')),
    reason TEXT
);
INSERT INTO exec_request_p2 SELECT * FROM exec_request;
DROP TABLE exec_request;
ALTER TABLE exec_request_p2 RENAME TO exec_request;

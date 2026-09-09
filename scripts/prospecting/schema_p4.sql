CREATE TABLE IF NOT EXISTS inbound_claim (
    message_id TEXT NOT NULL UNIQUE,
    claimed_at TEXT NOT NULL
);

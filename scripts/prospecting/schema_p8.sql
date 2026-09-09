-- Phase 8 affinity side tables.  Additive only: no ALTER, no DROP, no P1-P6 object touched.
CREATE TABLE IF NOT EXISTS campaign_fit_spec (
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    fit_spec_hash TEXT NOT NULL CHECK (length(fit_spec_hash) = 64),
    fit_spec_json TEXT NOT NULL CHECK (json_valid(fit_spec_json)),
    compiled_at TEXT NOT NULL,
    approved_at TEXT,
    approver TEXT,
    state TEXT NOT NULL CHECK (state IN ('proposed','approved','superseded')),
    PRIMARY KEY (campaign_id, fit_spec_hash)
);

CREATE TABLE IF NOT EXISTS person_background (
    person_id TEXT PRIMARY KEY REFERENCES person(person_id),
    has_about INTEGER NOT NULL DEFAULT 0 CHECK (has_about IN (0,1)),
    hometown_hint TEXT,
    current_kind TEXT,
    kind_sequence TEXT NOT NULL CHECK (json_valid(kind_sequence)),
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS person_education (
    person_id TEXT NOT NULL REFERENCES person(person_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    school_norm TEXT NOT NULL,
    school_raw TEXT NOT NULL,
    degree TEXT,
    start_year INTEGER CHECK (start_year IS NULL OR start_year BETWEEN 1900 AND 2200),
    end_year INTEGER CHECK (end_year IS NULL OR end_year BETWEEN 1900 AND 2200),
    observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    PRIMARY KEY (person_id, ordinal)
);

CREATE TABLE IF NOT EXISTS person_employer (
    person_id TEXT NOT NULL REFERENCES person(person_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    employer_norm TEXT NOT NULL,
    employer_raw TEXT NOT NULL,
    employer_kind TEXT NOT NULL CHECK (employer_kind IN (
        'bank','consultancy','pe','vc','hedge_fund','startup','bigtech','corporate',
        'government','academia','nonprofit','other')),
    title TEXT,
    start_year INTEGER CHECK (start_year IS NULL OR start_year BETWEEN 1900 AND 2200),
    end_year INTEGER CHECK (end_year IS NULL OR end_year BETWEEN 1900 AND 2200),
    observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    PRIMARY KEY (person_id, ordinal)
);

CREATE TABLE IF NOT EXISTS person_link (
    person_id TEXT NOT NULL REFERENCES person(person_id),
    ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
    kind TEXT NOT NULL CHECK (kind IN ('writing','podcast','board','portfolio','profile')),
    url TEXT NOT NULL CHECK (url LIKE 'https://%'),
    observation_id TEXT NOT NULL REFERENCES source_observation(observation_id),
    PRIMARY KEY (person_id, ordinal)
);

CREATE TABLE IF NOT EXISTS person_research_state (
    person_id TEXT NOT NULL REFERENCES person(person_id),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    bio_state TEXT NOT NULL CHECK (bio_state IN ('pending','fetched','absent','blocked','error')),
    bio_pages INTEGER NOT NULL DEFAULT 0 CHECK (bio_pages >= 0),
    linkedin_state TEXT NOT NULL CHECK (linkedin_state IN (
        'not_needed','pending','loaded','cap_reached','checkpoint','disabled')),
    linkedin_loads INTEGER NOT NULL DEFAULT 0 CHECK (linkedin_loads >= 0),
    reason TEXT,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (person_id, campaign_id)
);

CREATE TABLE IF NOT EXISTS person_affinity (
    person_id TEXT NOT NULL REFERENCES person(person_id),
    campaign_id TEXT NOT NULL REFERENCES campaign(campaign_id),
    score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
    signals_json TEXT NOT NULL CHECK (json_valid(signals_json)),
    computed_at TEXT NOT NULL,
    fit_spec_hash TEXT NOT NULL CHECK (length(fit_spec_hash) = 64),
    PRIMARY KEY (person_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS person_affinity_campaign_score_idx
    ON person_affinity(campaign_id, score DESC);

-- column order is a pinned contract
CREATE VIEW deliverable_v2 AS
SELECT selected.campaign_id AS campaign_id,
       c.name AS firm,
       COALESCE(profile.blurb, c.one_line_summary) AS firm_blurb,
       COALESCE(profile.website, c.website_url) AS website,
       p.full_name AS full_name,
       e.title AS title,
       person_profile.seniority_class AS seniority_class,
       p.linkedin_url AS linkedin_url,
       cp.email AS email,
       cp.state AS email_state,
       cp.confidence AS confidence,
       affinity.score AS score,
       json_extract(affinity.signals_json, '$[0].code') AS reason_1,
       json_extract(affinity.signals_json, '$[1].code') AS reason_2,
       json_extract(affinity.signals_json, '$[2].code') AS reason_3,
       TRIM(
         COALESCE('ex-' || background.current_kind || ', ', '')
         || COALESCE((SELECT ed.school_raw || ' ''' || substr(CAST(ed.end_year AS TEXT), 3, 2) || ', '
                      FROM person_education AS ed
                      WHERE ed.person_id = p.person_id AND ed.end_year IS NOT NULL
                      ORDER BY ed.ordinal LIMIT 1), '')
         || 'joined as ' || COALESCE(e.title, 'their current role')
         || COALESCE(' ' || strftime('%Y', e.valid_from), '')
       ) AS person_blurb
FROM fill_person AS selected
JOIN fill_firm AS ff ON ff.campaign_id = selected.campaign_id
  AND ff.company_id = selected.company_id AND ff.status <> 'no_confident_email'
JOIN person AS p ON p.person_id = selected.person_id
JOIN company AS c ON c.company_id = selected.company_id
JOIN employment AS e ON e.person_id = p.person_id AND e.company_id = c.company_id
  AND e.valid_to IS NULL
JOIN contact_point AS cp ON cp.person_id = p.person_id AND cp.state = 'valid'
  AND cp.confidence >= 0.7
JOIN person_affinity AS affinity ON affinity.person_id = p.person_id
  AND affinity.campaign_id = selected.campaign_id
LEFT JOIN company_profile AS profile ON profile.company_id = c.company_id
LEFT JOIN person_profile ON person_profile.person_id = p.person_id
LEFT JOIN person_background AS background ON background.person_id = p.person_id
WHERE selected.substituted = 0
  AND affinity.score >= COALESCE((
        SELECT json_extract(spec.fit_spec_json, '$.min_fit')
          FROM campaign_fit_spec AS spec
         WHERE spec.campaign_id = selected.campaign_id AND spec.state = 'approved'
      ), 25);

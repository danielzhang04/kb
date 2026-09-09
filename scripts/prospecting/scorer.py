"""Deterministic contact cleaning, review-only dedupe, and fit scoring."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import sqlite3
from typing import Mapping, Sequence

from scripts.prospecting.store import (
    FitScoreVersion,
    MergeReview,
    decide_eligibility,
    insert_eligibility_decision,
    insert_fit_score_version,
    insert_merge_review,
)
from scripts.prospecting.p2_store import TargetPolicy


FIT_SCORE_V1_RULES = {
    "title_match": 30,
    "seniority_match": 25,
    "industry_match": 25,
    "location_match": 20,
}


@dataclass(frozen=True)
class CleaningResult:
    valid: int
    quarantined: int
    excluded_role: int


@dataclass(frozen=True)
class DedupeResult:
    canonical: int
    duplicates: int
    conflicts: int


def _marks(values: Sequence[str]) -> str:
    if not values:
        raise ValueError("person_ids must not be empty")
    return ",".join("?" for _ in values)


def clean_contacts(
    connection: sqlite3.Connection, person_ids: Sequence[str], at: str
) -> CleaningResult:
    """Return deterministic contact-state counts without changing provenance."""
    del at
    rows = connection.execute(
        f"""SELECT state,COUNT(*) AS count FROM contact_point
             WHERE person_id IN ({_marks(person_ids)}) GROUP BY state""",
        tuple(person_ids),
    ).fetchall()
    counts = {str(row[0]): int(row[1]) for row in rows}
    role = counts.get("role", 0)
    quarantined = sum(
        counts.get(state, 0)
        for state in ("invalid", "risky", "catch_all", "role", "stale")
    )
    return CleaningResult(counts.get("valid", 0), quarantined, role)


def dedupe_people(
    connection: sqlite3.Connection, person_ids: Sequence[str], at: str
) -> DedupeResult:
    """Open a review when a canonical person has conflicting provider observations.

    ``person.dedupe_key`` is unique, so duplicate provenance belongs on one canonical
    person row. This function never merges or alters those immutable observations.
    """
    rows = connection.execute(
        f"""SELECT person_id
             FROM person
             WHERE person_id IN ({_marks(person_ids)})""",
        tuple(person_ids),
    ).fetchall()
    conflicts = 0
    with connection:
        for row in rows:
            candidate_ids = (str(row["person_id"]),)
            observation_rows = tuple(
                connection.execute(
                    """SELECT observation_id,field,value FROM source_observation
                       WHERE entity_type='person'
                         AND entity_id IN (SELECT value FROM json_each(?))
                       ORDER BY observation_id""",
                    (json.dumps(candidate_ids),),
                )
            )
            values_by_field: dict[str, set[str]] = {}
            for observation in observation_rows:
                values_by_field.setdefault(str(observation["field"]), set()).add(
                    str(observation["value"])
                )
            if not any(len(values) > 1 for values in values_by_field.values()):
                continue
            observation_ids = tuple(str(item["observation_id"]) for item in observation_rows)
            seed = json.dumps((candidate_ids, observation_ids), separators=(",", ":"))
            review = MergeReview(
                "mr_" + hashlib.sha256(seed.encode("utf-8")).hexdigest()[:16],
                "person",
                candidate_ids,
                observation_ids,
                "conflicting_observations",
            )
            try:
                insert_merge_review(connection, review)
            except sqlite3.IntegrityError:
                pass
            else:
                conflicts += 1
    return DedupeResult(len(rows), 0, conflicts)


def ensure_fit_score_v1(connection: sqlite3.Connection, at: str) -> str:
    canonical = json.dumps(FIT_SCORE_V1_RULES, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    version_row = connection.execute(
        "SELECT fit_score_version_id,rule_hash FROM fit_score_version WHERE version='fit-v1'"
    ).fetchone()
    if version_row is not None:
        if version_row["rule_hash"] != digest:
            raise ValueError("fit-v1 rules do not match the immutable stored version")
        return str(version_row["fit_score_version_id"])
    version_id = "fit_" + digest[:16]
    insert_fit_score_version(
        connection, FitScoreVersion(version_id, "fit-v1", canonical, digest, at, at)
    )
    return version_id


def score_person(
    connection: sqlite3.Connection,
    campaign_id: str,
    person_id: str,
    observations: Mapping[str, object],
    at: str,
) -> int:
    version_id = ensure_fit_score_v1(connection, at)
    score = sum(
        weight for name, weight in FIT_SCORE_V1_RULES.items() if observations.get(name) is True
    )
    components = json.dumps(
        {name: observations.get(name) is True for name in FIT_SCORE_V1_RULES},
        sort_keys=True,
        separators=(",", ":"),
    )
    score_seed = json.dumps(
        (campaign_id, person_id, version_id, components, at), separators=(",", ":")
    )
    fit_score_id = "fs_" + hashlib.sha256(score_seed.encode("utf-8")).hexdigest()[:16]
    connection.execute(
        """INSERT INTO fit_score(
               fit_score_id,campaign_id,person_id,fit_score_version_id,score,components,scored_at
           ) VALUES(?,?,?,?,?,?,?)
           ON CONFLICT(fit_score_id) DO NOTHING""",
        (
            fit_score_id,
            campaign_id,
            person_id,
            version_id,
            score,
            components,
            at,
        ),
    )
    return score


def write_eligibility(
    connection: sqlite3.Connection,
    campaign_id: str,
    person_id: str,
    policy: TargetPolicy,
    score_version_id: str,
    at: str,
):
    """Persist P1's deterministic eligibility decision without a model surface."""
    decision_seed = json.dumps(
        (campaign_id, person_id, policy.scorer_version, score_version_id, at),
        separators=(",", ":"),
    )
    decision = decide_eligibility(
        "ed_" + hashlib.sha256(decision_seed.encode("utf-8")).hexdigest()[:16],
        campaign_id,
        person_id,
        policy.scorer_version,
        score_version_id,
        (),
        (),
        at,
        None,
    )
    insert_eligibility_decision(connection, decision)
    return decision

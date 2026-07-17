"""Pinned grade-row schema + paired grade/activity writer (spec Task 3.3).

`record_grade` is the single writer for `ledgers/grades/**`. The row shape is
EXACT — no missing, no extra fields — because `promotion.py` (3.1) and
`reconcile.py` (3.2) key off this schema. Every call also appends a paired
`ledgers/activity/` row, authored under the Inspector identity (the `agent`
used for the activity shard filename is `inspector_id`), so the weekly
reconcile (3.2) can cross-check grade rows against Inspector-authored
activity commits.
"""
from __future__ import annotations

import datetime

import ledger

REQUIRED_FIELDS = frozenset(
    {
        "worker",
        "project",
        "task_type",
        "tier",
        "card_id",
        "score",
        "pass",
        "rubric_version",
        "inspector_id",
    }
)
# `ts` is optional at the call site (auto-generated when omitted) but is
# always present in the written row, so the schema is REQUIRED_FIELDS | {ts}.
ALLOWED_FIELDS = REQUIRED_FIELDS | {"ts"}


def record_grade(repo_root, **fields):
    """Validate the pinned grade-row schema and append paired ledger rows.

    Returns (grade_path, activity_path).
    """
    given = set(fields)
    missing = REQUIRED_FIELDS - given
    if missing:
        raise ValueError(f"missing required grade fields: {sorted(missing)}")
    extra = given - ALLOWED_FIELDS
    if extra:
        raise ValueError(f"unexpected grade fields (schema is exact): {sorted(extra)}")

    score = fields["score"]
    if isinstance(score, bool) or not isinstance(score, (int, float)):
        raise ValueError("score must be a number (int or float), not bool")
    if not (0 <= score <= 100):
        raise ValueError("score must be in [0, 100]")

    if not isinstance(fields["pass"], bool):
        raise ValueError("pass must be a bool")

    ts = fields.get("ts") or datetime.datetime.now(datetime.timezone.utc).isoformat()

    grade_row = {key: fields[key] for key in REQUIRED_FIELDS}
    grade_row["ts"] = ts

    inspector_id = fields["inspector_id"]
    grade_path = ledger.append(repo_root, "grades", inspector_id, grade_row)

    activity_row = {
        "ts": ts,
        "inspector_id": inspector_id,
        "card_id": fields["card_id"],
        "worker": fields["worker"],
        "project": fields["project"],
        "task_type": fields["task_type"],
        "tier": fields["tier"],
        "kind": "grade",
    }
    activity_path = ledger.append(repo_root, "activity", inspector_id, activity_row)

    return grade_path, activity_path

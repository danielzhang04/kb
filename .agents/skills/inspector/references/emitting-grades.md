# Emitting a grade — pinned schema, paired rows, Inspector identity

## The pinned grade-row schema
`ledgers/grades/**` rows are written and read by `scripts/promotion.py`, so their shape is pinned
and must never be hand-varied. Exactly these fields, no more, no fewer:

```
worker          str   — the agent identity that produced the graded work (e.g. "claude/m1-fleet")
project         str   — the owning org/project (card's `project` field)
task_type       str   — see "Deriving task_type" below
tier            str   — "T1" | "T2" | "T3" (card's `risk-tier` field)
card_id         str   — the card's `id` (ulid)
score           int   — 0-100, your aggregated score per SKILL.md section 3
pass            bool  — score >= the tier's pass bar (T1 90 / T2 95 / T3 98)
rubric_version  str   — e.g. "inspector-v1"
inspector_id    str   — always "inspector@agents.local"
ts              str   — ISO-8601 UTC timestamp of the grading, e.g. "2026-07-16T18:04:00Z"
```

## How to emit it
Always go through `record_grade` (from `scripts/grade.py`) — never hand-append to
`ledgers/grades/**` or `ledgers/activity/**` yourselves. `record_grade` validates the schema and
writes **both** the grade row and a paired `ledgers/activity/` row, authored under the same
Inspector identity, in the same call. That pairing is exactly what the weekly
`scripts/reconcile.py` cross-check keys on (Inspector-authored activity rows only) — a grade row
with no matching Inspector activity row gets your whole grades ledger frozen, so never bypass it.

`scripts/grade.py` is a flat module (`import ledger`, not a package import) — the repo's own
`conftest.py` puts `scripts/` on `sys.path` for tests, and you should do the same thing yourself
when invoking it standalone. Build the fields as a plain dict first (this also sidesteps `pass`
being a Python reserved word as a literal keyword-argument token) and spread it into the call:

```python
import sys
from pathlib import Path

sys.path.insert(0, str(Path("<repo_root>") / "scripts"))
import grade  # scripts/grade.py

fields = {
    "worker": "claude/m1-fleet",
    "project": "kb",
    "task_type": card_action,          # see "Deriving task_type" below
    "tier": card_risk_tier,             # e.g. "T2"
    "card_id": card_id,                 # the card's ulid
    "score": 96,
    "pass": True,                       # score >= tier pass bar
    "rubric_version": "inspector-v1",
    "inspector_id": "inspector@agents.local",
    "ts": "2026-07-16T18:04:00Z",       # ISO-8601 UTC; omit and grade.py fills it in for you
}
grade.record_grade("<repo_root>", **fields)
```

From a shell, the equivalent is a short `py -3 -c` one-liner from the repo root that does the same
`sys.path` insert, builds the same dict, and calls `grade.record_grade(...)` — do not construct
the grade row any other way (never hand-append TSV rows, never call `ledger.append` directly for
grades).

## Deriving `task_type`
`governance/card-schema.md` does not (yet) define a dedicated `task_type` field on cards. Until it
does, use the card's `action` verb-phrase (set only by the Manager/dispatcher, per card-schema) as
`task_type` — it's the closest existing field to "what kind of task was this." If a future card
schema adds an explicit `task_type:` field, prefer that field once it exists.

## Identity discipline
- `inspector_id` is always the literal string `inspector@agents.local`, regardless of which
  underlying model or agent session is doing the grading. This is a role identity, not a model
  identity — it's what makes grade rows attributable to "the Inspector role" rather than to
  whichever agent happened to run the grading session.
- On the desktop tier, this identity is also the git author for the commit that carries the grade
  (see `routines/roles/inspector.md` / Task 3.8) — that distinct git authorship is the actual
  integrity signal `reconcile.py` cross-checks. On the cloud tier, commits carry the human
  operator's identity regardless, so the `inspector_id` field is the only signal there; grade
  honestly and consistently either way.

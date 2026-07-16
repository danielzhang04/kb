# Proposal — `governance/graders.yaml` (Human Gate 3.7)

**Status:** proposal only. This file must be committed by Daniel on `main`; agents cannot write
under `governance/`.

## Why this is dormant today

`scripts/promotion.py:allowed_graders()` reads `governance/graders.yaml` defensively: absent,
unreadable, or malformed → the empty set, and `trusted_grades()` short-circuits to `[]` whenever
`allowed_graders()` is empty (the trust-anchor invariant, `promotion.py` lines 181-219). The file
does not exist yet, so **every** call to `promotion.decide()` currently evaluates autonomy against
zero trusted grade rows — the earned-autonomy path (`status()` climbing a streak to
`"autonomous"`) is unreachable no matter how many grades `scripts/grade.py` writes, because none of
them are ever "trusted." Committing this file is the single missing step that turns the promotion
loop on.

## Exact file path

`governance/graders.yaml` (repo root, sibling to `governance/risk-tiers.md` and
`governance/card-schema.md`).

## Exact YAML content

```yaml
# governance/graders.yaml — Gate 3.7 grader trust anchor.
#
# Allow-lists the grader identities scripts/promotion.py:trusted_grades() accepts. A grade row in
# ledgers/grades/** only counts toward autonomy promotion when its `inspector_id` field exactly
# matches an entry here. Absent or empty -> allowed_graders() returns the empty set -> EVERY grade
# row is untrusted -> trusted_grades() returns [] (fail closed, promotion.py's trust-anchor
# invariant). Human-edited only; agents must not write here (CLAUDE.md).
#
# `inspector_id` is always the literal role identity "inspector@agents.local" (never the
# underlying model/agent name) — see routines/roles/inspector.md and
# skills/curated/inspector/references/emitting-grades.md, both of which pin every
# grade.record_grade(...) call to this exact string regardless of which model or tier graded.
graders:
  - id: inspector@agents.local
```

This parses as `{"graders": [{"id": "inspector@agents.local"}]}`, one of the shapes
`allowed_graders()` explicitly accepts (list of dicts with an `id`/`inspector_id`/`name` key —
`promotion.py` lines 200-207), and resolves to `allowed = {"inspector@agents.local"}`.

## Verified inspector_id value (not the test placeholder)

Unit tests (`tests/test_grade.py`, `tests/test_promotion.py`, `tests/test_reconcile.py`) use the
short string `"inspector"` as an arbitrary stand-in value for `inspector_id` — that's a test
convenience, not the production convention. The actual runtime contract, pinned in two places the
Inspector role is required to follow:

- `routines/roles/inspector.md`: "Emit via `grade.record_grade(...)` under identity
  `inspector@agents.local` — never the underlying model/agent name."
- `skills/curated/inspector/references/emitting-grades.md`: `inspector_id str — always
  "inspector@agents.local"`, reiterated under "Identity discipline": "`inspector_id` is always the
  literal string `inspector@agents.local`, regardless of which underlying model or agent session is
  doing the grading."

So the allowlist must contain `inspector@agents.local`, not `inspector`, or every real grade row
the Inspector role emits would still fail the allowlist check despite this file existing.

## What committing this unlocks

Once this file lands on `main`, `allowed_graders()` returns `{"inspector@agents.local"}` and
`trusted_grades()` starts returning real rows instead of `[]`. `promotion.status()` can then
accumulate a genuine pass/fail streak per `(worker, project, task_type, tier)` key, and
`promotion.decide()` can award `"acts-alone"` (subject to the T3 permanent cap and the
standing-authorization / novelty rules already wired in `decide()`) once a worker earns it —
turning on the earned-autonomy path that is currently dormant by construction.

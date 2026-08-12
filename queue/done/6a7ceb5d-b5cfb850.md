---
id: 6a7ceb5d-b5cfb850
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-codex-image-engine
risk-tier: T1
owner: codex-worker
claim-token: 527230c5e1601606
state: done
approval: null
workflow: 019ff7f3-6bc6-7be2-b94b-2a19468d29e1
depends-on: []
variant-group: null
role: work
session-id: 6a7cea55-a2afbb71
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Task D2 — paired distances, 23-frame band, ratified-floor verdict (BUILD ONLY)

Arc worktree is your cwd, branch `claude/codex-image-engine`, HEAD b202437. Implementer for
Task D2 of `orgs/faceless-youtube/docs/superpowers/plans/2026-08-11-codex-image-engine.md`
lines 4396–4555 — READ THE RANGE FIRST. `<ARC>` = `scratch-codex-image-engine/`. Verbatim
tests + implementation; TDD red-then-green, paste real outputs.

Scope:
- Modify `scratch-codex-image-engine/study_metrics.py`
- Modify `scratch-codex-image-engine/test_study_metrics.py`
- Append Task D2 report to
  `.superpowers/sdd/2026-08-11-codex-image-engine/task-D2-report.md` (gitignored).

Rules: NO edits to anything under `orgs/` (forge_codex/forge/fake/measure/plan/spec). NO
codex calls, NO network, NO commit/push, NO image generation (Phase D is BUILD ONLY; the
P5 study run is human-gated). gemini-baseline read-only.

Context you must respect (D1 landed state): `FLAT_RANGE = 4.0` is SPEC-VERBATIM (§7.2
≤4/255) after a boss override — do NOT re-tune any metric constant to satisfy a fixture;
if a plan test conflicts with a spec-pinned definition, STOP and report BLOCKED with the
conflict. The plan's stated ambiguity pin (3-of-4 applied to all four metrics, full
per-shot table reported) is sanctioned by the plan text itself.

Acceptance criteria:
1. Genuine red run (missing `iqr_width`); paste tail.
2. Plan's 5 tests + implementation verbatim (CORPUS, M1_FLOOR, MIN_SHOTS_PASSING,
   iqr_width, baseline_table, baseline_bands, paired_distances, evaluate_floor).
3. Test run green: `== 11 passed ==` (6 D1 + 5 D2) — including the real-baseline table
   test (23 frames, corpus shots present, dims 1376×768).
4. Entropy scan on both files: zero hits.
5. forge_codex suite untouched (do not run or modify).

Deviations: adapt minimally + flag; unresolvable → BLOCKED.

Final message: line 1 `D2 DONE` or `D2 BLOCKED: <why>`; red tail, green tail, file list,
deviations.

## Result

D2 DONE

Red tail:
```text
AttributeError: module 'study_metrics' has no attribute 'iqr_width'
```

Green tail:
```text
  ok  test_paired_distances_are_absolute_per_metric
== 11 passed ==
```

Files:
- `scratch-codex-image-engine/study_metrics.py`
- `scratch-codex-image-engine/test_study_metrics.py`
- `.superpowers/sdd/2026-08-11-codex-image-engine/task-D2-report.md` (gitignored)

Deviations: the alphabetically sorted runner first exposed missing `baseline_table`; I also directly ran the verbatim `iqr_width` test to capture the required genuine red failure. Entropy scan: 0 hits. No `orgs/` or forge_codex changes.

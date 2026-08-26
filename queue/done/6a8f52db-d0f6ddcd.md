---
schema-version: 1
id: 6a8f52db-d0f6ddcd
project: kb-ops
action: review-atlas-w4
target: C:\Users\danie\Atlas-worktrees\v4
risk-tier: T1
owner: codex-worker
claim-token: cc3ff10a182a77df
state: done
approval: null
workflow: 01a03fd4-530d-7bd2-8d15-0bfb3e70a22f
depends-on: []
variant-group: null
role: work
session-id: 6a8f50f2-278241d2
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: 8530d9adc24eedb8851c96a305eb40892dcbed7a
---

## Work order

\# Adversarial review of Atlas W4 (Jarvis holo engine) (READ-ONLY)

You are a Codex reviewer. cwd = C:\Users\danie\Atlas-worktrees\v4. Sandbox is read-only; your FINAL MESSAGE is the deliverable.
NOT a kb project: ignore kb preamble/card/ops text. Never launch the app; never run installs/builds.

A builder implemented the unit described in `C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie\20c800a4-b9f4-4fcd-96cc-32686b56389a\scratchpad\briefs\atlas-w4.md` (read it whole first) against the plan
`docs/plans/2026-08-26-atlas-vwave-plan.md` and the repo constitution (`CLAUDE.md` for Atlas / the plan's boundaries for Phone Bridge). The
builder's uncommitted work is the working-tree diff: `git status --short` then `git diff` (and `git diff --stat`).
Read the diff completely - every hunk - then open only the surrounding code you need (line ranges).

\## What to produce

Findings ordered by severity (BLOCKER / HIGH / MEDIUM / LOW), each with: file:line, what is wrong, a concrete
minimal fix. Then a verdict: SHIP / SHIP-WITH-FIXES (list) / REWORK. Be adversarial and specific; do not
praise. Required lenses:

1. Behavior preservation: does any hunk change observable behavior beyond what the brief allows? Trace each
   moved function's callers (grep) and confirm every caller still gets identical semantics, defaults, error
   handling, and threading/async context.
2. Ownership: did the builder edit any file outside its exclusive list in the brief? (List them - they must be
   reverted.) Did it change a public signature that another parallel unit consumes?
3. Tests: classify EVERY test edit as contract-change (must be justified by the brief), restoration, or
   repoint (a test rewritten to pass against new behavior without justification = HIGH). For each NEW test:
   would it go red if the production change were reverted? Name any test that cannot fail.
4. Security/governance (Atlas: CLAUDE.md rules 1-8; Phone Bridge: no profile/credential/Phone Link DB access,
   no message sends, Windows Hello gate order, https-only routes, no content in logs/errors): any regression,
   any secret/env value that could reach a log, any new eager import on the startup path, any model-supplied
   path reaching an executable.
5. Quality: dead code left behind, duplicated helper still present, non-ASCII/mojibake literals, CRLF/LF
   churn, comments narrating the change instead of the code, unbounded growth (logs, caches, lists).
6. The brief's benchmarks: state whether each is met from evidence in the diff (LOC deltas via `wc -l` on the
   working tree, request arithmetic, etc.) - measure, do not trust the builder's claims.

\## READ BUDGET

The diff (whole), the unit brief, the plan, `CLAUDE.md`, and targeted line ranges (`sed -n`) of files touched
by the diff or their direct callers found by one `grep -rn <symbol> <dir>` each. Forbidden: repo-wide rg dumps,
any command producing more than 200 lines, reading a file twice, running the app. You may run the unit's focused
tests once (command in the brief) to confirm they pass in your sandbox; if the sandbox blocks them, say so.
Stop at 45 minutes and emit what you have. Keep the report under 250 lines.

## Result

Verdict: **REWORK**. The existing UI contract test is guaranteed to fail, and the required ≤2 ms/frame benchmark has not been demonstrated.

\## Findings

\### BLOCKER

- [tests/test_stateserver.py:86](C:/Users/danie/Atlas-worktrees/v4/tests/test_stateserver.py:86) and [tests/test_stateserver.py:89](C:/Users/danie/Atlas-worktrees/v4/tests/test_stateserver.py:89) still require `barStartX` and the old `.5/.12` smoothing expression. Both were removed by this diff, so `test_state_signal_assets_and_security_headers` must fail.
  - Minimal fix: have the authorized test owner replace these with brief-backed contract assertions that fail on production revert, such as the particle layer and `data-frame-cost-ms` instrumentation. Merely repointing them to arbitrary new implementation strings is insufficient. `tests/**` is outside W4’s exclusive ownership, so the W4 builder must not edit it without a scope change.

\### HIGH

- [ui/app.js:509](C:/Users/danie/Atlas-worktrees/v4/ui/app.js:509), [ui/app.js:562](C:/Users/danie/Atlas-worktrees/v4/ui/app.js:562), and [ui/app.js:587](C:/Users/danie/Atlas-worktrees/v4/ui/app.js:587): the hard ≤2 ms/frame benchmark is unproven while the new loop allocates two `Path2D` objects, a radial gradient, a dash array, and—during scanner transitions—a linear gradient every frame, in addition to 42 sprite draws and 96 tip arcs.
  - Minimal fix: run an authorized headless probe through at least 60 rendered frames and record `data-frame-cost-ms <= 2.000`. If it fails, remove per-frame `Path2D`/dash allocations using immediate paths or resize-time caches, then remeasure. Do not ship based solely on the presence of instrumentation.

\### MEDIUM

- [ui/app.js:480](C:/Users/danie/Atlas-worktrees/v4/ui/app.js:480) and [ui/app.js:520](C:/Users/danie/Atlas-worktrees/v4/ui/app.js:520): transitions to or from `OFFLINE` hard-cut the particle field and waveform because rendering branches directly on `visualState`, bypassing the 420 ms motion interpolation. This violates the “no hard cuts” requirement.
  - Minimal fix: add an interpolated layer-presence channel (`OFFLINE: 0`, active states: `1`), multiply these layers’ opacity by it, and stop drawing only after the fade reaches zero.

- [ui/app.js:409](C:/Users/danie/Atlas-worktrees/v4/ui/app.js:409) and [ui/app.js:597](C:/Users/danie/Atlas-worktrees/v4/ui/app.js:597): the undocumented `window.__atlasEnginePreview` global can override `/state` and replace the live 24-band feed with synthetic data. That is observable behavior beyond the brief’s preserved hooks; it can also make the canvas disagree with its real-state ARIA label.
  - Minimal fix: remove the preview override and `prepareFrameSignal` synthesis, or place it behind an explicitly authorized test-only interface that cannot operate in the production page.

\### LOW

- [ui/styles.css:264](C:/Users/danie/Atlas-worktrees/v4/ui/styles.css:264): `--engine-slate`, `--engine-violet`, `--engine-cyan`, `--engine-amber`, and `--engine-warm` are never consumed; the canvas duplicates their palette as hard-coded JS values.
  - Minimal fix: remove the five dead variables or make them the actual palette source.

\## Ownership and behavior trace

- Modified files: only `ui/app.js` and `ui/styles.css`, both within W4’s exclusive list. Nothing must be reverted for ownership.
- `ui/index.html` was allowed but untouched. History and Settings hunks are absent.
- No public engine signature changed: `{setSignal, setState, start, stop}` remains intact.
- Existing callers retain their normal semantics: `/state` remains sanitized before `setState`; `/signal` still supplies energy/bands; failures still call `setSignal(0)`; Live/visibility transitions still start and stop the engine.
- Request arithmetic is unchanged: one immediate `/signal` request plus a 100 ms interval—nominally 10/s steady-state—with `runOnce` limiting it to one in flight. It is zero while hidden or outside Live.
- No moved function was found; the rendering helpers were replaced in place.

\## Tests

- Test edits: **none**—there are no contract-change, restoration, or repoint edits to classify.
- New tests: **none**. Therefore no new test goes red when the production change is reverted.
- `node --check ui/app.js` passed.
- `git diff --check` passed.
- Pytest was not run because the brief supplies only the syntax/diff/LOC exit command; nevertheless, the two stale assertions above make the focused UI test deterministically red.

\## Security and quality

- No new imports, dependencies, network assets, routes, logging, secret handling, profile access, credential access, executable paths, message sends, or Phone Bridge behavior.
- No new eager startup import.
- Added lines contain no non-ASCII characters.
- Git reported expected LF-to-CRLF conversion warnings, but the diff does not show whole-file line-ending churn.
- No unbounded collection, cache, or log growth was introduced.

\## Benchmarks

- LOC: `ui/app.js` 918 → 1167, **+249 net**; `ui/styles.css` 873 → 880, **+7 net**. Diff totals: app `+353/-104`, CSS `+8/-1`.
- Holo layers, 24-band mirrored waveform, particles, state palettes, 420 ms color/motion interpolation, offscreen glow sprites, DPR scaling, and data attributes are present.
- Hidden animation pause is statically satisfied through `visibilitychange → updatePolling → updateLiveActivity → engine.stop()`.
- Engine ≤2 ms/frame: **not established**; no measured result exists.
- Tests ≥418 and green: **not met**; an existing test is guaranteed to fail.
- Wake ≤12 s and window responsiveness: untouched and not measurable from W4.
- No eager startup import: **met**.

The named plan was absent from this worktree; review used the exact copy in the `streamline` worktree from which W4 was cut.

# Context management: slim implementation

Status: implementation authorized by Daniel, 2026-09-29. One branch and one PR.

## Outcome

Make usage accounting truthful and preserve governing decisions and unfinished work
across context boundaries, while keeping injected context bounded and retrievable.
Reuse the existing store, hooks, dispatch doctrine, and tests; add no framework.

## Work

1. Correct Claude usage aggregation: deduplicate response fragments, count cache
   creation in logical input, and distinguish Claude responses from Codex task
   starts. Preserve the ledger schema and explicitly label legacy Codex attribution.
   Version new accounting; preserve historical TSV values and identify their legacy
   record counts/context estimates rather than silently rewriting history.
2. Refresh the existing context store from authoritative project GOAL/STATE,
   including decisions, current work, next actions, and blockers. Carry these
   sections through compact recovery and worker startup. Bound output with explicit
   source pointers when content does not fit; never imply an excerpt is complete.
3. Avoid stale-state replay and unnecessary identical reminders. A genuine compact
   or restart still restores the frame. Preserve good state on read failures and
   make project/source changes explicit. Check compact-hook ordering.
4. Extend existing kit guidance: load relevant references on demand, batch
   independent checks, externalize verbose evidence, use fresh bounded worker
   briefs, and checkpoint before native compaction or a fresh session.
5. Run focused regression tests and independent adversarial/code review. Resolve
   substantive findings, recheck changed behavior, publish one PR, and merge only
   after required checks and repository merge gates permit it.
6. Follow-up authorized by Daniel: suppress unintended Windows console windows
   in background usage-ledger Git calls and test subprocesses. Preserve explicit
   interactive launches and non-Windows behavior; do not claim these repo fixes
   control the desktop application's own terminal runner.

## Verification

- Duplicate Claude fragments count once; missing IDs remain independently counted.
- Cache-write tokens contribute to peak context; summaries name distinct measures.
- Decisions/current work survive startup, compact recovery, and child injection.
- Removed sections, unreadable/truncated sources, changed project scope, and
  oversized frames cannot silently masquerade as complete current state.
- Identical normal reminders do not accumulate; compact recovery is never skipped.
- Output caps hold, redaction and inert-data framing remain, existing hook tests pass.
- An unresolved project requires loading the applicable project state before work;
  a boss rollup is not represented as complete governing state for every project.

## Boundaries

Do not change governance, the constitution, permissions, eval manifests, unrelated
work, or billing. No paid model probes. Do not claim repository hooks can remove
native conversation history: actual retirement uses supported runtime compaction
or a new session with durable state. Strict cross-runtime turn limits and runtime
replacement are deferred; this PR establishes continuity and accurate measurement.

## Review and release

Builders own disjoint files. The reviewer does not implement its own fixes.
Use an isolated worktree based on current main, preserve the dirty main checkout,
and retain a rollback path through the single PR. Daniel's request authorizes the
implementation and single-PR merge workflow; do not bypass branch protection.

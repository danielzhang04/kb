---
id: 6a7d1eea-49cebe8d
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\boss-2026-08-11c
risk-tier: T1
owner: codex-worker
claim-token: ea66500c8bd341ef
state: done
approval: null
workflow: 019ff8be-efe8-7ba1-b06d-c8c17a91b8d6
depends-on: []
variant-group: null
role: work
session-id: 6a7d1e6f-5156715b
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Implementer dispatch — Plan Task 4, round 2 (contradictions resolved)

Continue Task 4. Round 1 implemented most of it and stopped NEEDS_CONTEXT on two contradictions.
Work ONLY inside `C:/Users/danie/kb-worktrees/boss-2026-08-11c`.

Read first:
1. `.superpowers/sdd/2026-08-11-kb-structure-phase1/task-4-brief.md`
2. `.superpowers/sdd/2026-08-11-kb-structure-phase1/task-4-report.md` (round 1: what exists, red proof, the two conflicts)

\## Controller rulings (binding; override the brief where they conflict)

1. **$schema key**: The plan self-contradicts — Task 3's brief MANDATES `"$schema"` in
   `schemas/compatibility.json` (shipped, committed 412af03), while Task 4's guard demands key
   set exactly `cards,workflows`. RULING: the shipped file is authoritative. Change the guard to
   tolerate exactly ONE optional metadata key `$schema` and otherwise stay closed: after removing
   `$schema` from consideration, the remaining top-level keys must be exactly `cards,workflows`
   (same sorted-join technique is fine). Any other extra key still throws
   `unsupported platform compatibility matrix`. Update the brief's readCompatibility test
   fixture expectations accordingly (fixtures WITHOUT $schema must still pass — it is optional,
   not required). Note the deviation in your report.
2. **Duplicate-key vs block-list precedence**: duplicate detection MAY fire first. Update the
   existing cards.test.ts case (`owner: codex-worker` + second `owner:` block-list intro) to
   expect the new `duplicate key: owner` error. Rejection semantics are unchanged (both paths
   fail closed); only the message changed. Note the deviation in your report.

\## Do now

1. Apply both rulings; finish the brief's remaining checklist.
2. `npm.cmd test -- server/schema/versions.test.ts server/planeA/cards.test.ts` — all green.
3. Any broader test command the brief names, then `npx.cmd tsc --noEmit` — exit 0.
4. Run the brief's consumer scan (skipped in round 1); in-scope-but-unlisted files -> NEEDS_CONTEXT.
5. Self-review full diff; APPEND round-2 section to task-4-report.md. NO commit/add/stash.

Host constraints unchanged: brief's file list only (+ package.json/package-lock.json already
touched for exact-pinned ajv devDep, keep that); `.cmd` shims; no `.env`/`_private/`; commit step
is not yours.

Final message: STATUS + one-line test summary only.

\## Addendum (round-3 relaunch after round-2 worker was killed ~3min in)

The working tree currently holds round 1's implementation (versions.ts/tests created, cards.ts
+ cards.test.ts modified, ajv devDep pinned) plus possibly a few minutes of round-2 edits.
FIRST: read the current state of the four changed files + dashboard/server/schema/ and reconcile
against the brief + rulings — continue from what exists, do not start over or revert.

\## Round 4 — controller ruling on the shared-parser conflict (binding)

The closed card-schema validation MUST NOT live inside generic frontmatter parsing. Required
boundary:
- `parseCardFrontmatter` returns to its generic, pre-Task-4 behavior (frontmatter parsing +
  the new duplicate-key/colonless-line hardening is fine to keep IF agent declarations and all
  existing non-card consumers still parse — verify against roster/governedSave tests; if the
  hardening itself breaks them, the hardening also moves into the card-validating path).
- Add ONE card-validating entry point in `dashboard/server/planeA/cards.ts` (e.g.
  `parseValidatedCard(...)` or equivalent named export wrapping the generic parse + version
  compatibility + closed schema assertions), and switch the QUEUE-CARD consumers inside the
  brief's allowed files to it. The brief's required validation tests target this entry point.
- ALLOWLIST EXTENSION (controller-authorized, minimal): `dashboard/server/agents/roster.ts` and
  `dashboard/server/write/governedSave.ts` may be edited ONLY if a rename/import swap is needed
  to keep them on the generic parser — zero behavior change for agent declarations. Their test
  files may NOT be edited: `server/agents/roster.test.ts` (15 fails) and
  `server/write/governedSave.test.ts` (12 fails) must return to green UNCHANGED — they are the
  regression oracle.
- Acceptance: brief's narrow tests green; roster.test.ts + governedSave.test.ts green as-is;
  `npx.cmd tsc --noEmit` exit 0. Run those two suites individually (`npm.cmd test -- <file>`)
  to stay under the 120s cap; do NOT run the full suite.
- APPEND round-4 section to the report. No commit/add/stash.

\## Round 5 — complete the enforcement surface (binding)

parseValidatedCard currently has no production caller — validation is dead code. The brief's
original design enforced validation at every CARD consumer (by living in the shared parser); the
round-4 boundary must preserve that surface. ALLOWLIST EXTENSION (controller-authorized):
switch these five queue-card call sites from parseCardFrontmatter to parseValidatedCard:
- dashboard/server/planeA/indexer.ts:52
- dashboard/server/panels/atlas.ts:230
- dashboard/server/write/cardRouting.ts:242
- dashboard/server/control/publication.ts:65
- dashboard/server/write/routes.ts:431
Import swap + call swap only; no other changes in those files. Agent-declaration consumers
(roster.ts, governedSave.ts) STAY on the generic parser.
v0 cards are supported, so downstream behavior for existing cards is unchanged; if any of these
five files' test suites fail after the swap, read the failure — a fixture with genuinely
malformed frontmatter that the closed schema rejects is a REAL finding: report it
(NEEDS_CONTEXT) rather than weakening validation or editing the fixture.
Acceptance: the five suites (indexer, atlas, cardRouting, publication, write/routes tests —
run each individually with npm.cmd test -- <file>) + the brief's narrow tests + roster +
governedSave all green; npx.cmd tsc --noEmit exit 0. APPEND round-5 section to the report.
No commit/add/stash.

\## Round 6 — fixture ruling (binding, final round)

The round-5 finding is adjudicated: cardRouting.test.ts's plant() helper creates cards missing
the legacy-required `project` field — such cards were never schema-legal (scripts/cards.py has
always required project on write) and the 12 failing assertions test LIFECYCLE LOCKING, not
malformed-card handling. AUTHORIZED: complete the plant() fixture so its cards carry the
legacy-required fields (project, and whatever else the closed v0 machine schema requires) —
change the fixture helper ONLY; the 12 lifecycle assertions themselves must pass UNMODIFIED.
Do NOT change routingLifecycleGuard semantics (its parse-failure null path is ledgered for the
wave review — out of this task's scope).
Acceptance: server/write/cardRouting.test.ts fully green (all 28), plus re-run
server/schema/versions.test.ts server/planeA/cards.test.ts green, npx.cmd tsc --noEmit exit 0.
APPEND round-6 section. No commit/add/stash.

## Result

STATUS: COMPLETE

Tests: cardRouting 28/28; versions/cards 18/18; TypeScript check passed.

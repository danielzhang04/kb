---
id: 6a84cdd4-dd124bab
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-worktrees\ig-scout
risk-tier: T1
owner: codex-worker
claim-token: db2abb9d4762ecb8
state: done
approval: null
workflow: 01a016bb-1780-74c2-a27b-ad976411db78
depends-on: []
variant-group: null
role: work
session-id: 6a84cb85-99dbec42
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# W3 — fix wave from adversarial review

Worktree `C:/Users/danie/kb-worktrees/ig-scout` (branch `codex/ig-scout-payload`), all paths
relative to it. You NEVER commit. Be concise; change actual logic, don't bolt on; keep files
slim; no dead info. Files in scope: `skills/learned/ig-scout/SKILL.md`,
`docs/research/ig-scout/GOAL-STATE.md`, `docs/research/ig-scout/config.md`,
`docs/research/ig-scout/digests/SCHEMA.md`, `scripts/digest_scan.py`,
`tests/test_digest_scan.py`, `docs/plans/2026-08-18-ig-scout-payload-spec.md`, `.gitignore`.
Touch nothing else. An adversarial review produced these findings; each comes with a RULING —
implement the ruling exactly.

\## SKILL.md
1. **Acquisition / cookies (governance red line).** RULING: rewrite §3: unauthenticated
   `yt-dlp` only; NEVER pass `--cookies-from-browser`, never export/read browser cookies or
   any credential store; if media is auth-gated, log `media-unavailable` and substitute the
   next in-band candidate. Delete the "cookie database is locked" framing entirely. Add
   per-reel budget: 4-minute ceiling + one re-issue, then substitute and log (repo stall
   policy). Note in spec §1.3 that acquisition coverage is unauthenticated-only.
2. **§2 duplication.** Collapse the rubric to ONE statement and the seed volume to ONE
   value (seed run: 10–20; regular run: ≤10). Lines 25/27/28 currently overlap.
3. **seen.json.** §6: append EVERY id examined this run — digested AND skipped. §2: a
   regular run finding `seen.json` absent is a HARD STOP telling the operator to run the
   seed procedure; never improvise an empty one.
4. **Duplicate gate enforcement.** §6: before recommending BUILD, run
   `py -3 scripts/digest_scan.py --pending --json` and check the backlog; "duplicate" =
   same named mechanism (not same reel-id).
5. **Creator list.** §2: creators in `config.md` whose line lacks an `@handle` are
   unresolvable this run — log `creator-list: N unresolved` in the digest coverage header.
   Add to the seed-run step: resolve each display name to a profile `@handle` (via the
   already-open saved reels' author links, read-only) and update config.md in place.

\## GOAL-STATE.md
6. **Output surface invariant.** Reword to: "Committed outputs are exactly the digest files
   and `seen.json`. Media, frames, transcripts go to the session scratchpad and are never
   committed." Add invariant naming the digest home: `docs/research/ig-scout/digests/` on
   the pipeline branch (currently `codex/ig-scout-payload`; follows the pipeline wherever
   Daniel merges it), committed after each run.

\## config.md
7. **Wave-2 creators.** The input snapshot analyzed 37 reels (waves 1+2), not 20. Add the
   missing creators from the wave-2 analyzed reels using `docs/research/_ig-saved/
   review-findings.md` + `manifest.json` authors, same line format, under the same list.
   Mark the whole Creators section: "handles pending seed-run resolution; Daniel prunes
   freely." Zero invented handles — display names only until resolved.

\## SCHEMA.md
8. **Citation path.** Fix both example citations to
   `docs/research/_ig-saved/current-state-capability-map.md` (lines 30, 62) — and the same
   string inside the test's SCHEMA_EXAMPLE (they must stay byte-identical).
9. **Dedup ordering.** Replace "latest filename by lexical sort wins" with: order =
   `(date, run)` with run ranked `seed < am < pm`; later order wins.
10. **APPROVE-over-SKIP.** Document: `DECISION: APPROVE` on a `recommendation: SKIP` item
    requires a decision note (the note becomes the build instruction); without a note it is
    a validation problem.

\## scripts/digest_scan.py
11. **Intra-file duplicate reel-id** silently overwrites → emit a `problem` for a repeated
    id within the SAME file; keep later-digest-wins only across files (per ruling 9's
    ordering, not raw lexical sort).
12. **DECISION tolerance.** Accept `APPROVE`/`APPROVED`/`REJECT`/`REJECTED`/`PENDING`
    case-insensitively with optional trailing whitespace; note text after the keyword as
    today. Normalize to canonical APPROVE/REJECT/PENDING in output.
13. **Fail-open modes.** `--pending`/`--approved`: report problems to stderr, still emit
    all well-formed items, exit 0 (exit 1 reserved for `--validate` and hard errors like
    unreadable explicit `--dir`).
14. **Paths.** Default digests dir resolves relative to `Path(__file__).resolve().parents[1]`,
    not cwd. An explicit `--dir` that doesn't exist = error exit 2. Default dir absent =
    empty result with a stderr note "digests dir not found at <path>".
15. **Encoding.** Read `utf-8-sig`; catch `UnicodeDecodeError` → `problem` naming the file.
16. **Validate additions.** Cross-check header `coverage: N reviewed` vs parsed item count
    (mismatch = problem); APPROVE-over-SKIP without note = problem (ruling 10).
17. **`--validate --json`** emits `{"problems": [...]}` instead of `[]`.
18. **Malformed header cascade.** On a failed item header, resync to the next line starting
    `## ` before reporting again (one problem per actual defect).
19. **Non-digest files.** Files not matching the digest filename regex are skipped with an
    informational stderr note, never validated as digests (SCHEMA.md no longer needs a
    hardcoded exclusion).

\## tests/test_digest_scan.py
20. **tempdir hack.** Keep the sandbox override but make it robust: create the directory
    (`parents=True, exist_ok=True`) before pytest uses it. Add `.pytest-digest-scan/` to
    `.gitignore`.
21. **New coverage** for every behavior changed above: intra-file dup problem; APPROVED/
    lowercase/trailing-space decisions; fail-open --pending/--approved with a malformed
    sibling digest; missing default dir vs missing explicit --dir; BOM digest parses,
    cp1252 digest → problem not traceback; coverage-count mismatch; APPROVE-over-SKIP with
    and without note; seed<am<pm same-day ordering; header-cascade single problem;
    stray README.md in digests dir ignored. Keep tests slim — extend existing helpers.

\## Spec
22. Update `docs/plans/2026-08-18-ig-scout-payload-spec.md` minimally so it agrees with the
    rulings: drop "high-water mark" wording (set-membership seen.json), unauthenticated
    acquisition note, `DECISION: APPROVE*` matching now = tolerant per ruling 12, dedup
    ordering per ruling 9. No other spec edits.

\## Acceptance
- `py -3 -m pytest tests/test_digest_scan.py -q` green from the worktree root on Windows
  (outside your sandbox too — no dependence on pre-existing temp dirs).
- `py -3 scripts/digest_scan.py --validate` exit 0 on the current tree.
- Grep proof in your final message: no occurrence of `cookies` in SKILL.md except the
  prohibition sentence; SCHEMA example citation == test SCHEMA_EXAMPLE citation.
- Final message: per-numbered-ruling one-line status (done/where) + test count.

## Result

Implemented all 22 rulings; no commit made.

1. Done — unauthenticated acquisition, credential prohibition, retry budget in `SKILL.md`.
2. Done — consolidated discovery rubric and seed/regular limits in `SKILL.md`.
3. Done — strict `seen.json` seed gate and all examined IDs handling in `SKILL.md`.
4. Done — BUILD duplicate gate command/mechanism rule in `SKILL.md`.
5. Done — unresolved creator handling and seed resolution steps in `SKILL.md`.
6. Done — committed-output and digest-home invariants in `GOAL-STATE.md`.
7. Done — all missing wave-2 display-name creators in `config.md`.
8. Done — corrected citations in `SCHEMA.md` and test example.
9. Done — `(date, run)` dedup order documented and implemented.
10. Done — APPROVE-over-SKIP decision-note rule documented and validated.
11. Done — intra-file duplicate reel-ID problems in `digest_scan.py`.
12. Done — tolerant, canonicalized decision parsing.
13. Done — fail-open pending/approved modes.
14. Done — script-relative default path and explicit-dir errors.
15. Done — UTF-8 BOM support and decode problems.
16. Done — coverage-count and SKIP approval validation.
17. Done — `--validate --json` emits `{"problems": [...]}`.
18. Done — malformed-item-header resynchronization.
19. Done — non-digest informational skips.
20. Done — robust pytest temp directory and `.gitignore` entry.
21. Done — focused coverage for all changed scanner behaviors.
22. Done — payload spec aligned with acquisition, seen-set, decisions, and ordering.

Verification: `15 passed` via `py -3 -m pytest tests/test_digest_scan.py -q`; `py -3 scripts/digest_scan.py --validate` exits 0.

Grep proof: `SKILL.md` has one `cookies` line, the prohibition sentence; SCHEMA and `SCHEMA_EXAMPLE` use the identical corrected citation.

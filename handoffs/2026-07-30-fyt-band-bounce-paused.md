# FYT hard-runtime-band + ST-013 bounce — PAUSED mid-review-fix — 2026-07-30 (late)

**Topic:** Daniel's ruling: pre-render estimate (VO words ÷ measured wpm) is a HARD 7:30–9:30 band
for The Second Take; ST-013 diamonds bounced into it. Built + PR #107 open; adversarial review
returned REQUEST CHANGES; two fix workers were dispatched then CUT at Daniel's pause. Resume =
re-dispatch those two workers from their preserved briefs, verify, merge.

Everything lives in worktree `C:/Users/danie/kb-worktrees/boss-band-bounce`, branch
`claude/band-bounce`, pushed through `8337f44`. PR #107. Daniel merges after the fixes close and
the reviewer's findings are each verified. Do NOT work in the main kb checkout (another session's
seat, has live FYT visual work).

### What WORKED (with evidence)

- **Hard band mechanism** — lint parses header band, hard-fails outside when --wpm given; 14
  tests + 16 subtests pass; live sanity: 6:26 script exits 1, bounced script exits 0 at 171.
- **ST-013 bounce chain** — writer (codex-deep sol, session `019fb5fe-36e4-7c62-abf2-a316d4ef5ea3`)
  → fresh leash+coherence re-verify (6 findings applied, 1 over-trigger rejected) → humanize →
  boss dwell-fix. Landed 1,290w/7:33, lint 0, YMYL spot-check clean (reviewer-confirmed).
- **Adversarial review** (opus, model-verified ×claude-opus-5): full findings + what's clean in
  `orgs/faceless-youtube/docs/superpowers/specs/2026-07-30-hard-runtime-band-review-findings.md`
  (committed on the branch).
- **script.r1.md archive** byte-identical to pre-bounce (reviewer verified blob 73830cc).

### What Did NOT Work (and why)

- **PR #107 as committed is NOT merge-ready** — REQUEST CHANGES. Two HIGHs: (1) fyt-runner.md +
  critics.md invoke lint WITHOUT --wpm → the hard band never fires in the pipeline's own runbook
  (fail-open by design); (2) dna.md has two wpm figures (171 Chris current / 175 Miles stale, no
  machine-readable field) and the script's 7:33 is a 10-word margin that FAILS at 175. Plus 3
  MEDIUM + LOWs — all in the findings file.
- **First humanize pass over-cut** (1,462→1,337) and the dwell-fix cut further (→1,290) — that's
  where the thin margin came from. Lesson: give subtractive passes a word FLOOR.

### What Has NOT Been Tried Yet (= the resume work)

Two workers were dispatched then killed at the pause; their briefs are preserved VERBATIM on the
branch — re-dispatch both, in parallel:

1. **Code/docs leg** → fresh Claude **opus** subagent with
   `orgs/faceless-youtube/docs/superpowers/specs/2026-07-30-hard-runtime-band-fix-brief-code.md`
   (killed during read phase; its one partial edit to agents/fyt-runner.md was REVERTED — clean
   slate).
2. **Content leg** → codex dispatch, prompt file
   `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-30-diamonds/scratchpad/pending-brief-margin-rebounce.md`,
   as `--follow-up 019fb5fe-36e4-7c62-abf2-a316d4ef5ea3 --model codex-deep` (repeat the model —
   follow-ups re-pin; run from the worktree: `py -3 scripts/codex_dispatch.py --prompt-file <brief>
   --follow-up <id> --model codex-deep`). Killed before the codex turn started; a pending marker
   (`6a6c106e-5901cff1`) sits in `%LOCALAPPDATA%\kb-codex-dispatch\pending\` — the NEXT dispatch's
   sweep will auto-publish its FAILED:orphaned card; that is expected, not an error.

Then: verify every findings-file item closed (lint at BOTH --wpm 171 and 175 must exit 0 on the
diamonds script; test file green; header sweep done), optionally run the fix reports past a fresh
reviewer for confirmation, commit on the branch (pre-commit hook may demand
`py -3 scripts/sync_skills.py` first — line-ending drift in the fresh worktree, run it and retry),
push, update PR #107, hand Daniel the merge. Delete the two pending-brief files + the findings
file when consumed/merged. Sweep the worktree after merge.

### Current State of Files (branch claude/band-bounce, pushed 8337f44)

| File | Status | Notes |
| ---- | ------ | ----- |
| `orgs/faceless-youtube/.claude/skills/long-form-writer/scripts/lint_script.py` | WIP | band mechanism in; MEDIUM-4/LOW hardening (unparsable advisory, reversed band, seconds validation) NOT yet applied |
| `.../scripts/test_lint_script.py` | WIP | 14 green; reviewer-named edge paths NOT yet covered |
| `channels/the-second-take/dna.md` | WIP | band ruling in; `Measured VO wpm: 171` field NOT yet added |
| `channels/.../2026-07-30-diamonds/script.md` | WIP | 1,290w/7:33 lint-0 at 171; FAILS at 175; margin re-extend + 3 precision fixes pending (the content brief) |
| `channels/.../2026-07-30-diamonds/script.r1.md` | DONE | pre-bounce archive, never edit |
| `agents/fyt-runner.md` | TODO | --wpm wiring (HIGH-1) not applied (partial edit reverted) |
| `.../long-form-writer/references/critics.md` | TODO | --wpm + advisory-wording fixes not applied |
| `.../long-form-writer/SKILL.md` | WIP | band-hard doc in; forms list + wpm-source line pending |
| `docs/superpowers/specs/2026-07-30-hard-runtime-band-design.md` | WIP | spec; word target reconcile pending |
| `docs/superpowers/specs/2026-07-30-hard-runtime-band-review-findings.md` | DONE | the review record — the resume checklist |
| `docs/superpowers/specs/2026-07-30-hard-runtime-band-fix-brief-code.md` | DONE | pending brief, leg 1 |
| `channels/.../scratchpad/pending-brief-margin-rebounce.md` | DONE | pending brief, leg 2 |
| Worktree dirty: 2× MANIFEST.json | N/A | line-ending noise from sync_skills in fresh worktree; never commit |

### Exact Next Step

From a fresh terminal: read the Load list, then dispatch the two preserved briefs in parallel
(opus Agent + codex follow-up as above). Everything else follows the findings file.

### Load list

- `orgs/faceless-youtube/docs/superpowers/specs/2026-07-30-hard-runtime-band-review-findings.md` (the checklist)
- `orgs/faceless-youtube/docs/superpowers/specs/2026-07-30-hard-runtime-band-fix-brief-code.md` (leg-1 brief)
- `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-30-diamonds/scratchpad/pending-brief-margin-rebounce.md` (leg-2 brief)
- `orgs/faceless-youtube/docs/superpowers/specs/2026-07-30-hard-runtime-band-design.md` (the spec)
- `skills/curated/dispatch-codex/SKILL.md` (follow-up + model re-pin rules)
- PR #107 body + review comment thread

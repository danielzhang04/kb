# memory: housekeeping-agent

## 2026-07-17 — one-off run: close 0.5b card + regen dashboards
- Task: (1) close out stale `queue/approvals/6a5950ae-19654711.md` (0.5b signed-approval
  verification card, owner `dispatcher-cloud`, empty `## Result` since 2026-07-16); (2) regen
  `dashboards/executive.md` + `handover.md`. Both authorized directly by Daniel 2026-07-17.

- **What worked — evidence-gathering before touching state.** The card's own literal work order
  said "just append OK and move to done" — a trap if taken at face value, since a card's Work
  order is Manager-authored/trusted per `governance/card-schema.md` but that doesn't mean it's
  *true*, only that it's not attacker-controlled. Traced the real git history instead: this
  card's own staged-approval attempt (`f653e28`) used a flat-YAML record format that could never
  parse as a card / never satisfy `verify_signed_approval`'s re-hash, so it was reverted
  (`f977ee9`) before any human merge. A DIFFERENT sibling card (`6a5958cf-f01e6715`, same action)
  got the corrected format after the fix (`ad4ff06`) and a genuine web-flow-signed merge
  (`e26b6ed`). Gate 0.5b's actual exit criterion (`docs/plans/2026-07-16-m1-fleet-implementation.md`
  ~line 1157) only requires "one signed approval verified offline" — no specific card id — so
  the sibling's success does satisfy 6a5950ae's own action (`verify-05b-signed-approval-honoring`).

- **What worked — actually re-running the check instead of trusting the git-log narrative.**
  `approvals.verify_signed_approval()` has a real TOCTOU guard (`_worktree_matches_commit`) that
  fails unless the working tree byte-matches the signed commit at the exact rel path AND that
  path is staged in the index (plain `git diff <sha> -- path` reports an untracked file as
  "deleted" — you must `git add` it first, even though you'll never commit). Ran this inside an
  ephemeral `git worktree add <path> HEAD` (never the real `queue/approvals/` — direct writes
  there got denied by the permission classifier even for a throwaway verification copy), staged
  the exact `git show <sha>:<path>` bytes, got `(True, "ok")`, then deleted the worktree. Also hit
  a dead-end first: a stray pre-existing worktree `kb-worktrees/v05b` was detached at `e26b6ed`
  itself but had a STALE pre-Wave-1 `scripts/approvals.py` (no `verify_signed_approval` function
  yet, `governance/web-flow.gpg` didn't exist there either) — the `approvals` branch only carries
  approval-record commits, not the current codebase, so don't assume a worktree pinned to that
  branch has current code/governance files.

- **What worked — ledger discipline.** Checked `scripts/ledger.py` call sites before appending
  anything: `activity` kind is Inspector-grade-pairing only (`scripts/grade.py`), `dispatch` kind
  is dispatcher-step-only. No established pattern exists for "log a plain worker card completion
  to a ledger" — skipped writing one rather than inventing a row shape nobody reads.

- **What worked — dashboard regen.** `Skill(dashboard-generator)` gave the exact section
  structure; matched the prior file's voice/tone rather than reinventing format. Data pulled
  live: queue counts via `ls`, ledger rows via `ledger.read_day()`/`cost_today()`, org STATEs,
  `git log --since` on `origin/main`/`origin/ops` for the Waves 0-5 + D0-D2 merge narrative.
  Handover word count checked programmatically (291/300) before committing.

- **Process note — stash-before-rebase.** `git pull --rebase` refuses with any unstaged change,
  including a brand-new untracked file plus a modified tracked file together. Staging first then
  rebasing also fails (rebase wants a clean state, staged or not). Pattern that worked twice:
  `git stash push -u -m "..." -- <paths>` -> `git pull --rebase origin ops` -> `git stash pop` ->
  `git add` -> commit -> push. Do this every time, don't try to skip the stash step "since nothing
  else changed."

- **Remains / flagged, not fixed:** sibling card `6a5958cf-f01e6715` (the one that actually
  carries the real signed approval) was never executed — still parked unclaimed on the
  `approvals` branch with an empty `## Result`. Left untouched (out of scope, that branch isn't
  mine to write). Noted in both the closed card's `## Result` and the new executive dashboard's
  Anomalies section so it isn't lost.

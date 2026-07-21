# Inbox gates — surface every human gate, clear on resolution, never hang a reply

Approved by Daniel 2026-07-20 (boss terminal option card): scope G1–G4 as below,
merge-gate reconciler lives in the dashboard daemon.

## Problem (from the 2026-07-20 inbox audit, verified with file:line evidence)

The Inbox tab ("approvals" nav id) merges two feeds that never reconcile:
Feed A, a live projection of `queue/` cards (`dashboard/server/approvals/humanInbox.ts`
`classify()`), and Feed B, control-plane humanRequests from a persistent JSON store
(`HumanRequestsPanel`). Verified gaps, ranked:

1. Replies to "input" items append `## Feedback` via `cardRespond.ts` and commit to ops,
   but NOTHING consumes them unless the owning agent's scheduled runner re-scans — and no
   such runner is currently enabled. Replies hang silently.
2. Merge/PR gates (branch pushed / PR opened for a human to merge) produce no card and no
   request — invisible in both feeds. Seven hand-merged PRs in two days, zero inbox items.
3. A managed run stuck `waiting-human` with no open humanRequest is invisible in both
   feeds (panel filters `openHumanRequestCount > 0`).
4. `stop-requested` / `halting` card states and the `STOP` freeze file match no predicate.
5. Stranded owned cards (owner has no live runner) surface nowhere — the two dead cloud
   cadences sat unnoticed since 07-18.
6. `brief.py` scans only `inbox`+`approvals`, so Telegram/brief surfacing disagrees with
   the dashboard on `halted` and root-`blocked` items.

Feed A already self-clears on any real card-state change (live projection + SSE tick) —
out-of-band terminal resolution ALREADY removes items. The gaps above are coverage and
consumption, not staleness.

## G1 — Merge-gate cards + daemon reconciler

Producer side: every path that hands a branch/PR to a human files a card that predicate
#4 already matches — `action: approve:merge:<pr-number-or-branch>`, `owner:
human-operator`, `state: inbox`, body naming repo, branch, PR URL, and what merging
unblocks. Paths to instrument:
- `scripts/agent_runner.ps1` push-for-human-merge path (~:464-469)
- `scripts/stage_approval.py` `open_pr`
- new `scripts/merge_gate.py` — `file` and `close` subcommands so terminals and skills
  can register/close gates by hand; used by the above to avoid duplicated logic.
  Dedup key: `action` + `target` (one card per PR/branch), live states only, checking
  parsed `state` not directory (the branch_hygiene N1 lesson).

Reconciler side (Daniel's pick: dashboard daemon poller): a small interval loop in the
dashboard server (alongside the existing Plane-A watcher) that every few minutes lists
open `approve:merge:*` cards and asks GitHub (`gh pr view <n> --json state,mergedAt` via
subprocess, ambient auth — the credential itself is NEVER read, printed, or copied)
whether each PR is merged/closed; if so it transitions the card to `done` with a
`## Result` note through the SAME server-side path `cardRespond.ts` uses
(`withOpsTransaction` + audit row). Poller failures degrade to "card stays open" —
fail toward surfacing, never toward silent closure. Interval and enablement via existing
dashboard config conventions; no new env semantics.

## G2 — Predicate coverage

In `classify()` (`humanInbox.ts`), adding:
- `state === 'stop-requested' || state === 'halting'` → Intervention (urgency high).
- Synthetic item when the repo-root `STOP` file exists → Intervention, urgency critical,
  id stable so it dedups visually; produced by the projection, not a card.
- Stranded-owned: `state: inbox|working`, `owner` a real agent id, card age > threshold
  (default 24h, constant next to the predicate) → new low-urgency category `stranded`
  ("owned by <agent>, no progress for <age> — is its runner online?"). Age from card
  frontmatter/file mtime, whichever the indexer already exposes.
Feed B: `HumanRequestsPanel` (or its server route) also lists runs whose run/stage state
is `waiting-human` even when `openHumanRequestCount === 0`, rendered as "run waiting on
a human with NO open request — inspect run" (that state is otherwise unreachable from
the UI).
Badge counts extend accordingly (and fix the `approvalsClient.ts` default-counts object
omitting `gate`).

## G3 — Reply-liveness honesty

`POST /api/write/card-respond` (input verb) additionally reports consumption reality in
its response: whether the card's `owner` has any live consumer — derived from
(a) `execution-controller: dashboard` (Wave A bridge will consume), (b) Windows scheduled
task registry for known runner tasks (queried server-side, cheap, cached), (c) otherwise
"none known". UI toast + inline banner on the item: "Reply recorded and committed. No
runner is online for `worker-desktop` — this card will not progress until one runs."
No behavior change to the write itself; this makes non-consumption VISIBLE instead of
silent. (Actual consumption for dashboard-routed cards arrives with Wave A activation —
out of scope here.)

## G4 — Brief parity

Extract the gate predicate into one shared implementation consumed by both surfaces:
`brief.py` scans the same states the dashboard projects (add `halted`, root-`blocked`,
stop-ladder). Because one is Python and one TypeScript, "shared" means: a single
spec — table in this doc + a fixture file of card frontmatter → expected
category/none — with BOTH implementations tested against the same fixtures, so drift is
a test failure rather than a silent disagreement.

## Non-goals

- No cross-store Feed A ↔ Feed B reconciliation engine (revisit after Wave A makes
  managed runs real).
- No new notification channels; Telegram delivery itself is the Chief-of-Staff leg.
- No change to wake-me/blocked/halted resolution verbs — they already work and self-clear.

## Testing

- Vitest: every new `classify()` branch (stop-ladder, STOP file, stranded, thresholds),
  reconciler close-path (gh output → transition; gh failure → card untouched), respond
  liveness derivation, counts.
- Pytest: `merge_gate.py` file/close + dedup (live-state, parsed-state), `brief.py`
  parity fixtures.
- Fixture parity suite shared between the two languages per G4.

## Execution

Branch `claude/inbox-gates`, worktree `kb-worktrees/inbox-gates` (off main 2031663).
SDD: fresh Opus 4.8 implementer + fresh Opus 4.8 reviewer per task, boss orchestrates.
The live daemon is NOT restarted by this wave — deploy = Daniel merges, then a deliberate
daemon restart he triggers (it has been up since 07-19 04:43 serving current code).

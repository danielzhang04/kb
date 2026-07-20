# Branch hygiene cadence — design

**Date:** 2026-07-20
**Author:** claude (session with Daniel)
**Status:** approved for implementation
**Branch:** `claude/branch-hygiene`

## Problem

The repo accumulated **45 local branches and 105 remote branches**, nearly all of them
fully merged. The clutter was severe enough that a routine question — "what should we
merge?" — turned into a multi-hour audit across six parallel assessors.

### Evidence

Branch names show the historical cause plainly:

```
claude/c7, c7-plan, c7-server, c7-client, c7-view,
c7-wire, c7-assign, c7-secfix, c7-selfstamp        -> 9 branches, ONE feature
claude/composer, composer-plan, composer-c1..c5,
composer-secfix                                     -> 8 branches, ONE feature
claude/d3, d3-core, d3-broker, d3-pty, d3-panels,
d3-canvas, d3-pty-host, d31-*                       -> ~12 branches, ONE wave
```

One branch **per task**, each with its own worktree. Three features produced ~29 branches
and ~29 working directories.

**That cause is already fixed.** The current subagent-driven workflow has subagents commit
to the parent branch rather than branching per task — the keep-awake feature built the same
day produced 8 tasks, 17 commits, and exactly **one** branch.

### The cause that is still live

Nothing deletes a branch once its work lands. A `finishing-a-development-branch` skill
exists for precisely this and was never invoked — including by the agent that built the
keep-awake feature. The problem is not branching. It is finishing.

Two compounding factors:

- **Local `main` drifted 260 commits behind `origin/main`.** Nothing fetched. Every
  branch therefore *appeared* unmerged, which is what converted ordinary clutter into an
  apparent crisis and produced a wholly incorrect initial analysis.
- **Two remotes.** A `codex` remote mirrors branches (`codex/claude/atlas`, `codex/main`),
  so refs exist twice.

## Goals

1. Merged branches stop accumulating, without anyone having to remember anything.
2. Local `main` never silently drifts behind `origin/main` again.
3. Stale worktrees stop pinning branches that are otherwise deletable.
4. No content is ever lost. Every deletion must be provably free of unique commits.
5. Anything requiring judgement reaches a human instead of being guessed at.

## Non-goals

- **Not deleting unmerged branches, ever.** Those hold unique commits; removing a ref
  discards them. Reported only.
- **Not touching any remote.** GitHub's own setting handles `origin` (below), and the
  `codex` remote's deploy key is scoped to `codex/*` regardless.
- **Not enforcing branch naming or workflow shape.** Out of scope; a constitution matter.
- Not a general repo-maintenance tool. Branch and worktree hygiene only.

## Architecture

Two components, deliberately unequal in size.

### 1. GitHub setting (one-time, not code)

Enable **"Automatically delete head branches"** on the repository. Branches on `origin`
are then deleted the moment their PR merges.

This is strictly better than anything scheduled: it fires synchronously with the event
that makes the branch garbage, needs no maintenance, and cannot drift. It would have
prevented the large majority of the 105 remote branches. The script therefore never needs
remote-deletion capability at all — which is what keeps its blast radius local-only.

### 2. `scripts/branch_hygiene.py`

Handles only what GitHub cannot see: local refs, stale worktrees, and the drifted local
`main`.

## Algorithm

1. `git fetch origin --prune`
2. **Fast-forward local `main`** to `origin/main` — only if fast-forwardable. Never forced,
   never reset. If it cannot fast-forward, that is a reportable anomaly, not something to
   resolve automatically.
3. For each local branch, excluding `main`, `ops`, and the currently checked-out branch:
   - **Ancestor of `origin/main`?**
     - Pinned by a worktree with **no tracked changes** → remove the worktree, then delete
       the branch. Untracked build artifacts (`node_modules/`) do not block this; all three
       "dirty" worktrees encountered during the manual cleanup contained only that.
     - Pinned by a worktree with **real uncommitted work** → skip, record for reporting.
     - Not pinned → delete.
   - **Not an ancestor?** Never touched. Recorded; reported if its last commit is older
     than `STALE_DAYS` (default 14).
4. `git worktree prune`
5. Report (below).

## Safety invariants

The governing property: **a deletion may only occur when the branch's commits are all
reachable from `origin/main`**, so nothing unique is lost.

| Invariant | Mechanism |
|---|---|
| Deletion gated on a provable fact | `git merge-base --is-ancestor <branch> origin/main`. No heuristics, no name matching, no age-based deletion. |
| Defence in depth on that gate | Only `git branch -d`, never `-D`. Git independently refuses to delete an unmerged branch, so the ancestry check *and* git's own guard would both have to fail. |
| Protected refs | `main`, `ops`, and the current branch are excluded by name before any other logic runs. |
| No remote mutation | The script issues no `git push`, no `--delete`, and never contacts the `codex` remote. |
| Worktree removal is bounded | Only when the branch is merged **and** `git status --porcelain` shows no tracked modifications. |
| Observability before action | `--check` performs a full dry run and mutates nothing, matching `sync_skills.py --check`. |

## Reporting policy

A wake-me card is filed **only when something needs a human**:

- a worktree with real uncommitted work blocking an otherwise-deletable branch,
- an unmerged branch untouched for more than `STALE_DAYS`,
- local `main` unable to fast-forward,
- any git command failing unexpectedly.

A clean run files **no card** — it appends one line to `memory/<agent-id>.md` and exits 0.

This is deliberate. A weekly card reading "nothing to do" trains everyone to skim past
cards, which would defeat the mechanism precisely when it eventually has something urgent
to say.

Card shape: `cards.new_card(project='kb', action='wake-me', target='branch-hygiene:<reason>',
risk_tier='T1', body=...)`, deduped against the existing queue by `action` + `target` the
same way `agent_runner.ps1`'s `New-WakeMeCard` and `dispatch.py`'s unknown-tier wake do, so
a persistently-blocking worktree files one card rather than one per week.

### Exit contract

The cadence prompt branches on this, so it is part of the interface, not an implementation
detail:

| Exit | Meaning | Cadence should |
|---|---|---|
| `0` | Clean run. Work may have been done (branches deleted, `main` fast-forwarded) but nothing needs a human. No card filed. | Append the lessons line, commit, push. |
| `1` | Something needs a human. A wake-me card has **already been filed** before exit. | Confirm the card exists, then stop. Do not retry, do not hand-delete. |
| `2` | The script could not run at all (not a git repo, `origin` missing, git unavailable). No card filed — the card machinery may itself be unreachable. | Stop and surface the stderr text directly. |

Exit `1` never means "failed" — it means "finished, and found something for you". The
distinction matters because a retry on exit 1 would be wrong: the condition is a human's to
resolve, not a transient error.

## Cadence entry

Appended to `HEARTBEAT.md`:

```yaml
  - name: branch-hygiene
    schedule: weekly:sun
    tier: desktop
    risk-tier: T1
    prompt: |
      1. Run: py -3 scripts/preamble.py  — if it fails, stop and write a wake-me card
         into queue/inbox/ explaining why.
      2. Run: py -3 scripts/branch_hygiene.py
      3. If it exits non-zero it already filed a wake-me card describing what needs a
         human. Confirm the card exists, then stop — do not retry and do not delete
         anything by hand.
      4. On exit 0, append a lessons line to memory/<agent-id>.md, then commit ONLY
         memory/ queue/ ledgers/ changes to ops and push.
```

`tier: desktop` is forced, not chosen: worktrees exist only on Daniel's machine, so a cloud
runner could not see them.

**Write allow-list**, mirroring the `nightly-review` carve-out precedent rather than
inventing a new permission shape:

- `memory/<agent-id>.md` (the agent's own shard)
- wake-me cards into `queue/inbox/`
- `ledgers/dispatch/**` (its own rows)

Everything else is excluded, explicitly including `governance/**`, `ledgers/grades/**`,
`ledgers/activity/**`, other agents' memory shards, and any project work tree.

## Testing

Unit tests (`tests/test_branch_hygiene.py`, pytest, run via the `py` launcher — never bare
`python`, which resolves to a pip-less msys build on this machine).

Git interaction sits behind one injectable seam so the decision logic is testable against
fakes, with a few tests exercising a real temporary git repository for the ancestry and
worktree behaviour that fakes cannot honestly model.

- `main`, `ops`, and the current branch are never selected for deletion, even when merged.
- A merged, unpinned branch is selected.
- An unmerged branch is never selected, regardless of age.
- A merged branch pinned by a clean worktree → worktree removed, branch deleted.
- A merged branch pinned by a worktree with tracked modifications → skipped and reported.
- Untracked-only changes (`node_modules/`) do not block pruning.
- Local `main` fast-forwards when possible; a non-fast-forwardable `main` is reported, not forced.
- `--check` mutates nothing — asserted by comparing full branch and worktree lists before
  and after.
- A clean run files no card; each reportable condition files exactly one, deduped.

## Risks

- **A wrong deletion is the only serious failure mode.** Mitigated by the ancestry gate plus
  git's own `-d` refusal — two independent guards, both of which must fail.
- **Worktree removal deletes directories**, a larger blast radius than deleting a ref.
  Bounded by requiring the branch to be merged *and* free of tracked changes.
- **`--check` drift**: a dry run that diverges from real behaviour would erode trust in the
  mechanism. Tested explicitly rather than assumed.
- **Cadence fatigue**: mitigated by the no-card-on-clean-run policy above.

## Open governance question

`governance/risk-tiers.md` states that a cadence is pre-approved because *"a human authored
and committed it"* to a `HEARTBEAT.md` on protected `main`. Here the cadence is
**agent-authored** and human-merged.

Daniel's merge of the PR is the plain reading of that authorization, and it is how this
design proceeds — but it sets a precedent for every future agent-authored cadence, so it
warrants an explicit confirmation at merge time rather than a silent assumption. Flagged
here so the decision is recorded rather than inferred.

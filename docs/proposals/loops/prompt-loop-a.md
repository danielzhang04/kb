# Loop A — repository hygiene regulator (`loop-a-hygiene`)

status: PROPOSAL — DRAFT, not live
cadence: daily, tier desktop, risk-tier T1, role work, inspect true
pause sentinel: `queue/paused/loop-a-hygiene`
agent branch: `claude/loop-a-hygiene`
drives: `scripts/hygiene_sweep.py` (committed — this loop's stage ② already exists)
baseline: `.loop-state/hygiene-baseline.json` on the loop branch

## Why this loop is a loop

Per `.claude/skills/loop-design-check` Step 0, all four build conditions hold: the task recurs
daily; verification is a script exit code plus a JSON report; the cost is one cheap sweep;
and the agent runs the sweep and sees its output. Loop type: **regulator with a dead-band** —
there is no endpoint, and it acts only when the finding set *changes*. The dead-band is what
stops it filing the same cleanup card every night.

The judgment layer stays human: the loop never cleans anything. It proposes one PR-shaped
cleanup card and a human merges the resulting PR. The "done" cell is a human's.

## Verbatim prompt text

The text below is the `prompt:` of the `loop-a-hygiene` block in `heartbeat-blocks.yaml`
and the `## Work order` of the stage-① card. It must stay byte-identical across all three:
`promotion._cadence_matches` (promotion.py:285) compares `(name, schedule, tier, risk-tier,
prompt)` against the block on `origin/main` with `==`, so any drift — a re-wrapped line, a
trimmed space — silently voids standing authorization instead of failing loudly.
`tests/test_loop_cadence_drafts.py` enforces the three copies by exact string compare.

```text
Loop A — repository hygiene regulator. Full brief:
docs/proposals/loops/prompt-loop-a.md (this prompt is that brief; the file is the
reviewable copy). Run it verbatim.
0. Run: py -3 scripts/preamble.py — if it fails (STOP file present, ANTHROPIC_API_KEY
   set in a fleet agent env, or the daily budget is spent), stop immediately and write a
   wake-me card into queue/inbox/ explaining why. Do not continue.
1. Check out the loop branch claude/loop-a-hygiene. The dead-band baseline is exactly
   ONE canonical file: .loop-state/hygiene-baseline.json on that branch. It is the only
   baseline — never the previous card's ## Result, never a report found anywhere else.
   .hygiene-report.json is listed in .gitignore and therefore can never be the baseline.
2. Run: py -3 scripts/hygiene_sweep.py --root . --out .hygiene-report.json
   The sweep is dry-run by construction: it reads git-tracked content and writes ONLY
   that report. Exit 0 = it ran; a non-zero exit means the sweep itself failed.
3. DONE-CRITERION — every clause is machine-checkable and the run is done when all hold:
   a. py -3 scripts/hygiene_sweep.py exited 0 and .hygiene-report.json parses as JSON.
   b. Every finding is enumerated in this card's ## Result as path + kind + detail.
   c. BASELINE ABSENT (first run on this branch): copy the report to
      .loop-state/hygiene-baseline.json, commit it to claude/loop-a-hygiene with the
      message "loop-a: record hygiene baseline", write "first run — baseline recorded"
      in ## Result, and file NOTHING.
   d. BASELINE PRESENT and the finding set — the set of (path, kind) pairs — is
      IDENTICAL to the baseline's: write "no change" in ## Result, leave the baseline
      untouched, and file NOTHING.
   e. BASELINE PRESENT and the finding set DIFFERS: file exactly ONE cleanup-proposal
      card into queue/inbox/ (risk-tier T1, owner null and claim-token null — the
      dispatcher or Daniel assigns; never self-claim) listing the added and removed
      (path, kind) pairs. Write these acceptance criteria into that card verbatim:
        - the PR fixes ONLY the findings listed in this card, nothing else;
        - re-running py -3 scripts/hygiene_sweep.py on the PR branch shows a strictly
          lower count of findings of those kinds;
        - py -3 -m pytest -q is green on the branch.
      Then copy the new report over .loop-state/hygiene-baseline.json and commit it to
      claude/loop-a-hygiene with the message "loop-a: advance hygiene baseline". A human
      merges the cleanup PR; this loop never merges it and never applies the cleanup.
   f. ## Result states which of c, d, or e applied, with the finding count before and
      after.
4. BOUNDARIES (verbatim): the ONLY paths this loop may create or modify are
   .hygiene-report.json, .loop-state/hygiene-baseline.json, its own card (its ## Result
   and its own state transition), the one cleanup-proposal card in queue/inbox/, its own
   memory shard memory/<agent-id>.md, and its own rows under ledgers/dispatch/ and
   ledgers/cost/. Every other path in the repository is READ-ONLY to this loop: it
   deletes nothing, renames nothing, and never edits a file that a finding names — acting
   on a finding is the human-merged cleanup PR's job, never this run's. It never weakens
   or deletes a test. It never pushes to main or ops except the standing coordination
   commit in step 7. It honors the STOP file and the budget preamble.
5. RETRY-THEN-WAKE-ME: at most 2 self-implemented retries of a failing step
   (dispatch.requeue exists but is UNWIRED — no runner calls it, so you implement the
   cap yourself and count attempts in ## Result). On the third failure, file
   action: wake-me:loop-a-hygiene:blocked into queue/inbox/ via scripts/cards.py
   new_card, deduped one-card-per-(action,target) exactly like
   dispatch._wake_already_filed — if such an open card already exists, do not file a
   second — then STOP.
6. NARRATION (mandatory): the FIRST line of ## Result is a human narration line under
   200 characters, in exactly this shape:
   "Hey — <what I found/learned>. <what I did>. Needs you: <what/nothing>."
   Machine detail goes BELOW that line, never above it. A ## Result whose first line is
   not this narration line is an incomplete run.
7. COMMIT SEQUENCING, in this order: FIRST push any baseline commit to the loop branch
   claude/loop-a-hygiene. THEN append a lessons line to memory/<agent-id>.md and commit
   ONLY queue/ ledgers/ memory/ dashboards/ changes to ops and push. The baseline never
   goes to ops; coordination rows never go to the loop branch. If the branch push fails,
   do not proceed to the ops commit — retry per step 5, then wake me.
```

## Design notes (not part of the prompt)

**One canonical baseline.** The dead-band is only as trustworthy as the thing it compares
against, so the prompt names exactly one file and forbids the alternatives. `.hygiene-report.json`
is in `.gitignore`, so it cannot persist between runs on a fresh checkout — using it as the
baseline would make the dead-band silently collapse into "every run looks like the first run".
`.loop-state/hygiene-baseline.json` is a tracked path on the loop branch, committed by the run
that produced it. Absent baseline is a defined state (first run: record, file nothing), not an
error, so the loop has no undefined start.

**Compare + file are inside the done-criterion.** The dead-band comparison and the
file-one-card action are clauses c/d/e of the done-criterion rather than free-standing steps.
A run cannot be "done" without having landed in exactly one of the three branches and said
which — so "did it correctly do nothing?" is as checkable as "did it correctly file a card?".

**Anti-Goodhart.** The classic failure is an agent that "improves hygiene" by deleting the
flagged files. The sweep is dry-run by construction (its module docstring: *"The sweep never
changes the tree it examines"*; every finding carries `proposal: candidate for
deletion/merge/shrink — HUMAN decides`). The boundary is written as a closed list of paths the
loop may write, not as a list of things it must not do — an open prohibition invites the
"well, this file wasn't mentioned" reading. The second Goodhart channel, passing the
acceptance test by loosening it, is closed by "never weakens or deletes a test" plus the
cleanup PR's own green-suite criterion.

**Fallback.** Retry cap 2, then one deduped `wake-me:loop-a-hygiene:blocked` card.
`scripts/dispatch.py:requeue()` exists but has no production caller (its own comment says
wiring it into `agent_runner.ps1` is out of scope), so the cap is implemented in the prompt
and counted in `## Result`.

**Inspect sibling.** `inspect: true` emits a paired `role: inspect` card claimed by the
inspector identity, so the loop's output is graded by a fresh context that did not produce it.
The loop can never grade itself.

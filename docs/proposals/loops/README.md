# Self-improving loops — cadence proposal

**Status: PROPOSAL.** Nothing in this directory is live, dispatched, or armed. These are
reviewable drafts on the work branch `claude/agent-platform-w1`; landing any of it is Daniel's
act, described under [Ops-landing gate](#ops-landing-gate) below.

| File | What it is |
|---|---|
| `heartbeat-blocks.yaml` | The three cadence blocks exactly as they would be appended to `HEARTBEAT.md` |
| `prompt-loop-a.md` | Loop A brief — the block's `prompt:` plus its design rationale |
| `prompt-loop-b.md` | Loop B brief |
| `prompt-loop-c.md` | Loop C brief |
| `stage1-cards.md` | The three hand-run card bodies, ready to file |
| `../../../scripts/agent_track_record.py` | Loop C's stage-② evidence driver (new, read-only) |
| `../../../tests/test_agent_track_record.py` | 14 tests for that driver |
| `../../../tests/test_loop_cadence_drafts.py` | 30 tests over the drafts above |

Run the validation:
`py -3 -m pytest tests/test_loop_cadence_drafts.py tests/test_agent_track_record.py -q`

---

## The three loops

**Loop A — repository hygiene (`loop-a-hygiene`, daily).** Every night it runs
`scripts/hygiene_sweep.py`, which reads git-tracked content and writes one JSON report of
things a human might want to delete, merge, or shrink — oversized files, stale handoffs,
zero-byte files, TODO thickets. It never touches the tree. It enumerates the findings in its
card `## Result` and compares them against one canonical baseline,
`.loop-state/hygiene-baseline.json` on its own branch. No baseline yet means first run: record
it, file nothing. Same findings as the baseline means "no change": file nothing. A changed set
means file exactly one cleanup-proposal card describing a branch-and-PR fix for those specific
findings, advance the baseline, and let a human merge the PR. The loop proposes; it never
cleans.

**Loop B — lesson mining (`loop-b-lesson-mining`, daily).** Every night it runs
`scripts/brain/session_miner.py` over yesterday's Claude Code transcripts and turns two
deterministic signals — a failed tool call retried with changed inputs and later success, and
explicit `WORKED:/LEARNED:/HAZARD:` markers — into candidate lessons with transcript-line
evidence. Candidates are deduped by a stated rule (0.8 Jaccard over whitespace tokens) against
accepted memory and the last 14 days of proposals, then written to `docs/proposals/lessons/`
as `status: PROPOSED` files with a digest of counts in the card `## Result`. If `memory/` is
missing from the checkout the run aborts to a wake-me card rather than reporting a
dedup pass it could not have performed. The miner mechanically refuses to write `memory/`;
accepting a lesson into memory stays a human act.

**Loop C — agent upgrades (`loop-c-agent-upgrade`, Saturdays).** Once a week it runs
`scripts/agent_track_record.py`, a read-only script that rolls the trust-filtered grades ledger
into a fixed per-agent table, and proposes upgrades only against a failure pattern that appears
in at least two graded rows for that agent — at most two agents and four diffs a run, each diff
citing the exact table row behind it, all on a branch for a human to read. Every edited file's
YAML frontmatter must come back byte-identical: the loop may rewrite an agent's instructions,
never its governed configuration. It never edits `governance/`, the constitution files, or
`.claude/**`; it never touches its own judge or itself; and it never merges.

---

## How the three compose

Loop B and Loop C are a pipeline with a human in the middle, and that middle is load-bearing.
B extracts candidate lessons from transcripts but cannot accept them — its output is a
proposal file. When Daniel accepts one into `memory/*.md`, it becomes something C is allowed to
cite: C reads `memory/*.md` as accepted evidence alongside the grades table, so an accepted
lesson turns into an argument for a concrete change in an agent's definition. Raw transcript
noise cannot reach an agent definition; only a lesson a human has signed off on can, and only
alongside a failure pattern the ledger independently confirms. Loop A stands apart from that
chain — it tends the repository rather than the fleet — but it shares the shape: observe
mechanically, propose narrowly, let a human decide.

---

## Why this is inert

If these blocks landed on `HEARTBEAT.md` today with the sentinels in place, **nothing would
run**. There are two independent interlocks and one corollary.

**Interlock 1 · Paused sentinels.** `dispatch.due()` returns `False` for a cadence whose
files-only sentinel `queue/paused/<name>` exists — a presence check, contents never read,
suppress-only, one cadence's marker never affecting another. With all three sentinels present
the dispatcher never emits a card at all.

Planned sentinel paths (created together with the blocks, deleted one at a time by Daniel —
see [Arming ceremony](#arming-ceremony)):

- `queue/paused/loop-a-hygiene`
- `queue/paused/loop-b-lesson-mining`
- `queue/paused/loop-c-agent-upgrade`

**Interlock 2 · Not standing-authorized, and no grade streak.** `promotion.decide()` grants
`acts-alone` on two paths only. Standing authorization is verified against the block on
protected `origin/main` (`promotion._standing_authorized`, comparing name, schedule, tier,
risk-tier, and prompt with `==`) — these blocks are proposed for the **ops** `HEARTBEAT.md`, so
they are not on main and are not standing-authorized. And the loop workers have no grade rows
keyed to `(worker, kb, cadence:loop-*, tier)`, so `status()` returns `queues-for-me`.

**Corollary · No carve-out.** `governance/risk-tiers.md` grants its write allow-list carve-out
to `nightly-review` **only** — verbatim: *"This carve-out names `nightly-review` only; no other
cadence inherits it."* This is worth stating but it is **not a third independent interlock**:
`dispatch._carveout_voided()` (dispatch.py:578) can only ever *downgrade* an `acts-alone`
verdict to `queues-for-me`, never grant one. Since interlock 2 already yields `queues-for-me`,
the carve-out check is a no-op here. What follows from it is narrower and still useful: the
`writes:` key on these three blocks is declarative documentation of intent, not a code-enforced
permission, so the write surface is held by the prompt BOUNDARIES and the human approval gate
rather than by `dispatch.py`.

**Therefore: approvals-only.** Should a sentinel be removed prematurely, `decide()` returns
`queues-for-me`, `dispatch.run()` sets `state = "approvals"`, and the card lands in
`queue/approvals/` waiting for a human token — not in `queue/inbox/` where a runner would pick
it up. Each loop additionally carries `inspect: true`, so every run is paired with a
fresh-context inspector card under the inspector identity; no loop can grade itself.

**The stage-① cards are outside this argument, deliberately.** A hand-filed card is not a
cadence emission: `promotion.decide()` never runs for it, no sentinel is consulted, no
standing-authorization check happens, no grade streak is computed. That is the point of a
stage-① run — a human choosing to run the thing once, under their own eyes, before any clock
is involved. The cards are still filed with `owner: null` so the human who files one does not
also claim it.

---

## Arming ceremony

Arming is Daniel's, one loop at a time, and is deliberately not scriptable. Stage ② (a
committed, tested driver script) exists for all three before any of this begins:

- Loop A's stage ② is `scripts/hygiene_sweep.py` — already committed and tested.
- Loop B's stage ② is `scripts/brain/session_miner.py` — already committed and tested.
- Loop C had none, which would have left the model selecting its own evidence out of the raw
  ledger. **`scripts/agent_track_record.py` + `tests/test_agent_track_record.py` are built by
  this proposal to close that gap**, and the Loop C prompt runs it rather than reading the
  ledger itself.

Then, per loop:

1. Run its stage-① card by hand (`stage1-cards.md`) and read the result. Nothing is armed yet.
2. Delete `queue/paused/loop-a-hygiene` on `ops`. Loop A dispatches on its next beat.
3. Watch it for at least one full week — read its `## Result` narration line and its inspector
   sibling's grade — before arming anything else.
4. Delete `queue/paused/loop-b-lesson-mining`. Watch a week.
5. Delete `queue/paused/loop-c-agent-upgrade` last, and only after Daniel has ruled on its
   risk tier.

Re-creating a sentinel file pauses that loop again at its next beat, with no edit to
`HEARTBEAT.md` and no effect on the other two. That is the intended stop control; the repo-root
`STOP` file remains the fleet-wide one.

Note the interaction with the inert-ness argument: deleting a sentinel removes exactly one of
the two interlocks. A freshly armed loop still lands in `queue/approvals/` until Daniel either
commits its block to `main` (standing authorization) or it earns a grade streak. Arming means
"start proposing", not "start acting alone".

---

## Cost

Loops A and B are cheap: one script run plus a short write-up on `claude-sonnet-5`, daily.

Loop C is the one worth pricing before arming. A weekly run on `claude-opus-5` reads the
track-record JSON (small), up to two `agents/*.md` definitions in full, the memory shards it
cites, and a `pytest -q` transcript — call it **150k–250k input and ~20k output tokens per
run**, which at Opus list rates is roughly **$3–4 per run, $13–17 per month**. Two caveats:
kb's fleet runs on subscription billing, so these steps log `0.0` to the cost ledger and the
real constraint is context budget rather than dollars (`governance/budget.yaml` caps
API-billed steps at `$5.00/day`); and the fan-out caps — two agents, four diffs — are what
keep the estimate from being open-ended. If Daniel would rather not spend Opus weekly,
`claude-sonnet-5` is a one-line change in the block, at the cost of weaker judgment on the
loop that most needs it.

---

## Ops-landing gate

Every file here is a draft on a work branch. Three separate coordination writes are needed to
make any of it real, and per CLAUDE.md coordination writes go to `ops` while `governance/` and
`CLAUDE.md` are human-edited only. All three are **Daniel's to approve and perform**:

1. **The `HEARTBEAT.md` append** — the three blocks from `heartbeat-blocks.yaml`, inserted
   under the existing `cadences:` key at the same indentation.
2. **The sentinel files** — the three `queue/paused/<name>` markers, created in the same
   change so the loops are inert from the instant they are declared. Creating the blocks
   without the sentinels is the one ordering that is not safe.
3. **The stage-① cards** — filing the three card bodies from `stage1-cards.md` into
   `queue/inbox/` with `owner: null`, for the dispatcher or Daniel to assign.

`scripts/agent_track_record.py` and its tests are ordinary work product, not coordination
writes: they land through a normal PR to `main` like any other script.

**Open precedent: agent-authored cadences.** `docs/specs/2026-07-20-branch-hygiene-cadence-design.md`
flags this and it is still open. `governance/risk-tiers.md` pre-approves a cadence because
*"a human authored and committed it"* to a `HEARTBEAT.md` on protected `main`. These three
blocks are agent-authored and human-merged, exactly as `branch-hygiene` was. That spec's
position — Daniel's merge is the plain reading of the authorization — is the position this
proposal inherits, and it asks for the same explicit confirmation at landing rather than a
silent assumption. The precedent now has a second instance; it is worth settling in writing.

---

## Open items for Daniel

**1 · Loop C's risk tier.** Recommended **T2** (reasoning in `prompt-loop-c.md`). Ruling needed
before Loop C is armed. Changing it touches three files together: `heartbeat-blocks.yaml`,
`prompt-loop-c.md`, and card 3 in `stage1-cards.md` — the prompt copies are compared exactly.

**2 · Ops landing.** Approve (or not) the three coordination writes above.

**3 · Arming.** Whether to start the ceremony at all, and when — one sentinel deletion at a
time, with stage ① run by hand first.

**4 · The agent-authored-cadence precedent**, per the note above.

**5 · No dedicated worker identity for the loops.** None of the three blocks carries an
`agent:` key, so `dispatch.run()` falls back to `owner = agent_id` — the **dispatcher itself
owns every loop card**. Consequences worth a decision rather than a default: the loops write
their lessons into the dispatcher's memory shard rather than their own; their grade rows accrue
to the dispatcher's `(worker, project, task_type, tier)` key, so a loop's track record is mixed
in with everything else the dispatcher runs; and `promotion.decide()` computes autonomy against
the dispatcher's streak, not the loop's. The alternative is registering three identities in
`agents/` (`loop-a-hygiene@agents.local` and siblings) so each loop earns and loses trust on
its own record. That is the cleaner shape and it is what earned-autonomy was designed for, but
it is three new registry entries and Daniel's call, so it is named here rather than assumed.

**6 · Terminal notifications — Daniel asked for these, and kb has no push channel.** There is
no mechanism today that interrupts a terminal to tell him a loop found something. What these
loops give him instead is pull-shaped: the mandatory narration line at the top of every
`## Result` (one sentence, under 200 characters, `"Hey — …. …. Needs you: …"`), the approvals
cards that queue for his token, and the Loop Status feed in the dashboard. Recommended for
Wave 2: a `SessionStart` hook that prints the last N loop narration lines when he opens a
session — cheap, no new infrastructure, and it meets him where he already is. The cheapest
genuine *push* alternative is to route wake-me narrations through the approvals Telegram
sender that already exists, reusing a channel rather than building one.

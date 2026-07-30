# FYT gated pipeline BUILT + PR #102 open — maiden run blocked on one Daniel ruling — 2026-07-30

## Context

Daniel's arc: turn the FYT agent build into a working human-gated multi-agent pipeline on the kb
platform — idea → published-private video — without bloating infra. Design
`docs/specs/2026-07-30-fyt-gated-pipeline-design.md` (rev 2), plan
`docs/plans/2026-07-30-fyt-gated-pipeline.md`, both already on `main`. Tasks 1–5 of the plan are
built and reviewed; **Task 6 (the maiden run) cannot start** until Daniel rules on how roster
terminals answer Claude Code's own tool-permission prompt. Everything is on
`claude/fyt-pipeline-boss` (pushed, head `a64cc43`, worktree
`C:/Users/danie/kb-worktrees/fyt-pipeline-boss`) and open as **PR #102**.

He ran this session under "run all the way through step 6 without checkpointing or pinging me,
then write a handoff" — so the stopping point below is a real blocker, not a checkpoint.

## The one thing blocking the maiden run

**A spawned roster terminal's first action sits on Claude Code's interactive `Do you want to
proceed?` Y/N gate, and nothing in the design answers it.** All six terminals hit it
simultaneously on reading their own `binding.md`. Ruled out as explanations, with evidence:

- `hasTrustDialogAccepted` (folder trust) passed *silently* for a path `~/.claude.json` had never
  seen — not the blocking gate.
- `allowedTools` is `[]` even for the most-used entry on this machine
  (`C:/Users/danie/faceless-youtube`, `lastCost: $233`) — per-tool memory is not what lets the
  real checkout proceed either.
- The menu's own option 2 reads "allow reading ... **during this session**" — answered live, per
  session, no config equivalent.

**Why this was invisible until now:** the earlier smoke run only got further because it ran in a
path with months of ambient interactive history. Any fresh machine, fresh worktree, or new
channel's first video folder hits the same wall. The pipeline currently depends on tacit per-path
state nobody declared.

**Daniel's ruling needed.** The recommendation from the agent that watched it fail (I concur): at
`ensureRoster`, write a scoped per-run local settings file into the roster work dir granting
Read/Write/Edit/Bash **only** within that stage's already-declared `scope.read ∪ scope.write`,
before the launch line is typed. The compiled proposal already carries exactly that data. Rejected
alternatives: blanket permission flags (widens an unattended terminal's reach far beyond the
stage's declared scope — strictly worse than the problem), and spawning into a pre-trusted path
(fixes only the trust dialog, which was never the blocker). This is an autonomy expansion, so it
is his call, not an agent's. A boss session must NOT clear these prompts itself — doing it on a
subagent's behalf is permission laundering; that happened this session and was refused.

Side effect worth noting: fixing the gate also fixes the delivery race below, since there would be
no menu left for the delivery line to collide with.

## Second product bug, unfixed

`dashboard/server/control/rosterSessions.ts:913` types the delivery line into the pty
unconditionally — nothing checks whether the terminal is at a plain prompt or inside a modal menu.
Observed: the delivery line and menu option 2's label interleaved character-by-character into
unreadable text, and the line was **swallowed by the menu** (`idea.state` stayed `running`, no
video dir created, order file valid on disk but never read). The stage would have sat the full
4h `DEFAULT_DELIVERY_TIMEOUT_MS` before settling `waiting-human` with `roster-delivery-timeout`.
Fix shape: gate delivery on REPL readiness, don't just write and hope.

## Built and proven (10 commits, 9e41b78..a64cc43)

Two adversarial reviews ran. The first returned **DO-NOT-SHIP**: `video-run` could not launch at
all — launch minted a boundary per gate plus a `governance-refusal` for the T3 stage that
`acceptsBoundary` refuses unconditionally, so the run parked forever and the roster never spawned.
The second returned SHIP-WITH-FIXES and drew the line at the money gate; both its blockers are
closed.

Proven on a live daemon with an isolated state root: inert boot; `execution-locked` launch
refusal; launch compiling to a runnable 13-stage workflow with **zero** approval requests at
launch; **six real `claude.exe` processes, each with `--model claude-fable-5` in its own command
line, each bound to a distinct agentId**; the spend gate never even created; retire leaving
`/api/pty/sessions` empty; and the canvas showing six live mini-terminals with a working
expand-to-interact and a blocked-badge deep link into the Inbox.

**Not proven, and honest about it:** the completion-marker round-trip through a real terminal
(Fact 5, blocked above) and G0's structural halt at `story` (Fact 4 — its precondition is `idea`
succeeding, which never happened). Everything needed to prove both is already instrumented in the
harness.

Suite: `dashboard/` **207 files / 2336 passed / 0 failed**, `tsc` clean; 158 python tests across
the three skills.

## Decisions a later terminal must not relitigate

- **Gates are born at stage boundary, never at launch.** A launch-time approval must never be able
  to authorize spend or publication.
- **Byte-identical stage output PARKS rather than passes.** At the artifact layer it is
  indistinguishable from a stage that did nothing, and G2 spends real money on the promise the
  merge ran. Same-size-different-bytes passes — change detection, not novelty detection.
- **`fyt-checker` executes the two merge nodes**, `fyt-runner` governs them. Contradicts the spec
  and is flagged PENDING DANIEL'S RULING in the spec, STATUS.md and decisions.md.
- **`publicationAuthorization` is net-new** and is what makes G4 work; `RESTRICTED_INTENT_RULES` is
  byte-for-byte untouched but the effect of its publication rule is now releasable by a human
  approval. Highest-stakes deviation — also PENDING HIS RULING.
- **T3 admission is a hard opt-in** named at the launch call site, not inherited from
  `publishBlocked`.
- **Coordination writes refuse to run git off `ops`** (`2fdb2ca`).

## Two traps that cost this session real time

1. **The "30 pre-existing failures" baseline was never environmental.** It was stale fixtures
   naming `claude-opus-4-8`, which Daniel removed from `governance/model-routing.yaml`'s
   `known_models` — in exactly the two files that exercise the launch path. That dead signal is
   how two CRITICAL launch bugs shipped green. **Never accept a declared failing baseline without
   reproducing its cause.**
2. **Never point a dashboard daemon's `DASHBOARD_REPO_ROOT` at a live work-branch worktree.** The
   real `appendAudit` implements the ops coordination-write rule, so it ran
   `git pull --rebase --autostash origin ops` against `claude/fyt-pipeline-boss` and started a
   549-step rebase that jammed mid-conflict with seven commits on the branch. Recovered with no
   loss. `2fdb2ca` guards `appendAudit` — but **`canonicalResultIntegrator.ts` still does a real
   `git push origin ops` behind `createResults` and is NOT guarded.** Fake the seams, and use a
   disposable detached checkout.

## Next actions, ordered

1. **Daniel:** review/merge PR #102, and rule on (a) roster tool permissions — the blocker,
   (b) merge-node ownership, (c) `publicationAuthorization`.
2. Implement his tool-permission ruling in `rosterSessions.ts` at `ensureRoster`, plus the
   REPL-readiness gate on delivery.
3. Re-run the harness to close Facts 4 and 5:
   `node run-dry-check.mjs --fresh --slug <new-slug> --idea-timeout-ms 2400000` from
   `<scratchpad>/dry-check/`. **Point it at a disposable detached worktree, never a live branch.**
   NOTE: the harness lives in this session's scratchpad and may be swept — if gone, its shape is
   documented in this handoff and PR #102.
4. Then Task 6, the maiden run: fresh the-second-take idea, script the whole video, feed only a
   ~2-minute slice through images/VO/render. G2/G3b (real spend) and G4 (real upload) are human
   authorizations and cannot be self-granted — `CLAUDE.md`'s "never spend real money" and Stage-0
   publish law both bind.
5. Guard `canonicalResultIntegrator.ts`'s `git push origin ops` the way `appendAudit` now is.

## Load

- `docs/specs/2026-07-30-fyt-gated-pipeline-design.md` — design + the As-built deviations section
- `docs/plans/2026-07-30-fyt-gated-pipeline.md` — Tasks 1–6, acceptance criteria
- `orgs/faceless-youtube/workflows/video-run.md` — the 13-stage def, gates, declared artifacts
- `orgs/faceless-youtube/docs/STATUS.md` — proven vs not-proven vs owed
- `orgs/faceless-youtube/knowledge/decisions.md` — 2026-07-30 entries
- `agents/fyt-runner.md`, `agents/fyt-checker.md` — governance vs execution split
- `dashboard/server/control/rosterSessions.ts` — spawn, delivery, marker, artifact snapshot
- `dashboard/server/control/compiler.ts` + `launch.ts` — the entry-gate model and T3 release
- `memory/claude-boss.md` — lessons, including this session's
- PR #102 body — full review history and the disclosed git incident

# Arc-2 handoff (2026-07-20) — written at a strategic-compact boundary

Author: claude-boss (Fable 5 orchestrator, autonomous session, Daniel away).
Supersedes nothing; CONTINUES `docs/plans/2026-07-19-triple-arc-HANDOFF.md`. Read that first for
the original mandate, then this file for what arc-2 completed and what remains.

## Session identity

Session id `7e646a05-9e71-4033-a1be-603d0390d991`. Worktrees used:
- `kb-worktrees/fleet-arc` (branch `claude/fleet-arc`) — fleet scripts + dashboard code
- `kb-worktrees/faceless-import` (branch `claude/faceless-live-import`) — the video project
- `kb-worktrees/dashboard-ops` (branch `ops`) — ALL coordination writes (pull-rebase, push after)

Nothing is pushed except `ops`. Daniel merges the work branches.

## DONE this session (all verified)

### Fleet waves — arc complete (C, E, F), 497 pytest green on claude/fleet-arc
- **Wave C Dreaming** `bae4a71` + fix `52f578b`: `scripts/dream.py --dry-run` consolidation
  REPORTER (Mem0 ADD/UPDATE/DELETE/NOOP vocabulary). Apply-mode refuses (exit 3) — design-gated
  pending Proving Grounds trust. Opus review SHIP-WITH-NITS; MAJOR fixed (URL guard used an 8-char
  lookback, so long-domain URLs were misread as dead repo paths → false DELETE proposals).
- **Wave E Mission Control + Flight Recorder** `bd8a5f8`, `56d69a8` + fix `7765464`:
  `scripts/mission_control.py` (ranked approvals w/ tier+age+novelty scoring reusing
  promotion.py's assurance classes; quarantine; digest; rubber-stamp latency metric that says
  "insufficient data (n=X)" rather than inventing one), `scripts/trace_normalize.py` +
  `scripts/trace_view.py` (GenAI-semconv spans → static HTML waterfall, `--fork` seed prompt).
  Opus review SHIP-WITH-NITS (XSS probes all held). Fixed: malformed approval cards silently
  vanished from MC (fail-toward-attention restored); 2KB cap counted codepoints not bytes.
  **Store format found**: `<stateRoot>/control/control-plane.json`, stateRoot =
  `$DASHBOARD_STATE_ROOT` → `%LOCALAPPDATA%/kb/dashboard` → `~/.kb/dashboard`. Events are a
  CLOSED public boundary — no tokens/usage/prompts representable, so trace `attrs.tokens` is
  honestly absent. Live capture needs a post-run hook in claudeWorkerAdapter.ts AT ACTIVATION.
- **Wave F Quartermaster** `822c6a1` + fix (orchestrator): escalation-on-failure `requeue()` in
  dispatch.py (bump one tier via new `routing.TIER_LADDER`/`escalate_model`, retry_count cap 2,
  dead-letter to `rejected` + deduped `wake-me:dead-letter`), trust.py per-tier pass/escalation
  columns (honest `n/a` when underivable), sentinel reservation `id` column was ALREADY done in
  Wave D — locked with tests instead. Opus review SHIP-WITH-NITS; **MEDIUM fixed by orchestrator**:
  a negative `retry_count` bypassed the cap (`-5` gave 8 requeues instead of 3) — now floor-clamped
  in both dispatch and trust, regression-tested.
- **brief.py human-gate fix** (orchestrator, found while prepping the Telegram send): the morning
  brief counted only `queue/approvals` + wake-me cards, so the five T3 human-gate cards in
  `queue/inbox` were INVISIBLE and it reported "inbox and approvals are clear". Now
  human-operator-owned / `approve:*` inbox cards rank as pending. Test added.

### WS2 integrations
- `scripts/yt_analytics.py` + 16 tests `2422503`: stdlib-only (no pip deps — this box has been
  bitten), reports.query wrapper, exit codes 0/1/2/3/4, every not-authed message names the missing
  artifact AND its gate card. Client secret expected at `<repo>/config/client_secret.json`
  (override `YT_ANALYTICS_CLIENT_SECRET`); token `%USERPROFILE%\.yt-analytics-token.json`.
- **video-run workflow definition** `48e0a88` (compile proof, fleet-arc) + `33826cd` (the def
  itself, faceless-import branch, BYTE-IDENTICAL to the proven fixture). 13 stages, `producer`
  profile (VERIFIED registered in environment.ts:78), all T2, publish deliberately NOT a stage.
  Constraint discovered: the repo's YAML parser has no block scalars, so every workOrder is a
  single-line double-quoted string.
- **Registry launch-flow replication debt: AUDITED → REAL, fix dispatched.** The convenience route
  `POST /api/workflows/:id/launch` is a hand-copied FORK of control/routes.ts's launch handler.
  Deep governance survives (shared helpers) but three route-level controls were dropped:
  (1) no idempotency — server mints randomUUID per request, so any retry publishes duplicate runs
  AND duplicate canonical queue cards; (2) no `policyBaseCommit`/`policyHashes` in the launch audit
  → launches can't be pinned to the policy text that authorized them; (3) scope-widening check is a
  tautology because compile.ts derives `scope.write` from the very stage targets it checks, so a
  def could target `dashboard/server/control/policy.ts`. Blast radius bounded TODAY only because
  the route refuses when activated and otherwise publishes `blocked` cards.
  **FIXED — `22e6f71`, vitest 1324 → 1332 pass + 2 skip, tsc clean.** New
  `dashboard/server/control/launch.ts` holds `executeApprovedLaunch(...)` lifted verbatim from
  control/routes.ts:203-451 (withOpsTransaction inside, so both callers share ONE ops transaction);
  both routes now delegate. `control/routes.test.ts` untouched and passing = canonical behavior
  unchanged. Idempotency: client key REQUIRED (400 `idempotency-key-required`), and because a def
  compiles deterministically the proposal is content-addressed, so a retry replays (200,
  `replayed: true`) instead of minting a second run + card set. `policyBaseCommit` +
  per-stage `policyHashes` now in the launch audit. Audit names unified to `control-*` with
  `source: workflow:<id>` as discriminator. `defs.ts` now REQUIRES every stage target to be
  `orgs/<project>` or below. workflows/routes.test.ts 5 → 13 tests (T3 stall w/ zero cards,
  activated 409, double-launch = one run, missing key 400, foreign origin 403, out-of-org target).
  KNOWN RESIDUAL (agent flagged honestly): compile.ts still derives `scope.write` from the same
  stage targets, so compiler.ts's widening comparison remains structurally self-satisfied for
  workflow-compiled proposals — the new org-tree CONTAINMENT check is what actually constrains
  capability there. Widening scope to the whole org tree to make the comparison "bite" would be
  strictly worse. The comparison stays meaningful for Composer-imported proposals.

### fyt-run-001 (the one authorized video: 2026-07-19-wells-fargo, ST-033 Wells Fargo)
Stages DONE, each with card Result on ops + cost ledger row:
- script `65a83e5` — 1,703 VO words, 11:21 est, 17 B-ROLL beats, staged writers-room + 3 critics.
- judge gate `8b93e56` — **GREENLIGHT 34/36**, fresh-context Opus, leash clean, ZERO revise loops.
- shorts+metadata `91e84ac` — 5 shorts (4 publish + 1 bench), metadata.json, ST-033 → `scripted`.
- shots+motion `2cb48e9` (staging) → merged to root `819fad5` by the CONDUCTOR (single-writer
  rule). 119 long-form shots, 168 total prompts, 3 thumbnails. Lints at root:
  `lint_shots.py` "HARD violations: none"; `lint_motion_plan.py` "0 error(s)".
- voiceover `9a692f8` — **assets/vo.mp3, 614.65s (10:14.6) MEASURED**, 6 chunks, 1,704 word
  timings, 0 monotonic violations. Probe: I -18.3 LUFS / LRA 3.6 / peak -0.8 dBFS (raw VO is
  CORRECT at this stage; build_motion.loudnorm_pass masters to -14.5 LUFS at render).
  **Spend: 5,344 chars ≈ $1.18.**
- audio-plan `9a692f8` (staging) → merged to root `739977f` by conductor. 17 SFX / 9 music / 15
  pauses / 1 dry span; lint 0 errors, 42 anchors resolvable.

**CONDUCTOR SCOPE DECISION (design F9 + cost discipline), recorded on the shots card:** image
generation this run = LONG-FORM + 3 thumbnails ONLY (~124 imgs ≈ $17 at gemini-3-pro-image 2K
$0.134). Shorts imagery (~51 imgs, +$7) DEFERRED. Envelope authorized was ~$15–30.

**IMAGE STAGE IS THE OPEN ITEM.** Commit `3e630a3` = "ST-033 Pass-1 character lock; **Pass 2
halted at spend gate**". The Pass-1 lock for the 3 new cast (kovacevich/stumpf/tolstedt) landed in
`assets/library/`. Scene generation did NOT complete. NEXT SESSION: read that commit + the agent's
own notes, confirm how much was spent, and decide whether to resume Pass 2 (still inside the ~$17
envelope) or park. Render CANNOT run without scene images.

## Human gates waiting on Daniel (cards exist on ops, brief now ranks them)
1. `6a5d6b23-12ddfee2` G1 GCP project + 5 APIs + **PUBLISH the consent screen** (kills 7-day token death)
2. `6a5d6b23-05204b15` G2 Workspace MCP OAuth run
3. `6a5d6b23-4c98aec0` G3 youtube-uploader authenticate
4. `6a5d6b23-17e8d1be` G4 analytics token (pairs with yt_analytics.py)
5. `6a5db96f-3c1e7a02` DRAFT governance amendment: canaries are human-promoted-only (Wave B debt)
6. `6a5dbf11-8e42a6d1` **wake-me: Telegram bot token UNUSABLE** — the credential in Windows
   Credential Manager (target `kb-telegram-bot-token`, user kb-bot, 96-byte blob) does NOT decode
   to a valid token shape under UTF-16 (the launcher's own decode) or UTF-8, and the Bot API
   returns 404. This blocks the Wave-A supervised first send AND means the desktop_poll cadence
   would fail silently every cycle once registered. Card carries exact `cmdkey` re-store steps.
   NOTE: the permission classifier BLOCKED deeper credential-decode probing; respected as substantive.
7. Executor activation (unchanged from arc-1) — still human-gated, do NOT attempt autonomously.
8. **Ear gate on the VO**: `.../2026-07-19-wells-fargo/assets/vo.mp3`. Listen at **6:58** (somber →
   "Cheery Monday" handoff, sharpest whiplash, 3.5s fade authored) and **1:33** (stacked silence on
   "The target was eight.").

## Project-doc conflicts found by stage workers (NOT fixed — other workers were live in that tree)
- `knowledge/stack.md` logs ElevenLabs as **Free tier (10k/mo, no commercial license)**; the account
  is actually **Creator, active, 124,755 limit** (42,570 chars remaining after this run). The stale
  doc would have blown the cap and produced a non-commercially-licensed master. NEEDS A FIX.
- `critics.md` #4 still mandates a human-cost `dry` span that `grammar-guidance.md` retired
  2026-07-17; the critic will keep emitting a wrong finding until reconciled.
- Shots budget assumed 687s vs actual VO 614.65s (~73s over; real pace 166 wpm). Not a defect —
  render-builder places on real `vo_ref` timestamps — but the motion plan was built long.

## DANIEL'S NEW MANDATE (2026-07-20, mid-session) — arc-3, NOT yet started
Verbatim intent, four parts:
1. **FYT repeatable**: turn the run into a repeatable workflow / an agent purpose-built to run the
   FYT pipeline — knows each step, can iterate on itself. (Partly exists: `.claude/agents/
   faceless-producer.md` + the new `video-run.md` def. Needs: lessons from fyt-run-001 folded in,
   resumability, self-iteration from prior run reports.)
2. **Runs UI**: runs laid out HORIZONTALLY so the FULL TEXT of each card is visible; click any card
   → its running details / terminal / code history. Same for workflows.
   **Daniel's own question, answered from the code**: a WORKFLOW is a reusable definition
   (`orgs/<project>/workflows/*.md`) that compiles to a proposal; a RUN is one execution instance
   (its own runRef/stages/attempts). Runs are runs of anything, including ad-hoc proposals that
   never came from a saved workflow. Same store → one shared detail surface should serve both.
3. **Agents UI**: click an agent in the sidebar → detail view IN PLACE (what it's for, how it's
   built, current tasks/runs, code history) with a BACK button. Does not exist today.
4. **External reach**: agents/workflows must not be kb-only — Gmail, Drive, Calendar, meeting
   notes, i.e. everything he'd do in Claude Desktop, set up as a workflow here.
   **HARD DEPENDENCY**: this needs the Google OAuth gates G1–G4 *and* executor activation, both
   human. Build everything up to the gate; it cannot actually execute until Daniel gates it.
Instruction on method: delegate to Opus-4.8-and-below subagents; codex task cards are a BACKUP if
context runs short; ensure cross-file consistency.

A read-only Explore agent was mapping the dashboard client UI at compaction time (surfaces,
unrendered server-side data, design-doc constraints). If its report is lost, re-run it — that map
is the input to the arc-3 UI design.

## Binding environment facts (unchanged, re-verified)
- `py -3` NOT bare `python` (MSYS python lacks yaml). Suites: `py -3 -m pytest tests -q` at
  fleet-arc root (497), and in `dashboard/`: `npm test` (1324 pass + 2 skip) + `npx tsc --noEmit`.
- GateGuard fact-forcing hooks block the FIRST Bash/Write/Edit of a file — present the facts it
  asks for and retry the IDENTICAL command. This is normal, not an error.
- Coordination writes → `dashboard-ops` worktree on `ops`, pull-rebase before, push after.
- `governance/` and `CLAUDE.md` are human-edited: changes ship as DRAFT cards, never direct edits.
- Media under `channels/*/videos/*/assets/` is untracked by the project's own .gitignore — correct;
  commit only text artifacts, explicit paths, never `git add -A`.
- **Model attribution caveat**: subagents were told to sign `Co-Authored-By: Claude Fable 5` but ran
  as Opus 4.8, so trailers on this branch's commits misattribute the model. Known; not rewritten.

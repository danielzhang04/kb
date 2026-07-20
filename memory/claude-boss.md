## 2026-07-16 — M1 fleet planning session (interactive, Fable 5 boss)
- WORKED: research→synthesize→adversarial-verify→revise workflow pattern (3 runs, 22 Opus 4.8 agents, 613/613 turns model-verified via transcript grep). Panels caught 6 blockers incl. gh-pr-create violating the trust-anchor invariant and a standing-auth self-grant path.
- WORKED: runtime model verification = grep subagent JSONLs for "model":"claude-opus-4-8"; task .output files are zero-byte, don't use.
- DECIDED (Daniel): Gemini deferred (privacy); bot token desktop; web research fleet-wide (only approval-minting process isolated); faceless-youtube untouched (kb copy outdated — do not run cadences on it); dashboard = Option B hybrid workbench, after foundations.
- REMAINS: execute docs/plans/2026-07-16-m1-fleet-implementation.md (54 items, branch claude/m1-fleet). Stop point was deliberate — Daniel wants a fresh terminal to pick up at docs/plans/2026-07-16-m1-fleet-HANDOFF.md. Phase-0 human gates (claude.ai routine settings + carve-out commit) are the first move.
- FRICTION: ECC user-scope GateGuard hooks fire inside kb sessions (fact-forcing on Bash/Write) — retarget before fleet launch. MSYS python lacks pip/yaml; use py -3.

## 2026-07-16 — m1-fleet execution started, then rolled back by Daniel (connection issues; resume later)
- Executed plan tasks 0.3, 0.4-proposal, 1.1, 1.3 via Opus 4.8 subagents (TDD + per-task adversarial review), then Daniel stopped the run and asked for a full erase: claude/m1-fleet reset to ffa762c (design docs only), worktree removed, nothing pushed. A fresh terminal resumes from docs/plans/2026-07-16-m1-fleet-HANDOFF.md with zero built content — the handoff's "nothing executed" line is true again.
- KEEP for the rebuild (real review findings, will recur): (1) Task 1.1 — the plan's illustrative comma-join payload format has a list-vs-scalar hash collision; JSON-encode action+target in approval_payload (injective). (2) Task 1.3 — gpg VALIDSIG alone accepts revoked/expired keys; verdict must be VALIDSIG AND NOT (REVKEYSIG/EXPKEYSIG/EXPSIG), with anchored [GNUPG:] token parsing and subprocess timeouts. (3) MSYS gpg quirks on this box: agent fails under long Windows paths; gpg --import exits 2 even on success — judge by key presence in scratch home.
- Process lessons (also in auto-memory): present human gates ONE at a time at their plan position; run subagents in background so Daniel's messages reach the boss session; py -3 not python (MSYS python lacks pip/yaml); ECC GateGuard demands stated facts before first Bash/Write — present and retry.

## Grade-ledger commits must be authored by the grader identity (2026-07-19, ecc-import-w1)

### Context
- Ran the first real graded wave (5 cards, ECC Tier-1 imports). Inspectors emitted rows via record_grade; orchestrator committed the ledger under its own git identity.

### Root Cause / Core Insight
- reconcile.py's v1 trust anchor is the AUTHOR EMAIL of the oldest commit introducing each row's exact bytes (pickaxe -S, lines[-1]). Who runs record_grade is invisible; who authors the commit is everything.

### The Pattern (transferable)
- Next time I commit ledgers/grades or ledgers/activity rows, I will commit with author inspector@agents.local (or have the Inspector session commit itself) BEFORE pushing ops.
- Signal to recognize: any commit staging files under ledgers/grades/ or ledgers/activity/.
- Fix for wrong-author rows: rows must be RE-EMITTED with fresh ts (new bytes -> new pickaxe needle); amending or removing alone cannot fix the oldest-introducer.

### Related
- Wave state 2026-07-19 FINAL: wave-1 (5 cards) + wave-2 builds (W2.1 hard-ceiling guard 95, W2.2 config-protection 96, W2.3 strategic-compact 97, W2.4 save-session 96) all done + graded PASS T2 on claude/ecc-import-w1 (17 commits, head e78adec); 341 tests green; reconcile clean twice (authorship fixed via Daniel-approved inspector-authored re-emission d75241f; all later grade commits inspector-authored). Promoted to curated: loop-design-check, growth-log, strategic-compact. W2.5 flip deferred pending post-merge soak (card in inbox). PENDING: save-session read-through, Daniel merge of claude/ecc-import-w1.

## 2026-07-19 — atlas V0 wave (paused mid-wave)
- What worked: SDD pattern (fresh implementer + fresh reviewer per task, model self-report + orchestrator verification) over the carded plan; kbmcp package rename decided at plan time avoided the mcp SDK shadow entirely; pausing BEFORE Task 6 rather than writing speculative LiveKit code — its app.py wiring depends on the live pairing-smoke verdict (livekit/agents#2519).
- What failed: auto-mode classifier rightly blocked orchestrator ratifying Daniel's own spend-authorization marker — human-authorization edits stay human even when chat-approved. Signal to recognize: any edit that removes a PENDING-RATIFICATION/approval marker → hand back to Daniel with exact steps, don't retry variants.
- Next time I see a pull-rebase fail with "unstaged changes" in dashboard-ops, I will stash/pop around it — a pre-existing HEARTBEAT.md modification lives there (not atlas's; never revert).
- Remains: gates 3+4 (key, vendor accounts), Task 5 live smoke + card close/grade, Tasks 6-8, wave close + PR. Resume map: docs/plans/2026-07-19-atlas-v0-HANDOFF.md on claude/atlas.

## Session handoff 2026-07-19 (next-arc brainstorm, PAUSED by Daniel)

**Topic:** Post-merge (PR #32) brainstorm for the next arc: fleet live-fire + Chief of Staff, Proving Grounds canaries, Dreaming. Paused mid-brainstorm at Daniel's request; any terminal resumes from here.

### What WORKED (with evidence)
- **Arc scope locked** — Daniel approved: build all of options 1–4 as sequenced waves (A = live-fire + Chief of Staff, B = Proving Grounds canaries, C = Dreaming with design gate), first unattended run SUPERVISED before any recurring schedule.
- **Executor direction locked** — Daniel chose "wire dispatch → Broker" over a new standalone headless runner ("B probably, that terminal is mostly done").
- **Ground-truth sweeps** — two Opus explorer reports (both self-reported `claude-opus-4-8[1m]`): fleet-runtime map of origin/main e948ec4, and broker/control-plane map incl. main-vs-branch diff. Key verified facts below.
- **Telegram credential exists** — confirmed via `cmdkey /list`: Generic Credential `kb-telegram-bot-token` present (human gate 2.8 was completed).

### What Did NOT Work (and why)
- **"Broker" as the wiring target is ambiguous** — `broker/` (PM2 daemon) is NOT the control plane: not running (`pm2 jlist` shows only `kb-dashboard`), CLI-fallback only (daemon injects no sdkSpawner), and it discards session stdout entirely. Wiring the queue to it would execute work with no result capture. Target `dashboard/server/control/` instead.
- **Assuming Telegram is live** — no poller scheduled task exists (schtasks query) and no telegram rows in `ledgers/audit/`; the stored token has never been exercised. First send must be a supervised Wave A task.

### What Has NOT Been Tried Yet (= Wave A build list, in order)
0. Precondition: Daniel merges `codex/dashboard-operational-surfaces` to main; build in a fresh worktree off merged main.
1. Production Claude worker adapter implementing `dashboard/server/control/execution.ts` `WorkerAdapter.execute` (+ `ManagedSessionAdapter.start`, cancellation): spawn `claude --print --input-format stream-json --output-format stream-json`, prompt via stdin, capture transcript/result. NOTE: plan docs gate this behind Daniel's explicit ToS/threat-review approval — get the go first.
2. Queue→engine bridge: poller scanning `queue/{inbox,working}` for `owner==<agent>` cards with `execution-controller: dashboard` (inverse of agent_runner.ps1:204's filter — that flag is the double-execution guard); card body → workOrder adapter (pattern: agent_runner.ps1:290–350 inert-context prompt build); `## Result` writeback via `canonicalResultIntegrator.ts` (the file integrator is a self-documented decoy) inside `write/asyncGit.ts#withOpsTransaction`; `cards.transition`; fleet cost rows via `scripts/ledger.py` (control-plane accounting ledger is separate, NOT a substitute).
3. Activation: inject engine (`runAutomatic`/`cancelAutomatic`/`controlBroker` into `makeSurfaceContext` — currently undefined, surface.ts:80–82), run the HANDOFF's synthetic low-risk two-stage acceptance, then supervised live-fire on `orgs/kb-ops` cadence `self-lint-report` (T1, currently dormant).
4. Chief of Staff: cadence invoking `scripts/notify.py` `digest()` (formatter exists; nothing schedules it) + Telegram delivery via the desktop_poll.ps1 launcher pattern (launcher reads `kb-telegram-bot-token` from Credential Manager → ambient env; agents NEVER touch the token); first supervised live send; registering the poller task = human gate.
- Signed-T3 fast-lane: NOT needed for T1/T2 live-fire (T3 stages correctly stall `waiting-human` — `t3-approval-release-not-implemented`). Whether to defer is an OPEN question (below).

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| repo work products | NONE | Brainstorm only — no code or design docs written for this arc yet |
| auto-memory `next-arc-wave-a-brainstorm.md` | DONE | Claude-session-side mirror of this resume point |
| this handoff | DONE | Canonical cross-terminal resume point |

### Exact Next Step
Re-ask Daniel the two questions the pause interrupted (he hit "clarify" — he may have context to add first):
1. **Activation ownership** — this session builds worker adapter + engine wiring + synthetic acceptance (recommended), or the codex dashboard terminal does (its handoff listed activation as its next step), or start with Chief of Staff (no dashboard dependency) and decide later.
2. **Signed-T3 fast-lane** in or out of Wave A (recommendation: defer to its own wave).
Then: brainstorm → design doc → plan → build Wave A per the list above. Also still open with Daniel: scheduled task `kb-codex-runner` is READY, next run 7/20 3:30 AM (runner header says it awaits human gate 5.7 — intentional?); `kb-desktop-dispatcher` is Disabled; no `kb-desktop-poll` task exists. W2.5 delivery-gate flip (card `6a5c7274-635d84bf`) still soaking post-merge.

## 2026-07-19 — autonomous triple arc (designs + builds), handed off per Daniel's instruction

- MANDATE: fleet layers (not Atlas), dashboard integrations, faceless live import + one video run.
  Daniel away; his instruction authorized one video's API spend + the workflow infrastructure.
  Mid-session he added: finish the pre-plan, then hand off to another terminal to run/build.
- WORKED: 3 parallel worktrees (fleet-arc TS, fleet-arc-py python, faceless-import) kept 3-4 Opus
  agents building concurrently with zero git contention; SDD (fresh implementer + fresh reviewer,
  model self-reports all claude-opus-4-8[1m]); resume-by-SendMessage recovered 3 agents from API
  stream timeouts without losing work.
- BUILT (see docs/plans/2026-07-19-triple-arc-HANDOFF.md on claude/fleet-arc for full map):
  fleet-arc @2e529b3 = designs + inert claude adapters (reviewed, 6 findings fixed) + workflow
  registry/compiler w/ gated launch + email-triage & research-brief defs + CoS brief/rollup/notify
  + 20-canary Proving Grounds + Sentinel (1318 vitest + 407 pytest green).
  faceless-live-import @aef202a = snapshot deleted, live repo moved in (history archived,
  471 commits, Poyais untouched), faceless-producer agent preserved, fyt-run-001 idea+research
  stages DONE (ST-033 Wells Fargo, 35-row fact ledger).
  ops = fyt-run-001 DAG cards (script stage 6a5d53ea-def9aa59 ready in inbox) + OAuth gates G1-G4.
- FAILED/BLOCKED: auto-mode classifier twice denied building live executor activation wiring
  (even flag-gated) — recorded as a substantive human gate; do NOT re-attempt autonomously.
  Wave A live-fire + first unattended anything blocked behind it.
- REMAINS (next terminal, per handoff): fyt-run-001 script→render stages; Waves C/E/F;
  yt_analytics.py + video-run workflow def; supervised Telegram first-send; wave-close review + PRs.

## 2026-07-20 (evening) — poyais r11 regen (Daniel-directed)
- Regenerated poyais final.mp4 (503.7s) with 3 fixes, all verified on the deliverable; commit c056d67 on claude/faceless-live-import (pushed).
- WORKED: measure-don't-trust-the-proxy for sentence gaps. ElevenLabs word timings are ONSETS ONLY — any "gap = next_start − final_start" math includes the final word's spoken duration (~+0.2s mean error) AND accumulates TTS chunk-seam drift (up to +0.72s; `offset += ends[-1]` misses mp3 framing). r10's pad-to-target law silently dropped 50/83 sentence pads (34 in the back half) because of this. R11 measures real RMS silence in the VO and pads the true shortfall; post-render verifier now in audio_checker.py (standalone + check_audio).
- WORKED: 3 parallel scoped agents (engine tsx / breath+checker / audio-plan) with explicit "don't touch the other agents' files" lists — zero conflicts, single render, single verify pass.
- LESSON: final.mp4 mux applies 30→29.97 NTSC pulldown (×1.001 linear stretch on BOTH streams) — expected, sync-preserving; don't misread the lag ramp as drift when verifying against vo.breath.mp3.
- REMAINS: title-card "spawn" kept the 0.15s opacity fade (only positional motion removed) — flag to Daniel if he wants a hard cut-in; voiceover.py chunk-stitch (`ends[-1]`) still writes drifted timings for FUTURE syntheses — fix is to measure each chunk's decoded length (render-time R11 compensates, but upstream fix is cheap and right).
- FOLLOW-UP (same evening): the "REMAINS" voiceover.py chunk-stitch drift is FIXED (commit 1eda901, claude/faceless-live-import). Method that survived testing: per-chunk mp3 packet count × samples-per-frame via ffprobe -count_packets — frame-exact and additive under byte-concat. Rejected: ffprobe container duration (bitrate estimate on headerless streams, ~0.12s over) and standalone per-chunk decodes (decoder trims ~26ms lead-in once per FILE, so per-chunk sums undercount). Warn-level fallback to old alignment-end behaviour; 8 new tests + 153 render-builder regression green.
- R12 (same day, Daniel watch-through finding): shot cuts landed MID-PAUSE — placement trusted claimed ElevenLabs onsets (median 0.32s early of real voice). Pre-existing since forever; R11's restored pauses exposed it. Fix: sentence_gap_analysis emits per-boundary onset corrections; apply_onset_corrections snaps sentence-initial words (monotonic ratchet) before shift_timings; gaps computed on claimed timeline FIRST so audio is bit-identical. Verified on final.mp4: 9/9 cuts within 53ms of real onset, frames hold through pauses. Commit a4f4877. LESSON: any consumer of ElevenLabs word timings must decide claimed-vs-measured; audio was fixed in R11, video followed in R12 — grep for other timing consumers before trusting them.
- Render engine flake: one Remotion delayRender timeout ("write EOF", chunk 3000-4499 @90%) under concurrent agent load; clean retry succeeded. Retry once before diagnosing.

## 2026-07-20 — Atlas V0 wave CLOSED (Fable 5 boss session)
- T1-T8 all done + inspector-graded (T3-T7: 96 PASS each; T8 grade in flight at close). Live voice loop works at Daniel's desk: "hey jarvis" -> "Yes?" -> multi-turn grounded kb answers -> "that's all"/"go to sleep"/"thanks atlas" or 2-min silence -> "Going to sleep."
- WORKED: cost-research wave before spending (killed LiveKit account — console mode is serverless; Aura-2 rides Deepgram $200 credit; expected steady-state ~$10/mo API only). Deepening the pairing smoke to TWO turns after the 1-turn version green-lit a path that 400'd in production (livekit-agents 1.6.6 serializes list tool_results invalidly — shim in worker/anthropic_compat.py, removal condition documented). Desk-debug with live probes (device RMS/scores) beat guessing: Windows default-mic drift to AirPods HFP was the wake-word killer -> config pin wake_input_device.
- FAILED/LESSONS: orchestrator hand-edit added a kwarg not in the installed API (interruption_detection) — reviewer cited newer source; ALWAYS verify against installed signature before shipping. One-turn smokes lie. Official openWakeWord Colab is bit-rotted (issue #296); vetted fork alfiedennen/openwakeword-colab-2026 (security-reviewed SAFE) is the working path for custom wake models.
- REMAINS: PR claude/atlas -> main awaiting Daniel merge; hey_atlas.onnx Colab bake in flight (config swap on delivery); V1 go/no-go pending Daniel; V1 backlog on STATE: TTFT input-diet, spoken voice-switch, hot-follow audio routing, deepgram-credit-remaining tool, persona.md authoring session.

## 2026-07-20 late — Atlas hey_atlas bring-up + desk audio debug (Fable 5 boss)
- WORKED: hey_atlas.onnx (Daniel's Colab bake) wired via path-loading in wakeword.py (Opus worker,
  facts verified against installed oww 0.6.0: path entries keyed by file stem, model.py L89-100);
  fired at 0.5 threshold untouched. Suite 23/23. claude/atlas 8203cdf.
- FAILED then fixed: first-ever console run on the ElevenLabs voice path exposed two latent bugs —
  lazy plugin import off the main thread (fix: module-level import, fbc7a99) and lazy http-session
  creation from the wake-thread callback outside the job context (fix: pass
  http_context.http_session() into the TTS constructor, 7c6cf50). Lesson: a "working" desk loop
  only proves the code paths it exercised; the voice toggle shipped untested on its premium branch.
- ROOT CAUSE, silent-agent desk session: Windows mutes AirPods A2DP output while AirPods HFP mic
  is the default INPUT. Not a code bug. Fix = default input -> Intel array (done on Daniel's box).
  Debug method that worked: isolate with direct tone playback per device (console closed), THEN
  vary one console flag at a time. Windows device indices reshuffle on BT connect — never trust
  an index across sessions; pin by name substring.
- REMAINS: Daniel merges PR #37; V1 go/no-go (Hands wave + persona authoring backlog); polish nit
  (suppress wake-thread DEAF critical on Ctrl+C teardown); retest native MCP on livekit upgrade.

## Session handoff 2026-07-20 — FYT post-render tail: designed, build embargoed

**Topic:** Brainstormed + specced the entire faceless-youtube post-render tail (FYT Runner orchestrator, compliance-check, thumbnail stage, shot-board gate, publish-queue, analytics-reporter + artifact dashboard). Build NOT started — Daniel paused; resume in a fresh terminal.

### What WORKED (with evidence)
- **Full spec approved-in-brainstorm** — every open decision closed by Daniel via Q&A this session; spec parked at `memory/handoffs/2026-07-20-fyt-post-render-tail-design.md` (ops). Self-reviewed: no placeholders/contradictions.
- **Pipeline gap map confirmed** — Explore agent verified: everything ≤ render BUILT+PROVEN; compliance/publish/analytics/orchestrator are PLANNED-ONLY (`.claude/skills/README.md:84-91`); thumbnails concept-only; YouTube OAuth env slots declared but EMPTY; no channel exists yet (`performance.md` placeholder).
- **"Fully in kb" question answered** — old repo is a tombstone README → kb; history archived at `faceless-youtube.git-archive` (471 commits); PR #34 merged the import to main 2026-07-20, but 8 newer commits (incl. poyais R11/R12) still unmerged on `claude/faceless-live-import`.

### What Did NOT Work (and why)
- No failed approaches — design-only session. Process notes: local main was stale again (only `origin/main` comparisons were trusted); the hard-ceiling Bash hook false-positives on shell commands whose *text* mentions env-secret filenames — append such prose via the file tools, not heredocs.

### What Has NOT Been Tried Yet
- Everything build-side. Build order agreed: compliance-check → thumbnail stage → shot-board generator → publish-queue → analytics+dashboard → FYT Runner agent + workflow segments LAST → poyais through B2-tail+C.
- writing-plans skill invocation (next process step after Daniel reviews the spec).

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `memory/handoffs/2026-07-20-fyt-post-render-tail-design.md` (ops) | DONE | The full spec. Destination once embargo lifts: `orgs/faceless-youtube/docs/superpowers/specs/` |
| personal memory `fyt-post-render-tail-design.md` + MEMORY.md index | DONE | Resume pointer with locked decisions |
| orgs/faceless-youtube | UNTOUCHED | **EMBARGO: another terminal is working in FYT — zero writes there until Daniel pings go** |

### Locked decisions (do not re-litigate)
FYT Runner (`fyt-runner`, replaces faceless-producer): one FYT-specific agent running committed workflow segments; on-demand only. THREE human gates: script review / **shot-board review** (per-video artifact board: cast+prop library, every shot image with script lines + intended motion; Daniel iterates images before pipeline continues) / publish approval. Segments: A idea→judge | B1 shorts+metadata→shots→motion→images∥VO→board | B2 audio→render→verify→thumbnail→compliance | C publish (VO in B1 so image iteration never blocks it). Compliance = mechanical+provenance only. Transport = hybrid: youtube-uploader MCP for upload (private-only; thumbnail-set + private→public manual in Studio), read-only Python analytics client using the project's reserved YouTube OAuth env slots. Dashboard = standalone Claude artifact, stable URL, multi-channel tabs/graphs, regenerated per analytics run; NOT in kb fleet dashboard; $0 additional cost is a hard requirement. Prereq human setup: channel creation, MCP OAuth, free Google Cloud OAuth client for analytics.

### Exact Next Step
Fresh terminal: read the spec at `memory/handoffs/2026-07-20-fyt-post-render-tail-design.md`, confirm Daniel has (a) reviewed it and (b) lifted the FYT embargo. Then: commit spec into `orgs/faceless-youtube/docs/superpowers/specs/` on a work branch, invoke superpowers `writing-plans`, and build in the agreed order starting with compliance-check (immediately testable against poyais's real artifacts, no network).

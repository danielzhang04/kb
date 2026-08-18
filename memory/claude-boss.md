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

## 2026-07-28 — Visual-stack trim wave (boss session)
- WORKED: one Opus worker for coherence-coupled rewrites (4 files) + Sonnet for disjoint tasks; SendMessage follow-up to the SAME resumed worker for the dedup pass kept its context and cost far less than a fresh brief. Fresh-eyes comprehension probe (answer 6 doctrine questions from trimmed files only) is a cheap, decisive acceptance gate for doc trims.
- LEARNED: plan line-budgets for doc trims underestimate protected content (slugs/hex/caps/enforcement) by ~30-40%; set budgets as caps-with-priority ("terse-and-complete wins") and grade by dedup review, not counts. Workers left single-home violations on the FIRST pass even with the map in the brief — the dedup check is the boss's grading job, every time.
- LEARNED: model verification failed until bound to an action (grading) — fixed in BOSS.md (PR #98); the harness task .output file greps empty for model ids, use ~/.claude/projects/<proj>/<session-id>/subagents/agent-<id>.jsonl.
- LEARNED: relative hook commands in kb/.claude/settings.json silently disabled ALL governance hooks for sessions launched in subdirs (fixed: absolute paths, PR #98). Symptom was only Stop-hook error spam.

## 2026-07-28 — Wave-2 audio/motion trim (boss session)
- WORKED: parallel Opus(coupled cluster)+Sonnet(disjoint periphery) after a serial archive-harvest task; both briefed on each other's file ownership — zero collisions in content. Comprehension-probe acceptance gate again decisive (7/7, zero gaps).
- HAZARD (real, benign this time): a parallel terminal SWITCHED the shared checkout's branch mid-wave (fyt-writer-grammar-slim -> hidden-machine-genesis, cut as a descendant); later boss/worker commits silently landed on the new branch, and one worker's staged git-rm was swept into the other terminal's commit. Nothing lost (descendant branch, disjoint files), but: check `git branch --show-current` in EVERY commit command block, and expect staged-path sweeps when another terminal commits — stage explicit paths immediately before committing, never park staged changes.
- LEARNED: already-lean stacks yield ~15%, not wave-1's 45% — set spec totals from measured per-file floors (enforced contract lines), not from a uniform percentage; say so in the spec's "honest scale note" up front.

## 2026-07-28 — Wave-3 visual-pipeline redesign (boss session)
- WORKED: function-change waves need the AUTHORING probe, not the recital probe — a fresh agent producing a valid v2 fragment from a cold paragraph caught nothing missing and proved the doctrine teaches. Two parallel Opus workers with a plan-level ownership map + read-source-from-HEAD-before-sibling-deletes instruction = zero content collisions across a doctrine/code split.
- WORKED: probe-before-design (grep forge.py for blockquote_after) settled the "can the bible shrink" question in one command — descriptors are runtime config, everything else movable.
- HAZARD: hard_ceiling_guard blocks ANY command string containing .env — including containment deletes and even ls|grep. Correct move both times: hand the one-liner to Daniel via `!`, never route around via PowerShell tool. Also: a worker spilled a byte-copy of .env into a channel folder via a mangled redirect (untracked, contained same-session); watch for Users*-mangled filenames after parallel waves.
- LEARNED: when Daniel says "match my cut instinct", the lever is deleting LAWS and moving enforcement to checkers — not compressing prose harder. His template answer ("use the scripting work split as a guide") resolved three design questions at once; ask for the analogous structure before asking component questions.

## 2026-07-31 late — review night: rearchitecture + the "each round finds real HIGHs" signal

- HELD THE DISCIPLINE Daniel prompted: he asked "did we code-review the merge?" — we hadn't. A fresh adversarial review of a green-harness branch (PR #109) returned DO-NOT-SHIP with 4 HIGH, 3 boss-reproduced. LESSON restated hard: a passing live harness proves the HAPPY PATH; it cannot reach forged markers, glued modals, or false-engagement. Builder-green + boss-read is NEVER review-clean. Two rounds, two DO-NOT-SHIPs, each with real HIGHs.
- MARKER FORGERY was structural, not patchable: an agent legitimately knows its own completion token (reads it from the order file), and the marker regex allowed quote/list prefixes, so CUP->newline let prose land a forged DONE at line start (boss-reproduced with the real matcher). Daniel ruled REARCHITECT: completion moved off the parsed terminal entirely onto a server-owned, per-delivery, token-bound, cleared-before-each-delivery status file; terminal text is now inert for completion. The artifact-delta gate stays as the real backstop (a forged DONE that promised files still parks).
- PATTERN worth keeping: the roster delivery/engagement seam is the hardest part of the system — 5 bugs from live runs, then 9 more from two reviews (variadic --mcp-config swallowing the prompt; cross-agent status forgery under auto-mode bash; a same-agent Promise.all lease race; busy-marker split across pty chunks; junction-through-rmSync). When a seam keeps yielding HIGHs, stop patch-and-re-review (that spins) and go to a cleaner DESIGN: Daniel approved a server-minted boot-ready handshake to retire the footer-scraping engagement heuristics wholesale.
- RULING (cross-agent forgery): ACCEPT as known limitation — cooperative same-user agents of ours, artifact-delta gate backstops it. Document the residual; do not build isolation/IPC. The altitude call: don't harden against an attacker in a threat model that doesn't have one.
- GOTCHA (my own): `git checkout -q <path>` to "discard" restored an UNTRACKED handoff to 0 bytes (path existed on disk, not in the branch) — nearly lost the handoff. Never `git checkout <path>` to clean an untracked file; it truncates. Rewrote from context.

## 2026-07-31 — roster native-handle wave and live-rerun preparation

- WINDOWS PATH SECURITY: a component-by-component `lstat`/`realpath` check that returns a pathname is
  still unsafe; the later read/write/delete can follow a junction swapped after validation. For
  security-sensitive mutable paths, the useful primitive is a rooted `NtCreateFile` with
  `OBJ_DONT_REPARSE`, followed by I/O and deletion through that same handle. Node-only retained leaf
  descriptors cannot safely reopen atomically replaced receipts or verify initially absent artifacts.
- REVIEW EVIDENCE: native filesystem calls can return `STATUS_ACCESS_DENIED` solely because the Codex
  managed sandbox blocks traversal. Reproduce elevated before calling it an ABI/product defect. Here,
  focused native+roster tests passed 88/88 and a direct elevated rooted-handle probe passed.
- SUITE TRIAGE: when a broad parallel suite times out unrelated tests, rerun those files alone and
  compare every failed test/target file to the patch baseline. Two timeout files passed 123/123 alone;
  one unchanged baseline assertion remained. This preserved useful full-suite evidence without
  expanding the repair wave.
- HARNESS PINNING: a live harness that imports server code from a disposable worktree must verify the
  exact clean reviewed HEAD before state mutation or daemon launch. `--preflight-only` caught the stale
  `9d0e3bc` operand before spend; retarget/build then made the same preflight green at `051de9e`.
- THREAT-BOUNDARY WORDING: artifact delta/link checks prove safe current filesystem state, not which
  same-user process authored it. When the human accepts same-user cross-agent forgery, document that
  attribution limit precisely; do not say artifact stages establish identity and do not silently grow
  the wave into IPC/accounts/ACL isolation.

## 2026-07-31 — Qualitative behavior corrections need a cold authoring probe
- A VPW change intended to slightly reduce anonymous character-led shots coupled a useful binary cast rule to “humans are expensive” and figure-share pressure; the resulting full plan swung to 78% cast-free shots, omitted a named founder on his beat, and produced zero stage chains.
- Root cause: the policy optimized a population proxy instead of selecting the narrative subject, so a local preference became a global bias and masked continuity loss.
- Next time I will preserve valid structural constraints, replace one-sided population language with a two-sided semantic check, and run a clean 60–90 second authoring slice before paying for a full rerun.
- Signal to recognize: a sharp population-distribution swing, story-bearing identities hidden behind objects, or recurring settings collapsing to independent frames.
- Do not add governance prose for isolated shot-taste misses already covered by existing rules; repair execution and collect another sample first.


## 2026-08-04 — pearlman codex-only re-run (boss session, paused mid-Phase-3)
- WORKED: full pipeline stage chain via dispatch-codex terra workers (research dossier with revised evidence-backed angle, script, metadata, §3d passes, proxy-judge) — every stage graded by boss with artifact evidence (lint --wpm 171, banned-claim greps, dup-phrase greps) before commit. Proxy-judge advisory REJECT (CJ-001 reportorial register) correctly caught what artifact checks can't — the judge stage is worth its cost, run it before every human gate.
- FAILED: dispatch-codex --follow-up for a writing task — resumes at REPO ROOT (only the model is re-pinned, not cwd), worker edited the MAIN checkout's old file and blended refuted claims in. Contained same-session (main restored byte-identical via git show HEAD:path + Write; auto-mode classifier blocks git checkout -- compounds). RULE: follow-up = read-only Q&A; writes = fresh dispatch with --cwd. Durable fix owed: persist cwd in threads.json.
- LEARNED: artifact-level grading (lint/leash) does NOT prove process execution — the first script worker skipped the humanizer + critic passes invisibly. Briefs must FORCE process artifacts (per-critic findings file); grade the process record, not just the output.
- LEARNED: workers pad word-count floors by repeating facts; boss dedup grep is mandatory every pass (memory rule confirmed 3rd time).
- HANDOFF: handoffs/2026-08-04-fyt-pearlman-rerun.md (ops). Rewrite worker (codex-deep) was LIVE at pause — harvest per handoff even if its card lands FAILED: orphaned.

## 2026-08-04 — bricks middle-path wave (boss session)
- WORKED: root-cause-over-re-roll law (Daniel-ordered, codified in image-gen SKILL retry
  section) — L28/L60/L66 passed first attempt after 3 eras of blind re-rolls once the actual
  mechanisms (co-planar authoring, false seed-role labels, tier contradictions) were removed.
  Differential analysis of WORKED-vs-FAILED logged requests beats theorizing.
- WORKED: probe-before-doctrine — 7-way style-anchor probe ($0.94) killed the swatch-card design
  Daniel doubted and proved hardened descriptor text; his skepticism was evidence-confirmed.
- FAILED: my round-3 "author simpler" directive caused the empty-scene regression Daniel hated;
  simplifying AWAY story content to dodge gen failures is never the fix — the occupancy law now
  forbids it. Also: gen-lane briefs said "§3 rig verdict" only — the skill's three-axis review
  (incl. style) existed and my briefs skipped it, so style drift shipped as PASS for two rounds.
- LESSON: boss diff-verifies every VPW leg vs HEAD; workers miscounted twice (L79 orphan-seed
  edit, stale-base recount). Codex sandbox cannot write .git anywhere — boss does git plumbing,
  workers do file content.
- RESUME: handoffs/2026-08-04-fyt-bricks-middle-path.md (board verdict gate on 14 flags is the
  next Daniel touchpoint).

## 2026-08-04 (late) — drift audit + handoff refresh
- Daniel rejected the B4/B5 "57 clean" framing wholesale; codex-deep audit (VIDEO/scratchpad/audit-drift-2026-08-04.md) root-caused: contradictory style doctrine (soft-cel text vs hardened no-gradient block), smooth STEP-1 seeds, review false-passes, authoring omissions (no seat support, no place ownership, named cast in generic beats). Chain depth only PROPAGATES, roots drift too.
- WORKED: giving the auditor Daniel's verbatim defect list as ground truth + demanding per-defect mechanism AND fix; one deep worker beat parallel shallow ones for synthesis.
- LESSON: review gates that emit aggregate "rig holds" sentences pass the same eye-geometry defect repeatedly; force per-invariant verdicts with canonical side-by-side crops.
- LESSON: a genlog "style concern" note that never maps to a FAIL axis is a ratchet for drift — every review axis needs a fail condition or it is decoration.
- REMAINS: Daniel gate on ~$4.12 fix list; handoffs/2026-08-04-fyt-bricks-middle-path.md rewritten as the drift-audit pickup.

## 2026-08-05 — dashboard UX overhaul, 7 phases built through (boss session)
- WORKED: spec→plan→7 phases each as ONE opus/sonnet subagent with explicit ownership maps (files owned / files forbidden), boss re-running every verification before committing explicit paths; parallel P4+P5 with disjoint maps had zero collisions. Handoff = handoffs/2026-08-05-dashboard-ux-overhaul.md.
- WORKED: adversarial deletion pipeline — read-only scout inventory → opus refuter re-verifies EVERY item against the post-change tree → refuter writes an executable line-exact manifest (committed as evidence) → separate executor forbidden to improvise → boss gates ambiguous items to KEEP. Refuter saved 3 would-be-deleted live contracts (auth/challenge.ts = cross-language conformance mirror w/ zero importers BY DESIGN; staged-scaffold catalog.ts; GET /api/approvals security-test probe) and found a 456-LOC cascade the scout missed. "Zero importers" alone is NOT a delete verdict.
- FAILED: trusting vitest pass-count as green — P4's suite passed 534/534 WITH 2 uncaught render exceptions ("Errors" line + exit 1) from a blanket fetch mock feeding the wrong body to a post-write refetch. Grade the Errors line and exit code, not the pass count; blanket mocks must be route-aware.
- FAILED: PowerShell piping (`2>&1 | Select-String`) mangles native exit codes, and `git commit -m` with embedded quotes shreds argv — always `git commit -F <file>` and read $LASTEXITCODE unpiped.
- LEARNED: model-verification grep also surfaces NESTED spawns (worker's own Explore subagents show as extra "model" lines) — read the odd line's context before flagging; a lone sonnet line inside an opus transcript was its legitimate sub-Explore.
- LEARNED: mid-stream API-stall kills of background agents are cleanly resumable via SendMessage IF the resume message orders "re-read disk state first, don't assume your edits landed".

## 2026-08-05 — bricks doctrine-reset: per-fifth authoring + gate (session 1b21aff8)
- WORKED: one fresh opus agent per VPW fifth (skeleton + locked-prefix + lessons-log carries continuity;
  byte-identical prefix check per fifth caught nothing but proves the lock cheaply). Whole-file adversarial
  pass after assembly found 24 real defects the per-fifth acceptance missed — the seam/whole-file review is
  NOT optional. Verify pass on the repair found 1 ripple (stale provenance note) — repair-then-verify pays.
- WORKED: root-causing a recurring visual defect to PINNED DOCTRINE (registry costume text authored the
  "USB" badge; pixels alone would have resurrected it). Check the registry/doctrine text before blaming drift.
- FAILED twice: big agents die mid-run (529/stall) — disk-incremental reports + SendMessage resume with a
  re-anchor listing recovered both at $0 lost. Always demand incremental writes; always reconcile disk state
  in the resume message. A stalled 600s agent usually gorged on one oversized read — cap reads in the brief.
- GOTCHA: worktree kit mirrors go stale (registry predated the de-badge commit; a repair worker would have
  re-introduced the defect). Sync worktree kit files from main before any worker that reads them.
- REMAINS: Daniel's 6 board rulings → C-6 stamp (forge refuses all 51 staged figures until stamped) → 1/10
  gen. Handoff: handoffs/2026-08-05-fyt-bricks-doctrine-reset-gate.md.

## 2026-08-06 — dashboard UX live-feedback + session-console waves (boss session, same arc)
- WORKED: Daniel-in-the-loop live iteration — live daemon on real state + real repo, every fix wave verified in his actual browser flow before commit. Three waves in one night, all opus workers, all transcript-verified, zero worker collisions once ownership maps included sibling exclusions.
- WORKED: design-analysis-before-build for the session-console wave — the read-only opus analysis proved a chat run must NOT be a control-plane run (proposal-hash pinning + no closed-tab transition + no PTY auth path), which prevented wiring chat into the governed state machine. Analysis cost ~15min, saved a rebuild.
- FAILED/LESSON: unit-green ≠ live-working, three separate times — spawn (fake pty PATH-resolved, conpty doesn't), graph (jsdom has no layout; reactflow needs explicit height AND fitView minZoom room), model/effort (child inherits operator CLI config unless flags passed). RULE: any feature touching spawn/layout/config gets a LIVE empirical probe in its acceptance, not just suites.
- LESSON: --version validates no CLI flags; only a real session round trip proves a --model/--effort argv.
- LESSON: session TTL defaults bite silently — the "auto-logout bug" was a designed 5-min TTL nobody surfaced to the operator; surface the TTL in the UI chip (done: expires-in) and in briefs.
- LESSON: classifier blocks state-changing commands mid-arc (pm2/taskkill/daemon start on prod state); the `!` handoff pattern (exact command + immediate boss verification after) kept flow with Daniel present.

## 2026-08-05 later — era-restoration wave (session 1b21aff8, handed off mid-remint)
- LESSON (near-miss): a worker restoring era text from git SHAs regressed a DATA file wholesale —
  registry.json came back era-vintage (de-badge reverted, new cast entry gone) and my bulk port copied it
  to main. Caught by reading the ported diff. Rule: after porting worker output, diff every DATA file
  (registry, manifests, json stores) against git HEAD — byte-guards on the target file are not enough,
  guard the NEIGHBORS the worker had no business touching.
- WORKED: mechanism archaeology over image-gazing (Daniel's ruling). "How did the old system produce it"
  beats "what does the old output look like" — the era suffix had silently stopped being appended AT ALL,
  which no amount of output-description would have found. Also: check the RESOLUTION (2K vs 1K) before
  comparing line weights — same stroke, different instrument.
- WORKED: boss adjudication under "don't delete good stuff / don't keep bad stuff": delete = evidence of
  failure or contradiction with the proven target; keep = cheap guards that would have caught the drift
  (one review row, one lint term); era text wins genuine ties.
- Handoff: handoffs/2026-08-05-fyt-bricks-era-restoration-remint.md (remint worker in flight at handoff).

## 2026-08-06 — bricks p6b first tenth (boss session, Fable 5)
- WORKED: incremental genlogs (F-agents law) made THREE worker mid-stream deaths zero-loss — every
  resume was reconcile-from-disk, never re-generation. Pattern: dead worker -> tail its genlog + ls
  staging by mtime + read its transcript tool calls -> fresh finisher with a "state you inherit" brief.
- LEARNED: SendMessage-resume of the same worker is cheap and context-rich until ~200k tokens, then it
  stalls mid-stream (2/2 died past that). Retire workers before that; hand remaining scope to a fresh
  finisher with the genlog as its brief.
- WORKED: changed-mechanism re-mint (original slate under a fixed generator) fixed colour+composition in
  one call where two prompt retries each broke a passing attribute. Route generator-side defects to the
  generator fix + re-mint, never to more prompt words. Converse also held: two staging misses (L10
  queue, L25 lettering) resisted two explicit prose corrections each — mechanism, not prose.
- LEARNED: provider 503 outage handling that worked — stop after one re-issue, bank all state, arm a
  45-min background sleep as a cooldown timer, resume with a single cheapest-call canary before
  touching the queue.
- LEARNED: don''t hand-roll a skill tool''s input schema from its docstring (fumbled forge manifest
  entries-vs-spec); the worker who ran the flow holds the schema — send the mechanical close to it.
- LEARNED: grade-the-brief: a worker caught MY ruling-count error (R4 miscounted as plain pass) by
  checking decisions.md instead of trusting the dispatch. Write briefs that cite the record, and expect
  workers to check it.
- MODEL RECEIPTS: all 7 workers/verifiers model-grepped first line (6 opus, 1 sonnet builder), 452
  tests green at R1, all spend ledgered (remint $0.546, R1 $0.05, p6b $1.872; wave ~$7.0/$40).

## 2026-08-06 late — cloud-migration build session (boss on Fable 5, codex-exclusive workers)
- ARC: kb→Linux-VM/Tailscale migration specced+planned+built in one evening; branch
  claude/cloud-migration (8ebc337) holds waves 1a-1d complete; parked at Daniel's Wave-0
  gates (SSH key, provider, order). Handoff: handoffs/2026-08-06-cloud-migration-wave0-gate.md.
- LEARNED: codex sandbox blocks git file:// transport — reconciliation/synthetic-acceptance
  suites FAIL inside workers but pass locally. Grade by LOCAL rerun; tell workers to skip-and-say,
  not to debug their sandbox.
- LEARNED: a KILLED dispatch may have FINISHED its work — the 1d3 repair orphan died in its
  verify phase with all 40 tests already green in the tree. Test the partial state before
  re-dispatching; saved a full re-run. (Marker+log mtime tell the story: files stopped changing
  1 min before death.)
- LEARNED: subsystem-retirement over-deletion pattern — surfaces that MERGE the retired thing
  with kept features (WorkflowDetail Runs tab merged PTY session-runs + governed runs) get
  wholesale-cut by workers. Brief retirements with an explicit KEEP list naming the merged
  surfaces, or expect a repair wave.
- LEARNED: full-suite parallelism load-flakes (canonicalResultEmbeddedPython, queueBridge tick,
  authorizedFailedRunReconciliation, store tampering, synthetic-acceptance) — all pass isolated.
  Never chase these under full-suite load; verify isolation FIRST.
- LEARNED: pre-existing main defect found by 1b acceptance: workflowRun.test.ts asserted the
  pre-routing-doctrine agent_runner filter string — cross-file consistency tests go stale
  silently when the ps1 side changes on ops/main out-of-band. Fixed on the cloud branch.
- DOCTRINE (Daniel, this session): pilot-first cloud spend (~$20 hourly-billed before monthly);
  API-key relaxation IN PRINCIPLE for capped glue (subscription stays primary — 5-20x cheaper);
  Atlas included via browser-tab audio (open tab ⇒ listening, AudioWorklet not timers);
  PTY retired for good; platform verdict = keep homegrown (memo in docs/research/).

## 2026-08-07 — Cloud Waves 0+1-final executed on the pilot VM (boss session, Fable 5)
- WORKED: probe-before-dispatch on live-system bugs — a 15-line spawn probe on the VM proved the
  claude-CLI stdin-EOF root cause in one shot after two harness reruns only narrowed it; the fix
  brief then took a terra worker 174s. Same pattern found the kbStateDir path drift (snapshot a
  harness's throwaway dirs DURING the run when its failure path deletes evidence).
- WORKED: Tailscale SSH (`tailscale set --ssh`) gives the boss keyless VM access with no key files
  and nothing credential-shaped handled — the enabler for "go do it yourself" on cloud boxes.
- NEAR-MISS (rule already in memory, almost violated anyway): dispatched a WRITING follow-up with
  --follow-up; it resumed at REPO ROOT beside another terminal's live uncommitted bricks work.
  Killed via the pending-marker pid (pending/*.json names parent + codex pids) and redispatched
  fresh with --cwd. MSYS bash mangles `taskkill /PID` — kill through PowerShell.
- LEARNED: worker sandboxes can't validate everything — codex workers hit NTSTATUS ACCESS_DENIED
  on native-handle tests and blocked SSH; their "unverified here, not falsely green" reports were
  GOOD outcomes. The boss owns the real-Windows and VM verification loops; both worker diffs were
  clean on real hardware.
- LEARNED: acceptance harnesses rot where resolvers evolve — the Wave-1b state-dir resolver append
  and the CLI 2.1.224 stream-json EOF contract both broke assumptions the desktop never tested.
  Green desktop Wave-A is not evidence for Linux; run the harness ON the target.
- LEARNED: the governed-worker child env denylists the subscription token variable BY DESIGN — a VM
  needs the CLI's persistent home-dir login (human runs /login once); vm_verify passing a direct
  `claude -p` does NOT prove spawned workers can authenticate.

## 2026-08-07 — bricks 6c2 slice driven to machine limit (boss session)
- WORKED: takeover-of-a-possibly-live-checkout protocol — an 8-min quiescence Monitor on _staging/scratchpad before seizing; the prior terminal had minted files 3 MINUTES before I looked. Never trust "the other terminal is probably dead" without watching writes stop.
- WORKED (3rd confirmation): changed-mechanism re-mint beats prose retries — "quilted" noun beat two escalating negative clauses; stripping the adjective at derivation fixed it first-try. Worker's hash-churn catch (strip at figure_card_payload, not costume_clause which feeds costume_key) saved a silent full-cast re-mint; grade briefs should ask "what does this change invalidate?".
- WORKED: two disjoint fresh-eyes verifiers writing per-worker files + ONE stamping pass as single writer of review.json/manifest — zero races across 4 verification rounds. Also: bounded background re-driver loop (cycle-and-check, exit-on-success) rode out a ~50min provider outage without burning worker context.
- LEARNED: prompt-instruction taxonomy with numbers — CONTENT instructions (objects/states) landed 8/8; TONE/SCALE/SPATIAL ones measured no-op or wrong (warm-ink ×3 no-op, children track the SEED's ink not prose). Route correctives as objects+states; relative-position beats need mechanism, not adjectives.
- LEARNED: assets/** is gitignored in faceless-youtube — scene PNGs are machine-local, manifests carry shas. My ede2f56 commit message wrongly claimed "21 PNGs promoted" as commit content; check `git check-ignore` before writing a commit message that names binaries.
- LEARNED: verify-worker diagnoses can be worth more than verdicts — L34's fail proved a SPEC GAP (seed_roles lacks expression authority; same spec resolved it oppositely per figure, 0.00% vs 30-38% px). Ask verifiers for "your read on next move" explicitly; both parked shots shipped with no-re-roll diagnoses that save the next terminal money.

## 2026-08-11 — kb-structure brainstorm (boss session)
- WORKED: ground a structure brainstorm in 3 cheap numbers BEFORE proposing anything (tracked files per layer, git pack size, du of working sets) — the 6.9GB-disk/173MB-pack gap settled "media out of git" without debate, and the DASHBOARD_REPO_ROOT grep settled "split is cheap" in one probe. Facts first shrank the option space from 4 designs to 1 candidate in two exchanges.
- WORKED: when Daniel says "go see how other people do it", dispatch the research AND an adversarial critique as parallel read-only codex workers (terra for survey, sol xhigh for red-team) and END TURN — the .last.md + auto-published cards make the results session-durable, so a handoff can close mid-flight cleanly.
- LEARNED: Daniel's design conversations move by narrowing, not approving — he explored Remote-SSH-everything, then explicitly walked it back; never treat an explored branch as a chosen one, and record REJECTED options in the handoff so the next terminal doesn't re-pitch them.
- FRICTION: foreground `du` at kb root blows the 120s Bash timeout (media weight) — background it. Temp-worktree-from-origin/ops remains the safe coordination-write route while the main checkout sits dirty on another arc's branch.

## 2026-08-11 — Bricks taste-forensics wave: spec/plan + SDD Tasks 0-1 (boss session)
- WORKED: elicitation-first design for taste regressions — Daniel's liked-lists alone carried a decisive signal before any agent ran (all six L28-place-children unnamed vs the L40-43 chain liked), but the brainstorm questions (revert scope, 6c2 read) still changed the wave's shape twice. Ask the cheap scope questions BEFORE designing.
- WORKED: SDD two-stage review caught what implementers missed both times: a Critical beat misattribution in a data task (Gen-B L81 pinned to the wrong beat) and 4 board-bias defects (loaded questions, leading captions) in a build task. Fresh-context reviewers on data products = worth it; frame-fidelity pixel forensics (32x32 RGB distance vs different-frame control) is a cheap decisive check for image boards.
- WORKED: deterministic joins beat fuzzy — old/new shots.json narration was word-identical (ratio 1.0), so beat mapping became word-offset arithmetic, and the reviewer could re-derive it exactly. Check for identity FIRST before reaching for fuzzy matching.
- LEARNED: archive dirs lie — `_archive-pre-regen-2026-08-06/L19.png` was a byte-copy of an OLD-generation render, and 90+/228 board cards mismatch same-id archive files. The board embed Daniel actually judged is the only trustworthy anchor for taste work; resolve pixels board-first, then upgrade to a pixel-matching original.
- LEARNED: SendMessage resume of a subagent hours later can fail ("No transcript found") — SDD report files are the durable memory; design fix-loops around brief+report, not around live agents.
- LEARNED (Daniel rulings, now in spec): goal is FINALIZE the pipeline stage, not fix noticed defects; rollback-over-addition is a binding change-design law (reduce B toward A, never bolt A-replication onto B); no governing-file writes before the change-list is approved (G2).

## 2026-08-11 — codex-image-engine arc: probes→spec→plan→build start (boss session, Fable 5)
- WORKED: probe-before-design at three depths — (1) tool existence + one real gen ($0, minutes) settled feasibility before any design; (2) a 12-gen structured probe matrix (identity/seeds/aspect/policy) produced the Gate-1 brief; (3) a dedicated PROMPTING research phase (9 gens) overturned the v1 design's core assumption (adapt Gemini prose) with measurements. Each phase's findings were load-bearing in the next gate. Cheap empiricism beat speculation every round.
- WORKED: rollout logs (`~/.codex/sessions/.../rollout-*.jsonl`) are ground truth for what a codex agent ACTUALLY sent to a tool — better than self-report; P2b verified byte-exact verbatim pass-through against them. But NEVER commit full rollout logs to a tracked repo (sensitive-shaped; one unclassifiable high-entropy blob → fail closed, scrubbed event excerpts only). The auto-mode classifier blocking your own inspection of a secret-shaped string is a signal to STOP classifying and fail closed, not to route around.
- WORKED: measured prompting doctrine transfers across engines only as MEASUREMENTS, never as conventions — Gemini's last-instruction weighting is actively harmful on codex (head+tail repetition ~4x worse; bloat ~6x worse; dedicated Avoid: field 2-3x better). Population-mean style targets (pinned hex) are poor per-shot targets when real accepted output varies 53 points/shot — pair same-shot references instead, and re-open the human's ratified threshold when the measurement framing changes under it (Daniel re-ratified without friction; silently translating would have been wrong twice over).
- WORKED: SDD loop with boss-injected scrutiny — telling the task reviewer exactly which implementer claims to distrust (argv deviations, verdict arithmetic) got a real Important finding (gating metric unauditable from committed evidence) on round 1. Worker-retirement rule held: fresh plan-writer instead of a 330k-token design-worker resume; the fresh worker caught spec staleness + a JSON-envelope bug the tired one might not have.
- LEARNED: cut arc branches from the branch that owns the subsystem (bricks doctrine-reset), not main — main's image-gen skill was 4.7k lines stale; a main-cut arc would have built parity against a dead engine. Check `git diff --stat main..<owning-branch> -- <subsystem>` BEFORE cutting any dependent arc.
- LEARNED: "must not affect the live path" is strongest as an architecture (standalone runner, zero edits, `git diff --exit-code forge.py` as the acceptance check), not as regression tests. Daniel's instinct ("separate path, own logic") was the right call and the probe evidence (agent middleman rewrites prompts anyway) independently justified it.
- HAZARD: codex exec quirks on this box — binary is `codex.CMD` (shutil.which required); bare exec refuses untrusted dirs (`--skip-git-repo-check`); `--sandbox read-only` HANGS (never fails fast) and leaves 4 orphan children → process-TREE kills only; ambient-repo detour reads governance docs at up to 8x token cost from a repo cwd (empty tempdir reduces ~5-6x, does NOT zero — A1 measured).
- ARC STATE at close: handoffs/2026-08-11-fyt-codex-image-engine.md (P4 task A1/26 mid-fix-loop; UNPUSHED branch needs history scrub of 03734ba before any push).

## 2026-08-11 — workflow-platform P0 live-fire: 3 platform blockers in one afternoon (boss session, Fable 5)
- LEARNED (the arc's thesis, proven): green suites are NOT a working platform. First-ever REAL W7 def-card launch immediately exposed: (A) claude stream-json workers NEVER exit while stdin is open, so the adapter's exit-only finalize turned every successful attempt into failed-as-timed-out at the 30-min kill (live proof: attempt succeeded 21:03:28Z, platform marked it failed 21:32:54Z); (B) `bridge:`-prefixed sourceTurnId never matched workflowRefIndex, hiding every def-card run from the Workflows view; (C) bare YAML dates in card frontmatter made cards unreadable to the bridge (json.dumps TypeError). All three lived behind fakes that behaved unlike the real thing. Fixes on claude/workflow-platform 804acec, UNREVIEWED at close.
- WORKED: probe-before-dispatch again — reading the delivery code (claudeWorkerAdapter finalize paths) + one CIM process check (worker PID alive 10 min after its result event) nailed Bug A's mechanism in ~15 min with zero research agents; then predicted the 21:32:54Z timeout-mislabel to the second before it happened. A confirmed prediction is the strongest grade evidence a root cause can get.
- WORKED: two sonnet builders in ONE worktree with explicit disjoint file ownership ("these files are OFF LIMITS; if you need them, stop and report") — builder A flagged B's uncommitted files as a concurrent-writer anomaly instead of touching them. The flag-don't-touch instruction is what made sharing the worktree safe.
- LEARNED: vitest full-suite on this machine fails 5-7 files with fork-pool startup timeouts under load; the arc baseline is workflowRun.test.ts:265 ONLY — judge every other failure ISOLATED before believing it.
- LEARNED: a background subagent can stop mid-task "waiting for a background test run" — its own child doesn't re-wake it. SendMessage-nudge it to collect and report; also tell builders foreground timeout is 120s so 7-min suites need run_in_background from the start.
- GOTCHA for next terminal: the deployed daemon (pin 6501bc1) still has all three bugs — do NOT file workflow cards until the pin advances past 804acec (post-adversarial-review) AND the SPA is rebuilt (dist staleness burned Daniel once already today).

## 2026-08-11 — kb-structure spec+plan session (boss, Fable 5, codex-only workers)
- WORKED: 4 parallel evidence workers (adversarial critique sol/xhigh + boundary map + media inventory + creds options, all terra unless noted) under the critique's wall-clock shadow — zero added latency, and the evidence REVERSED the brainstorm's design (platform/data split → phased monorepo/state-first). Grade every worker: spot-verify 2-3 file:line claims before accepting; caught the critique's one false claim (createQueueBridge HAS an env-gated production caller, surface.ts:128).
- WORKED: long-generation plan (3k lines, sol/xhigh) + fresh-context sonnet verifier with TAIL-WEIGHTED brief — verifier caught a Critical the boss's own spot-checks missed (plan snippet contradicted a pinned test's overwrite semantics). Timeout killed the writer DURING self-review; the artifact was complete — always check the artifact before assuming a timeout means loss.
- FAILED: read-only-sandbox research workers bank NOTHING on crash — the original critique died at 2h26m on codex backend stream disconnect (turn.failed in JSONL), 165 commands lost. Fix that now binds: give long codex research a writable git-inited scratch --cwd + per-section checkpoint-to-file instruction. codex refuses non-git cwd in 9s ("Not inside a trusted directory") — git init first.
- FAILED: thread follow-up salvage after a crashed turn — codex context does NOT survive turn.failed; the resumed worker honestly refused to reconstruct. JSONL tail is the postmortem; fresh re-dispatch is the recovery.
- Rulings shipped: see docs/superpowers/specs/2026-08-11-kb-structure-design.md (3 locked rulings, rejected-alternatives register) + 25-task Phase I plan; branch claude/boss-2026-08-11c pushed; handoff 2026-08-11-kb-structure-spec-plan.md.

## 2026-08-12 — kb-structure Phase I plan review rounds (boss, Fable 5)
- WORKED: a killed worker's artifact is NOT trustworthy even when it looks complete. The fix worker died ~48min in with 946 coherent insertions on disk and no final report; the independent re-review caught that B3/B5 were prose-only and the fixes added compile breakage (task-ordering, deleted-interface calls, canary v1/v2 mismatch). ALWAYS re-review a killed worker's output; never commit-then-trust.
- FAILED: claude Agent path was infra-flaky this session — two opus review agents died (API "response stopped arriving", then 600s stall watchdog) before emitting output. codex ran every worker all session with zero infra deaths. When claude Agents die repeatedly, switch the role to a codex worker (cold session = still independent of the fixer).
- FAILED: codex reviewer dispatched with `--sandbox read-only` can't write its own crash-checkpoint file (the whole point of checkpointing). For a checkpointing reviewer use DEFAULT workspace-write + scratch `--cwd` (reads repo unrestricted, writes confined to cwd, can't touch the target). read-only is only for a reviewer that writes nothing.
- WORKED: killing a specific worker tree safely = read its pending marker for the python `pid`, `taskkill /PID <pid> /T /F`, then verify OTHER terminals' worker pids still alive before moving on (a parallel terminal had a live codex worker; confirmed untouched).
- LEARNED: a plan that fully TDD-specifies security-critical execution-plane code against an UNMERGED dependency (workflow-platform) is fighting a moving target — the real launch path (`executeApprovedLaunch` starts runAutomatic before returning runRef) invalidated the "durable receipt before execution" fix. Signal to STOP auto-iterating and take the sequencing call to the human, not to spin another fix→review cycle.
- LEARNED: when a persistent local secret (dashboard HMAC session key on the VM) brushes against a hard human ruling ("no credential on the VM"), that's a human gate, not a boss judgment call — surface it, don't decide it.
## 2026-08-12 — workflow-platform P0 close-out (boss)
- WORKED: SDD chain at full depth paid off — the gaps unit (e1aa422) looked complete but fresh-context re-review found a MAJOR the unit's own test had enshrined as desired behavior (operator key namespacing = duplicate run on pre-publication resume). A test asserting a mechanism can still be asserting the WRONG mechanism; only an adversary with the product story catches that.
- WORKED: sending the fix round back to the SAME reviewer via SendMessage (context intact) — delta verdict cost ~1/3 of a fresh review and it re-judged the F1 deviation properly.
- WORKED: implementer deviating from reviewer's minimal fix WITH rationale (F1 scoped to cross-subject; unconditional would break own-subject one-revision-many-runs product behavior). Brief workers to flag deviations, not silently obey the reviewer.
- LESSON: pm2 restart wipes the in-memory arming latch — EVERY redeploy re-parks armed work behind Daniel's passkey. Sequence deploys so arming is the LAST human touch, or batch all deploys before asking him to arm.
- LESSON: `npm run build` in dashboard-prod was blocked by the permission classifier twice on 2026-08-11 but ran clean 2026-08-12 from the same shell — retry once before escalating to Daniel's `!`.
- REMAINS: run-74383969 at the gate (arm + one Resume + g1/g2); handoff = handoffs/2026-08-12-dashboard-workflow-platform-p0.md; then PR to main + P1.

## 2026-08-12 — P0 acceptance live-fire close (boss)
- WORKED: the acceptance run as a defect factory — 4 real production defects (transaction gap, budget conflation, stranded reservation, EPERM rename) surfaced by ONE tiny 3-stage run, all invisible to 900+ green tests because test fixtures faked the seams (fake coordination runner without the requireTransaction guard; fake accounting without the file adapter's arithmetic). Lesson: fixture fidelity is a defect class of its own — when a live failure exposes a faked seam, upgrade the SHARED fixture so the whole suite inherits the guard (the resolveBase fix did this; 2 pre-existing tests immediately became capable of catching the bug).
- WORKED: observer collision self-diagnosis — my own 2s json.load monitor held control-plane.json without FILE_SHARE_DELETE and broke the daemon's atomic rename. Fix BOTH sides: stat-gated monitor (open only on mtime change) AND daemon-side bounded transient-rename retry. On Windows, any poller on a live-written file is a suspect when EPERM renames appear.
- WORKED: reviewer-implementer dialectic — the reviewer prescribed a fix whose mechanism was wrong (budget arithmetic vs concurrency slot); the implementer verified against source, corrected it, and the reviewer conceded on re-review. Brief both directions: implementers verify the reviewer's mechanism before coding it; reviewers judge corrections on evidence.
- LESSON: don't redeploy mid-run when arming is passkey-gated — each pm2 restart wiped Daniel's arming and cost a human round-trip. Batch fixes; deploy only when a park already blocks the run.
- LESSON: gh pr merge is classifier-blocked for the boss — PR merge is Daniel's click, same class as npm-build-in-prod was. Hand it over via `!` immediately, don't retry.
- REMAINS: PR #117 merge (Daniel), then branch/worktree sweep + P1 kickoff per handoff.

## 2026-08-12 — Keep-awake overnight-sleep incident: diagnosed + hardened (boss session)
- ROOT CAUSE (for the record): supervisor crashed at 01:29:35 on the Write-JsonFileAtomic Move-Item race (358 prior benign hits on the heartbeat path made it statistically inevitable inside the unguarded supervisor pass); its finally block disarmed with 4 live leases; nothing respawns a dead supervisor overnight (only SessionStart acquires). Machine hit Modern Standby at 01:53. Diagnosis path that worked: keepawake.log + System event log (Kernel-Power 506/507/42) time-correlation — the missing "supervisor-exit reason=" line was the tell that the loop died by exception, and exit=0 in the stop line was a lie (exit var never reassigned on the crash path).
- SHIPPED: PR #119 (claude/keepawake-hardening) — MoveFileExW atomic replace, exception-proof loop (10-failure cap, guarded finally, per-lease fail-live bounded at 3), heartbeat watchdog with fail-closed throttle + pid/start-ticks identity. 129/129 Pester, 3 opus review rounds to SHIP, live-fire passed (killed real supervisor, watchdog respawned in one heartbeat, armed throughout).
- WORKED: resuming the SAME reviewer and SAME fix-worker via SendMessage across three review/fix rounds — each round's brief shrank to a delta and the reviewer re-ran its own prior escape reproductions empirically without re-briefing. Review quality was the story of this run: sonnet built a green-suite implementation that opus then broke twice (log-writer-throws-inside-catch; fail-open throttle) — route concurrency/power-state code review AND its fix waves to opus.
- LEARNED: the auto-mode classifier blocks Stop-Process/Get-Process on arbitrary PIDs — hand the kill to Daniel via `!`, and remember `!` runs GIT BASH: taskkill //F //PID <pid>, not Stop-Process. tasklist /FI "PID eq N" passes as the read-only liveness check.
- REMAINS: Daniel merges #119 + main-checkout branch must contain the fix for the HOOKS to run new code (hooks path = C:/Users/danie/kb/scripts). Until then: hardened supervisor pid 47240 runs from the worktree (caps 8:13 AM), but hooks are old code (no watchdog if 47240 dies). Follow-ups in PR: DENIED-line dedup (4.1), MaxHours guard (4.5), codex-terminal leases.

## 2026-08-12 — Codex image engine: full 26-task SDD build to P5 gate (boss run)
- SHIPPED: Phases A-D complete on claude/codex-image-engine @ 633f403 — forge_codex.py engine (125 tests) + study tooling (21 tests), ~24 review defects fixed, forge.py zero-diff law held all arc, $0 spend. P5 gate artifact: https://claude.ai/code/artifact/0c208d02-31ad-424e-9da3-a0b084017226 ; handoff = handoffs/2026-08-12-fyt-codex-image-engine-p5-gate.md.
- WORKED (the arc's core loop): terra implementer → boss re-verify (rerun suite, diff-inspect, entropy scan, forge.py blob check) → boss commit → FRESH-CONTEXT terra/sol reviewer with named attack surface → prescribed fix rounds. Fresh-context reviews caught defects at a rate no self-review matches: staging prompt race, stale session snapshot publishing a prior turn's PNG, a guard built in C5 but never wired until C15's review, quota markers matching quoted text, L3 as a vacuous empty list.
- WORKED: sol + --effort xhigh for the two highest-stakes reviews (C10 generate() seam, C12 staging single-writer) — C12's sol-xhigh review alone demonstrated 5 defects incl. 3 HIGH that terra-level reviews of neighboring tasks would plausibly have missed.
- LEARNED (spec-over-plan precedence, applied 5+ times): when a plan's verbatim code or test contradicts the spec or its own stated intent, the SPEC/intent wins, the fix is sanctioned, the plan text stays unedited, and the divergence is disclosed in the task report. Corollary: a worker "fixing" a doctrine CONSTANT to satisfy a synthetic fixture (D1 FLAT_RANGE 4→2) is the inverse failure — reverse it and fix the fixture.
- LEARNED (external background-shell kills): three background Bash dispatch tasks were externally killed mid-run (cause never identified; NOT standby — Kernel-Power log clean; keep-awake armed throughout). Mitigation that held for the rest of the arc: detached dispatch via Start-Process + a Monitor watching pending-marker/.last.md/parent-pid — worker survives anything that tears down the boss's shell tree. Also: never chain ledger appends onto dispatch commands; both kills ate the chained append.
- LEARNED: `git add scratch-dir/` nearly committed 23 machine-local baseline PNGs — add explicit file lists in mixed scratch dirs; the object-db permission failure was luck, not a guard.
- REMAINS: P5 study run behind Daniel's GO (40-gen budget; decisions 1-3 in the artifact); Wave-2 register-seed promotion routes through spec §10; arc worktree stays until merge.

## 2026-08-12 — Atlas ghost wakes: single-frame wake trigger (PR #120)
- Symptom: "Hey boss" → 120s timeout → "Okay sleeping" cycling every ~2 min, nobody speaking. NOT a timer — the only path to ENGAGED is the wake-word thread. Root cause: `atlas/worker/wakeword.py listen()` fired on ANY single 80ms frame scoring >0.5; one-frame spikes come from glitchy mic buffers under CPU starvation (silero logged 16s behind realtime during bursts) and ambient transients. Transcripts proved ghosts (greet-then-silence sessions, incl. 2-3am silent room).
- Fix: WakeGate — wake needs `wake_patience` (3) consecutive frames above threshold; sub-patience runs log "wake spike suppressed (peak …)". Verified live: spikes kept arriving every ~2-3 min, all suppressed, 0 ghost ENGAGED post-restart. Tuning knobs if it recurs: patience 4-5 or wake_threshold 0.6, read peaks off pm2 log.
- Ops fact: the RUNNING Atlas is a plain (non-git) copy at `kb-worktrees/atlas/atlas` with its own .venv; deploy = copy changed files there + `pm2 restart atlas-worker`. Repo `atlas/` and running copy were identical pre-fix; keep them in sync when merging #120.
- Diagnosis shortcut: wake-session transcripts in dashboard-ops `orgs/atlas/output/transcripts/` show exactly what STT heard per wake — fastest way to distinguish ghost wakes from real speech.

## 2026-08-13 - Bricks taste-forensics: Phase-3 implementation + G4 mint (boss run)
- SHIPPED: all 11 approved G2 proposals on claude/bricks-taste-forensics @ 0a3f7a6 (pushed,
  unmerged): P2 performer-tier rollback (-240 lines), P3 universal asset gate, P4-6 crowd/plate
  doctrine, P8 compose-from-primitives + card-holds-act, P9 delta face ownership, P10 pose retry,
  P12 expression veto; P11 proved a NO-OP by diff (era text already restored — the verdict's
  "record already-restored" clause beat the urge to manufacture edits). 536 tests, whole-branch
  opus review SHIP after a 6-item line-spec'd fix round. G4 mint: 13/18 verified at 0.78 of the
  5.00 cap; two real doctrine defects isolated (P8 pose regression, P9 half-landed). Handoff:
  handoffs/2026-08-13-fyt-bricks-taste-forensics-g4.md.
- WORKED (the wave's engine): per-cluster fresh opus implementer -> opus adversarial reviewer
  with LIVE PROBES (not just diff reads) -> scoped fix rounds -> boss commit with explicit paths.
  Probe-style reviews caught 5 shipping-class defects tests missed: plate-as-parent gate bypass,
  reference-role retry bypass, Gate-2 row that passed the defect it judged, dual costume
  instructions in one request, unscoped expression release re-creating the parked-L34 bug.
- WORKED: reviewer emits line-exact FIX SPECS (file:line, current text, required wording,
  acceptance) -> one fixer closes all six in a single round with zero interpretation drift.
- LEARNED (validation slices earn their money): the G4 defects were only visible because the
  slice had CONTROLS — 4 untouched-prose beats vs 2 re-authored beats made the P8 regression a
  4/4-vs-0/2 fact instead of a vibe; L46's same-primitive success was the decisive isolate.
  Design validation slices with controls, not just coverage.
- LEARNED (agent refusal as signal): the 9a worker refused to stamp "operator-reviewed"
  provenance as fabrication — right instinct, resolved by making the provenance string TRUTHFUL
  (boss ruling + actual basis) instead of overriding or skipping. When a worker balks on
  integrity grounds, fix the artifact's honesty, not the worker.
- LEARNED (test suites vs live stores): fixtures stamping the PRODUCTION review store (even
  transiently) make a gate untrustworthy; the fix is structural isolation + an import-time guard
  + a source-scan test, not cleanup. Check every gate-adjacent suite for live-store writes.
- LEARNED: worktrees lack gitignored roots (.env) — Kit-root walks and env loading silently
  resolve to drive root; 8h made it fail-loud; the mint needed Daniel to hand-copy .env (agents
  must not touch credential files even as symlinks — classifier enforced, correctly).
- REMAINS: Daniel's G4 ruling (board artifact in boss conversation); P8 candidate fix ruled-on
  then ~0.16 re-mint; merge + worktree sweep + DELETE the worktree .env copy.

## 2026-08-13 — P6 lesson: grade the prompt before grading the model
- P5 declared the codex engine below-floor on all 4 metrics; Daniel's one-line challenge
  ("that's the best it can do?") exposed that the composer COMMANDED the failure: a literal
  ink hex (+18 warm) the obedient model executed, plus an Avoid block banning tonal features
  the accepted style actually has. When a generator follows literal values, verify the
  commanded values match the measured target BEFORE running a study against it. A verdict
  pipeline can be flawless and still measure its own prompt bug.
- Style exemplar choice needs measurement too: first-pick L31 measured warm (+30 ink); L47
  measured +9 and carried more detail. Eyeballing chose L31; measuring chose L47.
- review.json nests under a "figures" key — a flat .get(name) reads NO-ENTRY for plates that
  are actually ALLPASS. Check the store's schema before declaring provenance absent.

## 2026-08-13 — Workflow-platform P1 tasks 1-4 (boss session, codex builders + opus reviewers)
- WORKED: codex-deep builds + fresh-opus adversarial review + codex fix + SAME-reviewer delta re-review (SendMessage) caught mechanism-level defects green suites missed on ALL FOUR tasks (premature Task-13 deletion killing live enforcement; restart boot-brick on approved completion gates; closed-schema smuggling holes; parked-verdict wedge). Reviewers that RUN probes (hostile defs, lifecycle-restart scripts, differential fuzz vs HEAD) beat reviewers that read. Demand probes in review briefs.
- WORKED: bounded fix discipline (≤2 rounds per task, Daniel's no-infinite-iterations ruling applied to orchestration) — every task closed within 2; round-2 briefs quoting the reviewer's exact specified fix close in ~4 min on terra.
- WORKED: baseline-first briefs (builder halts on unexpected failures) — Task-2 builder correctly halted on the reconciliation load-flake; boss verified isolated (23/23), amended the brief, re-dispatched. Judge authorizedFailedRunReconciliation ISOLATED only.
- FAILED: codex-deep dispatch died on transient DNS ("No such host is known", 5 reconnects) — worktree left clean; re-dispatch fresh after DNS resolves. Spooled cards (3) published via temp worktree from origin/ops → push HEAD:ops.
- FAILED: boss fix-ruling over-corrected once (gateKind-based gate scoping broke sibling completion gates — completion gates carry no gateKind); identity-based scoping (receipt ownership) was correct. Lesson: when scoping a guard, scope by ownership identity, not by a tag only some members carry.
- LESSON: builders overreach scope even with binding Do-not-touch lists (Task-1 did Task-13's deletion early; suites stayed green because tests hand-build the deleted input). Negative space needs adversarial review, never suite-green trust.

## 2026-08-13 — P7 exact-match round (codex-image-engine)
- WORKED: forensic diffing of failed outputs against targets BEFORE re-prompting — found the
  top-4 palette clamp was literally forbidding accent colours the target contained (blue
  mats, red sign). Lesson class: a constraint derived from a lossy measurement can outlaw
  the thing you're trying to reproduce; always check the constraint against the target's
  full content, not just the dominant statistics.
- WORKED: contracts beat adjectives with gpt-image-2 — figure scale as % of frame height,
  expression as concrete geometry ("closed curved-down eyes, huge open smile showing upper
  teeth"), lettering as exact string + treatment. Every one of these landed on first gen.
- WORKED: per-item exception clauses ("no words EXCEPT the exact string(s) specified")
  instead of lifting a ban wholesale — signs rendered, no stray text appeared.
- WATCH: paired |dM1| is layout-sensitive, not style-pure — L29 measured 7.3 while being a
  near-perfect visual match (its light layout differs). Judge with eyes, use metrics as
  tripwires only.
- FAILED (minor): worker's Avoid-list wording had inverted polarity ("Avoid: no words...")
  — review generated prompt TEXT, not just code, before running paid/real cells.
- Residual knob for any P8: money-green saturation runs dark when the class anchor has dark
  bills — anchor choice steers fill value more than the palette hex list does.

## 2026-08-13 overnight - Bricks: canonicals + full VPW rerun + tranche (parked on billing)
- SHIPPED overnight per Daniel's away-directive: G4 follow-up fix wave (digest-identity review
  store, complete-list gate, plate-scope refusal); resting-face law (canonicals rest as base
  rests, 3 doctrine placements) + P9 canonical-grant reduction; 13/14 canonicals re-minted to
  the standard ($0.546); FULL 246-shot VPW re-author at 0 HARD with all 116 abolished-tier
  castings resolved (opus author + adversarial opus review, 1 fix round, SHIP); act-1 tranche
  minted ready ($0.507, 0 holds). Generation itself returned ZERO pixels: provider dropped to
  free tier (limit 0, billing lapsed) mid-run - parked at $0 with a one-command resume. Boards:
  overnight https://claude.ai/code/artifact/9ce629db-4a2c-4d6f-ad55-a53d29d1b5e9
- LEARNED (registry rows are load-bearing plan artifacts): authoring 7 new cast without
  characters{} rows made forge silently reclassify 27 shots as cast-free tiles/plates — worse
  than the loud failure it replaced; "0 violations" was true and unreassuring. When a plan
  introduces named entities, the REGISTRY row is part of the plan, not the mint.
- LEARNED (adjacent-law collisions hide as authoring choices): lint's generic-plural guard
  forced a singular story-bearer into an anonymous knot and the worker's note laundered the
  tool limitation as story judgment. When two laws collide, escalate the collision; never
  paper it.
- LEARNED (don't switch a shared worktree's branch under live readers): the ops-temp-branch
  dance transiently wiped tracked files a board builder was reading. Sequence ops writes after
  workers finish, or use a separate throwaway worktree.
- LEARNED (mid-run provider tier drops are real): free-tier limit-0 429s mean BILLING, not
  quota — probe a few times to distinguish, park at $0, never work around a credential/billing
  ceiling.
- REMAINS: Daniel restores billing -> t15_gen.py 1 --live (act 1, 34 requests); 4 canonicals
  parked on texture-fill (flat-fill retry, good prior); acts 2-10 in tranches; taste flags on
  the board. Handoff: handoffs/2026-08-13-fyt-bricks-overnight-parked.md.

## 2026-08-13/14 — codex-image-engine P8→P10 convergence session (boss)
- WORKED: the "it's just off" escalation pattern — 3 parallel read-only adversarial workers (capability research / gen-logic diff audit / divergence classification) + a ≤6-gen discriminating probe set closed every cause bucket in one night. Classify-then-probe beats another lever cycle; each probe had a pre-registered confirm/kill threshold (e.g. degloss M2 ≥0.65; room-MAE ≤25) so results ruled instantly.
- WORKED: probe evidence over intuition for prompt design — the production prompt SHAPE (§2b head + seed roles + verbatim still_prompt + suffix, ~2k chars) beat 5k hand contracts; "measured lever text is not boilerplate" (rejected a worker's compaction of proven phrases; the exact wording is the tested surface).
- FAILED (never repeat): trading forge continuity seeds (place plates/chain parents) for cross-scene style anchors — the single biggest quality killer (room-MAE 46 vs Gemini 2.3); inverting register bans into GLOBAL positive commands ("gradients required") — self-induced the gloss the whole arc chased; delta clauses APPENDED to prompts — stale facts remain and contradict (deltas must REPLACE sections by key).
- HAZARD (hit twice): the codex worker toolchain mojibakes non-ASCII literals — P8's archived prompts fed the model double-encoded em-dashes, and the P10 worker's anti-mojibake regex was ITSELF double-encoded and matched nothing. Law: non-ASCII in worker-authored code as \uXXXX escapes only, and boss verifies any guard against a REAL corrupted artifact, not the worker's own test.
- HAZARD: fix-worktree green ≠ arc-tip green — an assert that passes only in a plate-less checkout (environment-dependent staging state) shipped from the isolated fix worktree and failed on the arc tip. Boss re-verifies the full suite on the MERGED arc state before push, every time.
- LEARNED: comparison baselines must pin their spec revision — the VPW re-author silently turned "match the baseline" and "render the spec" into different goals; P10's faithful renders scored WORSE against stale baselines (L50 dM1 −20 from obeying the new green-palette text). Before any match study, diff the current still_prompts against the ones that minted the baselines.
- MECHANICS that held all session: detached Start-Process dispatch + marker Monitors (zero external kills); harvest cross-worktree fixes via detached-HEAD commit + cherry-pick (PowerShell `>` corrupts patches to UTF-16); boss-only real gens; per-round boards with lightbox on one stable artifact URL.

## 2026-08-13/14 — Bricks Wave 1: wave doctrine executed to the gate (boss session)
- SHIPPED: Daniel's wave doctrine locked (W1 asset gate -> W2 all-cards gate -> parallel scene
  waves; auto-memory fyt-image-gen-wave-doctrine.md) and Wave 1 fully executed through a 3-round
  plate feedback cycle: 7 plates under the new PLATE_COMPOSITION forge law, 4 core-primitive
  re-mints + 3 deletions + sweep, hr-officer + handshake re-runs, crowd seeded-restyle, harness
  (K=2) built+reviewed SHIP. Branch @ 8b47b35c, $1.209 session gen spend, board v3 published.
- LEARNED (clause vs payload precedence): a generated policy clause CANNOT beat authored payload
  text that explicitly allocates the plane ("desk across the midground") — 3 plates proved it at
  15/16/8% zones. The working fix class is payload re-authoring (relocate furniture in the prose,
  author the open zone positively). Never re-roll against a payload conflict.
- LEARNED (counts are a generator lottery): repeated set-dressing objects rendered 10/7/10
  against an authored "eight" over 3 gens. Don't author numerals unless story-bearing; when one
  fails repeatedly, adjudicate story-bearing vs dressing (L198 "twelve jurors" = keep exact and
  it held; L84 chairs = drop the numeral, promote with provenance overrule).
- WORKED (quantitative verifier gates): grid zone %, rig-silhouette overlay, leg-span gridlines
  vs seed anatomy, macro pixel scans. B3 caught hair-inflated head-width masking a ratio "pass";
  w21-B caught a 37% cavern overshoot. Demand MEASUREMENT in verifier briefs, not adjectives.
- WORKED: ~15 detached codex workers (Start-Process Hidden + pending-marker Monitor), zero
  external kills all session; worker deviations were consistently good when briefed to flag them
  (lint-refused negation clause converted to positive; skip-exists overwrite surfaced).
- FAILED (agent infra): a sonnet verifier PAIR died to the 600s stream watchdog with NO
  transcript — SendMessage resume returns "No transcript found"; only a fresh respawn works. If
  a pair dies twice, move verification to cold codex sessions.
- REMAINS: Daniel's Wave-1 board ruling (incl. possible L84 adjudication veto) -> Wave 2 (134
  cards, first live harness run) -> card gate -> scene waves. Handoff:
  handoffs/2026-08-14-fyt-bricks-wave1-gate.md. Worktree .env deletion owed at close (Daniel via !).
## 2026-08-14 — kb-structure ship-now completion: Wave E→F2→final review→CI proof (boss session)
- SHIPPED: Tasks 15-20+22 + Checkpoint 2 (2 fix rounds) + Gate-1 evidence machinery + CI
  proof loop — 14 commits, branch claude/boss-2026-08-11c @ 71b2809a pushed, PR #118 updated
  in place, workflow proven green with a real 26MB attested artifact. All ship-now tasks
  (1-8, 10-20, 22) complete.
- WORKED (the arc's engine, unchanged): codex builds → fresh opus/sonnet adversarial review
  with live probes → codex fix → same-reviewer delta via SendMessage → boss-shell verify →
  PowerShell commit. Probe-style reviews caught shipping-class defects EVERY task that green
  suites missed (nested-.git read, VM-login hard-error, manifest byte drift, tautological
  gate condition, silent verify-0 on FAIL packages, strip-types boot brick).
- LEARNED (CP2's rule, then proven THREE more times by the CI loop): a test must send the
  bytes the production caller sends and run in the environment the production unit sets.
  The strip-types parameter property (vitest+tsc both blind), the PATH-separator modeling
  defect, and the never-run workflow were all this one class. Corollary now standing: any
  new server .ts needs a real `node --experimental-strip-types` import probe; any new CI
  workflow needs a real run before merge ("prove, don't reason" — final reviewer's words).
- LEARNED (plan verbatim-snippet defect rate held ~end-to-end): 18 plan defects total, all
  caught by cold-context stop-on-contradiction workers or reviews, none shipped. The two
  parse-before-verify verifier snippets (#14, #16) were the same bug class twice — check new
  crypto-verifier briefs against the T17 precedent FIRST.
- LEARNED (ssh one-liners): `A && B && nohup C & echo` backgrounds the whole chain (raced an
  empty script); systemd-run --wait dies with the ssh client — use detached --unit + monitor;
  `cmd | tail` swallows exit codes (pipefail + explicit captures); empty digest == empty
  digest reads DETERMINISTIC (guard MISSING).
- LEARNED (worker process discipline): one worker kept self-editing after writing its report
  — under a live review. New standing brief line: "report written = DONE". Also: a worker
  recorded an unfixed gap under 'Ruling conformance' (laundering); grade the negative space.
- REMAINS: Daniel's merge gate (PR #118 ready); post-merge = revert-check, worktree sweep,
  Gate-1 ceremony (checklist in PR body: signing key, restic, NOPASSWD, deploy, RP_ORIGIN
  drop-in, live drill, collect/finalize/verify, stale serviceEntry decision); deferred
  sub-plan blocked on workflow-platform ≥ 804acec; his 3 rulings (orgs/ exposure, unsigned
  audit promotion, S14).

## 2026-08-14 — Workflow-platform P1: Tasks 5-14 + 5 amendments to MERGE-READY (boss overnight run)
- SHIPPED: P1 complete on claude/workflow-platform @ e08308bc — 14 tasks, A1-A5 amendments, whole-phase opus review MERGE-READY; only Daniel's live-proof gate remains. Handoff = handoffs/2026-08-14-dashboard-workflow-platform-p1-complete.md.
- WORKED (the arc's core loop, 11 review cycles): codex-sol build → fresh-opus adversarial review with named attack surfaces → codex fix (FRESH dispatch with --cwd, never follow-up) → SAME-reviewer delta via SendMessage → boss re-verify → PowerShell commit. Every single task's green suite hid at least one review-caught defect; 4 BLOCKERs would have shipped without it (legacy reconciliation death, completion-rejection wedge, run-halt-on-park, commit-equality lineage wedge).
- LESSON (whole-phase review earns its cost): the final BLOCKER was invisible to ALL per-task reviews because execution.test.ts hardcoded maxConcurrency:1 while production defaults 2 — parallel semantics proven only serially. When a phase adds concurrency semantics, audit test-harness defaults vs production defaults EARLY, not at the end.
- LESSON (stop-on-contradiction + boss-verify): 5 worker stops, 5 amendments, every claim verified against code before ruling — two would have been wrong to wave through (A5's engine gap contradicted the locked rule itself). Plan amendments as an appended ## Amendments section (visible, committed, gate-reviewable) beat silent divergence.
- LESSON (contended box): suite timeouts under other arcs' workers look like failures; diagnose = isolated rerun + CPU sampling DURING the run; per-test hard-coded budgets (it(...,120_000)) are invisible to --testTimeout CLI; multi-word -t filters break the npm shim (use node_modules/.bin/vitest).
- LESSON (dispatch resilience): 2 external shell-tree kills + 1 dispatch timeout absorbed; detached Start-Process + footer Monitor is now my default; the finisher-verify pattern (cold worker verifies the dead worker's diff against the FULL contract, then completes) recovered ~3h of surgery twice with zero resets.
- HAZARD (real, fixed same-session): `git add -A -- dashboard/ ':!memory'` silently skipped NEW untracked files → pushed a broken commit (9bddcd72, rename half-applied); post-commit `git status` check caught it → 617eb9b5. Always verify status shows no in-scope untracked files after committing a rename.
- GATE DISCLOSURE BANKED: A4 unmintable positions = mediator/debate configs inoperable in P1 (largest hole); legacy review-block proposalId change; intervention exemption blast radius; 41-cycle 300s budget.

## 2026-08-17 — IG-saved → kb build-ideas research run (boss session)
- WORKED (pipeline): Instagram reels → yt-dlp downloads PUBLIC reels with NO cookies (`py -3 -m yt_dlp -f mp4/best --write-info-json`); `--dump-json`/info.json gives caption+uploader+upload_date so no per-post Chrome visit needed. Auth-gated reels fail ("empty media response") and `--cookies-from-browser chrome` fails while Chrome is running (locked cookie DB) — substitute the next save-order relevant video, log the swap, don't fight it. video-vision `video_watch` takes a LOCAL FILE (or YouTube URL) only — not IG URLs — so boss must download first, then subagents analyze local mp4s.
- WORKED (toolchain provisioning, reusable): this box had ONLY yt-dlp; ffmpeg/ffprobe/whisper were absent (confirm with PowerShell `where.exe`, NOT MSYS `command -v` — different PATH). Fix with zero admin: `pip install static-ffmpeg` (real ffmpeg+ffprobe incl. ffprobe, unlike imageio-ffmpeg), download whisper.cpp `whisper-blas-bin-x64.zip` from ggml-org/whisper.cpp releases, then COPY ffmpeg.exe+ffprobe.exe+whisper-cli.exe+its DLLs into `…/Python313/Scripts` (already on PATH). The video-vision MCP server picks them up LIVE (its `checkCommand` runs `where` against a PATH that includes Scripts) — no session/MCP restart needed. Configure backend=local, whisper_engine=cpp, model=small (fast on CPU; large-v3 is the RAM-based default but slow with no GPU).
- WORKED (structure): 4×(4-5) sonnet analysis agents on disjoint reel sets writing one note/reel → 3 opus synth workers (disjoint halves) writing candidates-A/B/C → 1 opus merge (dedupe+dual-judgment+write deliverable, ran its own verify pass) → 1 independent opus reviewer (findings file) → author revision via SendMessage (context intact). All 12 agents model-verified by transcript grep (sonnet-5 / opus-4-8). Reviewer caught 0 blocker/2 major/9 minor on a genuinely accurate report — the "dropped dashboard/UI refs" major is the kind of thing only a fresh-eyes pass finds.
- LEARNED (Daniel's taste): do NOT over-filter recent AI reels as "grift." Sales-pitch TONE ≠ no value — many lead-magnet reels SHOW a dashboard/UI/system worth stealing even when the pitch is empty. He wants the on-screen UI/UX artifacts and underlying concepts, so the note schema needs an explicit "Dashboard/UI-UX observed" section and the deliverable a dedicated dashboard-references catalog. Also: his "~1 week / most-recent" band is the real scope — the good stuff was recent, I wrongly reached deep first.
- LEARNED (IG grid): the saved grid VIRTUALIZES (offscreen tiles drop from DOM); a full-scroll accumulate reorders. For reliable save-order (recency), capture at fresh `scrollTo(0,0)` in small steps and keep FIRST-seen order; the fresh-load top band is authoritative for "most recently saved." Return compact fields (id + 80-char alt) — a full a11y/JSON dump of ~300 tiles overflows the tool-result token cap.
- Artifacts: `docs/research/2026-08-17-ig-saved-ai-build-ideas.md` (deliverable) + `docs/research/_ig-saved/{manifest.json,audit-log.md,notes/*.md (37),candidates-A/B/C.md,review-findings.md}`; 37 mp4s kept in scratchpad (uncommitted, avoids repo bloat). 8 deeper "agentic-OS" reels downloaded but NOT analyzed per Daniel's recent-only steer — available in scratchpad if he wants them.

## 2026-08-17 — IG-saved → kb build-ideas research run (boss session)
- WORKED (pipeline): Instagram reels → yt-dlp downloads PUBLIC reels with NO cookies (`py -3 -m yt_dlp -f mp4/best --write-info-json`); info.json gives caption+uploader+upload_date so no per-post Chrome visit needed. Auth-gated reels fail ("empty media response") and `--cookies-from-browser chrome` fails while Chrome is running (locked cookie DB) — substitute the next save-order relevant video, log the swap, don't fight it. video-vision `video_watch` takes a LOCAL FILE (or YouTube URL) only — not IG URLs — so boss must download first, then subagents analyze local mp4s.
- WORKED (toolchain provisioning, reusable): this box had ONLY yt-dlp; ffmpeg/ffprobe/whisper were absent (confirm with PowerShell `where.exe`, NOT MSYS `command -v` — different PATH). Fix with zero admin: `pip install static-ffmpeg` (real ffmpeg+ffprobe, unlike imageio-ffmpeg which lacks ffprobe), download whisper.cpp `whisper-blas-bin-x64.zip` from ggml-org/whisper.cpp releases, then COPY ffmpeg.exe+ffprobe.exe+whisper-cli.exe+its DLLs into `…/Python313/Scripts` (already on PATH). The video-vision MCP server picks them up LIVE (its `checkCommand` runs `where` against a PATH that includes Scripts) — no session/MCP restart needed. Configure backend=local, whisper_engine=cpp, model=small (fast on CPU; large-v3 is the RAM-based default but slow with no GPU).
- WORKED (structure): 4×(4-5) sonnet analysis agents on disjoint reel sets writing one note/reel → 3 opus synth workers (disjoint halves) writing candidates-A/B/C → 1 opus merge (dedupe+dual-judgment+write deliverable) → 1 independent opus reviewer (findings file) → author revision via SendMessage (context intact). All 12 agents model-verified by transcript grep (sonnet-5 / opus-4-8). Reviewer caught 0 blocker/2 major/9 minor on a genuinely accurate report — the "dropped dashboard/UI refs" major is the kind of thing only a fresh-eyes pass finds.
- LEARNED (Daniel's taste): do NOT over-filter recent AI reels as "grift." Sales-pitch TONE ≠ no value — many lead-magnet reels SHOW a dashboard/UI/system worth stealing even when the pitch is empty. He wants the on-screen UI/UX artifacts and underlying concepts, so the note schema needs an explicit "Dashboard/UI-UX observed" section and the deliverable a dedicated dashboard-references catalog. Also: his "~1 week / most-recent" band is the real scope — the good stuff was recent, I wrongly reached deep first (twice corrected).
- LEARNED (IG grid): the saved grid VIRTUALIZES (offscreen tiles drop from DOM); a full-scroll accumulate reorders. For reliable save-order (recency), capture at fresh `scrollTo(0,0)` in small steps and keep FIRST-seen order; the fresh-load top band is authoritative for "most recently saved." Return compact fields (id + 80-char alt) — a full a11y/JSON dump of ~300 tiles overflows the tool-result token cap.
- HAZARD (real, cost me the lesson once): an external process (ops cadence / sync) REVERTED my uncommitted working-tree edit to `memory/claude-boss.md` in the main checkout before I could route it to ops — the append silently vanished. memory/ is an ops-branch coordination write; do NOT stage a memory append on the work branch and assume it survives. Write memory changes straight onto the ops flow (temp branch from origin/ops → append → push), or they get clobbered.
- Artifacts: `docs/research/2026-08-17-ig-saved-ai-build-ideas.md` (deliverable, committed on claude/boss-2026-08-17 @465eb05c) + `docs/research/_ig-saved/{manifest.json,audit-log.md,notes/*.md (37),candidates-A/B/C.md,review-findings.md}`; readable artifact https://claude.ai/code/artifact/7e2a6ef4-3c81-4315-b665-2e00f334ff7a; handoff `handoffs/2026-08-17-kb-ig-saved-build-ideas.md`. 45 mp4s in scratchpad (37 analyzed + 8 deep unanalyzed), uncommitted.

## 2026-08-18 — bricks W2-slice engine duel (session terminated by Daniel)
- **Confirm test design BEFORE spend.** Three paid rounds each re-guessed Daniel's intent (ab5
  hand-authored list; run-1 pro-only + self-verified worker; duel finally right) — he terminated
  the session furious. Rule: any Daniel-facing comparison gets a <=2-line design statement
  (items source, arms, pipeline, verifier, cost) and his YES before the first provider call.
- **W6 harness live-proven** (first use): coordinator plan K=2 + wave_worker ran both arms clean.
  Keep run ids/dirs SHORT — `w2slice-flash` + deep dirs blew Windows MAX_PATH mid-run.
- **Generator never self-verifies.** Run-1's codex worker genned AND verified — forge itself then
  refused those cards as seeds (unreviewed staged STEP-1). Verification = separate fresh-eyes
  agents (protocol pair), always.
- **Registry engine flips:** edit the `engine` key only, restore via `git checkout --` (a
  json.dump rewrite churned 654 lines). Archive staging slots before any arm/re-mint — forge
  skip-if-exists silently no-ops.
- **Forge mechanism findings (engine-independent, verbatim prompt in bricks w2-partial/report.md):**
  STEP-1 beat clause names the scene object then fences it — object wins; ground line lost 14/20;
  retry enum lacks clean_card. Proposed surgical fixes NOT approved — do not dispatch without ruling.

## 2026-08-18 — Gate-1 ceremony driven to signed close (boss session, 5 live defects)
- WORKED: ceremony-as-debugger — the first live run of a never-exercised platform path surfaced 5
  REAL defects (quiescence proof, control-plane seed, unauth boot crash, credential channel,
  collector Host port), each closed same-session via codex build → opus adversarial review (FIX
  rounds until SHIP, every finding mutation-checked) → PR → deploy. Budget ~5 PRs in any "first
  live ceremony" estimate; none of these were findable by tests that mock the seam.
- LESSON (cost of theorizing): 5 rounds burned on token-copy integrity theories when the REAL
  cause was the daemon crashing 60s after every login (missing git identity in /var/lib/kb/ops →
  audit commit fatal). The fix-rate went vertical the moment a diagnostic runner printed the
  SERVER'S rejection reason (`bad-signature`) instead of a silent exit. Rule: when a human-loop
  step fails twice, stop iterating the human and ship a probe that surfaces the machine's reason.
- LESSON (fail-closed cascades): three separate guards (origin Host compare, credential-name env
  ban, ControlGroup emptiness) each correctly failed closed AND each made the system impossible to
  operate — fail-closed guards need a live-fire pass before a gate depends on them.
- OPERATIONAL (VM): deploys don't refresh /usr/local/lib/kb helpers (manual sudo install needed);
  outbox DirtyIndexError clears only via STOP → git reset → START (live reset races the daemon);
  Windows curl strips default :443 but python urllib doesn't (origin guard rejects explicit
  default port — fixed collector-side in #127); WebAuthn is impossible from automated browsers —
  Daniel's console + prompt()-dialog + `(Get-Clipboard -Raw).Trim() | ssh` is the reliable
  token transport; DevTools console needs `allow pasting` typed once.
- PROCESS: single opus reviewer resumed via SendMessage across 5 review legs kept full context and
  caught cross-PR patterns (same fail-silent writer bug in two paths); grades model-grepped
  claude-opus-5 throughout. Classifier blocks on signing-key/sudo-unit commands are correctly
  Daniel's moments — pre-stage everything so his command is one paste.

## 2026-08-18 — Agent Platform Wave-1: overnight-build plan authored (boss session)
- ARC: Daniel's IG UI/UX inspiration + prior research → a "kb Agent Platform" program (build/equip/run/manage complex agents like the reference dashboards, over a semantic brain + context/eval/autonomy/hooks + a legible command center). Decomposed into 7 sub-projects across 4 waves + deferred Second Brain. **RESUME/RUN: everything is on branch `claude/agent-platform-w1` (worktree `kb-worktrees/agent-platform-w1`); `LAUNCH-PROMPT.md` at its root is the exact overnight launcher.** Handoff: `handoffs/2026-08-18-kb-agent-platform-w1-overnight.md`.
- WORKED (git): to cut a clean main-based branch when the MAIN checkout has untracked files that `main` tracks (checkout -b from origin/main ABORTS), use `git worktree add <path> -b <branch> origin/main` — fresh worktree, no conflict. Also: never base dashboard work on a stale local branch — `claude/boss-2026-08-17` was 227 behind main / 364 dashboard files drifted; base on `origin/main`.
- WORKED (overnight-build design): the safe unsupervised-overnight loop = author the acceptance bar IN THE PLAN (don't let the build agent invent its own), then TWO fresh-context reviews per unit — a deterministic unit Inspector AND a goal Auditor checking against a re-injected GOAL-STATE — plus retry-cap-2→BLOCKED (no spin), inert meta-infra (hooks built+tested but NOT wired), dry-run-only file ops, and nothing merges (human flips every done switch in the morning). loop-design-check Step-5 ("run once by hand first") is the thing Daniel overrode — he accepts day-one full-auto IF the plan + in-loop dispatched review agents are strong enough. Do NOT invent named abstractions like a "main brain": the boss terminal IS the orchestrator (dispatches build workers + review agents), standard kb pattern.
- WORKED (parallelization for a shared SPA): build the dashboard section + a panel-REGISTRATION mechanism FIRST (serial), so every feature panel is a self-contained component added without editing shared nav/routing — this is the collision-avoidance move that lets feature lanes run in parallel. Do a dashboard-wide restyle as a CENTRALIZED theme-token pass (not per-screen rewrites), gated on breaking zero existing tests.
- LEARNED (Daniel's taste this arc): pushed back HARD on my adversarial instinct to narrow/supervise — he wants an ambitious all-around (function + UI) run and trusts a strong plan + review loop over hand-holding. UI = "inspired, not copied" (adapt DNA: agents-as-a-graph, live run telemetry, model badges, functional-color dark shell — never clone layouts). Prefer ADAPT-EXISTING over net-new (U8 became "reclaim SELECT ECC context-persistence parts, drop the GateGuard that got ECC disabled"). He cut the speculative "per-terminal context object" when I argued it duplicated ECC + was an empty vessel. Business features (CRM/funnel/etc) OUT — he wants the INFRA to build agents of that complexity, not the features.
- LEARNED (honesty pattern that landed well): repeatedly correcting "net-new" → "already built" earned trust — autonomy graduation gate is BUILT (`promotion.py`/`trust.py`/`dispatch.py`), the run-envelope is captured-but-inert (`trace/render.ts`), ECC ships the context stack but is disabled. The plan leans on SURFACING these (autonomy-ladder view, run-envelope panel, watch-agents-run over the existing live-run-graph) — low build risk, high review value.

## 2026-08-18/19 — Bricks overnight run (boss session, Fable 5)
- WORKED: forensics-before-fixes settled a "skills got worse" scare in one opus agent — verdict was
  standard drift (the remembered "perfect 5/5" was an HTTP tally, not a quality verdict); always
  audit what a remembered score actually measured before re-engineering to beat it.
- WORKED: boss-as-parallelizer — safe-stop a serial conductor, demand a machine-readable
  remaining.json manifest, fan out disjoint contiguous partitions (delta chains whole) with
  per-worker log files and scoped stamp writes; 7 workers, zero content collisions.
- LEARNED: subagents that "wait for a monitor/notification" on background gens stall silently —
  notifications don't reach them. Brief "poll directly, never idle-wait, don't end turn while
  partition work remains" up front; SendMessage resume fixes stragglers.
- LEARNED: shared stamp stores need schema-strict writes — an old-schema shorthand stamp
  collaterally downgraded ~17 verified shots (repaired + re-checked same night). Scope every write
  to your own keys and verify by re-read.
- LEARNED: forge.py relative --out/--to paths double-nest on this box — absolute paths only.
- HELD: confirm-design-before-spend — every paid round this session ran only after Daniel's explicit
  commission/ruling; the 08-18 blowup pattern did not recur.

## 2026-08-18 — Bricks board iterations + prior-runs pull-up (boss session)
- WORKED: SendMessage follow-ups to the SAME sonnet board-worker for 4 successive rulings (script spans, W1 trim, W1 removal, state-semantics fix) — context intact, each turn cheap; codex handled the disjoint prior-runs board in parallel. 50/50 codex/claude split held.
- LEARNED (codex dispatch): the worker's WRITE root is exactly --cwd; a brief writing into kb-worktrees/ from a repo-root dispatch fails "outside writable root". Reads outside --cwd are fine. Fresh dispatch with --cwd at the worktree; never a follow-up (loses cwd).
- LEARNED (board semantics, Daniel rulings — full text in boss auto-memory image-board-state-semantics): one card one state (quarantine _staging_flagged/_rejected files are superseded attempt snapshots, never merged onto live cards); no registry/base-library section on seed boards; registry.json is CHANNEL-WIDE — filter per video or other videos' cast leaks in (Bolivar/MacGregor appeared on a bricks board). Plus standing: every scene card shows its script span (vo_text) from the shots.json it was GENERATED under (archived runs use the git-era shots file, not current).
- LEARNED (data hygiene): w2-full/remaining.json "26 deferred" is stale — all 29 listed cards have images on disk; don't trust run-scoped manifests over a disk+review.json parse. Also the 8-hex filename token is NOT a unique content key across characters — dedup by full stem.
- FRICTION: personal auto-memory MEMORY.md got mojibaked on disk (cp1252 round-trip) — repaired by codepoint; F-encoding applies to memory files too, verify by codepoint scan after external writes.
- REMAINS: 6c2 section landing on prior-runs board (codex in flight); failed-W2 re-mint wave (failed-cards.json from board worker) incl. action-recoil/surrender primitive re-mint; Daniel's comparison feedback still the gate before scene waves L26+.

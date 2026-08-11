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

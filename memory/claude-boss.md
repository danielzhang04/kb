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

## 2026-08-18 — Agent Platform Wave-1 overnight build (boss session, Fable 5)
- WORKED: the per-unit pipeline (spec probe -> build -> fresh opus Inspector + goal Auditor -> commit) at full parallel width: 17/17 units DONE, 0 blocked, ~36 model-verified subagents, $0 API. SPEC-phase anti-duplication probes paid for themselves every time (found the panels/ collision, the Agents-view overlap, the roster loader to extend).
- WORKED: goal Auditors that MEASURE beat ones that read — best catches came from executing the work adversarially: blocked-socket offline probe (U1), 4000-case differential fuzz vs promotion.py (U5), corpus-precision decomposition 1/55 actionable (U11), 0-hit grep across 119 transcripts (U10), binary grep proving the dispatch tool is named Agent not Task (U9). Instruct reviewers to run/measure, not just read.
- WORKED: convergence-vs-spin judgment on the retry cap — U0 and U1 exceeded 2 review rounds but each round shrank (3 blockers -> 1 word); allowing a final micro-fix round beat BLOCKING the keystone unit. Document the judgment in the report; cap still kills real spin.
- WORKED: codex/claude 50/50 split by risk: codex (terra) on isolated script/panel units with --cwd fresh dispatches; Claude opus on SPA/hook/safety; sonnet finishers for model-dependent verification the codex sandbox can't run (its python differs and site-packages are write-denied). Codex sandbox claims about the environment can be WRONG (claimed torch missing when the real env had it) — always verify env facts in the real shell.
- WORKED: shared-file serialization — U0's *.panel.tsx glob registry kept ~10 parallel panel workers off shared files entirely; server route registration was the one contended file (index.ts) and a single serial wiring commit after all units landed resolved it cleanly. Order-less `order` field added later without breaking file-drop.
- HAZARD: codex sandboxes leave ACL-locked temp dirs (.pytest-*, deny-ACL, need elevated delete) and git can't even stat them; gitignore them and list for the human. Also: two background rebuilds of the same .brain-index raced harmlessly this time — serialize index builds.
- HAZARD: machine slept 06:20-14:14 mid-run; two in-flight opus reviewers stalled (one recovered after wake, one needed respawn). Liveness check = transcript JSONL growth under ~/.claude/projects/<proj>/<session>/subagents/, never the .output file (0 bytes until completion). keep-awake hooks exist but the lid/power policy still bit.
- LEARNED: fixtures authored from the same belief as the code are false signals (U9's Task-named fixtures were green while the constant was wrong) — derive harness-facing fixtures from real captured payloads; and write one arm-time check PER ASSUMPTION, prioritizing the unverified ones.
- LEARNED: for INERT hook families, make inertness a TEST (git diff over .claude/ empty + no settings references) and put an arm-time retarget step in the runbook — arming inverts those guards and the runbook must say so or it ships a red suite.

## 2026-08-19 — Wave-2 overnight run (boss session, codex-only)
- WORKED: build→fresh-adversarial-review→boss-grade→commit per unit, park-after-2 never needed (7/7 landed, 9 rework rounds total). Sol-tier reviewers earned their cost: unenforceable-governance text, vacuous-test weakening, quote-injection in eval cards, win32 junction bypass, cross-session throttle starvation — none of these fall out of build-time testing.
- WORKED: boss runs the full suite in HIS environment after every worker claim — worker sandboxes produced 4 distinct false baselines tonight (temp-dir ACLs, settings.local.json artifacts, "1312 passed AND two failures"). The boss env is the only truth source.
- LAW (violated once, then followed): writing reworks are FRESH dispatches with --cwd; follow-ups are read-only Q&A ([[codex-followup-loses-cwd]] struck again — wrote into main checkout, contained same-hour).
- LAW (new): verify a kill by process liveness, never by taskkill exit code — a "killed" worker survived exit-128 and finished its build unsupervised; its diff got hostile-audit treatment before landing.
- LAW (new): a linked worktree is NOT off-main — its every git op writes the main repo's .git. For "don't touch main" requirements, standalone clone only ([[bricks|kb-clones pattern]]); and codex_dispatch publishes ops via --repo-root's git, so pass --repo-root explicitly when the clone must own everything.
- INFRA: codex 0.148.0 (npm, 2026-08-18) breaks Windows spawning (missing codex-windows-sandbox-setup.exe). Pin: npm i @openai/codex@0.147.0 --prefix <dir>, prepend its .bin to PATH in POSIX form (a Windows-form path inside an MSYS PATH mangles into C:\Program Files\Git\Users\...).
- PLATFORM DEFECT FOUND+FIXED: manifest hashing was checkout-dependent (raw bytes vs autocrlf) — every fresh Windows clone false-tampered every blessed suite; agent-suite + canary hashers now EOL-normalize (G2, 1365c5a). Also: the promotion-eval-namespace canary's claim was too broad — it proved key-noncollision only; the actual eval-suite→promotion exclusion didn't exist until Task G built it. Canary claims deserve the same adversarial reading as code.
- REMAINS: Daniel's 5 morning gates in MORNING-REPORT-WAVE2.md (rule-8 pick, manifest blessings, maintainer first fire, residue, merge-later); Wave-3 candidates in docs/proposals/agent-arch-reconciliation.md.

## 2026-08-21 — Dashboard v3 P2 run (boss session, codex-only; Daniel away, no gates)
- INFRA: codex-cli 0.149 rejects `approval_policy = "untrusted"` at config load → dispatch preflight read it as "auth stale". Fixed repo `.codex/config.toml` → `on-request` and made the preflight pass the same `-c approval_policy=never` spawn uses (`432a49db`). Diagnose "auth stale" by running plain `codex login status` first.
- WORKED: plan cycle r1 → full adversarial review (sol) → r2 rewrite → review 2 → targeted patch → scoped opus verify = SHIP in 4 rounds (~3 h). Boss findings the reviewer missed twice: spec §6 "Seeded System schedules" (7 seeds + Grader/Hygiene mappings) — read every spec section the phase's "In" list names, not only §10.
- WORKED: contract-first W0 (declarations only, compile assertions) before a 5-wide parallel wave; a shape audit of W0 against plan §3 (Sonnet) found 4 mismatches the presence-check verifier missed — verify SHAPES, not presence.
- LEARNED: codex-terra first passes were green-but-shallow every time (W1 9 tests, W2 15, W5 11 for sections the plan loads heavily; invented "real-sanitized" fixtures; a subject check that accepted any string; mojibake `Â·` asserted by its own test). Sol (W3/W4) delivered 3–5× the depth. Rule: every terra unit gets a Sonnet DEPTH verifier (coverage table per contract clause) + a `b` round; sol units get an Opus adversarial pass (W3: 9 real defects incl. ceremony not bound to expiry, redaction bypass for provider events).
- LEARNED: a brief written before the plan's final revision drifts (W0 brief said `types.ts`, plan r3 said `p2Contracts.ts`) — re-read the plan's ownership row when writing each brief after a patch round.
- LEARNED: codex writes non-ASCII literals as mojibake on Windows; builder-common now requires `·` escapes + byte verification.
- STATE @ 19:00: tip `31a957fa` = W0/W0c, W1, W2, W5 committed; W3b (sol, 12 fixes) and W4 (opus verify) in flight; then W6.1–W6.6 serial, gates, build review, browser.
- 2026-08-22 ~07:00 interim: W6.1–W6.4 cut over (tip `b49139ad`); each serial vertical = sol build (55–90 min, two hit the 90-min ceiling while running their own final checkpoint — work was complete; harvest + boss checkpoint recovered it) → sol read-only review (5–7 HIGH each: live SSE was a one-shot replay, scope check by identity, builder bypassing the durable path, receipt fallback when resolver returns null, mutations open to any session subject, pause-sentinel path hidden across segments) → sol fix round → Sonnet scoped verify (CLEAN each time) → boss checkpoint in `dv3-gate` (main checkout's `index.test.ts` is red only from ACL residue EPERM; `dv3-gate` is the oracle) → commit. Linux-only break found by running the WSL gate: CRLF-hashed declaration provenance → `normalizedTextSha256` (`57bf4c66`). P3 plan SHIP after r1→review→r2→review→r3→review→patch→opus verify (`0adb36b6`); rulings: children may reach the network/broker never listens, server-composed launch recipes, operator+browser-ref principals, VM worktree root → `/var/lib/kb-shell/worktrees`, two-phase attempt start, dead managed broker removed. Codex worktree `node_modules` from the sandbox are ACL-locked for the boss; run checkpoints in `dv3-gate` by applying the patch. Worktree dirs with `.npm-cache` residue need elevated delete (list in handoff).
- 2026-08-22 ~09:30 close: P2 W6.1–W6.6 cut over @ `a01be336`; Windows gate green modulo the reconciliation load timeout; Linux 3 real reds with W6.7 in flight (palette aria-label regression hidden by a repointed test — reviewers must classify every test edit as contract-change vs repoint; Retry must copy the predecessor's identity; fixture host; quadratic test fake). Process laws that held all night: sol for every non-trivial unit; every unit gets an adversarial review + fix round + Sonnet scoped verify + boss checkpoint in `dv3-gate` (codex worktree `node_modules` are ACL-locked for the boss); `git apply --3way` STAGES → `git reset --hard HEAD` before re-applying a superseded patch; gates launch from a scratchpad `.cmd` (cmd /c strings trip the classifier) and `Start-Process wsl` drops script args (use the default tag); Linux reds come from EOL/host-identity classes — run the WSL gate at every vertical, not only at closure. Verticals: add "stop at 80 min and report" to the brief (two hit the 90-min ceiling inside their own final checkpoint). Handoff: `handoffs/2026-08-22-dashboard-v3-p2-built-p3-planned.md`.

## 2026-08-22 PM — Dashboard v3 P2 close run (boss session, codex-only; Daniel hands-off)
- ROOT CAUSE of "incredibly slow" W6.7 (killed at 14:25 after 4.5 h): the sol worker ran 107 read-only commands and never edited a file — one repo-wide `rg` dumped 533 KB into its context on step 10, every later turn crawled (~2.5 min/step), plus a mid-run network drop (DNS "No such host" ×3). Not a review loop, not an infinite loop: a read loop with self-inflicted context bloat. The dispatcher's 4800 s timeout never fired because the harness had killed the python parent (orphaned codex child) — same class as [[detached-codex-dispatch]].
- FIX THAT WORKED: every brief now carries a **READ BUDGET** block (closed list of readable files by line range; forbidden: preamble/CLAUDE.md/_index/orgs/memory, repo-wide rg, any command >200 lines of output; "first edit by command 12/15"; "stop at 70 min and report"). Same task, same model: first edit by command 8, done in 36 min (vs killed at 270). Build review 31 min, build-fix round 41 min, follow-up 5 min. Keep this block in every codex brief.
- WORKED: detached `Start-Process py … codex_dispatch.py` + a bash `Monitor` on the pending marker (marker gone = done; tail the `.out` footer) + a pid-only keep-awake lease per dispatch parent (`keep_awake.ps1 -Acquire -Mode pid-only -ProcessId <marker pid>`), released on pid exit. Monitor byte-counts need the log path pre-resolved (don't convert the marker's backslash path inside the loop).
- WORKED: running the P2 adversarial build review in PARALLEL with the W6.7 fix round, with the seven in-flight fixes listed as "do not report" — disjoint file sets, `git apply --3way` composed both in `dv3-gate` with no conflict. Review found 2 real blockers (schedule socket could not restart: no RuntimeDirectory + stale-socket refusal; release activation tolerated missing attestation sidecars) + 4 majors; none overlapped W6.7.
- WORKED: Sonnet scoped verifier on each patch (classify every test edit contract-change / restoration / repoint; "would it go red on revert?") found a real platform-blind test (Retry predecessor host == Windows bootHost) that the worker's own green checkpoint hid; the codex follow-up proved red-on-revert/green-restored in 5 min. Follow-ups into a `--worktree` dispatch must be a FRESH dispatch with `--cwd <worktree>` (follow-ups drop cwd).
- LEARNED: running the Windows full gate and the WSL gate concurrently produces 4 load timeouts (8–60 s tests); all green alone at `--maxWorkers=1`. Stagger them, or accept the rerun-alone rule. Linux gate on this box is ~3 min with a warm `npm ci` — run it at every vertical, it is nearly free.
- STATE: `80d11d51` = P2 W6.7 + build-review fixes; Windows gate clean (4 load timeouts rerun green), Linux 279 files / 3215 tests / 0 red. Browser check in flight, then P2 close, then P3 W0 (brief v2 staged with the read budget).
- LEARNED (cost: ~6 h idle, 17:31→23:35): I ended a turn right after a commit with NO monitor/agent armed, so nothing woke the session until Daniel nudged it; meanwhile every keep-awake lease expired (session lease is idle-expiry 15 min; pid-only leases released with their dispatch pids) and the supervisor exited. Rules: (1) never end a turn without a pending Monitor/agent or the task list finished; (2) for a hands-off run take a pid-only lease on the boss session's own claude pid (`keep_awake.ps1 -Acquire -Mode pid-only -ProcessId <claude pid>`, 16 h cap) so waits don't disarm the machine; (3) check `keep_awake.ps1 -Status` after any gap.
- CLOSE 2026-08-23 01:20: **P2 CLOSED @ `9a72bbf8`** (chain `1521b61e` W6.7 → `80d11d51` build-review fixes → `41dfd567` browser fixes → `9a72bbf8` browser round 2). Linux 279 files / 3219 tests / 0 red; Windows typecheck 0 + build + all load-timeout files green alone. Browser: nine `p2-*` scenarios, three fix rounds, final re-check 2/2. Handoff: ops `handoffs/2026-08-23-dashboard-v3-p2-closed-p3-w0.md`. Next: P3 W0 (`scratchpad/dv3-p3-w0-brief-v2.md`).

## 2026-09-03 — figment anchor-first pivot + pod-harness hardening (boss session)

- **Prompt casting bracketed the target in two rounds and could not land it.** Over-glam
  ("bronzer, glossy lip") then plain ("almost no makeup, slouched"). Prettiness must be named;
  body adjectives are weak; colour words render literally. The operator's actual taste (three
  screenshots) is ABG glam, heavier than the study's averaged centre — get the taste anchor
  from the operator's own images before a study averages it away.
- **The operator's pivot is the lesson: a face is a reference image, not a paragraph.**
  Anchor → one-reference expansion (klein) → LoRA. Days of wording calibration were the slow
  route; 10sorlabs' solo pipeline confirms the order (base pic → dataset → LoRA → generate).
- **Every live pod failure today was infra, never the manifest**: readiness on a community
  3090, SSH with no login key (removed SSH entirely; HTTP proxy transport), a secure host that
  GitHub refuses anonymous git (host denylist + tarball fallback), a community host with no
  CUDA driver in-container found only after a 20 GB pull (GPU/torch/comfy-import preflight
  BEFORE downloads). Capture the bootstrap log on failure or you diagnose blind.
- **Fail-closed design earned its keep three times**: watchdog kill, empty-name-scan refusal
  to claim "verified", denylist placement bounces. Two opus passes on spend code found 8+9
  defects; never run spend code on one review.
- **Ledger accounting must be elapsed × rate on early exits**, never the ceiling; two rows
  hand-corrected today.
- **Classifier blocks are topic-keyed, not action-keyed**: Bash heredocs/reads on the casting
  brief were blocked while Read/Edit/Write passed. For sensitive projects prefer file tools
  and get the permission profile set before an overnight run.
- **Orchestration**: detached Start-Process + poll Monitors (tail -F is blind on Windows);
  fresh dispatch with --cwd for worktree writers; SendMessage mid-run to redirect a browsing
  agent works; an opus browsing agent can stall at its first tool call — relaunch, don't wait.

## 2026-09-03 (early am) — figment composites + handoff to the overnight build terminal

- **A face is a reference image, not a paragraph.** Two prompt-casting rounds bracketed the
  target and never hit it; the operator's own Gemini anchors landed the register in one shot.
  Ask for the operator's images before spending days on wording.
- **Klein multi-reference semantics, measured live:** first reference = canvas (its scene and
  body are kept); face swaps onto full-body canvases come out mask-like with a literal liner
  artifact regardless of prompt wording; half-body canvases swap cleanly. Expand at half-body,
  add full-body via a second pass. Three 4-ref cells ≈ 3.6 min each on a 4090 (size the
  watchdog for it).
- **Hosted artifact publish of persona image boards is classifier-blocked; local JPEG/HTML
  sheets opened via Start-Process work.** Put a unique tag (row letter + column + seed) on
  every cell or the operator cannot name a pick.
- **Ops pushes get rejected when another session moved ops mid-work:** cherry-pick the
  handoff commit onto the fresh tip in a new temp worktree rather than re-editing.
- **Git object write "Permission denied" was transient** (another process on the object dir);
  a plain retry succeeded.
- **Mandate discipline paid off:** every operator ruling of the night went into MANDATE.md
  immediately (tier constraint, $50 cap, research-before-training, free rein over the
  purchased package, skin-enhancer adds detail, browsing ruling in GUARDRAILS). The handoff
  then only has to point at it.
## 2026-09-02/03 — Prospecting project: brainstorm → spec (3 rounds) → P1 build overnight (boss session, codex-only)
- WORKED: brainstorm-by-decision: pushbacks first (rent data/own sequencer, no LinkedIn scraping-as-permitted, SQLite not Sheet, desktop=executor/VM=orchestrator, PII never in git), then one option widget at a time. Six research workers (providers, past assets w/ zero PII, cadence, finder lanes, OSS/practitioner → distilled to 10 keepers) fed a spec that survived an 8-blocker adversarial review with all rulings applied in one patch + one verify + one micro-patch.
- WORKED: per-task pipeline in a phase worktree: fresh terra builder → read-only terra reviewer (test-honesty section, "would it go red on revert") → fresh fix dispatch → boss runs suite in HIS shell → commit. Every review found 1-4 real defects (FK drop, approval scope unbound, nonce replay, state bypass, PII in argv, launcher untested). Parallelize only disjoint files; serialize on shared test files.
- LAW: patch briefs for CODE plans must carry numeric preservation constraints (≥N fences, ≥N lines, every manifest test present as code) — codex-deep collapsed a 3.4k-line plan into 800 lines of prose when asked to "apply edits".
- LAW: harness kills long background shells → every codex dispatch via Start-Process + Monitor on the .out footer; Monitors cap at 60 min → re-arm for >60-min workers.
- LAW: stagger dispatch launches ≥20 s; concurrent `codex login status` probes crash (0xC0000409) and the dispatcher refuses with "auth stale/missing". Codex sandbox lies about the host (py 3.12 / no Datasette); verify env facts in the real shell and say so in briefs.
- LAW: a linked worktree inherits core.hooksPath → git runs MAIN's pre-commit, not the branch's; test branch hooks by running the script directly (`bash .githooks/pre-commit`), never via `-c core.hooksPath` (a repo guard blocks it, correctly). Git also redirects hook stdout to stderr — tests must read both streams.
- HAZARD: a demo commit with a fixture email landed on the phase branch before the branch hook could run; reset --hard removed it pre-push. Never demo a blocking hook with a real commit on a shared branch.
- INFRA: Datasette 0.65.1 on py3.13 needs setuptools<81 (pkg_resources); gate must pass `-p no:cacheprovider` (sandbox leaves ACL-locked .pytest_cache) and filter the pkg_resources UserWarning; Popen guards must subclass `subprocess.Popen` (asyncio subclasses it).
- STATE: spec r3 + P1/P2/P3 plans v2 on `claude/boss-2026-09-02`; P1 built on worktree `claude/prospecting-p1` @ bdd13379, host gate passed 80/80; phase review in flight; P1 human gate = Datasette on empty store + hook rejection (scratchpad/prospecting/p1-gate-demo.ps1).
## 2026-09-03 overnight — Gate-4 blocker fix shipped as PRs (boss session, async while Daniel slept)
- LAW (VM CLI entrypoints): `head -c 4` the RESOLVED entrypoint as the shell user before trusting any CLI under the fd-pinned broker. codex's npm bin is a `#!/usr/bin/env node` wrapper that only spawns the native ELF (nested `@openai/codex/node_modules/@openai/codex-linux-x64/vendor/.../bin/codex`); a pinned-descriptor exec cannot run a shebang (the interpreter reopens a dead `/proc/self/fd` path). Pin the native binary through a FIXED candidate list, and make the capability probe use the same resolver so the daemon never advertises what create refuses.
- LAW (headless CLIs under a PTY): `claude -p` refuses a TTY stdin; the shape that works is stdin=pipe + stdout/stderr=pty slave. Doing it right needs work only the child can do between fork and exec (drop the pty master, fresh blocking tty open, TIOCSCTTY, close all fds, FD_CLOEXEC on the exec fd) → a root-owned Python shim run with `-I`, pinned python3 at broker start. Harness assertions that caught real bugs: `PTMX=0 FDS=0,1,2,3\r\n` (line-terminated — a substring match gave a false green), NONBLOCK probe must read fd 2 not fd 1 (`$( )` replaces fd 1 with a pipe).
- WORKED: review-round loop per PR with the SAME opus reviewer resumed via SendMessage for the confirm pass (cheap: ~100 s, 4 tool uses) — round 1 BLOCKED → fix → round 2 confirm + new LOW → fix → ready. Three PRs, seven review rounds, every round found something real.
- WORKED: pre-stage the morning: `morning-rebuild.ps1` builds from origin/main only after verifying it contains the merge shas, then rewrites the deploy script's defaults — one merge, one rebuild command, one deploy command, then the boss takes over.
- HAZARD: opus 529 Overloaded killed a resumed agent twice mid-round; the tree it left was complete (verify with a round-to-round patch diff + compile before deciding to re-dispatch). Sonnet was not affected.
- HAZARD: vitest 5 s per-test caps on Windows/WSL under concurrent load produce 2-4 timeouts per full run (p3DeletionClosure, sessionPersistence caps, store.durability.vm, paidAction #2, canonicalResultEmbeddedPython); ALWAYS re-run each alone (script file via `wsl.exe bash -l /mnt/c/...` with `MSYS_NO_PATHCONV=1`; Git Bash mangles `/mnt/c` and `$(` inside `bash -lc` quoting) before calling anything a regression. WSL idle-shutdown between commands is harmless ("up 0 min" is normal).
- HAZARD: a fresh worktree has no node_modules; a directory junction to a sibling worktree's `dashboard/node_modules` makes tsc/vitest work there in seconds (workers cannot create it — they stop at "cannot run tests").

## 2026-09-03 late — prospecting P2/P4/P5 build night (boss lessons)
- NEVER chain `gate --record && commit && merge && launch-next-gate` in one shell line. A gate that fails or times out still lets the commit/merge/launch run; cost me three killed P2 gates and two bad P1 records. Rule: record → read status → THEN commit, as separate calls.
- Killing a detached gate mid-run can leave a Datasette child listening on 127.0.0.1:8765; the next P1 gate then fails `test_24_launcher_script_serves_readonly`. Free the port (Get-NetTCPConnection -LocalPort 8765 → Stop-Process) before any gate relaunch.
- Full P1 gate (with the nested test_54 self-run) takes 10–15 min on a loaded box. Never run it foreground under `timeout`; always `run-gate-p1.ps1` + Monitor.
- P1 tests must not hard-code phase-dependent facts (schema version == 1, PII sink count 112). Derive from what is present (glob schema_p*.sql; len(VM_SINKS)). Any exact-count criterion in gate_manifest.json is a re-record trap.
- Later phases keep reaching into P1 files (pii_guard sink for P5, store.py for P2/P4). When a P1 change is one line and semantically P1 (a new sink name), fold it INTO P1, re-record, merge forward — never let the phase branch carry a P1 edit.
- Sandbox workers halt on "Python 3.12 / no tzdata"; every brief now carries the ENV NOTE. The T9 worker still stopped once; relaunch briefs prepend an OVERRIDE paragraph.
- Phase-level adversarial reviews (P2, P4) each found the phase NOT runnable end-to-end despite green task reviews: task reviews judge steps, never the workflow. Always run a phase review against Daniel's literal workflow before recording a phase as done.
- Plan text can be wrong about frozen files (P4 T9 told the worker to edit gate.py/gate_manifest.json). Brief generation must inject the frozen-file ruling above the plan text, not rely on it.
- Reviewer 'sink' suggestions that require new pii_guard sinks are refused: keep typed envelopes with existing kinds; only fold a sink into P1 when it is semantically P1.

## 2026-09-03 — figment creator-001 overnight build terminal (boss session, in progress)

- **Both providers can be down at once.** Opus returned 529 three times in an hour (spec fold, P0R review);
  codex returned backend 404 on all four parallel build dispatches. Fallback that worked: sonnet for folds
  and builds, sonnet for the P0R review with an opus pass owed before the training pod. Resuming a 529'd
  Claude agent via SendMessage works once, then it dies again; check the partial file state and finish with a
  fresh cheaper agent instead of resuming twice.
- **Three concurrent codex dispatches wedge the 15 s `codex login status` check** (11 s alone). Raised the
  timeout to 60 s in `scripts/codex_dispatch.py` and stagger dispatches 25 s apart.
- **`--follow-up` still loses `--cwd`** (memory said so; I repeated it once). Writing follow-ups = fresh dispatch
  with `--cwd` and a self-contained brief.
- **Windows path length breaks the harness ledger tmp file** (>260 chars) when pytest's temp root is under
  the deep scratchpad path; and pytest temp roots created by another process are ACL-locked. Use a short,
  fresh `PYTEST_DEBUG_TEMPROOT` per run (`C:/Users/danie/AppData/Local/Temp/kbfp-<n>`).
- **Measured numbers beat the spec's guesses:** a 3-ref klein 4B cell is 157-165 s (first job 215-260 s), not
  "seconds"; the composite run.json files had it all along. Read the run records before sizing pods.
- **The 10sorlabs package's real value was in the files, not the videos:** all eight workflow JSONs carried
  the numbers r14 called unrecoverable; the MCP video server crashed on whisper, and faster-whisper (already
  installed) transcribed nine lessons on CPU in ~40 min. Claim-checks against the narration corrected 7 rows.
- **Two adversarial rounds on the spec were worth it**: v1 REJECT (network volume was unledgered recurring
  spend; safety axes missing; no T2 card before spend), v2 REJECT (run shape had zero slack over the measured
  cold job; phases mislabeled gate-independent under the contract). v3 built.
- **One card per session wave, not per subagent** (card-schema granularity rule); write it via a temp
  worktree on origin/ops and `git push origin <sha>:ops`; the push can take >60 s — run it separately from
  the worktree-add step.
- Chrome-devtools consent is per MCP-server connection: subagents inherit it; no re-prompt observed all night.
- **(close) Live run facts for next time:** 6 ephemeral 4090 pods × 10 klein 3-ref cells = 31 min and $0.38 each,
  159 s/cell steady; total $2.28 for 60 cells. A sequential driver script (verify run.json + ledger before the
  next create) let the pods run unattended for 3 h while I did nothing — build it before the first create.
- **Background Bash shells get reaped mid-download**; anything > 2 min (weight downloads, scoring) runs via
  `Start-Process` + an exit Monitor, never `run_in_background`.
- **Missing runtime deps surface only at the live step**: `facenet_pytorch` was absent for `py -3` although the
  tests (mock embedders) were green. Add an import smoke to the plan's preflight for any lazy-loaded model.
- **Harvest/apply left quarantined files in `images/` and the batch stage at `building`**: the board was built
  from 60 not 56 until I moved them; stage transitions are strictly one step. Put the file move and the stage
  steps INTO the harvest/apply CLIs, not in the runbook.
- **Identity drift is real and measurable**: anchor cosine median 0.68, six cells < 0.32 (flash/low-angle and
  replicate families). Expect the eye-gate to cull ~10-15 of 56; 40 curated is still reachable.

## 2026-09-04 early — P6 build + P7-UI planning (boss lessons)
- Integration night: five gates recorded on one tree (P1 122, P2 205, P3 289, P4 183, P5 562). Every cross-phase collision was a NAME: shared fixture filename (P2/P3), eval-card directory (P3 personalizer/ vs agent-id dirs), card `test_file` refs renamed by later fixes, parametrize ids with backslashes corrupted by the manifest filler. Rule: per-phase namespaces (agent-id dirs, phase-prefixed fixtures), explicit parametrize ids, and a card-ref collect check before every gate.
- `pytest.raises(Exception)` around a guard call is vacuous (unknown-sink ValueError also matches). Always assert the guard's own error type.
- Workers keep editing frozen earlier-phase files when the plan names them (P4 T9 gate.py; P6 T3 campaigner/cli.py). Verify `--verify-recorded` for every earlier phase in the worktree BEFORE committing any later-phase task.
- Foreground `timeout N` around a gate + `&&` chains bit me four times: a failed/killed step still let commit+merge+launch run. Every launch is now gated on parsed test output ("N passed", "missing []"), and gate runs are always detached with a Monitor.
- Planning workers must run INSIDE the integrated worktree: the first P7-UI plan was written on the boss branch (no scripts/prospecting) and got a REWRITE verdict for guessed columns/argv; the rewrite in the P6 worktree got PATCH.
- Review briefs generated from plan text name plan-invented files; when the build deviated by ruling, prepend a REVIEW CONTEXT header naming the real files or the review is wasted (P6 review-6 → 6b).
- Time-dependent tests (wall clock vs fixture window) pass at build time and fail hours later; every CLI takes --now and tests inject it.
- **(expansion-03 lesson) Identity holds when the model EDITS the reference, not when it generates from a prompt.**
  60 free-generation cells with long scene prompts = different women (cosine 0.68). The same graph with the
  target anchor as canvas and a ≤25-word "same woman; one change; same room" prompt = same woman (0.86). img2img at
  0.28-0.35 = near-copies (0.99) that ignore the instruction. Calibrate the floor from the anchors themselves
  (pairwise 0.89-0.93) before setting any threshold; a 6-cell paired A/B pilot ($0.62) settled the mechanism.
- **Pilot the cell before the batch.** $2.28 was spent on a method never validated at cell level; the review
  rounds checked arithmetic and safety, not whether one cell looked right. One cell, then ten.
## 2026-09-03 day — Gate 4a end to end; eight deploys; the "run the real thing" lessons
- LAW (wire drift): a client `exactDto` and a server projection are a cross-tier invariant; every "invalid run detail" today was the server having grown fields (envelope decorations, stage/attempt lineage, human response, iteration receipt) with no test that fed the REAL served body to the REAL client decoder. Diagnose with the real decoder on the live JSON (WSL: copy a test into src/control/, `decodeRunDetail(live)`, bisect by emptying lists then per row) — never by reading key lists; single-key drops are blind when several keys drifted at once. Fix = golden fixture from the live envelope + a guard that builds every list through real producers and asserts both drift directions.
- LAW (T3 on the VM): approvals need Daniel's passkey by construction; the boss cannot approve (curl 403 ceremony-unavailable; a driver's attempt was also classifier-blocked). Enrolment is three-phase (RP-origin drop-in, browser DevTools snippet with Windows Hello, append the public credential), `passkey-enrol.ps1`. The Approve control lives in Run detail (Workflows -> run), not the Inbox.
- LAW (PowerShell -> ssh): never inline-quote a remote script in a PS string; write an LF file and run `cmd /c "ssh host bash -s < file"` (PS pipes append CRLF; Get-Content -Raw + Replace still leaks a trailing CR). Verify with a real `-File` run, not an inline `-Command`.
- LAW (deploy ceremony): unit files and resident validators are NOT part of a release deploy (only bootstrap converge); the desktop deploy script must carry the unit step and refuse on a wrong effective UMask. Preflight FAIL filter must match `^\s*FAIL\s`, not the summary line.
- HAZARD: a dirty VM ops checkout (an untracked wake-me card written straight by the queue bridge) blocks the drain reconciler; check `git -C /var/lib/kb/ops status --short` before the ceremony.
- WORKED: same-agent resume for review confirm passes; opus builder + opus reviewer per PR; sonnet driver for launch evidence with explicit STOP conditions and "no early stop" when a human is mid-click.
- HAZARD: three "approved" reports in a row never landed because the page could not render the gate; before asking the human to retry, prove the UI path (bundle grep + real decoder on live JSON), then ask what the page shows.

## 2026-09-04 evening — first real vendor run (boss lessons)
- Fixture dates are time bombs: P1 contract fixtures expired at 2026-09-04T00:00Z and the schema trigger compares expires_at to julianday('now'); P6 scope windows were pinned to the build day. Rule: fixture windows/expiries live in 2099 with the injected `now` moved alongside; any validation that reads the wall clock when a `now` was supplied is a bug. Re-record any phase whose fixtures carry near-term dates before the day rolls over.
- The first real desktop run exposed a design gap no review caught: the manual lane captures FIRMS, the LinkedIn lane only snapshots URLs already captured, so 30 firms → 0 people. Nothing discovered people at a firm from an API. Fix = a P6-owned Snov domain-search lane through the P2 lane registry; and P2's list builder had to learn to honour its own registry. Phase reviews judged code against the spec, not against "run it on 30 real firms" — the human gate found it in one command.
- Vendor adapters built from memory + synthetic fixtures were wrong twice (Snov v1 domain search is retired; v2 domain search returns no emails, only a per-prospect `search_emails_start` link; both email finders are async start/poll). Rule: before any vendor adapter brief, the boss probes the live API once with Daniel's key and ships the MASKED response shapes (keys + types, values redacted) in the brief. One credit beats three worker rounds. Never paste raw vendor responses to a worker (PII → third-party model).
- Later phases must never ALTER a P1 table (P6 added `api_version` to provider_attempt and broke P1's `SELECT *` → frozen dataclass round-trip). Extensions are side tables keyed by the P1 row id. Add this to every P6+ brief header next to the frozen-file rule.

## 2026-09-04 night — fill converges wrong; positions filter root cause
- HAZARD (2026-09-03 afternoon): a first-turn `find ~ -maxdepth 4` probe that timed out left six MSYS `find` zombies; hours later the Bash tool stalled (trivial greps >120 s, git commit >5 min, codex auth probe wedged → dispatch refusals; workers' own shells hung mid-task). CPU load was 0 — the MSYS runtime, not the CPU, was wedged. Fix: PowerShell `Get-Process find | Stop-Process -Force` + kill the parent bash PIDs; bash returned instantly. Rule: never run unbounded filesystem walks from the Bash tool; if bash stalls while PowerShell works, look for MSYS zombies first.
- LAW: full-suite pytest runs inside a phase worktree can recurse (a prerequisite test invoking the gate, which runs pytest) — keep `--verify-recorded` hash-only and never let a test call the gate in-process; nested runs also break `record_property` sums (test_49). Gate runs >5 min go detached with a monitor, never in a foreground Bash call.
- "Operator fill" shipped green on fixtures but did nothing on a fresh real store (evaluated people that discovery hadn't produced). Briefs for orchestration loops must state the precondition explicitly ("assume an EMPTY store") and the test must start from an empty migrated store, never from a pre-seeded one.
- LAW (vendor filters): Snov v2 domain-search `positions[]` is an exact-string match — it returned 0 prospects for 25/42 real VC firms while the unfiltered search returned 20/page. Never delegate a semantic filter to a vendor; fetch broad, classify locally, bound pages. Probe the filtered vs unfiltered call side by side BEFORE building any vendor filter into a lane.
- HAZARD (status enums): a fill loop that only recognises `met / no_confident_email / candidate_exhausted` when candidates exist labels a zero-candidate exhausted firm `discovery_pending` forever; the second pass then does 0 work and reports success. Every terminal state needs a test on the EMPTY case, and a converged store must re-run as an exact no-op.
## 2026-09-04/05 — Gate 4b: probe-first, batch, one deploy per batch
- LAW: before launching a never-run leg, reproduce the broker's exact argv on the VM as the worker uid (scratchpad probe-codex.sh pattern: pipe stdin + pty stdout, same env, same cwd shape). Probes found the dead `--cd` and the missing EOF in 10 minutes; each would have cost a deploy cycle.
- LAW: a builder's numeric ceiling must be derived from the ledger (execution-accounting/*.json maxima), never from a remembered figure; the reviewer refuted 400k with 1.22M on disk.
- LAW: any comparison against a worker-reported field is suspect; both real adapters leave `artifacts` empty by design and the engine must read its own git inspection (`changed`).
- LAW: every unit that spawns workers needs UMask=0002 (dashboard AND broker); assert both in preflight and the deploy script.
- LAW: prompt contracts must state validator rules verbatim (positions/recordedDissent only on consensus/continue); a checker that follows the advertised shape must not fail the run.
- HAZARD: `git worktree remove --force` follows a node_modules junction and empties the shared install; delete the junction first (memory: worktree-junction-hazard).
- WORKED: manager role launches no process (engine drives in-process): read the adapter before assuming a leg exists.

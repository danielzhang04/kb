# Roster delivery fix-wave — resume for the boot-handshake wave — 2026-07-31 late

**Topic:** Closing out PR #109 (roster delivery hardening for the FYT gated pipeline). Facts 4 & 5
are CLOSED (harness 7/7). Two adversarial reviews then found the delivery/engagement seam still
fragile; Daniel approved a full fix wave + a server-minted boot-ready handshake. **The wave is NOT
yet dispatched — that is the exact next action.**

## State right now

- Branch `claude/fyt-full-run` @ `b965454`, worktree `C:/Users/danie/kb-worktrees/boss-fyt-run`,
  **6 commits ahead of origin/main**, pushed. **PR #109 OPEN — HELD, do NOT merge** (its body still
  describes only the first 5 fixes; body needs a rewrite before merge).
- Operand worktree for the dry-check harness: `…/161e0c0f-…/scratchpad/dry-check-repo`, detached,
  node_modules junctioned. Retarget it with `git -C <that> checkout --detach <new-sha>` (the one
  git carve-out on that throwaway; NEVER point a daemon's DASHBOARD_REPO_ROOT at a live work branch).
- Harness run line (from `…/161e0c0f-…/scratchpad/dry-check/`):
  `node run-dry-check.mjs --fresh --slug dry-check-2026-08-01` with `DASHBOARD_EXECUTION_ACTIVATED`
  UNSET, port 4519 free. Pre-create `state/proceed-to-retire.flag` after the Fact-5 verdict prints
  to skip the 20-min Fact-8 hold.
- Weekly cap ~90%+ used, resets **Aug 1 9pm America/New_York**. Codex-side work (build, review) costs
  NO Claude cap; only the live harness re-run does — hold that for after the reset.

## What is DONE (with evidence)

- **Facts 4 & 5 CLOSED — harness 7/7 PROVEN** (run `run-3776411c`, idea stage succeeded 140.6s;
  marker matched by the real matcher, brief.md verified server-side, DAG halted at G0). Five delivery
  bugs fixed en route (commits `2997783` skills-manifest, `e1ae7ca` MCP-disable+deny-floor,
  `054e8ab` marker line reconstruction, `4085b4f` split scan/screen streams, `9d0e3bc` settled
  readiness). This is the passing baseline.
- **Completion rearchitecture committed `b965454`** (Daniel's "rearchitect now" ruling on marker
  forgery): completion moved OFF the parsed terminal onto a server-owned, per-delivery, token-bound
  status file `<runDir>/<agentId>/status/<stageId>.json`, cleared before each delivery; MARKER regex
  + matchCompletionMarker REMOVED; artifact-delta gate retained as backstop. Plus F1/F3/F4/F5/F6/F7
  from review #1. 71 tests, tsc clean. **This commit has NOT been live-run or re-reviewed clean.**

## Two adversarial reviews are recorded (both DO-NOT-SHIP)

Review #1 (of 9d0e3bc) card `6a6c5446-f782fa46`; Review #2 (of b965454) card `6a6c6161-0a9f67df`,
codex session `019fb74a-bbbe-77a2-8d14-9e8b07610579`. **Review #2's 9 findings are the fix-wave
work-list.** Full text in that card's Result on ops (queue/done) + the codex JSONL log
`C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6a6c5cd9-18872b6d.jsonl`. Summary:

Mechanical (7 — all clear-cut, all in `dashboard/server/control/rosterSessions.ts`):
1. **HIGH F1 argv** — `--mcp-config <configs...>` is VARIADIC in CLI 2.1.220 and swallows the
   binding prompt → breaks EVERY delivery. Fix: reorder to `--mcp-config "<file>" --strict-mcp-config
   "<prompt>"` (put the variadic before the flag that terminates it, prompt last). `defaultLaunchLine`
   ~line 1111. **This one alone would fail the next harness run — do first.**
2. **HIGH busy-marker split across pty chunks** — F7 carries only incomplete CONTROL seqs; a
   plain-text `esc to interrupt` split across two chunks is missed → engagement never advances →
   duplicate order re-submissions (duplicate spend work). Need bounded semantic overlap for
   busy-marker recognition (`hasBusyTransition` ~1493 / BUSY_MARKERS ~708).
3. **HIGH pending lease too late** — two same-agent stages via engine `Promise.all` both see
   `entry.pending===null` and overwrite → deadlock; also retire-during-await can recreate token
   files under a dead run. Reserve the session lease BEFORE the first readiness await; revalidate
   run/session liveness after each await before any fs write.
4. **HIGH status-dir junction → external deletion** — `ensureDir(recursive)` accepts a junction at
   `status/`, then `rmSync(status/stage.json)` deletes the junction target. Reject reparse
   points/symlinks in every path component; operate through a verified canonical parent.
5. MEDIUM poll boundary — a valid status written just before the deadline is lost (last poll
   scheduled past the deadline fire). Do one final synchronous read in the deadline callback.
6. MEDIUM F7 unbounded malformed CSI suffix — `ESC [` + digit-only chunks grow unbounded, quadratic,
   permanent `settling`. Cap suffix length / retain parser state, fail closed.
7. MEDIUM (pre-existing) artifact gate follows symlinks — worker can create a declared-absent
   artifact as a symlink to any nonempty file; `statSync` follows, accepts without hashing. Use
   `lstat`, reject links/reparse, hash through a no-follow handle.

Design (Daniel's rulings this session — BUILD these into the wave):
8. **Boot-ready handshake (Daniel: DO IT)** — the engagement heuristic can still credit the boot
   binding turn's spinner to our order (review #2 finding 4). Kill the class: have the binding
   instruct the agent to write a server-watched boot-ready sentinel (e.g. `<agentDir>/ready.json`)
   AFTER it reads+accepts binding.md, then wait. Server gates first delivery on that sentinel
   (boot provably done) rather than scraping the footer; between stages, the prior stage's completion
   status already proves the terminal went idle. This lets engagement trust that any busy after
   delivery is OUR order, and retires the fragile footer-readiness/settled heuristics as PRIMARY
   signal (keep modal-detection + settled-quiet as secondary safety — a mid-turn permission modal
   must still park). Design it as the same file-channel pattern already accepted.
9. **Cross-agent status forgery — Daniel: ACCEPT AS KNOWN LIMITATION.** Under auto mode an agent can
   `cat` a sibling's order file, read its token, and write the sibling's status → forge a
   zero-artifact stage's completion. These are cooperative same-user agents of ours; the artifact-
   delta gate blocks any forged DONE that promised files. DO NOT build isolation/IPC. DO document the
   residual (zero-artifact/gate stages) in a code comment at the status-poll site AND in
   `orgs/faceless-youtube/knowledge/decisions.md` (or the dashboard decisions log) so it is not
   silently re-litigated.

Review #2's "checked and sound" list (do NOT redo): old marker prose inert; prior-status cleared
before token exposed; torn/invalid/wrong-token JSON ignored; timers identity-guarded; status perms
exact per stage (no sibling wildcard); strict-MCP mode DOES ignore other configs (only the argv
ORDER is wrong); F4 CUF→space and F5 recheck correct; F7 does not cross a session boundary.

## Exact next actions (in order)

1. **Dispatch the fix wave** — one codex-deep xhigh brief in `boss-fyt-run` (single writer = boss
   lease, `--cwd`, NOT `--worktree`; `--timeout 3600`). Cover findings 1–8 with a reproduction test
   each (must fail on b965454, pass after) + the finding-9 documentation. Spec the boot-ready
   handshake precisely (it is the load-bearing design — do not leave it open). Boss commits; worker
   never commits. Verify each diff + rerun the test file + tsc yourself before committing.
2. **Adversarial re-review** (fresh codex-deep xhigh, read-only) of the wave — builder self-"PASS" is
   never review-clean (held true both prior rounds; each round found real HIGHs).
3. **Update the dry-check harness** for the new channel BEFORE the live re-run: Fact 5's proof moves
   from the pty marker to the status file; the boot-ready handshake means real terminals now write
   `ready.json` then `status/<stage>.json` (they follow binding.md, so the daemon change drives it —
   but the harness's Fact-5 ASSERTION must check the status file, not `matchCompletionMarker`, which
   is deleted). Harness lives at `…/161e0c0f-…/scratchpad/dry-check/run-dry-check.mjs` (+ lib/).
4. **Live harness re-run after the Aug 1 9pm cap reset** — retarget the operand to the wave's HEAD,
   run, confirm 7/7 still green through the new channel + handshake. THEN rewrite the PR #109 body to
   describe the full change set and hand the merge to Daniel (his gate).
5. Then **task #4: propose the maiden video run** (Daniel's G2/G3b spend + G4 publish gates).

## Load list
- this file
- `handoffs/2026-07-31-fyt-pipeline-shipped.md` (Facts 4&5 closure detail + harness setup)
- `dashboard/server/control/rosterSessions.ts` (the whole delivery seam; completion ~1344/1782,
  engagement ~1840, launch ~1108, strips ~437/464, scope ~900) + `rosterSessions.test.ts`
- Review #2 card `6a6c6161-0a9f67df` on ops (queue/done) — the authoritative finding list
- `memory/claude-boss.md` (bug-isolation-night lessons, codex-dispatch gotchas)
- personal memory `fyt-gated-pipeline-arc`

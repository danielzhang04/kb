# Handoff: cloud migration — build DONE, parked at Daniel's Wave-0 gates

**Written:** 2026-08-06 evening, boss session (Fable 5) closing after autonomous run-out.
**Arc:** move ALL kb compute to a Linux cloud VM reached over Tailscale + SSH `-L`
(origin stays `localhost:5317`, passkeys unchanged). Public web app deferred.
Pilot-first ruling: hourly-billed shared-CPU box (~$20 total for 2 weeks) before any
monthly commitment.

## Load list (read in order)
1. `docs/superpowers/specs/2026-08-06-cloud-migration-design.md` (branch `claude/cloud-migration`)
2. `docs/superpowers/plans/2026-08-06-cloud-migration.md` — Wave 0 runbook = Daniel's next steps
3. `docs/superpowers/specs/2026-08-06-atlas-remote-audio-design.md` (Atlas = after cutover)
4. `docs/research/2026-08-06-agent-platforms-memo.md` — verdict keep homegrown; steal-list
5. `docs/runbooks/2026-08-06-wave3-cutover.md` — cutover, HUMAN/AGENT-marked
6. Memory: `memory/claude-boss.md` (this session's lessons at bottom)

## State: branch `claude/cloud-migration` (pushed, tip 8ebc337, cut from main a2e6e2b)
ALL Wave-1 build work landed, graded, green:
- 1a `496a522` codex_dispatch POSIX (killpg group-kill, /proc liveness, XDG state root; one `WAVE-4-DELETE` win32 branch)
- 1b `506af81` pythonInvocation()/kbStateDir() resolvers, all runtime spawn sites converted (+ fixed a pre-existing main defect: stale agent_runner consistency assertion)
- 1c `75a9a00` systemd substrate (deploy/systemd/), runner trigger/liveness POSIX, agent_runner.ps1→.sh/.py, desktop/sentinel/keep-awake scripts RETIRED (−3,995 lines)
- 1d `8ebc337` PTY retired (−11k lines, node-pty/xterm gone), pm2Entry→serviceEntry, comment sweep, governed-run surfaces REBUILT in WorkflowDetail/AgentDetail (over-deletion caught + repaired)
- docs `8998700` scripts/vm_verify.sh (Wave-0 exit test) + Wave-3 cutover runbook
Evidence: full pytest 684 pass; dashboard src/ 549/549; tsc baseline exactly 7; vite build ok. Known LOAD-FLAKES under full-suite parallelism (pass in isolation, not defects): canonicalResultEmbeddedPython, queueBridge tick tests, authorizedFailedRunReconciliation, synthetic-acceptance, store tampering.

## Daniel's open gates (present ONE at a time)
1. **SSH key**: `! ls ~/.ssh` then `! cat <key>.pub`, or generate
   (`! ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub`).
   Hard-ceiling hook rightly blocks agents from ~/.ssh — Daniel runs these himself.
2. **Provider pick** (asked, unanswered): Hetzner CPX41 Ashburn (pilot = eventual home)
   vs GCP free credits ($0 pilot, re-provision later). Daniel also relaxed the API-key
   doctrine in principle ("don't really care as long as end goal") — boss argued
   subscription stays 5–20× cheaper for fleet volume; keys OK for capped glue only.
3. **Order the pilot box** + Wave-0 runbook steps 2–6 (Tailscale auth link,
   `claude setup-token`, `codex login --device-auth` are hands-on-keyboard).
   Then reboot + `scripts/vm_verify.sh` — if the codex keyring check FAILS post-reboot,
   STOP: fallback (protected auth.json) is a doctrine exception needing Daniel's ruling.
4. After Wave 0: Wave 1-final Linux acceptance (clone branch on VM, systemd up,
   bridge tick + one governed attempt, full vitest on Linux), then Wave 3 cutover
   runbook, then Wave 4 decommission. Atlas plan starts only after cutover.

## Prior-arc leftovers still open (from the dashboard-ux session this continued)
- **W7 merged to main but NOT prod-deployed**: dashboard-prod worktree not fast-forwarded
  /rebuilt/restarted since #116; the full-flow acceptance (one `workflow-def: video-run`
  card → whole pipeline as ONE run w/ live graph) never ran. NOTE: cutover to the VM
  supersedes local prod-repointing — decide there.
- Probe run `run-92d33b09` parked at credential-language policy gate (waiting-human).
- Six eng-fold cards set `blocked` need triage/delete; policy wording-gate tuning owed.
- Bridge cards bind `assignment: null` (W7-F6, fail-closed routing divergence, accepted).
- An orphaned repair dispatch (card 6a750dd0-16416110) died mid-verify after finishing
  its work (harvested + committed); the NEXT codex dispatch's startup sweep will publish
  its `FAILED: orphaned` card — that is EXPECTED, not a live failure.
- Two ~18h VS Code claude sessions (PIDs 35536/47672, ~1GB) — 47672 holds the
  keep-awake lease `boss-cloud-overnight` (pid-only); killing it drops the lease.
- `memory/root.md` untracked in main checkout + worktrees — left alone, not mine.

## Worktrees
`boss-cloud-migration` = the arc worktree (KEEP until branch merges). This temp ops
worktree is removed by the writing session. All other session worktrees already swept.

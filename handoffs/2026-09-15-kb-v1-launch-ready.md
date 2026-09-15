# kb v1 launch — PR #185 ready; rehearsal proven; morning ceremony — 2026-09-15

**Topic:** Overnight boss run (Fable 5.1, Daniel asleep, no self-merge) executing `handoffs/2026-09-14-kb-v1-launch.md`. Goal: a working, reusable KB v1 on the VM for the Wednesday interview demo. Result: PR #185 (`claude/kb-v1-launch` @ 359aa810, stacked on #173) with CI green, two opus review rounds folded, the whole demo path proven live on a disposable rehearsal host through the real broker, and a unified deploy script that passed first-time on that host via the daemon-down path prod needs. Desktop lane units 1-2 in draft PR #186. Prod VM is still down (since 09-06) — it comes back with the morning ceremony below.

## Morning ceremony (Daniel + boss, in this order)
1. **Daniel:** merge PR #173 (hydrate fix, rebased; MERGEABLE), then PR #185 (CI acceptance green).
2. **Daniel:** paste the ssh allow rule into `.claude/settings.local.json` (text in the boss session's first message of 2026-09-15) or run the deploy yourself; the classifier blocks the boss from prod ssh and from editing that file.
3. **Boss/Daniel:** `powershell -NoProfile -ExecutionPolicy Bypass -File "<scratchpad>\morning-rebuild-v1.ps1"` (refuses unless origin/main contains 9270138b and 359aa810; builds on WSL from origin/main; prints Sha + BrokerDigest).
4. **Deploy (recovery path, daemon is down):** `kb-deploy.ps1 -SigningKey <release signing key path> -Sha <sha> -BrokerDigest <digest>` (prod defaults: root@100.89.73.118, https://kb.tail82dd4f.ts.net). Steps: prep+backup → validator pre-install → sign/upload/activate → VERSION flip → daemon active → validator+reconciler refresh (systemd-run probe) → broker verify → health 200 / admission 404-or-503. Rehearsed 4× on kb-rehearsal; last run passed whole first time.
5. **Interrupt the stale run** `run-971d5ba4` (POST manager/stop with idempotencyKey + expectedRunVersion + expectedManagerGeneration) per the 09-06 handoff.
6. **Prod canary with Daniel's passkey:** Workflows → V1 Acceptance Demo → Advanced → Topic `tailnet-trust` (must be a safe path segment) → Run now → watch researchers/writer/judge → RunDetail "Iteration gates" → Approve (passkey) → Home → Recent outcomes → run → "Download brief.json". Then run a parameter-less workflow on a schedule, close the browser, confirm it completes (not proven tonight).
7. If ops needs the demo workflow: `orgs/kb-ops/workflows/v1-acceptance-demo.md` is on ops (16ec3e84) — the VM's ops checkout must reach it (drain/promotion) before the demo is listed.

### What WORKED (with evidence)
- **PR #185** — 17 commits over main; CI `kb-platform-acceptance` PASS on head 359aa810 (and on 23e6871e after a palette-test flake rerun); Linux five-command gate rc=0 at 684ed5cf; uncontended at 23e6871e only a WSL wall-clock threshold test (`store.durability.vm`) and the E2E ceremony timeout (bounded in 359aa810) were red; Windows tsc clean, focused slices 125 files / 1201 green at 684ed5cf; review r1 5 MAJOR/8 MINOR folded, r2 MERGEABLE-AFTER S1-S3 folded.
- **Rehearsal host** `kb-rehearsal` (WSL clone, bootstrapped by `deploy/bootstrap_vm.py`) — `kb-deploy.ps1` deployed 9270138b, e154b51f, 3c7f33d7, 684ed5cf and the exact PR head 359aa810; the last two passed every step first time (daemon-down path).
- **Live demo path** through the real broker (stub `claude` native shim): run-dacc2a6d — researchers + writer succeeded, judge fail c1 / pass c2 (`cyclesUsed 2/2`), gate parked, Approve without passkey → `Ceremony refused: ceremony-unavailable`, passkey provisioned (`passkey.conf` drop-in, software authenticator) → mint 200 → signed resolve 200 → run succeeded, audit commit `control-iteration-gate-authorize` on the ops checkout, run DTO outputs → `GET /api/control/files` 200 attachment digest-match, tampered 404, RunDetail "Download brief.json".
- **Deterministic E2E** `v1AcceptanceDemo.e2e.test.ts` 6/6 through the real engine/store/routes.
- **Draft PR #186** desktop units 1-2 (schema-safe): tsc clean, 35 files / 594 tests green.

### What Did NOT Work (and why)
- **Prod ssh + settings edit** — auto-mode classifier denied `ssh root@100.89.73.118` ("Production Reads") and every edit of `.claude/settings.local.json` including the Edit tool ("Self-Modification"). Only Daniel can add the allow rule; the prod baseline, forensic snapshot and prod deploy were not done.
- **Bootstrap on the clone** — `seed_control_plane` refused an Aug-31 control-plane doc inherited from Daniel's Ubuntu; not a code defect (lane e proved the seed is generated); wipe `/var/lib/kb /opt/kb-releases /usr/local/lib/kb` before bootstrap.
- **Boot crash-loop on a fresh deploy** — `queue/done/6a9d02da-7de01dbe.md` (nightly card with a `state-history:` block list) → `card frontmatter has an unsupported continuation` → fatal at boot. Fixed (F7, e154b51f): boot skips unparseable cards with a warning; runtime paths stay strict. Prod's ops checkout will carry that card after the next drain.
- **Live-daemon activation with the recovery script** — parking `current` while the daemon runs breaks it; the recovery path is for daemon-down only (prod's case). A live upgrade needs the API-lock path (`deploy-pty-fix.ps1`, unchanged).
- **Demo prose tripped the restricted-intent scan** — "spend", "publish", "deploy", "credential" in the def body / work orders park the first stage `waiting-human` forever (approval never releases it). Reworded (267b66f2, 24f12bff); compile guard test added.
- **F2 was inert** — `buildApprovedAttemptDeclaration` dropped `dependencyResults`; found by review r1 and the E2E suite; fixed e560b492.
- **Artifact download served the wrong root** — canonical artifacts live in `state/control/integration/<sha256(runRef)[:24]>`, not the ops checkout; fixed by run-scoped outputs (684ed5cf).
- **Windows `.bat` ssh shims** — Windows `python` subprocess does not consult PATHEXT; step B of the rehearsal runs under WSL with bash shims instead.
- **PowerShell 5.1 native stderr** — `2>&1` on a native call aborts under `$ErrorActionPreference='Stop'`; merge stderr inside bash.
- **Scheduled run with the browser closed** — not attempted: the demo needs a launch parameter; schedules list "Next fire not computed" on the rehearsal.
- **Transcript replay for broker attempts** — RunDetail shows "This attempt's terminal output could not be read" on the rehearsal; traced to host state (transcript ownership / persistence record vs file size), not a contract mismatch.

### What Has NOT Been Tried Yet
- Prod: everything in the morning ceremony; real subscription-CLI workers; Daniel's real passkey on the iteration gate; the scheduled parameter-less run.
- Desktop lane units 3-10 (transport + claim/renew loop, payload decoder, attempt-scoped reports → needs schema 4→5 ruling, remote WorkerAdapter, artifact upload, reconciliation, cross-host canary). Prod also needs `DASHBOARD_NODE_PROXY_UID` + `/etc/kb-dashboard/host-nodes.json` before the node scope arms.
- Review minors deferred: S4 (agent/workflow download branches still union-of-projects), S5 (shared IntegrationRecord type), S7 (exact-equality run roots), S8 (`{{PARAM}}` vs `<param>` unification), S9 (export restricted-intent vocabulary), S11 (duplicate-slug warning), S12 (e2e suite-wide verifyAssertion stub).
- Server-side retrieval (Brain → worker context): acceptance item 2 stays worker-side WebSearch/WebFetch.
- A kb-ops `runner-bound` agent declaration so demo stages carry named identities.
- Token-discipline owed items (from the 09-12 handoff, still open): apply the BOSS/CLAUDE diff + MEMORY.md trim; atlas STATE lint.

### Current State of Files
| File | Status | Notes |
| ---- | ------ | ----- |
| `claude/kb-v1-launch` @ 359aa810 (PR #185) | DONE | 17 commits; see PR body + evidence comment |
| `claude/v1-desktop-u12` (draft PR #186) | WIP | units 1-2; opus review MERGEABLE-AFTER D1 D2 D4 D5 posted; D1/D2/D4 fold in flight, D5 = unit 8 |
| `claude/provenance-fix` @ 9270138b (PR #173) | DONE | rebased onto main, MERGEABLE |
| `orgs/kb-ops/workflows/v1-acceptance-demo.md` (ops 16ec3e84) | DONE | same as branch; VM ops checkout needs it |
| scratchpad `kb-deploy.ps1`, `morning-rebuild-v1.ps1`, `vm-step-*.sh` | DONE | unified deploy (prod defaults) + morning build |
| scratchpad `rehearsal/` (build, gate, shims, serve-proxy, stub-claude, softauth) | DONE | rehearsal tooling; never for prod |
| WSL distro `kb-rehearsal` | LIVE | on 684ed5cf with passkey drop-in; `wsl --unregister kb-rehearsal` when done |
| worktrees `kb-worktrees/kb-v1-launch`, `v1-lane-a`, `v1-lane-b`, `v1-desktop-u12` | LIVE | node_modules junctions → delete junction before `git worktree remove` |
| `memory/claude-boss.md` | DONE | lessons appended (this push) |
| `orgs/kb-ops/STATE.md` | DONE | refreshed (this push) |

### Exact Next Step
Daniel merges #173 then #185; boss runs `morning-rebuild-v1.ps1`, then `kb-deploy.ps1` with the signing key (or Daniel runs it), then the prod canary in step 6.

### Load list
- this file; PR #185 body + evidence comment; PR #186
- `docs/runbooks/2026-09-15-v1-premerge-gate.md`, `orgs/kb-ops/workflows/v1-acceptance-demo.md`
- `handoffs/2026-09-11-kb-vm-overhaul-phase4-recovery.md` (parked track, unchanged)
- `memory/claude-boss.md` section 2026-09-15
- boss scratchpad (session 7a86f89a): `kb-deploy.ps1`, `morning-rebuild-v1.ps1`, `review-r1.md`, `review-r2.md`, `baseline-A.md`, `baseline-desktop-seam.md`

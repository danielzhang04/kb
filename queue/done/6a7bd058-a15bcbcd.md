---
id: 6a7bd058-a15bcbcd
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\AppData\Local\Temp\claude\C--Users-danie-kb\11fdfac9-c43f-46cc-bda2-977339b37234\scratchpad\critique-work
risk-tier: T1
owner: codex-worker
claim-token: 4aaf493d7e750bfa
state: done
approval: null
workflow: 019ff388-da4e-7251-892e-d4dfd6964a2a
depends-on: []
variant-group: null
role: work
session-id: 6a7bc8ea-116f28e3
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Brief: adversarial critique — kb platform/data split + cloud topology design

You are a red-team design reviewer. Your final message IS the deliverable. The kb repo lives at `C:/Users/danie/kb` — read anything in it, but NEVER write to it and never commit anywhere. You may use web search to check claims. Your job is to BREAK this design — find the problems the author (who likes the design) is motivated to miss.

**Crash resilience (a prior attempt lost 2.5 hours of audit to a network disconnect):** your cwd is a writable scratch directory. After finishing EACH attack surface below, append that surface's findings (severity, failure scenario, evidence file:line) to `./findings-checkpoint.md` in your cwd before moving to the next. The checkpoint is raw notes, not polish — the final message is still the real deliverable.

\## The operator and his goals

- Daniel: solo operator running an AI-agent fleet from a Windows desktop; boss Claude terminal orchestrates; codex/claude workers execute; everything coordinated through this git repo.
- Goal state he described: (a) offload fleet compute (workflows, agent runs, daemon) to a cloud VM because local can't handle fleet + interactive VS Code Claude terminals in tandem; (b) dashboard becomes a tailnet web app — his control surface for launching agent work on projects; (c) he keeps building platform code AND iterating on projects locally in VS Code; (d) he will add more projects over time (currently: a faceless-YouTube video business with heavy media pipelines, plus 2 small ones); (e) knowledge base must stay agent-native (file-based, git).
- Constraints already in force: subscription billing only (no raw API keys in fleet env), credentials are human-only objects, governance/ dir human-edited only, coordination writes ride an `ops` branch with pull-rebase-push discipline, cards-as-records schema in `governance/card-schema.md`.

\## Current state (verify in-repo as needed)

One monorepo, three layers: (1) platform code — `dashboard/` daemon + governed executor + SPA, `atlas/`, `broker/`, `scripts/`, tests/evals/`.agents/`/`routines/`/`templates/`; (2) coordination state — `queue/`, `ledgers/`, `memory/`, `handoffs/`, `dashboards/`, `governance/`, `agents/` on branch `ops`; (3) knowledge+projects — `orgs/faceless-youtube/` (6.9 GB working sets, 173 MB pack), `orgs/kb-ops/`, `orgs/atlas-prep/`, `docs/`, `skills/`. A cloud migration is mid-flight: Hetzner CCX23 (4 vCPU/16 GB/160 GB) pilot VM live on tailnet, daemon under systemd on 127.0.0.1:5317 (disarmed), Linux test suites green, repo mirrored as a bare repo on the VM (pushed from desktop over tailnet — no GitHub creds on the VM today), cutover window pending.

\## The design under review

1. **Two repos**: `kb-platform` (layer 1; local dev -> merge to main -> VM auto-pulls, rebuilds SPA, systemd restart) and `kb` data repo (layers 2+3 together; cloned on VM = authoritative home + desktop = dev client; GitHub becomes the single hub, VM gets push credentials).
2. **Compute split**: fleet (daemon, workflows, agent runs, codex dispatches, cadences) on VM; Daniel's interactive Claude terminals stay LOCAL on the desktop clone.
3. **Freshness model**: layer-2 writes keep pull-rebase-push; VM becomes the dominant `ops` writer; Daniel reads live state via the dashboard (VM's checkout), local clone is a cache; over time local coordination writes move to the dashboard's HTTP write API so the VM converges toward single-writer.
4. **Media**: render artifacts/working sets leave git for S3-compatible object storage with manifests in git; git-LFS explicitly rejected.
5. **Projects stay inside the kb data repo** as `orgs/<project>/`; per-project repos deferred until a trigger (collaborator, scale, access control).
6. **No external knowledge-base tool**; optional later: derived search index service reading the checkout.
7. **Sequencing**: all of this AFTER the pending cutover; media exile may start earlier.

\## Attack surfaces to examine (non-exhaustive — find your own too)

- **Boundary integrity of the split**: are `.agents/`, `routines/`, `templates/`, `evals/`, `skills/`, `governance/card-schema.md` platform or data? The daemon executes agent/workflow DEFINITIONS that live next to the data they operate on. Where does the schema live, and what breaks when platform vN meets data-schema vN-1? Look at actual coupling in `dashboard/server/` (it resolves DASHBOARD_REPO_ROOT for cards, ledgers, agent defs — check what it reads from the data repo vs its own tree).
- **Platform dev/prod parity**: platform tests (vitest/pytest) currently sit IN the same repo as real fixtures/cards. After the split, what do platform developers (Daniel local, or agents building the platform ON the VM?) test against? Note the contradiction candidate: he wants to "build stuff" via cloud workflows too — platform work dispatched to VM agents writes to which repo, which branch, deployed how?
- **Two-writer realities the freshness story skims**: cadence/daemon commits vs Daniel's local ops pushes racing at high frequency; ops history bloat (ledgers + atlas session transcripts land as commits — check `git log origin/ops` churn rate); shallow-clone/GC implications on the VM; whether "dashboard API becomes the write path" is real or hand-waving given the current write routes (`dashboard/server/write/`) — what fraction of coordination writes could actually go through it today?
- **The `ops`-in-one-data-repo choice itself**: coordination bus (machine churn) and knowledge/projects (human+agent content) share one repo/history — is THAT the wrong marriage? Steelman the alternative cuts (state repo separate from knowledge repo; or DB for layer 2 with git export) against agent file-native access.
- **Deploy loop**: restart-on-merge while governed agent runs are mid-flight on the VM — what happens to running workers, in-progress cards, the queue bridge tick? Check how the executor tracks running attempts and whether a daemon restart orphans them.
- **SPOF/DR**: VM dies — what is lost (authoritative checkout, ops state since last push to GitHub, running work, media on VM disk pre-upload)? Backup story absent from the design. GitHub outage with VM-as-hub-client: what stops?
- **Security**: GitHub push credential ON the VM (design point 1) vs the current no-GitHub-creds-on-VM stance — what changed, is that regression justified; tailnet-only exposure claims; broker/credential rules under the new topology; media bucket credentials.
- **Windows->Linux residue**: repo has autocrlf history, Windows-pathed scripts, `py -3` invocations — what silently breaks when the AUTHORITATIVE home becomes Linux and Windows becomes the guest?
- **Media manifest design**: "manifests in git pointing at objects" — who writes them, what enforces manifest<->bucket consistency, what does a render pipeline that currently globs local dirs do after exile? Check `orgs/faceless-youtube/` pipeline scripts for hardcoded local-path assumptions.
- **Solo-operator ergonomics**: does the two-repo split actually reduce Daniel's cognitive load, or does it double it (two clones, two PR streams, version compatibility matrix) for benefits a monorepo-with-deploy-path could deliver? Steelman "keep the monorepo, deploy a subtree" seriously.
- **Goal-function fit**: his real goals are throughput (more projects, more agent hours/day) and control (see and steer everything from one dashboard). Score each design element by whether it serves those or serves architectural aesthetics.

\## Deliverable (your final message)

- Findings ranked by severity: BLOCKER / MAJOR / MINOR. Each: the concrete failure scenario (inputs/state -> what goes wrong), evidence (file:line where applicable, or reasoned scenario), and the cheapest fix or design change.
- A "steelman alternatives" section: the 2-3 strongest rival designs with an honest comparison.
- A verdict: SHIP / FIX-THEN-SHIP / RETHINK, with the load-bearing reasons.
- Do not pad. If something in the design is right, say so in one line and move on. Verify claims against the actual repo before asserting them — do not invent file contents.

## Result

\# Verdict: RETHINK

Ship the read-only cloud dashboard pilot, but do **not** ship the proposed repository split, authoritative cloud execution, restart-on-merge, or media deletion yet.

The proposed cut separates code from definitions and scripts it directly executes, while leaving the genuinely harmful coupling—high-churn coordination state mixed with knowledge and projects—untouched. It adds a compatibility matrix without solving the writer, recovery, security, or throughput problems.

\## BLOCKER

1. **The proposed repository boundary is not executable.**

   **Failure scenario:** `scripts/`, `.agents/`, `routines/`, `templates/`, and `skills/` move to `kb-platform`, while the daemon points `DASHBOARD_REPO_ROOT` at `kb`. Local project agents can no longer run their required preamble or coordination commands; the daemon cannot import card/ledger/approval helpers or load agent roles and runtime skills.

   **Evidence:** agents must execute `scripts/preamble.py` from the repository ([CLAUDE.md:5](C:/Users/danie/kb/CLAUDE.md:5)). Dashboard launch and queue code imports `scripts/*` relative to the data root ([launch.ts:119](C:/Users/danie/kb/dashboard/server/write/launch.ts:119), [queueBridge.ts:70](C:/Users/danie/kb/dashboard/server/control/queueBridge.ts:70)). The same root supplies roles and skills ([roster.ts:241](C:/Users/danie/kb/dashboard/server/agents/roster.ts:241), [environment.ts:19](C:/Users/danie/kb/dashboard/server/control/environment.ts:19)). `DASHBOARD_REPO_ROOT` is the implicit root for all of them ([surface.ts:42](C:/Users/danie/kb/dashboard/server/http/surface.ts:42)).

   **Cheapest fix:** keep the monorepo and deploy only a built platform artifact. If a split remains desirable, first introduce explicit `PLATFORM_ROOT`/`DATA_ROOT` contracts and package the shared scripts as a versioned `kbctl` runtime installed in both environments.

2. **There is no platform/data compatibility contract.**

   **Failure scenario:** platform vN parses or emits a new card/workflow shape while the VM’s data checkout or Daniel’s local client remains at vN−1. The platform rejects live cards, or an old client writes a shape the VM misinterprets.

   **Evidence:** card validation is hard-coded Python rather than generated from a versioned machine schema ([cards.py:11](C:/Users/danie/kb/scripts/cards.py:11), [cards.py:90](C:/Users/danie/kb/scripts/cards.py:90)); the governance document is prose and cards carry no schema version. Workflow definitions come from the data tree while compiler/profile behavior is platform code ([environment.ts:34](C:/Users/danie/kb/dashboard/server/control/environment.ts:34), [compile.ts:225](C:/Users/danie/kb/dashboard/server/workflows/compile.ts:225)).

   **Cheapest fix:** add machine-readable, versioned schemas; embed schema versions in cards/workflow definitions; define supported compatibility ranges and migrations; refuse startup against unsupported data.

3. **Cloud-authored platform work targets the wrong repository.**

   **Failure scenario:** Daniel launches “change the dashboard” from the cloud UI. The executor creates its worktree from the `kb` data repository, where `dashboard/` no longer exists, or pushes the result branch to the data remote.

   **Evidence:** activation uses one `repoRoot` for policy, worktrees, integration, and coordination ([activation.ts:244](C:/Users/danie/kb/dashboard/server/control/activation.ts:244)). Worktrees must share that repository’s git common directory ([adapters.ts:285](C:/Users/danie/kb/dashboard/server/control/adapters.ts:285)); integration branches are pushed to the same remote ([canonicalResultIntegrator.ts:744](C:/Users/danie/kb/dashboard/server/control/canonicalResultIntegrator.ts:744)).

   **Cheapest fix:** add a server-owned repository registry—project, root, remote, base ref, scope, and credential identity—and bind the approved proposal to that immutable repo identity. Until then, explicitly forbid cloud platform development.

4. **The single-writer convergence story is not implementable by current local agents.**

   **Failure scenario:** an interactive local Claude finishes work and must append `memory/`, create a handoff, or update project state. Dashboard writes require Daniel’s WebAuthn session, which an agent cannot possess safely, so it must continue pushing `ops` directly. It races the VM and invalidates the promised convergence.

   **Evidence:** every human write route is session-gated ([routes.ts:90](C:/Users/danie/kb/dashboard/server/write/routes.ts:90)), while every agent run must append memory and use handoffs ([CLAUDE.md:33](C:/Users/danie/kb/CLAUDE.md:33)). Worse, dashboard branch classification recognizes only `queue/`, `ledgers/`, and `traces/` as coordination, omitting constitutionally coordinated `memory/`, `dashboards/`, handoffs, and `orgs/*/STATE.md` ([branch.ts:28](C:/Users/danie/kb/dashboard/server/write/branch.ts:28)).

   **Cheapest fix:** either admit and engineer durable multi-writer operation, or expose a narrow service protocol for agent events with scoped machine identity, idempotency keys, append semantics, and server-side validation. Never give agents Daniel’s session credential.

5. **Putting GitHub and media credentials on the VM collapses the credential boundary.**

   **Failure scenario:** a governed Bash-capable worker, Vibe session, or cloud PTY reads the daemon user’s GitHub helper/SSH material or bucket credentials and pushes arbitrary changes or exfiltrates objects.

   **Evidence:** workers preserve `HOME` for subscription credentials ([claudeWorkerAdapter.ts:14](C:/Users/danie/kb/dashboard/server/control/claudeWorkerAdapter.ts:14)); read-deny enforcement is documented as nonfunctional ([claudeWorkerAdapter.ts:304](C:/Users/danie/kb/dashboard/server/control/claudeWorkerAdapter.ts:304)). Vibe inherits `process.env` wholesale ([session.ts:88](C:/Users/danie/kb/dashboard/server/vibe/session.ts:88)); the active PTY runs as the daemon’s OS user ([index.ts:112](C:/Users/danie/kb/dashboard/server/index.ts:112)). Broker peer/token checks also trust that same UID ([peerBoundary.ts:9](C:/Users/danie/kb/broker/peerBoundary.ts:9), [daemon.ts:37](C:/Users/danie/kb/broker/daemon.ts:37)).

   **Cheapest fix:** separate daemon/writer, worker, render, and PTY OS identities. Only a narrow writer service should hold repository authority; object access should be prefix-scoped and short-lived. Disable cloud PTY/Vibe until isolated. Prefer a narrowly scoped GitHub App installation token over a writable deploy key: GitHub documents that writable deploy keys can exercise collaborator-like repository authority, whereas App tokens can be repository/permission scoped and expire after one hour. [Deploy-key guidance](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/managing-deploy-keys), [installation-token guidance](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-an-installation-access-token-for-a-github-app).

6. **The pending execution cutover cannot be validated by the current green checks.**

   **Failure scenario:** systemd reports the daemon healthy, but dashboard-owned cards never dispatch or fail immediately on Linux.

   **Evidence:** `createQueueBridge()` has no non-test production caller; the daemon starts other timers but not this bridge ([queueBridge.ts:154](C:/Users/danie/kb/dashboard/server/control/queueBridge.ts:154), [index.ts:125](C:/Users/danie/kb/dashboard/server/index.ts:125)). Production paths repeatedly invoke Windows-only `py -3` ([preambleGate.ts:27](C:/Users/danie/kb/dashboard/server/write/preambleGate.ts:27), [workflowRun.ts:448](C:/Users/danie/kb/dashboard/server/write/workflowRun.ts:448)); the “Linux green” embedded-Python test substitutes `python3` instead of testing production defaults ([embeddedPython.test.ts:51](C:/Users/danie/kb/dashboard/server/embeddedPython.test.ts:51)). `/healthz` reports only Node version ([index.ts:84](C:/Users/danie/kb/dashboard/server/index.ts:84)).

   **Cheapest fix:** distinguish read-only web cutover from execution-authority cutover. Wire and supervise the bridge, centralize a platform-aware Python resolver, then run an end-to-end Linux canary that creates a real card, dispatches it, integrates it, settles its ledger, restarts mid-run, and verifies recovery.

7. **Restart-on-merge can orphan or duplicate governed work.**

   **Failure scenario:** a platform merge restarts the daemon during an agent or render. On boot, active state becomes `interrupted`, but nothing automatically re-drives it. A detached worker may survive depending on systemd `KillMode`; a replacement attempt can then duplicate work or external effects.

   **Evidence:** boot normalization marks running attempts/sessions interrupted ([store.ts:1915](C:/Users/danie/kb/dashboard/server/control/store.ts:1915), [store.ts:4367](C:/Users/danie/kb/dashboard/server/control/store.ts:4367)). Recovery only occurs when `runToBoundary` is called again. Activation does not return a worker-drain capability ([activation.ts:379](C:/Users/danie/kb/dashboard/server/control/activation.ts:379)), while shutdown drains broker/Vibe/git only ([surface.ts:134](C:/Users/danie/kb/dashboard/server/http/surface.ts:134)); workers are detached on Linux ([claudeWorkerAdapter.ts:529](C:/Users/danie/kb/dashboard/server/control/claudeWorkerAdapter.ts:529)).

   **Cheapest fix:** deploy only when quiescent until a recovery supervisor exists. Add worker draining, PID/start-identity persistence, stage-level idempotency receipts, `KillMode=control-group`, and a real systemd kill/restart acceptance test. Deploy immutable releases with rollback, not in-place pull/build.

8. **GitHub is not a disaster-recovery copy of the authoritative VM.**

   **Failure scenario:** the VM volume dies after expensive work but before publication. GitHub restores cards and pushed branches, but loses active-run truth, accounting reservations, integration intent, Composer sessions, amendment locks, dirty worktrees, and media staged before upload.

   **Evidence:** these records live under external `DASHBOARD_STATE_ROOT` ([composer/store.ts:114](C:/Users/danie/kb/dashboard/server/composer/store.ts:114), [control/store.ts:4367](C:/Users/danie/kb/dashboard/server/control/store.ts:4367), [canonicalResultIntegrator.ts:404](C:/Users/danie/kb/dashboard/server/control/canonicalResultIntegrator.ts:404), [amendmentStore.ts:76](C:/Users/danie/kb/dashboard/server/workflows/amendmentStore.ts:76)). Integration branches are local before their later push ([canonicalResultIntegrator.ts:456](C:/Users/danie/kb/dashboard/server/control/canonicalResultIntegrator.ts:456)).

   **Cheapest fix:** classify state root as tier-0 data; encrypt and back it up off-VM; checkpoint expensive stage outputs; define RPO/RTO; and prove a destroy/rebuild/restore drill before declaring the VM authoritative.

9. **“Objects plus manifests” is not yet a media architecture.**

   **Failure scenario:** media is removed from local paths and replaced with object references. Render gates report missing scenes, audio is omitted, Remotion fails, or a different object is rendered under a filename previously approved by a human.

   **Evidence:** rendering opens local scene paths ([render.py:212](C:/Users/danie/kb/orgs/faceless-youtube/render-builder/scripts/render.py:212)); motion assembly reads and copies local audio/assets into a local Remotion tree ([build_motion.py:413](C:/Users/danie/kb/orgs/faceless-youtube/render-builder/scripts/build_motion.py:413), [build_motion.py:680](C:/Users/danie/kb/orgs/faceless-youtube/render-builder/scripts/build_motion.py:680)). Current manifests bind review to a path/status, not a required byte digest ([manifest.json:5](C:/Users/danie/kb/orgs/faceless-youtube/assets/scenes/manifest.json:5)). Publish also requires a local final MP4 ([publish_preflight.py:75](C:/Users/danie/kb/orgs/faceless-youtube/publish-queue/scripts/publish_preflight.py:75)).

   **Cheapest fix:** first build a content-addressed materializer/cache with required SHA-256, size, media type, object version, and review digest. Upload immutable object → verify → CAS-commit manifest. Run shadow hydration while local assets remain canonical; only then delete/exile them.

\## MAJOR

1. **The proposed split preserves the wrong marriage.** `ops` is simultaneously queue, mutable state, audit, telemetry, transcripts, and knowledge history. Measured `origin/ops` activity was 1,048 commits in 28 days: 429 touching ledgers, 359 queue, 111 memory, and 43 handoffs. Splitting platform away does not reduce this ref-level contention or exposure.  
   **Fix:** make the first separation state versus knowledge, not platform versus everything else.

2. **Git pull-rebase-push is not a transaction protocol.** A rejected push triggers textual rebase and retry after the local commit already exists ([branch.ts:235](C:/Users/danie/kb/dashboard/server/write/branch.ts:235)). Conflicts can leave an in-progress rebase; the lock is explicitly process-local ([asyncGit.ts:29](C:/Users/danie/kb/dashboard/server/write/asyncGit.ts:29)). Multiple systemd jobs sharing one checkout can interleave index/filesystem changes.  
   **Fix:** one actual writer, or isolated clones plus logical CAS/idempotent commands and guaranteed cleanup.

3. **Platform tests will become ambient and non-reproducible.** Tests read real project workflows directly from the current monorepo ([compile.videoRun.test.ts:4](C:/Users/danie/kb/dashboard/server/workflows/compile.videoRun.test.ts:4), [fyt.segmentContracts.test.ts:12](C:/Users/danie/kb/dashboard/server/workflows/fyt.segmentContracts.test.ts:12)). A standalone platform clone either fails or silently depends on an unrelated data checkout.  
   **Fix:** hermetic platform fixtures plus an explicit Linux compatibility job for the exact `{platform SHA, data SHA}` deployed.

4. **Two repositories make coupled changes non-atomic.** Card-schema, compiler/workflow, skill/runtime, and governance changes become two PRs and two deployments. One half can merge or roll back independently.  
   **Fix:** compatibility windows and release manifests are mandatory if split. A monorepo artifact retains atomic source changes without deploying the whole tree.

5. **The VM does not yet increase fleet throughput.** Production activation defaults to one concurrent worker and supplies no operational override ([activation.ts:244](C:/Users/danie/kb/dashboard/server/control/activation.ts:244), [surface.ts:82](C:/Users/danie/kb/dashboard/server/http/surface.ts:82)). Co-locating control, git, PTY, agents, and FFmpeg/Remotion on four CPUs creates one saturation/failure domain.  
   **Fix:** explicit per-resource-class concurrency and systemd CPU/memory/IO limits; put renders on a separate worker class and cache volume.

6. **The dashboard’s control view is historical, not operational.** Agent “health” is inferred from `working` and ledger dates with a two-day window ([health.ts:186](C:/Users/danie/kb/dashboard/server/panels/health.ts:186)); usage lacks wall-clock, queue-latency, token, saturation, or failure-rate dimensions ([usage.ts:1](C:/Users/danie/kb/dashboard/server/panels/usage.ts:1)). A stuck worker may appear live.  
   **Fix:** durable attempt/runtime events with heartbeats, stage timestamps, queue age, worker identity, outcomes, and external alerting.

7. **Read-only APIs are not actually private to Daniel.** Read routes sit outside session auth ([index.ts:77](C:/Users/danie/kb/dashboard/server/index.ts:77)); `/api/kb/file` can return arbitrary files under the repository root ([routes.ts:33](C:/Users/danie/kb/dashboard/server/kb/routes.ts:33)). The design document promises tailnet ACL and never-Funnel startup enforcement, but corresponding runtime enforcement was not found.  
   **Fix:** session-auth every non-health read, narrow file roots, and make Tailscale Serve/ACL/Funnel checks deployment assertions.

8. **GitHub outage becomes a write outage.** Coordination mutations synchronously push and eventually fail when the hub is unavailable ([branch.ts:241](C:/Users/danie/kb/dashboard/server/write/branch.ts:241)).  
   **Fix:** stop new side-effecting work, retain a durable local idempotent outbox, keep reads available, alert, and replay after recovery.

9. **The project-access trigger is being deferred until it is expensive.** A collaborator in the single data repo gains visibility to every org, governance anchor, memory, and operational transcript. Extracting later requires history filtering and workflow/path migration under deadline.  
   **Fix:** implement repository-registry support now and prove one project can be extracted, even if the actual split is deferred.

10. **The 7 GB media number is operationally misleading.** The live FYT tree measured about 7.33 GB, but HEAD tracks only about 182 MB; ignored working sets will not arrive in a fresh VM clone. Conversely, deleting tracked PNGs will not remove historical pack objects.  
    **Fix:** inventory canonical inputs, derived cache, review artifacts, and finals separately. Size cache/storage from concurrent stage closures, not total working-tree size.

11. **Linux residue extends beyond Python.** The live PTY hard-codes `powershell.exe` ([route.ts:92](C:/Users/danie/kb/dashboard/server/pty/route.ts:92)); runner triggering/liveness assumes Task Scheduler ([trigger.ts:25](C:/Users/danie/kb/dashboard/server/runner/trigger.ts:25), [liveness.ts:84](C:/Users/danie/kb/dashboard/server/runner/liveness.ts:84)).  
    **Fix:** platform metadata on executable definitions and a Linux runner implementation; disable incompatible features rather than presenting them as live.

12. **The migration sequence lacks an authority handoff protocol.** The proposal changes refs, remotes, credentials, roots, and dominant writer after the current monorepo pilot, invalidating much of the pilot’s assurance.  
    **Fix:** stabilize the monorepo deployment first; then use a short writer freeze, immutable old/new ref mapping, ref/object verification, client canary round-trips, read-only rollback remote, and one-writer-class-at-a-time unfreeze.

\## MINOR / calls that are right

- Rejecting Git LFS is reasonable; it would not solve hydration, credentials, consistency, or cache admission.
- Keeping the KB file-native and adding only a derived search index is a good fit.
- Keeping projects together is acceptable today, provided external-repo support is proven before the first collaborator.
- Shallow cloning and GC are not the present bottleneck; retention and state churn matter more.
- Performing the structural work after—not during—the pending web cutover is sensible, but execution authority needs a separate gate.

\## Goal-function score

Legend: `++` strongly serves the goal, `+` helps, `0` neutral/unproven, `−` hurts.

| Design element | Throughput | Control | Assessment |
|---|---:|---:|---|
| Move agent compute to VM | + | + | Correct direction; current bridge, concurrency, isolation, and recovery are incomplete |
| Tailnet dashboard over VM checkout | 0 | ++ | Best part of the design once reads, readiness, and auth are hardened |
| Split platform from all data | − | − | Adds incompatible roots/releases while breaking current runtime coupling |
| VM as dominant `ops` writer | + | + | Valuable only with one real writer protocol, DR, and degraded mode |
| S3-compatible media store | + | + | Strong after digest schema, materializer, cache, and reconciliation exist |
| Keep all projects in one repo | 0 now / − later | 0 now / − later | Convenient solo; poor access and extraction boundary |
| Keep machine state with knowledge | −− | − | Preserves the highest-churn and highest-blast-radius coupling |
| Git-native KB, optional derived index | 0 | + | Correct |
| Restart automatically on merge | 0 | −− | No throughput benefit; endangers active work and the control surface |
| “Everything after cutover” | 0 | + | Good only if cutover means read-only web first, execution authority later |

\## Steelman alternatives

| Alternative | Strengths | Costs | Honest verdict |
|---|---|---|---|
| **1. Keep monorepo; deploy immutable platform artifacts** | Preserves atomic code/schema/workflow changes and repo-native tooling. VM uses separate read-only release, clean `ops` worktree, and backed-up state root. Solves local compute pressure without repo surgery. | Permission isolation remains repository-wide; compatibility still needs startup checks. | **Best near-term design.** Lowest cognitive load and directly serves throughput/control. |
| **2. State-first split: `kb-state` + existing monorepo** | Removes queue/audit/telemetry churn from knowledge history; supports one writer and narrow credentials while platform/projects remain atomically coupled. Agents can mount a sibling file-native state checkout. | Requires explicit multi-root workspace support and migration of writers. | **Best first repository split** if Git must remain the coordination store. |
| **3. Three-plane design: platform releases + state service + project repos** | Clear security/access boundaries, scalable writers, independent media workers, collaborator-ready projects. State can be SQLite/Postgres/event log with Markdown/NDJSON export for agent-native reads. | Highest operational and migration burden; premature for three projects unless automated heavily. | **Best eventual scale design**, not the first move for a solo operator. |

The load-bearing recommendation is: stabilize a monorepo cloud deployment with distinct release/coordination/state roots; isolate credentials and workers; prove backup, restart recovery, readiness, and a real queue canary; build the media resolver in shadow mode; then decide from measured contention whether the first physical split should be state—not platform.

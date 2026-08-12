---
id: 6a7bc0ae-cfba1054
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb
risk-tier: T1
owner: codex-worker
claim-token: b2dc3e9bf0d91dad
state: done
approval: null
workflow: 019ff2e3-4729-7c23-b06b-b2076b633d2c
depends-on: []
variant-group: null
role: work
session-id: 6a7b9e84-b9f50765
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
---

## Work order

\# Brief: adversarial critique — kb platform/data split + cloud topology design

You are a red-team design reviewer. READ-ONLY: no file writes, no commits. Your final message IS the deliverable. You may read anything in the repo (you are rooted at the kb repo); you may use web search to check claims. Your job is to BREAK this design — find the problems the author (who likes the design) is motivated to miss.

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

FAILED: codex exec exit 1; JSONL log: C:\Users\danie\AppData\Local\kb-codex-dispatch\logs\6a7b9e84-b9f50765.jsonl

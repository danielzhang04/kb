# kb structure — design spec (2026-08-11)

**Decision record:** Daniel adopted the phased monorepo/state-first design below. It replaces the
platform/data two-repository candidate. This is a record of the decision, not a proposal.

## Evidence register

All reports are banked in `2026-08-11-kb-structure-evidence/` beside this spec:

- **Synthesis (authority):** `synthesis.md`
- **Research / prior art:** `prior-art-research.md`
- **Adversarial critique:** `adversarial-critique.md`
- **Runtime boundary map:** `runtime-boundary-map.md`
- **Media inventory:** `media-inventory.md`
- **VM credential options:** `vm-credential-options.md`

The synthesis is authoritative where reports conflict. In particular, its corrected finding is that
`createQueueBridge` has a production caller, but is default-off and unproved for Linux dispatch.

## Goal and non-goals

The goal function is throughput—more projects and more agent-hours per day—and control through
one dashboard. Architectural aesthetics, repository neatness, and a priori service separation are
not goals.

Non-goals for this arc: a platform/data split, VM-held GitHub authority, direct object credentials
in workers, and media removal before the post-cutover track has earned it.

## Locked rulings (Daniel, 2026-08-11)

1. **Architecture:** adopt the revised phased design: monorepo plus immutable release artifact
   now; state-first split as the first physical split later; platform/data split abandoned.
2. **Sync topology:** retain desktop promotion plus a durable VM outbox; place **no GitHub
   credential on the VM**. Staging-repository promotion is the pre-designed escalation; a brokered
   GitHub App is considered only if direct publication proves necessary. PAT is permanently out.
3. **Sequencing:** media exile begins **after cutover**. Cutover has two gates: read-only web first,
   then execution authority only after the hardening checklist.

## Current state

The repository is one monorepo containing three operational layers that are presently interleaved:

- platform implementation and executable contracts (`dashboard/`, `scripts/`, broker, tests);
- knowledge and project material (`orgs/`, `docs/`, source skills, agents, templates);
- mutable coordination and run record (`queue/`, `ledgers/`, `dashboards/`, `memory/`, handoffs,
  state-root data).

The measured pressure is coordination churn, not source-tree aesthetics: `ops` recorded **1,055
commits in 28 days**; `orgs/` occupies **6.9 GB** on disk against a **173 MB** Git pack. The large
working-set number is principally ignored or local-by-convention media, not equivalent tracked
history. See synthesis and media inventory.

The boundary map identifies **10 format/version-skew surfaces**. The headline surface is card
format/state-machine compatibility (`scripts/cards.py` and dashboard parser versus `queue/**`);
the remaining surfaces span grades, routing, workflow definitions, agent records, approvals,
budget, cadence, skills, and templates. See runtime boundary map, “Format/version-skew surfaces.”

Coupling is executable and presently single-root:

- `DASHBOARD_REPO_ROOT` supplies policy, worktrees, integration, and coordination; launch and
  queue-bridge code import `scripts/*` relative to that root.
- `scripts/*.py` own card, ledger, routing, grade, cadence, approval, projection, and sync
  contracts consumed by the dashboard, Atlas, dispatcher, approvals, bridge, and tests.
- Workflow definitions, roster roles, skills, governance, project state, and generic browser
  access are read from that same root; tests also consume live data shapes. See runtime boundary
  map, “Direct runtime accesses” and “Ambiguous-directory verdicts.”

The cloud context is Wave-3 cutover pending: the VM is live on the tailnet and the daemon is
disarmed. The existing read-only dashboard pilot therefore does not confer execution authority.
See synthesis.

## Design

### Phase I — cloud fleet without repository surgery

The monorepo remains the sole source repository. The platform is built on merge into an immutable,
versioned VM release artifact. A release directory is selected by a versioned symlink; restart is
quiescent-only; rollback repoints to the previous release. The running platform is never a live
checkout that shares state with data.

The VM holds only:

- the immutable platform release artifact;
- an `ops` data checkout; and
- `DASHBOARD_STATE_ROOT`, classified as tier-0 data with encrypted off-VM backup, defined RPO/RTO,
  and a proved restore drill before VM authority is declared.

Desktop promotion remains the GitHub topology. The VM commits locally to a durable outbox; the
desktop reconciles and promotes it. The VM has no GitHub credential. During a GitHub outage, reads
remain live and the outbox grows visibly with bounded retry and reconciliation; new side-effecting
work follows the degraded-mode policy rather than silently losing state.

#### Cutover gate 1 — read-only web

Daniel authorizes a tailnet read-only dashboard only when the deployment proves session
authentication on every non-health read route, confined file roots, and tailnet Serve/ACL/Funnel
deployment assertions. This gate does not arm the daemon or transfer execution authority.

#### Hardening between the gates

Before execution authority moves, Phase I implements and demonstrates:

- a Linux end-to-end dispatch canary: card creation, bridge dispatch, integration, ledger settle,
  restart during a run, and recovery;
- a platform-aware Python resolver replacing production `py -3` calls;
- worker drain on shutdown plus `KillMode=control-group` so restart cannot orphan or duplicate
  governed work;
- session authentication on read routes; and
- per-resource-class concurrency limits, separating control/git, agents, PTY, and render pressure.

The Linux canary is run with production command resolution, not the test-only `python3`
substitution. Existing platform-specific PTY and runner behavior is either made Linux-capable or
disabled outside its supported platform. The corrected bridge finding does not relax this gate.

#### Cutover gate 2 — execution authority

Daniel authorizes arming execution only after the hardening evidence above, a quiescent restart and
rollback demonstration, state-root backup/restore evidence, and a durable outbox outage/replay
exercise. The gate establishes a controlled VM execution plane; it does not change GitHub trust
anchors or authorize a repository split.

### Phase II — state-first physical split

When measured contention or scale warrants it, the first split removes mutable state: queue,
ledgers, dashboards, and run telemetry move to `kb-state` (repository or service). Retention and
writer semantics are designed for machine churn. Cards may remain a small, sharded durable record;
run/event telemetry does not remain unbounded Git churn.

Knowledge plus platform remain coupled in the monorepo: `orgs/`, `docs/`, source skills, scripts,
dashboard, and their shared schemas change atomically. This preserves executable contract and
schema-instance coupling while moving the actual high-churn layer.

Phase I builds these prerequisites before any state cutover:

- versioned, machine-readable schemas for cards and workflow definitions, including supported
  compatibility ranges, migrations, and unsupported-data startup refusal; and
- a server-side repository registry mapping project to root, remote, base ref, scope, and
  credential identity. An approved proposal binds to an immutable registry identity.

`memory/` and `handoffs/` placement is an explicit Phase II gate decision. Their low churn and
agent-native reads favor knowledge placement, but no location is committed before that gate.

#### Phase II Daniel gate

Daniel receives: measured write/contention and retention evidence; schema-version and migration
tests; an external-repository registry canary; writer/idempotency and recovery design; an atomic
state migration/reconciliation plan; and a decision on `memory/` and handoffs. Only then may
state become physically separate.

### Phase III — trigger-based project extraction

Projects remain in the monorepo until an actual extraction trigger exists, principally a
collaborator, access-control, or independent-ownership boundary. The Phase II registry proves the
target root, remote, base, scope, and credential path in advance; extraction is not improvised
under deadline. The resulting shape is state service plus project repositories, with platform and
knowledge coupling reconsidered only at that evidence-backed boundary.

#### Phase III Daniel gate

Daniel receives the concrete trigger, access model, repository-registry proof, history and
reference migration plan, client round-trip canary, rollback remote, and single-writer-class
handoff plan before an individual project is extracted.

### Media exile — independent, post-cutover track

All media exile work starts after cutover under locked ruling 3. The destination is one private
Hetzner Object Storage bucket containing content-addressed immutable objects. Object credentials
are prefix-scoped and never ambient in worker environments. Local disk remains the hot cache for
iteration; exile improves cross-machine access to older generations that are currently
machine-local by convention.

The sequence is fixed:

1. Upgrade the manifest schema with required SHA-256, byte size, object key, and provenance
   run-id alongside existing review fields.
2. Add a content-addressed materializer/cache in shadow mode. Local files remain canonical while
   hydration is exercised.
3. Exile a write-once archive tranche only after shadow proof; immutable archive lifecycles make
   this the first safe tranche.
4. Exile active working sets last, only after hydration is proved at all consumer boundaries.

Hydration proof covers forge staging/copy, board embeds, renderer validation, and publish
preflight. `node_modules` is dependency cache, not media; `_private/` duplicate cleanup is
separate from exile. See media inventory for paths, sizes, and the four boundary findings.

Each material step ends at a Daniel media gate: manifest validation and CAS verification; then
shadow-mode equivalence at all four boundaries; then archive reconciliation; then active-set cache
capacity, restore, and publish proof. No local canonical asset is removed merely because an object
exists.

## Rejected alternatives and escalation paths

- **Platform/data two-repository split (candidate B):** rejected. It separates the platform from
  scripts and definitions it executes, while preserving the high-churn state marriage; the boundary
  map’s 10 skew surfaces make cross-repository compatibility load-bearing.
- **Remote-SSH-everything:** rejected. It makes the VM a shared interactive workspace instead of a
  controlled release/state/execution plane and does not solve writer, recovery, or credential
  boundaries.
- **External KB tool:** rejected. File-native, reviewable knowledge remains the source of record;
  only derived indexing is in scope where useful.
- **Git LFS:** rejected. It moves blobs but does not provide digest-bound manifests, hydration,
  worker credential isolation, or cache lifecycle.
- **DVC, git-annex, and lakeFS:** rejected. Their data-versioning and placement control planes add
  machinery beyond the required immutable-object manifest/materializer path.
- **PAT or writable deploy key on the VM:** rejected. They are repository-scoped, never
  ref-scoped, and reverse the current trust anchor by placing GitHub write authority beside workers.
- **Staging-repository promotion:** not adopted now; it is the pre-designed escalation if the
  desktop promotion topology proves insufficient. It uses a separate repository, never a staging
  branch in the canonical repository.
- **Brokered GitHub App:** not adopted now; it is considered only if direct publication proves
  necessary, with its private key outside the VM and explicit redesign of approval assurance.
- **Pre-cutover media archive tranche:** rejected by ruling 3. All exile sequencing is post-cutover.

## Risks and open questions

- **Single-writer convergence is blocked today.** Dashboard write routes are WebAuthn-session
  gated, so agents cannot safely use Daniel’s session. `branch.ts` classifies only `queue/`,
  `ledgers/`, and `traces/` as coordination, omitting `memory/`, `dashboards/`, handoffs, and
  `orgs/*/STATE.md`. Fix the classifier defect regardless of the eventual writer protocol. See
  adversarial critique and runtime boundary map.
- **State-root disaster recovery:** the tier-0 backup, restore test, RPO, and RTO are Phase I
  conditions, not documentation-only controls.
- **GitHub outage:** the durable outbox prevents silent loss, but spool growth is degraded mode and
  needs alerting, bounded replay, and explicit work-admission policy.
- **Worker/restart safety:** quiescent deployment is mandatory until draining, process-group kill,
  idempotency receipts, and restart recovery are demonstrated.
- **Isolation:** worker, daemon/writer, render, and PTY identities remain a hardening concern;
  cloud PTY/Vibe capabilities stay disabled or isolated until their environment boundaries hold.
- **Observability:** the dashboard must expose attempt heartbeats, queue age, worker identity,
  saturation, outcomes, and failure rate rather than infer liveness from historical files.
- **Media integrity:** path/status review is insufficient; byte digest, object identity, and local
  hydration remain mandatory before canonical-location change.
- **Open:** choose the Phase II state substrate and the placement of `memory/` and handoffs only at
  the Phase II Daniel gate.

## Acceptance record

Phase I is complete only when both cutover gates have Daniel’s evidence and approval. Phase II and
III are not scheduled commitments; their Daniel gates are the authority to proceed. Media exile is
post-cutover and advances only tranche by tranche through its named Daniel gates.

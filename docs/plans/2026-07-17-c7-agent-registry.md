# C7 — first-class agent registry (design + build plan)

_Author: planning pass (Claude, Opus 4.8), 2026-07-17. Branch `claude/c7-plan`, off `origin/main` @48da72a._

Status: **PLAN ONLY — no implementation.** This document is the single deliverable of the C7 planning
chunk. It answers the load-bearing design questions, cites current-state evidence with `file:line`,
proposes the agent-object schema, fixes the v1 vs deferred boundary, enumerates the exact Composer seams
to change, breaks the build into TDD-able C7.x sub-steps, and flags the decisions Daniel must approve
before any code is written.

---

## Summary

Today an "agent" is **not an object anywhere in the repo.** It is an *emergent projection*: a card
`owner` string, a ledger-writer filename token, a `routines/roles/*.md` role match, a
`runtimes.<rt>.default_worker` binding in the (human-only) routing policy, and one line of prose in
`governance/agent-rules.md`. The dashboard's Agents view already *renders* this projection
(`dashboard/server/agents/roster.ts` unions all four sources) but there is nowhere to *declare* a new
agent — the `[+ New] ▸ Agent` menu entry is `enabled:false, hint:'soon'`
(`dashboard/src/nav/config.ts:122`) and `agent` is explicitly excluded from Composer's artifact kinds
(`dashboard/src/composer/artifactTypes.ts:28`).

C7 makes the agent a **first-class declarative record**: a durable `agents/<id>.md` file with YAML
frontmatter that the roster reads *first* (unioned ahead of the derived sources), and that Composer can
draft-and-deploy through the already-governed `save` path (durable → work branch → PR to `main`).

The load-bearing tension the plan resolves: **declaring an agent ≠ making it run.** A runner
(`agent_runner.ps1`, or the Claude desktop dispatch) claims cards by matching `card.owner` to its own
bound `-Agent` id, and that binding is a human-provisioned scheduled task with a git identity and
(for codex) keyring credentials. The registry **must not** provision runners or touch credentials
(constitution credential ceiling; `CLAUDE.md` "never handle credentials as objects"). So v1 delivers the
*identity + declared defaults + fleet visibility*, and the "a runner executes this agent's cards" step
stays a **human gate** for any genuinely new identity. Model/runtime defaults are honored **without
touching governance** by reusing the shipped, WebAuthn-gated, audited agent-scope entry in
`queue/routing-override.yaml` (`dashboard/server/write/routingOverride.ts`) — never by writing
`governance/model-routing.yaml`.

---

## Current-state findings (with evidence)

### F1 — There is no agent-definition file; identity is projected from four sources
`dashboard/server/agents/roster.ts:186` (`buildRoster`) computes the roster as the **union** of:
1. **queue-card owners** — `listAgents` groups every non-null `card.meta.owner` (`roster.ts:45-77`);
2. **ledger writers** — `readLedgerWriters` parses `ledgers/<kind>/<writer>-<date>.tsv` filenames
   (`roster.ts:123-155`);
3. **the role catalog** — `readRoles` lists `routines/roles/*.md` basenames (`roster.ts:158-165`), and
   `roleFor` matches a role to an id by hyphen-token then substring (`roster.ts:168-178`);
4. **effective routing** — `effectiveForAgent(id, policy, override)` (`roster.ts:69,214`).

There is **no top-level `agents/` directory** (verified: absent) and no on-disk agent schema. The agent
is entirely inferred. C7's job is to give it a *declared* home the roster reads as a fifth, authoritative
source.

### F2 — "agent identity" today = {id, role, runtime, default_worker binding}, split across two human-only files
- `governance/model-routing.yaml:12-28` registers the two runtimes and their **bound worker identity**:
  `claude.default_worker: worker-desktop` and `codex.default_worker: codex-worker`. `default_worker_for`
  (`scripts/routing.py:222-233`) is "the owner id dispatch claims a card as … each such id is one a
  runner is bound to."
- `governance/agent-rules.md:16-21` (rule 7) is the **prose registry** of non-Claude workers:
  `codex-worker`, its identity convention (`codex-worker@agents.local`), its git-access tier, and
  "all its task types start queues-for-me until the grade ledger promotes them."
- Identity convention: `git config user.name <agent-id>`, `user.email <agent-id>@agents.local`
  (`agent-rules.md:2`), branch namespace `claude/<name>` / `codex/<name>` (`CLAUDE.md` branch rules).

So an "agent" = a **named identity that binds a role (behavioral template) to a runtime (execution
engine) + a default model + a scope**. The role catalog (`routines/roles/`) is the *template*; the
runtime registry (`model-routing.yaml`) is the *engine*; the agent object C7 introduces is the
*instance binding* — it does **not** replace roles or runtimes.

### F3 — `owner` semantics and how a runner claims/executes a card
- `owner` is the claim field, "SET ONLY BY Manager/dispatcher — never copied from untrusted text"
  (`governance/card-schema.md:14,18`); workers never self-claim (`routines/roles/worker.md:15`).
- The runner scans `queue/{inbox,working}` for cards where `card.meta.owner == its own -Agent id` and
  `state ∈ {inbox, working}` (`scripts/agent_runner.ps1:160-191`).
- Before executing, the runner asserts `card.runtime == its own runtime` via
  `scripts/assert_runtime.py` and **refuses** a mismatch (`agent_runner.ps1:222-229`). So a card owned
  by an id **no runner is bound to is simply never executed** — it sits in the queue.
- What makes a runtime "codex" vs "claude": the runner *is* the runtime. `agent_runner.ps1 -Agent
  codex-worker` drives `codex exec` (`agent_runner.ps1:289`) behind a keyring-auth billing guard
  (`agent_runner.ps1:131-158`) that **never falls back to the metered API**. The Claude desktop leg is a
  different runner. Neither is created by any dashboard code.

### F4 — Dispatch owner selection resolves through the routing registry
`scripts/dispatch.py:522-532`: with a cadence `agent:` pin, dispatch cross-checks the pinned owner's
registered runtime (`routing.runtime_of_worker`) against the resolved runtime and **wakes+skips** on a
mismatch (`dispatch.py:346-364`); with no pin it claims as `default_worker_for(resolved_runtime)`
(`dispatch.py:531`). So a newly-registered agent id becomes *dispatch-addressable* only if it is a
runtime's `default_worker` **or** a cadence pins `agent: <id>` **and** that id maps to a runtime a runner
is bound to. This is the concrete boundary between "registered" and "runnable" (see Flagged #2).

### F5 — Routing precedence, and why the registry must never write governance
`scripts/routing.py:6-13` and `resolve` (`routing.py:249-308`): the one-winner precedence is
**card frontmatter > `queue/routing-override.yaml` > `governance/model-routing.yaml` > safe default**,
field-by-field for runtime and model independently. `governance/model-routing.yaml` is **human-edited
only** (`CLAUDE.md`; `model-routing.yaml:7` "Human-edited ONLY … an agent may PROPOSE edits in
docs/proposals/, Daniel commits them"). The agent-scope override in `queue/routing-override.yaml` is a
**coordination artifact**, and there is already a shipped governed writer for it —
`dashboard/server/write/routingOverride.ts#setOverride` (WebAuthn-gated `routingOverride.ts:141-146`,
registry-validated `:114-138`, race-safe atomic ops rewrite with an audit row in the same commit
`:164-215`). **This is the only sanctioned way an agent's default runtime/model becomes effective.**

### F6 — Composer's convergence spine and the deploy path (the seam to plug into)
- `dashboard/src/composer/artifactTypes.ts:28` — `ARTIFACT_KINDS = ['task','workflow','skill','project']`;
  `agent` is "intentionally absent (deferred)" (`:27`, `:243`). The spine is `seedTemplate` (`:299`),
  `validateDraft` (`:356`), `toDeploy → DeployPlan` (`:454`), and `classifyRelpath` (`:138`) which mirrors
  the server's `COORDINATION_PREFIXES = ['queue/','ledgers/','traces/']` (`:135`; server truth
  `dashboard/server/write/branch.ts:29`). Anything not under a coordination prefix is **durable**.
- The F4 name-segment guard `nameSegmentProblem` (`artifactTypes.ts:161-170`) rejects path separators,
  `..`, leading `.`, and empty-slug names before a name becomes an on-disk segment. Skill/project reuse it
  (`:325-326`, `:349-350`).
- `dashboard/src/composer/deploy.ts:89-120` maps a plan to `/api/write/launch` (task) or `/api/write/save`
  (durable) and **never sends `workBranch`** (`:108`) — the server owns durable branch selection and
  hard-403s a client-smuggled `main`/`ops` (`dashboard/server/write/routes.ts:73-74`).
- `governedSave.save` (`dashboard/server/write/governedSave.ts:67`) enforces, in order: session gate
  (`:68-74`), path confinement `resolveWithin` (`:77-84`), governance carve-out 403 (`:86-88`), local
  write, real-path symlink re-confinement (`:92-110`), then `routeWrite` (`:122`). `agents/` is **not**
  under `GOVERNANCE_ONLY_PREFIXES` (`:35`) and **not** a coordination prefix, so it classifies **durable**
  and routes work-branch → PR to `main` with hooks active (`branch.ts:132-151`) — no server change needed
  for classification.
- The Agents view (`dashboard/src/views/Agents.tsx`) is already `status:'live'` (`nav/config.ts:84`) and
  already carries the per-agent governed model control (`Agents.tsx:309-334` → `postRoutingOverride` →
  `setOverride`). C7 does **not** need to build a routing control — it already exists.

### F7 — Frozen files are not on any current-state path C7 touches
`dashboard/server/auth/challenge.ts` and `scripts/webauthn_verify.py` are the WebAuthn challenge/verify
core. The C7 write paths reach WebAuthn only through `auth/session.ts#verifySession` (already imported by
`governedSave`/`routingOverride`); no C7 step imports, edits, or re-derives the two frozen files.

---

## The agent-object schema (concrete)

**Home:** a new top-level `agents/` directory, one file per agent: `agents/<id>.md`. Parallel to
`routines/`, `skills/`, `templates/` — a fleet-wide catalog, not project-scoped (agents span projects).
Durable content → PR to `main` → **human review is the gate that makes the identity real** (see Flagged #2).

**Format:** YAML frontmatter + a Markdown body (same shape as `routines/roles/*.md` and skill files, so
existing `parse`/`readdir` conventions apply). Frontmatter fields:

```markdown
---
id: research-worker            # the identity string. Becomes: card `owner`, git user.name,
                               #   <id>@agents.local, the routing-override `key`, the agents/<id>.md
                               #   segment. MUST be a single safe path segment (F4 rule) and MUST NOT
                               #   collide with a governance/humans.yaml name (anti-impersonation).
role: work                     # one of cards.ROLES: scout|manage|work|inspect|consolidate.
                               #   The behavioral template (routines/roles/<role>.md). Drives the
                               #   role×tier routing lane in model-routing.yaml.
runtime: claude                # declared default execution engine. MUST be a registered runtime
                               #   (governance/model-routing.yaml runtimes: claude|codex today).
model: claude-sonnet-5         # declared default concrete model id. MUST be in that runtime's
                               #   known_models. Optional — omit to inherit the role×tier policy model.
projects: [kb-ops]             # scope hint: projects this agent works. Advisory metadata (routing/
                               #   ownership are enforced elsewhere); [] or omitted = fleet-wide.
runner-bound: false            # HONEST STATUS FLAG. false = no runner claims this owner yet (declared
                               #   only). Set true by a human ONLY after they provision/point a runner
                               #   at this id. The registry writes false; it can never write true
                               #   (see Flagged #2). Roster renders "declared (no runner)" when false.
description: >                 # one-line human description for the roster / Agents view.
  Volume worker for kb-ops housekeeping cards.
---

# Agent: research-worker

Freeform notes: what this agent is for, its autonomy posture, links to its role and contract.
Inert prose — never executed.
```

**Why these fields:** `id`/`role`/`runtime`/`model` are exactly the tuple the roster already displays
(`AgentRosterEntry` — id, role, effective runtime/model; `roster.ts:92-104`) and the routing resolver
consumes (`routing.py resolve`). `runner-bound` makes the registered-vs-runnable distinction *legible in
the data* instead of hidden. `projects`/`description` are advisory display metadata.

**Relationship to existing systems (do not fork a parallel registry):**
- `role` **references** `routines/roles/<role>.md` — it does not redefine it.
- `runtime`/`model` **reference** `governance/model-routing.yaml`'s registry — the agent object cannot
  invent a runtime; it can only name one that governance already blesses. Enforcement of "these are
  the effective defaults" is the **agent-scope `routing-override.yaml` entry**, not the file.
- `id` is the same string that is card `owner`, ledger-writer token, and git identity — one identity,
  five projections (queue, ledger, role-match, override-key, and now the declared file).

---

## Runnable-semantics decision (v1 scope vs deferred)

Daniel's words: *"We want agents to be able to run stuff."* The honest mechanics (F3/F4): a card "runs"
when a **runner bound to its owner id** claims it. Runners are human-provisioned scheduled tasks with git
identities and (codex) keyring credentials. Three options:

- **(a) register-an-identity-only** — deploy `agents/<id>.md`; if the id maps to an already-bound runner
  (`worker-desktop`, `codex-worker`) or a runtime's `default_worker`, its cards run under the existing
  runner. A genuinely new id owns cards no runner claims (they sit in the queue) until a human binds one.
- **(b) provision-a-new-runner** — the registry creates a scheduled task / git identity / credentials.
  **Refused:** violates the credential ceiling and the trust-anchor invariant (`agent_runner.ps1:38-40`
  "holds no REST/gh capability"); provisioning is inherently a human act.
- **(c) something else** (e.g. the dashboard spawns an in-process runner) — out of scope; a bigger,
  separate control-plane chunk.

**v1 delivers (a).** Concretely:
- Composer deploys the durable `agents/<id>.md` record (→ PR to `main`; **human merge = the gate that
  admits the identity to the fleet**).
- The roster reads the file and surfaces the agent immediately (with `runner-bound: false` shown as
  "declared — no runner yet").
- The operator sets the agent's effective default runtime/model via the **already-shipped** governed
  agent-scope override control in the Agents view (`Agents.tsx:309-334`) — WebAuthn-gated, audited.
- Cards can now be *addressed* to the agent — a cadence `agent: <id>` pin, **or an operator-assigned
  owner on a launched Task (C7.7, pulled into v1)**.

**v1 ALSO delivers (scope expansion, Daniel 2026-07-17 — "declare + assign work now"):** task-owner
assignment — an operator assigns a launched card's `owner` to a declared agent so an already-bound
runner executes it. Designed in full as **C7.7** below.

**v1 explicitly DEFERS:**
- Runner provisioning / scheduled-task creation / credential handling (permanent human gate).
- Flipping `runner-bound` to `true` (human-only edit, mirroring how `codex-worker` was onboarded via
  `agent-rules.md` rule 7 — a human decision, not a dashboard write).
- Auto-writing the routing-override on deploy (see Flagged #3 — recommend keeping the file deploy and the
  override write as two separate governed actions in v1).

The **human-gate boundary** sits exactly at PR-merge (admitting the declared identity) and at
runner-binding (`runner-bound: true` + an actual scheduled task). Everything the registry does is
*declaration* — reviewable, revertible, credential-free.

---

## Composer integration points (exact files/functions to change)

All changes are **additive** to the existing spine; each has a clear test home.

1. `dashboard/src/composer/artifactTypes.ts`
   - `ARTIFACT_KINDS` (`:28`) → add `'agent'`. Removes the "intentionally absent" note (`:27`).
   - New `AgentDraft` interface: `{ id, role, runtime, model?, projects?, description, body? }`.
   - `DraftFor<K>` (`:78`) → add the `agent` arm.
   - `seedTemplate`/`kindSeed` (`:263-296`) → add an `agent` case: the house-authored creation prompt
     stating the schema, the registered-vs-runnable reality, and that deploy is durable (PR to `main`).
   - `ideaSeed` (`:244-260`) → add `agent` to the type menu so idea-first can converge to it.
   - `validateDraft`/`validateAgent` (`:356`) — client-pure honest preview:
     - `id`: `requireNonEmpty` + `nameSegmentProblem('id', …)` (reuse `:161`, the F4 guard) — this is the
       load-bearing safety check (id → path segment + override key + owner).
     - `role`: must be one of a **mirrored** `['scout','manage','work','inspect','consolidate']` const
       (mirror of `cards.ROLES`, same pattern as the mirrored `COORDINATION_PREFIXES`/`RISK_TIERS`).
     - `runtime`: must be one of a mirrored `['claude','codex']` const (documented as "mirror of
       governance/model-routing.yaml runtimes; the server override-set does the authoritative
       registry check").
     - `model`: optional; if present, non-empty (concrete registry validation is the server's job at
       override-set time — the client cannot read the live policy).
     - `description`: non-empty.
     - Anti-impersonation: reject an `id` equal (case-insensitive) to a small mirrored set of reserved
       names — but the **authoritative** humans.yaml / existing-agent collision check is server-side
       (see Security §S6). Flag this as a validation the server must own (Flagged #5).
   - `toDeploy`/`agentPlan` (`:454`): `relpath = agents/<slugify(id)>.md`, `content` = frontmatter
     (`runner-bound: false` hard-coded — the registry never writes `true`) + body, `branchClass =
     classifyRelpath(relpath)` → **durable** (agents/ is not a coordination prefix), `endpoint: 'save'`.
     No `followUps` (single-file artifact).

2. `dashboard/src/nav/config.ts`
   - `NEW_MENU_ENTRIES` agent entry (`:122`) → `enabled:true`, drop `hint:'soon'`. The `NewMenuEntry.id`
     union already includes `'agent'` (`:108`).
   - The `agents` nav destination is already `live` (`:84`) — no change; the Agents *view* already exists.

3. `dashboard/src/composer/deploy.ts` — **no change.** An agent plan is `endpoint:'save'`, durable; the
   existing save branch (`:108-119`) handles it and correctly omits `workBranch`.

4. `dashboard/server/write/*` — **no change to the write core.** `agents/` classifies durable
   (`branch.ts:42-45`), is not governance-only (`governedSave.ts:35,44-48`), routes to a work-branch PR.
   *Optional server hardening (Flagged #5):* add an `agents/`-aware collision/impersonation check so a
   deployed agent id cannot equal a `governance/humans.yaml` name or shadow an existing runtime identity.
   If added, it lives in `governedSave` or a small dedicated validator — **never** in the frozen files.

5. `dashboard/server/agents/roster.ts` — add `agents/<id>.md` as a **fifth roster source** unioned into
   `buildRoster` (`:186`): a `readDeclaredAgents(repoRoot)` reader (mirror `readRoles` `:158-165`) whose
   ids join the `ids` set (`:197`) and whose `role`/declared `runtime`/`model`/`runner-bound`/`description`
   annotate the entry. `AgentRosterEntry` (`:92`) gains `declared: boolean` and `runnerBound: boolean` so
   the view can render "declared — no runner." A declared-but-idle agent (no cards, no ledger rows) must
   still surface.

6. `dashboard/src/views/Agents.tsx` — render the new columns/badge (declared vs observed; runner-bound
   status). The routing control is already present (`:309-334`); no new write path in the view.

---

## Model/runtime binding approach (without touching governance)

- The `agents/<id>.md` file records the **declared** default `runtime`/`model` as human-readable metadata
  and roster display. It is **not** consulted by the routing resolver (`routing.py resolve` reads only
  card frontmatter, `routing-override.yaml`, `model-routing.yaml`, default — F5).
- The **effective** default is set through the **agent-scope entry in `queue/routing-override.yaml`**, via
  the shipped `setOverride` path (`routingOverride.ts:218-257`): `scope:'agent', key:<id>, runtime, model,
  expires`. This is WebAuthn-gated, validates `runtime ∈ policy.runtimes` and `model ∈ known_models`
  (`:126-134`), and commits atomically to `ops` with an audit row (`:196-200`).
- Resolver precedence is respected: a card frontmatter pin still outranks the agent override
  (`routing.py:265-277`), which outranks policy (`:279-286`). The agent's default is an *override-tier*
  default — stronger than policy, weaker than a per-card pin — which is exactly right for "this agent
  usually runs on X."
- **v1 recommendation (Flagged #3):** keep the two writes **separate** — Composer deploys the declarative
  file; the operator sets the routing default with the existing Agents-view control. Rationale: reuses a
  shipped, individually-tested governed path; avoids the registry inventing a compound write that spans
  *two branches* (`agents/` → PR to main **and** `routing-override.yaml` → ops) in one deploy, which
  would badly complicate atomicity and audit. The file is the durable declaration; the override is the
  live coordination knob; they are legitimately different lifecycles.

---

## Chunk breakdown (C7.x — each TDD-able)

Ordered so every step is independently green. Test files to **extend** are named per step.

- **C7.0 — schema doc + example (no code).** Write `docs/specs/` (or `agents/README.md`) defining the
  `agents/<id>.md` frontmatter contract + one worked example. Gate: Daniel signs off the schema
  (Flagged #1) before code. _No test._
- **C7.1 — artifact-type registry: the `agent` kind (pure spine).** Add `'agent'` to `ARTIFACT_KINDS`,
  `AgentDraft`, `DraftFor`, `validateAgent`, `agentPlan`, seeds. Extend
  `dashboard/src/composer/artifactTypes.test.ts` (RED first): valid draft → empty problems; traversal id
  → problem (mirror the existing skill/project F4 tests); bad role/runtime → problem; `toDeploy` emits
  `agents/<slug>.md`, durable, `endpoint:'save'`, `runner-bound: false` in content; `idea`/kind seeds name
  the agent type. This is the largest, most self-contained chunk.
- **C7.2 — enable the New-menu entry.** Flip `NEW_MENU_ENTRIES` agent to `enabled:true`. Extend
  `dashboard/src/nav/config.test.ts` / `dashboard/src/composer/NewMenu.test.tsx`: agent entry actionable,
  fires onCreate seeded to `agent`.
- **C7.3 — roster reads declared agents.** Add `readDeclaredAgents` + union into `buildRoster`; extend
  `AgentRosterEntry` with `declared`/`runnerBound`. Extend `dashboard/server/agents/roster.test.ts`: a
  declared-only agent (no cards, no ledgers) surfaces with role/runtime from its file and `runnerBound
  false`; a declared id that also owns cards merges (declared ∧ queue sources).
- **C7.4 — Agents view surfaces declared/runner-bound.** Render the badge/columns. Extend
  `dashboard/src/views/Agents.test.tsx`: a declared-no-runner agent shows the status; the existing routing
  control still renders and writes the agent-scope override.
- **C7.5 — DeployOutcome / end-to-end deploy of an agent.** Confirm an agent plan flows through
  `deploy()` → `/api/write/save` unchanged (no `workBranch`), and the outcome strip reports the branch/PR
  target. Extend `dashboard/src/composer/DeployOutcome.test.tsx` + `deploy.test.ts` with an agent plan
  fixture. (deploy.ts itself unchanged — this is a coverage/wiring step.)
- **C7.6 — server-side impersonation/collision guard (Flagged #5, ACCEPTED — Daniel 2026-07-17).** Reject a
  deployed `agents/<id>.md` whose `id` collides case-insensitively with a `governance/humans.yaml`
  name/handle or shadows an existing runtime identity. New small validator + test; **must not** touch the
  frozen files.
- **C7.7 — task-owner assignment (Composer/Launch → run on an existing runner).** Detailed design section
  below. Adds an optional, closed-set `owner` picker to the Task launch flow, a server-side owner
  validator (`launch.ts` gate), owner→claim + effective-routing stamping, and a runner-bound warning.
  Extend `dashboard/server/write/launch.test.ts`, `dashboard/server/write/routes` tests, and
  `dashboard/src/views/launchControls`/`Control`/`Home` test suites. **New Flagged #7** (runtime/model
  stamping at assignment) must be approved before build.

Deferred to a later chunk (not C7): runner provisioning, auto-chaining the override write on deploy,
flipping `runner-bound` from the UI.

---

## C7.7 — task-owner assignment (Composer → run on an existing runner)

**Goal (Daniel's "declare + assign work now"):** let a WebAuthn operator assign a launched Task's `owner`
to a declared/registered agent id, so an **already-bound** runner (`agent_runner.ps1` matching
`card.owner == its -Agent id`, `agent_runner.ps1:160-191`) claims and executes it.

### Current-state trace (where owner is — and isn't — set today)
- The dashboard Launch form POSTs only `{project, action, target, riskTier, body}`
  (`launchControls.tsx:109`) → route `/api/write/launch` reads exactly those fields
  (`routes.ts:104-110`) → `launchCard` builds a `LaunchSpec` with no owner (`launch.ts:203-216`) →
  `CARD_OP_SCRIPT` calls `cards.new_card(project, action, target, riskTier, body)` (`launch.ts:111-115`).
- `cards.new_card` hard-codes **`owner: None`** (`cards.py:93`) and never calls `claim`. So **every
  dashboard-launched card today is unowned** — no runner matches `owner==null`, so it just sits in
  `inbox`. There is no owner field anywhere in the launch path to hijack; C7.7 *adds* the first one.
- Owner is normally set by the dispatcher via `cards.claim(card, owner)` (which sets `owner` + mints a
  `claim-token`, `cards.py:151-153`), called at `dispatch.py:532`. C7.7 performs the equivalent `claim`
  in the launch path, from a **trusted** (WebAuthn-gated) operator choice.

### Constraint 1 — owner is dispatcher-only, never from untrusted text (reconciled)
`card-schema.md:14,18` restricts `owner`/`action`/`target` to the Manager/dispatcher and forbids copying
them from untrusted text. The `/api/write/launch` path is already **preamble-gated then WebAuthn-session
gated** (`launch.ts:171-191`) — the operator holding a passkey session **is** a trusted
dispatcher-equivalent (the same standing that lets them set `action`/`target`/`riskTier` today). The
reconciliation is therefore: an operator-set owner is legitimate **iff it comes from a closed set of
declared/registered agent ids, never a freeform string.** The client offers a **`<select>` populated
from the roster** (declared agents ∪ registered runtime `default_worker` ids), and — critically — the
**server re-validates against that same closed set** (Constraint 2). The picker is honest-preview; the
server is the boundary.

### Constraint 2 — server-side owner validation (the boundary)
- Add optional `owner?: string` to `LaunchSpec` (`launch.ts:42-51`); the route reads `body.owner`
  (`routes.ts:104-110`), forwarding `undefined` when absent (backward-compatible: no owner → today's
  unowned-card behaviour, byte-for-byte).
- **New server validator** (in `launch.ts`, inside `launchCard` **before** the `runPy` call, or a tiny
  `agents/registry.ts` helper `readAssignableOwners(repoRoot)`): the valid-owner set is enumerated
  **server-side from the filesystem**, never from the client —
  1. declared agents: `readDeclaredAgents(repoRoot)` (the C7.3 reader over `agents/*.md`), ∪
  2. registered runtime workers: each `runtimes.<rt>.default_worker` in `governance/model-routing.yaml`
     (`policy.ts loadPolicy`; today `worker-desktop`, `codex-worker`, `model-routing.yaml:13,21`).
  A launch whose `owner` is non-empty and **not** in that set is refused with a new
  `owner-not-registered` outcome → HTTP 400 (mirrors the `launchStatus` map, `routes.ts:44-55`). Also
  apply the existing `CARD_ID_RE`-style filename/glob-safety guard (`routes.ts:40`) to `owner` before it
  reaches any glob/path — reject separators, `..`, glob metachars. No card is filed on refusal.
- Injecting owner into the card: extend `CARD_OP_SCRIPT`'s `"new"` branch (`launch.ts:111-115`) to call
  `cards.claim(card, op["owner"])` when `owner` is present — the **same** primitive the dispatcher uses,
  so the claim-token is minted identically and the schema stays authoritative (`cards.py:151-153`).

### Constraint 3 — runtime-consistency (recommended: stamp from effective routing)
A card owned by a codex agent but whose resolved runtime is `claude` (or vice-versa) is **refused** by the
bound runner's pre-exec assertion (`assert_runtime.py`, `agent_runner.ps1:222-229`) and sits idle; the
dispatch owner-runtime cross-check that would otherwise wake+skip (`dispatch.py:346-364, 522-532`) does
**not** run on a dashboard-launched card (that card is already owned + in `inbox`; dispatch only
resolves/claims cadence-emitted cards in `run()`), so a mismatch would fail **silently** at the runner.

**v1 recommendation: stamp the card's `runtime` (and `model`) from the assigned agent's EFFECTIVE routing
at claim time, so owner↔runtime agree by construction.** The server already has a pure TS resolver —
`effectiveForAgent(id, policy, override)` (`roster.ts:19,69`; `routing/effective.ts`) — which returns the
same `{runtime, model}` the Python resolver would (precedence: card frontmatter > `routing-override.yaml`
agent entry > `model-routing.yaml` policy role×tier > safe default; `routing.py:249-308`,
`model-routing.yaml:32-46`). `launchCard` computes `effectiveForAgent(owner, …)` and passes
`runtime`/`model` into `CARD_OP_SCRIPT`, which stamps them via `cards.stamp_routing` (`cards.py:161-167`)
in the same claim step. Result: the bound runner's `assert_runtime` passes, and there is no owner↔runtime
mismatch for dispatch to wake+skip. This mirrors the already-shipped governed `setCardRouting` write
(`routes.ts:258-281`) — stamping card runtime/model from a trusted, resolver-sourced value is existing
practice, not a new authority. **This is Flagged #7** (stamping runtime/model at assignment).
_Alternatives:_ (b) **warn only** — leave `runtime` null; the runner's "legacy/no-runtime → proceed" path
(`agent_runner.ps1:220`) then runs it under whatever the bound runner is, which is fine for a same-runtime
agent but silently wrong on a mismatch; (c) **block** the launch if the agent's effective runtime can't be
resolved — too strict for v1. Recommend (a): least-surprising, no silent idle cards, fully governed.

### Constraint 4 — only existing-runner agents actually run (runner-bound selectability)
An agent with `runner-bound: false` assigned as owner → the card is claimed but no runner exists, so it
sits in `inbox` unclaimed. **Recommendation: the picker MAY select `runner-bound: false` agents, but
renders a clear inline warning** — "will not execute until a runner is bound to <id>." Rationale: this is
exactly Daniel's "declare + assign work now" flow — queue work against a freshly-declared identity you are
about to bind a runner for. The card is legitimately parked, not lost. The server validation
(Constraint 2) still requires the id be **registered** (a declared `agents/*.md` file or a `default_worker`);
`runner-bound` gates the *warning*, not selectability. _Alternative:_ restrict the picker to
`runner-bound: true` / `default_worker` ids only — rejected as it defeats the stated "assign now, bind
soon" intent; the warning carries the honesty instead.

### Files to change (all additive to the launch path)
- `dashboard/src/views/launchControls.tsx` — add an optional `owner` `<select>` (roster-sourced; blank =
  unowned, today's behaviour) + the runner-bound warning; include `owner` in the POST body (`:109`) only
  when chosen.
- `dashboard/server/write/launch.ts` — `LaunchSpec.owner?`, closed-set validation, `effectiveForAgent`
  stamping, `cards.claim`+`stamp_routing` in `CARD_OP_SCRIPT`, new `owner-not-registered` outcome.
- `dashboard/server/write/routes.ts` — read `body.owner`, owner safety guard, map the new refusal to 400.
- `dashboard/server/agents/` — `readAssignableOwners(repoRoot)` (declared agents ∪ default_workers),
  reusing the C7.3 `readDeclaredAgents`.
- **No change** to `deploy.ts`, `branch.ts`, `governedSave.ts`, or the frozen files.

### Test home
`dashboard/server/write/launch.test.ts` (RED first): owner in registered set → card filed + `claim`ed +
runtime/model stamped from effective routing; owner **not** in set → `owner-not-registered`, no card
filed; absent owner → unchanged unowned-card path; a codex-agent owner stamps `runtime: codex`. Route-level
owner-safety in the `routes` test suite; the `<select>` + warning in `launchControls`/`Control`/`Home`
view tests.

---

## FLAGGED HUMAN DECISIONS

**#1 — Agent-object home + schema.** _Recommend:_ a new top-level `agents/<id>.md` with the frontmatter
in this doc (id, role, runtime, model?, projects?, runner-bound, description). _Rationale:_ parallels
`routines/`/`skills/`/`templates/`; durable → PR-to-main gives a human-review admission gate; the roster
already reads `routines/roles/` the same way, so a fifth source is a small, idiomatic addition.
_Alternative:_ fold agents into `routines/roles/` (rejected — a role is a reusable *template*, an agent is
an *instance binding* an identity; conflating them breaks `roleFor` and the role×tier routing lanes) or
into an `orgs/<project>/` scope (rejected — agents are fleet-wide, not project-scoped).

**#2 — Registered vs runnable boundary (the "run stuff" question).** _Recommend:_ v1 = option (a),
register-identity-only; deploying an agent declares it and (after PR merge) makes it visible and
card-addressable, but a **genuinely new id's cards do not run until a human binds a runner**
(scheduled task + git identity + any credentials), and `runner-bound` stays `false` until that human
step. _Rationale:_ runners are the credential/trust boundary (`agent_runner.ps1:38-40, 131-158`); the
constitution forbids the registry handling credentials or provisioning execution. _Alternative:_ auto-bind
to an existing runner by making every new agent a `default_worker` alias — rejected, that silently routes
real work to a runtime the operator may not have intended and muddies the one-runner-per-owner assumption
(`dispatch.py:516`).

**#3 — Does agent deploy also write the routing-override?** _Recommend:_ **No — keep them separate in
v1.** Composer deploys the durable file; the operator sets the effective default runtime/model with the
already-shipped, audited agent-scope override control in the Agents view. _Rationale:_ a compound deploy
would span two branches (`agents/` → PR-to-main **and** `routing-override.yaml` → ops) with two different
lifecycles and audit shapes in one click — hard to make atomic and legible. Reusing `setOverride` keeps
the security surface at exactly what already shipped. _Alternative:_ chain both writes on deploy (a nicer
one-click UX) — defer to a later chunk once the decoupled path is proven; if adopted, the override write
must remain its own governed, separately-audited call, not a silent side effect.

**#4 — What can the registry set as an agent's default model, given governance is off-limits?**
_Recommend:_ only runtimes/models **already registered** in `governance/model-routing.yaml`
(claude/codex + their `known_models`), enforced server-side by the existing `setOverride` validation
(`routingOverride.ts:126-134`). Introducing a new *runtime* remains a human governance edit. _Rationale:_
honors the standing decision (routing needs no governance edits; the override covers per-agent
model/runtime) and the human-only rule for `model-routing.yaml`. _Alternative:_ let the agent file
declare an arbitrary runtime string (rejected — it would either be dead metadata or tempt a governance
write; the override validator already fails such input loudly).

**#5 — Anti-impersonation / id-collision enforcement.** _Recommend:_ add a **server-side** check (in the
governed save path, not the frozen files) that refuses an `agents/<id>.md` whose `id` collides
case-insensitively with a `governance/humans.yaml` name/handle or shadows an existing runtime identity
(`worker-desktop`/`codex-worker`) unless intentionally editing it. Mirror the client with an honest
preview. _Rationale:_ `agent-rules.md:2` forbids impersonating humans; an agent id is also a git
`user.name`, so a collision could forge human-looking authorship. _Alternative:_ client-only check
(rejected — the client is an honest preview, never the boundary, exactly as `artifactTypes.ts:159`
states for path confinement). This is why C7.6 exists as an explicit, gated chunk.

**#6 — Does `agents/` need a sync hook like skills' `sync_skills`?** _Recommend:_ **No** in v1 — the
roster reads `agents/` directly from the working tree (like `routines/roles/`), no mirror to keep in
sync. _Rationale:_ avoids adding a pre-commit hook to the durable path (skills have one only because of
the `.claude/skills` curated mirror; `branch.ts:19-22`). _Alternative:_ add validation-on-commit later if
malformed agent files become a problem.

**#7 — (NEW, surfaced by C7.7) Does operator owner-assignment stamp the card's `runtime`/`model`?**
_Recommend:_ **Yes — stamp `runtime`/`model` from the assigned agent's effective routing
(`effectiveForAgent`) at claim time**, so owner↔runtime agree by construction and the bound runner's
`assert_runtime` passes (`agent_runner.ps1:222-229`) rather than the card silently sitting idle on a
mismatch. _Rationale:_ the value is resolver-sourced (precedence `routing.py:249-308`), not untrusted
text, and set by a WebAuthn-gated dispatcher-equivalent — the same standing that already lets the shipped
`setCardRouting` governed write stamp card runtime/model (`routes.ts:258-281`); `card-schema.md:39-48`'s
"dispatcher/routing-set only" rule is satisfied. _Alternatives:_ **warn-only** (leave `runtime` null → the
runner's legacy-proceed path `agent_runner.ps1:220` runs it under the bound runtime — fine for a
same-runtime agent, silently wrong on a mismatch) or **block** the launch when the runtime can't resolve
(too strict for v1). This decision is scoped to the launch/assignment path only; it does **not** change
how dispatch routes cadence cards.

---

## Frozen-file checkpoint (hard review gate)

`dashboard/server/auth/challenge.ts` and `scripts/webauthn_verify.py` **must remain byte-identical.** No
C7 chunk lists either file. C7 reaches WebAuthn only transitively via `auth/session.ts#verifySession`
(already imported by the governed write modules it reuses). **Reviewer action:** `git diff --stat
origin/main` on the eventual implementation branch must show **zero** lines changed in those two paths;
any nonzero delta fails review outright.

## Security-review checklist for the eventual adversarial pass

1. **Path confinement / traversal.** `id` becomes `agents/<slug>.md`, a routing-override `key`, a card
   `owner`, and a git `user.name`. Verify the client `nameSegmentProblem` guard **and** the server's
   `resolveWithin` + real-path symlink re-confinement (`governedSave.ts:77-110`) both reject
   `../`, absolute, leading-dot, and empty-slug ids. The client is an honest preview only — the server is
   the boundary (`artifactTypes.ts:159`).
2. **No `workBranch` to protected branches.** Confirm the agent save path never forwards `workBranch`
   (`deploy.ts:108`) and the route hard-403s a smuggled `main`/`ops` (`routes.ts:73-74`;
   `branch.ts isProtectedBranch`).
3. **Durable classification is correct.** `agents/` must classify **durable** (PR-to-main, human review),
   never coordination (silent ops push). Assert `classifyTarget('agents/x.md') === 'durable'` on both
   the client mirror (`artifactTypes.ts:138`) and server (`branch.ts:42`).
4. **No governance write.** No C7 code path writes `governance/**` or `CLAUDE.md`/`AGENTS.md`/`GEMINI.md`
   (`governedSave.ts:44-48` refuses them 403). The agent default model/runtime is set only via
   `routing-override.yaml` through `setOverride`.
5. **No credential-as-object; no runner provisioning.** Confirm nothing in C7 creates/reads a credential
   store or spawns/schedules a runner. `runner-bound` is written `false` by code and only ever flipped by
   a human.
6. **Anti-impersonation.** (Flagged #5) An agent `id` must not equal a `humans.yaml` name or shadow an
   existing runtime identity — enforced server-side.
7. **Override write remains single-row, audited, race-safe.** If the operator sets an agent-scope default,
   it goes through `setOverride`'s existing atomic ops rewrite + same-commit audit row
   (`routingOverride.ts:164-215`) — C7 adds no second, weaker override writer.
8. **Untrusted-text discipline.** The agent file body is inert prose; nothing parses it as instructions.
   The Composer seed is house-authored trusted scaffolding, not sourced from a card `## Evidence`
   (`artifactTypes.ts:238-241`).
9. **Roster read is fail-open on a sparse/malformed checkout** (missing `agents/` → empty, like
   `readRoles` `:158-160`) and a malformed agent file must not crash `buildRoster`.

### C7.7 (task-owner assignment) additions
10. **Closed-set owner, no freeform string.** The launch `owner` must be validated **server-side** against
    the filesystem-enumerated set (declared `agents/*.md` ∪ registered `default_worker` ids from
    `model-routing.yaml`), never trusted from the client. A non-registered owner → 400 `owner-not-registered`,
    **no card filed**. The `<select>` is honest-preview only (`card-schema.md:14,18` reconciliation: the
    WebAuthn operator is a trusted dispatcher-equivalent, but only over a closed set).
11. **Owner string safety.** Apply the `CARD_ID_RE`-class guard (`routes.ts:40`) to `owner` before it
    reaches any `queue_root.glob`/path — reject separators, `..`, glob metachars.
12. **Runtime-consistency stamping (Flagged #7).** If adopted, `runtime`/`model` are stamped **only** from
    the resolver (`effectiveForAgent`), never from client input, via `cards.stamp_routing` — so
    owner-assignment can never create the owner↔runtime mismatch that dispatch would wake+skip
    (`dispatch.py:346-364`) or the runner would refuse (`agent_runner.ps1:222-229`).
13. **No privilege beyond the existing launch gate.** Owner-assignment adds no new auth surface: it rides
    the already preamble-then-WebAuthn-gated `/api/write/launch` (`launch.ts:171-191`); it never provisions
    a runner, never touches credentials, and a `runner-bound:false` owner simply parks the card (warned in
    the UI), it does not force execution.
14. **Backward-compatibility.** An absent `owner` must preserve today's exact unowned-card path
    (`cards.new_card` owner=null, no `claim`) — the new field is strictly additive.

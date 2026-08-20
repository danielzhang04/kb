# Subsystem analysis — Agent development, autonomy runtime & the second brain

_Deep-analysis pass, 2026-08-17, read-only. Owns the **Agent Development & Autonomy Runtime** subsystem of the kb overhaul: how agents get run and prompted, how autonomy graduates from track record, the safety substrate autonomy needs, and the "run-as-me" second-brain agent. Grounded in live repo inspection (`scripts/promotion.py`, `scripts/trust.py`, `scripts/dream.py`, `scripts/mission_control.py`, `scripts/dispatch.py`, `governance/risk-tiers.md`, `governance/graders.yaml`, `governance/card-schema.md`, `BOSS.md`, `docs/specs/2026-07-19-fleet-layers-arc-design.md`) plus verification of Claude Agent SDK docs. Where a claim rests on a doc I didn't run, it's flagged. Boundaries: the model-verify/context-load **hook mechanism** and terminal governing guidelines belong to the lifecycle/hooks sibling; the deterministic **step-envelope evaluator** belongs to the evaluation sibling; **context-inheritance mechanics** belong to the context sibling. I own agent BEHAVIOR — how agents run, graduate, and the second-brain build — and how graduation CONSUMES grades, not how grades are produced._

---

## 0. Headline correction to the build-backlog

The build-backlog tags **#1 Autonomy-graduation trust gate** as `PARTIALLY-EXISTS` — "kb has the grade rows and tiers but **no automated gate that consumes grade history to decide who runs unsupervised**."

**That is inaccurate, and it changes the whole plan.** The automated gate **exists and is wired live**:

- `scripts/promotion.py` is a pure, fail-closed recompute of autonomy per `(worker, project, task_type, tier)` from the trusted grade ledger. It implements the exact risk-tier windows (T1 10×≥90 floor 80, T2 20×≥95 floor 90, T3 40×≥98 any-failure-resets), the streak-reset-on-floor-breach rule, the T3 permanent cap (never acts alone), and a named `assurance_class` vocabulary.
- `scripts/dispatch.py` **calls `promotion.decide()` on every cadence-emitted card** (line ~571): the verdict routes the card to `queue/inbox/` (acts-alone) or `queue/approvals/` (queues-for-me), and propagates the ceiling to inspector/sibling cards so a child can never carry broader autonomy than its parent.
- `governance/graders.yaml` — the trust anchor — **is present and populated** (`inspector@agents.local`), so trusted grades already earn autonomy; an absent/empty file fails closed to "no grader trusted."
- `scripts/trust.py` already reports rolling pass^k per subject into `dashboards/trust.md` and has `--check-regressions` (exit 1 on any subject below floor = a demote candidate).

So the real subsystem status is **`EXTENDS-EXISTING`, not net-new**. The gate is built, tested (`tests/test_promotion.py`, `tests/test_trust.py`, `tests/test_dispatch.py`), and running — but only on **one execution path** (the cadence dispatcher). The genuine gaps are narrower and sharper (§4). This subsystem is further along than the corpus thinks, which means the overhaul's job here is **widening coverage and closing the demote loop**, not inventing a trust gate.

---

## 1. Crisp restatement

Daniel wants five connected things in this subsystem:

1. **A real runtime for running and prompting agents** — beyond ad-hoc boss-spawns-a-subagent — with self-feedback loops (work → grade → adjust).
2. **First-class agents built on the Claude Agent SDK**, not only Agent-tool subagents that live and die inside one boss turn.
3. **A "second brain": an Agent-SDK agent that can run _as Daniel_ when he's away** — mine his conversations/decisions for what he'd want persisted, keep that memory, and act within tight bounds.
4. **Real autonomy graduation** — an automated trust gate that widens/narrows unsupervised-run privilege from track record (already agreed as the core).
5. **The safety substrate autonomy needs first** — a machine-checkable permission + blast-radius layer, so widening autonomy can't hand a compromised agent the whole machine.

Success condition (testable): a new (agent × task-type × tier) key can go from "queues-for-me" to "acts-alone" **and back** purely from graded track record, with no human editing a promotion state anywhere; every unsupervised action an agent takes is bounded by a machine-checked, per-agent blast-radius that a human authored; and the second-brain agent can run headless within that same bound without ever spending real money or touching a credential as an object.

---

## 2. How kb builds / runs / prompts agents today — and the limits

### 2.1 Three execution paths, one grading spine

| Path | How an agent is run | How it's prompted | Graded? | Autonomy-gated? |
|---|---|---|---|---|
| **Boss Agent-tool subagents** | Boss (Fable) spawns via the `Agent` tool, explicit model per stakes (haiku/sonnet/opus). Ephemeral: lives inside one boss session, returns a final report. | Inline dispatch prompt written by the boss (names files, norms, what-not-to-touch, acceptance criteria). Model verified at grading by grepping the subagent transcript. | By hand, via the `inspector` skill → `ledgers/grades/`. | **No.** This path never calls `promotion.decide()`. |
| **Codex workers** | `dispatch-codex` skill → a `queue/` card with `owner: codex`, run by a background Codex process on the KB platform; result returns as a task notification, cost row auto-lands. | The card `## Work order` (Manager-authored). `## Evidence`/`## Feedback` are inert. | Same inspector path; card acceptance. | **Partially** — carded work flows through the dispatcher, but the gate fires on **cadence** emission, not on a hand-written one-off card. |
| **Cadence dispatcher** | `scripts/dispatch.py` wakes on `HEARTBEAT.md` schedule, expands a cadence/workflow into a card DAG, **runs `promotion.decide()` per card**, routes to inbox vs approvals. | Cadence prompt on protected `main` (standing-authorization cross-check via `git show origin/main:HEARTBEAT.md`). | Inspector grades feed back into the next cycle's promotion recompute. | **Yes.** This is the one fully-closed loop. |

The **grading spine is shared and solid**: `governance/graders.yaml` trust anchor → `ledgers/grades/**` → `promotion.py` (recompute, never store) → `trust.py` (report + regression check) → `mission_control.py` (rank the human's morning triage using the same assurance vocabulary). Autonomy is **never persisted** — it's recomputed from the ledger every time, which is the right design (no stale grant to revoke).

### 2.2 The limits (what actually blocks Daniel's goals)

1. **The gate covers one path of three.** The boss's daily work — Agent-tool subagents and hand-authored codex cards — is the bulk of substantive execution, and it runs entirely **outside** `promotion.decide()`. Track record accrues in grades but never converts to unsupervised privilege for these paths. So "autonomy graduation" today only graduates *cadences*, not the *agents* Daniel actually delegates to.
2. **The demote loop is diagnosed but not wired.** `trust.py --check-regressions` finds subjects that fell below floor, but per its own docstring "emitting the wake-me / cadence-pause on that signal is the DISPATCHER's job (a later wave)." The promote direction is live; the **automatic demote → pause/wake-me** direction is not.
3. **Agents are ephemeral.** Agent-tool subagents have no persistence across boss sessions — no durable session, no resume, no "this agent, over time." An "agent" in kb today is really a *prompt template* (`agents/*.md`, `routines/roles/*.md`) instantiated fresh each time. There is no first-class, long-lived agent process. This is exactly the gap the Agent SDK addresses (§3).
4. **No machine-checked tool-permission chokepoint.** Governance is by card + tier + human review + the constitution's prose rules ("never handle credentials as objects"). There's no single deterministic point every tool call transits, and no per-agent blast-radius artifact. Autonomy can't safely widen past a human eyeball without this (§5).
5. **The "second brain" seed exists but is deliberately inert.** `scripts/dream.py` (Wave C "Dreaming") mines `memory/*.md` + grade rows into ADD/UPDATE/DELETE/NOOP memory-consolidation proposals — but it is **report-only, no apply path at all**, design-gated behind Proving Grounds trust. It's the learning-miner half of a second brain, frozen at "propose."

---

## 3. What the Claude Agent SDK actually adds — labeled

Verified against `code.claude.com/docs/en/agent-sdk/overview` (2026-08-17). The SDK is "Claude Code as a library" for **Python and TypeScript**, running the same agent loop, tools, and context management in *your own process*.

| SDK capability | What it concretely gives kb | Confidence |
|---|---|---|
| **Sessions** — "maintain context across exchanges, **resume or fork** later" | The missing persistence layer: a first-class agent that *is the same agent* across invocations, not a fresh subagent each turn. Enables the second brain to carry state day to day. | **VERIFIED** (capability named). Resume/fork *mechanics + storage location* — **ASSUMPTION, verify** with the sibling capability-probe. |
| **Headless / run-as-a-service** | Overview: to drive the loop from another language, "run the CLI as a subprocess with `-p` and `--output-format json`." An SDK agent runs *in your process*, so it can sit under systemd on the VM as a long-running service. | **VERIFIED** shape; specifics of a persistent daemon loop — **ASSUMPTION, verify**. |
| **Hooks** — "run custom code at key points in the agent lifecycle" | The programmable enforcement point for the permission/blast-radius chokepoint (§5) and for the model-verify/context-load the hooks sibling owns. | **VERIFIED**. (Mechanism = hooks sibling's turf; I note only that the SDK exposes them.) |
| **Permissions** — "control which tools run automatically, which need approval" | A native fail-closed tool-gate the blast-radius layer can bind to, instead of kb's prose-only rules. | **VERIFIED**. |
| **Subagents / MCP / Skills-commands-memory / Plugins** | SDK agents load `.claude/` and `~/.claude/` "same as Claude Code" — so kb's existing skills, agents, memory, and MCP servers work in an SDK-built agent unchanged. Lowers the port cost dramatically. | **VERIFIED** (named), integration fidelity — **ASSUMPTION, verify**. |
| **Managed Agents** (separate product) | Hosted REST API where "**Anthropic runs the agent and the sandbox**" for long-running/async agents. An alternative to self-hosting the second brain on kb's VM. | **VERIFIED** exists; fit for kb — see the auth blocker below. |

### 3.1 The load-bearing blocker — flag for the boss to reconcile

The SDK overview carries an explicit note: **"Unless previously approved, Anthropic does not allow third-party developers to offer claude.ai login or rate limits for their products, including agents built on the Claude Agent SDK. Use the API-key authentication methods instead."**

This **collides head-on with kb's constitution.** `CLAUDE.md`'s preamble hard-fails any fleet agent whose environment holds `ANTHROPIC_API_KEY` — kb is **subscription-billing only**, with a single narrow exception (the Atlas voice worker's spend-capped key, held out-of-repo, ledgered under the budget guard). A standalone Agent-SDK agent running headless is exactly a "product built on the SDK" and, per Anthropic's own terms, must authenticate with an **API key = metered spend = real money**.

**Implication:** the whole "second brain runs as me while I'm away" idea, and any first-class SDK agent, cannot run on the subscription the way the boss session does. Its options are (a) an **API-key-metered SDK agent** governed by the budget guard + a hard daily cap (like Atlas voice), or (b) **Managed Agents** (Anthropic-hosted, also API-billed). Either way it **spends**, which trips the "never spend real money" law unless Daniel explicitly authorizes a metered lane. **This is the single most important thing for the boss to resolve before any SDK-agent build is scoped.** A sibling capability-probe agent also covers the SDK; the two findings must be reconciled — if the probe reports a subscription-auth path for SDK agents, that supersedes this blocker; if not, this is a hard gate.

### 3.2 Where the SDK changes kb's model

Today an "agent" is a prompt template run ephemerally by the boss. The SDK makes an agent a **persistent process with its own session, tools, permissions, and hooks**. That is the enabling substrate for (a) first-class long-lived agents, (b) the second brain, and (c) a programmable tool-permission chokepoint. But it does **not** change the governance model — grading, cards, tiers, and the promotion recompute stay the authority. The SDK is the *runtime*; `promotion.py` + the blast-radius layer remain the *policy*.

---

## 4. Autonomy-graduation gate — design (extend what exists)

The gate is built. The design work is **coverage + the demote direction + a blast-radius bound**, not a rebuild.

### 4.1 Inputs (already defined, keep)
- **Grades:** `ledgers/grades/**`, filtered to trusted graders via `governance/graders.yaml` (`promotion.trusted_grades`). Human-edited anchor; fail-closed empty.
- **Tiers:** `governance/risk-tiers.md` windows/bars/floors, mirrored in `promotion._TIERS`. **Human-edited** — see §5's human gate.
- **Key:** `(worker, project, task_type, tier)`. Autonomy is per-capability, never global.
- **Overrides:** `FROZEN` sentinel (fleet freeze), standing-authorization (exact cadence block on protected `origin/main`).

### 4.2 The machine-decidable rule (already implemented — state it, don't re-derive)
`status()` returns `autonomous` iff **not frozen**, tier known, ≥`window` graded runs in the current streak, and none of the last `window` runs below the tier bar; **any below-floor run resets the streak.** `decide()` layers precedence: FROZEN → queues-for-me; else standing-authorized → acts-alone; else earned-autonomous → acts-alone; else queues-for-me. **T3 acts-alone is always downgraded to a human token** (permanent cap). This is the promote/demote rule Daniel wants — it already exists and is symmetric (a floor breach demotes by resetting the streak on the very next recompute, since autonomy is never stored).

### 4.3 The three design deltas (this is the actual work)

1. **Extend the gate to the boss's Agent-tool + hand-carded codex paths.** Today only `dispatch.py` calls `decide()`. The overhaul should make the *same recompute* the gate for **any** agent about to act unsupervised, whatever the runtime — a shared `should_act_alone(worker, project, task_type, tier)` seam the boss (or an SDK agent's pre-flight hook) consults before running without a human in the loop. Net effect: track record from boss subagents finally *converts to privilege*, which is what "graduation" means to Daniel. Risk: the boss session runs on Fable and is itself the human-facing orchestrator — decide carefully *which* boss delegations are "unsupervised" vs "Daniel is right there." (Open question §8.)
2. **Wire the demote → act loop.** `trust.py --check-regressions` already finds demote candidates; the fleet-layers spec says the dispatcher should, on a below-floor canary/grade, emit a wake-me card **and** (if the subject was acts-alone) drop a `queue/paused/<cadence>` sentinel. Build that emission. This closes the narrowing half of "widens/narrows."
3. **Bound every acts-alone verdict by the blast-radius artifact (§5).** A promotion verdict currently answers *"may this key run without a human?"* It does not answer *"and what may it touch when it does?"* The gate must become a **conjunction**: `acts-alone AND action ⊆ agent's blast-radius`. Without §5 this is prose; with §5 it's machine-checked. This is the dependency the spine ordering (backlog: #9 before #1 widens) is really about.

### 4.4 Effort / risk
- Extend-the-seam: **M**. The pure logic is reusable as-is; the work is threading `decide()` into two more call sites and defining "unsupervised" for the boss path.
- Demote emission: **S**. Signal exists; wire the card/pause write (dispatcher, ops branch, files-only).
- Blast-radius conjunction: **blocked on §5** (L overall, mostly §5's cost).
- Risk: the gate is a **security control** — any change to `promotion.py`/`dispatch.py` is opus-review-and-adversarial territory (privilege escalation, the very class the code's own comments guard against, e.g. the `origin/main`-not-local-main standing-auth defense). Do not let a coverage-widening refactor loosen a fail-closed default.

---

## 5. Permission / blast-radius layer — design (net-new substrate)

This is the genuinely **net-new** piece (backlog #9) and the substrate §4.3 and §6 both need. Two components:

### 5.1 A single deterministic tool-access chokepoint
Every tool call an agent makes transits **one policy function** that returns allow/deny/needs-approval, fail-closed by default. In an Agent-SDK agent this binds to the SDK's **Permissions + Hooks** (§3) — a `PreToolUse`-style hook that consults the policy before any tool runs. For the boss/Agent-tool path it's a wrapper the boss consults. The policy reads:
- The agent's declared `permission_policy` (per-tool, tied to risk-tier) from its spec.
- The agent's **blast-radius artifact** (below).
- The live tier/grade verdict (§4) for the capability being exercised.

Design principles (fail-closed, from kb's existing posture): unknown tool → deny; credential-as-object → deny always (the T4 hard ceiling, non-negotiable); ambient runtime credential → may use but never print/copy/persist/transmit (mirrors the constitution verbatim); durable JSONL log of every decision (append-only, like the ledgers).

### 5.2 A per-agent blast-radius artifact
A pre-computed, machine-readable declaration of the maximum reachable surface for each agent identity: which paths it may write, which tools/MCP servers it may call, which credentials are *in principle* reachable from its session, and the projected damage if that session were compromised. The security invariant Daniel named: **one compromised sign-in must not hand every agent the browser session + files + CLI creds.** The artifact makes that checkable — and lets a UI render it (the backlog's aspirational "BLAST RADIUS" panel gets *real data* to show once this exists). It's the object §4.3.3's conjunction checks against.

### 5.3 The human design gate — flag explicitly
The per-tool `permission_policy` and the blast-radius bounds are **an interpretation of `governance/risk-tiers.md`, which is human-edited-only** (`CLAUDE.md`: "`governance/` and `CLAUDE.md` are human-edited only"). Agents may *build the chokepoint and the artifact generator*, but the **tier→permission mapping and the blast-radius ceilings must be authored/ratified by Daniel** — an agent proposing them is fine; an agent committing them to `governance/` is a constitution violation. **Present this as a human gate: Daniel ratifies the policy table before the chokepoint enforces it.** Until ratified, the chokepoint runs in **report-only/shadow mode** (log what it *would* deny), exactly as `dream.py` runs report-only until Proving Grounds trust exists — a pattern kb already uses for un-ratified self-governance.

### 5.4 Effort / risk
- Chokepoint (shadow mode): **M**. Policy function + hook binding + JSONL log; testable against a fixture of tool calls.
- Blast-radius generator + artifact: **M–L**. Static analysis of each agent spec's reachable surface; the hard part is *credential reachability*, which must be conservative (over-report, never under-report).
- Enforce mode: gated on Daniel's ratification (human gate).
- Risk: **highest in this subsystem.** A chokepoint that fails *open* is worse than none (false sense of safety). Opus build + adversarial review mandatory; ship shadow-first, flip to enforce only after the shadow log shows zero false-allows on a red-team fixture.

---

## 6. The "second brain / run-as-me" agent

### 6.1 What it is
An Agent-SDK agent that (a) **mines Daniel's conversations and decisions** for what he'd want persisted (preferences, rulings, standing answers), (b) **keeps that as durable memory**, and (c) **can act within a tight bound** when he's away — triage the inbox, clear routine human-gates he's pre-authorized, draft the decisions he'd make, and surface only the genuinely novel ones.

### 6.2 It's half-built, deliberately inert
`scripts/dream.py` is the **learning-miner** already: deterministic, LLM-free consolidation of `memory/*.md` + grade rows into ADD/UPDATE/DELETE/NOOP proposals following the "merge-dupes / replace-stale / prune" contract — **report-only, no apply path, design-gated behind Proving Grounds trust.** `mission_control.py` is the **triage projection** (ranked morning backlog using the promotion assurance vocabulary). The second brain is largely *these two, given a session and a bounded apply path* — not a from-scratch build.

### 6.3 Agent-SDK shape
- **Persistence:** an SDK **Session** (resume across days) is what turns "a nightly `dream.py` dry-run" into "an agent that remembers what it already proposed and what Daniel accepted." This is the SDK's core add here.
- **Runtime:** a long-running/scheduled SDK agent (systemd on the VM, or a `schedule`d cadence). Loads kb's `.claude/` skills + memory unchanged (§3).
- **Tools:** read-broad (memory, handoffs, ledgers, queue), write-narrow (its own proposal artifacts + memory-consolidation *branches*, never direct `memory/` rewrites — same as `dream.py` today).

### 6.4 Guardrails (non-negotiable, from the constitution)
- **Never spend real money; never handle a credential as an object** (T4 hard ceiling). If §3.1's auth blocker forces an API-key lane, it runs under the budget guard with a **hard daily cap** and $0-or-refuse behavior — like Atlas voice, and no wider.
- **Bounded action space, reversible, numbered** (the Karpathy/`dream.py` regime): it *proposes on a branch*; a human (or, once §4 trust exists for the `dream`/`second-brain` task-type, a graduated apply path) merges. No auto-apply to `memory/`, `governance/`, `orgs/*/contract.md`, or any work tree — these are already the excluded set in `risk-tiers.md`'s nightly-review carve-out; reuse that exact boundary.
- **Acting "as Daniel" ≠ Daniel's authority.** It can *draft* his decisions and *clear pre-authorized routine gates*, but a T3 action (merge to main, publish, deploy) **still needs his WebAuthn-signed token** — the second brain cannot mint one. It concentrates his judgment (drafts + triage), it does not replace his approval channel.

### 6.5 Realistic scope (v1)
Not "an autonomous Daniel." A **bounded night-shift chief of staff**: run `dream.py`'s miner live on a session, run `mission_control.py`'s triage, **draft** the decisions on the ranked backlog, clear only the explicitly pre-authorized routine items (the nightly-review carve-out is the template for *exactly* what "pre-authorized" means and what stays excluded), and leave a morning brief of "here's what I'd do, here's the 3 novel things only you can decide." Everything else queues for him. Effort: **M** if the auth lane is resolved (it's mostly wiring existing miners to a session + a bounded apply path); the auth reconciliation (§3.1) is the true gate.

---

## 7. Net-new vs extends — components, interfaces, effort, risk

| Component | Status | Interface / seam | Effort | Risk |
|---|---|---|---|---|
| Autonomy recompute (`promotion.py`) | **EXISTS, live** | `decide()/status()` pure fns | — | Security-critical; don't loosen |
| Gate coverage → boss/codex paths | **EXTENDS** | shared `should_act_alone()` seam | M | Priv-esc; define "unsupervised" carefully |
| Demote → wake-me/pause emission | **EXTENDS** | dispatcher writes card + `queue/paused/` | S | Files-only, ops branch |
| Trust reporting (`trust.py`) | **EXISTS** | `dashboards/trust.md`, `--check-regressions` | — | — |
| Deterministic tool-access chokepoint | **NET-NEW** | SDK Permissions+Hooks / boss wrapper; fail-closed policy fn + JSONL log | M (shadow) | Highest — must fail closed |
| Per-agent blast-radius artifact | **NET-NEW** | generated artifact per agent id; consumed by §4.3.3 + UI | M–L | Must over-report cred reachability |
| Policy table (tier→permission, blast ceilings) | **NET-NEW, human-authored** | `governance/` (Daniel ratifies) | S to draft | Constitution: agents propose, human commits |
| First-class SDK agent runtime | **NET-NEW** | Agent SDK session + systemd/schedule | M–L | Auth blocker §3.1 |
| Second-brain miner (`dream.py`) | **EXISTS, report-only** | `dream_report()`, no apply path | — | Design-gated |
| Second-brain apply path + session | **NET-NEW (bounded)** | branch-only apply + SDK Session | M | Never-spend/never-cred; reuse nightly-review exclusions |

**Dependency order (matches the corpus spine intuition, corrected):** the chokepoint + blast-radius artifact (§5, net-new) is the true long pole and gates the *safe widening* of the already-built gate (§4) and the *acting* second brain (§6). Metric-definitions (#5) helps but the grade schema is already consistent enough for `promotion.py`, so §5 is the real critical path here, not #5.

---

## 8. Open design questions for Daniel

1. **How far does autonomy actually widen — self-dispatch within blast-radius without a card, or always leave a record?** The sharpest question. Options: **(a) always-a-record** — even an acts-alone agent writes a card/ledger row before acting (full auditability, slight latency); **(b) self-dispatch within blast-radius** — a graduated agent acts directly inside its machine-checked bound and only *logs* after (faster, thinner paper trail). kb's whole design leans (a) — cards are "handoffs that cross session boundaries," autonomy is recomputed-not-stored, everything is ledgered. My read: **(a) with a lightweight post-hoc ledger row** preserves the audit invariant while still feeling autonomous. Needs his call.
2. **Does "graduate the boss's Agent-tool subagents" even make sense, given the boss is Daniel-facing?** When Daniel is *in* the session, delegations aren't "unsupervised." Should the gate apply only to background/overnight boss work, or to a distinct "boss-away" mode? Defining "unsupervised" for the interactive path is a doctrine question, not a code one.
3. **The SDK auth lane (§3.1) — does Daniel authorize a metered API-key second brain (budget-guarded, hard-capped, Atlas-voice-style), accept Managed Agents (also metered), or keep the second brain to $0 report-only until a subscription-auth SDK path exists?** Blocks all SDK-agent scope. Reconcile with the sibling capability-probe's SDK findings first.
4. **Who authors the tier→permission policy table and blast-radius ceilings?** Confirmed human-gate (§5.3) — but does Daniel want to author it cold, or have an agent draft a proposal from the existing risk-tiers + agent specs for him to ratify? (The latter is on-doctrine: agents propose, Daniel commits.)
5. **Second-brain apply path: human-merge-only forever, or does the `dream`/`second-brain` task-type itself graduate** through the same §4 gate once it has a track record, eventually earning a bounded auto-apply? This is autonomy graduation applied *to the second brain itself* — powerful, and exactly the kind of self-modification Proving Grounds was designed to gate. Almost certainly "human-merge-only for v1," but worth naming the graduation path.

---

_Sibling-reconciliation flags for the boss:_ (i) **§3.1 SDK auth blocker** vs the capability-probe sibling's SDK findings — load-bearing, resolve first. (ii) The **hook mechanism** for the §5 chokepoint is the lifecycle/hooks sibling's to design; I specify only the policy it enforces. (iii) The **step-envelope evaluator** (evaluation sibling) is the upstream that produces the grades §4 consumes — I assume its output lands as trusted rows in `ledgers/grades/**`; confirm the schema matches `promotion.py`'s expected columns (`worker, project, task_type, tier, score, pass, inspector_id, ts`).

# Agent-Building Infrastructure — Design Spec

Date: 2026-08-18 · Branch: `claude/agent-platform-w1` · Status: DRAFT (gates on Daniel's review)

## Goal

Every kb agent — Claude or codex, interactive or scheduled — automatically HAS a shared,
versioned infrastructure kit (context doctrine, spin-up guidelines, standard loops,
self-learning rules); Daniel can spin up a new agent in one step with all of it pre-wired,
measure any agent with task-specific evals, and dispatch agents on repeated schedules
managed from the dashboard. Editing the kit once changes every agent's next run.

**Success condition:** the P6 platform proof — a factory-spawned demo agent loads the kit
in both runtimes, runs its eval suite into the pinned grades ledger, and fires on a
committed schedule with narration visible in the dashboard feed, all on the isolated
display dashboard, with zero API spend.

## Non-goals (YAGNI — ruled out deliberately)

- Claude Code plugin packaging for the kit (unreachable from codex workers; duplicates `scripts/sync_skills.py`).
- Any change to the pinned grade-row schema in `scripts/grade.py` (a golden canary asserts extras are rejected).
- Versioned worker identities (`agent@vN` as ledger `worker`) — would reset `promotion.py` autonomy streaks.
- A dashboard-owned schedule store (would mint standing authorization without a human commit).
- An LLM memory reconciler (deterministic `scripts/dream.py` already owns consolidation; extraction stays in `session_miner.py` / Loop B).
- Per-block *token* accounting (no tokenizer in-repo; `count_tokens` is metered). Budgets are bytes.
- Config-fork A/B infrastructure, full Temporal policy matrix, paid external tools.

## Grounding

Inputs: Claude Agent SDK architecture study + agent-framework landscape study (Letta,
LangGraph, OpenAI Agents SDK, inspect-ai, promptfoo, mem0, Temporal/Airflow, plugins,
AGENTS.md), synthesized and then adversarially reviewed fresh-context against kb ground
truth (verdict SOUND-WITH-CHANGES; all three blockers + majors incorporated below).
Standing rulings: kit referenced not copied; OSS lifting only; subscription-only billing;
task-specific evals per agent; scheduling managed via dashboard UI; anti-duplication is law.

---

## §1 Kit — content model

**Location:** in-repo, versioned by git. Two parts:

- `skills/curated/` — executable skills (existing home, existing promotion gate).
- `kit/` (new, repo root) — doctrine and context blocks every agent loads.

**Block format:** one markdown file per block with frontmatter:

```yaml
---
name: <kebab-slug>
description: <one line — ALWAYS loaded, the router>
when: <trigger condition — task kinds / projects / runtimes this block applies to>
audience: all | claude | codex | <agent-id list>
read_only: true|false        # true = doctrine; assembly refuses agent-authored edits
budget_bytes: <int>          # hard ceiling; assembly truncation is an ERROR, not silent
---
<body>
```

**Progressive disclosure (three levels):**
- L1: every block's `description` line — always in every agent's context (~1 line each).
- L2: block bodies — loaded only when `when` matches the dispatch (routing, not load-everything).
- L3: scripts — never loaded as text; agents run them and only the *output* enters context.

**Initial blocks (content, not code):** spin-up doctrine (preamble, branch rules, worktree
leases), context-refresh doctrine (when to re-ground, what to drop), standard loops (which
loop types an agent runs and when to wake a human), lesson-writing doctrine (append-only,
least-general file), file-editing rules (edit core logic, cross-file consistency, no bloat,
slim files), dispatch/spin-up guidelines for sub-work.

**Precedence — two laws, stated in the kit's root block:**
1. *Routing* (which instruction applies): nearest scope wins — card > agent def > org contract > kit default.
2. *Authorization* (what is allowed): most-restrictive wins — CLAUDE.md hard ceiling and
   `governance/**` are outermost AND strongest; contracts narrow, never widen; `## Evidence` is inert.
   Nothing nearer may relax an outer restriction.

**Kit ↔ context store:** the kit is the missing *writer* for the U8 context store's reserved
headings (`## North star`, `## Invariants`, `## Current gate`) — the seam U7's extractor
already consumes byte-exactly (MORNING-REPORT decision-note #2). A kit assembly step renders
the matched blocks into those headings. No parallel manifest store.

## §2 Delivery — how agents get the kit

- **Mechanism:** extend `scripts/sync_skills.py` (authoritative source → SHA-256
  `MANIFEST.json` → byte-identical projections into `.claude/skills/` AND `.agents/skills/`;
  `--check` drift gate already in nightly-review) to also project `kit/`. Both runtimes reach
  it; codex workers read repo files fine.
- **Version = git SHA.** An agent's kit version is the commit its branch was cut from; "change
  once, all change" = merge the kit edit; rollback = git. No install/pin machinery.
- **Spawn injection:** the existing U9 spawn context-load hook seam (INERT until Daniel arms
  it per its runbook) injects L1 descriptions + matched L2 bodies at spawn. Codex workers get
  the same content prepended by `codex_dispatch.py` from the same rendered artifact — one
  renderer, two transports.
- **Envelope vs context pack:** card frontmatter is already the machine-only run envelope
  (id, owner, schedule, tier); the kit render is the model-visible context pack. The renderer
  never serializes frontmatter into context; budgets apply to the pack only.

## §3 Factory — one-step agent creation

`scripts/agent_factory.py new <id> --role <role> ...` produces, in one run:

- `agents/<id>.md` — U3 six-field complex-agent schema, kit reference (not copy), declared
  autonomy ceiling (advisory), model default per `governance/model-routing.yaml` profiles.
- `memory/<id>.md` — seeded empty with the lesson-writing header.
- `evals/agents/<id>/` — suite skeleton (§4) with at least one golden task.
- Tests asserting the def parses through the existing roster loader.
- **A queued card** (ops) for the human-edited half: `governance/model-routing.yaml` entry and,
  if the agent grades others, `governance/graders.yaml`. The factory NEVER writes `governance/**`.

Worker identity is stable for life — config changes never rename the `worker` field anywhere.
Attribution of "which kit/def version did this run use" goes on the *card* (def commit SHA),
never into the grades ledger.

## §4 Evals — per-agent, on existing canary machinery

- **Reuse:** `evals/canaries/` machinery as-is — immutable golden cards, deterministic judges,
  stable ids, `MANIFEST.sha256` tamper-refusal, human-gated `--update-manifest` re-blessing.
- **New:** `evals/agents/<id>/` suites = golden task cards specific to that agent's job
  (dataset + scorer fixed; the "solver" is the agent at whatever kit/def SHA runs).
- **New judge tier:** model-invoked judging for tasks a deterministic judge can't score, run
  headless via subscription `claude -p` under the inspector identity; its verdict still lands
  through `scripts/grade.py`'s pinned schema (explanation goes in the card `## Result`).
- **Fleet baseline suite:** asserts every agent inherits — no credential objects, no push to
  main, lesson appended, cost ledgered under cap.
- **Trigger:** kit/doctrine/agent-def changes wire into the existing `--diff-guard <range>`
  in pre-commit/CI, **report-only** — a red suite blocks nothing automatically and never
  remediates (loop-design-check #3); manifest re-blessing stays a human act.

## §5 Scheduler — repeated dispatch, dashboard-managed, human-authorized

- **Mechanism layer stays:** `HEARTBEAT.md` cadence blocks + `scripts/dispatch.py` `due()` as
  the single clock; overlap-skip (per-day dedup), `queue/paused/<name>` sentinels, retry/
  dead-letter all exist — extended, not shadowed.
- **New in `due()`:** named calendar fields (`days: [mon,thu]`, `at: "07:00"`, `every: 2w`)
  alongside the existing `daily|weekly:<day>` forms (back-compatible; the four live blocks
  parse unchanged). Bounded catch-up: at most one missed occurrence, only within a declared
  window; default = skip missed.
- **Stamps:** every dispatched card records `scheduled_for` AND `dispatched_at` (a catch-up
  run knows which occurrence it is).
- **Dashboard = editor, never owner:** a Schedules panel that (a) renders every declared
  cadence with next-fire/last-result/paused state, (b) lets Daniel compose or edit a block
  and EMITS the HEARTBEAT diff for him to commit (authorization remains "a human committed
  it to main", byte-compared by `promotion._standing_authorized`), and (c) toggles the
  existing pause sentinels (a files-only act, within the panel-write rules the loops arc
  established). It never writes HEARTBEAT.md itself.
- **Narration:** scheduled runs keep the loops-arc contract — first `## Result` line is the
  human-voiced "Hey — <found>. <did>. Needs you: <what/nothing>." surfaced by the loop-status
  panel feed; the Schedules panel reuses that feed, one vocabulary.

## §6 Self-learning integration (no new machinery)

Extraction = `session_miner.py` / Loop B (append-only proposals, human promotes).
Consolidation = `scripts/dream.py` (deterministic, no apply path). The kit adds the
*doctrine* (when to write lessons, where, in what shape) — it adds no new memory engine.
Five-value approval vocabulary (approve / modify / reject / escalate / terminate) adopted
in card review flows where approvals surface. Everything upstream of a human gate must be
idempotent (safe to re-run after an interrupt).

## §7 Build rules (binding on every unit in P3–P5)

1. **Probe first:** every unit opens with an anti-duplication SPEC probe — if kb already
   provides it, the unit shrinks to wiring or dies.
2. Edit core logic in place; keep behavior consistent across files; never bolt on.
3. Slim files, no dead info, no speculative config.
4. Workers never commit; the boss commits after reviews.
5. Every unit: fresh-context opus unit Inspector (deterministic + adversarial) + fresh-context
   opus goal Auditor; every subagent model transcript-verified; retry cap 2 → BLOCKED.
6. Coordination writes → ops branch per constitution; `governance/**` untouched by any worker.
7. Testing is empirical and platform-borne: unit tests per change PLUS the P6 end-to-end
   proof on the isolated :4630 display dashboard.

## §8 Sequencing

P3 Kit + delivery → P4 Factory + evals → P5 Scheduler + surfaces → P6 platform proof.
(P3 before P4 because the factory wires kit references; P5 independent after P3, may
interleave. Wave-2 leftovers that intersect — brain sidecar, north-star writer — fold into
P3's kit-renderer unit rather than running separately.)

## Acceptance for the arc

1. `kit/` blocks exist with valid frontmatter; assembly enforces `read_only` + byte budgets (error, not truncation); sync `--check` green for both runtime projections.
2. Kit render fills the U8-store reserved headings and U7's extractor consumes it with zero U7 edits (existing test extended, not weakened).
3. `agent_factory.py new demo-agent` yields def + memory + suite + tests green + governance card queued; roster loader lossless.
4. Demo agent eval suite runs (deterministic + one model-judged task via `claude -p`), grades land through unchanged `grade.py`; canary suite still green, including the extra-field rejection canary.
5. `due()` parses named calendar fields AND all four live HEARTBEAT blocks byte-unchanged; `scheduled_for`/`dispatched_at` stamped; standing-auth byte-compare still passes for existing armed cadences.
6. Schedules panel renders cadences, emits a valid HEARTBEAT diff (never writes it), toggles pause sentinels; narration feed shows the demo agent's scheduled run.
7. $0 API spend; no writes to `governance/**` or the grades schema by any worker; all reviews model-verified.

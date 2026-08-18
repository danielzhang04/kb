# kb Agent Platform — GOAL-STATE

_Re-read this at the start of every build unit and after any compaction. This is the north star the whole program serves; if a decision doesn't move toward it, don't take it._

## North star
kb becomes a platform to **build, equip, run, and manage complex agents** — over a
queryable semantic **brain**, disciplined **context** lifecycle, step-level
**evaluation**, real **autonomy-with-safety**, and a legible **command center**.

The inspiration is four solo-operator "AI agent company" dashboards (Bennett OS, The
Climb, Optimal Engine, Sunflow Agentic OS). kb already **is** the architecture they
sell as the destination (`CLAUDE.md + orgs/ + skills/ + ledgers/queue/`) and is ahead
on the hard parts they lack — governed control plane, WebAuthn fail-closed gates,
immutable VM deploy, an independent grading/trust loop. What kb lacks is **the brain,
the plumbing, and the legibility** hung off that structure. We are NOT building their
business features (CRM / funnel / payments / ads / finance) — kb runs an agent fleet +
fyt, not a storefront. We ARE building the infrastructure to author and manage agents
of that complexity.

## This run's scope — Wave 1 (Foundation only)
Subscription-only, local embeddings, nothing merged. Build depth-first, in value order:
- **A · Semantic Brain** — local-embedding index + semantic query over the corpus.
- **B · Context Lifecycle** — re-grounding hook, per-terminal context object, subagent
  inheritance without double-read.
- **E · Fleet Hooks & Hygiene** — spawn model-verify hook, learning miner, file cleanser
  (dry-run), guideline docs, keep-on built *disabled*.
- Each unit gets a **visible surface** on a new "Agent Platform — Wave 1" dashboard view.

Excluded from unsupervised work: the governance-gated enforcement in Waves 2–4
(permission/blast-radius policy, run-standards) — those interpret human-edited
`governance/risk-tiers.md` and need Daniel's ratification. The Second Brain (Agent-SDK,
metered) is deferred until a budget-guarded lane is authorized.

## Invariants (never violate)
- Never merge; never push to `main` or `ops`. Push only the work branch.
- Never edit `governance/**` or the root constitution files (a hook blocks it).
- Never spend real money; no `ANTHROPIC_API_KEY`; local embeddings only.
- Never delete/weaken tests or lower coverage; never delete repo files (cleanser is
  dry-run-only); never arm keep-on/auto-continuation/cadence on the fleet.
- Every build unit is verified by an **independent** fresh-context Inspector, not its
  builder. Daniel flips every "done" switch in the morning.

## Success condition for the run
A pushed `claude/agent-platform-w1` branch + an isolated, display-only dashboard
instance on a distinct port Daniel can unlock, showing the Wave-1 features that got
built, each with a decidable "how to see it work" proof and independent PASS grade,
plus a MORNING-REPORT.md and any decision-notes.

## Load
- `docs/plans/2026-08-18-agent-platform-program-spec.md` (the full 7-sub-project plan)
- `docs/research/_ig-saved/analysis/*.md` (the deep subsystem analyses)
- `docs/research/_ig-saved/current-state-capability-map.md` (what kb has today)

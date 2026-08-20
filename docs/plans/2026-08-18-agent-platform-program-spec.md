# kb Agent Platform — Program Spec

_Companion to `2026-08-18-agent-platform-GOAL-STATE.md`. Source analyses in
`docs/research/_ig-saved/analysis/`. This is the multi-wave decomposition; each
sub-project gets its own spec → build → adversarial-review → verify loop._

## Strategic frame
kb already embodies the target architecture and is ahead on governance/control-plane/
deploy/grading. Several things that looked "net-new" are already built — the plan must
extend, not rebuild:

| Assumed net-new | Reality | Evidence |
|---|---|---|
| Autonomy graduation gate | **Built & live**, cadence path only | `scripts/promotion.py` + `dispatch.py` + `graders.yaml` + `trust.py` |
| Run-envelope for eval | **Captured but inert** | `trace/render.ts` records every step; nothing grades it |
| Context plugin ("the one Daniel loaded") | **Installed, disabled** | ECC ships inject/summarize/track; kb killed it (GateGuard clash) |
| Learning miner | **Half-built** | `dream.py` consolidates memory; no transcript→new-fact producer |

## The 7 sub-projects

| | Sub-project | What (net-new unless noted) |
|---|---|---|
| **A** | Semantic Brain | RAG/vector retrieval over the corpus, local embeddings (no spend). The queryable brain complex agents need. |
| **B** | Context Lifecycle Mgr | Periodic re-grounding, subagent inheritance without double-read, per-terminal context object, smart freshening (reclaim-or-replace ECC — a Daniel decision). |
| **C** | Run-Envelope Eval | Activate the inert flight-recorder: step-class standards + deterministic checker → the trust loop. *Extends* inspector/grade. |
| **D** | Autonomy + Safety + Grants | Extend the live gate to all execution paths (boss subagents + codex, not just cadence); wire demote/auto-pause; **net-new machine-checked permission + blast-radius chokepoint with per-agent tool/connector grants**. |
| **E** | Fleet Hooks & Hygiene | Spawn hooks (model-verify + context-load), keep-on Stop-loop (hard-capped, built disabled), file cleanser (dry-run), learning miner (`session_miner.py`), editing/subagent guideline docs. |
| **G** | Agent Platform | Author/equip/manage complex agents: templates + detail cards (role, model, tools, knowledge, autonomy tier), governed tool/connector grants (via D), knowledge access (via A), event-trigger bus (webhook→workflow). The "support agents of that complexity" capability. |
| **F** | Command-Center UI | Design-language pass + drawn fleet graph, autonomy-ladder view, NEEDS-REVIEW panel, maturity "climb", branch/PR panel — renders A–G over real data. |

**Deferred:** Second Brain / run-as-me (Agent-SDK = metered spend) — parked until a
budget-guarded lane is authorized.

**Out of scope:** the inspiration demos' business surfaces (CRM/funnel/payments/ads/
finance ingestion). kb is a fleet + fyt, not a storefront.

## Sequencing (dependency-driven)
- **Wave 1 — Foundation:** A + B + E (all subscription-clean, mostly parallel). ← *this overnight run*
- **Wave 2 — Trust & Safety:** C → D (C feeds D; D's grants gate the Agent Platform).
- **Wave 3 — Agent Platform:** G (uses A + D).
- **Wave 4 — Legibility:** F (renders everything).
- **Deferred:** Second Brain.

## Governance gates (supervised only — NOT in unsupervised runs)
- D's permission policy and C's run-standards interpret human-edited
  `governance/risk-tiers.md` → build shadow/report-only first; Daniel ratifies before
  they enforce.
- B's ECC reclaim-vs-replace is a Daniel decision.
- The metered-API lane (Second Brain, API embeddings, SDK keep-on) needs Daniel's
  explicit authorization; until then everything is subscription-clean.

## Build discipline (every sub-project)
spec → build (safety/permission code = opus + adversarial review) → independent
fresh-context Inspector → reinject GOAL-STATE → verify with evidence → gate. Nothing
merges without Daniel's approval token. Standalone branch; rebase/merge to GitHub after
VM kb goes live.

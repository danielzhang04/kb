# kb overhaul — system-area build backlog

Source: `docs/research/2026-08-17-ig-saved-ai-build-ideas.md` (30 ranked ideas + 19-item dashboard/UI-UX catalog + 8 cross-cutting themes + 37-row appendix). This file reorganizes that priority-ordered deliverable into system-area groups so the shape of the overhaul is visible at a glance. Source rank numbers (`#N`) are preserved; catalog-only entries (no rank number in the source) are marked `[catalog]`.

Tag legend — my judgment of what kb already has, not the source's:
- **NET-NEW** — kb has nothing like this today.
- **EXTENDS-EXISTING** — kb has the substrate/subsystem; this is a real upgrade to it.
- **PARTIALLY-EXISTS** — kb has adjacent pieces (data, doctrine, a related view) but the specific mechanism/artifact described is missing.

---

## 1. Orchestration & Trust

Dispatch, autonomy graduation, harness architecture, self-improving loops.

- **[PARTIALLY-EXISTS] #1 Autonomy-graduation trust gate** — rolling pass-rate per (agent × card-class) auto-promotes/demotes unsupervised-run privilege (20×@≥95% in, <90% out); kb has the grade rows (`ledgers/`) and tiers (`governance/risk-tiers`) but no automated gate that consumes grade history to decide who runs unsupervised.
- **[PARTIALLY-EXISTS] #6 Cheap-model triage sweep before the expensive tier** — a cheap fast model asks "does anything need attention?" every cadence cycle and only then spawns the premium tier; kb's HEARTBEAT/dispatcher wakes on schedule but has no explicit cheap-gate deciding whether to engage the expensive tier at all.
- **[PARTIALLY-EXISTS] #16 Safe autonomous self-improvement loop** — Karpathy-style guardrails (score-gated accept/reject, reversible numbered timeline, tiny steps, bounded mutable action space) as one governed iterate-until-improved loop; kb has grading/inspector loops and `loop-design-check` but not this iterate-and-keep-only-if-better regime, and it must be governance-gated (never-spend, human-gate on high-impact) before use.
- **[EXTENDS-EXISTING] #20 Workflow-platform topology upgrade** — targeted retry (re-run only the failing upstream node, not the whole workflow), a typed shared-state blackboard replacing prose hand-offs, and a canonical reference topology (Router → parallel specialists → Shared State → Integrator → Reviewer → Human Checkpoint → Ship); kb's workflow-platform DAG exists but passes context via card `## Result` + memory + handoffs, and it's unclear it supports targeted retry today.
- **[EXTENDS-EXISTING] #21 Structured intake: PRD-interview → wave plan → brief-reviewer** — a bounded multi-round interview turns a vague goal into an approved PRD + wave plan + dependency graph, then a brief-reviewer agent challenges each task brief before execution; also standardizes research agents emitting a machine-executable SOP instead of prose. Extends the BOSS "restate goal + one clarifying question" discipline into a formal chain kb doesn't run yet.
- **[PARTIALLY-EXISTS] #30 Three-package harness split** — Pi Agent's interactive-CLI / tool-calling-runtime / unified-multi-provider-API split as a reference for isolating model access behind one provider-agnostic seam; kb's harness (boss + Agent tool + codex dispatch) is more implicit — mostly refactor-flavored, overlaps existing model routing.
- **[NET-NEW] `[catalog]` Staged-maturity card template ("THE CLIMB")** — numbered stage cards (01 Context → 05 Compound) with a MOVES checklist and a PROOF-YOU'RE-HERE graduation checklist; documents the autonomy-tier rollout story, pairs directly with #1's graduation criteria.
- **[NET-NEW] `[catalog]` Operator → department-agents → task-list org-chart** — one operator box branching to N department-agent boxes each expanding to its own task list ("one runtime, N agents, M workflows"); documents kb's dispatcher→agents delegation IA, maps onto boss → subagents/codex-workers.

## 2. Dashboard & Git Timeline (visual command center)

- **[EXTENDS-EXISTING] #2 Git Timeline orchestration dashboard** — three phase tabs (Planning/Execution/Review&Merge), a wave-Gantt with dependency edges, a live worktree lane that auto-clears on merge, model-routing annotations. The single strongest surface in the corpus; sits directly over the existing workflow-platform DAG + worktree-leasing discipline the boss already runs by hand. **Spine item.**
- **[PARTIALLY-EXISTS] #18 Model-router UI + tier failover + headroom tile** — a unified provider-grouped model picker with a thinking/effort control and mixture-of-agents preset, auto-failover to the next allowed model on a usage limit, and a budget-headroom tile off `ledgers/cost` + `budget.yaml`; kb has routing logic but no picker UI, effort control, or headroom tile. Honesty caveat: salvage only tier-failover within *allowed* models — the "250+ free providers" framing conflicts with kb's subscription-only posture.
- **[PARTIALLY-EXISTS] #19 Fleet-grid live-worker monitoring view** — a dense grid, one tile per active subagent/codex worker, badge + health dot, scaling to hundreds; kb runs many parallel workers with no dense live-worker grid today. The security-posture side panels (ACCESS LEADER/BLAST RADIUS/ACTION HEAT) are B-roll-sourced and aspirational, not evidenced — treat as a separate, lower-confidence add-on (see Governance & Security).
- **[PARTIALLY-EXISTS] #24 Batch-job builder UI: template → JSON schema → live-run table** — pick a template or free-text objective → configure output schema → run across many inputs → live "3 Completed / 7 Running / 10 Total" table; kb runs many batch jobs (this very analysis, fyt shot batches) with only textual progress today.
- **[PARTIALLY-EXISTS] `[catalog]` Projects-at-a-glance table** — one row per run with Stage / Last Touch / Next Action / Artifacts columns; distinct from Git Timeline (progress) — this is the pull-in detail view for parallel-run legibility, respecting the one-line-indicator preference as the default.
- **[NET-NEW] `[catalog]` Per-stage HUMAN-LED/CLAUDE-LED input→output card pairs** — each pipeline stage names who drives it plus typed Input/Output artifacts; documents who-does-what + concrete hand-offs per workflow-platform stage, distinct from Git Timeline (ownership/artifacts, not progress).
- **[NET-NEW] `[catalog]` "N sources → central AI node → result card" converge-flow** — source cards converging into a pulsing central node fanning out to a result card with a fill-in progress bar, plus a live-incrementing funnel row; applies to cadence/routine status displays ("N inputs, one AI-generated output").

## 3. Human Gates & Approvals

- **[EXTENDS-EXISTING] #4 Human-gate approval inbox/sidecar** — routine items auto-clear inline with a "handled" tag; flagged/high-impact items open a right-side approval panel with drafted output + Approve/Edit. Extends the dashboard inbox already built + T3 gates + fyt GATE 1/2/3, which today surface as prose cards. On-doctrine with "human gates one at a time." **Spine item.**
- **[EXTENDS-EXISTING] #15 Self-healing error/incident card** — a failed node shows the diagnosed failure plus a numbered HOW-TO-FIX checklist that visibly executes and checks off green; remediation, not a status-only red row. Extends the queue/ledgers/dashboards error surface; on-doctrine with "fix, don't defer to Daniel."

## 4. Metrics & Observability

- **[NET-NEW] #5 Canonical metric-definitions semantic layer** — one `governance/metrics-definitions` file defines each fleet metric (cost, budget, grade, `verified`, card status) exactly once; agents/dashboards cite it instead of re-deriving. Sourced claim: Anthropic's own DS team went 21%→95% accuracy with this move. Metric semantics are currently spread across `ledgers/`, `governance/`, and many agent prompts. **Spine item — nearly everything else in this backlog reads or writes one of these metrics.**
- **[NET-NEW] #14 Harness/tool benchmark scorecard** — a frozen task suite with machine-decidable pass criteria run head-to-head across harnesses (pass rate / cost-per-task / median wall-clock), generalized into a "benchmark card" any kb tool claiming a cost/latency win must ship. Sits on top of `ledgers/` + grades + a fixed fixture; kb has no head-to-head harness benchmark today.
- **[EXTENDS-EXISTING] #29 Small dashboard tiles: promote-run-to-cadence + per-unit-cost-vs-baseline** — one-click "promote this proven ad-hoc run into a HEARTBEAT cadence"; a per-task $/unit vs. paid-baseline comparison tile. Mostly-have (cost ledgers + budget guard + `schedule` skill exist); the promote-to-cadence one-click and baseline-comparison tile are the net-new bits.
- **[NET-NEW] `[catalog]` Config panel with per-key status pills** — ~10 config/integration rows each with a colored health pill; kb has many integrations (MCP servers, OAuth) and no single config-health view today.
- **[NET-NEW] `[catalog]` Personal usage-tracking dashboard** — session/message/token counts, streaks, peak hour, favorite model, "what's up next"; a per-agent usage-summary view over kb's activity ledger.
- **[PARTIALLY-EXISTS] `[catalog]` Ranked leaderboard bar chart + dual-metric line chart** — horizontal ranked-bar comparison + a two-series throughput-vs-cost area chart; generic dataviz, low novelty, but a direct fit for grade/ledger comparisons once the metric layer (#5) exists to feed it consistently.

## 5. Skills, Verification & Quality

- **[EXTENDS-EXISTING] #3 Rubric-in-the-skill + bounded self-verify loop** — co-locate the grading standard inside the skill file that does the work; run a `/goal`-style work↔evaluator loop with a try-limit, gated on "can success be verified?" as a pre-flight. Most-cited lever in the corpus for agents that actually finish; kb's grading lives in inspector prompts / card acceptance today, not inside the work skill. **Spine item — #11 and #16 both build on this.**
- **[EXTENDS-EXISTING] #11 Task-observer: passive skill-gap finder that evolves the library** — a background meta-skill watches sessions, mines repeated action sequences into new skill drafts, and proposes edits from user corrections. Automates the "evolved" tier of kb's provenance-tiered skills system, currently done by hand via `writing-skills` + `growth-log`; keep a human promotion gate before an auto-drafted skill goes curated.
- **[EXTENDS-EXISTING] #12 Cross-harness skill/agent distribution + trust-filtered discovery** — one source of specs with a scoped multi-target installer (`--tool` flag), a per-skill install table, NL-intent discovery with a *visible* trust filter (fading unverified/clone/placeholder candidates with reasons), and a domain taxonomy for discovery at scale. Extends the provenance-tiered skills system and directly addresses the tracked `agents/` catalog main↔ops drift; the "imported" tier already exists.
- **[PARTIALLY-EXISTS] #17 Skill/agent detail-card spec template** — a standard card per skill/agent: description, BREAKS-INTO, BUILDS-ON (real dependency graph), WHAT-IT-REPLACES, THE LADDER (autonomy tiers), THE HUMAN, BUILD NOTES, STATUS, a REQUIRED-API-KEYS table, example run prompts. Enriches the agent registry + skills docs + dashboard entity pages; kb has definitions + card-schema but no single card capturing dependency edges + autonomy tier + status. Pairs with #1 (autonomy tier) and #12 (distribution).
- **[PARTIALLY-EXISTS] #27 Agent template gallery + missing fleet roles** — a browsable gallery of ready-made agent templates (incident commander, feedback miner, structured extractor…) plus a gap-analysis naming roles kb hasn't stood up as first-class agents (merge-captain, wave-planner, dependency-mapper, config-doctor, learning-applier, gate-keeper). Extends the agent catalog; lowers the cost of standing up a new agent.
- **[NET-NEW] `[catalog]` SkillTree radial department-constellation org-map** — a real running app: dark radial map, color-coded department clusters around a central "company brain," click-to-zoom to labeled agent-job nodes. A secondary *browsing* view for kb's agent/skill/org catalog — must respect the locked entity-first sidebar IA, so an additional "CHART" view, not a replacement.

## 6. Governance & Security

- **[PARTIALLY-EXISTS] #9 Governed tool-access & permission layer** — declarative per-tool `permission_policy` in agent specs tied to risk-tiers; per-agent credential isolation plus a pre-computed blast-radius map artifact (one compromised sign-in must not hand every agent the browser session + files + CLI creds); fail-closed-by-default tool calling + folder-trust + durable JSONL session logs; evaluate a single deterministic policy chokepoint all tool calls transit. Reinforces `never-handle-credentials`, risk-tiers T1–T3, spend law, and worktree leasing; the net-new pieces are machine-checked per-tool permissions and the blast-radius artifact — kb governs via cards + tiers today, not one deterministic chokepoint. **Spine item — this is the safety substrate #1 and #16 need before autonomy widens.**
- **[EXTENDS-EXISTING] #26 Strix-style automated pen-test cadence node** — an overnight AI pen-test/vuln scan-and-fix run against kb's own exploitable surfaces (dashboard control plane, WebAuthn, broker), added to the security cadence. Extends the `security-review` skill + adversarial review panels; source is a repo-card readthrough only, needs real evaluation before trust.
- **[Design-target, low confidence] Fleet observability security panels (folded from #19)** — ACCESS LEADER / BLAST RADIUS / ACTION HEAT / THROUGHPUT panels + a climbing cost ticker + a scrolling grant/revoke log, as an overlay on the fleet-grid (#19). Distinct from #19's grid itself (which is a real running dashboard) — these panels are B-roll-sourced with no real product behind them; pairs conceptually with #9's blast-radius artifact once that exists.

## 7. Infrastructure & Control Plane

- **[NET-NEW] #13 Expose kb's control plane as an OAuth MCP server** — turn kb control actions (dispatch a card, query `ledgers/`, launch/inspect a run) into an OAuth-authenticated remote MCP server any Claude/Fable/Codex client can add as a connector, with a cost-aware convention baked into the contract (`preview_*_cost` dry-run + `get_*_status` poll on every spend surface). kb uses MCP heavily as a client but publishes no control-plane server; the cost-preview/poll convention maps straight onto `never-spend-money` + the budget guard.
- **[NET-NEW] #22 Token-cheap web perception: browser-control daemon + accessibility-DOM snapshots** — one persistent local browser-control daemon over plain HTTP returning compact page snapshots instead of screenshots, reusing one background session instead of spawning a browser per run. kb uses chrome-devtools + playwright MCP per-invocation with no diff/daemon layer; would serve fyt upload flows, dashboard e2e, and scraping agents. Caveat: the ~800-token/13×/accessibility-DOM framing is caption-level, not confirmed in frames — validate before relying on the numbers.
- **[EXTENDS-EXISTING] #10 Semantic (meaning-based) memory retrieval + auto-capture** — index `memory/<id>.md` + `handoffs/` with embeddings so a fresh session recalls the least-general relevant lesson by meaning, not exact-string grep; optionally auto-capture/compress end-of-run state instead of manual append. Upgrades the existing `memory/` + `handoffs/` subsystem; keep human-curated lessons authoritative, treat the index as an accelerator only.
- **[PARTIALLY-EXISTS] #7 Context-efficiency pass** — glob-scoped `rules/` files (load only on matching file touches) instead of an always-loaded `CLAUDE.md`/`BOSS.md`; an abstract→overview→full progressive-disclosure discipline; a `/context`-style per-item token audit; a `block-dangerous-bash` hook + terse output-style. Directly targets kb's heavy always-on `CLAUDE.md`/`BOSS.md` load pattern; kb ships `claude-context-optimizer` (overlaps the audit piece) but has neither glob-scoped rules nor a lazy-disclosure protocol nor (likely) a dangerous-bash-block hook.
- **[NET-NEW] #8 Prompt-cache-ordered prompt construction convention** — a kb-wide rule: stable prefix first, per-call dynamic content last, in every agent/skill prompt, to maximize cache-hit prefix length. Cheap, low-effort, no explicit convention exists today; the proxy-free counterpart to the existing "proxies break prompt caching" lesson.

## 8. Content Pipeline (fyt-specific)

- **[EXTENDS-EXISTING] #25 fyt short-form / UGC promo track (+ provider-config + output gallery)** — an NL-prompted batch short-form/promo-clip track (one prompt → many UGC-style clips), a single provider-config file abstracting TTS/LLM/footage backends, and a standardized output-gallery grid (9:16 + 16:9, duration badge, play overlay) for run review. Extends fyt's existing image-gen/shots/forge/voiceover/upload pipeline with a new content *format*, not a new pipeline.

## 9. Interaction Surfaces

- **[NET-NEW] #23 Voice / dictation control surface for the boss** — a brain/body/console split (stateful compute unit holding turns+memory+tools, delegating coding to an isolated engine that reports back out loud) and/or hold-hotkey local dictation into the boss terminal. Net-new I/O surface over the existing boss + session console. Platform caveat: the strongest engine shown (Apple SpeechAnalyzer) is macOS-26-only; Daniel is on Windows 11 — reuse the pattern, not that engine; kb's video-vision local-whisper backend is the nearer building block.
- **[PARTIALLY-EXISTS] #28 In-page NL agent for the dashboard** — a drop-in script letting Daniel drive any dashboard panel (dispatch, queue, ledger actions) by typing plain English directly into the page, instead of a bolt-on chat sidebar. Overlaps the existing session console but targets in-context control of arbitrary panels; card-level evidence only, needs a real trial.
- **[PARTIALLY-EXISTS] `[catalog]` Chat-launcher landing screen** — greeting + centered prompt input + task-type pill row + model-selector dropdown + a "Connecting to…" loading state. Applies to the dashboard's console/composer entry surface; overlaps what the session console already does.

---

## Already-have — reinforce, don't build

Folded from the source's "already-have" note: manager/inspector plan-do-grade split (kb has it — inspector skill, adversarial panels, three-state stamp); Node-Zero shared knowledge base (kb's `_index.md` + `CLAUDE.md` + `orgs/*/STATE.md` + `memory/`); TRIGGER→GUARDRAIL→write-to-brain automation shape (kb's HEARTBEAT + card + ledger-write); department-partitioned repo convention (weaker than kb's `orgs/<project>/`); the four-loop/four-primitive/ten-concept/competency/five-category checklists — use as one-time self-audit references only.

**Rejected:** local prompt-compression proxy — kb memory already records proxies break prompt caching + subscription auth; adopt AST/JSON compression as a pre-pass only, never an intercepting proxy.

---

## Spine — build these first, they unlock the most of the rest

Dependency-ordered, not priority-ordered:

1. **#5 Canonical metric-definitions semantic layer** — every other metric-consuming item (trust gate, benchmark scorecard, headroom tile, cost tiles) needs one definition of "grade," "cost," "verified," "card status" to read from. Build first.
2. **#9 Governed tool-access & permission layer** — the safety substrate that has to exist before autonomy widens (#1) or a self-improvement loop runs unsupervised (#16). Independent of #5, can build in parallel.
3. **#3 Rubric-in-the-skill + bounded self-verify loop** — the verification primitive that #11 (task-observer) and #16 (self-improvement loop) both build on; also feeds cleaner signal into #1's trust score.
4. **#1 Autonomy-graduation trust gate** — depends on #5 (consistent grade data) and #9 (safe to widen); converts grade history into the machine-decidable number that #4 and #17 both reference.
5. **#4 Human-gate approval inbox/sidecar** — the release valve paired with #1: as trust gates grant more unsupervised running, this is where the remaining human judgment concentrates instead of scattering across prose cards.
6. **#20 Workflow-platform topology upgrade** — targeted retry + shared-state blackboard is the execution-graph substrate that the dashboard views (#2, fleet-grid #19, batch UI #24) all render on top of.
7. **#2 Git Timeline orchestration dashboard** — the single highest-leverage UI investment in the corpus; once #20's typed shared-state and #5's metric layer exist, this is the surface that makes all of it visible. Largest single build (size L) — sequence last among the spine so it renders a stable substrate rather than a moving one.

## Clearly YAGNI / defer

- **#23 Voice/dictation control surface** — the best-evidenced engine is macOS-only; Daniel runs Windows. Revisit only if a Windows-native dictation engine surfaces.
- **#30 Three-package harness split** — mostly refactor-flavored, overlaps existing model routing; no concrete pain point it solves today.
- **#28 In-page NL agent for the dashboard** — overlaps the session console that already exists; marginal gain, unproven (card-level evidence only).
- **Fleet observability security panels (folded into #19)** — B-roll-sourced, no real product; defer until #9's blast-radius artifact exists to actually feed it real data.
- **#25 fyt UGC promo track** — new content format, not core platform; fine to defer behind the platform-level spine items.
- **`[catalog]` SkillTree radial org-map** — a nice secondary browsing view, not load-bearing; low priority against the entity-first sidebar IA already locked.
- **Local prompt-compression proxy** — explicitly rejected in the source (breaks prompt caching + subscription auth); do not build.

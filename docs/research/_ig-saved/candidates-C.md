# candidates-C.md — wave-2 (dashboard / UI-UX batch)

Synthesis worker C. Source: 17 wave-2 notes emphasizing dashboards, product UIs, layouts, and system architectures shown on screen. Each candidate traces to a specific reel-id + timestamp. Thin/grift videos are included where they show a usable UI/UX or mechanism; the UI-reference-only cases are flagged. A later merge agent dedupes across A/B/C and ranks.

---

### Add a numeric autonomy-graduation gate for agents
- capability: an agent earns the right to run unsupervised only after a measured track record, and automatically loses it if quality regresses
- mechanism: video narrates the policy — a job must pass its graded check 20 times at a >=95% success record before the system lets it run solo; if the running grade ever drops below 90% the privilege is revoked and the owner is emailed. Pure policy logic (no UI shown, animated allegory only).
- source: Da6kEv3JMY3 @ 00:39 (+ SkillTree 3-tier ladder DbYh2P-MQnj @ 00:34 as a related autonomy-tier framing)
- category: harness
- general-merit: A concrete, machine-decidable trust threshold turns "is this agent trustworthy yet?" into a number. Good antidote to premature autonomy.
- kb-fit-hypothesis: kb has grading/ledgers and honest three-state review but NO automated autonomy-graduation gate that promotes/demotes an agent based on a rolling pass record. Would extend ledgers/grades + governance/risk-tiers with a trust-score that gates which cards an agent may self-run. Genuinely new mechanism on top of existing grading data.
- build-size: M

### Keep the plan/do/grade split enforced across every job (reinforce)
- capability: the agent that plans a change never grades its own work; a fresh no-memory copy inspects the result
- mechanism: narrated manager/inspector split — Claude writes down what must change and hands off; a fresh Claude reviews "like it has never seen it"; every criterion is backed by a real test or tool result, not self-report.
- source: Da6kEv3JMY3 @ 00:27 (+ DW8h1NxjLdt cert competency "coordinator-subagent patterns" @ 00:19)
- category: change-to-existing
- general-merit: The single most portable governance idea in the batch, independent of packaging.
- kb-fit-hypothesis: ALREADY HAVE — manager/inspector split, inspector skill, adversarial panels, three-state stamp. Value here is only reinforcement / a checklist to audit that no loop lets an author grade itself. Not new.
- build-size: S

### Cheap-model daily sweep as a cost gate before engaging the expensive model
- capability: a cheap fast model decides each cycle whether anything needs attention before any premium model is spawned
- mechanism: narrated — every morning a cheap model sweeps the project and asks one question ("does anything need attention?"); the expensive model only engages if the answer is yes. Deliberately cheap because it runs daily.
- source: Da6kEv3JMY3 @ 00:00
- category: workflow
- general-merit: Simple, high-leverage cost-control cadence for any always-on loop.
- kb-fit-hypothesis: kb has HEARTBEAT cadences + a single dispatcher Routine + budget guard, but the "cheap-model triage gate decides whether to wake the expensive tier at all" pattern could be an explicit cost-saving layer in the dispatcher. Partial overlap; the triage-tier framing is a worthwhile refinement.
- build-size: S

### Staged-maturity card template for capability-rollout docs
- capability: a reusable document/IA pattern for describing any staged capability rollout, one card per level
- mechanism: Figma "THE CLIMB" board — five numbered stage cards (01 Context, 02 Execution, 03 Delegation, 04 Autonomy, 05 Compound) on a rising line-chart background. Each card has consistent anatomy: tag pill -> headline -> subhead -> "THE MOVES" numbered checklist -> "PROOF YOU'RE HERE" graduation checklist -> a bespoke flow/org diagram -> a footer tip strip.
- source: DbyA5hlSvI7 @ 00:00–02:24 (whole board)
- category: ui-ux
- general-merit: A clean, presentable structure for documenting maturity/graduation frameworks; the "goal / graduation criterion / numbered moves / proof checklist / diagram" anatomy is directly exportable.
- kb-fit-hypothesis: UI/doc-reference value. kb has no standard "staged rollout" document template; could format autonomy-tier or platform-rollout docs this way. Reference, not a mechanism.
- build-size: S

### Department-partitioned repo/workspace convention
- capability: a repo-layout convention that partitions a multi-agent operator setup by business function
- mechanism: Figma folder-tree diagram — `/mezcorp` workspace with `departments/` (cfo/cmo/cro/cdo/cos), `skills/` (the moves it can run), `data/` + `repos/`, `.env` + `CLAUDE.md` (keys + house rules), and per-department record files (e.g. `organic_jobs.json`) written back to a Notion node.
- source: DbyA5hlSvI7 @ 00:37 (Card 02 "under the hood")
- category: infrastructure
- general-merit: Concrete, copyable directory convention for a departmentalized agent org.
- kb-fit-hypothesis: kb already has `orgs/<project>/` + per-agent `memory/` + `skills/` + governance. This is a weaker, less-governed version of what kb already does; only marginal — maybe the per-department record-file-to-shared-brain write pattern is worth noting. Mostly already have.
- build-size: S

### Always-on TRIGGER -> GUARDRAIL -> write-to-brain automation shape
- capability: a canonical diagram/shape for an unattended automation that fires on schedule or event and gates its own output
- mechanism: Figma Card 04 "RUNS WHILE YOU SLEEP" — TRIGGER (6AM daily / new-lead instant) -> FIRES -> RUNS ON ITS OWN (Claude Code + cron, "Mac Mini + cloud 24/7") -> GUARDRAIL (pass -> write / fail -> alert) -> writes a status row to the shared Notion "brain."
- source: DbyA5hlSvI7 @ 01:27
- category: workflow
- general-merit: A minimal, legible mental model for any self-running job with a pass/fail gate and an audit write.
- kb-fit-hypothesis: ALREADY HAVE — directly analogous to kb's HEARTBEAT cadence + card + ledger-write pattern. Reinforcement/visual-reference only.
- build-size: S

### Five-category harness taxonomy (agents/templates/skills/commands/hooks)
- capability: a reference architecture for organizing a Claude Code multi-agent harness into five color-coded categories
- mechanism: KARIMO "The Harness" file browser — a card grid under five dot-colored categories (Agents/orange, Skills/green, Commands/blue, Templates/purple, Hooks-Config/gray). ~22 named specialist agents (pm, brief-writer, tester, wave-planner, gate-keeper, merge-captain, investigator, worktree-manager, dependency-mapper, config-doctor, learning-applier, router, reviewer, brief-reviewer, pm-reviewer, research-curator, feedback-collector, dashboard-reporter, interviewer, implementer, review-architect, greptile-remediator), ~18 templates (prd.md, tasks.yaml, task-brief.md, gate-policy.yaml, execution-plan.yaml, review-policy.yaml, dashboard-card.md, ...), ~14 skills, ~11 commands, ~9 hooks (pre/post-task, pre/post-wave, pre/post-merge, on-gate, on-feedback).
- source: DXwl0ryhbgV @ 00:09–00:14
- category: harness
- general-merit: A concrete, internally-consistent reference for what a mature agent-orchestration harness contains — many roles kb has not named explicitly (merge-captain, wave-planner, dependency-mapper, config-doctor, learning-applier, gate-keeper).
- kb-fit-hypothesis: kb has queue/cards + agent-registry + skills + governance, but not this explicit five-bucket taxonomy nor several of these named roles as first-class agents. Worth mining for missing roles (esp. merge-captain, dependency-mapper, config-doctor, learning-applier) and the hooks-per-lifecycle-stage convention. Partial overlap; useful gap-analysis source.
- build-size: M

### Git Timeline dashboard for multi-wave agent execution
- capability: a visual dashboard that shows a multi-wave agent pipeline's progress across planning, execution, and review/merge
- mechanism: KARIMO "Git Timeline" panel — three phase tabs (Planning / Execution / Review & Merge). Planning renders a 4-stage pipeline (Research -> Create PRD -> Task Briefs -> Dependency Graph) with a color-coded Gantt-style dependency bar chart (waves stacked, green "complete" / orange "waiting"). Execution shows a Feature-Branch lane with per-wave colored progress bars (Wave 1–4), a live worktree list with auto-cleanup-after-merge, and an annotated notes panel documenting gate/merge cadence and model routing (Sonnet=simple, Opus=complex).
- source: DXwl0ryhbgV @ 00:04, 00:23–00:25
- category: ui-ux
- general-merit: THE strongest orchestration-visibility dashboard reference in the batch — a wave-by-wave Gantt with dependency edges, live worktree tracking, and inline model-routing annotations. Exactly the "see what all the agents are doing" surface a fleet needs.
- kb-fit-hypothesis: kb has the Next.js dashboard + workflow-platform (DAG nodes, governedBy chains, model resolution) but the wave-Gantt-with-dependency-graph + live-worktree-lane visualization is a concrete design kb's dashboard does not currently render. Directly relevant extension to the existing workflow-platform UI. Best dashboard candidate to actually build against.
- build-size: L

### Progressive-disclosure context loading (abstracts -> overviews -> full defs)
- capability: agents load only compressed abstracts first and pull full definitions only when actually executing, cutting token waste
- mechanism: KARIMO "Thoughtful Architecture" slide — "built on the OpenViking protocol": agents load abstracts first, overviews second, full definitions only when executing; each pipeline stage "distills context into artifacts optimized for the next session," turning one 1M-token window into a reusable building block across sessions. ("context multiplication / compound learning" framing.)
- source: DXwl0ryhbgV @ 00:26–00:27
- category: infrastructure
- general-merit: A named, concrete context-engineering discipline (three-tier lazy loading + per-stage compression) that materially reduces cost.
- kb-fit-hypothesis: kb has skills (provenance-tiered) and per-agent memory but no formalized abstract->overview->full lazy-load protocol for loading agent/skill definitions. Worth investigating "OpenViking protocol" as prior art; the lazy-disclosure pattern could apply to how kb loads CLAUDE.md/memory/skill bodies. New discipline layered on existing files.
- build-size: M

### HUMAN-LED vs CLAUDE-LED input/output card pairs per pipeline stage
- capability: a minimal doc pattern that states, per pipeline stage, who drives and what the exact input/output artifacts are
- mechanism: KARIMO "Agent Orchestration" board — each loop stage (Foundation / Decomposition / Orchestration) shows a "HUMAN-LED" or "CLAUDE-LED" tag plus explicit Input and Output cards (e.g. Foundation: Input="codebase + your PRD-interview answers", Output="approved PRD with task breakdown, wave plan, dependencies") beside a terminal panel showing the live command.
- source: DXwl0ryhbgV @ 00:06–00:08
- category: ui-ux
- general-merit: Forces explicit statement of who-does-what and the concrete artifact hand-off at each stage; good for documenting human gates.
- kb-fit-hypothesis: Complements kb's human-gate doctrine ("human gates one at a time") and workflow-platform governedBy chains. A documentation/UI pattern for the workflow-platform's node cards. Reference, low novelty.
- build-size: S

### PRD-driven planning via a bounded multi-round interview
- capability: turn a vague goal into an approved PRD + task breakdown through a fixed-round structured interview before any execution
- mechanism: KARIMO Foundation loop — Claude auto-detects project config, scans the codebase for patterns, then interviews the user across 5 rounds to produce a structured PRD with a task breakdown, wave plan, and dependency graph; the human decides when the plan is ready to execute. A brief-reviewer agent then challenges each derived task brief for risks/conflicts before execution.
- source: DXwl0ryhbgV @ 00:06, 00:16–00:23
- category: workflow
- general-merit: A disciplined intake that front-loads ambiguity resolution into a bounded interview rather than discovering gaps mid-build.
- kb-fit-hypothesis: kb's boss protocol restates goals + asks one clarifying question, and the workflow-platform has plan stages, but a formal bounded-round PRD-interview -> wave-plan -> brief-reviewer chain is more structured than what kb runs today. Worth considering as a plan-stage upgrade. Partial overlap.
- build-size: M

### Batch web-enrichment builder: template picker -> JSON schema -> live run table
- capability: a UI to define a repeatable structured-data enrichment task and run it across many inputs with live progress
- mechanism: Parallel MCP enrichment builder — "Start with a template" 2x2 card grid (Company enrichment / Contact information / Website analysis / Academic research) or start-from-scratch free-text objective; configure a JSON output schema; execute across many inputs; a live run table shows "3 Completed / 7 Running / 10 Total" with per-row output columns (point_of_contact / phone / email) and "Loading..." states.
- source: DZtgyYdP0pZ @ 00:15–00:20, 00:47–00:49
- category: ui-ux
- general-merit: A clean, generalizable pattern for any "enrich/process N rows with a structured schema" job — template -> schema -> batch -> live status table.
- kb-fit-hypothesis: kb runs many batch jobs (e.g. this very video-analysis wave, fyt shot batches) but has no template->schema->live-run-table UI. Directly reusable batch-job UI for the dashboard. UI reference with a real mechanism behind it.
- build-size: M

### Prompt template: research persona + source-priority list -> machine-readable SOP
- capability: a reusable prompt shape that converts open research into an agent-executable ruleset
- mechanism: Perplexity Pro prompt — persona instruction ("act as a B2B sales expert") + an explicit source-prioritization list (named communities, blogs, individual practitioners, benchmark studies) + an instruction to "output a machine-readable SOP an AI agent can execute against." Produced a ~6,000-word report ending in a 12-part SOP saved as a `.md` file that the next agent consumes as input.
- source: DZtgyYdP0pZ @ 00:24–00:32
- category: workflow
- general-merit: Turns research output into a structured artifact the next agent can act on, rather than prose a human must re-digest. Generalizes well beyond cold email.
- kb-fit-hypothesis: kb chains research -> build via cards/handoffs but doesn't standardize "research agent must emit a machine-executable SOP artifact." A useful convention for research-agent outputs feeding builder agents. Low-cost addition.
- build-size: S

### Fleet-grid monitoring view (one tile per worker, icon-badges + status dots)
- capability: a dashboard that shows a large fleet of parallel workers at a glance, each tile badged with what it's running and its health
- mechanism: "Fleet Control Center" (profitphones.com) Live-devices panel — a grid of phone-shaped tiles ("1,000 devices shown · 1,000 online"), each tile badged with the apps active on it and two status/connectivity icons at the bottom; scales to hundreds/1,000+ tiles on a wall display. Left sidebar nav (Control Center / Analytics / Automation / Schedule / Store / ... / Settings).
- source: DcBcYSwN5U7 @ 00:00–00:06
- category: ui-ux
- general-merit: The "one tile per unit, icon-badges for what's running, dot for health, scales to 1,000s" metaphor is directly transferable to monitoring many parallel agent workers.
- kb-fit-hypothesis: kb runs many parallel subagents/codex workers ("sometimes a hundred subagents") but the dashboard has no dense fleet-grid worker-monitoring view. Strong reference for a kb "live workers" surface. (Underlying product is a bot/account-farm — take only the dashboard pattern, not the use case.)
- build-size: M

### Dual-metric line chart with simple date-range filter
- capability: a minimal two-series performance chart (e.g. throughput vs cost) over a selectable window
- mechanism: Fleet Control Center Insights panel — two big stat cards (Views 1.35B / Revenue $3.1M) above a dual-line area chart (blue vs green) over a date axis with a "Last 7 days" filter.
- source: DcBcYSwN5U7 @ 00:03–00:04
- category: ui-ux
- general-merit: Clean, minimal two-axis KPI pattern.
- kb-fit-hypothesis: kb's dashboard/ledgers could render cost-vs-throughput this way. Generic charting; low novelty. Reference only.
- build-size: S

### Chat-launcher landing screen (greeting + centered prompt + task pills + model selector)
- capability: a first-class "start here" landing surface for a chat/agent product
- mechanism: Fastlane chat UI (a Claude.ai-style clone) — "Good afternoon, {name}" greeting, centered prompt input with +attach and history icons, task-type pill row (Write / Learn / Code / Life stuff), a model-selector dropdown ("Fable"), an orange submit arrow, and a "Connecting to..." tool-call loading state under the submitted bubble.
- source: DaTZxm-J5mZ @ 00:06–00:13
- category: ui-ux
- general-merit: A well-understood, buildable launcher pattern (greeting + centered prompt + intent pills + model picker) for any agent entry screen.
- kb-fit-hypothesis: kb's dashboard has a session console/terminal + composer; a greeting+pills+model-picker launcher could improve the entry surface. UI reference; the product behind it is astroturfing (ignore the use case).
- build-size: S

### Radial hub-and-spoke "one source -> many nodes" visualization
- capability: a compact diagram component for representing a central entity fanning out to many distribution/child nodes
- mechanism: appears twice — Fastlane's radial account-network diagram (central logo -> ~15–20 platform-icon nodes on thin radial lines) and the Flux "YOUR BUSINESS" central-hub-with-4-category-cards (FIND / WIN / MAKE / RUN) IA.
- source: DaTZxm-J5mZ @ 00:00 and @ 00:45
- category: ui-ux
- general-merit: A lightweight D3/SVG-buildable motif for "one brain -> N children," and (via FIND/WIN/MAKE/RUN) a way to organize a tool catalog around business functions.
- kb-fit-hypothesis: Overlaps strongly with SkillTree's radial org-map (below) — merge candidate. Reference for a kb agent/skill-catalog visualization. UI-only.
- build-size: M

### Local-agent governance primitives: folder-trust boundary, fail-closed tools, durable JSONL sessions
- capability: a set of safety primitives for a local autonomous code agent
- mechanism: oh-my-cli README bullets — "safety is the product": spoof-resistant auth, a folder-trust boundary, workspace scoping, deterministic tool-calling that "fails closed by default," and durable JSONL session logs with compact/export. Runs a Task -> Plan -> Implement -> Verify -> Evidence loop locally.
- source: DboaQE_tYbn @ 00:00–00:04, 00:17
- category: harness
- general-merit: A tight, buildable checklist of local-agent safety guarantees (trust boundary + fail-closed + auditable sessions).
- kb-fit-hypothesis: kb already has risk-tiers, never-handle-credentials, worktree leasing, ledgers/audit, and (via codex/oh-my-pi-style workers) folder-trust + fail-closed norms. Mostly ALREADY HAVE; value is a checklist to confirm each primitive is enforced for local/codex workers. Low novelty.
- build-size: S

### Ranked leaderboard bar chart with provider icons + highlighted row
- capability: a chart pattern for comparing many models/agents by a single score with one row emphasized
- mechanism: Arena-style horizontal bar chart — 20 ranked models, green bars, numeric scores, small provider icons per row, one row outlined to call it out.
- source: DboaQE_tYbn @ 00:23–00:28
- category: ui-ux
- general-merit: Standard, clean comparison-chart pattern.
- kb-fit-hypothesis: kb could use this to compare agent/model performance from grades/ledgers. Generic dataviz; low novelty. Reference only. (Note: the reel's spoken "Qwen beats Fable 5" claim is contradicted by its own chart — a caution about narrated claims vs on-screen evidence.)
- build-size: S

### Config panel with per-key colored status pills
- capability: a settings surface that shows each integration/API key with a live health/status indicator
- mechanism: MoneyPrinterTurbo config panel — an "API" section listing ~10 labeled config rows, each with a colored status pill (green/red/blue) beside the field.
- source: DcG5MjqOVYp @ 00:11
- category: ui-ux
- general-merit: Makes "which integrations are configured/healthy" legible at a glance.
- kb-fit-hypothesis: kb has many integrations (MCP servers, OAuth, keys) but no single config-health panel with per-key status. Useful dashboard addition. Reference with real precedent.
- build-size: S

### Example-output gallery grid (9:16 + 16:9 cards, duration badge, play overlay)
- capability: a portfolio/showcase grid for generated media outputs
- mechanism: MoneyPrinterTurbo "Work Showcase" — two rows of thumbnail cards (vertical 9:16 + horizontal 16:9), each a real rendered preview with a duration badge and a red play-button overlay.
- source: DcG5MjqOVYp @ 00:13–00:14
- category: ui-ux
- general-merit: Clean content-showcase pattern.
- kb-fit-hypothesis: Directly relevant to faceless-youtube (fyt) — a gallery of generated shots/videos with duration + play. fyt has asset boards; a standardized output-gallery grid could improve run review. Reference for fyt.
- build-size: S

### WebUI + separate API/Swagger local-deploy split
- capability: a local self-hosted tool architecture that ships a WebUI and a separate documented API server
- mechanism: MoneyPrinterTurbo — docker-compose deploy, Streamlit-style WebUI on :8501, separate FastAPI server with Swagger docs on :8080/docs; a topic -> script (LLM) -> narration (TTS) -> subtitles (Whisper/Edge) -> footage -> ffmpeg-assemble pipeline, all provider-configurable via `config.toml`.
- source: DcG5MjqOVYp @ 00:17–00:18, 00:27
- category: infrastructure
- general-merit: A clean, buildable local-first deploy shape (WebUI/API split + docker-compose + config file) and a fully-worked reference pipeline for automated short-form video.
- kb-fit-hypothesis: kb's dashboard is Next.js + daemon (already a UI/API split), and fyt is kb's own video pipeline. Value is (a) provider-abstraction via a single config file (fyt could adopt a multi-TTS/LLM provider config), and (b) MoneyPrinterTurbo as a concrete reference/benchmark for fyt's own stages. Partial overlap; fyt-relevant.
- build-size: M

### Ten-concept agentic-system design checklist (with diagram templates)
- capability: a taxonomy/checklist of the design concerns any serious agent system must address, each with a presentable diagram
- mechanism: silent carousel of 10 concepts, each with a third-party reference diagram — 1 Harness engineering, 2 Loop engineering (Act/Observe/Decide/Check cycle), 3 Context engineering (inputs -> LLM -> targeted output), 4 Tool design, 5 Memory architecture (short-term/episodic/semantic/procedural), 6 Orchestration (triage router -> specialists -> human handoff), 7 Guardrails/permissions, 8 Evals (single-turn vs agent trajectory), 9 Human-in/on/out-of-the-loop, 10 Observability & tracing.
- source: DbG_xa3y_d6 @ 00:03–00:11
- category: workflow
- general-merit: A comprehensive self-audit checklist + a set of clean diagram templates for documenting an agent fleet's architecture.
- kb-fit-hypothesis: kb touches all ten but has no single doc that audits itself against them; the memory-architecture (short/episodic/semantic/procedural) and observability/tracing framings in particular could sharpen kb's memory files and dashboard tracing. Reference/self-audit value. Also: item 7 names "Liman" (see next).
- build-size: S

### Deterministic policy engine mediating all agent -> tool/API access
- capability: route every agent action through one deterministic policy layer that scopes what each task may reach
- mechanism: "Liman — Deterministic Policy Engine" diagram — Agent -> (MCP/API/Webhooks) -> Liman policy engine -> scoped fan-out to MCP servers (GitHub, Postgres), APIs (Stripe, Google Calendar), and bidirectional channels (WhatsApp, Slack, Email). Enforces per-task scoping, read/write/execute distinctions, I/O filtering, and blast-radius limits.
- source: DbG_xa3y_d6 @ 00:07
- category: infrastructure
- general-merit: A named real project embodying the "single deterministic chokepoint for all tool access" pattern — strong architectural match for governance goals.
- kb-fit-hypothesis: kb enforces governance via risk-tiers + card gates + never-handle-credentials, but not via a single deterministic policy engine that all tool calls transit. Worth evaluating Liman as prior art for a kb permissions chokepoint. New architectural option overlapping kb's governance intent.
- build-size: L

### Skill-marketplace flow: NL intent -> trust filter -> multi-agent install
- capability: discover and install agent skills by describing intent in plain language, vetted for trust, installed across every detected agent at once
- mechanism: find-skills mockup — `claude find-skills` -> registry crawl (animated "skills indexed" counter) -> natural-language "what are you working on?" -> trust filter that visibly discards low-trust candidates (sketchy/unverified/clone-of-agent chips fade out) and surfaces verified matches -> one-command install writing into `~/.claude/skills`, Cursor, Codex, Gemini CLI, Windsurf simultaneously, with a per-target install status log.
- source: DbWBUFWNBrh @ 00:08–00:31
- category: ui-ux
- general-merit: The search -> trust-filter -> multi-agent-install IA (with the vetting made visible rather than hidden) is a clean, buildable marketplace pattern.
- kb-fit-hypothesis: kb has a provenance-tiered skills system (curated/learned/imported/evolved) and a known "sync agents/ catalog across main<->ops" pain. The trust-filter-made-visible + cross-agent-install-status pattern maps directly onto kb's skill provenance + catalog-sync needs. Motion-graphics mockup (not a real tool) — UI reference, but a strong one for a real kb need.
- build-size: M

### Trust-filter visualization (surface the vetting, don't hide it)
- capability: a UX that shows candidates being screened out by quality signal, so the vetting is legible
- mechanism: find-skills "TRUST FILTER" — candidate chips labeled with quality signals (sketchy / unverified / beta-untested / clone-of-agent / placeholder) fade out while trusted picks get checkmarks, over a SCANNED/TRUSTED progress bar.
- source: DbWBUFWNBrh @ 00:19–00:23
- category: ui-ux
- general-merit: Making a vetting pipeline visible (what was rejected and why) builds trust better than silently showing only survivors.
- kb-fit-hypothesis: Applies to kb's grading/inspection surfaces and skill-provenance display — show what failed the gate, not just what passed. Reference; pairs with the three-state honest stamp kb already has.
- build-size: S

### Radial department-constellation org-map for a large agent/skill catalog
- capability: browse a large agent/skill catalog as a zoomable radial constellation instead of a flat list
- mechanism: SkillTree (skilltree.altari.ai) — a real running web app. A dark radial map with 7 color-coded department clusters around a central particle "company brain"; top nav MAP / DASHBOARDS / CHART; each department a colored ring with a tree of dot-nodes + one-line subtitle. Click a department to zoom to labeled agent-job nodes with a "START HERE" entry marker and red status dots.
- source: DbYh2P-MQnj @ 00:00–00:30, 00:45
- category: ui-ux
- general-merit: A distinctive, coherent alternative to a sidebar for navigating a big catalog; department color-coding + a "start here" onboarding node + status dots handle scale without overwhelming. Shown running in a real browser (not a mockup).
- kb-fit-hypothesis: kb's dashboard uses an entity-first sidebar IA (locked). A radial map is an alternative *view* (not a replacement) for browsing the agent/skill/org catalog — could be a "DASHBOARDS/CHART"-style secondary view. Strong UI reference; would need to respect kb's existing sidebar IA. 
- build-size: M

### Skill/agent detail-card spec template (dependency graph + autonomy tier + replacement value)
- capability: a documentation template that forces every skill/agent to declare its dependencies, autonomy tier, and what it replaces
- mechanism: SkillTree skill detail card — structured sections: one-line description; BREAKS INTO (child skills); BUILDS ON (prerequisite skills); WHAT IT REPLACES (the human role/cost); THE LADDER (Human-led / Human-assisted / Fully autonomous, one sentence each); THE HUMAN (approval role); BUILD NOTES; YOUR STATUS (3-state Not started / In development / Live). A second variant adds SKILL.MD / COPY INSTALL COMMAND / DOWNLOAD tabs, a REQUIRED API KEYS table (key name / where-to-get-it URL / `.env` var), a `knowledge/` config convention, a HOW TO RUN section with example NL prompts, and the literal AGENT INSTRUCTIONS system-prompt block.
- source: DbYh2P-MQnj @ 00:33–00:44
- category: ui-ux
- general-merit: A rigorous spec format — forces explicit dependency edges, autonomy tier, replacement value, and status for every catalog entry. Directly reusable to document any agent/skill.
- kb-fit-hypothesis: kb has agent/skill definitions + card-schema but no standardized detail-card that captures BREAKS INTO / BUILDS ON (a dependency graph), the autonomy ladder, and a status tracker in one place. Would enrich the agent-registry / skills docs and the dashboard's entity pages. Strong, concrete template to adopt.
- build-size: M

### "Node Zero" shared knowledge base every agent reads before acting
- capability: a foundational shared-context layer that every agent reads/writes, positioned as the prerequisite for all other skills
- mechanism: SkillTree "NODE ZERO — Company Knowledge Base (BEFORE EVERYTHING)" — a shared layer holding `company.md`, `offer.md`, `voice.md`, `clients/`, `meetings/`, `playbooks/`, `STATE.md`; documented with the same detail-card template (LADDER / THE HUMAN / STATUS). Every skill reads from it.
- source: DbYh2P-MQnj @ 00:13–00:14 (+ Figma "the Brain" DbyA5hlSvI7 @ 00:00)
- category: infrastructure
- general-merit: A single canonical context root that all agents consult prevents drift and per-agent re-explanation.
- kb-fit-hypothesis: ALREADY HAVE — this is exactly kb's `_index.md` + `CLAUDE.md` + `orgs/<project>/STATE.md` + per-agent `memory/`. Reinforcement; maybe a nudge to make the "read the brain before acting" step more explicit/enforced. Not new.
- build-size: S

### Required-API-keys table with where-to-get-it links + env var names
- capability: a minimal per-skill credential-documentation pattern
- mechanism: SkillTree REQUIRED API KEYS table — columns: key name, "where to get it" URL, `.env` variable name (e.g. HeyReach -> `HEYREACH_API_KEY`). Paired with the Claude-Desktop custom-connector wiring flow (Settings -> Connectors -> Add custom connector -> paste hosted MCP URL) from the outbound-sales reel.
- source: DbYh2P-MQnj @ 00:33 (+ DZtgyYdP0pZ @ 00:40–00:46 for the connector-wiring flow)
- category: ui-ux
- general-merit: Removes credential-setup friction and ambiguity by naming exactly which key, where to get it, and which env var.
- kb-fit-hypothesis: kb never handles credentials as objects (hard rule) but does document integration setup; a standardized key-name / source-link / env-var table would help onboard MCP integrations without ever touching secrets. Low-risk doc convention. Reference.
- build-size: S

### Unified provider-grouped model picker spanning local + cloud, with a shared effort control
- capability: one model selector that lists self-hosted and frontier models together, grouped by provider, with a shared thinking/effort control
- mechanism: Hermes Agent model router — a "Search models" dropdown grouped by provider/org (ALLSPARK / ARAGORN / NOUS PORTAL) mixing local quantized models (SuperDeepseek V4 Flash, Qwen3.8-27B) with frontier models (Fable 5, Opus 5/4.8, Sonnet 5, Haiku 4.5, GPT-5.6 variants, Gemini 3.1 pro), plus a "MoA: default" mixture-of-agents preset. A right-side OPTIONS panel offers a "Thinking" toggle and a 7-level EFFORT selector (Minimal / Low / Medium / High / Extra High / Max / Ultra).
- source: DcCmxlDR0KP @ 00:50–00:53
- category: ui-ux
- general-merit: Putting local and cloud models in one provider-grouped picker with a shared effort/thinking control (and a MoA preset) is a clean unified-router UX — no separate tools for local vs cloud.
- kb-fit-hypothesis: kb has model routing (haiku/sonnet/opus per stakes) resolved via workflow-platform defaults, but no unified picker UI spanning local + cloud with an effort control. If kb ever adds local inference (Hetzner + local models), this is the reference router UI. Also a MoA/mixture-of-agents preset is a routing option kb doesn't expose. Forward-looking UI reference.
- build-size: M

### Self-healing error card with an executable "HOW TO FIX" checklist
- capability: an incident/error card that shows the diagnosed failure and a fix checklist that visibly executes and feeds back to green
- mechanism: Claude Routines n8n-error mockup — a node graph (Schedule -> HTTP Request -> Code -> Send); the failing node turns red with an error badge ("401 Unauthorized · credential expired"); a "Workflow error" card appears with a numbered HOW TO FIX checklist (re-authenticate / enable retry 3x / redeploy) that checks off green as the fix runs, after which the node returns to green.
- source: DcGmHU6NSjB @ 00:36–00:44
- category: ui-ux
- general-merit: Pairs failure diagnosis with a visible, executable remediation path — far more actionable than a status-only error row.
- kb-fit-hypothesis: kb's queue/ledgers/dashboards show status but not a self-healing remediation-checklist visualization for failed cards/cadences. Strong pattern for kb's error/incident surface and the "fix, don't defer" memory value. Animated mockup — UI reference, but directly buildable.
- build-size: M

### Inbox-with-approval-sidecar (auto-handle inline, escalate flagged items to a side panel)
- capability: a triage surface where most items are auto-handled inline and only flagged items open a review/approve panel
- mechanism: Claude Routines email-handler mockup — an inbox list where each row gains a category badge (Billing/Support/Client/Update/Sales/Personal) and a green "✓ Replied" tag as the auto-handler resolves it; one flagged item (orange "⚠ Approve") instead opens a right-side "Needs your approval" panel showing the drafted reply with "Approve & Send" / "Edit" buttons.
- source: DcGmHU6NSjB @ 00:45–00:55
- category: ui-ux
- general-merit: A concrete visual template for "human gates one at a time" — auto-clear the routine, surface only what needs a human, with the draft ready to approve or edit.
- kb-fit-hypothesis: Directly relevant prior art for kb's human-gate / approval UI (a value kb already holds: "human gates one at a time," "decision questions: context first"). kb's dashboard could adopt this inline-auto + sidecar-approve pattern for card gates. Strong, on-doctrine UI reference.
- build-size: M

### Batch-scan progress counter ("X/N analysed" with per-item scan-line)
- capability: a progress display for a batch job over many items, showing per-item completion as it sweeps
- mechanism: Claude Routines competitor-scan mockup — a header counter ("X/30 analysed") over a grid of item cards, a horizontal scan-line sweeping rows, each card populating (follower count + checkmark) as it's processed; plus a "hours saved / week" heatmap-grid counter as an ROI hook.
- source: DcGmHU6NSjB @ 00:00–00:05, 00:25–00:35
- category: ui-ux
- general-merit: A clear at-a-glance batch-progress pattern (and an ROI-summary hook) for any many-item job.
- kb-fit-hypothesis: kb runs many batch jobs (this video-analysis wave, fyt shot batches) with only textual progress; an "X/N processed" grid-scan UI would improve batch-job visibility on the dashboard. Reference; overlaps the Parallel live-run-table candidate (merge candidate).
- build-size: S

### Anthropic "agentic architecture" competency checklist (self-audit reference)
- capability: a checklist of the core competency areas Anthropic considers "agentic architecture," useful to self-audit kb against
- mechanism: real Claude Certified Architect exam pages — competency weightings: Agentic Architecture & Orchestration 27% (agentic loops, coordinator-subagent patterns, task decomposition, session state, workflow enforcement), Tool Design & MCP Integration 18% (clear tool boundaries, structured error responses, MCP servers, tool distribution across agents), Claude Code Configuration & Workflows 20% (CLAUDE.md hierarchies, custom slash commands, path-specific rules, plan mode, CI/CD), plus Prompt Engineering & Structured Output and Context Management & Reliability. Three exam scenarios shown (support-resolution agent w/ MCP tools; Claude-Code-in-CI/CD; multi-agent research w/ coordinator).
- source: DW8h1NxjLdt @ 00:19–00:22, 00:47–00:48
- category: workflow
- general-merit: A vendor-authoritative taxonomy of agent-architecture competencies — a solid checklist to audit kb's own orchestration/tooling/config maturity against.
- kb-fit-hypothesis: Not a build; a self-audit reference. kb already implements most of these; useful to confirm gaps (e.g. structured JSON-schema output enforcement, confidence-calibration/escalation patterns). Weak build-fit, real reference value.
- build-size: S

### (Pointer) turbovec — local vector index for kb's local-first needs
- capability: an open-source Rust vector index with heavy compression for local semantic search
- mechanism: README only (no UI) — `RyanCodrai/turbovec`, Google TurboQuant algorithm, claims 31GB->4GB for 10M vectors, online ingest (no rebuild), filter-at-search-time, faster-than-FAISS SIMD kernels, Python `TurboQuantIndex(dim, bit_width)`.
- source: DZP_O5GOzN0 @ 00:07 (README static)
- category: infrastructure
- general-merit: A real, linkable local-first vector-search library worth evaluating if kb ever needs embeddings/RAG over its own corpus.
- kb-fit-hypothesis: kb is local-first (Hetzner + subscription billing) and could want local vector search over memory/handoffs/notes. No UI value; pure tech pointer to evaluate at the repo, not from the video. Weak/no-UI, content-only.
- build-size: M

---

## Notes with no buildable candidate (logged for completeness)
- **DbG7l5Xpjiu** (AI agency course) — pure YouTube social-proof; no dashboard, UI, or mechanism. Skip.
- **Dboq7tdttPy** (kill redundant tasks) — talking-head opinion listicle; only stock/meme imagery, no product UI. Directionally reinforces kb's "simple files > flashy agents" stance; nothing to build.

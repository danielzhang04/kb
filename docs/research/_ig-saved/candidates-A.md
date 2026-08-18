# Candidates A — buildable ideas from 10 video-analysis notes

Source pool: notes Db3ltsWJ8wN, DcD9cjRtNdm, DbQrgz6haNi, DbPdttTxfjg, DW9JYHYhdnU, DcEQbIdK-p0, Db0Kka1vxSH, Dbn6ElTvw_W, DbvWERsuDuA, Dbs0166h9ZB.
Every candidate traces to a specific frame/transcript with a timestamp. Generous capture for a later merge/dedupe/rank pass — not final judgment.

---

### Benchmark kb's own harness against alternatives on a fixed task suite
- capability: Empirical, repeatable scoreboard telling us whether the boss+subagent/codex harness is actually the cost/quality/speed-optimal orchestration layer, or whether an alternative harness wins.
- mechanism: Composio's method: hold the model constant, run the SAME 30 agentic tasks through each harness, and measure three metrics per harness — pass rate, cost/task, median wall-clock/task — then chart them side by side. kb would define a frozen task set + machine-decidable pass criteria and route it through boss-subagents, codex-via-cards, and 1-2 external harnesses (Pi Agent, Claude Code, Codex, Deep Agents all named as comparables).
- source: Db3ltsWJ8wN @ 00:00-00:09 (three-metric readout), @ 00:21 ("the harness ... will be the main reason you finish tasks optimally at the lowest cost")
- category: workflow
- general-merit: Strong. "The harness, not the model, drives cost/quality/speed" is a real, testable thesis and the exact metric triple (pass/cost/time) is a good universal harness scorecard for anyone running agents.
- kb-fit-hypothesis: We have grading loops and cost ledgers but no head-to-head harness benchmark; this would sit on top of ledgers/grades + a fixed task fixture. New capability, not an extension.
- build-size: L

### Adopt a three-package harness split (CLI / runtime / multi-provider API)
- capability: A cleaner internal architecture where the interactive CLI, the tool-calling runtime, and the multi-provider LLM abstraction are separable, swappable packages instead of one monolith.
- mechanism: Pi Agent's repo splits into pi-coding (interactive coding-agent CLI), pi-agent (runtime with tool calling + state management), and pi-ai ("unified multi-provider LLM API: OpenAI, Anthropic ..."). The pi-ai layer in particular is a single provider-agnostic seam worth studying as a reference for isolating model access behind one interface.
- source: Db3ltsWJ8wN @ 00:22-00:33 (three composable packages)
- category: infrastructure
- general-merit: Good general architecture hygiene — a provider-agnostic LLM seam and a runtime/CLI split are standard-bearer patterns for maintainable harnesses.
- kb-fit-hypothesis: kb's harness (boss orchestrator + Agent tool + codex dispatch) is more implicit than this; a named provider-abstraction seam could ease future multi-provider work. Partial overlap with existing model routing; mostly refactor-flavored.
- build-size: M

### Voice control surface for the fleet ("one brain, any body")
- capability: A spoken interface to the boss orchestrator — issue dispatches, get status, hear results out loud — from a cheap desk device rather than a chat window.
- mechanism: Apollo's body/brain/console split: firmware on any board with mic+speaker+WiFi (the body) talks to a single stateful compute unit holding voice turns + memory + tools + schedule (the brain), with a live console dashboard. Tools reach services over MCP; a coding task is delegated to "an isolated engine" that "reports back out loud." kb could expose the boss as the brain, dispatched subagents/codex as the isolated engine, and a small always-on device as the body.
- source: DcD9cjRtNdm @ 00:07-00:13 (three-part split), @ 00:19 ("not everything has to be a chat window"), @ 00:19-00:24 (feature grid incl. coding-agent delegation)
- category: ui-ux
- general-merit: Decent and differentiated — a spoken, always-on control surface for a running agent fleet is a genuinely different interaction model, well-scoped by Apollo's MVP feature grid.
- kb-fit-hypothesis: kb already has the dashboard/session console (the "console") and MCP tools; the net-new piece is the voice/device I/O layer over the existing boss. Novel surface, not an extension of anything we have.
- build-size: L

### Semantic (meaning-based) retrieval for agent memory
- capability: Agents recall prior lessons/handoffs by meaning rather than exact-string match, so relevant memory surfaces even when phrased differently.
- mechanism: Apollo's memory is "recalled by meaning, not by text" — embedding/vector retrieval over stored free-text memories rather than keyword lookup. kb's per-agent memory/<id>.md and handoffs/ are currently flat markdown read wholesale or grepped; an embedding index over them would let a fresh session pull the least-general relevant lesson automatically.
- source: DcD9cjRtNdm @ 00:10-00:13 ("memory · recalled by meaning, not by text")
- category: change-to-existing
- general-merit: Good and well-trodden (semantic memory), but genuinely useful — flat-file memory that must be read whole doesn't scale.
- kb-fit-hypothesis: Directly upgrades kb's existing memory/ + handoffs/ subsystem. We have the storage; we lack meaning-based retrieval. Honest extension of a real system.
- build-size: M

### Semantic layer: define every fleet metric once, as one source of truth
- capability: One canonical definitions file for what "cost," "budget," "card status," "grade," "verified" mean, so every agent references it instead of re-deriving — raising consistency and accuracy.
- mechanism: A semantic layer is a translation layer between raw stores (here: ledgers/, queue/, governance/) and consumers (dashboards, agents). Define each metric exactly once; a change propagates from one edit; agents stop guessing a definition and cite the single source of truth. AtScale reports Anthropic's own DS team went 21%→95% accuracy with this.
- source: DbQrgz6haNi @ 00:00-00:09 (21%→95%), @ 00:24 ("define a metric once across an entire org"), @ 00:48 ("your AI agent doesn't have to guess ... references a single source of truth")
- category: infrastructure
- general-merit: Strong and sourced. A single-definition metric layer is a proven accuracy/consistency unlock for any agent-facing data system.
- kb-fit-hypothesis: kb has ledgers + governance but metric semantics are spread across many files/agents (the note itself flags this). A canonical governance/metrics-definitions file agents must cite would be a clean net-new layer over existing data. High fit.
- build-size: M

### Glob-scoped auto-loading rules to cut always-on context
- capability: Context that loads only when an agent touches matching files (e.g. src/api/**), instead of everything living in an always-loaded CLAUDE.md.
- mechanism: The .claude/ anatomy shows a rules/ directory that is "glob-scoped, loads on match" (api.md "fires only inside src/api/**"), distinct from always-loaded CLAUDE.md. kb's binding CLAUDE.md/BOSS.md are large and load every session; splitting project- or path-specific rules into glob-scoped files would shrink baseline context.
- source: DbPdttTxfjg @ 00:00 (rules/ "glob-scoped, loads on match"; CLAUDE.md "where Claude actually lives")
- category: change-to-existing
- general-merit: Good, concrete context-efficiency lever — scope context to where it's relevant rather than paying for it every turn.
- kb-fit-hypothesis: Directly targets kb's heavy always-on CLAUDE.md/BOSS.md + per-project _index/STATE/contract load pattern. We don't currently use glob-scoped rule files. Honest extension.
- build-size: S

### Audit kb's .claude/ against a full-anatomy checklist
- capability: A gap analysis of kb's Claude Code setup — hooks, output-styles, rules, statusline, plugins — against a known-complete reference, surfacing unused safety/efficiency primitives.
- mechanism: The infographic enumerates every .claude/ file type with purpose: hooks/ (block-dangerous-bash.sh blocking rm -rf/force-push; desktop-notify.sh), output-styles/ (terse.md "code only, no prose"), statusline (branch/model/tokens), settings hook registry. Walk kb's actual .claude/ against this list and adopt the missing high-value ones (notably a dangerous-bash guard hook and a terse output style).
- source: DbPdttTxfjg @ 00:00 (hooks/block-dangerous-bash.sh, output-styles/terse.md, statusline)
- category: change-to-existing
- general-merit: Modest but practical — a completeness checklist for agent tooling that catches cheap safety/efficiency wins.
- kb-fit-hypothesis: kb already has skills + agents + settings hooks (delivery-gate Stop hook); the likely gaps are a dangerous-bash block hook and output-style shaping. Low-risk extension.
- build-size: S

### Declarative agent config with per-tool permission policy
- capability: Agents defined as declarative config — model, system prompt, allowed MCP toolsets, and a per-tool permission_policy — so capabilities and risk are legible and enforced from one spec.
- mechanism: Claude Managed Agents' YAML: name/description/model/system + an mcp_servers list + tools entries of type mcp_toolset carrying default_config.permission_policy (e.g. always_allow), plus agent_toolset for built-ins. An agent-creation API (POST /v1/agents) returns an agent_id you then invoke in sessions. kb could formalize its agents/*.md into config carrying explicit per-tool permission and model, tied to risk-tiers.
- source: DW9JYHYhdnU @ 00:35 (YAML schema w/ permission_policy), @ 01:10 (Console nav: Agents/Sessions/Environments/Credential vaults)
- category: change-to-existing
- general-merit: Strong. Declarative agents with machine-checkable per-tool permissions are the right shape for governed multi-agent systems.
- kb-fit-hypothesis: kb has agents/ + governance risk-tiers T1-T3 + workflow-platform governedBy chains, but per-tool permission policy encoded in the agent spec is thinner than this. Extends existing governance + agent catalog.
- build-size: M

### Agent-archetype template gallery
- capability: A browsable gallery of ready-made agent templates (incident commander, sprint-retro facilitator, support-to-eng escalator, structured extractor, feedback miner) to instantiate instead of authoring from scratch.
- mechanism: Managed Agents ships a "Browse templates" gallery, each template a named agent + wired MCP servers + one-line purpose (e.g. Incident commander: Sentry alert → Linear issue + incident channel; Feedback miner: Slack+Notion → Asana tasks). kb could ship a template set for its own recurring archetypes and let the boss instantiate from them.
- source: DW9JYHYhdnU @ 01:16-01:33 (template gallery names/descriptions)
- category: feature
- general-merit: Good. A curated archetype catalog lowers the cost of standing up a new agent and encodes best-practice wiring.
- kb-fit-hypothesis: kb has an agent catalog but not a template-instantiation gallery; compare the archetype list against kb's catalog for gaps. Moderate fit, partly net-new.
- build-size: M

### Task-Observer: passive skill-gap finder that evolves the skill library
- capability: A background meta-skill that watches sessions, drafts new skill candidates from repeated patterns, and proposes edits to existing skills from corrections you make — continuously improving the library without manual authoring.
- mechanism: task-observer runs alongside work ("Observing tasks" panel), (1) mines repeated action sequences into new skill drafts and (2) suggests edits to existing skills based on expressed preferences/corrections; its README claims 600+ applied improvements across 40 skills in 3 months, most skills themselves auto-generated.
- source: Dbn6ElTvw_W @ 00:47-00:51 (observe → draft new skills → suggest edits), @ 00:47 (README "600 improvements across 40 skills")
- category: workflow
- general-merit: Strong and forward-leaning — closing the loop from observed work to library improvement is exactly how a skill system compounds.
- kb-fit-hypothesis: kb has a provenance-tiered skills system (curated/learned/imported/evolved) + superpowers:writing-skills + growth-log memory. This automates the "evolved" tier and the skill-gap detection we now do by hand. High-value extension of an existing subsystem.
- build-size: L

### Native /context-style token budget audit for kb sessions
- capability: A per-session breakdown of where context tokens go (system prompt, tools, custom agents, skills, messages, free space, autocompact buffer) plus per-agent/per-skill token costs, so bloat is visible and prunable.
- mechanism: The "Claude Code Setup" plugin scans the codebase and prints per-item token costs (a code-reviewer agent at 335 tokens; skills at 29-48 tokens each) and a /context category breakdown, then recommends adding useful hooks/skills/subagents/MCP and removing "fluff." kb could run this audit over its own .claude/ + CLAUDE.md/BOSS.md heavy load and trim.
- source: Dbn6ElTvw_W @ 00:35-00:37 (/context breakdown, per-item token costs), @ 00:33-00:45 (scan + recommend + remove fluff)
- category: infrastructure
- general-merit: Good, concrete efficiency tooling — you can't cut context waste you can't see.
- kb-fit-hypothesis: kb ships the claude-context-optimizer plugin (cco-overhead/cco-context) which overlaps heavily; this is more "actually run the audit and act on it" than build-new. Partial overlap — flag as mostly-have, under-used.
- build-size: S

### Multi-provider auto-failover router (subscription-aware)
- capability: When one provider/model hits a rate or usage limit, the session automatically fails over to the next-best available model instead of stalling.
- mechanism: OmniRoute sits in front of the agent as a router over 250+ providers and auto-switches the active model on limit ("Switching model..." cycling GLM/Kimi/Gemini/Claude), with a free-tier budget dashboard tracking remaining quota per provider.
- source: Dbn6ElTvw_W @ 00:07-00:09 (250+ providers, auto-switch on limit), @ 00:14-00:15 (free-tier budget dashboard)
- category: infrastructure
- general-merit: Good in general (resilience against rate limits) but heavily provider-sprawl-flavored; the failover concept is the durable part.
- kb-fit-hypothesis: kb is deliberately subscription-billing (never-spend-money; ANTHROPIC_API_KEY unset). A 250-provider paid router conflicts with that; the salvageable idea is model-tier failover within our allowed routing when a limit is hit. Weak fit as shown; note honestly. Extends model routing narrowly.
- build-size: M

### Free-tier / budget-remaining dashboard tile per resource
- capability: A dashboard panel showing remaining quota/budget per model or provider, so you see how much headroom is left before a run stalls or a cap trips.
- mechanism: OmniRoute's "Free-Tier Budget" chart tracks remaining free-tier tokens per provider as bars. kb could render an equivalent tile from its cost ledgers + budget.yaml showing spend-vs-cap and remaining daily headroom.
- source: Dbn6ElTvw_W @ 00:14-00:15 (per-provider free-tier budget chart)
- category: ui-ux
- general-merit: Modest but useful — a live headroom gauge is a natural companion to any budget guard.
- kb-fit-hypothesis: kb has ledgers/cost + budget.yaml + a dashboard already; this is a specific tile that may partly exist. Low-effort extension of the dashboard.
- build-size: S

### Local prompt-compression proxy (evaluate, likely reject)
- capability: A local layer that compresses/filters prompt content (JSON/AST/text) before it reaches the model, cutting tokens for the same result, agent-framework-agnostic.
- mechanism: Headroom runs a local proxy (headroom wrap claude, port 8787) with a pipeline CacheAligner → ContentRouter → SmartCrusher(JSON)/CodeCompressor(AST)/Kompress-text, keeping data local and compatible with Claude Code/Cursor/Codex/LangChain.
- source: Dbn6ElTvw_W @ 00:24-00:33 (local proxy + compression pipeline)
- category: infrastructure
- general-merit: Interesting architecture, but a proxy in front of the model is a known trap for subscription/cache setups.
- kb-fit-hypothesis: kb memory (token-minimizing-tools-shortlist) already records that proxies break prompt caching + subscription auth — so adopt the compression *idea* (AST/JSON crushers as a pre-pass) without the intercepting proxy. Weak fit as-shipped; capture the mechanism only.
- build-size: M

### Persistent cross-session memory with auto-capture
- capability: Project/file context that persists across sessions automatically, without the user re-explaining, via automatic capture + compression of session state.
- mechanism: claude-mem "automatically captures" project state and "preserves context across sessions" as a compressed memory store built for Claude Code.
- source: Dbn6ElTvw_W @ 00:18-00:22 (claude-mem README: auto-capture, cross-session)
- category: change-to-existing
- general-merit: Good, but auto-capture memory is now common and easy to over-fill with noise.
- kb-fit-hypothesis: kb already has strong deliberate memory (per-agent memory/, handoffs/, growth-log discipline) — the gap is *automatic* capture vs. the current end-of-run manual append. Overlaps existing system; the automation is the only net-new part. Mark as mostly-have.
- build-size: M

### Change-scoring accept/reject loop for autonomous improvement
- capability: An autonomous loop where every agent-proposed change gets a numeric score and is kept only if it beats the prior best, discarding regressions — enabling long unattended improvement runs.
- mechanism: The Karpathy/Autoresearch loop: score each change against a metric (Change #172 score 42 → rejected; #173 score 91 → accepted), keep improvements, drop regressions; an extended run did ~700 experiments in 2 days retaining ~20 optimizations from ~630 lines of core code, one change at a time.
- source: Dbs0166h9ZB @ 00:21-00:32 (scored accept/reject), @ 00:10-00:19 (700 experiments/20 kept)
- category: workflow
- general-merit: Strong — a machine-decidable score gate is the backbone of any safe self-improving loop and the empirical run is a real proof point.
- kb-fit-hypothesis: kb has grading/inspector loops + loop-design-check, but those grade a task to a bar, not iterate-until-improved over many autonomous steps. This is the autonomous-optimization variant — extends the loop tooling into a new regime. Governance-gated by never-spend/human-gate rules.
- build-size: L

### Reversible-change timeline with one-click revert
- capability: Every agent-made change lands on a numbered timeline where any step can be reverted to a prior known-good state, so a bad change never permanently breaks anything.
- mechanism: The guardrails "undo button" rule: a timeline of numbered changes (Undo Change 173 / Revert to Change 172) making each mutation reversible — the safety net that lets the scoring loop run unattended.
- source: Dbs0166h9ZB @ 00:32-00:39 (Rule 2 reversible-change timeline)
- category: change-to-existing
- general-merit: Good and fundamental — reversibility is a precondition for trusting autonomy.
- kb-fit-hypothesis: kb gets reversibility from git (agent branches, cards) but has no first-class per-change revert timeline UI over agent actions. Extends the dashboard/workflow-platform with an operator-facing rollback surface.
- build-size: M

### Bounded-action-space enforcement (declared mutable scope per agent)
- capability: Each agent can only touch an explicitly declared component/path; everything else (logging, deployment, other core systems) is locked, shrinking blast radius by construction.
- mechanism: The guardrails "strict boundaries" rule: a diagram where only one boxed component is mutable ("Only this part can change") inside a "Safe Experiment Space" while other systems are locked. Enforced as a scope declaration checked before any write.
- source: Dbs0166h9ZB @ 00:46-00:53 (bounded action space diagram)
- category: change-to-existing
- general-merit: Strong safety primitive — least-privilege by declared scope is the right default for autonomous agents.
- kb-fit-hypothesis: kb already approximates this (branch rules, card-scoped file access, ops-only coordination writes, never-handle-credentials) — the note maps onto it explicitly. Net-new would be a machine-checked per-card/per-agent mutable-path allowlist enforced pre-write. Hardening of an existing convention.
- build-size: M

### "Can success be verified?" gate before granting autonomy
- capability: A required pre-flight question that refuses to start an autonomous loop unless a machine-checkable success test/rubric/human-decision exists.
- mechanism: The Decision Framework's first Selection Question: "Can success be verified? If not, do not begin with autonomy. Define a test, rubric, source requirement, or human decision." A hard gate on every new loop/cadence.
- source: Dbs0166h9ZB @ 00:28-00:31 (Six Selection Questions #1)
- category: workflow
- general-merit: Strong, universal loop-safety principle — decidability first.
- kb-fit-hypothesis: kb's loop-design-check skill already centers decidability and keep-judgment-with-the-human; this reinforces/formalizes it as a mandatory gate rather than guidance. Mostly-have; small formalization.
- build-size: S

### Step-by-step progress log UX for long-running agent tasks
- capability: A live, checkmarked step log (search → crawl → extract → write, each with a count) that makes a long agent task legible while it runs.
- mechanism: The lead-gen and task-observer demos both show a running checklist ticking discrete stages with per-stage counts, giving at-a-glance progress instead of an opaque spinner.
- source: DbvWERsuDuA @ 00:13-00:16 (step log with counts); Dbn6ElTvw_W @ 00:47-00:51 (live task checklist)
- category: ui-ux
- general-merit: Good, cheap UX win — discrete progress beats a spinner for trust and debugging.
- kb-fit-hypothesis: kb has a session console + one-line running indicator (Daniel prefers minimal foreground); a DAG-node step log fits the workflow-platform's node view. Extends existing dashboard; respect the minimal-foreground preference.
- build-size: S

### Scheduled recurring workflow that appends results over time
- capability: Save a one-off agent workflow and have it re-run on a schedule (e.g. daily weekday mornings), accumulating fresh output into the same store each run.
- mechanism: The lead-gen demo's "save this workflow, run every morning" mockup: a day-of-week toggle + fixed time (7:00 AM Mon-Fri), row count climbing across days as each run appends.
- source: DbvWERsuDuA @ 00:34-00:38 (daily schedule + appending rows)
- category: workflow
- general-merit: Modest — scheduled recurring agent jobs are table stakes, but the "promote a proven ad-hoc workflow to a schedule" framing is a nice UX.
- kb-fit-hypothesis: kb already has HEARTBEAT cadences dispatched by a single Routine + the schedule skill; the net-new bit is one-click "promote this run into a cadence." Mostly-have; small UX layer.
- build-size: S

### Per-unit cost accounting shown inline against a paid baseline
- capability: Show the running $/unit cost of an agent task and contrast it with what a paid third-party service would have cost, making the savings/spend explicit.
- mechanism: The lead-gen demo overlays $0.00/company (local) vs Apify $0.004/company with a climbing running total across companies processed — cost transparency rendered as the task runs.
- source: DbvWERsuDuA @ 00:18-00:23 ($/company vs Apify, running total)
- category: ui-ux
- general-merit: Modest but genuinely useful framing — per-unit cost with a baseline makes budget decisions concrete.
- kb-fit-hypothesis: kb has cost ledgers + budget guard; adding a per-task-vs-baseline comparison tile extends that. Low-effort dashboard extension.
- build-size: S

### Cross-tool agent installer with a scope filter (avoid roster bloat)
- capability: Distribute kb's agent specs to multiple harnesses (Claude Code, Codex, Cursor, Gemini) from one source, installing only a chosen subset rather than the whole roster.
- mechanism: agency-agents ships one install.sh --tool <target> that drops agent .md files into the right dir per tool (~/.claude/agents for Claude Code), plus a desktop installer with per-agent checkboxes and a division filter — the explicit lesson being "do NOT install all 270; filter to the divisions you use."
- source: Db0Kka1vxSH @ 00:12-00:16 (--tool flag, multi-target, per-agent checkboxes/division filter), @ 00:10-00:11 (agent = one .md w/ workflow + definition-of-done)
- category: feature
- general-merit: Good — a single source of agent specs with a scoped, multi-target installer is the right distribution model, and the anti-bloat filter is a real insight.
- kb-fit-hypothesis: kb keeps agents/*.md and already dispatches to both Claude and codex; a scoped exporter/installer that syncs a curated subset to each harness is net-new tooling over the existing catalog. Moderate fit.
- build-size: M

### Curated tool/repo discovery catalog for agents
- capability: A structured, categorized index of vetted tools/libraries/repos that agents (or the boss) can consult when choosing what to build with, instead of ad-hoc web search.
- mechanism: The "awesome" pattern: a root list-of-lists (sindresorhus/awesome) linking to topic-specific curated markdown indexes (Awesome Python: AI & Agents, ETL, Web Scraping...), each just categorized hyperlinks — a ready taxonomy and seed corpus to scrape into an internal catalog.
- source: DcEQbIdK-p0 @ 00:00-00:02 (root index), @ 00:08-00:17 (topic list + taxonomy)
- category: feature
- general-merit: Modest and generic — curated catalogs help, but this is a well-known resource, not a novel mechanism.
- kb-fit-hypothesis: No clear kb subsystem owns tool discovery today; low priority and weak fit — capture as raw material only. Honestly marginal.
- build-size: S

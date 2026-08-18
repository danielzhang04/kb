# Candidates B — buildable ideas from 10 video-analysis notes

Source pool: DcIFWCWM13f, DaYtkeQleK6, Dbi4ruODNlK, DcHPKO-gQLs, DcGxs-_NiNA, DbRGB9QsGtb, DZErwKSCT2z, Daxhbdmk5G9, DcC03XQMHjL, DbY9KatgSMi.
Every candidate traces to a specific frame/transcript moment. Thin-source items are marked honestly.

---

### Ship a token-efficient browser-control daemon for the fleet
- capability: One persistent local browser control plane every agent process talks to over a plain HTTP API, returning ~800-token accessibility-DOM snapshots with stable element refs and diff-only reads instead of full screenshots.
- mechanism: PinchTab runs as a single Go binary / user-level daemon; agents drive Chrome over HTTP (curl works), reusing one background browser session rather than each run spawning its own. README benchmark shows 9.5–20.3% cheaper and 23–31% fewer requests vs "agent-browser" across Haiku/Sonnet loops. Accessibility DOM with stable refs + smart-diff mode is the token-saving core.
- source: DbRGB9QsGtb @ 00:00 (daemon/HTTP architecture), 00:00–00:15 (benchmark table); ~800-token snapshot + smart-diff from caption only, unverified in frames.
- category: infrastructure
- general-merit: Strong. Per-run browser spin-up and screenshot-based perception are two of the biggest cost/latency sinks in agentic browsing; a shared daemon + accessibility-DOM snapshots attack both directly with real (if modest) measured deltas.
- kb-fit-hypothesis: kb already uses chrome-devtools + playwright MCP servers per-invocation; this would replace/augment them with a persistent, token-cheaper control plane usable by fyt upload flows, dashboard e2e, and any web-scraping agent. We do NOT have a shared browser daemon or accessibility-DOM snapshot mode today.
- build-size: L

### Adopt accessibility-DOM snapshots over screenshots as the default agent web-perception mode
- capability: Cut per-step browsing token cost by feeding agents a structured ~800-token accessibility-tree snapshot with stable element references and diffing between steps, rather than re-sending screenshots or full HTML.
- mechanism: PinchTab's snapshot format is the reusable idea independent of the daemon: accessibility DOM + stable refs + "smart diff mode so agents only read what changed." Extractable as a perception convention even without adopting the Go binary.
- source: DbRGB9QsGtb @ 00:00 (accessibility DOM w/ stable refs, on-screen); ~800 tokens / 13x-cheaper / diff-mode from caption only.
- category: change-to-existing
- general-merit: Good and well-grounded — accessibility-tree perception is a known, effective token reduction for browser agents; the stable-ref + diff angle is the practical detail most implementations miss.
- kb-fit-hypothesis: Applies to any kb agent using chrome-devtools/playwright MCP; today those default to snapshots/screenshots without a diff layer. Could be a thin wrapper convention rather than a new subsystem.
- build-size: M

### Embed grading criteria in the same skill file as the task, driven by a /goal self-verify loop
- capability: Skills that carry both "how to do the task" and "how to grade the output" so an agent loops work→grade→rework until it hits the bar, and the human only sees passing output.
- mechanism: Boris Cherny recipe: write the exact grading standards into the skill file itself, then invoke `/goal` so Claude Code runs work ↔ evaluator-model until goal-met or a try-limit (example string "get homepage Lighthouse to 90 or above, stop after 5 tries"). If output is still weak, you fix the verification loop, not re-prompt manually.
- source: Dbi4ruODNlK @ 00:36–00:39 (criteria in skill file), 00:43–00:48 (`/goal` loop), 00:44–00:45 (`/goal` UI card).
- category: workflow
- general-merit: Strong and foundational — co-locating rubric with task and handing the checking to the model is the single most-cited lever for agents that "actually finish."
- kb-fit-hypothesis: kb already has manager/inspector grading loops and a loop-design-check skill, but grading criteria live in inspector prompts / card acceptance, not co-located inside the work skill. Extending kb skills to embed machine-checkable rubrics + a `/goal`-style bounded loop is an upgrade, not net-new.
- build-size: M

### Adopt the four-loop taxonomy as a design vocabulary for kb cadences
- capability: A shared vocabulary — Turn-Based, Goal-Based, Time-Based, Proactive — each with its trigger and flow, to classify and sanity-check every recurring agent loop before building it.
- mechanism: On-screen taxonomy chart: Turn-Based (user prompt → gather→act→check→respond), Goal-Based (`/goal` → work↔evaluator→goal-met/turn-limit), Time-Based (interval → fixed prompt → sleep), Proactive (event/schedule/human → dynamic workflow → trigger→fix→review→closed).
- source: Dbi4ruODNlK @ 00:57–00:58 (Types of Loops chart).
- category: workflow
- general-merit: Good — a compact mental model that maps cleanly onto the real failure modes of agent loops; useful as a checklist even for teams that already build loops.
- kb-fit-hypothesis: Directly overlaps kb's loop-design-check skill and HEARTBEAT cadence patterns; would be a refinement/cross-check of an existing rubric, not a new system.
- build-size: S

### Maker/Checker two-role split for any pipeline needing a self-check stage
- capability: A clean two-agent pattern where a Maker does DISCOVER→PLAN→EXECUTE and a separate Checker does VERIFY, isolating the grader from the worker.
- mechanism: Diagram splits the DISCOVER→PLAN→EXECUTE→VERIFY flow into a Maker Agent (first three) and Checker Agent (verify), a reusable topology for pipelines lacking an independent verification stage.
- source: Dbi4ruODNlK @ 00:13 (Maker/Checker diagram).
- category: workflow
- general-merit: Good, standard-but-solid — independent verification role is the backbone of reliable agent output.
- kb-fit-hypothesis: kb already runs a manager/inspector split with fresh-context grading and three-state honest stamps; this is the same principle, so treat as validation of existing design rather than new build.
- build-size: S

### Reference topology: Router → specialists → shared state → integrator → reviewer → human checkpoint → ship
- capability: A concrete, reusable six-node graph for shipping any feature-scale unit of work, with parallel specialists writing to a shared blackboard and a single integrate/review/gate/ship tail.
- mechanism: Graph-engineering diagram: Router reads mission and routes; work fans out to Researcher/Architect/Builder (each with a private work area); results land in one Shared State (facts, decisions, artifacts); Integrator combines; Reviewer tests quality+safety; on PASS → Human Checkpoint (approves high-impact) → Ship verified output.
- source: DbY9KatgSMi @ 00:00–00:02 (topology), 00:08 (human checkpoint).
- category: harness
- general-merit: Strong as a reference architecture — it names the exact roles ad-hoc multi-agent setups keep reinventing, with parallel fan-out and a single merge/verify tail.
- kb-fit-hypothesis: Maps onto kb's workflow-platform DAG (governedBy manager+agent chains). kb has the execution substrate but not a canonical, published reference topology; adopting this as the default graph shape for new workflows is an upgrade to the workflow platform.
- build-size: M

### Route reviewer failures back to the specific upstream node, not the top of the pipeline
- capability: On verification failure, re-run only the responsible upstream node (e.g. Builder) instead of failing or restarting the whole workflow — cheaper, faster recovery.
- mechanism: Graph diagram shows an explicit dashed FAIL → retry-to-Builder edge from the Reviewer, so a second pass fixes only the failing step.
- source: DbY9KatgSMi @ 00:06 (FAIL → back-to-Builder loop).
- category: change-to-existing
- general-merit: Good — targeted retry is a real cost/latency win over blanket pipeline restart and is often overlooked.
- kb-fit-hypothesis: kb's workflow-platform DAG could gain per-node failure-routing edges; unclear whether current DAG semantics support targeted retry vs full re-dispatch. Likely a workflow-platform enhancement.
- build-size: M

### Structured shared-state blackboard for multi-agent runs
- capability: A single structured state object (facts, decisions, artifacts) that specialists write to and downstream nodes read from, replacing prose hand-offs between agents.
- mechanism: Diagram's Shared State node collects each specialist's output; the closing framework names State ("what's carried," rule: pass structured state) as one of four primitives, alongside Nodes/Edges/Conditions.
- source: DbY9KatgSMi @ 00:04 (Shared State), 00:10–00:11 (four-primitive framework).
- category: harness
- general-merit: Good — structured state passing is what separates a coordinated graph from a "group chat"; the thesis line "don't build a group chat, engineer the coordination" captures the value.
- kb-fit-hypothesis: kb passes context via cards (`## Result`), memory files, and handoffs — semi-structured. A typed shared-state artifact for a single workflow run would be a workflow-platform addition; partial overlap with card `## Result`.
- build-size: M

### Four-primitive design rubric before building any new agent graph
- capability: A compact pre-build checklist — Nodes (one job per node), Edges (where work moves), State (pass structured state), Conditions (design the exit) — to force explicit design of each new multi-agent workflow.
- mechanism: Closing framework slide enumerates the four primitives with a one-line rule each.
- source: DbY9KatgSMi @ 00:10–00:11.
- category: workflow
- general-merit: Good — a lightweight design gate that catches the most common graph mistakes (nodes doing two jobs, undefined exit conditions).
- kb-fit-hypothesis: Complements loop-design-check and the BOSS planning discipline; a small addition to existing design skills, not new infrastructure.
- build-size: S

### Evolve-not-design-upfront progression for adding agents
- capability: A staging discipline — start with one single-responsibility agent, add a self-improve loop, split into specialists, and only then connect them with a graph — so complexity is added when the workflow demands it, not on day one.
- mechanism: Caption/thesis (video is diagram-only): one agent → add loop (retry/reflect) → split into Researcher/Builder/Reviewer specialists → connect with deterministic edges that route/branch/merge/retry/pause-for-humans.
- source: DbY9KatgSMi — caption thesis; video visuals show the end-state graph @ 00:00–00:11 (progression itself is caption-level, marked honestly).
- category: workflow
- general-merit: Good governance principle against premature multi-agent complexity; caption-sourced rather than shown, so weaker evidence.
- kb-fit-hypothesis: Cultural/process guidance for how kb spins up new project workflows; no subsystem change.
- build-size: S

### Expose kb tools as OAuth MCP servers so Claude/Fable can drive them conversationally
- capability: Turn a kb subsystem's core actions into an OAuth-authenticated remote MCP server that any Claude/Fable/Codex client can add as a custom connector — no API key, no bespoke client orchestration code.
- mechanism: UGCdrop demo: Settings → MCP tab exposes a remote MCP server URL + "Sign in with your account, no API key needed"; user pastes URL into Claude's Add-custom-connector dialog; once connected, a single NL prompt ("make 10 UGC videos") makes the model call the MCP tools itself to run a batch job. Real settings page, real MCP URL, real tool list all shown on screen.
- source: DcGxs-_NiNA @ 00:06–00:23 (OAuth MCP setup + connector wiring), 00:24–00:30 (NL prompt triggers batch).
- category: infrastructure
- general-merit: Strong — MCP-as-product-surface with OAuth is the cleanest way to make any tool conversationally drivable without shipping client code; broadly applicable.
- kb-fit-hypothesis: kb's dashboard/workflow-platform actions (dispatch a card, query ledgers, launch a run) could be exposed as an OAuth MCP server for boss/mobile use. kb uses MCP as a client heavily but does not publish its own control plane as an MCP server today. New capability.
- build-size: L

### Cost-aware, pollable batch-job convention baked into the MCP contract
- capability: A tool-naming convention where every batch/spend surface ships dry-run cost preview + async job status as first-class MCP tools, so cost governance and progress polling need no client-side glue.
- mechanism: UGCdrop's tool set read off-screen: `get_credits`, `preview_render_cost` (dry-run credit cost), `generate_videos` (spends credits), `get_session_status` (poll running session), `list_hook_videos`, `list_saved_demos` — a minimal cost-aware, pollable batch surface.
- source: DcGxs-_NiNA @ 00:12, 00:24 (tool list on settings page).
- category: infrastructure
- general-merit: Strong general pattern — bake dry-run pricing and job-status into the tool contract itself, which is exactly what agentic spend governance and long-job UX need.
- kb-fit-hypothesis: Maps directly onto kb's never-spend-money law + cost ledgers + budget guard: any kb MCP surface that spends (fyt image/video gen) should expose a `preview_*_cost` dry-run + `get_*_status` poll. We have budget guards but not a standardized preview-cost/poll MCP convention.
- build-size: M

### On-device / private voice dictation as an agent input surface
- capability: Fully local speech-to-text with sub-150ms latency for dictating prompts/commands into agent tooling, with no audio leaving the machine.
- mechanism: Talkify hooks Apple's SpeechAnalyzer (macOS 26, the Notes/Journal engine) instead of bundling Whisper; hold-hotkey → on-device transcription → text inserted into the focused field; "warms it up at launch" to avoid model spin-up delay. In-app Latency Bench shows Talkify fastest (~128ms) vs superwhisper / Voice Ink / Whisper default / MacWhisper large-v3-turbo.
- source: DcIFWCWM13f @ 00:12–00:14 (SpeechAnalyzer), 00:15–00:17 (latency bench), 00:08 (warm-at-launch).
- category: feature
- general-merit: Good but niche/platform-bound — the on-device-privacy + low-latency dictation idea is solid, but the specific engine is macOS-26-only; Daniel is on Windows 11, so direct reuse is limited.
- kb-fit-hypothesis: Weak kb-fit for the Apple engine specifically. The general pattern (local dictation feeding the boss terminal) could pair with kb's video-vision plugin's local-whisper backend, but Windows has no SpeechAnalyzer equivalent. Mark kb-fit weak/platform-mismatched.
- build-size: M

### Ship a self-contained, screenshot-able benchmark UI with any performance claim
- capability: Every kb tool that makes a speed/cost claim ships an in-repo or in-app benchmark that runs the comparison live and renders a bar chart + median numbers you can screenshot.
- mechanism: Two independent instances in the pool: Talkify's in-app "Latency Bench" (bar chart, median-ms vs competitor engines) and PinchTab's README benchmark table (cost-% and request-count-% deltas vs a rival, with the metering basis stated). Both make the claim self-evidencing rather than prose.
- source: DcIFWCWM13f @ 00:15–00:17 (in-app bench); DbRGB9QsGtb @ 00:00–00:15 (README benchmark table).
- category: change-to-existing
- general-merit: Good engineering hygiene — self-evidencing benchmarks beat prose claims and double as regression tests.
- kb-fit-hypothesis: kb ships suites + acceptance runs; a standard "benchmark card" artifact for tools making cost/latency claims (fyt render times, browser-daemon token deltas) would extend existing ledger/grade practice. Partial overlap with cost ledgers.
- build-size: S

### Personal Claude/agent usage-tracking dashboard (self-observability)
- capability: A personal surface showing your own agent-usage telemetry — session/message/token counts, streaks, peak hour, favorite model, "what's up next" — as a self-built observability layer over Claude Code usage.
- mechanism: Creator's own screen (incidental to Talkify demo) shows a custom Claude Code usage tracker: session/message/token counts, streaks, peak hour, "Favorite model: Opus 4.8," captioned "What's up next, Angelo?"
- source: DcIFWCWM13f @ 00:18–00:23 (usage dashboard on screen).
- category: ui-ux
- general-merit: Good, modest — usage self-observability is genuinely useful for spotting cost/behavior drift; light lift.
- kb-fit-hypothesis: kb has cost/activity/dispatch ledgers + a dashboard; a per-agent usage-summary view (streaks, peak hour, token totals, favorite model) would be a small dashboard addition on top of existing ledger data, not new plumbing.
- build-size: S

### Fleet observability panel: access-leader / blast-radius / action-heat / throughput / bot-status + live cost ticker + access-grant log
- capability: A single multi-agent fleet dashboard whose panels surface not just throughput/status but security posture — which agent holds which access (access leader), the blast radius of each, action heat, and a live scrolling grant/revoke log — alongside a running cost ticker.
- mechanism: The SpaceXAI clip is a stylized generative visualization (no real product shown), but the *panel taxonomy* is concrete and worth stealing: ACCESS LEADER / BLAST RADIUS / ACTION HEAT / THROUGHPUT / BOT STATUS side panels, a cost readout climbing $27.90→$214.00, and a bottom-left log of grant/revoke/cookie/oauth entries referencing google/stripe/calendar.
- source: DcHPKO-gQLs @ 00:00–00:14 (panel layout + cost ticker + access log). Note: video is B-roll only; treat as a design-pattern source, not a product demo.
- category: ui-ux
- general-merit: Good concept — most fleet dashboards show throughput/status but not per-agent access/blast-radius; surfacing security posture live is a differentiated, useful idea. Evidence is a stylized animation, so the *pattern* is the takeaway, not any implementation.
- kb-fit-hypothesis: kb's dashboard shows queue/ledgers/STATE; a "blast radius / access leader / grant log" view would extend it with the credential-isolation posture kb governance already cares about (never-handle-credentials, risk tiers). New view over partly-existing data.
- build-size: M

### Per-agent credential isolation and pre-provisioning blast-radius mapping
- capability: Give each agent its own scoped account/session so one compromised sign-in can't hand the browser session, files, and CLI creds to every other agent — and map each agent's reachable surface before spinning up the next.
- mechanism: Caption argues five hireable bots share one machine/browser session, so one login exposes ~11 signed-in apps + one browser profile to all, and deleting a bot leaves access standing — contradicting the NSA/CISA/UK/CA/AU/NZ advisory (least privilege, non-sensitive work only). Remedies named: separate account per bot, put the stop line in the description, cap spend outside the product, keep money/customer-replies human-held.
- source: DcHPKO-gQLs — caption/audio only (video has no speech and shows no product); mechanism documented in caption, marked honestly as caption-sourced.
- category: infrastructure
- general-merit: Strong security principle even though the specific product claims are unverifiable — per-agent least-privilege + pre-mapping blast radius is exactly right for multi-agent fleets.
- kb-fit-hypothesis: Directly reinforces kb's existing never-handle-credentials ceiling, risk tiers T1–T3, spend law, and human gates. Largely validates current governance; a concrete "blast-radius map per agent" artifact would be the net-new piece.
- build-size: M

### Import external skill marketplaces (e.g. google/skills) into kb's skills system
- capability: Pull in a large, actively-maintained open-source skills library (100+ Google Agent Skills, Apache-2.0) as importable skills, giving agents ready-made competence for GCP/BigQuery/Ads/Analytics/Firestore/Flutter without hand-authoring.
- mechanism: google/skills repo installs via `npx skills add google...` or per-harness marketplace commands (`claude plugin marketplace add <plugin>@google-plugins`, Codex, Antigravity CLI). Categorized: Getting started, Multi-product, AI/ML, Infrastructure, Databases, Well-Architected, Security, Web/mobile, Advanced (Google Ads).
- source: DcC03XQMHjL @ 00:00–00:11 (repo + install), 00:22–00:34 (Plugins install table).
- category: feature
- general-merit: Good — reusing a maintained skills marketplace beats reinventing per-platform skills; provenance/trust vetting is the caveat.
- kb-fit-hypothesis: kb's skills system is provenance-tiered (curated/learned/imported/evolved) and already has an "imported" tier — this is exactly that path, so it's using an existing capability, not new. Value is in which skills to import.
- build-size: S

### Marketing/analytics account diagnostics via MCP (Google Ads / Analytics skills)
- capability: Point an agent directly at a live Google Ads or Analytics account to inspect what's broken, pull analytics, and suggest improvements — through an MCP skill rather than a bespoke API wrapper.
- mechanism: google/skills ships a Google Ads MCP skill ("Google Ads API MCP Server Installation") and Google Analytics Admin/Data skills; narration: "point Claude straight at your ad account and ask what's broken, look at analytics, improve your Google ads."
- source: DcC03XQMHjL @ 00:19–00:24 (Ads MCP), 00:20–00:24 (analytics use).
- category: feature
- general-merit: Good and concrete for anyone running paid acquisition or web analytics; niche unless kb runs ads.
- kb-fit-hypothesis: Relevant to faceless-youtube growth/analytics if it ever runs paid promotion or needs channel analytics diagnostics; otherwise weak kb-fit. Uses the imported-skills path above.
- build-size: S

### One README section with per-harness install commands for every kb tool
- capability: Ship each kb-internal tool/skill with a single "Plugins" table giving install commands per agent harness (Claude Code / Codex / others) instead of harness-specific docs scattered across files.
- mechanism: google/skills' "Plugins" table pattern: Agent harness → Install command, one row each for Claude Code (`claude plugin marketplace add ...`), Codex, Antigravity CLI.
- source: DcC03XQMHjL @ 00:22–00:34 (Plugins table).
- category: change-to-existing
- general-merit: Good docs hygiene — one canonical multi-harness install table reduces drift and onboarding friction.
- kb-fit-hypothesis: kb dispatches both Claude subagents and Codex workers; a shared install/enable table per skill would reduce the agents/ catalog main↔ops drift kb already tracks. Small docs-convention change.
- build-size: S

### Category taxonomy for a large internal skills library
- capability: A reusable top-level structure for organizing a growing skills catalog so agents (and humans) can find the right skill fast.
- mechanism: google/skills' categories: Getting started / Multi-product solutions / AI-ML / Infrastructure / Databases / Well-Architected / Security & identity / Web & mobile / Advanced.
- source: DcC03XQMHjL @ 00:14–00:20 (Available Skills list structure).
- category: change-to-existing
- general-merit: Modest but useful once a skills library grows past a few dozen entries.
- kb-fit-hypothesis: kb's skills system is provenance-tiered but not domain-categorized; a domain taxonomy layer atop provenance tiers would help discovery. Small addition.
- build-size: S

### Open-source AI pen-testing agent for kb's own security-review cadence
- capability: An overnight AI agent that runs a full pen-test / vulnerability scan-and-fix cycle against kb's own repos and surfaces, framed as replacing a $5k+ agency audit.
- mechanism: usestrix/strix — "open-source AI penetration testing agent that finds and fixes your app's vulnerabilities"; pitch: run the kind of security audit agencies charge $5,000+ for, overnight. (Video is a repo-card readthrough — no code/demo shown, discovery-level evidence.)
- source: DaYtkeQleK6 @ 00:05–00:19 (Strix card + $5k pitch); live star count 28,869→35,615 on screen.
- category: feature
- general-merit: Good if it works — automated recurring pen-testing is high-value for any platform with exploitable surfaces; evidence here is card-level only, so it needs real evaluation before trust.
- kb-fit-hypothesis: kb has a security-review skill (read-only, human-invoked) and adversarial review panels for exploitable code (dashboard control plane, WebAuthn, broker). Strix could add an automated recurring scan node to that cadence — extends existing security practice.
- build-size: M

### Embeddable in-page NL agent for the kb dashboard (one script tag)
- capability: Let a user control an internal tool/dashboard by typing plain English into the page itself, via a drop-in script, instead of learning the UI or opening a separate chat sidebar.
- mechanism: alibaba/page-agent — "in-page GUI agent, control web interfaces with natural language"; add one script tag to a page and users drive the interface conversationally (form filling, internal-tool flows, support). (Repo-card readthrough; no live demo shown.)
- source: DaYtkeQleK6 @ 00:20–00:33 (page-agent card + "one script tag" narration).
- category: ui-ux
- general-merit: Good — NL control embedded in the page (vs a bolt-on chatbot) is a genuinely better internal-tool UX; card-level evidence, needs a real trial.
- kb-fit-hypothesis: kb's Next.js dashboard has a session console/terminal already; an in-page NL agent could let Daniel drive dispatch/queue/ledger actions by typing into any dashboard view. Overlaps the console but targets in-context control of arbitrary panels. New UI capability.
- build-size: M

### Local, private meeting/transcription assistant
- capability: A fully on-device meeting assistant that transcribes and summarizes calls without any audio leaving the machine — for privacy-sensitive contexts.
- mechanism: Zackriya-Solutions/meetily — "privacy-first AI meeting assistant that runs entirely on your machine." (Repo-card readthrough; no demo shown.)
- source: DaYtkeQleK6 @ 00:34–00:48 (meetily card + "no cloud" narration).
- category: feature
- general-merit: Good but tangential to an agent platform — solid privacy tooling, limited relevance unless kb needs meeting notes.
- kb-fit-hypothesis: Weak kb-fit. Overlaps kb's video-vision plugin local-whisper backend conceptually; no current kb need for meeting transcription. Mark weak.
- build-size: M

### Prompt-cache-first prompt construction as a kb-wide rule
- capability: Structure every agent prompt so the stable prefix (instructions, static context) comes first and per-call dynamic content comes last, maximizing cache-hit prefix length for a flat ~10x cost + latency win.
- mechanism: Infographic mechanism: "your app → CACHE → model"; no-cache re-sends the full ~12k-token prompt every call (linear cost), cached serves the repeated prefix and pays only for the delta. Design rule: "cache the stable prefix, pay only for what changes." Numbers ($1.00→$0.10, 120k→6k tokens over 10 calls) are illustrative, not measured.
- source: Daxhbdmk5G9 @ 00:00–00:09 (cache node diagram + design rule).
- category: change-to-existing
- general-merit: Strong and well-established — prompt caching is a real, large, low-effort cost/latency win; the "static first, dynamic last" construction rule is the practical lever.
- kb-fit-hypothesis: kb runs on subscription billing but still cares about latency and (for the Atlas voice worker's spend-capped key) real cost; ensuring boss/subagent prompts and skill files are ordered for cache reuse is a cheap optimization. kb has no explicit cache-ordering convention today. Note kb memory already flags that proxies break prompt cache — this is the constructive counterpart.
- build-size: S

### "One UI, any harness" — dashboard as a vendor-neutral abstraction over coding-agent CLIs
- capability: A single control UI that shells to whichever coding-agent CLI is configured (Claude Code, Codex, + any CLI) on your flat subscription, instead of an app that hits metered model APIs.
- mechanism: Talking-head + "One UI, any harness" diagram: a custom UI as hub with Claude Code / Codex / "+ any CLI" as interchangeable spokes; talks back-and-forth with the CLI process you already pay for. (Video is mockups only — no real product/repo; cost numbers are template placeholders.)
- source: DZErwKSCT2z @ 00:21–00:26 ("One UI, any harness" diagram), 00:16–00:21 (subscription rationale).
- category: harness
- general-merit: Good principle — harness-neutral orchestration avoids vendor lock-in and metered-API cost creep; the video proves nothing (mockups), but the idea is sound.
- kb-fit-hypothesis: kb ALREADY largely embodies this: boss dispatches both Claude subagents and Codex workers on subscription billing via a dashboard. The extractable delta is making the harness a first-class configurable abstraction ("+ any CLI" — e.g. Gemini CLI). Mostly-have; treat as extend.
- build-size: M

### Projects-at-a-glance table for tracking many parallel agent runs
- capability: A single table showing every active run/project with Stage / Last Touch / Next Action / Artifact-count columns so 100+ concurrent subagents stay legible.
- mechanism: "Every project, at a glance" mockup: table with Stage / Last Touch / Next / Artifacts columns; paired "watch your agents" steer/approve loop framed as persistent & personal. (Mockups only, non-functional.)
- source: DZErwKSCT2z @ 00:39–00:45 (projects table schema), 00:46–00:55 (watch/steer loop).
- category: ui-ux
- general-merit: Good, concrete schema for parallel-run legibility — a real pain point once dozens of agents run at once.
- kb-fit-hypothesis: kb's dashboard already renders queue/STATE/ledgers and Daniel wants a one-line running indicator; a compact Stage/Last-Touch/Next/Artifacts run table would extend the existing executive/handover dashboards. Mostly-have; refine.
- build-size: S

### Approvals queue UI: per-item approve/edit gate before agent output goes live
- capability: A dedicated queue where agent-drafted outputs (posts, notes, publishes) wait with per-item Approve / Edit controls before anything goes live.
- mechanism: "Approvals" mockup with per-item Approve/Edit buttons for agent-drafted posts/notes — a concrete human-in-the-loop gating surface. Reinforced by the graph note's "human approves high-impact" checkpoint. (DZErwKSCT2z is mockups only.)
- source: DZErwKSCT2z @ 00:56–01:01 (Approvals mockup); DbY9KatgSMi @ 00:08 (human-checkpoint on high-impact).
- category: ui-ux
- general-merit: Good — a batched approvals inbox is the natural UX for human gates over many background runs, and gating only high-impact items keeps it from becoming ceremony.
- kb-fit-hypothesis: kb enforces human gates (fyt GATE 1/2/3, risk-tier T3 approvals) but they surface as cards/prose, not a batched approve/edit inbox. A dashboard Approvals queue over pending gates would upgrade existing gate mechanics. Partial overlap with the dashboard inbox already built.
- build-size: M

### Selective human-gating: sign off only on high-impact outputs
- capability: A rule that human approval is required only for high-impact actions, letting low-impact agent output ship unattended — so gates don't become universal friction.
- mechanism: Graph diagram's Human Checkpoint is explicitly gated on "approves high-impact," not every output.
- source: DbY9KatgSMi @ 00:08 (human-checkpoint on high-impact only).
- category: workflow
- general-merit: Good governance calibration — matches gate cost to stakes, avoiding both rubber-stamping and bottlenecks.
- kb-fit-hypothesis: kb's risk-tiers (T1–T3) already encode stakes-based gating; this validates the existing model and could sharpen where fyt/dashboard gates fire. Mostly-have.
- build-size: S

### NL-prompted batch UGC ad-video generation for faceless-youtube
- capability: Generate many short UGC-style ad/marketing videos from a single natural-language prompt at ~$0.01–0.02/video-equivalent, landing in a render library ready to post — no camera, creator, or editor.
- mechanism: UGCdrop + Fable 5: one prompt ("make 10 UGC videos") drives MCP tools to batch-render 10 videos in ~30s, 10–22s render each, into ugcdrop.com/studio; on-screen caption claims "100 UGC with Fable 5 – $1.32" vs "Seedance – $148." Uses your own/other faces to drive social traffic. (Cost + 80%→100% reliability figures are the app's self-report, unverified.)
- source: DcGxs-_NiNA @ 00:24–00:30 (batch prompt), 00:00 (cost caption), 00:33–00:40 (face/traffic use).
- category: feature
- general-merit: Good for a video-content operation — cheap, fast, batchable short-form ad generation is directly monetizable; specific cost/reliability numbers need independent verification.
- kb-fit-hypothesis: faceless-youtube already has an image-gen/shots/forge/voiceover/upload pipeline; a UGC-ad or short-form-promo track (either via a UGCdrop-style MCP or kb's own pipeline) would be a new content format for fyt, or a promo-clip generator for existing videos. Extends fyt.
- build-size: M

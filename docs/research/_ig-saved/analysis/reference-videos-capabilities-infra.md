# Reference videos — capabilities, infrastructure & architecture

_Compiled 2026-08-18 by a deep-analysis subagent. Read-only. Full re-watch of the 4 local mp4s via claude-video-vision (local backend, whisper-cpp small) with the **audio transcripts mined hard**, plus the four `.info.json` captions and the existing UI/UX notes. This doc is the layer under the UI/UX pass: what each system can DO, how it's built/hosted, its architecture — and where kb HAS / PARTIAL / GAPs each element (mapped against `current-state-capability-map.md`)._

Throughout: **[DEMONSTRATED]** = seen working on screen; **[CLAIMED]** = narrated but not shown; **[INFERRED]** = deduced from frames/labels not explicitly narrated.

The four systems fall into two classes:
- **Three live products** — Bennett Spooner's "Bennett OS" (2 videos: 37-agent and 17-agent cuts of the same suite), Sean Purvis's "Sunflow Agentic OS" (6 agents). These are running software.
- **One planning artifact** — Oliver Merrick's "The Climb" (a FigJam maturity-model board). Not runtime software, but its narration is the clearest end-to-end **stack recipe** of the four, and it names the exact folder architecture the others converge on.

The single most important correction to the UI/UX pass: the Bennett OS stack is **three distinct layers that the creator's own narration conflates** — (1) Claude Code headless as the *conductor/brain* (model Fable 5, run headless specifically to bill the subscription not the API), (2) **Paperclip**, an open-source multi-agent *runner* that spawns/commands the worker agents, and (3) **Hermes** (Nous Research), a separate *action/tool-execution gateway* running GLM-5.2. The prior notes recorded only "Hermes = action layer" and missed Paperclip and the headless-for-subscription-billing detail entirely.

---

## System 1 — Bennett OS (Bennett Spooner) — the maximalist build

Two videos, one product: `DbsM7RMBSzo` (37 agents) and `Db7d0pXBaOG` (17 agents / "FounderOS"). Same suite, different screens.

### 1a. Underlying capabilities

| Capability | Status | Evidence |
|---|---|---|
| Headless orchestration — a "Conductor" super-agent delegates to department heads | **[DEMONSTRATED]** | Org-chart with Conductor commanding 5 dept crews; roster "cockpit thread" shows live delegation |
| Multi-agent fan-out — "run as many agents as you want" | **[DEMONSTRATED]** via Paperclip | Transcript: "delegating tasks to the other agents through something called paperclip… open source repo that allows you to run as many agents as you want" |
| Per-agent model routing across vendors | **[DEMONSTRATED]** | Agent runtimes list: claude-fable-5 (running), claude-opus-4-8, claude-sonnet-4-6, claude-haiku-4-5/4-6, "Hermes Gateway", gpt-5.4 (Codex, **error** state) — each with running/idle/paused/error status + "Nh ago" |
| Task board / issue tracker — "give the company a task, the Conductor triages it" | **[DEMONSTRATED]** | Linear-style keys (BEN-25…BEN-40), drag-across-board kanban, "Agents advance their own cards as they complete"; TO-DO cards name the owning agent (Arcads Creative, Gmail Worker, Social Agent, Comms Agent) |
| Knowledge base ingestion + semantic retrieval (RAG) | **[DEMONSTRATED]** | "G-Brain": Obsidian vault, "dump into the brain… or drop documents (text · voice · drag or upload)"; numbers 120 notes / 6 folders / 433→595 wiki-links / 1→8 clusters; radial view is literally the **vector index** ("Along the vector index" label at graph core) |
| Knowledge-graph navigation — click a dept node to re-center, drill to agent→SOP | **[DEMONSTRATED]** | Radial "Optimal Engine": core → dept ring (Sales/Finances/Clients/Comms/TECH/Mktg) → agent leaves → SOP tasks, with `< Back 1/7 Sales >` pager |
| SOP-as-data with autonomy ladder | **[DEMONSTRATED]** | Every workflow detail panel: status (NOT STARTED / IN DEVELOPMENT / READY TO RUN), FULLY AUTONOMOUS badge, "N runnable skill file (download)", "BREAKS INTO" sub-skills, "BUILDS ON" dependency, "WHAT IT REPLACES", "THE LADDER" (Human-led/Human-assisted/Fully-autonomous, each described for *that* job), "THE SOP, WRITTEN OUT" numbered steps, "TOOLS AT THE END OF THE CHAIN" |
| Skill decomposition / build-from-spec | **[DEMONSTRATED]** | e.g. "Confirm payments across processors" → breaks into claim-receiver / api-verifier / audit-writer; "10 mins to build"; downloadable `.skill` files |
| Doc-hygiene as a first-class agent | **[DEMONSTRATED]** | TECH SOP "Audit brain-store markdown health" → Markdown Auditor agent: walk every MD, flag broken wiki-links/orphans/stale frontmatter, check generated org docs still match live agents/SOPs/tools, write per-folder health scores, queue fix-ups. (This is kb's memory/`_index` hygiene, automated.) |
| CRM / funnel / lifecycle tracking | **[DEMONSTRATED]** | Funnel view: connected-bubble chain First Touch→Engaged→Nurtured→Opted-In→Converted with per-stage counts/%, client avatars, "fades red after 21d quiet, archive at 90d" |
| Business finance ingestion (CSV/PDF statements) | **[DEMONSTRATED]** | Finances view: Income/Expenses/Net MTD, Stripe balance, expenses donut, "Income by Processor" cards (Stripe/PayPal/FanBasis×2/Wise×2, Connect→ / awaiting-key), **drag-drop "Drop a credit-card or bank statement (CSV/PDF)"** |
| Live per-integration health telemetry | **[DEMONSTRATED]** | Roster "ACTIVITY" CAST rows: Gmail Worker "OperatorOS: 1295 unread", Payments Pulse "Stripe: $229.23 available", WhatsApp Worker **FAIL** (ChatStorage.sqlite read timed out), Comms Agent "2/3 channels live", Zernio Publisher "0 platforms" |
| Scheduled/cron + persisted monitors | **[DEMONSTRATED]** | Stat tiles "CRON JOBS 8"; Conductor "standing cockpit thread" with "persisted issue monitor (daily check)"; Hermes sidebar has a CRON tab |
| Self-recovery / liveness monitoring | **[DEMONSTRATED]** | Conductor thread: "Recovery check-in… root cause of the recovery loop… registered a persisted issue monitor… first-class continuation path… Cockpit fully stable, no open recovery items" |
| Persona/vertical presets — preload a whole configured OS | **[CLAIMED+DEMONSTRATED]** | "gathered all the agents and skills… put them into personas you can preload into your own OS when you boot it up"; gallery paged 03/11: DTC Brand Operator, Course Creator, Field Service OS — each with North Star metric, pillars, connectors, tracked metrics, mini radial |
| Voice input to the brain | **[CLAIMED]** | "text · voice · drag or upload" affordance shown; voice off in Hermes ("voice off · 2 sessions") |
| Test suite / CI | **[DEMONSTRATED, incidental]** | Claude Code pane: "270 tests failed first run… 692/972 pass", "pre-existing failures", "9 missing API keys — Attio, Zernio, ManyChat, Miro, Arcads, Webinarjam, Trakyo, Meta Ads, Notion" |

### 1b. Infrastructure / stack

- **Conductor runtime:** Claude Code, run **headless** — explicitly "since I wanted to use my subscription and not the API, I have to use headless." Conductor model = **claude-fable-5**. Other workers span claude-opus-4-8 / sonnet-4-6 / haiku-4-5/4-6 and a **Codex (gpt-5.4)** worker → a genuinely mixed Claude-Code + Codex fleet, each worker a "runtime" row.
- **Multi-agent runner:** **Paperclip** (open-source). Frame: "Paperclip has moved to the mini since — which explains why the board key changed"; "the Paperclip connector"; run as a one-line `npx`-style command.
- **Action/tool gateway:** **Hermes-Agent by Nous Research** ("Messenger of the Digital Gods"), **v0.19.1**, model **GLM-5.2**, reasoning Medium. Self-describes "9 tools · 70 skills in 13 categories". Tools: `file: patch/read_file/search_files`, `tool_call/tool_describe`, `terminal: process/terminal`. Full sidebar: Chat · Sessions · Files · Models · Logs · **Cron** · Skills · **Plugins** · **MCP** · **Channels** · **Webhooks** · **Pairing** · Profiles · Config. "Gateway Status: Running." Restart Gateway / Update Hermes controls. This is a full standalone agent-gateway product embedded as one worker type.
- **Knowledge core:** **G-Brain** = an **Obsidian markdown vault** ("the company knowledge brain") + a **vector index** (the radial graph *is* the index) clustered into knowledge domains (sops, Claude Archive, agents, tools, org, people; later Automation/Client-Delivery/Finance/Growth/Ops/Product/Research/Sales-Playbooks). Neural/Radial view toggle. Ingest by text/voice/drag/upload.
- **State store:** **SQLite** — status bar reads `localhost:5100 · sqlite · real agents` (and `:4100` in the other cut). WhatsApp integration reads `ChatStorage.sqlite`.
- **Connectors (named on-screen):** Stripe, PayPal, Square, Shopify, FanBasis, Wise, Attio (CRM), Notion, Slack, WhatsApp, Gmail/IMAP, ManyChat, Arcads (UGC), Miro, Webinarjam, Meta Ads, Zernio/Zernio Publisher, plus infra tools **Supabase**, **Zeroentropy** (retrieval/rerank), **Ollama** (local models), **Remotion** (programmatic video), OpenClaw, Trakyo.
- **Hosting:** **Mac mini, always-on, locally** ("running all of this on my Mac mini completely locally"). Exposed over **Tailscale** as a web app (`bennett-os-mac-mini.tail090dce.ts.net:3100/BEN/…`), reached from a MacBook / iPhone "anywhere in the world." Mentions Claude Code cloud tasks ("Run tasks in the cloud while you keep coding locally") and a tunnel tool (VibeTunnel-style).
- **Frontend:** custom dark-navy SPA; sidebar IA Operate / Agents / Intelligence / System / Variants.

### 1c. Architecture sketch

```
Operator (Bennett)
   │  paste a goal / "give the company a task"
   ▼
CONDUCTOR  = Claude Code headless, model Fable-5  ── standing "cockpit thread" + persisted daily monitor (self-recovery)
   │  delegates via PAPERCLIP (open-source multi-agent runner)
   ▼
Department heads (Comms/Sales/Finances/Clients/Mktg/TECH) → named worker agents (Claude/Codex runtimes)
   │                                             │ each worker calls tools through …
   │                                             ▼
   │                              HERMES gateway (Nous Research, GLM-5.2)
   │                              file/terminal/tool-call + 70 skills + Cron/Webhooks/MCP/Channels
   ▼                                             │
Work surfaces: Task board (BEN-xx), Funnel/CRM, Finances (statement ingest), Social
   │                                             ▼
   └──────────── all read/write ────────► G-BRAIN (Obsidian vault + vector index) — RAG core
State: SQLite · Host: Mac mini always-on · Access: Tailscale web app
```
HITL is expressed *per workflow* (the Ladder: human-led→assisted→autonomous) + a live health strip that fails loud (WhatsApp FAIL, missing API keys).

---

## System 2 — Sunflow Agentic OS (Sean Purvis) — the minimalist, VPS-hosted build

`DZEzQ7XxFEP`. 6 agents. Same dark-dashboard genre, much smaller and cleaner.

### 2a. Capabilities
- **Orchestrator routing** [DEMONSTRATED]: "CEO/Orchestrator, COMMAND LAYER" routes work to 5 specialists; stat pair ROUTES 28 / TASKS 63.
- **Autonomous multi-step morning workflow** [CLAIMED, narrated in detail]: CMO agent at 7am pulled top-3 competitor reels/24h → analyzed hook structure → 8am scripted 3 new reels in the operator's voice → cross-referenced last week's top content for zero overlap → flagged 2 untapped competitor angles → delivered 3 ready-to-film scripts. "No brief, no direction, no back-and-forth."
- **Per-agent multi-model routing** [DEMONSTRATED]: CEO gpt-5.1, Researcher gemini-2.5-pro, CMO claude-sonnet-4, Sales Rep claude-sonnet-4, Dev gpt-5.1, Data Analyst gemini-2.5-pro — model badge on every card.
- **Chat-to-agent** [DEMONSTRATED]: "Talk to CMO like a normal chat… It **runs the selected Hermes profile locally** and shows the reply here" → Sunflow *also* runs on Hermes. Tab-switch re-scopes the directive panel.
- **Task board (kanban)** [DEMONSTRATED]: "Three-column operator queue **backed by local board.db**"; cards include "Audit cron cleanup coverage", "Confirm gateway platform health / Verify Discord and Telegram are connected after restarts", "Verify Hermes **read-only data policy** — all Hermes SQLite reads use read-only and query_only".
- **Cron/cadence** [DEMONSTRATED]: "Cron and cadence — **Read-only VPS schedule**, grouped by ownership." AGENT JOBS: "Syncs and backs up the knowledge vault — every 5 min"; "Cleans up old activity logs — 1st of month 3:00 AM". SYSTEM JOBS: "Publishes scheduled marketing workflow content — every 30 min".
- **Approval queue** [DEMONSTRATED]: dedicated "NEEDS REVIEW" panel — "Approval queue is clear. CMO posts and Sales Rep emails still here since your sources are wired."
- **System-health telemetry** [DEMONSTRATED]: SYS HEALTH CPU/RAM/Disk bars + "AGENT DB: 45.56 MB".
- **KPI tiles with data-source trace** [DEMONSTRATED]: Posts 12 / Active Leads 38 / Calls Booked 7 / Follow-up Emails 54, each with "placeholder source →".
- **Self-improvement** [CLAIMED]: "hosted in the back-end structure that keeps them self-improving continuously."
- **Knowledge Vault** [DEMONSTRATED as nav item]: sidebar "Knowledge Vault", "Syncs and backs up the knowledge vault" cron.

### 2b. Infra / stack
- **Runtime:** **Hermes profiles** (same Nous Research gateway as Bennett), "runs locally"; agents wrap gpt-5.1 / gemini-2.5-pro / claude-sonnet-4.
- **State:** **SQLite** — `local board.db` for the task queue; "Agent DB" 45.56 MB; explicit "Hermes SQLite reads use read-only / query_only" policy.
- **Hosting:** a **VPS** ("Read-only VPS schedule") — *not* a Mac mini. Cron-driven.
- **Comms channels:** **Discord and Telegram** ("Verify Discord and Telegram are connected after restarts").
- **Frontend:** dark SPA — Command Center / Agents / Tasks / Schedule / Lead Pipeline / Content / Knowledge Vault. Header "Agentic System Operational".

### 2c. Architecture sketch
```
Operator ──▶ CEO/Orchestrator (gpt-5.1, COMMAND LAYER, routes)
                 ├─ Researcher (gemini-2.5-pro)   ┐
                 ├─ CMO (claude-sonnet-4)         │ each = a Hermes profile run locally
                 ├─ Sales Rep (claude-sonnet-4)   │ tools + SQLite (read-only policy)
                 ├─ Dev (gpt-5.1)                 │
                 └─ Data Analyst (gemini-2.5-pro) ┘
Task queue: board.db (Pending/In-Progress/Done) · Approvals: NEEDS REVIEW panel
Cadence: VPS cron (agent jobs + system jobs) · Channels: Discord/Telegram
Knowledge Vault (synced/backed-up every 5 min) · Host: VPS · Health: CPU/RAM/Disk
```

---

## System 3 — "The Climb" (Oliver Merrick / MEZ) — the maturity model + the canonical folder recipe

`DbyA5hlSvI7`. A FigJam board, not runtime software — but the richest **build recipe**, and the caption is a full written spec. Browser-tab strip shows it's one of many boards (CRSLs, Claude Code Carousels, MEZ Digital Products, etc.).

### 3a. Capabilities (as a *method*, staged)
Five phases on a rising line, each a role + exit criterion ("Graduate when…") + moves + proof checklist + phase diagram:
1. **Context** (role OPERATOR) — "AI knows your business cold." Build the brain: every SOP/offer/rule/decision in one store; Claude reads all before answering. Graduate when: answers in your voice from your real docs.
2. **Execution** (role WORKER) — "AI does the work, wired into real tools." YOU ASK → **Claude Code (the worker, with hands)** → DONE, with a DRAFT→REVIEW branch. Graduate when: one task done end-to-end in a real system, no copy-paste.
3. **Delegation** (MANAGER) — "AI owns whole jobs." One agent per department (CFO/CMO/CRO…), each own instructions/tools/checklist. "Runs on Claude Code."
4. **Autonomy** (ARCHITECT) — "It runs without you. It triggers itself." Moves: heartbeat schedule; swap trigger for event (calendar booking / new lead / new sale); move to always-on (Make or Mac mini 24/7); **guardrail-first (a pass/fail check, a failure alert, a safe stop)**. Graduate when: first always-on self-triggering workflow is live.
5. **Compound** — "One factory. Many products. Wire the pipeline once; each new run costs nothing." GATHER→REASON→ASSEMBLE→PRODUCE with MEMORY=Notion; point it at Data + a Goal + Your rules.

### 3b. Infra / stack (explicitly narrated)
- **Second brain:** "Notion, Obsidian, **local MD files**, whatever — everything about you and your business… your AI of choice, Claude or Codex, plugs into that." (Notion named as the single source of truth in the diagrams.)
- **Runtime:** "**Claude Code as my daily driver, like a personal operating system**"; "a Mac mini that runs **a Hermes agent or open core**"; "runs on Claude Code **or Codex**."
- **The canonical workspace** [the pattern all four converge on] — *one folder Claude Code reads and writes*:
  ```
  YOUR WORKSPACE/
    CLAUDE.md            ← one file that understands how everything works
    departments/         ← cfo · cmo · cro · cdo · cos (each: own system instructions, tools, way of thinking)
    skills/              ← "the moves it can run"
    data/ - repos/       ← projects and code   (e.g. post_render.py, organic_jobs.json)
  ```
- **Autonomy mechanisms:** Mac-mini **heartbeat** every 20–30 min; **Claude Code / Codex scheduled tasks**; **event triggers** (calendar/sale/email → mapped workflow → agent executes). Guardrail: pass→write / fail→alert / on-pause.
- **Method root:** explicitly "based on how Elon Musk runs SpaceX/Tesla" — the audit-delete-simplify-then-automate algorithm (agents last, not first).

### 3c. Architecture sketch — this *is* essentially kb's own shape
```
CLAUDE.md (constitution) ─▶ departments/ (specialist system-prompts) ─▶ skills/ (runnable moves) ─▶ data|repos/
                                     ▲                                                    │
Second brain (Notion/Obsidian/MD) ──┘  read before acting (context-first)                │
Autonomy: heartbeat / scheduled tasks / event triggers ─▶ workflow ─▶ agent ─▶ guardrail(pass→write, fail→alert)
```

---

## Cross-system mapping table — capability/infra → who has it → kb equivalent

| Capability / infra element | Bennett OS | Sunflow | The Climb | **kb status** | kb file / subsystem |
|---|:--:|:--:|:--:|:--:|---|
| Headless orchestrator delegating to specialists | ✅ | ✅ | ✅(method) | **HAVE** | boss session + Agent tool subagents; `dispatch-codex`; `queue/` cards |
| Multi-agent fan-out runner | ✅ Paperclip | ✅ Hermes profiles | ✅ | **HAVE** (own mechanism) | card DAGs (parallel/pipeline/variant), control-plane `dashboard/server/control/` |
| Per-agent model routing (multi-vendor) | ✅ Claude+Codex | ✅ Claude+GPT+Gemini | ✅ Claude/Codex | **PARTIAL** | governance model defaults + ops overrides; **Claude+Codex only, no Gemini/GLM runtime**; model badge not surfaced on cards |
| Autonomy tiering | ✅ per-workflow Ladder | ✅ approval gate | ✅ per-phase | **HAVE (global), GAP (per-workflow visual)** | `governance/risk-tiers.md` T1–T4 — global policy, not a per-card visual ladder |
| **Vector / semantic KB retrieval (RAG)** | ✅ G-Brain vector index + Zeroentropy | ✅ Knowledge Vault | ✅ (Notion/embeddable) | **GAP** | kb is markdown + grep/Read only — `_index.md`, `memory/`, `MEMORY.md`, `orgs/`; **no embeddings/vector store/semantic search** |
| KB ingestion UX (drop docs / voice / drag) | ✅ | ✅ vault sync | ✅ | **GAP** | manual file writes; no ingest surface |
| Doc-hygiene auditor as an agent | ✅ Markdown Auditor SOP | ✅ vault backup | ➖ | **PARTIAL** | manual memory/`_index` discipline + `sync_daemon_dirs.py` (drift check); not an autonomous auditor |
| Task board / issue tracker | ✅ BEN-xx kanban | ✅ board.db kanban | ➖ | **PARTIAL** | `queue/` cards (markdown, git) + dashboard `Tasks.tsx`/`Pipeline.tsx`; not a drag kanban |
| Approval / HITL queue | ✅ health strip | ✅ NEEDS REVIEW | ✅ guardrail | **HAVE (ahead)** | `queue/approvals/`, **WebAuthn-signed T3**, `Approvals*.tsx` |
| SOP-as-data + "runnable skill file" packaging | ✅ | ➖ | ✅ skills/ | **PARTIAL** | `workflows/*.md`, skills — no download/"breaks-into"/build-estimate packaging |
| Skill decomposition / build-from-spec | ✅ | ➖ | ✅ | **HAVE** | skills + `skill-creator`; loop-design-check |
| Visual agent graph (org-chart / radial) | ✅ both | ✅ mini | ✅ org chart | **PARTIAL** | `WorkflowAgentGraph.tsx`/`WorkflowDetail.tsx` — graph exists; **no radial constellation, no fleet org-chart** |
| Scheduled / cron / heartbeat | ✅ cron+monitor | ✅ VPS cron | ✅ heartbeat | **HAVE** | `HEARTBEAT.md` cadences via single dispatcher Routine; daemon |
| **Real-world event triggers (webhook: sale/email/booking → workflow)** | ➖(channels) | ✅ Discord/TG | ✅ | **GAP** | kb is card+cron driven; no event→workflow trigger bus |
| Live per-integration health telemetry | ✅ CAST rows | ✅ SYS HEALTH | ➖ | **PARTIAL** | ledgers + `dashboards/executive.md` + timeline stream; no one-line-per-integration health strip / CPU-RAM-Disk panel |
| Cost / usage ledgering | ➖(finance) | ➖ | ➖ | **HAVE (ahead)** | `ledgers/{cost,activity,audit,dispatch,grades}`, `budget.yaml`, preamble gate |
| **Business connectors** (CRM/payments/ads/comms) | ✅ Stripe/Attio/Shopify/Meta/… | ✅ Discord/TG | ➖ | **GAP** | kb MCPs = Gmail/Drive/YouTube/browser only — **no CRM, payments, ads, Slack/WhatsApp/ManyChat** |
| **Business finance ingestion (CSV/PDF statements)** | ✅ drag-drop | ➖ | ➖ | **GAP** | cost ledgers ≠ business finance; no statement ingest |
| **CRM / funnel / lifecycle tracking** | ✅ bubble funnel | ✅ Lead Pipeline | ➖ | **GAP** | none |
| Persona / vertical presets | ✅ 11 personas | ➖ | ➖ | **GAP** | `orgs/<project>/` are hand-built, not preloadable templates |
| Independent grading / trust loop | ➖ | ➖(self-improve claimed) | ➖ | **HAVE (ahead)** | `governance/graders.yaml` + Inspector skill → `ledgers/grades/` |
| Governed control plane + managed worktrees | ➖ | ➖ | ➖ | **HAVE (far ahead)** | `dashboard/server/control/` reconciler, `AppData/…/control/worktrees/` |
| Immutable VM deploy + rollback + backup | ➖ Mac mini | ➖ VPS | ➖ Mac mini/Make | **HAVE (ahead)** | `deploy/bootstrap_vm.py`, `activate_release.py`, `export_tier0.py`, systemd unit; Gate-1/2 ceremonies |
| Always-on remote host | ✅ Mac mini + Tailscale | ✅ VPS | ✅ Mac mini | **HAVE** | Hetzner CCX23 pilot on tailnet + governed VM cutover (in-flight) |
| State store | SQLite | SQLite | Notion/MD | **DIFFERENT** | git + markdown + ledgers (auditable, versioned) — arguably better provenance, weaker query |

Legend: ✅ present · ➖ not shown/N-A.

---

## Synthesis — what kb LACKS, and where kb is AHEAD

### The real build signal — capability/infra gaps kb should weigh (not UI)

1. **Semantic knowledge retrieval (RAG) is the standout gap.** All three live systems put a *queryable brain* at the literal center: G-Brain's Obsidian-vault-plus-vector-index (with Zeroentropy for rerank, "clustered into the domains the OS reasons over"), Sunflow's synced Knowledge Vault, The Climb's Notion/embeddable brain. kb's "brain" is real and disciplined (`_index.md`, `memory/`, `MEMORY.md`, `orgs/*/STATE.md`) but is **read/grep only — no embeddings, no vector store, no semantic search**. Every one of these operators treats "feed the model your real docs, retrievably, before it acts" as step one ("Context beats cleverness"). This is the highest-leverage infra kb is missing, and it sits directly under the "one shared brain" idea Daniel is circling.

2. **Business-domain connectors and surfaces.** kb's connector set is engineering/content (Gmail, Drive, YouTube, Chrome, Playwright, codex). The reference systems are wired to the *business*: Stripe/PayPal/Wise/FanBasis (payments), Attio (CRM), Shopify/Klaviyo/Meta/TikTok (commerce/ads), Slack/WhatsApp/ManyChat/Discord/Telegram (comms). Downstream of that they render **CRM funnels, finance ingestion (drag-drop CSV/PDF statements), and social analytics** — entire capability areas kb has none of. If kb is to "run a company," these are the missing hands.

3. **Real-world event triggers.** The autonomy model in all three is *event-driven*: a new sale, a calendar booking, an inbound email fires a mapped workflow (plus heartbeat/cron as the floor). kb autonomy is **cron + card** only — there's no webhook/event bus turning an external signal into a dispatched card. The Climb names this as the specific "Graduate to Autonomy" move; kb sits at "heartbeat" but not "swap trigger for event."

4. **A knowledge-ingestion + doc-hygiene loop.** "Drop documents / dump into the brain (text·voice·drag)" plus an autonomous **Markdown Auditor** (broken wiki-links, orphan notes, stale frontmatter, "do generated org docs still match live agents/SOPs/tools?", per-folder health scores). kb does this hygiene *by hand* via memory discipline and the drift-check script — a natural thing to make a first-class recurring agent.

5. **Multi-vendor worker runtimes.** Sunflow routes to Gemini and GPT alongside Claude; Bennett runs GLM-5.2 inside Hermes and a Codex worker. kb is Claude + Codex. Not obviously a gap (kb's model law is deliberate), but worth a conscious decision rather than an omission.

6. **Packaging & presets** (secondary): "runnable skill file" downloads, "breaks-into" sub-skill graphs with build-time estimates, and preloadable **persona/vertical templates**. kb's `orgs/<project>/` are bespoke; there's no template-instantiation path.

### Where kb is clearly AHEAD (do not regress these to chase the demos)

- **Governed execution control plane + reconciler + managed worktrees** — none of the four has anything close; they are single-operator apps with a SQLite board. kb has a real state machine materializing per-attempt worktrees.
- **WebAuthn-signed, fail-closed HITL** — their "approvals" are a review panel and a health strip; kb requires a passkey-signed token for T3 and 401s all pre-auth reads.
- **Immutable VM deploy with release artifacts, rollback, Tier-0 backup, and human cutover ceremonies** — they run on an always-on Mac mini / VPS with cron; kb has a deployment discipline an order of magnitude more robust.
- **Independent grading / inspector trust loop** — Sunflow only *claims* "self-improving"; kb actually has fresh-context grading writing to `ledgers/grades/`, decoupled from the agent that did the work.
- **Git-native, versioned, auditable state** — their state is mutable SQLite; kb's work products, coordination, and ledgers are all git history with provenance. Weaker at ad-hoc query, far stronger at audit and recovery.
- **Budget gate + no-real-money + risk-tier ceilings** — hard governance the demos have no equivalent of.

### One-line reading
These are **breadth-first business-operator OSes** (many connectors, a retrievable brain, event-driven autonomy, thin governance) sitting on a Mac-mini/VPS + SQLite substrate. kb is a **depth-first governed-engineering control plane** (strong governance, grading, VM deploy, git provenance) that is *missing the retrievable brain, the business connectors, and event triggers* the demos lead with. The highest-value, lowest-regret borrow is a **semantic retrieval layer over the existing kb corpus** — it's the piece all three center on and the one kb most lacks, and it doesn't threaten any of kb's governance advantages.

_Note on shape: The Climb's `CLAUDE.md + departments/ + skills/ + data/` workspace is almost exactly kb's own `CLAUDE.md + orgs/ + skills/ + ledgers|queue/` layout — kb already embodies the architecture these creators are selling as the destination. The gap is not structure; it's the brain, the connectors, and the triggers hung off it._

# Gap analysis — the four IG agent-OS reels vs. our shipped Wave-1 Agent Platform

**Question this answers (new, not a re-transcription):** what do Bennett OS / Optimal Engine / The Climb / Sunflow *do* and *show* that our 10 shipped panels don't — and why do their screens read at a glance while Daniel's live verdict on ours is "all over the place, can't tell what works, what connects to what."

**Method:** re-watched all four reels frame-by-frame (frames extracted at 0.2–0.45 fps, 1400–1500px). The shot-by-shot transcriptions already exist in `docs/research/_ig-saved/notes/uiux-*.md` and `uiux-inspiration-summary.md`; this doc does not repeat them. Our side read from `MORNING-REPORT.md`, `dashboard/src/views/AgentPlatform.tsx`, `dashboard/src/views/agentPlatform/{registry,types}.ts`, all ten `panels/*.panel.tsx`, `dashboard/src/nav/config.ts`, `dashboard/src/styles/app.css`, `dashboard/src/styles/views/agentPlatform.css`.

---

## 0. Verdict in one paragraph

Their systems are **shallower than ours and read better**, and those two facts are causally unrelated. Feature-for-feature we ship things none of them have (earned-vs-declared autonomy from a real grade ledger, transcript-verified model audit, a three-state step check, a dry-run hygiene sweep, offline semantic index). What they have and we don't is a **reading order**: every screen states its own thesis in one sentence, one status vocabulary is repeated everywhere including the entry surface, the hierarchy is drawn rather than listed, and a persistent global health fact sits in the chrome. Our section's entry surface — `AgentPlatform.tsx` lines 49–61 — is a flat grid of ten identical text buttons: title, one-line description, no status, no number, no relationship, no grouping, no thesis. Every panel behind it is individually good and collectively unreadable, because the grid tells you nothing about which of the ten to open, what state anything is in, or that Fleet Graph and Agent Management are two views of the same roster. That is exactly what "all over the place" means, and it is a ~200-line problem, not a rebuild.

---

## 1. FUNCTIONALITY — feature by feature

### 1a. What they do on screen that we don't

| Their feature | Where seen | Our nearest thing | Gap |
|---|---|---|---|
| **Persistent global health fact in the chrome** — Sunflow: `● Agentic System Operational` + a live uptime clock top-right on *every* screen; Bennett OS: footer `16/22 systems live · localhost:4100 · sqlite · real agents` and `COST & RUNTIME $4.31 ESTIMATED` | DZEz 00:31/00:37, Dbs 00:26/00:42 | none | **Total.** Nothing in the Agent Platform section says "the fleet is fine / N of M live" without opening a panel. |
| **Persistent agent roster in the sidebar with status chips** — Sunflow repeats the same 6 agents + `working/waiting/idle` chip on every screen | DZEz all frames | `AgentManagement.panel.tsx` (only inside the panel) | The cast disappears the moment you leave the roster panel. |
| **Per-screen thesis line** — small-caps kicker + bold title + one sentence on what the screen is FOR: "Growth operations dashboard. / Business outcomes first, with live agent telemetry supporting operator decisions."; "Task board. / Three-column operator queue backed by local board.db." | DZEz 00:09, 00:31 | `panel.description` exists but is only shown on the *closed* tile (`AgentPlatform.tsx:58`), never inside the opened panel | We drop the one sentence explaining the panel at the exact moment the user is in it. |
| **Org hierarchy drawn with status + model on each node** — Bennett's org chart puts `● IDLE claude-fable-5`, `● ERROR gpt-5.4` inline on each department card header, plus a color-dot legend strip across the top | Dbs 00:02 | `FleetGraph.panel.tsx` draws nodes with a status dot (:95) and `ModelBadge` in the *inspector only* (:312) | Our graph nodes carry a dot but not the model; the graph has no legend for node color, only for edges (:299–303). |
| **Approval queue as a first-class panel next to activity, with a count chip and a stated reason** — `NEEDS REVIEW / 0 open / "Approval queue is clear. CMO posts and Sales Rep emails will appear here once sources are wired."` | DZEz 00:12–00:28 | Dashboard `Inbox` nav entry (`nav/config.ts:85`) — outside the section | Agent Platform has no "what needs Daniel" surface at all. Ten read-only panels, zero call-to-action. |
| **Context-window meter per agent** — `CONTEXT WINDOW / DEV / 31 TASKS / [segmented bar] / Last status: …` | DZEz 00:09, 00:37 | `ContextLifecycle.panel.tsx` shows store *contents* (:60–62), not consumption | We built the context store; we never visualize pressure. This is the natural home for U8's data. |
| **Run/telemetry counter strip** — `INTEGRITY 100.00% · AGENT CALLS 63 · MESSAGES 3,247 · TOKENS IN 6,616,706 · ERRORS 0` | DZEz 00:09 | none in the section | No aggregate anywhere. Every panel is a list; nothing is a number. |
| **Paired 14-day stacked-bar trends** — Run Activity (Succeeded/Recovered/Failed/Other) + Tasks by Priority | Dbs 00:11 | none | No trend of anything. All ten panels are point-in-time. |
| **Knowledge base gets a stats block + hero graph, not just a search box** — `THE BRAIN IN NUMBERS: 120 NOTES / 6 FOLDERS / 433 WIKI-LINKS / 1 CLUSTERS`, `~102k words across 120 distilled notes`, `KNOWLEDGE DOMAINS` bar chart, `MOST-LINKED NOTES`, `Radial ⇄ Neural` toggle | Dbs 00:46–00:48 | `BrainSearch.panel.tsx` is a form + result list (113 lines total) | We indexed 130 files / ~4400 chunks (`MORNING-REPORT.md` U1) and show **none of it**. The panel can't answer "what's in the brain" — only "find X". Cheapest high-impact win in the whole doc. |
| **Cron/schedule in plain English first** — `Runs every 30 minutes · next in 12 minutes`, with raw cron + source command as small mono metadata below; `SYSTEM JOBS (11)` count chip | DZEz 00:34 | none | We have HEARTBEAT cadences and nothing renders them. |
| **Task board with column counts + priority chips + per-card move controls** — `PENDING 3 / IN PROGRESS 2 / DONE 3`, `HIGH/MEDIUM/LOW` | DZEz 00:31 | queue cards live on ops, unrendered | Our card model maps onto this exactly and is invisible in this section. |
| **Per-agent chat re-scoping a shared panel** — one directive panel, six agent tabs | DZEz 00:18–00:21 | none (read-only section by design) | Deliberate, but it's why their demo feels like a cockpit and ours like a report. |
| **Workflow detail with a fixed field order** — `FULLY AUTONOMOUS` + `READY TO RUN` status, one-line invariant, `1 runnable skill file`, `BREAKS INTO` chips, `BUILDS ON`, `WHAT IT REPLACES`, `THE LADDER` (3 rows of workflow-specific prose), `THE HUMAN` | Dbs 01:00/01:04 | `AgentManagement.panel.tsx:169–244` renders the six U3 schema fields, `FleetGraph.panel.tsx:329–333` renders `replaces` + `builds on` | We have the *fields*. We split them across two panels and never render the ladder rungs as prose. See §4-P5. |
| **Numbered maturity spine with falsifiable exit criteria** — The Climb: 6 stage cards, identical template, `Graduate when: one task is done end to end inside a real system.` + `PROOF YOU'RE HERE` 2-item checklist + a named 3–5-box diagram + a `REMEMBER` maxim | DbyA 00:20–02:25 | `AutonomyLadder.panel.tsx` shows earned tiers as a table | Our ladder has no rungs written down and no "graduate when". |

### 1b. What we do that none of them do

Worth stating, because the reframe must not sand these off:

- **Earned vs. declared autonomy, computed from a real grade ledger** (`AutonomyLadder.panel.tsx`, U5, promotion.py port, 0/4000 fuzz mismatches). Bennett's "THE LADDER" is *hand-written prose per workflow* — it is documentation, not a computation. Ours is a verdict. Nobody else has this.
- **Model audit against observed transcript reality** (`ModelAudit.panel.tsx:81–100`, requested vs. observed vs. also-seen). Sunflow *displays* a model per agent; nobody *verifies* it. This is the single most differentiated thing we shipped.
- **Three-state step check** (`RunEnvelope.panel.tsx:82–84`: pass / fail / **not-evaluated**). Every reel's status vocabulary is binary-optimistic. `not-evaluated` as a first-class chip is a genuine honesty advantage.
- **Honest empty and unavailable states everywhere** — `FleetGraph.panel.tsx:374–379` explains *why* there are no edges rather than showing an empty canvas; `AgentManagement` splits declared vs. observed identities; `BrainSearch.panel.tsx:81` admits the 10–20s model reload. Sunflow's equivalent is `placeholder source —` under every KPI (honest, but cruder).
- **Dry-run-only mutation surface** (`HygieneReport.panel.tsx:21` DRY-RUN banner; `ProposedLessons.panel.tsx:36` "candidate ADDs only"). Their systems write.
- **Exhaustive paged tool tallies that never fake a zero** (`watchAgentsRun/WatchAgentsRunBody.tsx:29–33`: `called ≥N tools` when bounded out). Bennett shows `called 2 tools` with no provenance.

---

## 2. INFRASTRUCTURE — what's real, what's staged, what we have and lack

### 2a. Honest read on what's real in the reels

**Real (evidence on screen):**
- Bennett OS runs over Tailscale — the status bar reads `mac-mini.tail090dce.ts.net:3100/BEN/agents/sales` (Dbs 00:15/00:17) and a footer `localhost:4100 · sqlite · real agents`. A Mac mini is physically shown (00:55). Claude Code is visibly running `/compact` at 27% in a real terminal (00:55).
- Real failures are on screen and not hidden: `WhatsApp Worker FAIL ChatStorage.sqlite found but the read timed out. Likely permissions: grant Full Disk Access`, `TECH ● ERROR gpt-5.4`, `Zernio Publisher 0 platforms · 0 total followers`, `gpt-5.4 Codex … error 9h ago`. Nobody fakes a "0 followers" line. The activity strip is reading live integrations.
- Sunflow's Schedule tab shows real `docker exec -e CLIENT=… node /app/scripts/…` source commands and `/etc/cron.hourly` entries; the Task board says "backed by local board.db"; the Agent Log rows carry the actual executing model (`openai-codex/gpt-5.5`). That is a real cron + sqlite host.

**Staged or thin:**
- **Sunflow's business KPIs are labeled `placeholder source —`** under all four tiles (Posts This Week 12 / Active Leads 38 / Calls Booked 7 / Follow-ups 54). They are admitted mock. So is much of the `INTEGRITY 100.00%` strip — an integrity metric with no definition.
- **Sunflow's entire Activity feed is the dashboard building itself** — "Renamed Orchestrator UI to CEO labels", "reverted radar visual to 2D SVG with initials", "replaced flat radar with CSS 3D holographic radar". The five "specialist agents" have, on the evidence, done no business work; the only agent with output is `DEV`, and its output is the demo. The org is a shell around one coding agent.
- **Bennett's radial "particle core"** (Dbs 00:33–00:48) is a force-directed blob whose individual dots carry no readable label at that zoom. It is a hero visual, not information. Same for Sunflow's mini "radar" on the Command Center — decorative.
- **The Personas gallery (11 variants) is a template catalogue**, not 11 running tenants — one operator cannot be running a DTC brand, a real-estate team and a field-service OS simultaneously.
- **`COST & RUNTIME $4.31 ESTIMATED`** — "estimated" is doing heavy lifting; no ledger is shown.
- The Climb is explicitly not software: it's a FigJam board.

### 2b. Plumbing they imply that we have

We are *ahead* on almost all of it:

| Implied capability | Ours |
|---|---|
| Live run state pushed to the UI | Real SSE + debounced refresh — `WatchAgentsRunBody.tsx:67`, `WATCH_REFRESH_DEBOUNCE_MS`/`MAX_WAIT_MS`, `useSse` |
| Governed read routes | 5 serial-wired read routes (`/api/agents`, `/api/dag`, `/api/trace`, `/api/model-audit`, `/api/context-lifecycle`, `/api/brain/search`, `/api/panels/autonomy-ladder`, `/api/hygiene/report`, `/api/lessons/proposals`) behind the unlock gate |
| Agent registry with roles/tools/lineage | U3 six-field advisory schema on the existing roster loader, lossless over 8 live agents |
| Local knowledge index | U1 offline-enforced all-MiniLM-L6-v2, 130 files / ~4400 chunks, offline-bypass caught and fixed |
| Session/transcript store | 252 real transcripts on this machine, run envelope reads them |
| Cost ledger | `ledgers/cost/*` + `governance/budget.yaml` daily guard — better than "$4.31 estimated" |
| Zero-edit extensibility | `registry.ts` glob — drop a `*.panel.tsx`, no shared-file edit. None of them show anything like this. |

### 2c. Plumbing they have (or fake) that we lack

1. **A section-level aggregate/health endpoint.** Every panel fetches its own thing; nothing computes "N agents, M running, K findings, index age, last run". Their global chip needs one cheap rollup. **This is the one genuinely missing route.**
2. **Anything writing `## North star` / `## Invariants` / `## Current gate` into the context stores.** `MORNING-REPORT.md` decision-note 2 flags this: the U7/U9 injection seam is a format capability awaiting a writer. Sunflow's `CURRENT DIRECTIVE` is exactly that surface, populated. We built the socket and no plug.
3. **A time series of anything.** No run-outcome history, no priority mix, no index-freshness trend. Their 14-day stacked bars need a daily rollup we don't keep.
4. **A rendered queue/board.** Our cards live on ops and never reach this section. Sunflow's 3-column board is 60 lines of UI over data we already have.
5. **A schedule/cadence reader.** HEARTBEAT cadences exist; nothing renders "next in 12 minutes".
6. **Panel-to-panel navigation.** `types.ts:34` — `render: () => React.JSX.Element` takes no nav callback; `MORNING-REPORT.md` decision-note 9 records this as deliberately deferred. It is the reason nothing in our section can link to anything else, which is a large share of "what connects to what".
7. **A persistent brain sidecar.** 10–20s/query spawn cost (decision-note 6) makes Brain Search unusable as a *browsing* surface — which is why we shipped a search box instead of a brain overview. Fix the runtime and the overview becomes possible.

---

## 3. UI/UX — what makes their screens read, and where ours falls down

### 3a. The mechanics that do the work

1. **Kicker / title / thesis, every screen, same three lines.** `AGENT NETWORK` → *"One command brain coordinating five specialist agent roles."* You know what you're looking at before you look at anything.
2. **A status vocabulary of exactly three words, everywhere.** `working / waiting / idle` — same three chips in the sidebar roster, the card header, and the chat tab bar, in the same three colors, on every screen. Bennett's is `RUNNING / IDLE / ERROR / FAIL / paused`. Small closed sets, never mixed with other chip types.
3. **One hero visual per screen, and only one.** Agents = the hierarchy. Command Center = the directive + health. Tasks = the board. Schedule = the list. Nothing competes.
4. **The chrome never changes.** Sidebar + roster + global health chip are constant; only the main pane swaps. You are never disoriented, so every screen inherits the previous screen's context for free.
5. **Progressive reveal with preserved context.** Bennett's radial: click a department → it re-centers with a breadcrumb pill and a `< Communications >` pager; click a leaf → a detail panel *slides over* the graph instead of navigating away. You can always see where you were.
6. **Plain language first, machine detail second.** `Runs every 30 minutes · next in 12 minutes` in white; `CRON */30 * * * *` and the docker command in small grey mono underneath. Never the reverse.
7. **Counts on every section header.** `SYSTEM JOBS (11)`, `PENDING 3`, `LAST 50`, `0 open`, `10 agents`. You can size a section before reading it.
8. **The Climb's repetition trick.** Six stage cards, *identical* template (role pill, big stage number, name, one-line thesis, `Graduate when:`, `THE MOVES` 1–4, `PROOF YOU'RE HERE` ✓✓, one named 3–5-box diagram, `REMEMBER` maxim). Learn card 01 and you can read cards 02–05 at a glance. Legibility from redundancy, not from minimalism.
9. **Every embedded diagram is tiny, named and single-purpose.** `THE CLEAN-UP` (5 boxes), `THE WORKFLOW` (4 boxes), `UNDER THE HOOD` (folder tree), `WHAT YOU POINT IT AT` (3 inputs → 1 system). Never one master diagram at five zoom levels.

### 3b. Where ours falls down — specifically

Taking Daniel's live critique as ground truth, here is the mechanical cause of each complaint.

**"All over the place."**
- The entry surface is ten identical buttons (`AgentPlatform.tsx:49–61`), sorted by a curated `order` (10,20,…,100) that is invisible to the reader. Nothing groups them. The `order` field's own doc comment (`types.ts:16–27`) explains the intended reading arc — *what is running now, then who is allowed to do what, then the read-only forensics* — and the UI renders none of that grouping. **The narrative exists in a code comment and not on the screen.**
- The section header (`AgentPlatform.tsx:31–33`) says "Panels register themselves by file drop — one file per panel, no shared file edited." That is a note to *developers* occupying the one slot that should hold the thesis for *operators*.
- Ten panels is above the glance limit for an ungrouped grid. Their sidebars run 5–7 items with dividers.

**"Can't tell what works."**
- Tiles carry **no state at all** — no dot, no count, no "3 findings", no "index 2h old", no "no data". You must open all ten to learn that (on this worktree) Fleet Graph has zero edges, the ladder has an empty ledger, and Hygiene has exactly 3 findings.
- The status vocabulary is real and shared (`app.css:1056–1085`, `.mc-status-dot--running/done/waiting/blocked/error/idle`) and is used by only **4 of 10** panels: `AgentManagement` (:139,:375,:412), `FleetGraph` (:95), `RunEnvelope` (:75–77,:238), `WatchAgentsRun` (:336,:370). `ModelAudit`, `ContextLifecycle`, `BrainSearch`, `HygieneReport`, `ProposedLessons` express state as **prose paragraphs** (`ap-*__status`, `ap-*__note`, `ap-*__empty`). Same information, five different visual encodings.
- `--status-running` and `--status-done` are deliberately the same green (`app.css:146–147`) — a ruled decision — and `--status-dot--waiting` amber is emitted by exactly one file *outside* this section (`entity/EntityDetail.tsx:206`). So inside Agent Platform there are effectively two colors: green and grey. `MORNING-REPORT.md` decision-note 4 already flags this as wire-or-delete.
- `ModelBadge` reaches 3 of the 4 surfaces that could carry it; the tile grid and the graph nodes carry none.

**"Can't tell what connects to what."**
- `types.ts:34` gives `render()` no navigation callback, so **no panel can link to another**. `AgentManagement.panel.tsx:244` literally renders a `__deeplink` paragraph that tells you where to go in words because it cannot take you there.
- Agent Management and Fleet Graph read the *same* `/api/agents` roster and never acknowledge each other. Model Audit's rows are about agents that Agent Management lists. Autonomy Ladder's workers are those agents. Run Envelope and Watch Agents Run are two views of the same sessions. Context Lifecycle and Proposed Lessons both key on session id. **Five real join keys, zero rendered joins.**
- Fleet Graph's legend (`:299–303`) describes edge semantics only; nothing tells you that node color = working/idle, and there is no legend anywhere for the section's chip vocabulary.

**Motion / choreography.** Ours has essentially none: tile click swaps the whole body and a `← All panels` button (`AgentPlatform.tsx:38`) throws away your position. Theirs preserves spatial context on every drill (re-center + breadcrumb + slide-over). We don't need animation — we need the *breadcrumb and the preserved parent*, which is a state question, not a CSS one.

---

## 4. THE LEGIBILITY QUESTION — the principles, and exactly which we violate

Eight principles, each with the evidence, our specific violation, and what adopting it means for our ten panels.

**P1 — One narrative spine per screen, stated in one sentence.**
*Evidence:* every Sunflow screen's kicker/title/thesis; The Climb's `Graduate when:` per card.
*We violate it:* the section header sells the plugin architecture (`AgentPlatform.tsx:31–33`); opened panels show only their bare title (`:41`), dropping the `description` that already exists.
*Adopting means:* section header becomes one operator sentence ("What the fleet is, what it's allowed to do, and what it actually did."); `AgentPlatform.tsx` renders `active.description` under `ap__body-title`. Two lines of JSX; every panel already supplies the text.

**P2 — Group by altitude, then order within the group; render the grouping.**
*Evidence:* Bennett's OPERATE / AGENTS / INTELLIGENCE / SYSTEM / VARIANTS sidebar; Sunflow's 7-item nav.
*We violate it:* one undifferentiated 10-tile grid; the intended arc lives only in `types.ts:16–27`.
*Adopting means:* three labelled bands over the same grid — **Now** (Watch Agents Run, Run Envelope) · **The fleet** (Agent Management, Fleet Graph, Autonomy Ladder, Model Audit) · **Knowledge & upkeep** (Brain Search, Context Lifecycle, Proposed Lessons, Hygiene Report). No panel moves; `order` values already sort correctly inside each band. Purely additive in the shell.

**P3 — Status is a first-class fact, in one vocabulary, on the entry surface.**
*Evidence:* `working/waiting/idle` on every Sunflow surface including the sidebar; `● IDLE claude-fable-5` inline on Bennett's org-chart nodes.
*We violate it:* tiles carry zero state; 5 of 10 panels encode state as prose; `--waiting` amber is dead inside the section.
*Adopting means:* (a) each panel optionally exports a cheap `status()` → `{ dot, label }` rendered on its tile — "2 running", "3 findings", "empty ledger", "index 4h old"; (b) the five prose-state panels adopt `.mc-status-dot`/`.mc-badge` for their headline state and keep the prose as the explanation beneath; (c) resolve decision-note 4 — emit `--waiting` for waiting-human or delete the token. This is the single highest-leverage change in the list.

**P4 — The hierarchy is drawn, not listed; one hero visual per view.**
*Evidence:* Bennett's org chart and radial graph; The Climb's per-phase mini-diagrams; the operator→CFO/CMO/CRO→task tree.
*We half-violate it:* `FleetGraph` genuinely draws the fleet — but on this worktree it draws nodes with **no edges** (`:374–379`, honest and correct) and the nodes lack model badges, so the hero visual carries less information than the list next door.
*Adopting means:* put `ModelBadge` on the graph node (`FleetGraph.panel.tsx` node renderer, alongside the dot at `:95`), add a node-color legend beside the edge legend, and add *one* always-present edge class so the graph is never edgeless — `manager → worker` from the roster's own manager field is the obvious candidate, and it's a real relationship, not decoration.

**P5 — One consistent field order for every detail view, and the ladder written out.**
*Evidence:* Bennett's workflow panel — status chip, invariant sentence, `BREAKS INTO`, `BUILDS ON`, `WHAT IT REPLACES`, `THE LADDER` (three rungs, prose specific to *this* workflow), `THE HUMAN`. Identical on every workflow.
*We violate it by splitting:* `AgentManagement.panel.tsx:169–244` renders the six U3 fields; `FleetGraph.panel.tsx:317–366` renders a *different* subset (id/role/working/declared/runner-bound/ceiling + replaces + builds-on) in a different order. Two detail views of one entity that disagree on shape.
*Adopting means:* extract one `AgentFacts` component used by both inspectors, fixed order, and add the three ladder rungs as prose — our `AutonomyLadder` computes the *verdict* but never states what T1/T2/T3 mean **for this agent**. That prose is the missing half; the computation is the half they lack.

**P6 — Progressive reveal that preserves the parent.**
*Evidence:* re-center + breadcrumb + `< 1/7 >` pager; slide-over detail panels.
*We violate it:* `← All panels` (`AgentPlatform.tsx:38`) discards position; no panel can link to another (`types.ts:34`).
*Adopting means:* a breadcrumb (`Agent Platform / Fleet Graph`) instead of a back button, and the deferred nav callback in the render signature — `render: (nav) => …` — so `AgentManagement.panel.tsx:244`'s written-out deeplink becomes a button. This is decision-note 9 and it is the *root* of "what connects to what". It cannot be faked by copy.

**P7 — A persistent global fact in the chrome.**
*Evidence:* `● Agentic System Operational 00:48:24`; `16/22 systems live`; `COST & RUNTIME $4.31`.
*We violate it totally.*
*Adopting means:* one rollup strip under the section header — `N agents · M running · K cards waiting · index Xh old · last run Yh ago`. Needs the aggregate route from §2c-1; until then it can be assembled client-side from `/api/agents` + `/api/trace` at the cost of two fetches the panels already make.

**P8 — Plain language first, machine detail second; counts on section headers.**
*Evidence:* `Runs every 30 minutes · next in 12 minutes` over the raw cron; `SYSTEM JOBS (11)`; `LAST 50`.
*We partly do this and partly invert it:* `ModelAudit.panel.tsx:71–100` leads with `row.event` and raw model ids; `ContextLifecycle.panel.tsx:62` renders whole store bodies in `<pre>`; `BrainSearch.panel.tsx:94` leads each result with a 4-decimal score. Good counterexamples exist — `HygieneReport.panel.tsx:26` does `{kind} ({count})`, `AgentManagement.panel.tsx:397` does `(N)`.
*Adopting means:* every list header gets `(N)`; every row leads with the sentence and demotes ids/scores/paths to small mono. Mechanical, panel-local, no shared-file edits.

**One principle we should NOT adopt:** their hero graphs are frequently decorative (the particle core, the radar). Our honesty discipline — `not-evaluated`, "no edges *because there are none*", "index reload takes 10–20s" — is better than theirs and is the thing that makes the section trustworthy. The reframe must add legibility on top of the honesty, never trade it away.

---

## 5. Prioritized — what to adopt

### (a) Fits the pending review-mode reframe (rename + guided landing + status chips + connection map)

Ordered by impact per line changed. All of this is the reframe; if the reframe ships, ship these as its content.

1. **Section thesis + panel thesis** (P1). Replace the plugin-architecture note in `AgentPlatform.tsx:31–33` with one operator sentence; render `active.description` under `ap__body-title` (`:41`). ~4 lines. *This alone answers "what am I looking at".*
2. **Three labelled bands over the tile grid** (P2): Now · The fleet · Knowledge & upkeep. Shell-only, no panel moves, `order` already correct. ~20 lines in `AgentPlatform.tsx` + a `group?: string` on `AgentPlatformPanel` (`types.ts`).
3. **Status on the tiles** (P3a). Optional `status()` on the panel contract, rendered as `.mc-status-dot` + short label on `ap__tile`. Panels that don't implement it show nothing. *This is what turns "can't tell what works" into a glance.*
4. **Guided landing = the reading order made visible.** With bands + theses + tile status in place, the landing already reads top-to-bottom the way `types.ts:16–27` intended; add one line per band saying what question it answers ("what is running right now", "who is allowed to do what", "what the fleet knows and owes").
5. **Connection map** (P6 + §2c-6). The honest version is not a new diagram — it's the nav callback (`types.ts:34` → `render: (nav) => …`) plus a short "related" row on each panel body naming the panels that share its join key (roster · session id · agent id). `AgentManagement.panel.tsx:244` becomes a real button. Renaming the section without this leaves the deepest complaint unfixed.
6. **Global rollup strip** (P7), client-assembled at first.

### (b) Independent quick wins (no reframe dependency, panel-local, no shared-file edits)

7. **Chip vocabulary sweep** (P3b) — `ModelAudit`, `ContextLifecycle`, `BrainSearch`, `HygieneReport`, `ProposedLessons` adopt `.mc-status-dot`/`.mc-badge` for headline state, keeping prose as explanation.
8. **Counts on every list header** (P8) — copy `HygieneReport.panel.tsx:26`'s `{kind} ({count})` pattern into the other eight.
9. **Brain overview block** — `THE BRAIN IN NUMBERS` for our index: files, chunks, max chunk size, index age, top source directories. We *have* these numbers (`MORNING-REPORT.md` U1) and show none. Biggest information gain per line in the whole document. Needs an index-metadata read, not a model spawn — so it is unaffected by the 10–20s query cost.
10. **Model badge on Fleet Graph nodes + a node-color legend** (P4).
11. **Plain-language-first pass on `ModelAudit` rows** (P8) — lead with "codex ran gpt-5.6-terra as requested", demote raw ids to mono.
12. **Unify the two agent detail views** into one `AgentFacts` component, fixed field order (P5). Touches two panel files only.
13. **Resolve decision-note 4** — emit `--waiting` for waiting-human, or delete the token. Two dead colors is worse than one.

### (c) Needs new infrastructure (Wave-2+)

14. **Aggregate/health route** (§2c-1) — one cheap rollup so P7 isn't three client fetches.
15. **Daily rollup store → 14-day trend bars** (§2c-3) — run outcomes and card-priority mix. Nothing today keeps history.
16. **Persistent brain sidecar / fastembed-ONNX** (decision-note 6) — <200ms queries turn Brain Search from a form into a browsable surface, which is the precondition for a radial/graph brain view.
17. **A writer for `## North star` / `## Invariants` / `## Current gate`** (decision-note 2) — the U7/U9 injection seam is a socket with no plug. Sunflow's `CURRENT DIRECTIVE` panel is what it looks like populated. Answer "who authors the north star, and when" first; the UI is trivial afterwards.
18. **Queue/card board rendered in-section** (§2c-4) — 3 columns with counts and priority chips over data that already exists on ops. This is also the natural home for the missing "needs Daniel" panel.
19. **Cadence/schedule reader** (§2c-5) — HEARTBEAT cadences in plain English with next-run times.
20. **Context-pressure meter** (§1a) — per-session context-window consumption from the U8 store, which today we render as text.
21. **Ladder rungs as authored prose per agent** (P5) — pairs our earned verdict with their human-readable "what this tier means here". Governance content, not code.

---

## Appendix — source frames cited

| Ref | Reel | Timestamp | What it shows |
|---|---|---|---|
| Dbs 00:02 | DbsM7RMBSzo | 0:02 | Org chart with per-node `● IDLE claude-fable-5` / `● ERROR gpt-5.4`, legend strip, `21/30 ok` |
| Dbs 00:04–00:26 | " | 0:04–0:26 | REAL AGENTS roster, CAST health rows with `FAIL` in red, `COST & RUNTIME $4.31 ESTIMATED`, `16/22 systems live` |
| Dbs 00:11 | " | 0:11 | Second app: live agent cards, `RUNNING`, `Working for 9 seconds · called 2 tools`, paired 14-day stacked bars |
| Dbs 00:13–00:24 | " | 0:13–0:24 | Agent tree with filter tabs `All/Active/Paused/Error`; model list with `running/idle/paused/error` chips |
| Dbs 00:46–00:53 | " | 0:46–0:53 | G-Brain stats block + radial graph; Communications/Sales drill-down with breadcrumb + pager |
| Dbs 01:00/01:04 | " | 1:00 | Workflow detail: `FULLY AUTONOMOUS` + `READY TO RUN`, `BREAKS INTO`, `BUILDS ON`, `WHAT IT REPLACES`, `THE LADDER`, `THE HUMAN` |
| DZEz 00:00–00:03 | DZEzQ7XxFEP | 0:00 | AGENT NETWORK: kicker/title/thesis, hub card, 5 agent cards each with status chip + model |
| DZEz 00:09/00:37 | " | 0:09 | Command Center: `CURRENT DIRECTIVE`, `CONTEXT WINDOW` meter, telemetry strip, `VPS HEALTH` |
| DZEz 00:12–00:28 | " | 0:12 | KPI tiles labeled `placeholder source —`; `ACTIVITY` + `NEEDS REVIEW / 0 open` side by side |
| DZEz 00:31 | " | 0:31 | Task board, 3 columns with counts, priority chips, `● Agentic System Operational 00:48:18` |
| DZEz 00:34 | " | 0:34 | Schedule: plain-English cadence over raw cron + source command, `SYSTEM JOBS (11)` |
| DZEz 00:40–00:43 | " | 0:40 | `Agent Log / LAST 50` rows carrying the executing model id |
| DbyA 00:20–02:25 | DbyA5hlSvI7 | 0:20–2:25 | Climb cards 00–05: identical template, `Graduate when:`, `THE MOVES`, `PROOF YOU'RE HERE`, named mini-diagrams, `REMEMBER` |

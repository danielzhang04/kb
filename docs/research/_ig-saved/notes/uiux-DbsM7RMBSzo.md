# UI/UX note — Instagram DbsM7RMBSzo (Bennett Spooner, "Bennett OS")

- URL: https://www.instagram.com/p/DbsM7RMBSzo/
- Creator: Bennett Spooner | AI Automation
- Format: 72s screen-recording reel, hand pointing at a curved ultrawide monitor
- Caption: "How I run my 37 AI agent team... conductor agent... Claude Code headless... Hermes action layer... G-Brain knowledge base... Mac mini + Tailscale, always running"
- Accessible: yes, downloaded clean via yt-dlp

## What's on screen

Two related apps, both dark-navy dashboards for a personal "agent fleet operator" product ("Bennett OS"):

### 1. Org-chart / agent hierarchy view
- Root node "Bennett Spooner — OPERATOR" at top, feeding into a "Conductor (super agent)" card (labeled "AI HEAD", model badge, "Chat with Conductor" input + Send button, "AGENT TOOLS" row of pill buttons: broadcast / operate / team).
- Conductor branches left/right to "Optimal Engine" (markdown+vector knowledge store) and "Comms Feed" (Gmail/WhatsApp/Slack unified).
- Below that, 5 department "crew" cards in a row (Marketing/Growth, Tech, Finances, Communications, one more) — each card has: colored diamond icon matching a legend dot (yellow/purple/green/blue per department), crew name, a short role line, then 2-4 named sub-agents with a "BUILTIN" badge and one-line description, and an "AGENT TOOLS" strip of small tool-name pills (stripe, paypal, square, shopify, fanbasis, etc.) at the card's bottom.
- A legend strip up top maps color dot -> department name (Marketing, Sales, Finances, Communication, Clients, Knowledge, Operations).
- This is literally a fleet org-chart: human -> conductor -> department heads -> named agents -> tools, color-coded by function, all on one screen.

### 2. "Real Agents" roster page (same app, different tab)
- Left sidebar sections: OPERATE (Home, Comms, Funnel, Workflows, Social, Content, Finances), AGENTS (Agents, Tasks, Skills, Org Chart), INTELLIGENCE (Brain, Doctor), SYSTEM (Connections, Roadmap, Analytics, Reference Model), VARIANTS (Personas).
- Page header "REAL AGENTS" with tabs Roster / Hermes Workers.
- Top card = Conductor: role blurb ("the real CEO — claude-fable-5 on the company board — delegates, creates tasks, reads your data"), then an inline threaded activity log styled like chat messages ("-> CONDUCTOR - BOARD" then a timestamped status paragraph, repeated 3x), then a text input "Message the CEO — it can delegate, create board tasks, and pull real data".
- Stat tile row directly under: TOTAL 30, ACTIVE 15, OPEN TASKS 7, CRON JOBS 8 (grid of plain numeric KPI tiles, no chart).
- Below that: an "ACTIVITY" table — one row per integration/agent, prefixed "CAST", e.g. `Data Agent [1.1617] conversations/...`, `WhatsApp Worker FAIL ChatStorage.sqlite found but the read timed out. Likely permissions...`, `Comms Agent 2/3 channels live`, `Gmail Worker OperatorOS: 1295 unread...`, `Sales Agent Sales pipeline...`, `Payments Pulse Stripe: $229.23 USD available`, `Stripe`, `Social Agent`, `Zernio Publisher 0 platforms... 0 total followers`. Each row is a single-line live health/status string per system, color-highlighting FAIL in red.

### 3. Second app — task/run dashboard ("Bennett OS" sidebar, different visual skin)
- Left nav: New Task, Dashboard, Inbox (red badge count), Tasks, Routines, Artifacts, Skills, Projects | AGENTS: Conductor ("1 live"), See all agents | COMPANY: Org, Timeline, Costs, Activity, Audit, Settings.
- Dashboard body: "AGENTS" section = two live agent cards side by side. Left card: "Conductor · Live now" over task title "BEN-25 - Bennett OS Cockpit", then a status pill "RUNNING", a live one-paragraph description of what it's doing right now, and a footer "Working for 9 seconds · called 2 tools" with a spinner. Right card: "Conductor · Finished 7h ago" over "BEN-30 - DELEGATION TASK 1", "worked for 2 minutes 6h ago".
- Stat tiles: "10 Agents Enabled" (sub-text: "1 running, 2 paused, 1 errors"), "1 Tasks In Progress" (sub-text "6 open, 1 blocked").
- Two trend charts side by side: "Run Activity — Last 14 days" (stacked bar chart, legend Succeeded/Recovered/Failed/Other, green/red/etc.) and "Tasks by Priority — Last 14 days" (stacked bar chart, legend Critical/High/Medium/Low).
- "RECENT ACTIVITY" feed list at the bottom: plain rows like "Conductor environment lease acquired · just now", "Bennett Spooner commented on BEN-25 · just now", "System issue productivity review updated BEN-27 · 53m ago" — entity + verb + object + relative timestamp, most-recent-first.

## Visual system
- Dark navy/near-black background (#0a0e1a-ish), thin 1px borders, small-caps section labels, monospace-leaning UI font for data, sans for headers.
- Color-coding is functional not decorative: each department/agent type gets one accent hue reused consistently (icon, dot, card border tint) across every screen — never a rainbow, always mapped 1:1 to a legend.
- Status vocabulary is text-first (RUNNING, FAIL, Live now, Finished Xh ago, ACTIVE) with a colored dot/pill, not icon-only.
- Data density is high (lots of small text rows) but organized into consistent card/table primitives, not walls of prose.

## Steal-worthy patterns
1. **Live org-chart of the agent fleet** — root operator -> conductor -> department heads -> named agents -> tool pills, one screen, color legend at top. Directly portable to a kb "fleet map" view (boss -> dispatched agents -> per-project workers).
2. **Inline live activity thread on the conductor's own card** — chat-style timestamped status updates embedded in the agent's roster card, not a separate log page.
3. **One-line-per-integration health strip** ("CAST" rows) — agent/tool name + current status in a single sentence, FAIL highlighted red. Good for a kb system-health/ops-status panel (daemon, cron, integrations).
4. **Live "Working for Ns · called N tools" footer with spinner** on an in-progress agent card — cheap, legible proof-of-life pattern for any dispatched agent card in a dashboard.
5. **Paired stacked-bar trend charts**: Run Activity (Succeeded/Recovered/Failed/Other) and Tasks by Priority (Critical/High/Medium/Low), both "last 14 days" — a reusable 2-chart header block for a fleet dashboard.
6. **Plain-English recent-activity feed** — "Entity + verb + object + relative time", newest first, no chart, just a legible audit trail.
7. **Left-nav grouping by altitude, not by feature**: OPERATE (day to day) / AGENTS (the fleet) / INTELLIGENCE (brain/knowledge) / SYSTEM (infra/analytics) / VARIANTS (personas) — a 5-bucket IA worth adapting for kb's own sidebar (vs. one flat list).

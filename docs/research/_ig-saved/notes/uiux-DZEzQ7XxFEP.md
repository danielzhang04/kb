# UI/UX note — Instagram DZEzQ7XxFEP (Sean Purvis, "Sunflow Agentic OS")

- URL: https://www.instagram.com/p/DZEzQ7XxFEP/
- Creator: Sean Purvis
- Format: 1m03s reel, split-screen: dashboard footage pinned in the top third, talking-head (night skyline background) in the bottom two-thirds, word-by-word animated captions burned in
- Caption: none (empty)
- Accessible: yes, downloaded clean via yt-dlp

## What's on screen

A product called **"Sunflow Agentic OS"** — smaller/cleaner than the Bennett OS suite (5-6 agents vs. 30-67), same dark-dashboard genre.

### Left sidebar
"Sunflow Agentic OS" wordmark + tagline. Sections: Command Center, Agents, Tasks, Schedule, Lead Pipeline, Content, Knowledge Vault. Below that, an "AGENTS" list repeats the same 5 agents with a colored status dot each (green = active, gray = waiting): CEO, Researcher, CMO, Sales Rep, Dev, Data Analyst.

### "Agents" page — Agent Network
- Header: "AGENT NETWORK — One command brain coordinating five specialist agent roles."
- Top hub card: **CEO/Orchestrator**, badge "COMMAND LAYER", model badge "gpt-5.1", one-line description ("Routes work, blended context, coordinates specialists, and returns the operator verdict"), and a small stat pair (ROUTES 28, TASKS 63).
- Below, 5 agent cards in a row, each near-identical template: role name (Researcher / CMO / Sales Rep / Dev / Data Analyst), a category tag in small caps (INTEL GATHERING / MARKET VOICE / REVENUE OPS / BUILD SYSTEM / SIGNAL LAYER), a status pill (ACTIVE or WAITING, colored), a **model badge naming the specific LLM powering that agent** (e.g. gemini-2.5-pro, claude-sonnet-4, gpt-5.1), and a one-line role description.
- Notably: **each agent role is pinned to a different model** — the dashboard surfaces this as a first-class fact on the card, not hidden config.

### "Command Center" page — Growth Operations Dashboard
- Header "Growth operations dashboard" + "Refresh sheet" action, subtitle "Business outcomes first, with live agent telemetry supporting operator decisions."
- "CURRENT DIRECTIVE" panel: text of the CEO's latest instruction ("CEO - explained cloud subscription usage"), a small 5-point radial/orbit diagram (center dot + satellite dots, one per agent, positioned around it like a mini constellation — same genre as Bennett OS's Optimal Engine but tiny and decorative rather than navigable), a "CONTACT WINDOW" label, "Last status: ..." line, and stat trio underneath (ROUTED, TASKS, REVENUE $).
- "SYS HEALTH" panel (top right): CPU / RAM / Disk usage bars with percentages, plus "AGENT DB: 45.56 MB".
- "CHAT WITH AI AGENT" row: horizontal tab-style selector, one tab per agent (CEO, Researcher, CMO, Sales Rep, Dev, Data Analyst), colored status dot on each tab, click to switch which agent you're addressing — clicking Researcher visibly changes the "CURRENT DIRECTIVE" panel above to show Researcher's own state.
- KPI stat row (4 tiles): Posts This Week 12, Active Leads 38, Calls Booked 7, Follow-up Emails Sent 54 — each tile has a small "placeholder source ->" link/breadcrumb beneath the number (hints these numbers are wired to a real data source per tile, browsable).
- "ACTIVITY" feed list: entries like "Diagnosed Researcher dashboard message no-reply..." with a green "COMPLETED" tag, "Rebuilt Command Center agent... COMPLETED", "Built recurring Content Calendar... COMPLETED" — task name + one-line outcome + status chip, newest first.
- "NEEDS REVIEW" panel alongside Activity: an approval-queue callout, e.g. "Approval queue is clear. CMO posts and Sales Rep emails still here since your sources are wired" — a dedicated pending-human-approval slot distinct from the activity log.

## Visual system
- Same dark-navy/near-black shell as the other 3 posts (this whole product genre appears to converge on one look: near-black background, thin borders, small-caps labels, one accent color per status/category, condensed sans headers).
- Status vocabulary: ACTIVE / WAITING pills with color dot, COMPLETED tags in green, model names shown as first-class badges.
- The video itself models a content pattern worth noting separately from the UI: word-level animated caption overlay + fixed dashboard screenshot letterboxed above a talking head — high-retention short-form format, not relevant to dashboard UI itself.

## Steal-worthy patterns
1. **Model badge as a first-class card attribute** — every agent card names the exact LLM behind it (gpt-5.1, claude-sonnet-4, gemini-2.5-pro). Kb already does per-agent model routing (governance defaults + ops overrides) — this is a ready-made visual pattern to surface "which model is this agent running" directly on its card in a fleet dashboard, matching Daniel's existing "verify model via transcript grep" discipline by making it visible instead of buried.
2. **Dedicated "NEEDS REVIEW" panel separate from the activity feed** — pending-human-approval items get their own slot next to (not mixed into) the completed-activity log, and it explicitly states when the queue is clear plus *why* remaining items are stuck ("still here since your sources are wired"). Strong match for kb's card/gate model — a literal "cards waiting on Daniel" panel distinct from "cards already resolved."
3. **Click-to-switch agent tabs that re-scope the whole panel above** — clicking an agent's status-dot tab swaps the "Current Directive" panel to that agent's own state, letting one directive panel serve as a shared, reusable "inspect this agent" surface instead of duplicating it per agent.
4. **SYS HEALTH block with plain resource bars (CPU/RAM/Disk) + a size stat (Agent DB size)** — infra telemetry given equal billing next to business KPIs, useful for a kb ops/daemon-health panel.
5. **Stat tiles with a "placeholder source ->" trace link beneath the number** — every KPI tile hints at (and can presumably jump to) the underlying data source, keeping numbers auditable rather than opaque.
6. **Compact "one directive banner + mini constellation diagram" combo** at the top of a command center — a decorative-but-informative small multiple of the bigger org/knowledge graph, reused at a smaller scale for "what is the CEO agent currently focused on."

# UI/UX inspiration rollup — 4 Instagram saves (agent-fleet dashboards)

Source posts (all accessible, all downloaded clean via yt-dlp, no auth issues):

| Post | Creator | Product shown | Per-post note |
|---|---|---|---|
| [DbsM7RMBSzo](https://www.instagram.com/p/DbsM7RMBSzo/) | Bennett Spooner | "Bennett OS" — org-chart + roster + task dashboard | `notes/uiux-DbsM7RMBSzo.md` |
| [DbyA5hlSvI7](https://www.instagram.com/p/DbyA5hlSvI7/) | Oliver Merrick | "The Climb" — FigJam maturity-model board | `notes/uiux-DbyA5hlSvI7.md` |
| [Db7d0pXBaOG](https://www.instagram.com/p/Db7d0pXBaOG/) | Bennett Spooner | "Optimal Engine" — radial agent graph + personas + funnel + finances | `notes/uiux-Db7d0pXBaOG.md` |
| [DZEzQ7XxFEP](https://www.instagram.com/p/DZEzQ7XxFEP/) | Sean Purvis | "Sunflow Agentic OS" — agent network + command center | `notes/uiux-DZEzQ7XxFEP.md` |

All four are screen-recordings of solo operators showing off homemade "AI agent company" dashboards — not polished commercial products, but genuinely close analogues to what a kb fleet-orchestration dashboard needs to show. Three (1, 3, 4) are live software; one (2) is a planning whiteboard, not a runtime UI.

## The common design DNA

- **One visual shell, reused everywhere.** All four converge on the same look: near-black/dark-navy background, 1px hairline borders, small-caps section labels, condensed sans headers, monospace-leaning body text for data. No product breaks from this palette even across very different screens (org chart, finance, funnel, radial graph).
- **Color is a functional legend, never decoration.** Every dashboard assigns one accent hue per department/agent/status and reuses it identically across every view (icon, dot, card border, chart series) with an explicit legend visible on-screen. Never a rainbow; always a 1:1 mapping.
- **The org/agent hierarchy is drawn, not just listed.** Three of the four render the fleet as an explicit diagram — either a top-down org chart (operator -> conductor -> department heads -> agents -> tools) or a radial constellation graph (core knowledge node -> department ring -> agent/skill leaf ring). Nobody just ships a flat table of agent names.
- **Every agent/workflow card names its model and status as first-class facts**, not hidden config — model badge, ACTIVE/WAITING/RUNNING pill, "Live now" / "Finished Xh ago" / "Working for Ns · called N tools" language.
- **Human-in-the-loop is a dedicated surface**, not folded into a log — an explicit "NEEDS REVIEW" / approval-queue panel sits beside (never inside) the activity feed, and states plainly when it's empty and why anything remaining is stuck.
- **Autonomy is described per-workflow on a ladder** (human-led -> human-assisted -> fully autonomous), not as one global setting — each workflow's detail view states exactly what tier it's at and what that tier means concretely for that job.
- **Stat tiles are plain numbers with light context**, not gauges/gimmicks — "Total 30 / Active 15 / Open Tasks 7 / Cron Jobs 8" style rows, sometimes with a one-line trace ("placeholder source ->") to the underlying data.
- **Trend charts are simple stacked bars over 14 days**, categorical legends (Succeeded/Recovered/Failed/Other; Critical/High/Medium/Low) — no fancy visualization, just clear categorical trend.
- **Detail views slide in over the graph/list rather than navigating away**, preserving spatial context while inspecting one node.
- **Roadmaps/maturity models get their own visual metaphor** (a rising line with numbered waypoint cards) rather than being a bulleted doc — each stage states its exit criterion ("Graduate when...") and proof checklist explicitly.

## Numbered list of concrete, adoptable patterns

1. **Fleet org-chart view** — root (Daniel) -> boss/conductor -> department/project heads -> named agents -> tool chips, one screen, color-coded legend. *Apply to:* a kb "fleet map" tab showing boss -> dispatched Claude/Codex agents -> per-project workers, replacing/augmenting a flat agent list.
2. **Radial constellation graph as an alternate fleet view** — core "brain" node in the center, ring of departments/orgs, outer ring of individual agents/skills; click a ring node to re-center and drill in with breadcrumb + pager (`< Back 1/7 Sales >`). *Apply to:* an alternative, richer visualization of `orgs/` + agent registry for large fleets where a tree gets too tall.
3. **Model badge on every agent card** — name the exact LLM (opus/sonnet/haiku/codex-model) directly on the card, not buried in config. *Apply to:* every agent/card tile in the kb dashboard, reinforcing the existing "verify model via transcript grep" discipline by making it visible up front.
4. **Live "Working for Ns · called N tools" spinner footer** on in-progress agent cards. *Apply to:* kb's dashboard cards for actively-running dispatched agents — cheap, legible proof-of-life.
5. **Inline chat-style activity thread on an agent's own roster card** (timestamped status messages embedded in the card, not a separate log page). *Apply to:* a boss/conductor card that shows its own recent standing-thread messages inline.
6. **One-line-per-integration health strip** (agent/tool name + current status sentence, failures highlighted red). *Apply to:* a kb ops/daemon-health panel listing each integration (daemon, cron, git remotes, MCP connections) with one live status sentence each.
7. **Dedicated "NEEDS REVIEW" / approval-queue panel**, separate from the completed-activity feed, stating plainly when clear and why anything remaining is blocked. *Apply to:* a "cards waiting on Daniel" panel on the kb dashboard, distinct from resolved-card history — maps directly onto the existing card/gate model.
8. **Autonomy ladder per workflow** (Human-led / Human-assisted / Fully autonomous, each with a one-line concrete description for that specific workflow). *Apply to:* per-card or per-skill autonomy documentation, making `governance/risk-tiers.md` visual and workflow-specific instead of a single global policy doc.
9. **"WHAT IT REPLACES" + "THE SOP, WRITTEN OUT" + "TOOLS AT THE END OF THE CHAIN"** as a consistent closing block on every workflow/skill detail panel. *Apply to:* kb skill/card detail views — always answer what manual process this replaces, the exact numbered steps, and which tools it touches.
10. **Paired 14-day stacked-bar trend charts**: run outcomes (Succeeded/Recovered/Failed/Other) and work-item priority mix (Critical/High/Medium/Low). *Apply to:* kb dashboard header — trend of card/run outcomes plus a priority-mix chart, both simple stacked bars, no gauges.
11. **Plain-English recent-activity feed** ("Entity + verb + object + relative time", newest first, no chart). *Apply to:* kb's audit/activity view — keep it legible prose rows, resist the urge to over-visualize.
12. **"Graduate when: ..." exit criteria + "PROOF YOU'RE HERE" checklist** on every roadmap/maturity stage. *Apply to:* kb wave/phase gates and `orgs/<project>/contract.md` maturity ladders — force one falsifiable sentence and observable proof per stage, not vibes.
13. **"The Climb" rising-line roadmap visual** — numbered waypoint cards hanging off a single ascending line, each self-contained (name, exit criterion, moves, proof, phase-specific mini-diagram, one-line maxim). *Apply to:* a kb project-maturity or fleet-buildout roadmap artifact, replacing a plain markdown roadmap doc.
14. **Folder-tree "under the hood" diagram inline in a narrative doc** (literal `departments/`, `skills/`, `data/` structure with example filenames). *Apply to:* documenting kb's own repo layout inline in onboarding/roadmap artifacts instead of a separate reference page.
15. **Funnel/pipeline as a connected bubble chain** (stage name + count + % retained, sized bubbles on one horizontal line, color-coded states). *Apply to:* visualizing kb's card/queue pipeline (queued -> claimed -> in-progress -> verified -> done) or FYT's gated pipeline stages more visually than a table.
16. **Click-to-switch agent tabs that re-scope a shared "current directive" panel** above them, rather than duplicating the panel per agent. *Apply to:* a kb "inspect this agent" panel reused across the fleet via tab-switching instead of per-agent duplicate UI.
17. **SYS HEALTH block** (CPU/RAM/Disk bars + a size stat) given equal visual billing next to business/ops KPIs. *Apply to:* surfacing daemon/machine health directly on the kb dashboard home, not buried in a separate ops page.
18. **Persona/variant gallery** — same shell reskinned per vertical/tenant with its own North Star metric, capability pillars, connectors, and tracked metrics, paged 1-of-N. *Apply to:* if kb ever needs per-org (`orgs/<project>/`) dashboard variants presented as instances of one shared shell.
19. **"NORTH STAR" — one bolded metric, isolated above the rest of the metric list.** *Apply to:* forcing every kb dashboard/project view to declare the single number that matters before listing the full metric set.
20. **5-bucket sidebar IA by altitude, not by feature** (Operate / Agents / Intelligence / System / Variants). *Apply to:* reconsidering kb's dashboard sidebar grouping — day-to-day operate vs. the fleet itself vs. knowledge/brain vs. infra/system vs. per-org variants — instead of one flat feature list.

## Note on accessibility
All 4 posts downloaded and analyzed successfully — no auth-gated or inaccessible posts to report.

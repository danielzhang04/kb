# Dashboard v3 inspiration board

## 1. **Reference table**

| Product | URL | What it is | Demonstrates rules |
|---|---|---|---|
| Linear | [Issue layout](https://linear.app/changelog/2021-06-03-issue-view-layout) | Work tracker with a readable content column and separate details pane. | 2, 5, 6 |
| Vercel | [Observability](https://vercel.com/products/observability) | Deployment platform with searchable, inspectable runtime logs. | 3, 4, 10, 11 |
| GitHub Actions | [Run logs](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs?scid=7013o000002CceTAAS) | CI workflow runner with a run graph, jobs, steps, and logs. | 1, 3, 10 |
| Dagster | [Dagster UI](https://master.dagster.dagster-docs.io/concepts/webserver/ui) | Data orchestration UI for jobs, runs, schedules, and assets. | 1, 8, 10 |
| Prefect | [Schedules](https://docs.prefect.io/v3/concepts/schedules) | Flow orchestration with schedules attached to deployments. | 1, 8 |
| n8n | [All executions](https://docs.n8n.io/workflows/executions/all-executions/) | Visual workflow builder with a filtered execution history. | 1, 6, 10 |
| Cursor | [Background agents](https://docs.cursor.com/background-agent) | Remote coding agents with a list, status, follow-ups, and machine access. | 1, 3, 13 |
| Warp | [Full Terminal Use](https://docs.warp.dev/agent-platform/capabilities/full-terminal-use) | Agent-aware terminal that can attach to an active PTY. | 3, 13 |
| Coder / code-server | [Browser workspace](https://coder.com/docs/user-guides/workspace-access/code-server) | Browser-hosted VS Code workspace, including terminal and files. | 13 |
| Grafana | [Theme settings](https://grafana.com/docs/grafana/latest/administration/organization-preferences/) | Dense operations UI with an explicit dark theme. | 11 |

## 2. **Per-concern findings**

### (a) Live run/stream view

- [Vercel](https://vercel.com/products/observability) uses a time-ordered log table with status, host, request, and message columns; selecting a row reveals request context and trace data. Its runtime-log documentation also puts per-request detail in a right sidebar and supports live follow mode. [Docs](https://vercel.com/docs/logs/runtime)
- [GitHub Actions](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs?scid=7013o000002CceTAAS) makes the run the parent: graph or job list → job → expandable steps → log lines. Failed steps open automatically; log lines are linkable and searchable.
- [Cursor](https://docs.cursor.com/background-agent) gives a background-agent list, status, follow-up messages, and entry into the remote machine rather than treating the agent as a completed ticket.
- [Warp](https://docs.warp.dev/agent-platform/capabilities/full-terminal-use) attaches the agent to the existing terminal buffer and PTY; either side can take over without losing the shell state.

**Adopt:** a full-width live stream as the run’s primary surface; preserve the running shell, show logs as rows, and keep plan/output context secondary.

### (b) Entity box grid + card anatomy

- [Linear](https://linear.app/docs/display-options) supports an explicit list/board switch; grouping and the fields displayed are configurable, so the same entities can be scanned densely or as cards.
- [Dagster](https://master.dagster.dagster-docs.io/concepts/webserver/ui) keeps definitions as navigable entity pages while job/run information is tabular; this separates the thing from its execution history.
- [Vercel](https://vercel.com/products/observability) shows why operational evidence wants rows: timestamp, status, request, and message scan faster than cards.

**Adopt:** cards only on Agents and Workflows, with name, state, model, last/next run, and host; use log-like rows for runs and evidence.

### (c) Slide-in detail

- [Linear](https://linear.app/changelog/2021-06-03-issue-view-layout) keeps a centered readable content column and puts properties in a proportional side pane.
- [Vercel](https://vercel.com/docs/logs/runtime) opens clicked log details in a right sidebar while retaining the filtered log list.
- [GitHub Actions](https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs?scid=7013o000002CceTAAS) drills from run to job from either the job list or graph, then exposes the selected step’s evidence.

**Adapt:** slide a detail pane over the list; do not replace the list route or reset its scroll/filter position.

### (d) Notifications vs inbox

- [Linear Inbox](https://linear.app/docs/inbox) is a notification list rather than an activity archive: items can be read, deleted, snoozed, or resolved through the linked issue; it also has a finite retention cap.
- [Linear Notifications](https://linear.app/docs/notifications) separates delivery channels (desktop, mobile, email, Slack) and groups notification types; it suppresses email digests once the inbox item is read.
- [Vercel Alerts](https://vercel.com/docs/alerts) sends anomalous conditions through dashboard, email, Slack, or webhook channels instead of making raw logs the alert queue.

**Adapt:** Inbox holds deploys, PRs, learnings, and escalations. A run-level gate belongs on its owning entity/run, resolves there, and then disappears.

### (e) Schedules/“next fire”

- [Dagster](https://master.dagster.dagster-docs.io/concepts/webserver/ui) lists schedules with upcoming ticks; a schedule detail page has next tick, tick history, and run history together.
- [Prefect](https://docs.prefect.io/v3/concepts/schedules) attaches one or more schedules to a deployed flow and lets them be active or inactive; schedules create future runs rather than becoming a separate runnable noun.
- [Dagster’s schedule guide](https://legacy-versioned-docs.dagster.dagster-docs.io/concepts/partitions-schedules-sensors/schedules) places “Next tick” near the top and calls out timezone verification.

**Adopt:** show armed state and “Next: Tue 09:00 EDT” on the owning Agent/Workflow card; put history and pause controls in its detail.

### (f) Browser terminal UX

- [Warp](https://docs.warp.dev/agent-platform/capabilities/full-terminal-use) retains the active terminal buffer, offers a visible takeover control, and can hide agent commentary without hiding command output.
- [code-server](https://coder.com/docs/user-guides/workspace-access/code-server) provides VS Code in a browser and documents its workspace, terminal, file-operation, and port-proxy differences.
- [Cursor](https://docs.cursor.com/background-agent) describes background processes running in named terminals and a machine the operator can enter.

**Adopt:** one full-screen shell with a real terminal, files, and agent CLI; no miniature terminal embedded in a dashboard card.

### (g) Workflow graph

- [GitHub Actions](https://docs.github.com/en/actions/how-tos/monitor-workflows?tool=webui) generates a real-time run graph and uses it to enter job logs.
- [Dagster](https://master.dagster.dagster-docs.io/concepts/webserver/ui) has a job overview graph for the assets/ops that constitute that job, separate from schedules and runs.
- [n8n](https://docs.n8n.io/workflows/executions/all-executions/) pairs the workflow canvas with an execution list filterable by workflow, status, and time.

**Adapt:** show a graph only inside a Workflow, scoped to its actual steps/relationships; never make an unconnected “all agents” graph a primary view.

### (h) Builder-in-place (create agent/workflow forms)

- [Prefect](https://docs.prefect.io/v3/concepts/deployments) puts schedule setup on the deployment that owns the flow; the UI can configure basic schedule information such as cron or interval.
- [n8n](https://docs.n8n.io/workflows/executions/all-executions/) keeps execution inspection within the workflow/overview context, including retrying and loading earlier execution data back to the canvas.
- [Cursor](https://docs.cursor.com/background-agent) starts a background agent from its control surface, then selects it from the agent list to inspect status or enter the machine.

**Adopt:** “New agent” lives on Agents and “New workflow” on Workflows; schedule setup stays within the created entity.

### (i) Dark palette + contrast + single accent

- [Vercel Geist](https://vercel.com/geist/colors) defines separate backgrounds, component surfaces, border steps, high-contrast surfaces, and text steps rather than one undifferentiated dark gray.
- [Vercel Geist’s badge guidance](https://vercel.com/geist/badge) maps state to green/red/amber/blue/gray and recommends short textual labels, not color-only state.
- [Grafana](https://grafana.com/docs/grafana/latest/administration/organization-preferences/) treats dark as a first-class application theme; its docs include a dark-theme UI capture.
- [Vercel typography](https://vercel.com/geist/typography) pairs dense labels with tabular numerals and mono labels, useful for timestamps and run counters.

**Adopt:** warm near-black surfaces with distinct hairline/raised/selected steps; reserve one cool accent for focus/selection and reserve semantic color for state.

## 3. **Screenshot capture list**

- https://linear.app/changelog/2021-06-03-issue-view-layout · Issue content plus details pane · slide-in/detail anatomy.
- https://linear.app/docs/display-options · Board/list controls and screenshots · entity grid/list.
- https://linear.app/docs/inbox · Inbox screenshots and resolution controls · notifications vs inbox.
- https://vercel.com/products/observability · Runtime-log table, errors, trace details · live stream/evidence rows.
- https://vercel.com/docs/logs/runtime · Runtime log layout and live mode screenshots · stream + detail sidebar.
- https://vercel.com/geist/colors · Dark color scales and surface hierarchy · palette/contrast.
- https://vercel.com/geist/badge · State badge examples · semantic state labels.
- https://docs.github.com/en/actions/how-tos/monitor-workflows/use-workflow-run-logs?scid=7013o000002CceTAAS · Run list, job selection, expanded failed logs · run evidence.
- https://master.dagster.dagster-docs.io/concepts/webserver/ui · Schedules, run detail, raw logs, job graph captures · schedules/graph.
- https://legacy-versioned-docs.dagster.dagster-docs.io/concepts/partitions-schedules-sensors/schedules · “Next tick” UI capture · schedule state.
- https://docs.prefect.io/v3/concepts/schedules · Flow schedule concepts and UI ownership · schedules.
- https://docs.n8n.io/workflows/executions/all-executions/ · Execution list and filtering · workflow run rows.
- https://docs.cursor.com/background-agent · Background-agent list/machine workflow · agent session handoff.
- https://docs.cursor.com/en/background-agent/web-and-mobile · Web-agent interface and review/handoff images · remote agent detail.
- https://docs.warp.dev/agent-platform/capabilities/full-terminal-use · PTY attachment, takeover, and terminal images · browser terminal behavior.
- https://coder.com/docs/user-guides/workspace-access/code-server · Browser VS Code workspace capture · full-screen shell.
- https://grafana.com/docs/grafana/latest/administration/organization-preferences/ · Dark-theme capture and selector · dark palette.

## 4. **Synthesis: 15 adoptable patterns**

1. Agent/Workflow cards carry the identity; their runs are child history. [Dagster](https://master.dagster.dagster-docs.io/concepts/webserver/ui) · rule 1 · Agents and Workflows pages.
2. Keep five facts above the fold: name, state, model, last/next run, host. [Cursor](https://docs.cursor.com/background-agent) · rule 2 · entity cards.
3. Click a running entity into a terminal/stream, not a static status report. [Warp](https://docs.warp.dev/agent-platform/capabilities/full-terminal-use) · rule 3 · Agent/Workflow run view.
4. Make stream events compact rows with time, state, subject, and message. [Vercel](https://vercel.com/products/observability) · rule 10 · run evidence.
5. Put plan, milestones, links, and outputs in an adjacent secondary inspector. [Vercel](https://vercel.com/docs/logs/runtime) · rules 3–4 · run view.
6. Hide technical payload under one details disclosure. [Vercel](https://vercel.com/docs/logs/runtime) · rule 4 · all detail panes.
7. Open detail without losing list location, filters, or scroll. [Linear](https://linear.app/changelog/2021-06-03-issue-view-layout) · rule 5 · Agents/Workflows.
8. Offer boxes for runnable entities and rows for chronological evidence. [Linear](https://linear.app/docs/display-options) · rule 6 · pages and run history.
9. Let entity-level actions start from their owning page. [Cursor](https://docs.cursor.com/background-agent) · rule 7 · Agents/Workflows.
10. Pair every armed schedule with its next expected time and timezone. [Dagster](https://legacy-versioned-docs.dagster.dagster-docs.io/concepts/partitions-schedules-sensors/schedules) · rule 8 · entity card/detail.
11. Keep one schedule beside its owner, with tick and run history together. [Dagster](https://master.dagster.dagster-docs.io/concepts/webserver/ui) · rules 1, 8 · Workflow detail.
12. Make Inbox a high-level exception queue with read/snooze/resolve behavior. [Linear](https://linear.app/docs/inbox) · rule 9 · Inbox.
13. Surface a human gate inside the run that needs it, then auto-clear it on resolution. [Linear](https://linear.app/docs/inbox) · rule 9 · entity/run notification.
14. Show workflow topology only when it is an actionable run/job graph. [GitHub Actions](https://docs.github.com/en/actions/how-tos/monitor-workflows?tool=webui) · rule 10 · Workflow run view.
15. Give the shell its own full-screen mode with direct manual takeover. [Warp](https://docs.warp.dev/agent-platform/capabilities/full-terminal-use) · rule 13 · Terminal/shell.

## 5. **Anti-patterns seen**

- A global execution list without a nearby owner forces users to reconstruct what each run belongs to. [n8n](https://docs.n8n.io/workflows/executions/all-executions/)
- Full technical headers on every row make scanability depend on IDs and URLs. [Vercel](https://vercel.com/docs/logs/runtime)
- A generic alert stream can turn routine events into inbox backlog. [Vercel](https://vercel.com/docs/alerts)
- CI graphs are useful for real dependencies, but become decorative when applied to unrelated agents. [GitHub Actions](https://docs.github.com/en/actions/how-tos/monitor-workflows?tool=webui)
- Separate schedule, run, and definition pages make one operating question require several hops. [Dagster](https://master.dagster.dagster-docs.io/concepts/webserver/ui)
- Dense telemetry dashboards invite permanent panels for transient test output. [Grafana](https://grafana.com/docs/grafana/latest/administration/organization-preferences/)
- Terminal access without an explicit takeover/control boundary obscures who is operating the session. [Warp](https://docs.warp.dev/agent-platform/capabilities/full-terminal-use)

## 6. **Palette notes**

- **Vercel / Geist neutral:** `#000000` page, `#111111` raised surface, `#333333` hairline, `#888888` muted text, `#ffffff` primary text, `#0070f3` focus. Quiet, high separation; Geist explicitly distinguishes background, component, border, high-contrast, and text steps. [Geist colors](https://vercel.com/geist/colors)
- **GitHub / Primer dark:** `#0d1117` page, `#161b22` surface, `#30363d` hairline, `#8b949e` muted, `#c9d1d9` text, `#58a6ff` accent. Familiar developer-tool contrast; Primer publishes semantic foreground/background/border tokens. [Primer color](https://primer.style/foundations/color/)
- **Warm graphite:** `#14110f` page, `#1c1816` surface, `#312b27` hairline, `#a99f97` muted, `#f1ebe5` text, `#8aa4ff` focus. A Claude-desktop-adjacent candidate; keep green/amber/red out of navigation and selection.
- **Grafana-derived charcoal:** `#111217` page, `#181b1f` surface, `#2a2f36` hairline, `#9da7b3` muted, `#e5e9ef` text, `#5794f2` focus. Dense-operations character; use its color volume only for state/evidence. [Grafana dark theme](https://grafana.com/docs/grafana/latest/administration/organization-preferences/)

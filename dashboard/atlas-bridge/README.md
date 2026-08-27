# Atlas kb bridge

Standalone MCP stdio bridge from Atlas to the kb dashboard HTTP API. It negotiates one route adapter per family at runtime, keeps the operator session only in memory, and exposes no T3, credential, paid-action, deployment, approval-commit, terminal-write, or raw-shell tools.

## Build and run

Requires Node 24.

```powershell
npm ci
npm test
npm run build
$env:ATLAS_KB_BRIDGE_ENABLED = '1'
node dist/server.js
```

The reproducible install step Atlas needs is `npm ci && npm run build`; `dist/` is generated locally and is not committed.

Startup is dormant unless `ATLAS_KB_BRIDGE_ENABLED=1`. Mutation tools are not registered unless `ATLAS_KB_MUTATIONS_ENABLED=1`. `ATLAS_KB_ORIGIN` pins the one dashboard origin and defaults to `http://127.0.0.1:5317`; values with a path, query, fragment, or credentials are refused.

`ATLAS_KB_REVIEW_PROFILES` is an optional JSON object mapping safe profile names to predeclared workflow IDs, for example:

```powershell
$env:ATLAS_KB_REVIEW_PROFILES = '{"standard":"review-workflow"}'
```

An unmapped review profile is refused. Environment variables carry only non-secret configuration. Never put an operator bearer in the environment, command line, MCP configuration, or logs.

## Atlas registration and session notification

Register the built server as stdio in Atlas's MCP configuration. The exact field names depend on the Atlas release, but the registration has this shape:

```yaml
name: kb
command: node
args:
  - C:/path/to/dashboard/atlas-bridge/dist/server.js
env:
  ATLAS_KB_BRIDGE_ENABLED: "1"
  ATLAS_KB_MUTATIONS_ENABLED: "0"
  ATLAS_KB_ORIGIN: http://127.0.0.1:5317
instant_tools:
  - kb_capabilities
  - kb_agents_list
  - kb_agent_get
  - kb_workflows_list
  - kb_workflow_get
  - kb_runs_list
  - kb_run_get
  - kb_run_events
  - kb_run_watch
  - kb_inbox_list
  - kb_schedules_list
  - kb_repo_tree
  - kb_repo_file
  - kb_repo_history
  - kb_repo_search
  - kb_analytics_snapshot
  - kb_grades
  - kb_trace_list
  - kb_trace_get
  - kb_terminal_list
```

After MCP `initialize`, and again whenever the operator session refreshes, Atlas sends this private JSON-RPC notification over the existing stdio channel:

```json
{
  "jsonrpc": "2.0",
  "method": "notifications/atlas/session",
  "params": {
    "token": "<operator bearer>",
    "expiresAt": "2026-08-27T03:00:00.000Z"
  }
}
```

The bridge stores the bearer only in process memory and injects it as `Authorization: Bearer`. A 401 or expiry becomes `session_required` with exactly `say: Atlas, unlock kb`. A session notification must remain valid beyond a 30-second skew window; an unrefed in-memory timer clears the token and negotiated routes at expiry. In `tailnet` mode, a missing bearer is allowed so the authenticated transport can supply the `kb_session` cookie; the bridge itself never reads or stores that cookie. Legacy mode needs no session and is recognized only when `/api/auth/context` returns 404; a legacy route-level 401 still becomes `session_required`.

## Negotiation and safety

Negotiation reads auth context, then probes runtime capabilities, exact v1 read envelopes, and explicit legacy read routes. All probes after auth context are status-only: legacy and runtime probes cancel the body immediately after reading the HTTP status, while v1 probes read at most the first 4096 bytes to verify the envelope version and kind before cancelling the stream and aborting the request. A large successful probe response therefore still marks the route available. Any route-local transport, timeout, HTTP, or malformed-envelope failure marks only that family unavailable with a bounded reason; only `/api/auth/context` can fail negotiation globally. The selected adapter is fixed for the session; an ambiguous mutation timeout or 5xx is never retried through another route.

Every mutation sends the same 16-128 character idempotency key in both the `Idempotency-Key` header and body, plus the route-specific collection, source, item, request, or run CAS field. Atlas must own the exact verb-and-target voice confirmation before it calls a tool whose description begins `MUTATION`.

`kb_human_respond` fetches the authoritative request and accepts only `question`, `clarification`, `info`, or `choice` with a `responded` answer. Caller-supplied request kinds are ignored. Approval, review, deployment, sign-off, and unknown kinds return `t3_requires_dashboard`. `kb_run_control` accepts only `cancel` and `retry`. No T3 or T4 tool is present in this package.

HTTP response bodies are stopped while streaming when they cross the configured byte cap. `/api/index` has a separate 16 MB input cap and is parsed incrementally: `generatedAt`, `summary`, `counts`, `totals`, and `status` are retained for the analytics snapshot, and only requested grade rows are retained for `kb_grades`. If none of those summary keys exist, the snapshot returns up to 40 top-level key names with their element counts and serialized byte sizes, so a legacy index never becomes an empty answer.

Every `kb_*_get` result keeps its object and array structure while truncating each string longer than 2,000 characters with `...`. Every read tool also has a final serialized-result budget of 16 KB. List tools satisfy that budget by dropping trailing projected items, setting `truncated: true`, and moving `next_offset` to the first omitted item; they never replace the page with a whole-result truncation marker.

## List pagination and projections

Every list tool accepts `limit` (default 20, range 1-100) and `offset` (default 0). It returns:

```json
{
  "items": [],
  "total": 0,
  "offset": 0,
  "limit": 20,
  "next_offset": null
}
```

`next_offset` is the offset for the next unread item, including when the byte budget trims a page. List items are intentionally compact and expose only these voice-useful fields:

| Tool | Projected item fields |
|---|---|
| `kb_agents_list` | `id`, `displayName`, `role`, `working`, `current`, `ledger.lastActive`, `cardCount`, `project`, `projects` (first 3), `shortRef` |
| `kb_workflows_list` | `id`, `title`, `project`, `profile`, `riskTier`, `launchable`, `valid`, `stageCount`, `compileError` (200 characters, when present) |
| `kb_runs_list` | `id`, `workflow`, `status`, `startedAt`, `endedAt` |
| `kb_inbox_list` | `id`, `kind`, `title` (200 characters), `createdAt`, `agent` |
| `kb_schedules_list` | `id`, `name`, `cron`, `interval`, `armed`, `next` |
| `kb_repo_history` | `id`, `message` (200 characters), `author`, `date` |
| `kb_repo_search` | `path`, `line`, `title` (200 characters), `snippet` (200 characters), `score` |
| `kb_grades` | `id`, `worker`, `task`, `grade`, `status`, `timestamp` |
| `kb_trace_list` | `id`, `title`, `agent`, `startedAt`, `updatedAt`, `turns` count |
| `kb_terminal_list` | `id`, `name`, `status`, `cwd`, `agent`, `startedAt` |

## Tools and route families

| Tools | Policy | Route family |
|---|---|---|
| `kb_capabilities` | READ | local negotiated table |
| `kb_agents_list`, `kb_agent_get` | READ | v1 or legacy |
| `kb_agent_create`, `kb_agent_update` | MUTATION | negotiated v1 or legacy |
| `kb_workflows_list`, `kb_workflow_get` | READ | v1 or legacy |
| `kb_workflow_create`, `kb_workflow_update` | MUTATION | negotiated v1 or legacy |
| `kb_workflow_launch` | MUTATION | v1 runs or legacy workflow launch |
| `kb_agent_launch` | MUTATION | explicit legacy adapter |
| `kb_runs_list`, `kb_run_get`, `kb_run_events`, `kb_run_watch` | READ | v1 replay or legacy control/live stream |
| `kb_inbox_list` | READ | v1 or legacy |
| `kb_human_respond` | MUTATION | v1 or legacy; non-T3 only |
| `kb_review_dispatch` | MUTATION | allow-listed workflow launch |
| `kb_schedules_list` | READ | v1 or legacy |
| `kb_schedule_create`, `kb_schedule_set_armed`, `kb_schedule_delete` | MUTATION | negotiated v1 or legacy |
| `kb_repo_tree`, `kb_repo_file`, `kb_repo_history`, `kb_repo_search` | READ | legacy kb/brain |
| `kb_analytics_snapshot`, `kb_grades` | READ | streaming legacy index; optional home/health |
| `kb_trace_list`, `kb_trace_get` | READ | legacy trace |
| `kb_terminal_list` | READ | legacy session metadata only |
| `kb_run_control` | MUTATION | explicit legacy control adapter |

## Current legacy daemon without a session

The live legacy daemon at the default loopback origin currently exposes these confirmed read surfaces without an Atlas session:

| Family | Current result |
|---|---|
| agents, workflows | Available from `/api/agents` and `/api/workflows` |
| repository tree | Available from `/api/kb/tree` |
| analytics, grades | Available from the streaming `/api/index` projection |
| runs | Unavailable: `/api/control/runs` returns HTTP 403 |
| terminals | Unavailable: `/api/pty/sessions` returns HTTP 403 |
| schedules | Unavailable: `/api/schedules` returns HTTP 404 |
| traces | Unavailable: `/api/trace` returns HTTP 404 |
| runtime metadata | Unavailable: `/api/runtime/capabilities` returns HTTP 404 |
| legacy home and health sections | Unavailable: `/api/home` and `/api/health` return HTTP 404; the analytics default therefore requests only `index` |

Search, inbox, entity-detail routes, and mutation routes remain negotiated independently; the live smoke did not establish their no-session availability.

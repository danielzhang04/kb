---
schema-version: 1
id: 6a8fbb5e-fab45e21
project: kb-ops
action: kb-atlas-bridge-fix3
target: C:\Users\danie\kb-worktrees\atlas-bridge
risk-tier: T1
owner: codex-worker
claim-token: 46740c1c6d5f0157
state: done
approval: null
workflow: 01a0416b-f248-7bd2-8578-6a3fbcab9c6f
depends-on: []
variant-group: null
role: work
session-id: 6a8fb94c-95cd67fa
runtime: codex
model: gpt-5.6-sol
execution-controller: terminal
kit_sha: ca365d0053d182ebb607431c35a90e2133eaca41
---

## Work order

\# kb atlas-bridge fix round 3 - list pagination (live finding)

Codex builder in the kb repo. cwd = C:\Users\danie\kb-worktrees\atlas-bridge (branch claude/atlas-bridge;
unit = UNTRACKED `dashboard/atlas-bridge/`). Run `python scripts/preamble.py` first. OWN ONLY the package;
never commit; never touch ops/main. ASCII. Verify: `cd dashboard/atlas-bridge && npm test && npm run build`.
Baseline: 25 tests.

Live against the real legacy daemon: `kb_workflows_list` -> `{"ok":true,"result":{"truncated":true,"bytes":19098}}`
(NO data - the 19 KB legacy list exceeds the 16 KB result budget and the bounder replaced the whole result
with a marker). `kb_agents_list` returned 16,122 bytes of raw agent records (barely fits; every field passed
through). `kb_analytics_snapshot` returned `{"index":{}}` (none of the chosen summary keys exist in the
live index).

Rulings (TDD):
1. Every list tool (`kb_agents_list`, `kb_workflows_list`, `kb_runs_list`, `kb_inbox_list`,
   `kb_schedules_list`, `kb_repo_history`, `kb_trace_list`, `kb_terminal_list`, `kb_grades`,
   `kb_repo_search`) takes `limit` (default 20, max 100) and `offset` (default 0) and returns
   `{items:[...], total, offset, limit, next_offset|null}`; items are PROJECTED to a compact, voice-useful
   field set per kind (agents: id, displayName, role, working, current, ledger.lastActive, cardCount;
   workflows: id, name, description<=200 chars, status/armed, lastRun, steps count; runs: id, workflow, status,
   startedAt, endedAt; inbox: id, kind, title<=200, createdAt, agent; schedules: id, name, cron/interval, armed,
   next; history/trace/terminals/grades: the few identifying fields). The result budget then truncates the
   ITEM ARRAY (drop trailing items, set `truncated: true`, keep `next_offset`) - never the whole payload.
   Tests: a 40-item fake list -> two pages; an oversize single page degrades item count, not to a marker.
2. `kb_*_get` tools: bound long string fields (<= 2,000 chars each with `...`), keep structure.
3. `kb_analytics_snapshot` on legacy: if none of the summary keys exist, return the top-level key names with
   element counts/byte sizes (bounded to 40 keys) so the answer is never empty; test with the live index's
   actual top-level key set if you can read it cheaply (`curl -s http://127.0.0.1:5317/api/index | head -c
   2000` is allowed - READ ONLY, no other live calls).
4. README: document pagination and projections.

READ BUDGET: `src/bridge.ts` list/get ranges + `bounded()` helper, `src/tools.ts` schemas, `test/` fake data.
Stop at 35 minutes. Exit: `npm test` (>= 25 + new), `npm run build`, git status only the package. Final
message: per-tool projection table, red-on-revert for 1. Do not commit.

## Result

Implemented list pagination and compact projections in [dashboard/atlas-bridge](C:/Users/danie/kb-worktrees/atlas-bridge/dashboard/atlas-bridge).

| Tool | Projection |
|---|---|
| `kb_agents_list` | `id`, `displayName`, `role`, `working`, `current`, `ledger.lastActive`, `cardCount` |
| `kb_workflows_list` | `id`, `name`, `description`, `status`, `armed`, `lastRun`, step count |
| `kb_runs_list` | `id`, `workflow`, `status`, `startedAt`, `endedAt` |
| `kb_inbox_list` | `id`, `kind`, `title`, `createdAt`, `agent` |
| `kb_schedules_list` | `id`, `name`, `cron`, `interval`, `armed`, `next` |
| `kb_repo_history` | `id`, `message`, `author`, `date` |
| `kb_repo_search` | `path`, `line`, `title`, `snippet`, `score` |
| `kb_grades` | `id`, `worker`, `task`, `grade`, `status`, `timestamp` |
| `kb_trace_list` | `id`, `title`, `agent`, `startedAt`, `updatedAt`, turn count |
| `kb_terminal_list` | `id`, `name`, `status`, `cwd`, `agent`, `startedAt` |

Also completed:

- Uniform `{items,total,offset,limit,next_offset}` responses.
- Defaults `limit=20`, `offset=0`; maximum limit 100.
- Budget overflow now removes trailing items, sets `truncated`, and preserves a usable continuation offset.
- Get-tool strings truncate to 2,000 characters while preserving structure.
- Empty legacy analytics summaries fall back to up to 40 top-level key metrics.
- README documents pagination and every projection.
- Red-on-revert coverage verifies both 40-item pagination and that oversized pages never regress to whole-payload markers.
- Added all-list projection coverage.

Verification:

- `npm test`: 31 tests passed.
- `npm run build`: passed.
- ASCII check: passed.
- Git status within the package: only the expected untracked package.
- No commit created.

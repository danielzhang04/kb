Binding on every dashboard surface. A PR that violates a rule needs an explicit exemption in its body.

1. Render exactly ten destinations in three unlabeled, hairline-separated groups: Home, Inbox, Schedules, Terminal; Agents, Workflows, Tasks, Projects, Files; Health.
Violations look like: group headers, `+ New`, Activity, Atlas, Agent Platform, Approvals, Connectors, Ledgers, Sentinel, or a Deploy/Learnings page.

2. Agent and Workflow are the only runnable nouns; a loop is always a schedule attached to one, and System agents render last in a collapsed group.
Violations look like: loop cards, maintenance-only page types, undeclared schedule owners, or System agents mixed into project groups.

3. Entity cards show only Title Case name, status pill, model badge, last/next line, VM/Desktop chip, and a nonzero gate badge; grid is default and list choice persists.
Violations look like: tools, ids, purpose, autonomy, action buttons, run counts, empty badges, one-per-row-only rosters, or forgotten layout choice.

4. Open an entity in a right slide-in that preserves list state; Live is default, Brief is the one-minute read, and one Details button contains all technical material closed by default.
Violations look like: replacing the list, losing scroll/filter, multiple technical accordions, exposed schemas/ceilings above the fold, or Details open initially.

5. A run is its full-width live/replay stream with one inspector; gates resolve there, and T3 responses require pinned WebAuthn or are refused.
Violations look like: stream tiles, a fleet graph, separate Watch/Test/Lint/Trace pages, replay/live drift, Inbox run gates, or downgraded T3 approval.

6. Derive gate badges from one store query and count each waiting run once on its noun destination, entity card, and Live tab; never put run gates in Inbox.
Violations look like: three mutable counters, counting requests instead of runs, stale badges after response, or a HumanRequest Inbox item.

7. Schedules lists the live store only; create, arm, disarm, and Delete apply immediately, while main-authorized seeds and asynchronous repo mirrors stay out of row state.
Violations look like: file-first mutations, pending-PR rows, unmerged seeds armed, proposed/unscheduled rows, timezone UI, or a second firing clock.

8. Inbox contains pinned PRs, deployment, asset-pull, and escalation subjects; deployment keeps Confirm/Deploy/Inspect/Abort/Acknowledge/close-and-continue.
Violations look like: run gates, read/snooze/archive, merge controls, missing asset or PTY-quiescence actions, unpinned links, resolved items, or false empty.

9. Learnings are System-agent runs and filesystem proposals implemented through a branch PR; merged means implemented, and the dashboard shows no learning history.
Violations look like: miners editing targets, hand-trigger-only maintenance, worker commits, direct-main writes, a second PR publisher, or learning panels/history.

10. Terminal owns the viewport; Linux PTYs run as `kb-shell` through the broker, use ops/worktree roots only, and bind control to one browser session.
Violations look like: `kb-dashboard`/root children, state/release/activation access, cross-session takeover, raw command/path/env inputs, or managed credentials.

11. Health is the only System page: row sections for fleet, STOP, daemon/machine/release, project MCP wiring, and usage with spend omitted; STOP is its only control.
Violations look like: health tiles, decorative fleet nodes, separate Connectors/Ledgers/Sentinel, pause/deploy controls, hidden probe failures, spend, or multiple STOP implementations.

12. Home shows only running cards, linked needs-you counts, next three fires, live VM version chip, and last ten outcomes; every summary comes from its owning source.
Violations look like: panel grids, project/KPI tiles, proposed schedules, `Recent N` bars, cached release guesses, decorative metrics, or zeroes fabricated from failed reads.

13. Use Geist-neutral tokens, hairlines, tight rows, condensed sans headers, sans body, mono tabular times/ids/streams, blue only for focus/selection, and semantic colors only for state.
Violations look like: decorative icons outside rail glyphs, uppercase group headers, nested boxes, promotional copy, blue status, nonsemantic color, raw ids as names, or dead CSS.

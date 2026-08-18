# Agent Platform Wave-1 overnight build — handoff — 2026-08-18

**Topic:** Planned an all-around (function + UI) Wave-1 build of the "kb Agent Platform"
to run UNSUPERVISED overnight in a fresh Fable terminal, leaving non-merged, tested,
reviewable functionality + an isolated review dashboard by morning. Everything the run
needs is committed on branch `claude/agent-platform-w1`.

### What WORKED (with evidence)
- **Full plan committed + pushed** on `claude/agent-platform-w1` (tip `16c1cdf0`, based on
  current `origin/main` `0554dc81`). Files: `docs/plans/2026-08-18-agent-platform-{GOAL-STATE,
  w1-BUILD-PLAN,program-spec}.md`, `LAUNCH-PROMPT.md` (exact launcher + cwd), the 6 grounding
  analyses under `docs/research/_ig-saved/analysis/`, current-state map, build-backlog. Remote
  == local verified each push.
- **Isolated worktree** at `C:\Users\danie\kb-worktrees\agent-platform-w1` — the overnight run
  runs here, current with main, clear of the main checkout.
- **Grounding** done by 6 parallel analysis agents (all model-verified): 4 IG reference videos
  (UI/UX + deep capabilities/infra), current-state capability map, build backlog, and 4
  subsystem analyses (context / eval / agent-runtime / lifecycle-hooks). Key facts they
  established are baked into the plan.

### What Did NOT Work (and why) — don't retry these
- `git checkout -b <new> origin/main` from the MAIN checkout ABORTS: the main checkout holds
  untracked files that `main` tracks (e.g. `dashboard/server/control/test-fixtures/*`).
  **Fix that worked:** `git worktree add <path> -b <branch> origin/main` — a fresh worktree has
  no conflicting untracked files. Use this for any main-based branch here.
- Basing new work on the local `claude/boss-2026-08-17` branch: it is **227 commits behind
  main** with 364 dashboard files / ~50k lines of drift — a dashboard built on it would be
  uselessly stale. Always base dashboard work on `origin/main`.

### What Has NOT Been Tried Yet
- The overnight run itself has not been launched. Daniel launches it (fresh Fable terminal,
  cwd = the worktree, paste `LAUNCH-PROMPT.md`).

### Current State of Files
| File (on `claude/agent-platform-w1`) | Status | Notes |
| --- | --- | --- |
| `LAUNCH-PROMPT.md` | DONE | exact launcher + how-to-launch |
| `docs/plans/2026-08-18-agent-platform-w1-BUILD-PLAN.md` | DONE | 16 units, pipeline, lanes, boundaries, deliverable |
| `docs/plans/2026-08-18-agent-platform-GOAL-STATE.md` | DONE | north star + invariants (re-injected each unit) |
| `docs/plans/2026-08-18-agent-platform-program-spec.md` | DONE | 7-sub-project decomposition + waves |
| `docs/research/_ig-saved/analysis/*.md` (6) | DONE | grounding analyses |
| worktree `kb-worktrees/agent-platform-w1` | LEASE | remove when this branch merges/ends |

### Decisions locked (context for review)
- Subscription-only (local embeddings; keep-on via Stop-hook not SDK); **Second Brain deferred**
  (Agent SDK = metered spend, forbidden until Daniel opens a budget-guarded lane).
- Standalone branch; **rebase/merge to GitHub only after VM kb goes live** (Gate-1 now CLOSED).
- Business features (CRM/funnel/payments/ads/finance) OUT of scope; the *ability to build/manage
  complex agents* is the north star.
- **U8** = adapt SELECT ECC context-persistence parts (drop GateGuard), not net-new.
- UI = **inspired, not copied**: fleet/agent-connection graph, watch-agents-run live view,
  dashboard-wide theme/color upgrade added.
- Loop safety: authored acceptance bars in the plan; **two fresh-context reviews per unit**
  (unit Inspector + goal Auditor); retry cap 2 → BLOCKED, no spin; inert meta-infra (hooks not
  wired); dry-run cleanser; nothing merges.

### Pending decision-notes the run will surface (for Daniel's morning review)
- ECC reclaim scope; embedding-model choice; review-dashboard port (plan says 4630); keep-on cap.

### Exact Next Step
Launch the overnight run: open a fresh **Fable** terminal, cwd
`C:\Users\danie\kb-worktrees\agent-platform-w1`, paste the prompt from `LAUNCH-PROMPT.md`.
In the morning: pull the branch, open the isolated dashboard on the reported port + unlock,
read `MORNING-REPORT.md`, review DONE units + decision-notes.

### Load list
- `LAUNCH-PROMPT.md`
- `docs/plans/2026-08-18-agent-platform-w1-BUILD-PLAN.md`
- `docs/plans/2026-08-18-agent-platform-GOAL-STATE.md`
- `docs/research/_ig-saved/analysis/` (subsystem analyses)
- `docs/research/_ig-saved/current-state-capability-map.md`

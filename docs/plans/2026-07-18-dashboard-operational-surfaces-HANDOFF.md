# HANDOFF — Dashboard operational surfaces (2026-07-18)

**Branch:** `codex/dashboard-operational-surfaces` (from `ops`)

**Scope completed:** terminal workspace persistence, Composer authentication and truthful artifact outcomes,
Runs/Workflows information architecture, and the highest-risk write-path invariants found during the backend
audit. No `AGENTS.md`, governance, card-schema, runner, or project-contract files were changed.

## What now works

- Terminal tabs are owned by the application shell instead of the current route. Navigating to another
  dashboard view or opening Composer hides the terminal surface without unmounting xterm or closing its
  WebSocket. A tab remains until its close action tears down that PTY.
- The in-process PTY route runs the fleet preamble first and writes exactly one audit row per allowed-origin
  open attempt. Authentication, concurrency caps, spawn failures, byte I/O, resize, shell exit, and explicit
  close are covered by current-route tests.
- Composer has point-of-action passkey sign-in for both chat and deploy, preserving the draft while signing
  in. Primary and follow-up saves resolve the newly minted token immediately.
- Composer is a read-only planning surface. Its Claude subprocess is forced to `--permission-mode plan` with
  only `Read,Glob,Grep`; edits and shell commands stay behind explicit governed deployment routes.
- `New Agent` has a complete declaration form. Deploying it registers `agents/<id>.md` with
  `runner-bound: false`; it does not pretend to provision a runner.
- The New menu states its real outcome: Idea — Plan; Task — Quick launch; Workflow/Skill/Project — Register;
  Agent — Declare.
- The former Pipeline destination is visibly named **Runs**. It truthfully describes itself as a read-only
  dependency graph of launched queue cards, not a workflow editor. Workflows lists registered definitions.
- New direct cards with dependencies and reruns now start `blocked`; roots retain the normal `inbox` state.
- Launch and rerun pull/rebase `ops` before card creation, then commit the exact new card path and local audit
  row together. They no longer create a card followed by an audit-only commit.
- Coordination writes now prove the checkout is exactly local `ops` before pull and again before staging;
  another branch or detached HEAD fails closed instead of reporting success for an unpushed commit.
- Governed save runs STOP/API-key/budget preamble checks before its module-level session re-verification or
  filesystem mutation. The HTTP origin/rate/session prehandler still runs before the save module is invoked.
- A post-spawn PTY audit failure now reaps the shell, releases its concurrency slot, and closes the socket.
- Composer treats stderr/non-zero exits as failed turns, aborts its child stream on unmount, prevents primary
  deploy double-submit, and clears pending UI state after rejected requests.

## What “research and build Atlas” does today

1. Signed out: Composer offers passkey sign-in and preserves the prompt.
2. Signed in: Claude can read the repository and help plan the work, but cannot edit files or run commands.
3. Choosing Deploy can file one queue task or register a workflow, skill, project scaffold, or agent declaration.
4. It does **not** compile the conversation into a runnable multi-agent DAG, activate a skill, provision a
   runner, or automatically build Atlas.

That boundary is intentional. The current backend is not yet safe or complete enough to imply otherwise.
`orgs/atlas-prep/contract.md` also requires review before downstream use of research drafts, while the current
dispatcher has no mid-DAG human approval/resume primitive.

## Backend readiness matrix

| Capability | Current state | Next load-bearing work |
|---|---|---|
| Terminal tabs across dashboard navigation | Working | Browser-refresh/server-restart reattach needs a daemon-owned session registry, output ring buffer, and TTL |
| PTY identity/isolation | Temporary | PTY runs as the dashboard daemon OS user with a credential-filtered child environment; restore cross-user isolation and per-open Factor C before calling it constrained |
| STOP for new PTYs | Working | Active STOP does not drain already-running shells; add daemon lifecycle ownership and a STOP watcher |
| Composer planning | Working, read-only | Add deterministic structured proposal/apply-to-form output rather than manual transcription from chat |
| Task filing | Working | Execution still requires a registered, runner-bound owner and an active runner |
| Workflow registration | Working, inert | Add versioned schema, trusted-main loading, strict DAG compiler, and atomic multi-card launch endpoint |
| Workflow visualization | Working as Runs | Scope/group graphs by workflow run ID once runnable workflow instances exist |
| Agent declaration | Working, inert | Human runner binding/provisioning and heartbeat proof remain required |
| Skill registration | Working, inert | Add an allowlisted card field and runner-enforced curated-skill invocation; learned skills must not auto-activate |
| Dependency release | Partial | Codex runner currently sends only `## Work order`; dispatcher-appended `## Result from ...` sections do not reach downstream Codex stages |
| Model routing | Partial | Codex runner records model intent but does not pass the resolved model to `codex exec` |
| Card routing write transaction | Residual | `cardRouting` still mutates locally before `routeCoordination()` pulls; give it the same prepare/commit transaction seam |

Additional write-path residuals from adversarial review:

- Launch/rerun still cannot roll back a local card/audit mutation when audit, commit, or push fails. They do not
  report success, but retry/recovery needs an explicit transaction journal or reconciliation routine.
- Durable save commits and pushes before opening the PR. A failed or already-existing `gh pr create` can report
  failure after the remote mutation, and project follow-up saves reuse the same fixed branch.
- Composer request teardown is now wired from the client, but the server attaches its disconnect kill handler
  after synchronous spawn/audit setup; close that small race in the next backend hardening pass.
- Browser sessions have no client-side expiry timer, and an already-open PTY does not revalidate session expiry.

## Recommended workflow-run vertical slice

Use the existing card `workflow` field as a workflow-instance ID; do not change card schema for the first slice.
Register a `schema: kb.workflow/v1` definition containing a bounded JSON DAG (maximum 32 T1/T2 stages). Every
stage declares project, action, target, work order, role, owner, runtime, model, and stage dependencies.

Add `POST /api/write/workflow-runs` accepting only a workflow ID plus the expected SHA-256 definition hash.
The server must load the exact definition from protected `main`, validate the whole acyclic graph and every
runner-bound owner/runtime/model before any mutation, expand all cards in one fixed Python invocation, stamp a
shared run ID, translate stage dependencies to minted card IDs, and commit every exact card path plus one audit
row in one `ops` transaction. Roots start `inbox`; every dependent starts `blocked`. Reject T3 and mid-run human
gates in v1.

Before claiming real agent chaining, also fix downstream result delivery with an explicit trust boundary:
dependency output is evidence/data, never authority that can rewrite the downstream work order. Then enforce
the resolved model in the Codex runner and add a curated-skill allowlist understood by both card validation and
the runner.

## Verification at this stop point

- Full Vitest run after the adversarial fixes: 127 test files passed; 937 tests passed and 1 skipped.
- `npm.cmd run typecheck`: passed.
- `npm.cmd run build`: passed.
- `git diff --check`: passed (Git emits expected CRLF conversion warnings on this Windows checkout).
- Python `pytest` was not available in the active Python environment; no Python production files changed.

## Known provenance and cleanup

- The terminal multi-tab/PTy work and `@xterm/addon-fit` package changes existed as uncommitted task-relevant
  work when this branch was cut; they were reconciled, hardened, tested, and intentionally preserved.
- `orgs/faceless-youtube/.claude/settings.local.json` was pre-existing, untracked user state and remains untouched.
- Do not merge this branch directly into a protected branch. Review the final diff, commit as `codex-worker`, and
  use the repository's human/cloud PR path.

# Onboarding a new non-Claude CLI worker

Generic checklist for adding any one-off, non-Claude CLI worker (Codex, Gemini, or a future
CLI) behind the Wave-1 approval-hardening boundary. **Codex is the only worker onboarded in
month 1** (`docs/plans/2026-07-16-m1-fleet-implementation.md` decision 1); **Gemini is
deferred for month 1 on privacy grounds** (its free tier trains on submitted data) — the path
below is identical for it, or any future CLI, once cleared to join. Background:
`docs/specs/2026-07-16-m1-fleet-architecture.md` D3 (adapter pattern) and the trust-anchor
invariant (top of that doc, re-audited at Wave 5.8/5.9).

## 0. Prerequisites
- Wave-1 approval hardening (I1 + I3 + T10) merged to `main`. Any new worker's ops-push access
  is **hard-gated behind that exit**; Phase A below is read + own-branch push only.
- Worker CLI installed on the desktop box; its native curated-skill discovery mirror is generated
  and drift-guarded by `sync_skills.py` (Codex discovers the `.agents/skills/` mirror).
- Shared preamble (`scripts/preamble.py`) and the `STOP`-file convention understood.

## 1. Identity (git author)
1. Assign a dedicated agent id (e.g. `codex-worker`); register it in the governance identity
   list at Phase B (`governance/agent-rules.md` #2: `<agent-id>@agents.local`).
2. Set `git config user.name <agent-id>` / `user.email <agent-id>@agents.local` in the
   worker's worktree before its first commit. Never impersonate another identity or a human
   in `governance/humans.yaml`.
3. Commits land only on the worker's own agent branch (`codex/*`, `gemini/*`, ...) — never
   `main`, never `ops` until Phase B.

## 2. Credential posture
4. **Subscription/device-auth only — no API keys in the runner's env.** Codex:
   `codex login --device-auth`, auth in `~/.codex/auth.json`; the runner asserts
   `OPENAI_API_KEY`/`CODEX_API_KEY` **unset** every run (enforceable, mechanical — the
   metered-billing trap, analogous to the shared preamble's `ANTHROPIC_API_KEY` check). A
   future worker needing a free-tier key instead must treat "no billing enabled" as a
   **human-maintained invariant, not a mechanical guard**, and document it explicitly.
5. Stale/missing auth → runner **fails loud** (wake-me card, non-zero exit); it never falls
   back to a metered API.
6. Never handle a credential as an object: no secret is ever written, printed, or persisted
   in cards, ledgers, memory, commit messages, or logs. Ambient runtime credentials may be
   read into the process env only for a short-lived run, mirroring
   `scripts/desktop_poll.ps1`'s credential-manager-to-env-var pattern.

## 3. Git access (the trust-anchor invariant)
7. **MANDATORY.** The agent's environment gets **git-transport-only access: an SSH deploy
   key scoped to its own work branches.** It must **NEVER** hold a REST/PR-write/
   `Contents: write` GitHub token in any agent env. Opening a PR is **always delegated** —
   cloud GitHub-App leg or a human — never done by the worker via a REST call. (This is what
   keeps GitHub's `web-flow` signature a human-only signal elsewhere in the fleet.)
8. **Phase A (default):** provision an SSH read/write deploy key scoped in practice to
   `<worker>/*` push. Because deploy-key scope alone doesn't restrict by branch prefix,
   **provision a GitHub push ruleset blocking direct pushes to `ops` and `main`**
   (require-PR) — the ruleset enforces the restriction, not the key.
9. Store the key via SSH agent / OS credential manager only — never committed, printed, or
   pasted into a card/ledger. Audit that the worker's own sandbox/config (Task 5.4 pattern)
   denies reads of `~/.ssh/` and other credential-store paths.
10. **Phase B (only after Wave-1 lands on `main`):** grant a scoped ops-push path — still a
    deploy key, still git-transport only. Register the worker in the governance identity
    list; keep its task types `queues-for-me` until grades promote per
    `(worker, project, task_type, tier)` (`governance/risk-tiers.md`). Re-audit the
    trust-anchor invariant at both Phase A and Phase B — it's a first check for any new
    worker env.

## 4. Runner registration
11. Preamble-gated Task-Scheduler runner mirroring `scripts/desktop_dispatch.ps1` /
    `desktop_poll.ps1`: pin the interpreter once (never bare `python`), run
    `scripts/preamble.py` before any CLI invocation, treat its STOP/budget exit code (2) as a
    clean stop distinct from a crash.
12. **STOP-gated** between units of work, not only at startup.
13. Register the Task Scheduler task **Disabled** until its go-live human gate — enabling it
    is a human action.
14. Route work via the `agent:` cadence key (`dispatch.py`) so `cards.claim(card, agent)`
    sets `owner`; the worker never self-claims a card.

## 5. Verification checklist
- [ ] Git identity correct in the worker's worktree; never impersonates a human/other agent.
- [ ] No API key / billed credential in the runner's env; subscription auth works headless.
- [ ] Stale-auth path fails loud, never falls back to a metered API.
- [ ] Deploy key is git-transport only — a `git push` works; the same credential cannot reach
      the GitHub REST API.
- [ ] Push ruleset blocks direct pushes to `ops`/`main` for this key.
- [ ] Worker's own sandbox/config denies reads of `~/.ssh/`, `~/.claude/`, its own auth path.
- [ ] Runner pins the interpreter, runs the preamble first, re-checks `STOP` mid-run.
- [ ] Task Scheduler task registered Disabled; a human explicitly enables it.
- [ ] `agent:` routing verified: claimed cards show the correct `owner`; no self-claiming.
- [ ] PR-open confirmed delegated (cloud GitHub-App leg or human) — worker has no path to
      open or merge a PR itself.

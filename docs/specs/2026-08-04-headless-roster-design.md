# Headless roster — design

Date: 2026-08-04 · Approved by Daniel (boss session, Fable 5) · Branch `claude/headless-roster`
(stacked on `claude/fyt-paid-wiring` @ f55b932; merge order: paid-wiring first)

## Problem

The roster executor drives the interactive claude/codex TUIs through ConPTY and infers state by
regex-matching screen chrome. Every first-run dialog (trust wall, external-CLAUDE.md-imports modal),
login screen, and CLI chrome change is a new way to hang: 4 of 4 live claude roster boots parked at
`roster-delivery-boot-not-ready`. Root cause proven 2026-08-04 by raw-PTY ConPTY repro: claude
v2.1.221 halts pre-REPL on "Allow external CLAUDE.md file imports?" (`@BOSS.md` in root CLAUDE.md,
worker cwd inside `orgs/faceless-youtube`). The class of failure is the architecture, not any one
dialog.

## Decisions (locked with Daniel)

1. **Headless first** — no further validation on the PTY stack; the thin-slice run becomes the
   acceptance test of this build.
2. **Both runtimes** in this arc.
3. **Full two-way stream UI** in this arc.
4. **Delete the TUI layer on this same branch** once headless validates — zero dead code at merge.
5. Worker lifecycle: **one-shot process per work order + session-resume chains** (approach A).

## Architecture

Workers and managers run as headless child processes; the runtime's own session store carries
continuity between work orders.

- **claude** (exists): `claudeWorkerAdapter.ts` — `claude -p --output-format stream-json
  --input-format stream-json`, prompt on stdin (never argv), env allowlist+denylist, kill-timeout,
  output caps, result-event parsing. `claudeSessionAdapter.ts` streams manager sessions through the
  broker with redacted public events. Extend both with `--resume <sessionId>` chains keyed
  per (runRef, agentId).
- **codex** (new): `codexExecAdapter.ts` — `codex exec - --json` first turn, `codex exec resume
  <threadId> -` for continuity; flags pinned as in `scripts/codex_dispatch.py` (subscription auth,
  `--ask-for-approval never` — exec mode cannot serve approval prompts, live-proven 2026-07-30;
  sandbox `workspace-write` scoped to the attempt worktree; network/web flags per current roster
  posture). JSONL event parsing to the same `WorkerExecutionResult` shape.
- **Binding**: the agent's binding context (identity, declaration, scope, forbidden authority)
  becomes the session's FIRST turn, delivered on stdin. The boot-ready handshake (ready.json token
  sentinel) is deleted — "booted" = the process answered; truth is exit codes and stream events.
- **Orders/results**: work order in on stdin; completion = the stream's terminal result event.
  Status-token receipt files and delivery-line typing are deleted. The token-bound completion
  receipt invariant moves to the result event payload (server correlates by operationKey it minted
  for the turn, not by trusting worker prose).

## Governance unchanged

Cards, worktrees, spend grants, `/api/control/paid-action`, human gates, T3 audit, accounting,
attempt budgets, env credential stripping — untouched. Per-path write scoping moves from delivered
`settings.json` files to the adapters' existing profile-resolved `--allowedTools`/`--permission-mode`
plus inline `--settings` allow rules (Read/Edit grammar only — Glob/Write rules are dead grammar per
claude's own startup warnings). Known caveat, already the existing adapter's posture: `-p` mode does
not enforce Read DENY rules (CLI 2.1.217 note in `activation.ts:425`), so secret protection rides
the env denylist + workspace containment, never settings denies.

## UI

Run Canvas tiles become stream views: rendered live transcript per agent (from the broker's redacted
public events) plus an operator message box. Claude: message injects mid-turn via stream-json stdin
while a turn is live. Codex: exec cannot be interrupted mid-turn — the UI marks the message "queued
for next turn" and it lands in the next `exec resume` prompt inside an inert context boundary.
Between orders (no live process), both runtimes queue. The Terminal view (manual shells) keeps the
PTY host unchanged.

## Deletions (after acceptance, same branch)

From `rosterSessions.ts` (~2,853 lines + ~2,920 test lines): launch-line builders, REPL readiness
detectors (fresh/settled) + CLAUDE/CODEX marker tables, boot handshake + ready.json, delivery-line
typing + engagement proof, screen windows. The roster scaffold (per-agent settings/mcp/orders/status
dirs) shrinks to whatever the adapters still consume. Discard the uncommitted `claudeProjectTrust`
module (headless renders no dialogs). Delete `codexDirectoryTrust.ts` iff a probe proves
`codex exec` has no trust wall; keep it otherwise. Keep the PTY host + persistentSessions (Terminal
view). Anything that exists only to interpret a screen dies.

## Error handling

Process spawn failure / nonzero exit / timeout / output-cap breach → failed attempt with stderr tail
in the event stream (existing `runTrackedProcess` discipline). No 5-minute boot watches. Session
resume of a missing/expired session id → fail closed, fresh session only via an explicit new
generation (mirrors managed-session generations). A worker that prints a completion claim without
the terminal result event is not complete.

## Acceptance

1. Unit/integration suites green (`dashboard` vitest; known unrelated fail `workflowRun.test.ts:265`
   excluded).
2. Probe evidence recorded: codex exec trust-wall behavior; claude `--resume` chain across two work
   orders; mid-turn message injection.
3. The real gate: thin-slice run end-to-end on the isolated 4620 daemon — **all-codex roster**
   (Daniel's original target), G0→G3b walked, paid images+audio via the route, render, verify,
   ≤$1.50 journal ceiling. Then the claude profile variant boots clean.
4. TUI layer deleted; suites still green; no unused exports left in `rosterSessions.ts`.

## Out of scope

Prod :5317 deployment, Phase-3 merge (T3, Daniel), remote/off-machine workers, any FYT pipeline
content changes.

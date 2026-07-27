# Handoff — dashboard operational hardening session (2026-07-19)

Continues docs/plans/2026-07-18-dashboard-execution-control-HANDOFF.md. Design + binding
invariants: docs/plans/2026-07-19-dashboard-four-fixes-design.md. Branch:
`codex/dashboard-operational-surfaces` (local until Daniel pushes; PR to main after).

## What landed (all committed, tested, live on the local daemon)

1. Daniel's four issues: composer elicitation-first planning + proposal-ready banner;
   inbox inline card resolution (`POST /api/write/card-respond`); terminal bottom-row
   clipping/TUI freeze (definite height chain + zero-padding xterm host); async git off the
   event loop (`server/write/asyncGit.ts`).
2. Concurrency architecture forced by (4): reentrant `withOpsTransaction` FIFO lock around
   every ops-checkout git transaction, `requireTransaction` runner enforcement (ops git
   outside a span rejects loudly), PTY output buffered across the audit await, preamble
   reads under the lock (false fleet-frozen fixed). See the design doc's
   "Concurrency invariant (BINDING)" — it applies to ALL future dashboard work.
3. Persistent terminal sessions: `server/pty/persistentSessions.ts` owner-bound registry;
   socket close = detach, `?session=` reattach with ring-buffer scrollback replay,
   `{type:'close'}`/`DELETE /api/pty/sessions/:id` kills, localStorage tab reconciliation.
   Viewport-fit (`.mc-main--terminal` flex column) + hidden scrollbar chrome everywhere
   (scrolling preserved).
4. Ops-side (branch `ops`): wake-me `6a5b182e-a5aaf9b0` resolved by Daniel via the new
   inline inbox flow; his option (a) enacted — HEARTBEAT.md pins `agent: dispatcher-cloud`
   on `nightly-review`/`weekly-audit` (commit `63f0f40`, Daniel-authored).
5. `DASHBOARD_SESSION_SECRET` provisioned (user env var, value never recorded anywhere) —
   sessions survive daemon restarts; TTL was already 8h.

## Operational rules (bite if forgotten)

- Restart the daemon with plain `pm2 restart kb-dashboard`. NEVER `--update-env` from a
  shell opened before the secret's `setx` — it wipes the secret from the daemon env.
- Frontend changes need `npm run build` before a restart shows them (static glob is
  startup-time); server `.ts` changes need only a restart (strip-only runtime, no build).
- Verification floor for this area (invariant §4): full vitest + `tsc --noEmit` +
  strip-types load of `server/http/surface.ts` + real daemon boot + one live governed
  transaction.

## Verify-next-morning

- Tonight's `nightly-review` should emit a card owned by `dispatcher-cloud` and execute
  (first live proof of the HEARTBEAT fix). Check `queue/` + dispatch ledgers.
- Daniel to confirm his dashboard session survived the last restart (secret proof).

## Open (small)

- Three stale `worker-desktop`-owned cadence cards (2× dated nightly-review, 1×
  weekly-audit) — cleanup card someday.
- Composer elicitation flow untested live (unit-tested only) — first "new idea"
  conversation is the smoke test.
- Advisory LOWs from the 07-19 control-plane review — folded into activation.

## Next milestone (fresh session)

Control-plane ACTIVATION, per the 07-18 handoff gates: production wiring of
broker/engine/cancellation/canonical integrator into the HTTP context; signed-T3/WebAuthn
approval-release path (replaces `t3-approval-release-not-implemented`); synthetic two-stage
acceptance with fault injection; retention purge decision. Acceptance MUST boot the daemon
(twice this session, vitest-green code failed only at boot/runtime).

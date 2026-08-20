# Atlas omni-interface handoff — 2026-08-20

**Topic:** Standalone local Atlas command center and pre-key capability foundation.

## Context

Daniel asked for Atlas to remain a standalone local app while gaining a Jarvis-like active UI,
local file and desktop-app access, typed browser interaction, Google Workspace contracts, and a
safe path for consequential work. VM access and implementation were explicitly excluded. The
implementation is complete on local branch `codex/atlas-enhancements-20260820` at commit
`280a67a9`; the remote push is the only repository-delivery blocker.

### What WORKED (with evidence)

- **Standalone UI and dashboard orb** — confirmed by 8 focused dashboard tests, TypeScript
  typecheck, production build, and standalone state-server integration tests.
- **Local files, named desktop apps, browser, and Google contracts** — confirmed by the complete
  Atlas product suite: `225 passed, 1 skipped` (platform link prerequisite), plus `pip check`.
- **Consequential-action boundary** — one-time fragment bootstrap, in-memory bearer, paired
  session/device binding, proposal hash, expiry, replay defense, atomic browser document identity,
  and redacted persistent receipts passed an independent security review with verdict `PASS`.
- **Read-only MCP** — `atlas/kbmcp/server.py` registers only `toolreg.mcp_specs()`; tests prove
  write/execute preparation tools are absent from MCP.
- **Dependency state** — dashboard production audit reports `0 vulnerabilities`.
- **Local delivery checkpoint** — commit `280a67a9` exists on the dedicated worktree branch with
  the required `codex-boss <codex-boss@agents.local>` author identity.

### What Did NOT Work (and why)

- **Remote branch push** — `git push -u origin codex/atlas-enhancements-20260820` was rejected by
  the environment approval reviewer because the private Atlas implementation would be exported to
  an unverified remote without explicit destination approval. Do not retry without Daniel's express
  approval of `origin`.
- **In-app-browser screenshot QA** — the installed Browser plugin rejected its own cached service
  module as outside the configured trusted-code path. Its skill prohibits a standalone Playwright
  fallback, so visual approval remains a desk-review item.
- **Full dashboard suite** — not claimed green; unrelated pre-existing coordination/git fixture,
  server-surface, Composer, and RunDetail failures appeared. The two changed Atlas suites are green.
- **Exact lower-model verification** — delegated workers reported only the runtime-visible family
  label `GPT-5`; the requested lower-model identity was not independently observable.

### What Has NOT Been Tried Yet

- A real signed-in browser bridge implementing the `expected_origin` + `expected_document_id`
  atomic action contract.
- Google OAuth activation in a disposable account; `google_live_enabled` intentionally remains
  `false`.
- Desk launch checks for VS Code, Chrome, Spotify, and Explorer with real Authenticode signatures.
- Hosted presentation deployment; only the local standalone app was built.

### Current State of Files

| File | Status | Notes |
| ---- | ------ | ----- |
| `atlas/ui/` | DONE | Five-tab standalone command center, active orb, transcript, pairing, work, and history. |
| `atlas/worker/actionauth.py` | DONE | Single-use bootstrap and explicit in-memory action bearer. |
| `atlas/worker/actionbroker.py` | DONE | One-shot proposal/confirm/execute coordinator with session/device binding. |
| `atlas/worker/receipts.py` | DONE | Fixed-schema append-only redacted local receipt journal. |
| `atlas/worker/localfiles.py` | DONE | Bounded root-scoped read/search and version-bound atomic create/edit. |
| `atlas/worker/desktopapps.py` | DONE | Named profiles, Win32 known folders, publisher verification, no shell/PATH. |
| `atlas/worker/connectors.py` | DONE | Typed browser and Google transports; real connections remain disabled/unpaired. |
| `atlas/worker/runtime.py` | DONE | Trusted assembly and proposal-only model adapter wiring. |
| `atlas/worker/stateserver.py` | DONE | Loopback UI/API with paired action and receipt surfaces. |
| `atlas/worker/toolreg.py` | DONE | Deny-default surface projections and untrusted evidence envelopes. |
| `atlas/config/capabilities.yaml` | DONE | Closed catalog; no VM capability. |
| `dashboard/src/components/AtlasMiniOrb.tsx` | DONE | Active global Atlas indicator. |
| `dashboard/src/views/Atlas.tsx` | DONE | Upgraded Atlas presentation. |
| `docs/audits/2026-08-20-atlas-omni-interface-build-verification.md` | DONE | Exact build and limitation evidence. |
| Remote branch | TODO | Local branch/commit exists; origin push awaits explicit approval. |

### Exact Next Step

Ask Daniel to approve pushing private commit `280a67a9` to remote `origin` as branch
`codex/atlas-enhancements-20260820`. If approved, run the exact push from
`C:/Users/danie/kb/_private/codex-worktrees/atlas-enhancements-20260820`, then begin the single
end-review activation checklist in the verification audit; do not enable Google or a signed-in
browser before that review.

### Load list

- `CLAUDE.md`
- `orgs/atlas/contract.md`
- `orgs/atlas/STATE.md`
- `handoffs/2026-08-20-atlas-omni-interface.md`
- `docs/specs/2026-08-20-atlas-omni-interface-design.md`
- `docs/plans/2026-08-20-atlas-omni-interface-GOAL-STATE.md`
- `docs/plans/2026-08-20-atlas-omni-interface-plan.md`
- `docs/audits/2026-08-20-atlas-omni-interface-build-verification.md`
- Invoke `save-session` when this active handoff is consumed or superseded.

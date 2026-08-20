# desk ⇄ VM movement — goal decisions (Daniel, 2026-08-19)

Clarifications gathered before design; the spec builds on these. Source handoff:
`handoffs/2026-08-20-desk-vm-movement-design.md` (ops).

## Scope
ALL 8 handoff items in this arc. Atlas (7–8) is decoupled: this arc designs and
stabilizes the dashboard API surface Atlas will call (remote launch, status);
Atlas features themselves are a later build.

## Goal state (acceptance bar)
- **Bar:** (1+2) resume-safe deploys + one-click-or-better deploy live and verified,
  and (6) the unified approval inbox is THE approval surface (PRs, deploys, governed
  cards, review gates — one list, one action each).
- **Designed + partially built:** (3–5) VM production floor — assets-home step,
  memory/context parity, credential/MCP provisioning.
- **Stretch (may land next arc):** a full FYT video run executing on the VM with
  assets pulled home.

## Goal function (trade-off rules)
- **Deploy semantics: straight to resume-safe.** No deferred-deploy interim. Target is
  GitHub-like behavior — pushing/deploying never waits on running work; in-flight runs
  pause at a clean boundary and rehydrate after the swap ("merging main doesn't
  disturb running terminals"). Quiescence-waiting toil is eliminated, not automated.
- **Key custody / trigger: one-click, key stays with Daniel** (2026-08-20). One local
  command/button = fetch green CI artifact → verify → sign with his desktop key →
  ship → swap. Auto-on-merge (CI/desktop-cadence key custody) is a possible future
  upgrade, explicitly NOT this arc.
- **Deploy timing: none.** Click = immediate apply, mid-run or not. Existing runs
  pause at a clean boundary (stage/attempt edge, never mid-agent-turn) and rehydrate
  ON THE NEW code — chosen over old-until-complete (blue-green) because the store is
  single-writer, and mid-run deploys are usually fixes for the run in flight.
  Guardrails: versioned run-state + migrate-on-load; a release declaring a breaking
  state migration pauses the deploy and asks instead of silently applying.
- **One-click mechanics:** the click must run on the desktop (signing key lives there;
  VM never signs). v1 = single desktop command/shortcut (fetch green artifact → verify
  → sign → ship). v2 = inbox Deploy button waking a small desktop helper over the
  tailnet. v1 ships first.

## Inbox + code-flow decisions (2026-08-20)
- **Inbox shape: hybrid.** One list of everything that wants Daniel: governed cards,
  waiting-human runs/stages, deploy confirmations (inline one-click actions — no new
  credentials needed), plus GitHub PRs via read-only token with merge deep-linking to
  GitHub. No merge-capable GitHub token on the VM, ever this arc.
- **Code flow:** VM agents push PR-ready branches + open PRs (scope-limited GitHub
  credential: branch push + PR create, main/ops protected; work must pass review
  guardrails first) → inbox notifies → Daniel merges on GitHub → Daniel one-click
  deploys. Merge ≠ deploy stays a rule: bad local-dev merges sit harmlessly until
  a deliberate deploy.

## Floor + Atlas decisions (2026-08-20)
- **Memory parity: promote into repo**, never sync `~/.claude`. Curated project
  knowledge (arcs, doctrines, resume points) moves to `memory/*.md` / org STATE
  files, which already sync; personal auto-memory stays personal.
- **Assets home: manifest + pull step.** Final pipeline stage emits an asset manifest
  (paths+hashes); `pull-assets` rsyncs exactly those files home over the existing
  tailnet SSH. Binaries never in git. Inbox item "run finished — pull home" triggers it.
- **Credentials: registry + smallest-first grants.** Governance doc listing per
  integration: kind, scope, VM location, human-gated actions. This arc provisions only
  GitHub read (inbox PR list) + verify VM git identity can push branches/open PRs.
  FYT creds (image/voiceover/YouTube) row-by-row when the stretch build needs them.
- **Atlas contract:** stable versioned API = launch / observe / act; EVERY inbox UI
  action must exist as a clean API endpoint (no browser-only flows); caller-agnostic,
  tailnet-identity authed. Atlas itself (voice, desktop control, own-domain hosting)
  is future work and deliberately unconstrained by this arc.

## Facts the design rests on (codex survey, card 6a867b1f-608a2099)
- All run/stage/attempt/session state persists in `DASHBOARD_STATE_ROOT/control/
  control-plane.json` (`dashboard/server/control/store.ts:267-282,4367-4397`); startup
  `normalizeCrash()` marks in-flight work `interrupted` — records, never resumes.
- Worker children die with the service (`KillMode=control-group`); no PID/reattach
  path exists — "pause" must mean finish-current-atomic-unit-then-park.
- Quiescence gate: 8 blockers in `[cutover] dashboard/server/release/quiescence.ts:14-24`,
  enforced by `activate_release.py:378-380` on swap and rollback.
- CI artifact `kb-platform-<sha>` is UNSIGNED; signing is desktop-local at deploy time
  (`deploy_platform_release.py` + VM-pinned pubkey verify). Arming = recomputed from
  `DASHBOARD_AUTH_MODE=tailnet` at boot; lock state is process-memory only.

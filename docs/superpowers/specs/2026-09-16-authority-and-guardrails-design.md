# Authority and Guardrails — design

**Status:** approved by Daniel 2026-09-16 ~15:45 ET (Approach 1). Implementation plan:
`docs/superpowers/plans/2026-09-16-authority-and-guardrails-plan.md`.

**Baseline:** `main` @ `7e09fd4f` — the release currently running on prod
(`https://kb.tail82dd4f.ts.net`, `DASHBOARD_AUTH_MODE=tailnet`). Every `file:line`
below is against that commit.

---

## 1. Goal and success condition

**Goal.** Make the CLI — the boss session and its workers — a first-class operator of the
kb daemon: launch runs, test, monitor, examine outcomes, resolve interventions and
completion gates, archive, manage schedules — with every mutation recorded and attributed.
Remove WebAuthn/passkeys entirely. Keep a short, server-enforced "never for a CLI" list
behind a human-signed channel rooted in Daniel's existing `kb-ops-approver` ssh key.

**Success condition (all must hold; each is a named test or a named prod observation):**

1. `grep -ril "webauthn\|passkey" dashboard/ deploy/ scripts/ --exclude-dir=node_modules`
   returns nothing but historical `docs/` prose. (T2 acceptance.)
2. `dashboard/server/authority/policy.test.ts` enumerates every route Fastify actually
   registers on the operator surface and fails if any mutating route is unclassified.
   (T1 acceptance.)
3. On the rehearsal host, the boss resolves a completion gate on a real run through
   `POST /api/control/human-requests/:requestRef/respond` with
   `X-KB-Actor: boss` and a non-empty `reason`, the run resumes and succeeds, and the
   resolved request carries `resolvedBy: { actor: "boss", tailnetIdentity, at, reason }`.
   (T9 acceptance.)
4. On the rehearsal host, `POST /api/control/runs/:runRef/reconcile-publication` answers
   `403 approval-required` with no `approval`, and `200` with an approval signed by a
   throwaway key installed as that host's allowed signer; a second call replaying the same
   nonce answers `409 approval-replayed`. (T9 acceptance.)
5. On the rehearsal host, a run that would cross the day's spend ceiling parks on the
   existing budget intervention, and `POST /api/control/budget/override` lifts it **only**
   with a valid signature. (T9 acceptance.)
6. On prod, the boss resolves the completion gate on run
   `run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5` (waiting on prod now) through the open
   respond route; the run reaches `succeeded`; `GET /api/control/files` on `brief.json`
   returns `200` for the correct digest and `404` for a tampered one. (T11 acceptance.)

---

## 2. Non-goals

- **No new authentication.** The tailnet boundary is unchanged: `tailscale serve` on a
  single-human tailnet, loopback bind, peer-uid proof, pinned `DASHBOARD_TAILNET_OPERATOR`.
  The signed channel is an *authorization* layer inside that boundary, not a second front door.
- **No change to the node surface.** `/api/v1/hosts/*`, `/api/v1/runs/:runRef/leases/*`,
  `/api/v1/runs/:runRef/reports` keep their own scope, identity guard and rate budgets
  (`dashboard/server/http/surface.ts:672`). They are not in the operator policy table.
- **No change to the worker spend path.** `POST /api/control/paid-action`
  (`dashboard/server/control/paidActionRoute.ts:37`) stays authorized by its durable
  spend grant. What changes is the *gate that mints the grant*: on a `spend`-tagged
  workflow it becomes signed-class.
- **No deploy-window server concept.** "Opening a deploy window" stays entirely a
  desktop/hook concern (`C:\Users\danie\kb-rehearsal\tooling\PROD-WINDOW.json` +
  `scripts/hooks/prod_window_guard.js`). The daemon has no window and gains none.
- **No completion-gate-optional work and no post-run automation.** Both are sub-projects 2
  and 3; see §10 Follow-ups.
- **No governance file edits by any worker.** `governance/` is human-edited only
  (CLAUDE.md). T10 produces a *proposed* diff for `governance/risk-tiers.md` D2.13; Daniel
  applies it.

---

## 3. Current state

### 3.1 Auth mode and the ceremony routes

| What | Where |
| --- | --- |
| Mode resolution + boot invariants | `dashboard/server/auth/mode.ts:175` (`resolveAuthMode`), `:221` (`assertAuthModeBoot`) |
| The constrained tailnet passkey channel (to delete) | `dashboard/server/auth/mode.ts:70` (`TAILNET_PASSKEY_ENV`), `:123` (`assertTailnetPasskeyChannel`), called at `:241` |
| Ceremony reachability gate | `dashboard/server/auth/mode.ts:83` (`ceremonyModeAdmits`), re-exported `dashboard/server/control/routes.ts:101` |
| The four ceremony routes | `dashboard/server/auth/routes.ts:205,218,257,270` (`register/options`, `register/verify`, `assert/options`, `assert/verify`) |
| Session mint from a verified assertion | `dashboard/server/auth/routes.ts:311` → `dashboard/server/auth/session.ts#mintSessionFromVerifiedAssertion` |
| WebAuthn verify primitives | `dashboard/server/auth/webauthn.ts` (204 lines, wraps `@simplewebauthn/server`) |
| Pending-challenge + credential store | `dashboard/server/auth/credentialStore.ts` (143), `dashboard/server/auth/challenge.ts` (147) |
| Browser client | `dashboard/src/lib/webauthnClient.ts` (70), `dashboard/src/lib/authClient.ts` (232), `dashboard/src/control/ExecutionUnlock.tsx` (268) |
| Python verifier (unused by the daemon) | `scripts/webauthn_verify.py` (805), `tests/test_webauthn_verify.py` (598) |
| Card-approval assurance | `dashboard/server/approvals/cardVerifier.ts` (156), `dashboard/server/approvals/assurance.ts` (48), route `dashboard/server/approvals/routes.ts:49` |

The mode seam itself lives in one place: `dashboard/server/http/middleware.ts:106`
(`resolveSession`). In `tailnet` mode the transport is the credential; a session is *minted*
for the request and every downstream gate keeps working. Nothing about that changes.

### 3.2 Human-request respond routes

| What | Where |
| --- | --- |
| Generic respond route (thin) | `dashboard/server/control/routes.ts:1985` |
| Body wall + service mapping | `dashboard/server/services/runReadService.ts:128` (`respondHumanRequestRoute`) |
| The decision service | `dashboard/server/control/humanResponse.ts:241` (`createHumanResponseService`) |
| T3 ceremony block inside it (to delete) | `dashboard/server/control/humanResponse.ts:144-167` |
| T3 challenge mint (to delete) | `dashboard/server/control/routes.ts:1886` |
| Iteration-gate resolve | `dashboard/server/control/routes.ts:2243`; its challenge mint `:2115`; its ceremony service `dashboard/server/control/humanResponse.ts:~380` (`createIterationGateCeremonyService`) |
| Deploy-purpose ceremony | `dashboard/server/control/routes.ts:1929` (mint), `dashboard/server/control/humanResponse.ts:~255` (`createDeployCeremonyService`), consumed by `dashboard/server/inbox/routes.ts:395-457` |
| v1 respond | `dashboard/server/api/v1/routes.ts:683` |

`T3_KINDS` (`humanResponse.ts:209`) is `{approval, review, governance-refusal}`; an
`intervention` has always been T2 and never ran a ceremony.

### 3.3 Audit log writer

`dashboard/server/audit/log.ts`:
- `AuditEvent` shape: `:44`.
- The **single** row-write point: `appendAuditRowLocal` at `:84`, which calls
  `attributed()` at `:108` to stamp `detail.tailnetIdentity` from
  `dashboard/server/auth/operator.ts#currentAttribution`. Every writer — including
  `pty/route.ts`, which bypasses `http/context.ts#auditFn` — passes through here.
- Ledger path `ledgers/audit/dashboard-audit.ndjson` (`:37`); ops commit at `:129`;
  branch guard at `:224`.

Attribution is bound per request in `middleware.ts:120` (`bindAttribution`) and reset at
`:114`.

### 3.4 Execution latch sources

`dashboard/server/control/activation.ts:751`:
`export type ExecutionUnlockSource = 'passkey' | 'env-override' | 'tailnet';`
- `isOperatorUnlockSource` (`:759`) admits `passkey` and `tailnet`.
- In tailnet mode the latch is armed **at boot** with `source: 'tailnet'`, and `unlock()`
  short-circuits on an already-constructed execution — so no ceremony can re-source it.
- Routes: `POST /api/control/execution/unlock` `routes.ts:724`,
  `POST /api/control/execution/lock` `routes.ts:745`.

### 3.5 Workflow definition parsing

`dashboard/server/workflows/defs.ts`:
- `WorkflowDef` interface `:267`.
- `parseWorkflowDef` `:1103`; frontmatter split `:335`; the **closed top-level key
  allowlist** `:1120`.
- Stage key allowlist `:913`; human-gate allowlist `:786` (`spendAuthorization`,
  `publicationAuthorization`).
- `validation-slice` publish/T3 refusal `:1258` — the existing precedent for "this
  workflow class may not publish".
- Scanner: `dashboard/server/workflows/routes.ts:252` (`scanWorkflowDefs`), re-exported and
  used by `dashboard/server/control/routes.ts:58`.

### 3.6 Budget and the budget intervention

`dashboard/server/control/activation.ts`:
- `DEFAULT_BUDGET` `:136` — `{maxAttempts: 300, maxInputTokens: 6_000_000,
  maxOutputTokens: 400_000, maxCostUsdMicros: 20_000_000}`. The cost ceiling is
  `governance/budget.yaml`'s `daily_usd_limit: 20.00` exactly.
- `resolveWindowBudget` `:176` — per-field `KB_EXECUTION_BUDGET_*` env overrides,
  fail-loud on an unparseable value.
- Resolved once per activation `:516`, passed as `globalBudget` `:568`.

`dashboard/server/control/adapters.ts`:
- `AccountingPolicy.globalBudget` `:495`; the reserve path reads it at `:979`, `:982`,
  `:990` — i.e. **inside the mutate closure, on every reservation**.

`dashboard/server/control/execution.ts`:
- Budget interventions are created at `:2030` (attempts exhausted) and `:2345`
  (`reservation.reason`, i.e. token/cost exhausted), both via `createBoundary(..., 'intervention',
  stableHumanTitle('budget', stageId, ...))` (`:1932`, title helper `:631`).

### 3.7 Deploy validator passkey checks

`deploy/validate_vm_runtime.py`:
- `OPTIONAL_UNIT_ENV` `:43-44` includes `DASHBOARD_RP_ORIGIN`,
  `DASHBOARD_WEBAUTHN_CREDENTIALS`.
- `PASSKEY_UNIT_ENV` `:74`; `CREDENTIAL_ENV_EXEMPT` `:83`; `PASSKEY_DROP_IN` `:89`.
- `_validate_passkey_drop_in` `:336`; `_validate_passkey_channel` `:373`;
  `_provisioned_credential_count` `:398`.
- Call sites: `:510-515` (drop-in trust set) and `:550`.

`deploy/bootstrap_vm.py:339-369` refuses a rendered fragment that carries the pair.
`scripts/vm_launch_preflight.sh:372-427` is the shell mirror.
`deploy/systemd/kb-dashboard.service` carries neither (they live in a drop-in).

### 3.8 The signed channel that already exists

The outbox drain already verifies a human signature, and this design copies its discipline
verbatim:

`scripts/promote_vm_outbox.py`:
- `APPROVAL_PRINCIPAL = "kb-ops-approver"` `:41`; `APPROVAL_NAMESPACE =
  "kb-ops-instructions"` `:42`; anchored success token `_GOOD_SIGNATURE` `:46`.
- `require_instruction_approval` `:480` — reads raw bytes once, runs
  `ssh-keygen -Y verify -f <allowed-signers> -I <principal> -n <namespace> -s <sig>`
  with the message on **stdin**, then requires `returncode == 0` **and** empty stderr
  **and** an anchored stdout match, and only then parses the payload and compares it to the
  server-recomputed binding (`:517`).

Desktop side: `C:\Users\danie\kb-backups\kb-ops-approver.allowed-signers`, consumed by
`drain-step2-v2.ps1:25,80` (`--approval-allowed-signers`); Daniel's signing command is the
hook's C4 shape (`scripts/hooks/prod_window_guard.js`, `ssh-keygen -Y sign -f <key> -n
kb-ops-instructions <approval.json>`).

### 3.9 The session hook

`scripts/hooks/prod_window_guard.js` (checked in but **untracked** at `7e09fd4f`; it lives
in the working tree with `tests/hooks/prod_window_guard.test.js`, 293 lines, `node --test`).

- Rule A: prod-targeting classifier (`isProdTargeting`), A4 = a prod-defaulted script name.
- Rule B/C: window CLOSED blocks every prod-targeting command; window OPEN blocks `Agent`
  and admits only the anchored shapes C1–C12.
- C8 pins `-Workflow` to exactly `self-lint-report|v1-acceptance-demo`; C9–C12 pin
  `prod-schedules.ps1`'s four modes.
- Rule D: standing blocks D1–D8, enforced with or without a window.
- Fail-closed on its own exceptions when the payload smells of prod.

Desktop scripts in `T = C:\Users\danie\kb-rehearsal\tooling`: `prod-run-workflow.ps1`
(launch + poll, never approves — see its lines 9-10), `prod-schedules.ps1` (list / disarm
agent cadences / arm-from-snapshot / create one workflow cadence), `drain-v2/*`,
`kb-deploy.ps1`, `vm-preflight-prod.ps1`, `prod-stop-run.ps1`, `prod-canary-launch.ps1`.

---

## 4. Design

### 4.1 Route classes enforced by the daemon

**New module `dashboard/server/authority/policy.ts`.** One exported table is the single
source of truth:

```ts
export type AuthorityClass = 'open' | 'signed' | 'none';

export interface RouteAuthority {
  /** Fastify's registered url template, verbatim (`req.routeOptions.url`). */
  readonly path: string;
  readonly method: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  readonly cls: AuthorityClass;
  /**
   * Which concrete path parameter becomes the approval's `entityRef`.
   * `null` for a signed route whose entity comes from the body (see `entityFromBody`).
   */
  readonly entityParam: string | null;
  /** Signed routes only: derive `entityRef` from the already-parsed body. */
  readonly entityFromBody?: (body: Record<string, unknown>) => string | null;
  /**
   * Present on exactly the two respond routes. `'workflow-tag'` means: `open` normally,
   * `signed` when the run's workflow carries a `publish` or `spend` tag. The escalation is
   * evaluated in the decision service (§4.5), not in the preHandler, because only the
   * service already holds the store.
   */
  readonly escalate?: 'workflow-tag';
}

export const ROUTE_AUTHORITY: readonly RouteAuthority[];

/** Exact-match lookup. Unknown route ⇒ `null`, which the gate treats as a refusal. */
export function classifyRoute(method: string, path: string): RouteAuthority | null;

/**
 * Path prefixes that must have ZERO registered routes. The `none` class is not a runtime
 * refusal — it is the assertion that the route does not exist.
 */
export const FORBIDDEN_ROUTE_PREFIXES: readonly string[];
```

**Open** (the CLI's ordinary working set — no signature, still session-gated, still audited):

| Route |
| --- |
| `POST /api/workflows/:id/launch`, `POST /api/write/launch`, `POST /api/write/rerun`, `POST /api/v1/runs`, `POST /api/control/proposals/:proposalRef/revisions/:revision/launch` |
| `POST /api/control/human-requests/:requestRef/respond` *(escalate: workflow-tag)* |
| `POST /api/control/iteration-gates/:requestRef/resolve` *(escalate: workflow-tag)* |
| `POST /api/v1/runs/:runRef/human-requests/:requestRef/respond` *(escalate: workflow-tag)* |
| `POST /api/control/runs/:runRef/manager/stop`, `.../manager/steer`, `.../manager/messages`, `.../manager/successor`, `.../agents/:agentId/messages`, `.../activate`, `.../stages/:stageRef/reroute`, `POST /api/write/stop` |
| `POST /api/control/runs/:runRef/archive` |
| `POST /api/schedules`, `POST /api/schedules/:id/arm`, `POST /api/schedules/:id/disarm`, `POST /api/v1/schedules` |
| `POST /api/control/execution/lock`, `POST /api/control/execution/unlock` |
| `POST /api/write/save`, `/api/write/routing-override`, `/api/write/card-routing`, `/api/write/card-respond` |
| `POST /api/agents`, `PUT /api/agents/:id`, `POST /api/agents/:id/launch`, `POST /api/workflows`, `PUT /api/workflows/:id`, `POST /api/v1/agents`, `PUT /api/v1/agents/:id`, `POST /api/v1/workflows`, `PUT /api/v1/workflows/:id` |
| `POST /api/control/proposals/import`, `.../revisions`, `.../revisions/:revision/decision` |
| `POST /api/control/runs/:runRef/pty-sessions/:sessionId/controller`, `DELETE /api/pty/sessions/:sessionId` |
| `POST /api/auth/browser-session`, `POST /api/approvals/verify` |
| `POST /api/control/retention/dry-run` (read-shaped; writes nothing) |

`GET /api/control/files` and every other GET is a read: outside the table, unchanged.

**Signed** (the "never for a CLI" list):

| Route | `entityRef` |
| --- | --- |
| `POST /api/control/budget/override` *(new, §4.6)* | `windowDay` from body (`YYYY-MM-DD`) |
| `POST /api/control/runs/:runRef/reconcile-publication` | `:runRef` |
| `DELETE /api/schedules/:id`, `DELETE /api/v1/schedules/:id` | `:id` |
| `POST /api/control/retention/quarantine` | `expectedPlanHash` from body |
| `POST /api/control/retention/restore` | `runRef` from body |
| `POST /api/inbox/deployment/:ref/deploy`, `/confirm`, `/abort`, `/close-ptys-and-continue`, `/acknowledge` | `:ref` |
| `POST /api/v1/deployments/:ref/acknowledge` | `:ref` |
| `POST /api/control/recovery/2026-07-31/execution-lock` | the frozen `AUTHORIZED_20260731_EXECUTION_LOCK_RUN_REF` |
| `POST /api/control/recovery/2026-08-01/failed-run-reconciliation` | the frozen `AUTHORIZED_20260801_FAILED_RUN_REF` |

**None** — `FORBIDDEN_ROUTE_PREFIXES` = `['/api/governance', '/api/credentials',
'/api/secrets', '/api/sshd', '/api/ssh', '/api/units', '/api/systemd']`. No route exists
under any of them today and the completeness test refuses one that appears. Governance
*content* is separately protected: `dashboard/server/control/policy.ts:102`
(`HUMAN_OWNED_PREFIXES = ['governance/', 'CLAUDE.md']`) refuses any write target under
them, and `dashboard/server/workflows/defs.ts:68` keeps them read-only for workflows.
Both stay.

**The gate.** New `dashboard/server/authority/gate.ts` exports
`requireAuthority(ctx): preHandlerHookHandler`, installed on the authenticated scope in
`dashboard/server/http/surface.ts:654-662` **immediately after** `requireSession` and
before every `register*Routes` call. It:

1. Reads `req.method` + `req.routeOptions.url`.
2. Non-mutating method (`GET`/`HEAD`/`OPTIONS`) ⇒ pass.
3. `classifyRoute` ⇒ `null` ⇒ `403 route-unclassified`. A new mutating route that nobody
   classified fails closed at runtime *and* red at T1's test.
4. `cls === 'open'` ⇒ pass (the escalation, if any, is the service's).
5. `cls === 'signed'` ⇒ `verifyApproval` (§4.2). On failure, reply with the mapped status
   and append the refusal audit row.
6. `cls === 'none'` ⇒ `403 route-unavailable` (belt and braces; the route should not exist).

**Deleted with WebAuthn:** `/api/auth/register/*`, `/api/auth/assert/*`,
`/api/control/human-requests/:requestRef/respond/challenge`,
`/api/inbox/deployment/:ref/challenge`,
`/api/control/iteration-gates/:requestRef/challenge`. `/api/auth/context` survives,
reduced to `{ mode }` (`ceremonyAvailable` goes).

`assertTailnetPasskeyChannel`, `TAILNET_PASSKEY_ENV`, `ceremonyModeAdmits`,
`DASHBOARD_RP_ORIGIN` and `DASHBOARD_WEBAUTHN_CREDENTIALS` are deleted, together with
`deploy/validate_vm_runtime.py#_validate_passkey_channel`, `_validate_passkey_drop_in`,
`_provisioned_credential_count`, `PASSKEY_UNIT_ENV`, `PASSKEY_DROP_IN`, and
`CREDENTIAL_ENV_EXEMPT`'s `DASHBOARD_WEBAUTHN_CREDENTIALS` entry (the two
`KB_EXECUTION_BUDGET_MAX_*_TOKENS` exemptions stay). After deletion the trusted drop-in set
is **empty**: `validate_static_unit` requires `DropInPaths` to be empty, so a stale
`passkey.conf` on the live host is a loud `ExecStartPre` failure rather than silent drift —
T11 removes it during the deploy.

The execution latch keeps `source: 'tailnet'`. `ExecutionUnlockSource` becomes
`'env-override' | 'tailnet'`; `isOperatorUnlockSource` becomes `source === 'tailnet'`.
`control/routes.ts:724`'s audit `detail.method` changes from `'session-bearer'` to
`'tailnet-operator'`.

### 4.2 The signed channel

**Wire shape.** A signed-class request body gains one key:

```jsonc
{
  "...": "the route's normal body, unchanged",
  "approval": {
    "payload":   "<the canonical JSON string, verbatim — the signed bytes>",
    "signature": "-----BEGIN SSH SIGNATURE-----\n...\n-----END SSH SIGNATURE-----\n"
  }
}
```

`payload` travels as a **string**, not an object, so the server verifies exactly the bytes
that were signed and never re-serializes. It must parse to:

```jsonc
{
  "schema":    "kb.human-approval/v1",
  "route":     "POST /api/control/runs/:runRef/reconcile-publication",
  "entityRef": "run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5",
  "actor":     "daniel",
  "issuedAt":  "2026-09-16T19:40:00Z",
  "expiresAt": "2026-09-16T19:50:00Z",
  "nonce":     "9f2c…"          // 32 lowercase hex
}
```

**Canonical form** (`dashboard/server/authority/approval.ts`):
`JSON.stringify` over the seven keys **in exactly that order**, no whitespace, no trailing
newline. The signer produces it with the same ordering. Verification does *not* re-derive
the string; it verifies the received bytes and then requires the parse to have exactly those
seven keys and no others (`hasExactKeys`, the pattern already used at
`paidActionRoute.ts:49`).

**Signing** (desktop, `T\prod-sign-approval.ps1`, §4.8):
`ssh-keygen -Y sign -f <key> -n kb-human-approval <payload-file>` → `<payload-file>.sig`.

**Verification** (`dashboard/server/authority/sshsig.ts`, modelled on
`promote_vm_outbox.py:480-517`):

```
/usr/bin/ssh-keygen -Y verify
  -f $DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS
  -I kb-ops-approver
  -n kb-human-approval
  -s <tmpfile holding the armored signature>
```

with the payload bytes on stdin. Accepted only when **all** of:
`exitCode === 0`, `stderr` empty, and `stdout` matches
`/^Good "kb-human-approval" signature for kb-ops-approver\b/`.

Mechanics, all deliberate:
- `execFile` with an absolute path, `shell: false`, `env: { PATH: '/usr/bin:/bin' }`,
  `timeout: 5000`, `maxBuffer: 64 * 1024`.
- The signature is written to a `mkdtemp`'d dir (mode `0700`) under `os.tmpdir()`;
  `PrivateTmp=true` on the unit makes that a per-service namespace. Removed in `finally`.
  `ssh-keygen -Y verify` has no stdin mode for the signature, so a temp file is required.
- `ProtectHome=true` on the unit means no `~/.ssh` is reachable; `-f` is always explicit, so
  nothing falls back to a user file.
- No in-process alternative: `dashboard/package.json` carries no sshsig implementation
  (`@simplewebauthn/*` is being removed, and nothing else verifies SSHSIG). Adding a
  dependency for this would be a supply-chain decision for one subprocess per signed call,
  at a rate measured in calls per day. Shelling out is the right trade and the drain already
  does it.

**Checks, in order** (`verifyApproval` in `dashboard/server/authority/approval.ts`):

| # | Check | Failure |
| --- | --- | --- |
| 1 | `DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS` set and the file readable | `503 approval-unavailable` |
| 2 | `approval` present, an object, with exactly `{payload, signature}` | `403 approval-required` |
| 3 | `payload` ≤ 2048 bytes, `signature` ≤ 8192 bytes | `403 approval-invalid` |
| 4 | `payload` parses to exactly the seven keys, all strings, `schema === 'kb.human-approval/v1'`, `actor === 'daniel'`, `nonce` matches `/^[0-9a-f]{32}$/` | `403 approval-invalid` |
| 5 | `route` equals the table's `"<METHOD> <path>"` for this request | `403 approval-invalid` |
| 6 | `entityRef` equals the server-derived entity (path param or `entityFromBody`) | `403 approval-invalid` |
| 7 | `issuedAt`/`expiresAt` parse as ISO-8601 `Z`; `expiresAt - issuedAt ∈ (0, 15 min]`; `issuedAt ≤ now + 60s` | `403 approval-invalid` |
| 8 | `expiresAt > now` | `403 approval-expired` |
| 9 | signature verifies (above) | `403 approval-invalid` |
| 10 | `nonceStore.claim(nonce, expiresAt)` returns `fresh` | `409 approval-replayed` |

The nonce is claimed **last**, after the signature verifies, so an unsigned request cannot
burn a nonce. Every refusal appends one audit row
(`action: 'authority-approval-refused'`, `result: '<code>'`, `detail: { route, entityRef,
actor }`) before the reply; the payload and signature are never logged.

**Nonce store** (`dashboard/server/authority/nonceStore.ts`): a durable JSON document at
`${ctx.stateRoot}/authority/nonces.json`, `{ nonce, expiresAt }` rows, written through the
same atomic-rename helper the rest of the state root uses
(`dashboard/server/atomicRename.ts`). `claim()` prunes expired rows, refuses a live
duplicate, and refuses outright above 10 000 live rows (fail closed, never evict). Durable
rather than in-memory because a daemon restart must not re-open a replay window.

**Config.** `DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS` is a **required** member of
`EXPECTED_UNIT_ENV` in tailnet mode, pointing at
`/usr/local/lib/kb/kb-ops-approver.allowed-signers` (root-owned, `0644`, public ssh key
material — it matches none of `CREDENTIAL_ENV_NAME`'s words, so it needs no exemption).
`assertAuthModeBoot` gains a matching assertion: in tailnet mode the variable must be set
and the path must be absolute. In `win32-desktop` mode an absent variable is legal and every
signed route answers `503 approval-unavailable`.

### 4.3 Actor record

**New `dashboard/server/authority/actor.ts`:**

```ts
export type Actor = 'daniel' | 'boss' | `worker:${string}` | 'unknown';
/** `daniel` | `boss` | `worker:<id>` where <id> matches /^[a-z0-9][a-z0-9._-]{0,63}$/.
 *  Anything else — absent, malformed, repeated header — is `unknown`. */
export function parseActor(header: string | string[] | undefined): Actor;
```

`X-KB-Actor` is **self-asserted and therefore never widens authority**. It is a record. The
one rule that mentions the boss (§4.5) is enforced on the *route*, identically for every
actor, so claiming `boss` buys nothing and claiming `daniel` buys nothing. This is the
single most important property of this section and T4's test asserts it directly: the same
request with `X-KB-Actor: daniel`, `boss`, `worker:x` and no header at all must get the same
status on both a tagged and an untagged run.

**Binding.** `auth/operator.ts`'s attribution object gains an `actor` field, bound in
`middleware.ts#resolveSession` next to `bindAttribution` (both modes; `win32-desktop` binds
`actor` with a `null` tailnet identity). Because `audit/log.ts#attributed` (`:108`) is the
single row-write point, every audit row — including `pty/route.ts`'s — gains `actor`
automatically.

**Audit row shape.** `AuditEvent` gains `actor?: string` at the top level (not buried in
`detail`, because it is queried); `attributed()` fills it from the bound attribution when the
caller left it unset. `detail.tailnetIdentity` is unchanged.

**`resolvedBy`.** `HumanRequest['response']` gains:

```ts
resolvedBy: {
  actor: Actor;
  tailnetIdentity: string | null;
  at: string;        // ISO-8601 Z, server clock
  reason: string;    // 1..2000 chars, non-empty after trim
} | null;             // null on rows written before this change
```

Written by `ControlPlaneStore#respondHumanRequest` from a new
`RespondHumanRequestInput.resolvedBy`, and carried onto the run event
`appendResponseEvent` emits. `null` on legacy rows is the only tolerated absence; the
projection renders it as "resolved (pre-attribution)".

### 4.4 Workflow tags

`dashboard/server/workflows/defs.ts`:
- Add `'tags'` to the top-level allowlist (`:1120`).
- `WorkflowDef.tags: string[]` — `[]` when the frontmatter omits it.
- Validation: an array of at most 8 strings, each matching `/^[a-z][a-z0-9-]{0,31}$/`, no
  duplicates. Anything else refuses the whole definition, like every other field.

**Derived, not merely declared.** A new exported pure function:

```ts
/** The tags that GOVERN this definition: what it declares, plus what its stages prove. */
export function effectiveWorkflowTags(def: WorkflowDef): ReadonlySet<string>;
```

= declared `tags`
∪ `{'publish'}` if any stage's `action` starts with `publish:` or any stage declares a human
gate with `publicationAuthorization === true`
∪ `{'spend'}` if any stage declares a human gate with `spendAuthorization === true`.

Derivation matters: a definition must not be able to escape the rule by omitting a label,
and `defs.ts:1258` already treats exactly those signals as the publish/T3 markers for
`validation-slice`.

### 4.5 Boss intervention rules

**The rule.** On `POST /api/control/human-requests/:requestRef/respond`,
`POST /api/control/iteration-gates/:requestRef/resolve` and the v1 respond route:

- `reason` is **required** — a non-empty string, ≤ 2000 chars after trim — for every
  decision, from every actor. Missing ⇒ `400 reason-required`.
- If the run's workflow's `effectiveWorkflowTags` contains `publish` or `spend`, the request
  additionally requires a valid approval for
  `route = "POST /api/control/human-requests/:requestRef/respond"` (or the resolve/v1
  spelling) and `entityRef = <requestRef>`. Missing ⇒ `403 approval-required`; the rest of
  the ladder is §4.2's.
- Otherwise the request proceeds on the open class.

**Where.** In `humanResponse.ts#createHumanResponseService`, replacing the deleted T3
ceremony block (`:144-167`), via two new ports on `HumanResponseService`'s options:

```ts
/** The governing tag set for the run this request belongs to. */
workflowTags: (actorSubject: string, runRef: string) => Awaitable<ReadonlySet<string>>;
/** §4.2's verifier, already bound to this request's route + entityRef. */
verifyApproval?: (approval: unknown) => Awaitable<
  { ok: true } | { ok: false; status: 403 | 409 | 503; error: string }>;
```

Production binds `workflowTags` to a `scanWorkflowDefs`-backed lookup keyed by the run's
workflow id; tests inject a set literal. The iteration-gate resolve route
(`control/routes.ts:2243`) gets the same two checks through
`createIterationGateCeremonyService`'s successor, `createIterationGateAuthorityService`,
which keeps that route's existing CAS and refusal ladder byte for byte and swaps only the
ceremony call for the approval call.

The decision service is the authority. The hook (§4.7) mirrors the rule on the desktop so
the boss gets a fast, local refusal, but a hook bypass changes nothing server-side.

`T3_KINDS` and `riskTier: 'T3'` on the audit row are **retained** — the row still records
that this was a T3-class decision; what changed is which channel proved it.

### 4.6 Spend

The existing `DEFAULT_BUDGET` window (§3.6) — $20/day/host in micro-USD, subscription runs
reporting $0 — **is** the CLI ceiling. Nothing about the parking behaviour changes: a
reservation that would cross it still refuses with `'global token or cost budget exhausted'`
and `execution.ts:2345` still creates the budget intervention.

**What a signed override does.** New `dashboard/server/control/budgetOverride.ts`:

```ts
export interface BudgetOverride {
  windowDay: string;            // 'YYYY-MM-DD' (UTC), the accounting window id
  additionalUsdMicros: number;  // positive safe integer, ≤ 20_000_000 per grant
  grantedAt: string;            // ISO-8601 Z
  actor: string;                // always 'daniel' (the payload's actor)
  nonce: string;                // ties the record to its approval
}

export interface BudgetOverrideStore {
  /** Sum of today's grants, 0 when none. Reads the durable document. */
  additionalUsdMicros(windowDay: string): number;
  /** Append one grant; idempotent on `nonce`. */
  grant(override: BudgetOverride): void;
}
```

Durable at `${stateRoot}/authority/budget-overrides.json`. Per-day ceiling on the **sum**:
`60_000_000` micro-USD (3× the base), so a lost signing key cannot mint an unbounded day.

**Route.** `POST /api/control/budget/override`, signed class, `entityRef = windowDay`.
Body: `{ windowDay, additionalUsdMicros, idempotencyKey, approval }`, exact keys.
Audit row before the grant (`action: 'control-budget-override-authorize'`, `riskTier: 'T3'`,
`detail: { windowDay, additionalUsdMicros, resultingCeilingUsdMicros }`); an audit failure
refuses, exactly like every other consequential route.

**Reaching the reserve path.** `activation.ts:516` resolves the window budget once, at
activation. Rather than re-plumbing activation, `AccountingPolicy` gains one optional field:

```ts
/** Resolved at RESERVE time, per window. Absent ⇒ today's behaviour, bit for bit. */
windowBudgetFor?: (windowId: string) => ExecutionBudget;
```

and `adapters.ts` replaces its three reads of `options.globalBudget` (`:979`, `:982`,
`:990`) with one local `const windowBudget = options.windowBudgetFor?.(windowId) ??
options.globalBudget;`. Production binds `windowBudgetFor` to
`(day) => ({ ...base, maxCostUsdMicros: base.maxCostUsdMicros + store.additionalUsdMicros(day) })`.
Only `maxCostUsdMicros` moves — an override buys money, never attempts or tokens.

The policy-hash machinery (`adapters.ts:769` `LEGACY_POLICIES`, `compiledPolicyUnchanged`)
compares `globalBudget` fields; `windowBudgetFor` is a function and is deliberately excluded
from the hash, so an override does not invalidate a day's accounting document. T6's test
asserts that.

**Lifting the parked run.** The override does not resume anything by itself. The parked
budget intervention is resolved through the ordinary open respond route with a `reason`; the
next reservation then fits. That keeps one resume path instead of two.

### 4.7 Session hook

`scripts/hooks/prod_window_guard.js` is generalized from an allowlist of *exact command
shapes* to a **class table over scripts**, keeping every other rule:

```js
// Open class: allowed with NO window, still subject to Rule D and to argument shape.
const OPEN_SCRIPTS = /(prod-run-workflow\.ps1|prod-respond\.ps1|prod-schedules\.ps1)/;
// Windowed class: unchanged — refused outside a window, anchored shapes inside one.
const WINDOWED_SCRIPTS = /(kb-deploy\.ps1|drain-step[12]-v2\.ps1|ops-refresh\.ps1|vm-preflight-prod\.ps1|prod-stop-run\.ps1|prod-canary-launch\.ps1|prod-sign-approval\.ps1)/;
```

Changes:

1. `isProdTargeting`'s A4 arm splits: a command naming an `OPEN_SCRIPTS` member returns the
   new rule id `A4o`; `WINDOWED_SCRIPTS` returns `A4w`. Rules A1/A2/A3/A5 are unchanged.
2. Decision order in `decide()`: standing blocks D → `A4o` ⇒ match the open shapes and
   allow, window or not → everything else prod-targeting ⇒ today's window rule.
3. `-Workflow` widens from the two-id alternation to `^[a-z0-9][a-z0-9-]{0,63}$` with the
   existing `..` veto; `-Topic` keeps its `^[a-z0-9._-]{1,40}$` + `..` veto and is no longer
   pinned to `v1-acceptance-demo`.
4. New open shape for `prod-respond.ps1`:
   `-Run <run-ref> -Request <request-ref> -Decision approve|retry|abandon -Reason "<text>"`,
   with `<run-ref>`/`<request-ref>` matching `^[a-z0-9-]{1,80}$` and `<text>` a quoted
   string of 1..300 chars containing no `` ` ``, `$(`, `;`, `&` or `|`.
5. `prod-schedules.ps1`'s C9–C12 collapse to one open shape admitting its four documented
   modes with the same `tpath()` traversal veto.
6. New **windowed** shape for `prod-sign-approval.ps1` (it drives a signing key) and for
   the `ssh-keygen -Y sign -n kb-human-approval` command itself — a new A5-style classifier
   arm beside the existing `kb-ops-instructions` one.
7. GET-only monitoring against `PROD_URL` is already non-prod-targeting (`isProdTargeting`'s
   A3 arm requires a mutating verb or a mutating route) and stays that way.
8. Standing blocks D1–D8, the `Agent` rule C0, the audit line, and the fail-closed
   `catch` are **unchanged**.

This is a second layer, not the first (§5).

### 4.8 Desktop scripts (tooling, not the repo)

Both live in `T = C:\Users\danie\kb-rehearsal\tooling`, beside the existing prod scripts,
and follow their conventions (`. _drain-common.ps1`, `Invoke-Curl`, `Fail`/`Step`,
`$ErrorActionPreference = 'Stop'`).

**`prod-respond.ps1`** — open class, no window.
`-Run <runRef> -Request <requestRef> -Decision approve|retry|abandon -Reason "<text>"`,
`-URL` defaulting to prod, `-Actor` defaulting to `boss`.
It GETs `/api/control/runs/<Run>` for the request's current `revision`, then POSTs
`/api/control/human-requests/<Request>/respond` with
`{expectedRevision, decision, idempotencyKey, reason}` and headers
`content-type: application/json` and `X-KB-Actor: <Actor>`. Decision mapping:
`approve → approved`, `retry → changes-requested`, `abandon → rejected`.
It prints the run's post-response state and **never** retries a 409 (a revision change means
re-read, not re-send).

**`prod-sign-approval.ps1`** — windowed class (it touches the signing key).
`-Route "<METHOD> <path-template>" -Entity <entityRef> [-TtlMinutes 10] [-SigningKey <path>]`.
It builds the canonical payload (the seven keys, in order, compact), writes it to a temp
file, runs `ssh-keygen -Y sign -f <key> -n kb-human-approval <file>`, and prints the
`{payload, signature}` object as compact JSON ready to splice into a request body. It never
echoes the key path's contents and deletes both temp files in `finally`.

---

## 5. Security argument

**What the tailnet boundary now means.** It is, and remains, the *authentication* boundary:
`tailscale serve` terminates TLS, the daemon binds loopback only
(`mode.ts:232`), the peer-uid proof pins the proxy (`auth/peerUid.ts`), and
`DASHBOARD_TAILNET_OPERATOR` pins one login (`mode.ts:209`). Anything that reaches a
governed route has already proven it is Daniel's tailnet, on this VM, through that proxy.
What this change does is stop pretending there was a *second* authentication factor for
consequential actions. There wasn't a usable one: `DASHBOARD_WEBAUTHN_CREDENTIALS` is empty
on prod today, so every T3 challenge answers `403 ceremony-unavailable` and the T3 path is
simply dead. Replacing a dead factor with a live one is the whole point.

**What the signed channel guarantees.** Possession of the tailnet — including full
root-equivalent access to the VM — is *not* sufficient to publish, delete, force, or raise
the spend ceiling. Those need a signature from a private key that lives only on Daniel's
desktop and never touches the VM, the repo, or any agent's environment. The daemon holds
only the public allowed-signers file. An attacker who owns the VM can of course do anything
*to the VM* — but they cannot produce an approval, so the audit trail cannot be made to show
Daniel authorizing something he did not, and any tooling downstream of the trail (the drain,
the promotion chain) stays honest.

**Namespace separation is load-bearing.** The same `kb-ops-approver` key already signs
outbox instruction approvals under `-n kb-ops-instructions`
(`promote_vm_outbox.py:42`). This channel uses `-n kb-human-approval`. SSHSIG binds the
namespace into the signed blob, so an instruction approval can never be replayed as a human
approval, or vice versa. Two namespaces, one key, no cross-purpose reuse.

**Replay and expiry.** Three independent bounds, each necessary:
- `expiresAt - issuedAt ≤ 15 min` caps how long a signature is *ever* valid, so a signature
  captured from a terminal scrollback is dead within the quarter hour.
- `expiresAt > now` is checked against the server clock, not the client's.
- The nonce store refuses a second use for the whole expiry window, and is durable, so a
  restart does not re-open it. A 10 000-row hard cap fails closed (refuse) rather than
  evicting, because evicting the oldest rows is exactly what an attacker who can generate
  traffic would want.

The nonce is claimed *after* the signature verifies, so an unauthenticated flood cannot burn
the table; and the table is bounded by `now + 15 min`, so its steady-state size is
(signed calls per 15 min), which is a handful.

**Why the approval binds `route` + `entityRef`.** Without them a signature for
"delete schedule 7" would work as "delete schedule 9" or as "deploy". Both are recomputed
**server-side** from the request the daemon actually received — the path parameter or an
`entityFromBody` reader over the already-parsed body — never from anything the approval
itself carries. This is the same rule `promote_vm_outbox.py:517` enforces
(`value != approval_value(chain)` ⇒ refuse) and the same rule the deleted deploy ceremony
enforced (`humanResponse.ts` "the preimage is always recomputed server-side").

**Why `X-KB-Actor` is safe.** It is self-asserted, so it is treated as a label, never as a
capability. Nothing in the policy table reads it. The tag rule (§4.5) is evaluated on the
route for every actor identically. `parseActor` is total (bad input ⇒ `unknown`), and the
value is bounded and character-classed before it reaches a log line. §4.3's test is the
proof: four different actor headers, same status.

**Why the hook is a second layer, not the first.** `scripts/hooks/prod_window_guard.js`
runs in the boss's Claude Code process. It can be bypassed by a hand-typed command in
another terminal, by a different harness, or by a change to `settings.local.json`. So it
must never be the only thing between a CLI and a consequential mutation — and after this
change it isn't: every rule it enforces about *classes* is also enforced by the daemon,
which the CLI cannot reconfigure. The hook's job is narrower and still worth having: it
gives fast local refusals, it constrains *which local scripts and arguments* the boss may
run at all (a class of mistake the server cannot see), and it keeps the one-pair-of-hands
rule during a deploy window (rule C0). Note also that both `prod-run-workflow.ps1:37-41` and
`drain-step2-v2.ps1:50-54` already re-check the window in-script for exactly this reason;
`prod-respond.ps1` needs no such check because it is open-class.

**Fail-closed inventory.** Every new failure mode resolves to refusal:
unreadable allowed-signers ⇒ `503`; unclassified route ⇒ `403`; unparseable actor ⇒
`unknown`; nonce store unreadable or full ⇒ refuse; `ssh-keygen` missing, timing out, or
writing to stderr ⇒ `403 approval-invalid`; audit append failure ⇒ the route's existing
`500 *-audit-required`.

**What gets smaller.** ~1 900 lines of ceremony code and ~1 400 lines of Python WebAuthn
verifier leave the tree, along with two npm dependencies (`@simplewebauthn/browser`,
`@simplewebauthn/server`), one systemd drop-in trust path, and two optional unit env
variables. Deleted attack surface is the cheapest kind.

---

## 6. Testing

**Unit (vitest, `dashboard/`):**
- `authority/policy.test.ts` — build the real Fastify app via the test surface fixture,
  read `app.routes` (or `printRoutes({commonPrefix:false})`), and assert: every
  registered mutating route on the operator scope is in `ROUTE_AUTHORITY`; every table entry
  names a registered route; no registered route path starts with a `FORBIDDEN_ROUTE_PREFIXES`
  member; every `signed` entry has an `entityParam` or an `entityFromBody`.
- `authority/approval.test.ts` — the ten checks of §4.2 each in isolation, with an injected
  verifier: good, expired (`expiresAt` past), over-long window (`>15 min`), future
  `issuedAt` beyond skew, wrong `route`, wrong `entityRef`, wrong `schema`, wrong `actor`,
  extra key, missing key, bad nonce shape, replayed nonce, empty `approval`.
- `authority/sshsig.test.ts` — against a **real** `ssh-keygen`, a throwaway key generated in
  a temp dir: good signature verifies; wrong key fails; wrong principal fails; wrong
  namespace (`kb-ops-instructions`) fails; tampered payload fails; empty stderr is required
  (a run with stderr output is refused even at exit 0). Skipped with a loud message when
  `ssh-keygen` is absent.
- `authority/nonceStore.test.ts` — fresh, replay, expiry-then-reuse, restart (re-read from
  disk), cap refusal.
- `authority/actor.test.ts` — parse table, and the **authority-invariance** test: same
  request under four actor headers ⇒ same status, on a tagged run and an untagged run.
- `audit/log.test.ts` (extend) — `actor` reaches the row from the bound attribution, and
  the row is byte-identical to today when nothing is bound.
- `workflows/defs.test.ts` (extend) — `tags` parse, bounds, refusals; `effectiveWorkflowTags`
  derives `publish` from a `publish:` action and from `publicationAuthorization`, and
  `spend` from `spendAuthorization`.
- `control/humanResponse.test.ts` (extend) — `reason` required; untagged run resolves with
  no approval; tagged run refuses `403 approval-required` and accepts with one; `resolvedBy`
  is written; the ceremony tests are deleted, not weakened.
- `control/budgetOverride.test.ts` — grant, idempotent replay on nonce, per-day sum cap,
  `windowBudgetFor` raises only `maxCostUsdMicros`, policy hash unchanged.
- Deletion guard test — a repo-wide grep assertion that `webauthn`/`passkey` appear in no
  `dashboard/`, `deploy/`, or `scripts/` source file.

**Python (pytest, repo root):**
- `tests/test_validate_vm_runtime.py` — the passkey cases are deleted; new cases assert a
  unit **with** `DASHBOARD_RP_ORIGIN` or `DASHBOARD_WEBAUTHN_CREDENTIALS` now **refuses**
  (closed-set violation); a unit missing `DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS` refuses;
  a non-empty `DropInPaths` refuses.
- `tests/test_bootstrap_vm.py`, `tests/test_bootstrap_vm_upgrade.py` — rendered-fragment
  expectations updated.
- `tests/test_webauthn_verify.py` deleted with `scripts/webauthn_verify.py`.

**Hook (`node --test tests/hooks/prod_window_guard.test.js`):**
open-class scripts allowed with the window closed; the same scripts still refused when a
standing block matches; `-Workflow` accepts an arbitrary safe id and rejects `..`;
`prod-respond.ps1`'s shape accepted and its injection-bearing variants refused;
`prod-sign-approval.ps1` refused without a window and accepted inside one; windowed scripts
unchanged; `Agent` still blocked while a window is open.

**Rehearsal host** (WSL `kb-rehearsal`, daemon on `127.0.0.1:4317`, real model via
`rehearsal/p4/real-claude/to-real.sh`, back with `to-stub.sh`):
a single script `rehearsal/p11/authority-proof.sh` runs, in order —
1. build + install the branch on the rehearsal host (`rehearsal/rehearsal-build.sh`),
   `rehearsal/p6/e1-vitest.sh` and `e1-pytest.sh` green;
2. generate a throwaway ed25519 key, write
   `/usr/local/lib/kb/kb-ops-approver.allowed-signers`, set the unit env, restart;
3. launch `v1-acceptance-demo`, let it park at its completion gate, resolve it through the
   **open** respond route with `X-KB-Actor: boss` and a reason; assert the run succeeds and
   `resolvedBy` is populated;
4. call `reconcile-publication` with no approval ⇒ `403 approval-required`; with a
   throwaway-signed approval ⇒ `200`; replay the same nonce ⇒ `409 approval-replayed`;
   sign with `-n kb-ops-instructions` instead ⇒ `403 approval-invalid`;
5. set `KB_EXECUTION_BUDGET_MAX_COST_USD_MICROS` low, run until the budget intervention
   appears, confirm an unsigned override is `403`, a signed one is `200`, and the run then
   completes;
6. `to-stub.sh`, delete the throwaway key, restore the host.

The rehearsal host is disposable and never holds Daniel's real key.

**Review.** One `opus` adversarial security review of the whole diff before the PR is
marked ready (T10), scoped to: the verifier subprocess, the nonce store, the policy table's
completeness, the actor header's non-authority, and what the WebAuthn deletion removed that
something still depended on.

---

## 7. Rollout

One PR from `claude/authority-guardrails`. Daniel merges. The boss then deploys through the
existing prod window: open the window, repoint the hook's `DEPLOY_SHA` and `BROKER_DIGEST`
pins to the new release, run `vm-preflight-prod.ps1`, `kb-deploy.ps1`, remove the now-untrusted
`/etc/systemd/system/kb-dashboard.service.d/passkey.conf` (the validator refuses any drop-in
after this change), restart, close the window.

**Prod proof** (window closed, open class, no signature):
the boss resolves the completion gate on run
`run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5` — waiting on prod now — via
`T\prod-respond.ps1 -Run run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5 -Request <ref>
-Decision approve -Reason "v1 acceptance: sources added, brief is correct"`.
Then: the run reaches `succeeded`; `GET /api/control/files?path=<brief.json>&sha256=<digest>`
returns `200`, and the same call with one hex digit changed returns `404`.

**Rollback.** The release chain is unchanged: `readlink /opt/kb-releases/previous` plus the
existing rollback recipe. The durable state added by this change
(`${stateRoot}/authority/*.json`) is ignored by the previous release, so a rollback is clean.

---

## 8. Follow-ups (out of scope tonight)

- **Sub-project 2 — completion without gates.** Make `completionGate` optional on a workflow
  definition and add a "Delivered" view for runs that finish without parking. *Card:* one
  `owner: claude` card with a design note + plan, blocked on nothing.
- **Sub-project 3 — post-run automation and the tick source.** Decide what drives work after
  a run terminates (schedule tick vs. run-completion event) and who owns the clock. *Card:*
  one `owner: claude` design card, blocked on sub-project 2's Delivered semantics.

---

## 9. Open questions

1. **`governance/risk-tiers.md` D2.13 must be amended by Daniel.** It currently reads "T3 →
   dashboard/WebAuthn-signed channel ONLY" (`governance/risk-tiers.md:35-40`). After this
   change the T3 channel is the ssh-signed human-approval channel. `governance/` is
   human-edited only, so T10 produces a proposed diff and Daniel applies it. Until he does,
   the repo's governance text and its code disagree — that is a documented gap, not a
   blocker for the merge, but it should close the same week.
2. **Does `POST /api/control/execution/lock` / `unlock` stay open?** The design says yes
   (Daniel, Approach 1: "execution lock/unlock" is open). Worth revisiting once the CLI is
   the normal operator: an accidental `lock` from a worker stops the fleet. A cheap
   mitigation, deliberately *not* built tonight, is to require `X-KB-Actor` to be present
   (not `unknown`) on those two routes.
3. **Where does the allowed-signers file get refreshed from?** Today `kb-deploy.ps1`
   installs the release; the allowed-signers file is installed once by
   `deploy/bootstrap_vm.py`. If Daniel ever rotates the `kb-ops-approver` key, the rotation
   procedure is "bootstrap converge, then restart" — which is correct but undocumented.
   A runbook line is owed; it is not code.

---

## 10. Self-review

Checked against the approved design, section by section:

- **No TBD, TODO, or placeholder** appears above. Every module, route, field, error code,
  bound, and env variable is named concretely.
- **Route classes (1)** — table in §4.1, enforcement point named
  (`surface.ts:654-662`), deletion list complete, latch source decision stated.
- **Signed channel (2)** — payload schema, canonical encoding, sign and verify commands,
  the ten checks in order, nonce store, env variable and its path, desktop helper. The
  "in-process sshsig verifier if one already exists in deps" question from the brief is
  answered explicitly: `dashboard/package.json` has none, so we shell out.
- **Actor record (3)** — header grammar, `unknown` fallback, the binding seam, the audit
  field, `resolvedBy`'s shape including its legacy `null`.
- **Boss rules (4)** — `reason` required, tag escalation, where enforced, hook mirror
  stated as advisory.
- **Spend (5)** — the existing window is the ceiling, the parked intervention is unchanged,
  the override raises only cost, and the mechanism by which it reaches the reserve path is
  named down to the three lines in `adapters.ts`.
- **Hook (6)** — open vs. windowed class, the widened `-Workflow`, the new shapes, the
  unchanged standing blocks.
- **Testing (7)** and **Rollout (8)** — both present with the prod proof and its run ref.
- **Follow-ups** carry their cards. **Open questions** are three real ones (a governance
  text that will contradict the code, an unresolved default, an undocumented rotation), not
  decisions already made.
- **Consistency sweep:** `effectiveWorkflowTags` is spelled identically in §4.4, §4.5 and
  §6. `verifyApproval` is spelled identically in §4.2, §4.5 and §6. `windowBudgetFor` is
  spelled identically in §4.6 and §6. The error codes used in §4.2's table are exactly the
  ones §5 and §6 refer to: `approval-required`, `approval-invalid`, `approval-expired`,
  `approval-replayed`, `approval-unavailable`, `route-unclassified`, `route-unavailable`,
  `reason-required`.

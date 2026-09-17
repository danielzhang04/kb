# Authority and Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the CLI (boss session + workers) operate the kb daemon — launch, monitor, resolve gates and interventions, archive, manage schedules — with every mutation attributed and recorded, while a short "never for a CLI" list is enforced server-side behind a human ssh-signed approval channel, and WebAuthn/passkeys are removed entirely.

**Architecture:** One policy table in `dashboard/server/authority/policy.ts` classifies every mutating route as `open` | `signed` | `none`, enforced by a single `requireAuthority` preHandler on the governed scope. Signed-class requests carry an SSHSIG approval over a canonical JSON payload, verified by shelling out to `ssh-keygen -Y verify` against a root-owned allowed-signers file with namespace `kb-human-approval` and principal `kb-ops-approver`. An `X-KB-Actor` header is recorded (never trusted for authority); workflow definitions gain a derived `tags` set that escalates gate resolution on `publish`/`spend` workflows to the signed channel.

**Tech Stack:** TypeScript (strip-only, `.ts` ESM specifiers, Node 24, Fastify 5), vitest; Python 3 (deploy validators, pytest); Node `node:test` for the session hook; PowerShell 5.1 for desktop tooling; OpenSSH `ssh-keygen -Y`.

**Spec:** `docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md` — read it before Task 1. Every task argues from a numbered section of it.

## Global Constraints

- Baseline is `main` @ `7e09fd4f`; work happens on branch `claude/authority-guardrails`.
- **Never touch `governance/` or `CLAUDE.md`.** They are human-edited only. T10 writes a *proposed* diff to a scratch file for Daniel.
- **No prod contact from any task except T11.** No WSL from T1–T8.
- TypeScript is strip-only: no enums, no parameter properties, no namespaces. Import with `.ts` specifiers.
- Every new server module lives under `dashboard/server/authority/` with its `*.test.ts` beside it.
- Fail closed everywhere: an unreadable file, an unclassified route, a malformed header, a missing binary, a timeout — all resolve to a refusal, never to "allow".
- Never log, echo, or persist an approval `payload`, a `signature`, or a signing-key path's contents.
- Bounds copied verbatim from the spec: payload ≤ 2048 bytes; signature ≤ 8192 bytes; `expiresAt - issuedAt ∈ (0, 15 min]`; `issuedAt ≤ now + 60s`; nonce `/^[0-9a-f]{32}$/`; nonce table cap 10 000; `reason` 1..2000 chars; tags ≤ 8, each `/^[a-z][a-z0-9-]{0,31}$/`; budget override per-grant ≤ 20 000 000 micro-USD and per-day sum ≤ 60 000 000 micro-USD.
- Error codes are a closed set: `approval-required`, `approval-invalid`, `approval-expired`, `approval-replayed`, `approval-unavailable`, `route-unclassified`, `route-unavailable`, `reason-required`. Do not mint another one.
- Namespace is `kb-human-approval` (NOT `kb-ops-instructions`); principal is `kb-ops-approver`.
- Commit messages end with:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`

**Test commands** (memorise; every task uses them):
- vitest: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- <relative/path.test.ts>`
- pytest: `cd C:/Users/danie/kb-worktrees/authority && python -m pytest <path> -q`
- hook: `cd C:/Users/danie/kb-worktrees/authority && node --test tests/hooks/prod_window_guard.test.js`
- typecheck: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm run typecheck`

## Dependency graph and dispatch waves

| Wave | Tasks | Depends on |
| --- | --- | --- |
| A (parallel) | **T1**, **T2**, **T7**, **T8** | nothing |
| B (parallel) | **T3** (T2), **T4** (T1) | wave A |
| C (parallel) | **T5** (T3, T4), **T6** (T3) | wave B |
| D (serial) | **T9** (T1–T8) → **T10** (T9) → **T11** (T10 + Daniel's merge) | wave C |

T1 and T2 touch one shared line: T1 adds a `PENDING_DELETION` list naming the four WebAuthn ceremony routes; T2's last step deletes it. If T1 has not landed when T2's worker reaches that step, T2 skips it and says so in its report — T9 will catch a miss.

---

## File Structure

**Created**
- `dashboard/server/authority/policy.ts` — the route class table + `classifyRoute` + `FORBIDDEN_ROUTE_PREFIXES`. Pure; no I/O.
- `dashboard/server/authority/policy.test.ts` — table invariants + live route completeness.
- `dashboard/server/authority/actor.ts` — `X-KB-Actor` parsing. Pure.
- `dashboard/server/authority/actor.test.ts`
- `dashboard/server/authority/sshsig.ts` — the `ssh-keygen -Y verify` runner. The only module that spawns.
- `dashboard/server/authority/sshsig.test.ts`
- `dashboard/server/authority/nonceStore.ts` — durable replay store.
- `dashboard/server/authority/nonceStore.test.ts`
- `dashboard/server/authority/approval.ts` — canonical payload + the ten checks.
- `dashboard/server/authority/approval.test.ts`
- `dashboard/server/authority/gate.ts` — the `requireAuthority` preHandler.
- `dashboard/server/authority/gate.test.ts`
- `dashboard/server/control/budgetOverride.ts` — the signed spend-override store + route.
- `dashboard/server/control/budgetOverride.test.ts`
- `C:\Users\danie\kb-rehearsal\tooling\prod-respond.ps1` — open-class gate/intervention responder.
- `C:\Users\danie\kb-rehearsal\tooling\prod-sign-approval.ps1` — windowed-class signing helper.
- `C:\Users\danie\kb-rehearsal\tooling\rehearsal\p11\authority-proof.sh` — the rehearsal proof.

**Modified**
- `dashboard/server/http/surface.ts` — install `requireAuthority` on the authenticated scope.
- `dashboard/server/auth/routes.ts`, `mode.ts`, `session.ts` — delete the ceremony; keep `/api/auth/context`.
- `dashboard/server/control/routes.ts`, `humanResponse.ts`, `activation.ts`, `adapters.ts` — delete ceremonies; add tag escalation, `resolvedBy`, `windowBudgetFor`.
- `dashboard/server/services/runReadService.ts` — `reason` on the respond body wall.
- `dashboard/server/audit/log.ts`, `dashboard/server/auth/operator.ts`, `dashboard/server/http/middleware.ts` — `actor` on the attribution + the audit row.
- `dashboard/server/control/store.ts`, `types.ts` — `resolvedBy` on a resolved human request.
- `dashboard/server/workflows/defs.ts`, `routes.ts` — `tags` + `effectiveWorkflowTags`.
- `dashboard/server/inbox/routes.ts` — drop the deploy ceremony plumbing.
- `deploy/validate_vm_runtime.py`, `deploy/bootstrap_vm.py`, `deploy/systemd/kb-dashboard.service`, `scripts/vm_launch_preflight.sh` — drop passkey env, add the allowed-signers env.
- `dashboard/package.json` — drop `@simplewebauthn/*`.
- `scripts/hooks/prod_window_guard.js`, `tests/hooks/prod_window_guard.test.js` — class table.

**Deleted**
- `dashboard/server/auth/webauthn.ts` (+ test), `credentialStore.ts` (+ test), `challenge.ts` (+ test)
- `dashboard/src/lib/webauthnClient.ts` (+ test)
- `scripts/webauthn_verify.py`, `tests/test_webauthn_verify.py`

---

### Task 1: Route policy table and classification test

**Depends on:** nothing. **Parallel with:** T2, T7, T8.

**Files:**
- Create: `dashboard/server/authority/policy.ts`
- Create: `dashboard/server/authority/policy.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type AuthorityClass = 'open' | 'signed' | 'none'`
  - `interface RouteAuthority { path: string; method: 'POST'|'PUT'|'DELETE'|'PATCH'; cls: AuthorityClass; entityParam: string | null; entityFromBody?: (body: Record<string, unknown>) => string | null; escalate?: 'workflow-tag' }`
  - `const ROUTE_AUTHORITY: readonly RouteAuthority[]`
  - `function classifyRoute(method: string, path: string): RouteAuthority | null`
  - `function routeKey(entry: RouteAuthority): string` — `` `${method} ${path}` ``, the exact string an approval's `route` field must equal.
  - `const FORBIDDEN_ROUTE_PREFIXES: readonly string[]`
  - `const PENDING_DELETION: readonly string[]` — route keys T2 removes; excluded from the live completeness check. **T2 deletes this.**

- [ ] **Step 1: Write the failing test**

Create `dashboard/server/authority/policy.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ROUTE_AUTHORITY, classifyRoute, routeKey, FORBIDDEN_ROUTE_PREFIXES, PENDING_DELETION,
} from './policy.ts';

describe('route authority table', () => {
  it('has no duplicate route keys', () => {
    const keys = ROUTE_AUTHORITY.map(routeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('gives every signed route a way to derive its entityRef', () => {
    for (const entry of ROUTE_AUTHORITY.filter((e) => e.cls === 'signed')) {
      expect(entry.entityParam !== null || typeof entry.entityFromBody === 'function').toBe(true);
    }
  });

  it('escalates only the three respond routes', () => {
    expect(ROUTE_AUTHORITY.filter((e) => e.escalate === 'workflow-tag').map(routeKey).sort()).toEqual([
      'POST /api/control/human-requests/:requestRef/respond',
      'POST /api/control/iteration-gates/:requestRef/resolve',
      'POST /api/v1/runs/:runRef/human-requests/:requestRef/respond',
    ]);
  });

  it('classifies an exact method+path and refuses anything else', () => {
    expect(classifyRoute('POST', '/api/control/runs/:runRef/archive')?.cls).toBe('open');
    expect(classifyRoute('POST', '/api/control/runs/:runRef/reconcile-publication')?.cls).toBe('signed');
    expect(classifyRoute('DELETE', '/api/schedules/:id')?.cls).toBe('signed');
    expect(classifyRoute('POST', '/api/control/runs/:runRef/nope')).toBeNull();
    expect(classifyRoute('post', '/api/control/runs/:runRef/archive')?.cls).toBe('open'); // method case-insensitive
  });

  it('names no table route under a forbidden prefix', () => {
    for (const entry of ROUTE_AUTHORITY) {
      for (const prefix of FORBIDDEN_ROUTE_PREFIXES) {
        expect(entry.path.startsWith(prefix)).toBe(false);
      }
    }
  });

  it('lists exactly the four ceremony routes as pending deletion', () => {
    expect([...PENDING_DELETION].sort()).toEqual([
      'POST /api/auth/assert/options',
      'POST /api/auth/assert/verify',
      'POST /api/auth/register/options',
      'POST /api/auth/register/verify',
    ]);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/authority/policy.test.ts`
Expected: FAIL — `Failed to resolve import "./policy.ts"`.

- [ ] **Step 3: Write the table**

Create `dashboard/server/authority/policy.ts`. Header comment must state: "the single source of truth for which mutating routes a CLI may call unaided; see docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md §4.1". Then:

```ts
export type AuthorityClass = 'open' | 'signed' | 'none';

export interface RouteAuthority {
  readonly path: string;
  readonly method: 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  readonly cls: AuthorityClass;
  readonly entityParam: string | null;
  readonly entityFromBody?: (body: Record<string, unknown>) => string | null;
  readonly escalate?: 'workflow-tag';
}

export function routeKey(entry: Pick<RouteAuthority, 'method' | 'path'>): string {
  return `${entry.method} ${entry.path}`;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

const open = (method: RouteAuthority['method'], path: string): RouteAuthority =>
  ({ method, path, cls: 'open', entityParam: null });

export const ROUTE_AUTHORITY: readonly RouteAuthority[] = Object.freeze([
  // ── open: the CLI's ordinary working set ───────────────────────────────────
  open('POST', '/api/workflows/:id/launch'),
  open('POST', '/api/write/launch'),
  open('POST', '/api/write/rerun'),
  open('POST', '/api/v1/runs'),
  open('POST', '/api/control/proposals/:proposalRef/revisions/:revision/launch'),
  { method: 'POST', path: '/api/control/human-requests/:requestRef/respond', cls: 'open', entityParam: 'requestRef', escalate: 'workflow-tag' },
  { method: 'POST', path: '/api/control/iteration-gates/:requestRef/resolve', cls: 'open', entityParam: 'requestRef', escalate: 'workflow-tag' },
  { method: 'POST', path: '/api/v1/runs/:runRef/human-requests/:requestRef/respond', cls: 'open', entityParam: 'requestRef', escalate: 'workflow-tag' },
  open('POST', '/api/control/runs/:runRef/manager/stop'),
  open('POST', '/api/control/runs/:runRef/manager/steer'),
  open('POST', '/api/control/runs/:runRef/manager/messages'),
  open('POST', '/api/control/runs/:runRef/manager/successor'),
  open('POST', '/api/control/runs/:runRef/agents/:agentId/messages'),
  open('POST', '/api/control/runs/:runRef/activate'),
  open('POST', '/api/control/runs/:runRef/stages/:stageRef/reroute'),
  open('POST', '/api/control/runs/:runRef/archive'),
  open('POST', '/api/write/stop'),
  open('POST', '/api/schedules'),
  open('POST', '/api/schedules/:id/arm'),
  open('POST', '/api/schedules/:id/disarm'),
  open('POST', '/api/v1/schedules'),
  open('POST', '/api/control/execution/lock'),
  open('POST', '/api/control/execution/unlock'),
  open('POST', '/api/write/save'),
  open('POST', '/api/write/routing-override'),
  open('POST', '/api/write/card-routing'),
  open('POST', '/api/write/card-respond'),
  open('POST', '/api/write/workflow-runs'),
  open('POST', '/api/agents'),
  open('PUT', '/api/agents/:id'),
  open('POST', '/api/agents/:id/launch'),
  open('POST', '/api/workflows'),
  open('PUT', '/api/workflows/:id'),
  open('POST', '/api/v1/agents'),
  open('PUT', '/api/v1/agents/:id'),
  open('POST', '/api/v1/workflows'),
  open('PUT', '/api/v1/workflows/:id'),
  open('POST', '/api/control/proposals/import'),
  open('POST', '/api/control/proposals/:proposalRef/revisions'),
  open('POST', '/api/control/proposals/:proposalRef/revisions/:revision/decision'),
  open('POST', '/api/control/runs/:runRef/pty-sessions/:sessionId/controller'),
  open('DELETE', '/api/pty/sessions/:sessionId'),
  open('POST', '/api/auth/browser-session'),
  open('POST', '/api/approvals/verify'),
  open('POST', '/api/control/retention/dry-run'),

  // ── signed: the "never for a CLI" list ─────────────────────────────────────
  { method: 'POST', path: '/api/control/budget/override', cls: 'signed', entityParam: null, entityFromBody: (body) => str(body.windowDay) },
  { method: 'POST', path: '/api/control/runs/:runRef/reconcile-publication', cls: 'signed', entityParam: 'runRef' },
  { method: 'DELETE', path: '/api/schedules/:id', cls: 'signed', entityParam: 'id' },
  { method: 'DELETE', path: '/api/v1/schedules/:id', cls: 'signed', entityParam: 'id' },
  { method: 'POST', path: '/api/control/retention/quarantine', cls: 'signed', entityParam: null, entityFromBody: (body) => str(body.expectedPlanHash) },
  { method: 'POST', path: '/api/control/retention/restore', cls: 'signed', entityParam: null, entityFromBody: (body) => str(body.runRef) },
  { method: 'POST', path: '/api/inbox/deployment/:ref/deploy', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/inbox/deployment/:ref/confirm', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/inbox/deployment/:ref/abort', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/inbox/deployment/:ref/acknowledge', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/inbox/deployment/:ref/close-ptys-and-continue', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/v1/deployments/:ref/acknowledge', cls: 'signed', entityParam: 'ref' },
  { method: 'POST', path: '/api/control/recovery/2026-07-31/execution-lock', cls: 'signed', entityParam: null, entityFromBody: () => 'run-2026-07-31-execution-lock' },
  { method: 'POST', path: '/api/control/recovery/2026-08-01/failed-run-reconciliation', cls: 'signed', entityParam: null, entityFromBody: () => 'run-2026-08-01-failed-run' },
]);

/** Path prefixes that must have ZERO registered routes: `none` is an absence, not a refusal. */
export const FORBIDDEN_ROUTE_PREFIXES: readonly string[] = Object.freeze([
  '/api/governance', '/api/credentials', '/api/secrets', '/api/sshd', '/api/ssh', '/api/units', '/api/systemd',
]);

/** Route keys Task 2 deletes with WebAuthn. Excluded from the live completeness check until then. */
export const PENDING_DELETION: readonly string[] = Object.freeze([
  'POST /api/auth/register/options',
  'POST /api/auth/register/verify',
  'POST /api/auth/assert/options',
  'POST /api/auth/assert/verify',
]);

const BY_KEY = new Map(ROUTE_AUTHORITY.map((entry) => [routeKey(entry), entry]));

export function classifyRoute(method: string, path: string): RouteAuthority | null {
  return BY_KEY.get(`${String(method).toUpperCase()} ${path}`) ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/authority/policy.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing live-completeness test**

Append to `policy.test.ts`. The app fixture already exists — read `dashboard/server/http/surface.test.ts` for how it builds an app, and reuse that helper verbatim rather than inventing one.

```ts
import { buildTestSurface } from '../http/surface.test.ts'; // if not exported, copy its 10-line builder here

const MUTATING = new Set(['POST', 'PUT', 'DELETE', 'PATCH']);

describe('the table covers the app', () => {
  it('classifies every mutating operator route the app registers', async () => {
    const app = await buildTestSurface();
    try {
      const registered: { method: string; path: string }[] = [];
      for (const route of app.routes ?? []) {
        for (const method of ([] as string[]).concat(route.method)) {
          if (MUTATING.has(method)) registered.push({ method, path: route.url });
        }
      }
      const unclassified = registered
        .map((r) => `${r.method} ${r.url ?? r.path}`)
        .filter((key) => !PENDING_DELETION.includes(key))
        .filter((key) => !key.startsWith('POST /api/v1/hosts/'))       // node scope, §2
        .filter((key) => !key.startsWith('POST /api/v1/runs/') || key.includes('human-requests'))
        .filter((key) => !key.startsWith('POST /api/control/paid-action')) // grant class, §2
        .filter((key) => classifyRoute(key.split(' ')[0], key.slice(key.indexOf(' ') + 1)) === null);
      expect(unclassified).toEqual([]);
    } finally { await app.close(); }
  });

  it('registers no route under a forbidden prefix', async () => {
    const app = await buildTestSurface();
    try {
      for (const route of app.routes ?? []) {
        for (const prefix of FORBIDDEN_ROUTE_PREFIXES) {
          expect(route.url.startsWith(prefix)).toBe(false);
        }
      }
    } finally { await app.close(); }
  });
});
```

If `app.routes` is not populated by this Fastify version, use `app.printRoutes({ commonPrefix: false })` and parse its lines instead — verify which one works with a one-line `console.log` before writing the assertion, and delete the log.

- [ ] **Step 6: Run and make the completeness test pass**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/authority/policy.test.ts`
Expected: it will FAIL first, listing every mutating route the table missed. Add each listed route to `ROUTE_AUTHORITY` with the class the spec's §4.1 tables assign it. If a route appears that the spec does not mention, class it `signed` and say so in your report — never `open` by default.
Then re-run. Expected: PASS, 8 tests.

- [ ] **Step 7: Typecheck and commit**

```bash
cd C:/Users/danie/kb-worktrees/authority/dashboard && npm run typecheck
cd C:/Users/danie/kb-worktrees/authority
git add dashboard/server/authority/policy.ts dashboard/server/authority/policy.test.ts
git commit -m "feat(authority): one policy table classifying every mutating route

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Delete WebAuthn and passkeys

**Depends on:** nothing (step 9 wants T1 landed). **Parallel with:** T1, T7, T8.

**Files:**
- Delete: `dashboard/server/auth/webauthn.ts`, `webauthn.test.ts`, `credentialStore.ts`, `credentialStore.test.ts`, `challenge.ts`, `challenge.test.ts`; `dashboard/src/lib/webauthnClient.ts`, `webauthnClient.test.ts`; `scripts/webauthn_verify.py`; `tests/test_webauthn_verify.py`
- Modify: `dashboard/server/auth/routes.ts`, `dashboard/server/auth/mode.ts`, `dashboard/server/auth/session.ts`, `dashboard/server/auth/routes.test.ts`, `dashboard/server/auth/mode.test.ts`, `dashboard/server/auth/session.test.ts`, `dashboard/server/control/routes.ts`, `dashboard/server/control/humanResponse.ts` (+ tests), `dashboard/server/inbox/routes.ts`, `dashboard/server/control/activation.ts`, `dashboard/server/http/context.ts`, `dashboard/server/approvals/*`, `dashboard/src/**` (auth/unlock UI), `dashboard/package.json`, `deploy/validate_vm_runtime.py`, `deploy/bootstrap_vm.py`, `scripts/vm_launch_preflight.sh`, `tests/test_validate_vm_runtime.py`, `tests/test_bootstrap_vm.py`, `tests/test_bootstrap_vm_upgrade.py`
- Create: `dashboard/server/authority/noWebauthn.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ExecutionUnlockSource = 'env-override' | 'tailnet'`; `isOperatorUnlockSource(source) === (source === 'tailnet')`; `GET /api/auth/context` returns `{ mode }` only; `SurfaceContext` loses `webAuthnConfig` and `credentials`.

- [ ] **Step 1: Write the failing deletion-guard test**

Create `dashboard/server/authority/noWebauthn.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..', '..');

describe('webauthn is gone', () => {
  it('appears in no dashboard, deploy or scripts source file', () => {
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-ril', '-e', 'webauthn', '-e', 'passkey', '--',
        'dashboard/server', 'dashboard/src', 'deploy', 'scripts'], { cwd: ROOT, encoding: 'utf8' });
    } catch (err: unknown) {
      // git grep exits 1 with no output when there are no matches — that is the pass.
      out = (err as { stdout?: string }).stdout ?? '';
    }
    expect(out.trim().split('\n').filter(Boolean)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/authority/noWebauthn.test.ts`
Expected: FAIL, listing ~40 files.

- [ ] **Step 3: Delete the server ceremony**

```bash
cd C:/Users/danie/kb-worktrees/authority
git rm dashboard/server/auth/webauthn.ts dashboard/server/auth/webauthn.test.ts \
       dashboard/server/auth/credentialStore.ts dashboard/server/auth/credentialStore.test.ts \
       dashboard/server/auth/challenge.ts dashboard/server/auth/challenge.test.ts \
       dashboard/src/lib/webauthnClient.ts dashboard/src/lib/webauthnClient.test.ts \
       scripts/webauthn_verify.py tests/test_webauthn_verify.py
```

Then edit, in this order:

1. `dashboard/server/auth/routes.ts` — delete the four `scope.post('/api/auth/...')` handlers (`:205`, `:218`, `:257`, `:270`), the `ceremonyGate` const, `NAMESPACED_CHALLENGE_PREFIX`/`isNamespacedChallenge`, `OPERATOR`, and every import from `./webauthn.ts`, `./credentialStore.ts`, `./mode.ts#ceremonyModeAdmits`. Reduce `/api/auth/context` (`:200`) to `reply.send({ mode: ctx.authMode })`. Keep `registerBrowserSessionRoute` and everything it uses exactly as is.
2. `dashboard/server/auth/session.ts` — delete `mintSessionFromVerifiedAssertion` and its test cases; `mintSession` stays (it is what `resolveSession` uses in tailnet mode).
3. `dashboard/server/auth/mode.ts` — delete `TAILNET_PASSKEY_ENV` (`:70`), `countProvisionedCredentials` (`:102`), `assertTailnetPasskeyChannel` (`:123`) and its call at `:241`, and `ceremonyModeAdmits` (`:83`). Rewrite the module docstring's `win32-desktop` paragraph: it now means "no ambient operator proof; a session bearer is required", with no mention of passkeys.
4. `dashboard/server/control/routes.ts` — delete the three challenge routes (`:1886`, `:1929`, `:2115`), the `iterationGateCeremony`/`responseService` ceremony closures, the `export { ceremonyModeAdmits }` re-export (`:101`), and every import from `../auth/webauthn.ts`, `../auth/credentialStore.ts`, `../auth/mode.ts`. At `:724` change the unlock audit's `detail: { method: 'session-bearer' }` to `detail: { method: 'tailnet-operator' }` and rewrite the block comment above it: authorization is the tailnet operator proof, the latch is armed at boot, and this route is the explicit re-arm.
5. `dashboard/server/control/humanResponse.ts` — delete the T3 ceremony block (`:144-167`), `HumanResponseCeremonyPort`, `CeremonyVerificationInput`, `humanResponseChallenge`, `createDeployCeremonyService` + `DeployCeremony*`, `createIterationGateCeremonyService` + `IterationGateCeremony*`, `deployChallenge`, `iterationGateChallenge`. **Keep** `humanResponseDigest`, `deployDigest`, `iterationGateDigest`, `iterationGateT3Preimage` (they are content digests, still used for audit detail), and keep `T3_KINDS` and the `riskTier: t3 ? 'T3' : 'T2'` audit line. The `if (t3) {...}` block reduces to nothing until T5 puts the tag rule there.
6. `dashboard/server/inbox/routes.ts` — remove the ceremony arguments threaded into the five deployment actions; they become plain session-gated routes (T3 makes them signed).
7. `dashboard/server/control/activation.ts:751` — `export type ExecutionUnlockSource = 'env-override' | 'tailnet';` and `:759` `isOperatorUnlockSource` returns `source === 'tailnet'`. Fix the two doc comments that name `passkey`.
8. `dashboard/server/http/context.ts` — delete `webAuthnConfig` (`:146`) and `credentials` (`:148`) from `SurfaceContext` and the `WebAuthnConfig`/`WebAuthnCredential` imports (`:19`, `:20`). Fix every construction site the typechecker names.
9. `dashboard/src/**` — delete the passkey sign-in path from `lib/authClient.ts`, `lib/sessionContext.tsx`, `App.tsx`; `control/ExecutionUnlock.tsx` keeps its lock/unlock buttons and drops its ceremony call; `views/RunDetail.tsx`, `views/Tasks.tsx`, `control/RunInspector.tsx`, `control/controlClient.ts`, `lib/taskActionsClient.ts` drop `ceremonyId`/`assertion`/`challengeExpiresAt` from every request body and the "approve with passkey" copy. Update their tests to match.
10. `dashboard/package.json` — remove `@simplewebauthn/browser` and `@simplewebauthn/server`, then `cd dashboard && npm install` so the lockfile updates.

- [ ] **Step 4: Run the whole dashboard suite and fix the fallout**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test`
Expected: red at first. Work the list. The only acceptable edits are deletions and the mechanical consequences of them — if a test asserts behaviour that is *not* about WebAuthn and it fails, stop and report rather than changing the assertion.
Then: `npm run typecheck` — expected: clean.

- [ ] **Step 5: Delete the passkey checks from the deploy validator**

In `deploy/validate_vm_runtime.py`: delete `_validate_passkey_channel` (`:373`), `_validate_passkey_drop_in` (`:336`), `_provisioned_credential_count` (`:398`), `PASSKEY_UNIT_ENV` (`:74`), `PASSKEY_DROP_IN` (`:89`), the two names from `OPTIONAL_UNIT_ENV` (`:43-44`), `DASHBOARD_WEBAUTHN_CREDENTIALS` from `CREDENTIAL_ENV_EXEMPT` (`:83` — keep the two `KB_EXECUTION_BUDGET_MAX_*_TOKENS` entries and their comment), and the call at `:550`.

Replace the drop-in trust set at `:510-515` with:

```python
    # No drop-in is trusted. The W47 passkey drop-in was the only one that ever was, and the
    # channel it carried is gone; a drop-in can set ANY [Service] directive, so an unexpected one
    # is stale or hostile drift and must be a loud ExecStartPre failure.
    drop_ins = show["DropInPaths"].split()
    if drop_ins:
        raise RuntimeError("dashboard unit drop-ins are untrusted: " + ",".join(sorted(drop_ins)))
```

In `deploy/bootstrap_vm.py`: delete the `PASSKEY_DROP_IN`/`PASSKEY_UNIT_ENV` import (`:81`, `:93`) and the stray-pair refusal (`:339-369`).
In `scripts/vm_launch_preflight.sh`: delete the whole `T3 passkey channel` section (`:372-427`).

- [ ] **Step 6: Run the Python tests and fix them**

Run: `cd C:/Users/danie/kb-worktrees/authority && python -m pytest tests/test_validate_vm_runtime.py tests/test_bootstrap_vm.py tests/test_bootstrap_vm_upgrade.py -q`
Expected: red. Delete the passkey cases and add these three:

```python
def test_unit_carrying_rp_origin_is_refused(tmp_path):
    env = _valid_unit_env() | {"DASHBOARD_RP_ORIGIN": "https://kb.example.ts.net"}
    with pytest.raises(RuntimeError, match="environment assignment set is not closed"):
        validate_static_unit(_valid_show(), _unit_text(env))

def test_unit_carrying_webauthn_credentials_is_refused(tmp_path):
    env = _valid_unit_env() | {"DASHBOARD_WEBAUTHN_CREDENTIALS": "[]"}
    with pytest.raises(RuntimeError, match="environment assignment set is not closed"):
        validate_static_unit(_valid_show(), _unit_text(env))

def test_any_drop_in_is_refused():
    show = _valid_show() | {"DropInPaths": "/etc/systemd/system/kb-dashboard.service.d/passkey.conf"}
    with pytest.raises(RuntimeError, match="drop-ins are untrusted"):
        validate_static_unit(show, _unit_text(_valid_unit_env()))
```

(Use the file's own existing helper names for `_valid_unit_env` / `_valid_show` / `_unit_text`; read the top of the test file first and match them.)
Re-run. Expected: PASS.

- [ ] **Step 7: Run the deletion guard**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/authority/noWebauthn.test.ts`
Expected: PASS. If it still lists files, they are the ones left to clean.

- [ ] **Step 8: Full suite**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test` then `cd .. && python -m pytest tests -q`
Expected: both green.

- [ ] **Step 9: Remove `PENDING_DELETION` (needs T1 landed)**

If `dashboard/server/authority/policy.ts` exists on the branch, delete `PENDING_DELETION` from it, delete its `.filter((key) => !PENDING_DELETION.includes(key))` line and the `lists exactly the four ceremony routes` test from `policy.test.ts`, and re-run `npm test -- server/authority/policy.test.ts` (expected: PASS). If it does not exist yet, skip this step and say so in your report.

- [ ] **Step 10: Commit**

```bash
cd C:/Users/danie/kb-worktrees/authority
git add -A
git commit -m "feat(authority)!: remove WebAuthn and passkeys end to end

The constrained tailnet passkey channel was never provisioned on prod, so every
T3 ceremony answered 403 ceremony-unavailable and the channel was dead code with
a live trust boundary attached to it. Delete the ceremony routes, the verifier,
the credential/challenge stores, the browser client, the systemd drop-in trust
path and the two optional unit env vars. The execution latch keeps source:
'tailnet'; authorization moves to the ssh-signed channel.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Signed-approval verifier, nonce store, and the gate

**Depends on:** T2 (shares `auth/mode.ts` and `deploy/validate_vm_runtime.py`). **Parallel with:** T4.

**Files:**
- Create: `dashboard/server/authority/sshsig.ts` (+ `.test.ts`), `nonceStore.ts` (+ `.test.ts`), `approval.ts` (+ `.test.ts`), `gate.ts` (+ `.test.ts`)
- Modify: `dashboard/server/http/surface.ts`, `dashboard/server/http/context.ts`, `dashboard/server/auth/mode.ts`, `deploy/systemd/kb-dashboard.service`, `deploy/validate_vm_runtime.py`, `deploy/bootstrap_vm.py`, `scripts/vm_launch_preflight.sh`, `tests/test_validate_vm_runtime.py`

**Interfaces:**
- Consumes: `classifyRoute`, `routeKey`, `RouteAuthority` from `./policy.ts` (T1).
- Produces:
  - `sshsig.ts`: `interface SshsigVerifier { verify(input: { payload: Buffer; signature: string; allowedSigners: string; principal: string; namespace: string }): Promise<boolean> }` and `const defaultSshsigVerifier: SshsigVerifier`.
  - `nonceStore.ts`: `interface NonceStore { claim(nonce: string, expiresAtMs: number): 'fresh' | 'replayed' | 'unavailable' }` and `function createNonceStore(stateRoot: string, now?: () => number): NonceStore`.
  - `approval.ts`: `const APPROVAL_SCHEMA = 'kb.human-approval/v1'`, `const APPROVAL_NAMESPACE = 'kb-human-approval'`, `const APPROVAL_PRINCIPAL = 'kb-ops-approver'`, `const APPROVAL_MAX_TTL_MS = 15 * 60 * 1000`, `function canonicalApprovalPayload(p: ApprovalPayload): string`, `type ApprovalFailure = { status: 403 | 409 | 503; error: string }`, `function verifyApproval(input: VerifyApprovalInput): Promise<{ ok: true } | { ok: false } & ApprovalFailure>`.
  - `gate.ts`: `function requireAuthority(ctx: SurfaceContext): preHandlerHookHandler`.

- [ ] **Step 1: Write the failing sshsig test**

Create `dashboard/server/authority/sshsig.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { defaultSshsigVerifier } from './sshsig.ts';

let dir = '';
let allowed = '';
const MESSAGE = Buffer.from('{"schema":"kb.human-approval/v1"}', 'utf8');

function sign(namespace: string, keyName = 'good'): string {
  const file = join(dir, `${namespace}-${keyName}.msg`);
  writeFileSync(file, MESSAGE);
  execFileSync('ssh-keygen', ['-Y', 'sign', '-f', join(dir, keyName), '-n', namespace, file]);
  return readFileSync(`${file}.sig`, 'utf8');
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'kb-sshsig-'));
  for (const name of ['good', 'other']) {
    execFileSync('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', name, '-f', join(dir, name)]);
  }
  allowed = join(dir, 'allowed_signers');
  writeFileSync(allowed, `kb-ops-approver ${readFileSync(join(dir, 'good.pub'), 'utf8').trim()}\n`);
});
afterAll(() => { rmSync(dir, { recursive: true, force: true }); });

const base = { payload: MESSAGE, allowedSigners: () => allowed, principal: 'kb-ops-approver', namespace: 'kb-human-approval' };

describe('sshsig verifier', () => {
  it('accepts a signature from the allowed signer under the right namespace', async () => {
    expect(await defaultSshsigVerifier.verify({ ...base, allowedSigners: allowed, signature: sign('kb-human-approval') })).toBe(true);
  });
  it('rejects a key that is not an allowed signer', async () => {
    expect(await defaultSshsigVerifier.verify({ ...base, allowedSigners: allowed, signature: sign('kb-human-approval', 'other') })).toBe(false);
  });
  it('rejects the outbox instruction namespace', async () => {
    expect(await defaultSshsigVerifier.verify({ ...base, allowedSigners: allowed, signature: sign('kb-ops-instructions') })).toBe(false);
  });
  it('rejects a wrong principal', async () => {
    expect(await defaultSshsigVerifier.verify({ ...base, allowedSigners: allowed, principal: 'someone-else', signature: sign('kb-human-approval') })).toBe(false);
  });
  it('rejects a tampered payload', async () => {
    const signature = sign('kb-human-approval');
    expect(await defaultSshsigVerifier.verify({ ...base, allowedSigners: allowed, payload: Buffer.from('{}'), signature })).toBe(false);
  });
  it('rejects garbage in the signature slot', async () => {
    expect(await defaultSshsigVerifier.verify({ ...base, allowedSigners: allowed, signature: 'not a signature' })).toBe(false);
  });
  it('rejects an unreadable allowed-signers path', async () => {
    expect(await defaultSshsigVerifier.verify({ ...base, allowedSigners: join(dir, 'missing'), signature: sign('kb-human-approval') })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/authority/sshsig.test.ts`
Expected: FAIL — cannot resolve `./sshsig.ts`.

- [ ] **Step 3: Write the verifier**

Create `dashboard/server/authority/sshsig.ts`:

```ts
/**
 * SSHSIG verification for the human-approval channel — the ONLY module here that spawns a process.
 *
 * Same discipline as scripts/promote_vm_outbox.py#require_instruction_approval (:480): the message
 * goes in on stdin, the signature is handed over as a file because `ssh-keygen -Y verify` has no
 * stdin mode for it, and a verification counts as good ONLY on exit 0 AND empty stderr AND an
 * ANCHORED stdout token. `ssh-keygen` prints "Good ... signature" on stdout and diagnostics on
 * stderr, so any stderr output at all means something happened that we did not model — refuse.
 *
 * No shell. Absolute binary path with a PATH fallback for non-Linux dev hosts. Minimal env, so
 * nothing is read from a user ssh config. Bounded time and output.
 */
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const SSH_KEYGEN = process.platform === 'linux' ? '/usr/bin/ssh-keygen' : 'ssh-keygen';
const TIMEOUT_MS = 5_000;
const MAX_BUFFER = 64 * 1024;

export interface SshsigVerifyInput {
  payload: Buffer;
  /** The armored `-----BEGIN SSH SIGNATURE-----` block, verbatim. */
  signature: string;
  allowedSigners: string;
  principal: string;
  namespace: string;
}

export interface SshsigVerifier {
  verify(input: SshsigVerifyInput): Promise<boolean>;
}

function goodToken(namespace: string, principal: string): RegExp {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^Good "${escape(namespace)}" signature for ${escape(principal)}\\b`);
}

export const defaultSshsigVerifier: SshsigVerifier = {
  async verify(input) {
    let dir = '';
    try {
      dir = mkdtempSync(join(tmpdir(), 'kb-approval-'));
      const sigPath = join(dir, 'approval.sig');
      writeFileSync(sigPath, input.signature, { encoding: 'utf8', mode: 0o600 });
      const args = ['-Y', 'verify', '-f', input.allowedSigners, '-I', input.principal,
        '-n', input.namespace, '-s', sigPath];
      const { code, stdout, stderr } = await new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
        const child = execFile(SSH_KEYGEN, args, {
          timeout: TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: { PATH: '/usr/bin:/bin' },
        }, (error, out, err) => done({
          code: error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0,
          stdout: String(out), stderr: String(err),
        }));
        child.stdin?.end(input.payload);
      });
      if (code !== 0) return false;
      if (stderr.trim() !== '') return false;
      return goodToken(input.namespace, input.principal).test(stdout.trim());
    } catch {
      return false;                                    // spawn failure, missing binary, write failure
    } finally {
      if (dir) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } }
    }
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/authority/sshsig.test.ts`
Expected: PASS, 7 tests. If `ssh-keygen` is not on PATH the suite errors in `beforeAll` — install Git for Windows' OpenSSH or run this task's tests in the rehearsal host; do not weaken the test.

- [ ] **Step 5: Write the failing nonce-store test**

Create `dashboard/server/authority/nonceStore.test.ts` covering: a fresh nonce claims `fresh`; the same nonce claims `replayed`; a nonce whose `expiresAt` has passed claims `fresh` again after the clock advances; a store constructed a second time over the same `stateRoot` still sees the first store's claims (durability); the 10 001st live nonce claims `unavailable`; a `stateRoot` that cannot be written claims `unavailable`.

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createNonceStore } from './nonceStore.ts';

const hex = (n: number) => n.toString(16).padStart(32, '0');

describe('nonce store', () => {
  it('claims a fresh nonce once and refuses the replay', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-nonce-'));
    let now = 1_000_000;
    const store = createNonceStore(root, () => now);
    expect(store.claim(hex(1), now + 60_000)).toBe('fresh');
    expect(store.claim(hex(1), now + 60_000)).toBe('replayed');
  });

  it('forgets a nonce after its expiry', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-nonce-'));
    let now = 1_000_000;
    const store = createNonceStore(root, () => now);
    expect(store.claim(hex(2), now + 60_000)).toBe('fresh');
    now += 60_001;
    expect(store.claim(hex(2), now + 60_000)).toBe('fresh');
  });

  it('survives a restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-nonce-'));
    const now = 1_000_000;
    expect(createNonceStore(root, () => now).claim(hex(3), now + 60_000)).toBe('fresh');
    expect(createNonceStore(root, () => now).claim(hex(3), now + 60_000)).toBe('replayed');
  });

  it('refuses rather than evicting above the cap', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-nonce-'));
    const now = 1_000_000;
    const store = createNonceStore(root, () => now);
    for (let i = 0; i < 10_000; i += 1) expect(store.claim(hex(1000 + i), now + 900_000)).toBe('fresh');
    expect(store.claim(hex(999_999), now + 900_000)).toBe('unavailable');
  });

  it('reports unavailable when the state root cannot be written', () => {
    const store = createNonceStore(join(tmpdir(), 'kb-nonce-missing', '\0bad'), () => 1);
    expect(store.claim(hex(4), 60_000)).toBe('unavailable');
  });
});
```

- [ ] **Step 6: Run it, then write `nonceStore.ts`**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/authority/nonceStore.test.ts` — expected FAIL.

Write `dashboard/server/authority/nonceStore.ts`: a JSON document `{ schema: 'kb.approval-nonces/v1', rows: [{nonce, expiresAt}] }` at `join(stateRoot, 'authority', 'nonces.json')`. `claim()` reads (missing file ⇒ empty), prunes rows with `expiresAt <= now()`, refuses a live duplicate with `'replayed'`, refuses `'unavailable'` when `rows.length >= 10_000` **after** pruning, otherwise appends and writes through `atomicWriteFileSync` from `../atomicRename.ts` (read that module first and use its real export name). Any read/parse/write throw ⇒ `'unavailable'`. It is synchronous by design: a claim must not interleave with another claim.

Re-run. Expected: PASS, 5 tests.

- [ ] **Step 7: Write the failing approval test**

Create `dashboard/server/authority/approval.test.ts`. Build a valid payload helper, then one `it` per row of spec §4.2's check table, with an injected verifier `{ verify: async () => true }` so the ordering of checks — not the crypto — is what is under test:

```ts
import { describe, expect, it } from 'vitest';
import { canonicalApprovalPayload, verifyApproval, APPROVAL_SCHEMA } from './approval.ts';

const NOW = Date.parse('2026-09-16T19:40:00Z');
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function payload(over: Record<string, unknown> = {}) {
  return canonicalApprovalPayload({
    schema: APPROVAL_SCHEMA,
    route: 'POST /api/control/runs/:runRef/reconcile-publication',
    entityRef: 'run-abc',
    actor: 'daniel',
    issuedAt: iso(NOW),
    expiresAt: iso(NOW + 600_000),
    nonce: 'a'.repeat(32),
    ...over,
  } as never);
}

function input(over: Record<string, unknown> = {}) {
  return {
    approval: { payload: payload(), signature: 'sig' },
    expectedRoute: 'POST /api/control/runs/:runRef/reconcile-publication',
    expectedEntityRef: 'run-abc',
    allowedSigners: '/etc/kb/allowed',
    verifier: { verify: async () => true },
    nonces: { claim: () => 'fresh' as const },
    now: () => NOW,
    ...over,
  };
}

describe('verifyApproval', () => {
  it('accepts a well-formed, signed, fresh approval', async () => {
    expect(await verifyApproval(input() as never)).toEqual({ ok: true });
  });
  it('503s with no allowed-signers configured', async () => {
    expect(await verifyApproval(input({ allowedSigners: '' }) as never))
      .toEqual({ ok: false, status: 503, error: 'approval-unavailable' });
  });
  it('403 approval-required with no approval object', async () => {
    expect(await verifyApproval(input({ approval: undefined }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-required' });
  });
  it('403 approval-invalid on a wrong route', async () => {
    expect(await verifyApproval(input({ expectedRoute: 'POST /api/schedules' }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('403 approval-invalid on a wrong entityRef', async () => {
    expect(await verifyApproval(input({ expectedEntityRef: 'run-other' }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('403 approval-invalid on a wrong schema, wrong actor, extra key, or bad nonce shape', async () => {
    for (const over of [{ schema: 'other' }, { actor: 'boss' }, { extra: 'x' }, { nonce: 'zz' }]) {
      expect(await verifyApproval(input({ approval: { payload: payload(over), signature: 'sig' } }) as never))
        .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
    }
  });
  it('403 approval-invalid on a window wider than 15 minutes', async () => {
    expect(await verifyApproval(input({ approval: { payload: payload({ expiresAt: iso(NOW + 16 * 60_000) }), signature: 'sig' } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('403 approval-invalid on an issuedAt beyond the skew allowance', async () => {
    expect(await verifyApproval(input({ approval: { payload: payload({ issuedAt: iso(NOW + 120_000), expiresAt: iso(NOW + 300_000) }), signature: 'sig' } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('403 approval-expired past expiresAt', async () => {
    expect(await verifyApproval(input({ now: () => NOW + 700_000 }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-expired' });
  });
  it('403 approval-invalid when the signature does not verify', async () => {
    expect(await verifyApproval(input({ verifier: { verify: async () => false } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
  it('409 approval-replayed on a used nonce', async () => {
    expect(await verifyApproval(input({ nonces: { claim: () => 'replayed' as const } }) as never))
      .toEqual({ ok: false, status: 409, error: 'approval-replayed' });
  });
  it('does not claim the nonce when the signature fails', async () => {
    let claims = 0;
    await verifyApproval(input({
      verifier: { verify: async () => false },
      nonces: { claim: () => { claims += 1; return 'fresh' as const; } },
    }) as never);
    expect(claims).toBe(0);
  });
  it('refuses an oversized payload or signature', async () => {
    expect(await verifyApproval(input({ approval: { payload: 'x'.repeat(2049), signature: 'sig' } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
    expect(await verifyApproval(input({ approval: { payload: payload(), signature: 'x'.repeat(8193) } }) as never))
      .toEqual({ ok: false, status: 403, error: 'approval-invalid' });
  });
});
```

- [ ] **Step 8: Run it, then write `approval.ts`**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/authority/approval.test.ts` — expected FAIL.

Write `dashboard/server/authority/approval.ts` implementing spec §4.2's ten checks **in the table's order**. `canonicalApprovalPayload` must emit the seven keys in exactly this order with `JSON.stringify`:

```ts
export function canonicalApprovalPayload(p: ApprovalPayload): string {
  return JSON.stringify({
    schema: p.schema, route: p.route, entityRef: p.entityRef, actor: p.actor,
    issuedAt: p.issuedAt, expiresAt: p.expiresAt, nonce: p.nonce,
  });
}
```

Parsing uses an exact-key check (the `hasExactKeys` pattern at `dashboard/server/control/paidActionRoute.ts:49`). `verifyApproval` takes the received `payload` **string** and verifies those bytes — it never re-serializes. `nonces.claim(nonce, Date.parse(expiresAt))` is called last.

Re-run. Expected: PASS, 13 tests.

- [ ] **Step 9: Write the gate and its test**

Create `dashboard/server/authority/gate.test.ts` with a Fastify instance registering three throwaway routes (`POST /t/open`, `POST /t/signed`, `POST /t/none`) and a `classifyRoute` stub, asserting: GET passes; open passes; unclassified ⇒ `403 route-unclassified`; signed without approval ⇒ `403 approval-required`; signed with a good approval ⇒ handler runs; every refusal appended exactly one audit row with `action: 'authority-approval-refused'` and no `payload`/`signature` anywhere in the row's JSON.

Run it (expected FAIL), then write `dashboard/server/authority/gate.ts`:

```ts
export function requireAuthority(ctx: SurfaceContext): preHandlerHookHandler {
  return async function preHandlerRequireAuthority(req, reply) {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
    const url = req.routeOptions?.url ?? '';
    const entry = classifyRoute(req.method, url);
    if (!entry) { await refuse(reply, 403, 'route-unclassified', url); return; }
    if (entry.cls === 'none') { await refuse(reply, 403, 'route-unavailable', url); return; }
    if (entry.cls === 'open') return;
    const body = record(req.body);
    const entityRef = entry.entityParam
      ? String((req.params as Record<string, unknown>)[entry.entityParam] ?? '')
      : entry.entityFromBody?.(body) ?? '';
    const result = await verifyApproval({
      approval: body.approval,
      expectedRoute: routeKey(entry),
      expectedEntityRef: entityRef,
      allowedSigners: ctx.humanApproverAllowedSigners ?? '',
      verifier: ctx.sshsigVerifier ?? defaultSshsigVerifier,
      nonces: ctx.approvalNonces ?? createNonceStore(ctx.stateRoot),
      now: () => (ctx.now?.() ?? new Date()).getTime(),
    });
    if (!result.ok) { await refuse(reply, result.status, result.error, url, entityRef); return; }
  };
}
```

`refuse` appends the audit row through `auditFn(ctx)` before replying, and swallows an audit failure (the refusal must still land). Add `humanApproverAllowedSigners?: string`, `sshsigVerifier?: SshsigVerifier`, `approvalNonces?: NonceStore` to `SurfaceContext` in `dashboard/server/http/context.ts`, resolved once in `makeSurfaceContext` from `process.env.DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS`.

Re-run. Expected: PASS.

- [ ] **Step 10: Install the gate on the governed scope**

In `dashboard/server/http/surface.ts:654`, inside `scope.register(async (authenticated) => {...})`, add immediately after the `requireSession` hook and before every `register*Routes(authenticated, ctx)` call:

```ts
      authenticated.addHook('preHandler', requireAuthority(ctx));
```

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test` — expected: some existing route tests now 403 because their fixtures call signed routes without an approval. Fix them by supplying a stub `sshsigVerifier` + approval in the fixture, never by widening the table.

- [ ] **Step 11: Require the env at boot and in the validator**

In `dashboard/server/auth/mode.ts#assertAuthModeBoot`, after the tailnet config resolution, add:

```ts
  const allowedSigners = env.DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS?.trim() ?? '';
  if (!allowedSigners || !allowedSigners.startsWith('/')) {
    throw new AuthModeError(
      'tailnet auth mode requires DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS to be an absolute path '
      + '(the root-owned allowed-signers file for the kb-ops-approver human-approval channel)',
    );
  }
```

In `deploy/validate_vm_runtime.py`, add `"DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS"` to `EXPECTED_UNIT_ENV` and a `_validate_human_approver_signers(environment)` asserting the value is absolute, is under `/usr/local/lib/kb/` or `/etc/kb/`, and that the file exists and is a regular non-symlink file owned by root with mode `0o644`. Call it beside the other validators at `:550`.
In `deploy/systemd/kb-dashboard.service`, add
`Environment=DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS=/usr/local/lib/kb/kb-ops-approver.allowed-signers`
with a comment stating it is **public** ssh key material, never a credential.
In `deploy/bootstrap_vm.py`, install that file from the operator-supplied source with mode `0644`, owner root.
In `scripts/vm_launch_preflight.sh`, add a section asserting the unit env is set and the file is readable and non-empty.

- [ ] **Step 12: Python tests and commit**

Run: `cd C:/Users/danie/kb-worktrees/authority && python -m pytest tests -q` — add a case for a unit missing the new env (expect "environment assignment set is not closed" or your new validator's message) and one for a world-writable signers file.
Then: `cd dashboard && npm test && npm run typecheck`.

```bash
cd C:/Users/danie/kb-worktrees/authority
git add -A
git commit -m "feat(authority): ssh-signed human-approval channel with nonce replay refusal

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Actor header, audit attribution, and resolvedBy

**Depends on:** T1 (imports nothing from it, but shares no files with T2/T3 except `middleware.ts`, which T3 does not touch). **Parallel with:** T3.

**Files:**
- Create: `dashboard/server/authority/actor.ts`, `dashboard/server/authority/actor.test.ts`
- Modify: `dashboard/server/auth/operator.ts`, `dashboard/server/http/middleware.ts`, `dashboard/server/audit/log.ts` (+ `log.test.ts`, `attribution.test.ts`), `dashboard/server/control/types.ts`, `dashboard/server/control/store.ts` (+ tests), `dashboard/server/control/humanResponse.ts` (+ test), `dashboard/server/services/runReadService.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type Actor = 'daniel' | 'boss' | `worker:${string}` | 'unknown'`; `function parseActor(header: string | string[] | undefined): Actor`; `const ACTOR_HEADER = 'x-kb-actor'`.
  - `AuditEvent` gains `actor?: string`.
  - `HumanRequest['response']` gains `resolvedBy: { actor: string; tailnetIdentity: string | null; at: string; reason: string } | null`.
  - `RespondHumanRequestInput` gains `resolvedBy` (same shape, not null).
  - `HumanResponseInput` gains `reason: string` and `actorLabel: Actor`.

- [ ] **Step 1: Write the failing actor test**

Create `dashboard/server/authority/actor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseActor } from './actor.ts';

describe('parseActor', () => {
  it('accepts the three shapes', () => {
    expect(parseActor('daniel')).toBe('daniel');
    expect(parseActor('boss')).toBe('boss');
    expect(parseActor('worker:sonnet-01')).toBe('worker:sonnet-01');
    expect(parseActor('worker:a.b_c-d')).toBe('worker:a.b_c-d');
  });
  it('is total: anything else is unknown', () => {
    for (const bad of [undefined, '', '  ', 'DANIEL', 'worker:', 'worker:-x', 'worker:' + 'a'.repeat(64),
      'operator', 'daniel; drop', ['boss', 'daniel'] as unknown as string, 'worker:a b']) {
      expect(parseActor(bad as never)).toBe('unknown');
    }
  });
});
```

Run (expected FAIL), then write `actor.ts`: trim, reject non-string and arrays, exact match `daniel`/`boss`, else `^worker:([a-z0-9][a-z0-9._-]{0,63})$`, else `'unknown'`. The module docstring must state, in its first paragraph, that the header is **self-asserted and never widens authority**.
Re-run. Expected: PASS.

- [ ] **Step 2: Write the failing authority-invariance test**

Append to `actor.test.ts` a Fastify-level test: build the test surface, hit `POST /api/control/runs/:runRef/archive` (open) and a signed route four times each with `X-KB-Actor` of `daniel`, `boss`, `worker:x`, and absent; assert the four statuses are identical in both cases.

```ts
it('no actor header changes any status', async () => {
  const app = await buildTestSurface();
  try {
    for (const path of ['/api/control/runs/run-x/archive', '/api/control/runs/run-x/reconcile-publication']) {
      const statuses = await Promise.all([
        { 'x-kb-actor': 'daniel' }, { 'x-kb-actor': 'boss' }, { 'x-kb-actor': 'worker:x' }, {},
      ].map(async (headers) => (await app.inject({ method: 'POST', url: path, headers, payload: {} })).statusCode));
      expect(new Set(statuses).size).toBe(1);
    }
  } finally { await app.close(); }
});
```

Run — expected PASS immediately (nothing reads the header yet). Keep it: it is the regression guard for every later task.

- [ ] **Step 3: Bind the actor to the request attribution**

In `dashboard/server/auth/operator.ts`, add `actor: Actor` to the attribution object and to `attributionLabel`'s input type (label output unchanged). In `dashboard/server/http/middleware.ts#resolveSession`, call `parseActor(req.headers[ACTOR_HEADER])` and pass it into `bindAttribution` on the operator branch, and bind `{ actor, tailnetIdentity: null }` on the bearer branch so `win32-desktop` also records an actor.

- [ ] **Step 4: Write the failing audit test, then stamp the row**

In `dashboard/server/audit/log.test.ts` add:

```ts
it('stamps the bound actor on the row', () => {
  bindAttribution({ actor: 'boss', login: 'daniel@example', node: 'desk' } as never);
  const row = appendAuditRowLocal(repoRoot, { action: 'test' });
  expect(row.actor).toBe('boss');
  expect((row.detail as Record<string, unknown>).tailnetIdentity).toBeTruthy();
  resetAttribution();
});

it('is byte-identical to today with no attribution bound', () => {
  resetAttribution();
  const row = appendAuditRowLocal(repoRoot, { action: 'test' });
  expect(Object.keys(row).sort()).toEqual(['action', 'ts']);
});
```

Run (expected FAIL), then extend `AuditEvent` with `actor?: string` and `attributed()` (`audit/log.ts:108`) to fill `actor` from `currentAttribution()` when the caller left it unset. Do **not** change the no-attribution path: it must still return the event by identity.
Re-run. Expected: PASS.

- [ ] **Step 5: Write the failing resolvedBy test, then thread it**

In `dashboard/server/control/humanResponse.test.ts` add:

```ts
it('refuses a response with no reason', async () => {
  const result = await service.respond({ ...validInput, reason: '   ' } as never);
  expect(result).toMatchObject({ ok: false, status: 400, error: 'reason-required' });
});

it('records resolvedBy on the resolved request', async () => {
  const result = await service.respond({ ...validInput, reason: 'sources look right', actorLabel: 'boss' } as never);
  expect(result.ok).toBe(true);
  expect(store.lastRespondInput.resolvedBy).toEqual({
    actor: 'boss', tailnetIdentity: null, at: expect.any(String), reason: 'sources look right',
  });
});
```

Run (expected FAIL), then:
1. `dashboard/server/services/runReadService.ts:128` — read `reason` off the body, `400 { error: 'reason-required' }` when it is absent, not a string, empty after trim, or over 2000 chars; read `X-KB-Actor` via a new `actorLabel` argument the route passes; drop `ceremonyAssertion`/`challengeExpiresAt` from the port call (T2 removed them).
2. `dashboard/server/control/humanResponse.ts` — `HumanResponseInput` gains `reason: string` and `actorLabel: Actor`; build `resolvedBy` and pass it into `store.respondHumanRequest`; add `reason` and `actor` to the audit row's `detail`.
3. `dashboard/server/control/types.ts` + `store.ts` — `resolvedBy` on the stored response (nullable for legacy rows) and on `RespondHumanRequestInput`; carry it into the event `appendResponseEvent` emits.
4. `dashboard/server/control/routes.ts:1985` and `dashboard/server/api/v1/routes.ts:683` — pass `parseActor(req.headers[ACTOR_HEADER])` through.
5. `dashboard/server/control/routes.ts:2243` (iteration-gate resolve) — same `reason` requirement and same `resolvedBy`.

Re-run: `npm test -- server/control/humanResponse.test.ts server/control/routes.test.ts`. Expected: PASS.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test && npm run typecheck
cd C:/Users/danie/kb-worktrees/authority
git add -A
git commit -m "feat(authority): record the acting CLI on every audit row and resolved gate

X-KB-Actor is self-asserted, so it is a label and never an authority input;
actor.test.ts asserts four different headers produce identical statuses.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Workflow tags and the boss intervention rule

**Depends on:** T3 (`verifyApproval`) and T4 (`reason`, `resolvedBy`).

**Files:**
- Modify: `dashboard/server/workflows/defs.ts` (+ `defs.test.ts`), `dashboard/server/workflows/routes.ts`, `dashboard/server/control/humanResponse.ts` (+ test), `dashboard/server/control/routes.ts`

**Interfaces:**
- Consumes: `verifyApproval` (T3), `Actor`/`reason` plumbing (T4).
- Produces:
  - `WorkflowDef.tags: string[]`
  - `function effectiveWorkflowTags(def: WorkflowDef): ReadonlySet<string>`
  - `HumanResponseService` options gain `workflowTags: (actorSubject: string, runRef: string) => Awaitable<ReadonlySet<string>>` and `verifyApproval?: (approval: unknown) => Awaitable<{ ok: true } | { ok: false; status: 403 | 409 | 503; error: string }>`.

- [ ] **Step 1: Write the failing defs test**

In `dashboard/server/workflows/defs.test.ts`:

```ts
it('parses a bounded tags list', () => {
  const def = parseOk(withFrontmatter({ tags: ['publish', 'nightly'] }));
  expect(def.tags).toEqual(['publish', 'nightly']);
});
it('defaults tags to the empty list', () => {
  expect(parseOk(withFrontmatter({})).tags).toEqual([]);
});
it('refuses a bad tags list', () => {
  for (const tags of [['Publish'], ['a'.repeat(33)], ['x', 'x'], new Array(9).fill('a'), 'publish', [1]]) {
    expect(parseWorkflowDef(withFrontmatter({ tags }), opts).ok).toBe(false);
  }
});
it('derives publish from a publish: action and from publicationAuthorization', () => {
  expect([...effectiveWorkflowTags(parseOk(withStage({ action: 'publish:video' })))]).toContain('publish');
  expect([...effectiveWorkflowTags(parseOk(withStage({
    action: 'draft:x', humanGates: [{ id: 'g', kind: 'approval', prompt: 'ok?', publicationAuthorization: true }],
  })))]).toContain('publish');
});
it('derives spend from spendAuthorization', () => {
  expect([...effectiveWorkflowTags(parseOk(withStage({
    action: 'draft:x', humanGates: [{ id: 'g', kind: 'approval', prompt: 'spend?', spendAuthorization: true }],
  })))]).toContain('spend');
});
it('leaves an ordinary definition untagged', () => {
  expect([...effectiveWorkflowTags(parseOk(withStage({ action: 'report:self-lint' })))]).toEqual([]);
});
```

- [ ] **Step 2: Run it, then implement**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/workflows/defs.test.ts` — expected FAIL.

In `defs.ts`: add `'tags'` to the top-level allowlist (`:1120`); add `tags: string[]` to `WorkflowDef` (`:267`) with the doc comment "governing labels; `publish` and `spend` escalate gate resolution to the signed channel (spec §4.4)"; validate exactly as the test demands and set `tags` on the returned value; export:

```ts
export function effectiveWorkflowTags(def: WorkflowDef): ReadonlySet<string> {
  const tags = new Set(def.tags);
  for (const stage of def.stages) {
    if (stage.action.startsWith('publish:')) tags.add('publish');
    for (const gate of stage.humanGates ?? []) {
      if (gate.publicationAuthorization === true) tags.add('publish');
      if (gate.spendAuthorization === true) tags.add('spend');
    }
  }
  return tags;
}
```

Re-run. Expected: PASS.

- [ ] **Step 3: Write the failing escalation test**

In `dashboard/server/control/humanResponse.test.ts`:

```ts
it('resolves an untagged run with no approval', async () => {
  const service = make({ workflowTags: () => new Set<string>() });
  expect((await service.respond(validInput)).ok).toBe(true);
});
it('refuses a publish-tagged run with no approval', async () => {
  const service = make({ workflowTags: () => new Set(['publish']) });
  expect(await service.respond(validInput)).toMatchObject({ ok: false, status: 403, error: 'approval-required' });
});
it('refuses a spend-tagged run with no approval', async () => {
  const service = make({ workflowTags: () => new Set(['spend']) });
  expect(await service.respond(validInput)).toMatchObject({ ok: false, status: 403, error: 'approval-required' });
});
it('accepts a tagged run with a valid approval', async () => {
  const service = make({ workflowTags: () => new Set(['publish']), verifyApproval: async () => ({ ok: true as const }) });
  expect((await service.respond({ ...validInput, approval: { payload: 'p', signature: 's' } })).ok).toBe(true);
});
it('passes a verifier refusal through verbatim', async () => {
  const service = make({
    workflowTags: () => new Set(['publish']),
    verifyApproval: async () => ({ ok: false as const, status: 409 as const, error: 'approval-replayed' }),
  });
  expect(await service.respond({ ...validInput, approval: {} })).toMatchObject({ status: 409, error: 'approval-replayed' });
});
it('ignores the actor label when deciding', async () => {
  const service = make({ workflowTags: () => new Set(['publish']) });
  for (const actorLabel of ['daniel', 'boss', 'worker:x', 'unknown'] as const) {
    expect(await service.respond({ ...validInput, actorLabel })).toMatchObject({ status: 403, error: 'approval-required' });
  }
});
```

- [ ] **Step 4: Run it, then implement the rule**

Run — expected FAIL.

In `humanResponse.ts#createHumanResponseService`, in the slot the deleted T3 ceremony block occupied (after the revision check, before the audit append):

```ts
      const tags = await options.workflowTags(input.actor.subject, request.runRef);
      const signedRequired = tags.has('publish') || tags.has('spend');
      if (signedRequired) {
        if (!options.verifyApproval) return { ok: false, status: 503, error: 'approval-unavailable' };
        if (input.approval == null) return { ok: false, status: 403, error: 'approval-required' };
        const checked = await options.verifyApproval(input.approval);
        if (!checked.ok) return { ok: false, status: checked.status, error: checked.error };
      }
```

Widen `HumanResponseResult`'s failure statuses to `403 | 404 | 409 | 500 | 503`. Add `signedRequired` and the tag list to the audit row's `detail`.

Production wiring in `dashboard/server/control/routes.ts`: `workflowTags` resolves the run → its workflow id → `scanWorkflowDefs(ctx.repoRoot)` → `effectiveWorkflowTags(def)`, memoised per request; a run whose workflow cannot be resolved returns `new Set(['publish', 'spend'])` — **fail closed**, an unresolvable workflow is treated as tagged. `verifyApproval` is bound with `expectedRoute = routeKey(classifyRoute('POST', req.routeOptions.url)!)` and `expectedEntityRef = requestRef`.

Apply the identical block to the iteration-gate resolve route's service.

Re-run. Expected: PASS.

- [ ] **Step 5: Full suite, typecheck, commit**

```bash
cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test && npm run typecheck
cd C:/Users/danie/kb-worktrees/authority
git add -A
git commit -m "feat(authority): publish/spend-tagged workflows escalate gate resolution to the signed channel

Tags are DERIVED, not merely declared: a publish: action or a publication/spend
human gate tags the workflow whatever its frontmatter says.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Signed budget override

**Depends on:** T3 (`verifyApproval`, the gate).

**Files:**
- Create: `dashboard/server/control/budgetOverride.ts`, `dashboard/server/control/budgetOverride.test.ts`
- Modify: `dashboard/server/control/adapters.ts` (+ test), `dashboard/server/control/activation.ts`, `dashboard/server/control/routes.ts`, `dashboard/server/http/context.ts`

**Interfaces:**
- Consumes: the gate (T3) already enforces the signature; this task only implements the route body and the store.
- Produces:
  - `interface BudgetOverride { windowDay: string; additionalUsdMicros: number; grantedAt: string; actor: string; nonce: string }`
  - `interface BudgetOverrideStore { additionalUsdMicros(windowDay: string): number; grant(o: BudgetOverride): 'granted' | 'replayed' | 'refused' }`
  - `function createBudgetOverrideStore(stateRoot: string, now?: () => Date): BudgetOverrideStore`
  - `AccountingPolicy.windowBudgetFor?: (windowId: string) => ExecutionBudget`
  - `POST /api/control/budget/override`

- [ ] **Step 1: Write the failing store test**

Create `dashboard/server/control/budgetOverride.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createBudgetOverrideStore } from './budgetOverride.ts';

const grant = (over = {}) => ({
  windowDay: '2026-09-16', additionalUsdMicros: 5_000_000,
  grantedAt: '2026-09-16T19:40:00Z', actor: 'daniel', nonce: 'a'.repeat(32), ...over,
});

describe('budget override store', () => {
  it('starts at zero and sums grants for the day', () => {
    const store = createBudgetOverrideStore(mkdtempSync(join(tmpdir(), 'kb-bo-')));
    expect(store.additionalUsdMicros('2026-09-16')).toBe(0);
    expect(store.grant(grant())).toBe('granted');
    expect(store.grant(grant({ nonce: 'b'.repeat(32) }))).toBe('granted');
    expect(store.additionalUsdMicros('2026-09-16')).toBe(10_000_000);
    expect(store.additionalUsdMicros('2026-09-17')).toBe(0);
  });
  it('is idempotent on the nonce', () => {
    const store = createBudgetOverrideStore(mkdtempSync(join(tmpdir(), 'kb-bo-')));
    expect(store.grant(grant())).toBe('granted');
    expect(store.grant(grant())).toBe('replayed');
    expect(store.additionalUsdMicros('2026-09-16')).toBe(5_000_000);
  });
  it('refuses a grant above the per-grant ceiling', () => {
    const store = createBudgetOverrideStore(mkdtempSync(join(tmpdir(), 'kb-bo-')));
    expect(store.grant(grant({ additionalUsdMicros: 20_000_001 }))).toBe('refused');
  });
  it('refuses a grant that would take the day above 60_000_000', () => {
    const store = createBudgetOverrideStore(mkdtempSync(join(tmpdir(), 'kb-bo-')));
    for (let i = 0; i < 3; i += 1) {
      expect(store.grant(grant({ additionalUsdMicros: 20_000_000, nonce: String(i).repeat(32).slice(0, 32) }))).toBe('granted');
    }
    expect(store.grant(grant({ additionalUsdMicros: 1, nonce: 'f'.repeat(32) }))).toBe('refused');
  });
  it('survives a restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'kb-bo-'));
    createBudgetOverrideStore(root).grant(grant());
    expect(createBudgetOverrideStore(root).additionalUsdMicros('2026-09-16')).toBe(5_000_000);
  });
});
```

- [ ] **Step 2: Run it, then write the store**

Run: `cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test -- server/control/budgetOverride.test.ts` — expected FAIL.

Write `budgetOverride.ts`: document `{ schema: 'kb.budget-overrides/v1', rows: BudgetOverride[] }` at `join(stateRoot, 'authority', 'budget-overrides.json')`, atomic write, `windowDay` validated `/^\d{4}-\d{2}-\d{2}$/`, `additionalUsdMicros` a positive safe integer ≤ 20 000 000, per-day sum ≤ 60 000 000, idempotent on `nonce`, any read/write failure ⇒ `'refused'` and `additionalUsdMicros` ⇒ `0` (fail closed: an unreadable override document means no override).
Re-run. Expected: PASS.

- [ ] **Step 3: Write the failing accounting test**

In `dashboard/server/control/adapters.test.ts`:

```ts
it('reserves against the per-window budget when windowBudgetFor is supplied', async () => {
  const base = { maxAttempts: 300, maxInputTokens: 6_000_000, maxOutputTokens: 400_000, maxCostUsdMicros: 20_000_000 };
  const accounting = createAccounting({
    ...opts, globalBudget: base,
    windowBudgetFor: () => ({ ...base, maxCostUsdMicros: 25_000_000 }),
  });
  // a reservation that fits only under the raised ceiling
  expect((await accounting.reserve(reservationCosting(22_000_000))).ok).toBe(true);
});

it('leaves the policy hash unchanged when windowBudgetFor is supplied', () => {
  expect(policyHash({ ...policy, windowBudgetFor: () => budget })).toBe(policyHash(policy));
});
```

- [ ] **Step 4: Run it, then change the three reads**

Run — expected FAIL.

In `dashboard/server/control/adapters.ts`: add `windowBudgetFor?: (windowId: string) => ExecutionBudget` to `AccountingPolicy` (`:495`) with the doc comment "resolved at RESERVE time; absent ⇒ today's behaviour, bit for bit". In the reserve mutate closure, before the first check, add
`const windowBudget = options.windowBudgetFor?.(windowId) ?? options.globalBudget;`
and replace `options.globalBudget` at `:979`, `:982`, `:990` with `windowBudget`. Leave `assertBudget`, `LEGACY_POLICIES` and the policy-hash serialization reading `globalBudget` only — a function is not serializable and must not enter the hash.

In `dashboard/server/control/activation.ts:516-568`, thread `windowBudgetFor` from a new `budgetOverrides?: BudgetOverrideStore` build option:
```ts
    ...(options.budgetOverrides ? { windowBudgetFor: (windowId: string) => ({
      ...budget,
      maxCostUsdMicros: budget.maxCostUsdMicros + options.budgetOverrides!.additionalUsdMicros(windowId),
    }) } : {}),
```
Re-run. Expected: PASS.

- [ ] **Step 5: Write the failing route test, then the route**

In `dashboard/server/control/routes.test.ts` assert: no approval ⇒ `403 approval-required` (the gate, T3); a good approval ⇒ `200 { ok: true, windowDay, additionalUsdMicros, resultingCeilingUsdMicros }`; a body with an unknown key ⇒ `400 invalid-budget-override`; an audit-append failure ⇒ `500 budget-override-audit-required`; the audit row lands before the grant.

Run (expected FAIL), then add to `dashboard/server/control/routes.ts`, next to the retention routes:

```ts
  scope.post('/api/control/budget/override', { preHandler }, async (req, reply) => {
    const sub = subject(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
    const body = record(req.body);
    if (!hasExactKeys(body, ['windowDay', 'additionalUsdMicros', 'idempotencyKey', 'approval'])) {
      return reply.code(400).send({ error: 'invalid-budget-override' });
    }
    const store = ctx.budgetOverrides;
    if (!store) return reply.code(503).send({ error: 'budget-override-unavailable' });
    const windowDay = string(body.windowDay);
    const additionalUsdMicros = integer(body.additionalUsdMicros);
    const nonce = approvalNonceOf(body.approval);          // the payload's nonce, already verified by the gate
    if (!/^\d{4}-\d{2}-\d{2}$/.test(windowDay) || additionalUsdMicros <= 0 || nonce === null) {
      return reply.code(400).send({ error: 'invalid-budget-override' });
    }
    const resulting = DEFAULT_BUDGET.maxCostUsdMicros + store.additionalUsdMicros(windowDay) + additionalUsdMicros;
    try {
      await auditFn(ctx)(ctx.repoRoot, {
        action: 'control-budget-override-authorize', owner: sub, target: windowDay, riskTier: 'T3',
        result: `authorized:${additionalUsdMicros}`,
        detail: { windowDay, additionalUsdMicros, resultingCeilingUsdMicros: resulting },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'budget-override-audit-required' });
    }
    const outcome = store.grant({
      windowDay, additionalUsdMicros, grantedAt: (ctx.now?.() ?? new Date()).toISOString(),
      actor: 'daniel', nonce,
    });
    if (outcome === 'refused') return reply.code(409).send({ error: 'budget-override-ceiling-reached' });
    return reply.send({ ok: true, windowDay, additionalUsdMicros, resultingCeilingUsdMicros: resulting, replayed: outcome === 'replayed' });
  });
```

Add `budgetOverrides?: BudgetOverrideStore` to `SurfaceContext` and construct it once in `makeSurfaceContext` over `ctx.stateRoot`.

Re-run. Expected: PASS.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test && npm run typecheck
cd C:/Users/danie/kb-worktrees/authority
git add -A
git commit -m "feat(authority): signed budget override raises only the day's cost ceiling

The window ceiling is now resolved at reserve time, so a grant reaches a running
daemon; only maxCostUsdMicros moves, and the resolver is excluded from the
accounting policy hash so an override never invalidates the day's document.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Generalize the session hook

**Depends on:** nothing. **Parallel with:** T1, T2, T8.

**Files:**
- Modify: `scripts/hooks/prod_window_guard.js`, `tests/hooks/prod_window_guard.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: rule ids `A4o` (open-class script) and `A4w` (windowed-class script) in the audit line; open shapes `O1` (`prod-run-workflow.ps1`), `O2` (`prod-respond.ps1`), `O3` (`prod-schedules.ps1`); windowed shape `C13` (`prod-sign-approval.ps1`); classifier arm `A6` (`ssh-keygen -Y sign -n kb-human-approval`).

- [ ] **Step 1: Write the failing tests**

Read `tests/hooks/prod_window_guard.test.js` first and reuse its `setWindow`, `run`, `payload` helpers verbatim. Append:

```js
test('open class: prod-run-workflow with any safe workflow id runs with the window CLOSED', () => {
  setWindow('closed');
  assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-run-workflow.ps1 -Workflow nightly-digest'), 0);
  assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-run-workflow.ps1 -Workflow v1-acceptance-demo -Topic tailnet-trust'), 0);
});

test('open class: a traversal in -Workflow or -Topic is still refused', () => {
  setWindow('closed');
  assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-run-workflow.ps1 -Workflow ../evil'), 2);
  assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-run-workflow.ps1 -Workflow ok -Topic ../x'), 2);
});

test('open class: prod-respond with a reason runs with the window CLOSED', () => {
  setWindow('closed');
  assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-respond.ps1 -Run run-cc508ddb -Request req-1 '
    + '-Decision approve -Reason "sources added, brief is correct"'), 0);
});

test('open class: prod-respond refuses an injection-bearing reason or a bad decision', () => {
  setWindow('closed');
  for (const cmd of [
    '-Run run-1 -Request req-1 -Decision approve -Reason "a; rm -rf /"',
    '-Run run-1 -Request req-1 -Decision approve -Reason "a $(whoami)"',
    '-Run run-1 -Request req-1 -Decision approve -Reason "a `id`"',
    '-Run run-1 -Request req-1 -Decision publish -Reason "ok"',
    '-Run run-1 -Request req-1 -Decision approve',
  ]) assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-respond.ps1 ' + cmd), 2);
});

test('open class: prod-schedules four modes run with the window CLOSED', () => {
  setWindow('closed');
  assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-schedules.ps1 -List'), 0);
  assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-schedules.ps1 -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * *"'), 0);
});

test('open class is still subject to the standing blocks', () => {
  setWindow('closed');
  assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-respond.ps1 -Run r -Request q -Decision approve -Reason "x" '
    + '&& rm -rf /'), 2);
});

test('windowed class: prod-sign-approval needs a window', () => {
  setWindow('closed');
  assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-sign-approval.ps1 -Route "POST /api/schedules/:id" -Entity sched-7'), 2);
  setWindow('open');
  assert.equal(run('Bash', PS + ' -File ' + T + '\\prod-sign-approval.ps1 -Route "POST /api/schedules/:id" -Entity sched-7'), 0);
});

test('windowed class: the human-approval signing command needs a window', () => {
  setWindow('closed');
  assert.equal(run('Bash', 'ssh-keygen -Y sign -f C:\\Users\\danie\\.ssh\\kb-ops-approver -n kb-human-approval '
    + 'C:\\Users\\danie\\kb-backups\\approval-current\\payload.json'), 2);
});

test('windowed class: deploy and drain are unchanged', () => {
  setWindow('closed');
  assert.equal(run('Bash', PS + ' -File ' + T + '\\kb-deploy.ps1 -SigningKey k -Sha ' + SHA + ' -BrokerDigest ' + DIGEST), 2);
  setWindow('open');
  assert.equal(run('Bash', PS + ' -File ' + T + '\\kb-deploy.ps1 -SigningKey k -Sha ' + SHA + ' -BrokerDigest ' + DIGEST), 0);
});

test('Agent is still blocked while a window is open', () => {
  setWindow('open');
  assert.equal(run('Agent', null, { prompt: 'do something' }), 2);
});
```

- [ ] **Step 2: Run to verify the new tests fail**

Run: `cd C:/Users/danie/kb-worktrees/authority && node --test tests/hooks/prod_window_guard.test.js`
Expected: the new open-class tests FAIL (exit 2 where 0 is expected); the existing tests still PASS.

- [ ] **Step 3: Implement the class split**

In `scripts/hooks/prod_window_guard.js`:

1. Replace the single `PROD_DEFAULT_SCRIPTS` with:
```js
const OPEN_SCRIPTS = /(prod-run-workflow\.ps1|prod-respond\.ps1|prod-schedules\.ps1)/;
const WINDOWED_SCRIPTS = /(kb-deploy\.ps1|drain-step[12]-v2\.ps1|ops-refresh\.ps1|vm-preflight-prod\.ps1|prod-stop-run\.ps1|prod-canary-launch\.ps1|prod-sign-approval\.ps1)/;
```
2. In `isProdTargeting`, replace the `PROD_DEFAULT_SCRIPTS` arm with
```js
  if (OPEN_SCRIPTS.test(n)) return 'A4o';
  if (WINDOWED_SCRIPTS.test(n)) return 'A4w';
```
   and add, beside the existing A5 arm:
```js
  if (/ssh-keygen\s+-y\s+sign\b/.test(n) && n.indexOf('kb-human-approval') !== -1) return 'A6';
```
3. Widen C8 to
```js
const C8 = new RegExp(PRE + PS + '-file\\s+' + P('prod-run-workflow.ps1')
  + '\\s+-workflow\\s+([a-z0-9][a-z0-9-]{0,63})'
  + '(?:\\s+-topic\\s+([a-z0-9._-]{1,40}))?$');
```
   and in `allowlistMatch`, keep the `..` veto on both captures and drop the "topic only for the demo" rule.
4. Collapse C9–C12 into one `O3` regex admitting the four documented `prod-schedules.ps1` modes, keeping `tpath()`'s traversal veto on every path argument and `CRON_ARG` on `-Cron`.
5. Add the `prod-respond.ps1` shape:
```js
const REASON = '("[^"`$;&|]{1,300}"|\'[^\'`$;&|]{1,300}\')';
const O2 = new RegExp(PRE + PS + '-file\\s+' + P('prod-respond.ps1')
  + '\\s+-run\\s+([a-z0-9-]{1,80})\\s+-request\\s+([a-z0-9-]{1,80})'
  + '\\s+-decision\\s+(approve|retry|abandon)\\s+-reason\\s+' + REASON + '$');
```
6. Add `C13` for `prod-sign-approval.ps1`:
```js
const C13 = new RegExp(PRE + PS + '-file\\s+' + P('prod-sign-approval.ps1')
  + '\\s+-route\\s+("[a-z]+ /api/[a-z0-9/:_-]{1,120}"|\'[a-z]+ /api/[a-z0-9/:_-]{1,120}\')'
  + '\\s+-entity\\s+([a-z0-9._:-]{1,120})'
  + '(?:\\s+-ttlminutes\\s+([0-9]{1,2}))?(?:\\s+-signingkey\\s+' + PATHARG + ')?$');
```
7. Split `allowlistMatch` into `openMatch(n)` (O1/O2/O3) and the existing windowed `allowlistMatch(n)` (C1–C7, C13).
8. In `decide()`, after the standing-block check and before `readWindow`:
```js
  if (prodRule === 'A4o') {
    const open = openMatch(n);
    if (!open) {
      block('this is an open-class prod script, but the command is not one of its reviewed shapes '
        + '(prod-run-workflow -Workflow <safe-id> [-Topic <safe-id>] / prod-respond -Run -Request -Decision -Reason / '
        + 'prod-schedules -List|-DisarmAgentCadences|-ArmFromSnapshot|-CreateWorkflowSchedule). '
        + 'Fix the arguments, or add the shape to scripts/hooks/prod_window_guard.js and its tests first.',
        tool, prodRule, command, true);
    }
    audit('ALLOW', tool, open, command);
    process.exit(0);
  }
```
9. Extend the fail-closed `catch`'s `smells` regex with `prod-respond\.ps1` and `prod-sign-approval\.ps1`.
10. Update the module header to describe the three classes and state that the daemon, not this hook, is the authority (spec §5).

Rules D1–D8, C0, `readWindow`, `audit`, `maskSecrets` are untouched.

- [ ] **Step 4: Run the whole hook suite**

Run: `cd C:/Users/danie/kb-worktrees/authority && node --test tests/hooks/prod_window_guard.test.js`
Expected: PASS, every test including the pre-existing ones.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/danie/kb-worktrees/authority
git add scripts/hooks/prod_window_guard.js tests/hooks/prod_window_guard.test.js
git commit -m "feat(hook): split prod scripts into open and windowed classes

Open-class monitoring, launching, responding and schedule management no longer
need a deploy window; deploy, drain, signing and root ssh still do. The hook is
a fast local second layer — the daemon's policy table is the authority.

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Desktop scripts

**Depends on:** nothing. **Parallel with:** T1, T2, T7.

**Files (tooling, NOT the repo — do not `git add` them):**
- Create: `C:\Users\danie\kb-rehearsal\tooling\prod-respond.ps1`
- Create: `C:\Users\danie\kb-rehearsal\tooling\prod-sign-approval.ps1`

**Interfaces:**
- Consumes: `_drain-common.ps1`'s `Invoke-Curl` (read `C:\Users\danie\kb-rehearsal\tooling\drain-v2\_drain-common.ps1` first).
- Produces: the two command shapes T7's hook admits, character for character.

- [ ] **Step 1: Read the two models**

Read `C:\Users\danie\kb-rehearsal\tooling\prod-run-workflow.ps1` (open-class conventions: param block, `$ErrorActionPreference = 'Stop'`, the dot-source, `Fail`/`Step`, the belt-and-braces window check for prod) and `drain-v2\_drain-common.ps1` (`Invoke-Curl`'s signature). Copy the conventions; invent nothing.

- [ ] **Step 2: Write `prod-respond.ps1`**

```powershell
# prod-respond.ps1 - resolve ONE human request (completion gate or intervention) on prod.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File prod-respond.ps1 `
#     -Run run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5 -Request <requestRef> `
#     -Decision approve -Reason "sources added, brief is correct"
#
# OPEN CLASS: no prod window needed (scripts/hooks/prod_window_guard.js rule A4o). The daemon
# enforces the real rule: a publish- or spend-tagged workflow refuses this route without an
# ssh-signed approval (403 approval-required) - use prod-sign-approval.ps1 for those.
#
# -Reason is REQUIRED and is recorded on the resolved request as resolvedBy.reason.
# It NEVER retries a 409: a revision change means re-read, not re-send.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Run,
  [Parameter(Mandatory = $true)][string]$Request,
  [Parameter(Mandatory = $true)][ValidateSet('approve','retry','abandon')][string]$Decision,
  [Parameter(Mandatory = $true)][string]$Reason,
  [string]$Actor = 'boss',
  [string]$URL = 'https://kb.tail82dd4f.ts.net',
  [string[]]$CurlHeader = @()
)
$ErrorActionPreference = 'Stop'
. (Join-Path 'C:\Users\danie\kb-rehearsal\tooling\drain-v2' '_drain-common.ps1')
function Fail($m) { Write-Host ''; Write-Host "ABORT: $m" -ForegroundColor Red; exit 1 }
function Step($n, $m) { Write-Host ''; Write-Host "[$n] $m" -ForegroundColor Cyan }

if ($Reason.Trim().Length -lt 1 -or $Reason.Length -gt 2000) { Fail '-Reason must be 1..2000 characters' }
if ($Actor -notmatch '^(daniel|boss|worker:[a-z0-9][a-z0-9._-]{0,63})$') { Fail "-Actor '$Actor' is not a valid X-KB-Actor value" }
$decisionWire = @{ approve = 'approved'; retry = 'changes-requested'; abandon = 'rejected' }[$Decision]

Step 'A' "reading $Run for the current revision of $Request"
$detailRaw = Invoke-Curl $CurlHeader @('-s','--max-time','30',"$URL/api/control/runs/$Run")
if ($LASTEXITCODE -ne 0) { Fail "could not reach $URL - is the tailnet up?" }
try { $detail = $detailRaw | ConvertFrom-Json } catch { Fail "run detail was not JSON: $detailRaw" }
if (-not $detail.run -and $detail.value) { $detail = $detail.value }
$req = @($detail.humanRequests | Where-Object { $_.requestRef -eq $Request })[0]
if (-not $req) { Fail "run $Run has no human request $Request" }
if ($req.state -ne 'open') { Fail "request $Request is '$($req.state)', not open - nothing to resolve" }
Write-Host "kind=$($req.kind) gateKind=$($req.gateKind) revision=$($req.revision)"

Step 'B' "responding $decisionWire as $Actor"
$body = @{ expectedRevision = $req.revision; decision = $decisionWire
           idempotencyKey = [guid]::NewGuid().ToString(); reason = $Reason } | ConvertTo-Json -Compress
$tmp = [IO.Path]::GetTempFileName()
[IO.File]::WriteAllText($tmp, $body)
try {
  $raw = Invoke-Curl $CurlHeader @('-s','-w',"`nHTTP %{http_code}",'-X','POST','--max-time','60',
    '-H','content-type: application/json','-H',"x-kb-actor: $Actor",
    '--data-binary',"@$tmp","$URL/api/control/human-requests/$Request/respond")
} finally { Remove-Item -Force -ErrorAction SilentlyContinue $tmp }
$text = ($raw -join "`n")
Write-Host $text
if ($text -match 'HTTP 409') { Fail 'the request revision changed under us. Re-run this script; do NOT retry blindly.' }
if ($text -match 'HTTP 403' -and $text -match 'approval-required') {
  Fail 'this run''s workflow is publish/spend-tagged. Sign an approval with prod-sign-approval.ps1 and resend with it in the body.'
}
if ($text -notmatch 'HTTP 200') { Fail 'respond did not return 200 - read the body above' }

Step 'C' 'run state after the response'
$after = Invoke-Curl $CurlHeader @('-s','--max-time','30',"$URL/api/control/runs/$Run")
try {
  $a = $after | ConvertFrom-Json; if (-not $a.run -and $a.value) { $a = $a.value }
  Write-Host ("state={0}  terminalOutcome={1}  openGates={2}" -f $a.run.state, $a.run.terminalOutcome,
    @($a.humanRequests | Where-Object { $_.state -eq 'open' }).Count)
} catch { Write-Host 'could not re-read the run' -ForegroundColor Yellow }
Write-Host ''
Write-Host 'DONE.' -ForegroundColor Green
```

- [ ] **Step 3: Write `prod-sign-approval.ps1`**

Same conventions. It must:
- Validate `-Route` against `^(POST|PUT|DELETE|PATCH) /api/[A-Za-z0-9/:_-]{1,120}$` and `-Entity` against `^[A-Za-z0-9._:-]{1,120}$`; `-TtlMinutes` 1..15, default 10.
- Build `$nonce = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Max 16) })`.
- Build the canonical payload with **exactly** this key order and no whitespace:
  `{"schema":"kb.human-approval/v1","route":"<Route>","entityRef":"<Entity>","actor":"daniel","issuedAt":"<iso>","expiresAt":"<iso>","nonce":"<nonce>"}`
  Build it by **string concatenation**, not `ConvertTo-Json` — PowerShell does not guarantee key order and the server verifies the bytes.
- Timestamps: `(Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')`.
- Write the payload to a temp file with `[IO.File]::WriteAllText($tmp, $payload, (New-Object Text.UTF8Encoding $false))` — **no BOM**.
- Run `ssh-keygen -Y sign -f $SigningKey -n kb-human-approval $tmp` (default `-SigningKey C:\Users\danie\.ssh\kb-ops-approver`), read `$tmp.sig`, print
  `@{ approval = @{ payload = $payload; signature = $sig } } | ConvertTo-Json -Compress -Depth 5`.
- Delete both temp files in `finally`. Never print the key path's contents. Print a one-line reminder that the approval expires at `<expiresAt>` and is single-use.

- [ ] **Step 4: Verify both against the hook and by a dry run**

```bash
# hook shapes (expect exit 0 for respond with the window closed, 2 for sign)
cd C:/Users/danie/kb-worktrees/authority
echo '{"tool_name":"Bash","tool_input":{"command":"powershell -NoProfile -ExecutionPolicy Bypass -File C:\\Users\\danie\\kb-rehearsal\\tooling\\prod-respond.ps1 -Run run-1 -Request req-1 -Decision approve -Reason \"ok\""}}' | node scripts/hooks/prod_window_guard.js; echo "exit=$?"
```
Expected: `exit=0`.

```powershell
# payload shape only; no network, no prod. Uses a throwaway key.
ssh-keygen -t ed25519 -N '""' -f $env:TEMP\kb-throwaway
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\danie\kb-rehearsal\tooling\prod-sign-approval.ps1 -Route "POST /api/schedules/:id" -Entity sched-7 -SigningKey $env:TEMP\kb-throwaway
```
Expected: one line of compact JSON whose `payload` begins `{"schema":"kb.human-approval/v1","route":"POST /api/schedules/:id","entityRef":"sched-7","actor":"daniel",` and whose `signature` begins `-----BEGIN SSH SIGNATURE-----`. Delete the throwaway key afterwards.

- [ ] **Step 5: Report (no commit)**

These files live outside the repo. Do not `git add` them. Report both absolute paths and paste the verification output above.

---

### Task 9: Rehearsal proof

**Depends on:** T1–T8 all landed on the branch.

**Files:**
- Create: `C:\Users\danie\kb-rehearsal\tooling\rehearsal\p11\authority-proof.sh` (tooling, not the repo)

**Interfaces:**
- Consumes: everything. Produces: a transcript the T10 reviewer and Daniel read.

- [ ] **Step 1: Bring the rehearsal host up on the branch**

```bash
wsl -d kb-rehearsal -- bash -lc '/mnt/c/Users/danie/kb-rehearsal/tooling/rehearsal/rehearsal-build.sh claude/authority-guardrails'
wsl -d kb-rehearsal -- bash -lc '/mnt/c/Users/danie/kb-rehearsal/tooling/rehearsal/p6/e1-vitest.sh && /mnt/c/Users/danie/kb-rehearsal/tooling/rehearsal/p6/e1-pytest.sh'
```
Expected: both suites green. If `rehearsal-build.sh` takes no branch argument, read it and use whatever it does take.

- [ ] **Step 2: Install a throwaway allowed signer**

```bash
wsl -d kb-rehearsal -- bash -lc '
  set -e
  ssh-keygen -t ed25519 -N "" -C kb-rehearsal-throwaway -f /tmp/kb-throwaway
  sudo install -o root -g root -m 0644 /dev/null /usr/local/lib/kb/kb-ops-approver.allowed-signers
  printf "kb-ops-approver %s\n" "$(cat /tmp/kb-throwaway.pub)" | sudo tee /usr/local/lib/kb/kb-ops-approver.allowed-signers >/dev/null
  sudo systemctl restart kb-dashboard && sleep 3 && curl -s localhost:4317/readyz'
```
Expected: `readyz` reports ok. A boot refusal here means the env is not set on the rehearsal unit — set `DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS` and restart.

- [ ] **Step 3: Prove the open respond route (real model)**

```bash
wsl -d kb-rehearsal -- bash -lc '/mnt/c/Users/danie/kb-rehearsal/tooling/rehearsal/p4/real-claude/to-real.sh'
```
Launch `v1-acceptance-demo` against `http://127.0.0.1:4317`, let it park at its completion gate, then:
```bash
curl -s -X POST -H 'content-type: application/json' -H 'x-kb-actor: boss' \
  -d '{"expectedRevision":1,"decision":"approved","idempotencyKey":"'"$(uuidgen)"'","reason":"rehearsal proof: sources present"}' \
  http://127.0.0.1:4317/api/control/human-requests/$REQ/respond
```
Expected: `200`, then the run reaches `succeeded`, and
`curl -s http://127.0.0.1:4317/api/control/runs/$RUN | jq '.value.humanRequests[0].response.resolvedBy'`
shows `{ "actor": "boss", "tailnetIdentity": ..., "at": ..., "reason": "rehearsal proof: sources present" }`.
Also assert the audit ledger's newest row carries `"actor":"boss"`.

- [ ] **Step 4: Prove the signed class**

```bash
# no approval
curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' -d '{}' \
  http://127.0.0.1:4317/api/control/runs/$RUN/reconcile-publication
```
Expected: `403` with `approval-required`.

Then build a payload with the throwaway key (the same canonical form `prod-sign-approval.ps1` emits), POST it. Expected: `200`.
Replay the identical body. Expected: `409 approval-replayed`.
Sign the same payload with `-n kb-ops-instructions` instead. Expected: `403 approval-invalid`.
Sign a payload whose `entityRef` names a different run. Expected: `403 approval-invalid`.
Wait past `expiresAt` and resend a fresh-nonce payload. Expected: `403 approval-expired`.

- [ ] **Step 5: Prove the spend ceiling and its override**

```bash
wsl -d kb-rehearsal -- bash -lc '
  sudo systemctl set-environment KB_EXECUTION_BUDGET_MAX_COST_USD_MICROS=200000
  sudo systemctl restart kb-dashboard'
```
Launch the demo again and let it park on the budget intervention (title matches `budget`).
Expected: unsigned `POST /api/control/budget/override` ⇒ `403 approval-required`; signed ⇒ `200` with `resultingCeilingUsdMicros`; resolving the parked intervention through the open respond route then lets the run complete.

- [ ] **Step 6: Restore the host**

```bash
wsl -d kb-rehearsal -- bash -lc '
  /mnt/c/Users/danie/kb-rehearsal/tooling/rehearsal/p4/real-claude/to-stub.sh
  sudo systemctl unset-environment KB_EXECUTION_BUDGET_MAX_COST_USD_MICROS
  rm -f /tmp/kb-throwaway /tmp/kb-throwaway.pub
  sudo systemctl restart kb-dashboard'
```
The throwaway public key stays installed (the rehearsal host is disposable); Daniel's real key was never on it.

- [ ] **Step 7: Save the transcript and report**

Write the whole session to
`C:\Users\danie\kb-rehearsal\tooling\rehearsal\p11\authority-proof.log` and report every
expected/actual pair. Any mismatch stops the plan here — do not proceed to T10.

---

### Task 10: Adversarial review and the PR

**Depends on:** T9 green.

**Files:**
- Create: `C:\Users\danie\AppData\Local\Temp\claude\authority\risk-tiers-d213.diff` (scratch; the proposed governance edit, for Daniel — **never** applied by a worker)

- [ ] **Step 1: Run the full suite one more time**

```bash
cd C:/Users/danie/kb-worktrees/authority/dashboard && npm test && npm run typecheck
cd C:/Users/danie/kb-worktrees/authority && python -m pytest tests -q && node --test tests/hooks/prod_window_guard.test.js
```
Expected: all green. Record the test counts; they go in the PR body.

- [ ] **Step 2: Dispatch the opus security review**

One `opus` subagent, read-only, briefed with: the spec, `git diff origin/main...HEAD`, and this scope —
1. `authority/sshsig.ts`: can any input reach a shell? Can a crafted `signature` escape the temp file? Is the anchored stdout token forgeable through a crafted principal or namespace? Does an empty-stderr requirement ever reject a legitimate verification?
2. `authority/approval.ts`: is the check order actually fail-closed? Can the nonce be burned by an unsigned request? Is `route`/`entityRef` binding derivable only server-side?
3. `authority/nonceStore.ts`: does the cap fail closed? Can two concurrent claims both succeed?
4. `authority/policy.ts` + `gate.ts`: can a mutating route reach a handler without passing the gate? What about routes registered outside the `authenticated` scope (`registerPaidActionRoute`, the node scope, `/api/pty`)?
5. `X-KB-Actor`: find any path where its value changes an authorization outcome.
6. The WebAuthn deletion: name anything that still depends on something deleted — especially `approvals/cardVerifier.ts`, `approvals/assurance.ts`, `broker/verbs.ts`, and the `governance/card-schema.md` / `schemas/cards/v1.schema.json` `ceremony` field.

Fold every finding. Re-run the suites after each fix.

- [ ] **Step 3: Write the proposed governance diff to scratch**

`governance/risk-tiers.md:35-40` currently names the WebAuthn channel as the only T3 channel. Write a proposed replacement to the scratch path above — do **not** edit `governance/`. Suggested text:

```
- **T3 (merge to main, external publishing, deploys, deletes, spend-ceiling changes) →
  the ssh-signed human-approval channel ONLY** (`ssh-keygen -Y sign -n kb-human-approval`,
  principal `kb-ops-approver`, verified server-side against the daemon's allowed-signers
  file). The weak/unsigned transport (e.g. Telegram) MUST NOT authorize a T3 action, and
  neither may a CLI on its own.
```

- [ ] **Step 4: Push and open the PR**

```bash
cd C:/Users/danie/kb-worktrees/authority
git push -u origin claude/authority-guardrails
gh pr create --base main --head claude/authority-guardrails \
  --title "Authority and guardrails: CLI-operable daemon, ssh-signed never-for-a-CLI list, WebAuthn removed" \
  --body-file <(cat <<'BODY'
Implements docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md.

## What changed
- One policy table classifies every mutating route `open` | `signed` | `none`, enforced by a single preHandler on the governed scope.
- WebAuthn and passkeys are removed end to end (server, browser, Python verifier, deploy validator, systemd drop-in trust path, two npm deps).
- Signed class verifies an SSHSIG approval (`-n kb-human-approval`, principal `kb-ops-approver`) with 15-minute expiry and durable nonce replay refusal.
- `X-KB-Actor` is recorded on every audit row and on `resolvedBy`; it never widens authority (asserted by test).
- Workflow definitions gain a derived `tags` set; `publish`/`spend` workflows escalate gate resolution to the signed channel.
- The daily spend ceiling is the CLI ceiling; only a signed override raises it, and only its cost field.
- The session hook splits prod scripts into open and windowed classes.

## Evidence
- Rehearsal proof: `C:\Users\danie\kb-rehearsal\tooling\rehearsal\p11\authority-proof.log`
- Opus security review folded (see commits).

## Owed to Daniel after merge
`governance/risk-tiers.md` D2.13 still names the WebAuthn channel. Proposed diff is in the review report; `governance/` is human-edited only.
BODY
)
```

Expected: a PR URL. Report it.

---

### Task 11: Deploy and prod proof

**Depends on:** T10's PR merged by Daniel. **Boss-run, not a worker.**

- [ ] **Step 1: Repoint the hook's pins and open the window**

Update `DEPLOY_SHA` and `BROKER_DIGEST` in `scripts/hooks/prod_window_guard.js` to the merged release's values, then:
`powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\danie\kb-rehearsal\tooling\prod-window.ps1 -Open -Step authority-deploy`

- [ ] **Step 2: Preflight, deploy, drop the stale drop-in**

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\danie\kb-rehearsal\tooling\vm-preflight-prod.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\danie\kb-rehearsal\tooling\kb-deploy.ps1 -SigningKey <key> -Sha <sha> -BrokerDigest <digest>
```
The new validator refuses **any** drop-in, so `/etc/systemd/system/kb-dashboard.service.d/passkey.conf` must be removed and the unit given `DASHBOARD_HUMAN_APPROVER_ALLOWED_SIGNERS` plus the allowed-signers file before the restart succeeds. Expect an `ExecStartPre` failure if either is missed — that is the guard working.
Expected: `systemctl is-active kb-dashboard` ⇒ `active`; `readlink /opt/kb-releases/current` ⇒ the new sha.

- [ ] **Step 3: Close the window**

`... prod-window.ps1 -Close`

- [ ] **Step 4: The prod proof, open class, window closed**

```
powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\danie\kb-rehearsal\tooling\prod-respond.ps1 `
  -Run run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5 -Request <requestRef> `
  -Decision approve -Reason "v1 acceptance: sources added, brief is correct"
```
Expected: `HTTP 200`; the run reaches `succeeded`.

Then the digest check:
```
curl -s -o NUL -w "%{http_code}\n" "https://kb.tail82dd4f.ts.net/api/control/files?path=<brief.json path>&sha256=<digest>&entityType=run&entityId=run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5"
curl -s -o NUL -w "%{http_code}\n" "https://kb.tail82dd4f.ts.net/api/control/files?path=<brief.json path>&sha256=<digest with one hex digit changed>&entityType=run&entityId=run-cc508ddb-98c5-4c65-a0a6-4e6c09650ea5"
```
Expected: `200` then `404`.

- [ ] **Step 5: Record the evidence**

Append the run state, the two HTTP codes, and the newest audit row's `actor` + `resolvedBy` to
`handoffs/2026-09-16-authority-guardrails-deploy.md` on `ops` (commit on a temp branch cut from
`origin/ops`, then `git push origin <sha>:ops` — never check out `ops` in the main checkout).

---

## Self-review

**1. Spec coverage.** §4.1 route classes → T1 (+T3 for the gate). §4.1 deletions → T2.
§4.2 signed channel → T3. §4.3 actor + `resolvedBy` → T4. §4.4 tags → T5. §4.5 boss rules
→ T5 (rule) + T4 (`reason`). §4.6 spend → T6. §4.7 hook → T7. §4.8 desktop scripts → T8.
§6 testing → every task's test-first steps plus T9 (rehearsal). §7 rollout → T10 (PR) + T11
(deploy + prod proof). §8 follow-ups carry their own cards and are not tasks here. §9 open
question 1 is T10 step 3; open questions 2 and 3 are deliberately not implemented.

**2. Placeholder scan.** Every code step carries real code or a named file to read first
(`_drain-common.ps1`, `surface.test.ts`'s app builder, `atomicRename.ts`'s export, the
pytest file's own helper names) rather than an invented API. The two places that say "read
it and match it" are places where guessing a name would be worse than looking.

**3. Type consistency.** `classifyRoute`/`routeKey`/`ROUTE_AUTHORITY`/`FORBIDDEN_ROUTE_PREFIXES`
are spelled identically in T1, T3 and T5. `verifyApproval` has one signature, used by T3's
gate and T5's service port. `effectiveWorkflowTags` is spelled identically in T5's test,
implementation and wiring. `windowBudgetFor` is spelled identically in T6's three sites.
`NonceStore.claim` returns the same three-value union in T3's test, T3's implementation and
T3's `approval.ts` caller. `Actor` and `parseActor` are defined once in T4 and imported by
T4's wiring and T5's tests. `resolvedBy`'s four fields are identical in T4's test, T4's
types change and T9's assertion.

**4. Right-sizing.** Each task ends with an independently testable deliverable and one
commit. T2 is the longest (a ten-file deletion) and is deliberately front-loaded in wave A
so it has the whole wave to run; if its worker exceeds an hour, the natural split is
steps 1–4 (TypeScript) and steps 5–6 (Python) as two commits by two workers, in that order.

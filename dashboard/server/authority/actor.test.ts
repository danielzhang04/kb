import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseActor } from './actor.ts';
import { buildApp } from '../index.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { mintSession, type SessionConfig } from '../auth/session.ts';

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

// --- Authority-invariance: the header is a record, never an authority input --------------------------
//
// HIGH-2 (adversarial security review, 2026-09-16). The predecessor of this block injected four actor
// headers at two routes with NO `authorization` header and asserted the statuses were all equal. Every
// one of those six requests answered 401: `requireSession` replies before `requireAuthority` or any
// handler runs, so the assertion held for EVERY possible implementation of the actor rule -- including
// the broken one (HIGH-1), where omitting the header removed the `reason` requirement outright. Spec
// 4.3 called that test "the proof"; it proved nothing.
//
// What replaces it authenticates first, so the requests actually reach the layer under test, and it
// covers the route the old test never touched -- the RESPOND route, which is where the deviation lived.

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));
const TEST_SESSION_CONFIG: SessionConfig = { secret: Buffer.from('authority-actor-test-secret-0001'), ttlMs: 60_000 };
const TEST_ORIGINS = ['http://localhost'];
/** Every shape `parseActor` maps to a distinct `Actor`, plus no header at all (which is `unknown`). */
const ACTOR_HEADERS: ReadonlyArray<Record<string, string>> = [
  { 'x-kb-actor': 'daniel' }, { 'x-kb-actor': 'boss' }, { 'x-kb-actor': 'worker:x' },
  { 'x-kb-actor': 'DANIEL' }, {},
];

/**
 * The real, fully-composed daemon plus a minted operator session, so the injects below get PAST
 * `requireSession` and actually exercise the gate, the escalation, and the handlers.
 *
 * ONE app per test, not one per assertion (composing `buildApp` for each of the ~10 injects a single
 * test makes is what pushes this file past its time budget under load) and not one for the whole file
 * (the write-surface rate guard is per app, and the cumulative injects trip its 429). No request here
 * mutates anything: every entity ref below is deliberately nonexistent.
 */
let app: FastifyInstance;
let token: string;
beforeEach(async () => {
  app = buildApp({
    repoRoot: REPO_A,
    sessionConfig: TEST_SESSION_CONFIG,
    allowedOrigins: TEST_ORIGINS,
    validateData: false,
    controlStore: createInMemoryControlPlaneStore(),
    appendAudit: (_root, event) => ({ ts: '2026-09-16T00:00:00.000Z', ...event } as never),
    // Never touch the real on-disk nonce ledger from a test (see INFO-1): a signed route reached here
    // refuses long before the nonce would be claimed, but the store is constructed eagerly.
    approvalNonces: { claim: () => 'fresh' as const },
  });
  await app.ready();
  token = mintSession('operator', TEST_SESSION_CONFIG).token;
}, 30_000);
afterEach(async () => { await app?.close(); });

async function statusesFor(url: string, payload: Record<string, unknown>): Promise<number[]> {
  const results: number[] = [];
  for (const actorHeader of ACTOR_HEADERS) {
    const res = await app.inject({
      method: 'POST',
      url,
      headers: { origin: TEST_ORIGINS[0], authorization: `Bearer ${token}`, ...actorHeader },
      payload,
    });
    results.push(res.statusCode);
  }
  return results;
}

describe('the X-KB-Actor header never changes what a request is allowed to do', () => {
  it('is authenticated first, so the requests actually reach the gate (the old test measured 401s)', async () => {
    const unauthenticated = await app.inject({
      method: 'POST', url: '/api/control/runs/run-x/archive',
      headers: { origin: TEST_ORIGINS[0], 'x-kb-actor': 'daniel' }, payload: {},
    });
    expect(unauthenticated.statusCode).toBe(401);
    // ...and with a session, the same route gets somewhere else entirely.
    expect(await statusesFor('/api/control/runs/run-x/archive', {})).not.toContain(401);
  }, 30_000);

  it('gives every actor header the same status on an OPEN route and on a SIGNED one', async () => {
    for (const path of [
      '/api/control/runs/run-x/archive',               // open (policy.ts)
      '/api/control/runs/run-x/reconcile-publication', // signed (policy.ts)
      '/api/schedules/schedule-x/arm',                 // open, sibling scope (index.ts install point)
    ]) {
      const statuses = await statusesFor(path, {});
      expect(new Set(statuses).size, `${path} -> ${statuses.join(',')}`).toBe(1);
    }
  }, 30_000);

  it('gives every actor header the same status on the RESPOND route, with and without a reason', async () => {
    // THE ROUTE THE OLD TEST NEVER TOUCHED, and the one HIGH-1 lived on. With no `reason`, every actor
    // -- daniel and the header-less request included -- must now be refused `400 reason-required`;
    // before the fix, `daniel`/`unknown`/absent sailed past the wall and got `404 not-found` instead.
    const base = { expectedRevision: 1, decision: 'approved', idempotencyKey: 'actor-invariance' };
    const withoutReason = await statusesFor('/api/control/human-requests/hr-does-not-exist/respond', base);
    expect(new Set(withoutReason).size, withoutReason.join(',')).toBe(1);
    expect(withoutReason[0]).toBe(400);

    // With a reason, they are all equal again -- and past the wall, at the handler's own answer.
    const withReason = await statusesFor(
      '/api/control/human-requests/hr-does-not-exist/respond', { ...base, reason: 'looks correct' },
    );
    expect(new Set(withReason).size, withReason.join(',')).toBe(1);
    expect(withReason[0]).not.toBe(400);
  }, 30_000);

  it('gives every actor header the same status on the SIGNED escalation, with and without an approval', async () => {
    // A `signed`-class route reached with no approval: the refusal must be identical for every actor,
    // and identical again when an (unverifiable) approval IS attached.
    const noApproval = await statusesFor('/api/control/runs/run-x/reconcile-publication', {});
    expect(new Set(noApproval).size, noApproval.join(',')).toBe(1);
    const withApproval = await statusesFor('/api/control/runs/run-x/reconcile-publication', {
      approval: { payload: '{}', signature: 'sig' },
    });
    expect(new Set(withApproval).size, withApproval.join(',')).toBe(1);
  }, 30_000);
});

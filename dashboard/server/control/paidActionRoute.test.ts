import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { originPlugin } from '../security/origin.ts';
import { makeDefaultWriteRateGuard, writeRateLimitHook } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import { registerPaidActionRoute, PAID_ACTION_ROUTE_PATH } from './paidActionRoute.ts';
import { PaidActionError, type PaidActionRequest, type PaidActionResult } from './paidActionService.ts';
import type { SpendGrant } from './spendGrant.ts';

const ORIGIN = 'http://localhost:5317';
const VALID_TOKEN = 'valid-grant-token';
const ARTIFACT = 'orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/s1.png';
const OUTPUT = { artifactPath: ARTIFACT, mediaType: 'image/png' as const, byteLength: 4096, sha256: 'a'.repeat(64) };

function grant(overrides: Partial<SpendGrant> = {}): SpendGrant {
  return {
    grantRef: 'grant-11111111111111111111111111111111',
    runRef: 'run-grant',
    stageRef: 'stage-images',
    operation: 'fyt.gemini-3-pro-image-2k',
    maxCalls: 11, maxCostUsdMicros: 1_400_000, maxCharacters: 0, maxOutputs: 8,
    tokenHash: 'b'.repeat(64),
    subject: 'operator',
    gateRequestRef: 'request-spend',
    mintedAt: '2026-08-03T12:00:00.000Z',
    expiresAt: '2026-08-03T14:00:00.000Z',
    ...overrides,
  };
}

interface Harness {
  ctx: SurfaceContext;
  executeCalls: PaidActionRequest[];
  auditRows: Array<Record<string, unknown>>;
}

function makeHarness(overrides: {
  resolve?: (token: string) => SpendGrant | null;
  execute?: (input: PaidActionRequest) => Promise<PaidActionResult>;
  snapshot?: () => ReadonlyArray<{ runRef: string; stageRef: string; attemptRef: string; operation: string; callOrdinal: number }>;
  currentAttemptRef?: string | null;
  appendAuditThrows?: boolean;
  omitPaidExecution?: boolean;
} = {}): Harness {
  const executeCalls: PaidActionRequest[] = [];
  const auditRows: Array<Record<string, unknown>> = [];
  const paidActionService = overrides.omitPaidExecution ? undefined : {
    execute: async (input: PaidActionRequest) => {
      executeCalls.push(input);
      return overrides.execute
        ? overrides.execute(input)
        : ({ status: 'succeeded', actionRef: 'paid-abc', output: OUTPUT } as PaidActionResult);
    },
    snapshot: overrides.snapshot ?? (() => []),
  };
  const spendGrantStore = overrides.omitPaidExecution ? undefined : {
    resolve: overrides.resolve ?? ((token: string) => (token === VALID_TOKEN ? grant() : null)),
  };
  const ctx = {
    repoRoot: 'C:/repo',
    controlStore: {
      getRun: (_subject: string, _runRef: string) => ({
        ok: true,
        value: { stages: [{ stageRef: 'stage-images', currentAttemptRef: overrides.currentAttemptRef === undefined ? 'attempt-7' : overrides.currentAttemptRef }] },
      }),
    },
    appendAudit: overrides.appendAuditThrows
      ? () => { throw new Error('audit failed'); }
      : (_repoRoot: string, event: Record<string, unknown>) => { auditRows.push(event); return { ts: 'now', ...event }; },
    now: () => new Date('2026-08-03T13:00:00.000Z'),
    paidActionService,
    spendGrantStore,
  } as unknown as SurfaceContext;
  return { ctx, executeCalls, auditRows };
}

describe('POST /api/control/paid-action', () => {
  let app: ReturnType<typeof Fastify>;

  function mount(ctx: SurfaceContext): void {
    app = Fastify();
    app.register(async (scope) => {
      originPlugin(scope, { allowedOrigins: [ORIGIN] });
      scope.addHook('onRequest', writeRateLimitHook(makeDefaultWriteRateGuard()));
      registerPaidActionRoute(scope, ctx);
    });
  }

  function headers(token?: string): Record<string, string> {
    const base: Record<string, string> = { origin: ORIGIN, host: 'localhost:5317', 'content-type': 'application/json' };
    if (token) base.authorization = `Bearer ${token}`;
    return base;
  }

  const imageBody = { operation: 'fyt.gemini-3-pro-image-2k', prompt: 'a brick', seeds: [{ pngBase64: 'AAAA', sha256: 'c'.repeat(64) }], expectedArtifactPath: ARTIFACT };

  afterEach(async () => { if (app) await app.close(); });

  it('draws down on a valid token and returns committed metadata (never bytes), with server-derived identity', async () => {
    const h = makeHarness();
    mount(h.ctx);
    const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: imageBody });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'succeeded', actionRef: 'paid-abc', output: OUTPUT });
    expect(JSON.stringify(res.json())).not.toMatch(/bytes|pngBase64/);
    // Identity is the grant's + execution/journal-derived — never from the body.
    expect(h.executeCalls).toHaveLength(1);
    expect(h.executeCalls[0]).toMatchObject({
      runRef: 'run-grant', stageRef: 'stage-images', attemptRef: 'attempt-7', callOrdinal: 1,
      operation: 'fyt.gemini-3-pro-image-2k', stageId: 'images', prompt: 'a brick', expectedArtifactPath: ARTIFACT,
    });
    // Audit-before-mutate recorded exactly one governance row.
    expect(h.auditRows).toHaveLength(1);
    expect(h.auditRows[0]).toMatchObject({ action: 'control-paid-action-execute', owner: 'operator', target: 'run-grant' });
  });

  it('rejects a missing bearer token with 401 before touching the service', async () => {
    const h = makeHarness();
    mount(h.ctx);
    const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(), payload: imageBody });
    expect(res.statusCode).toBe(401);
    expect(h.executeCalls).toHaveLength(0);
  });

  it('rejects an expired/forged token (resolve => null) with 401', async () => {
    const h = makeHarness({ resolve: () => null });
    mount(h.ctx);
    const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers('forged'), payload: imageBody });
    expect(res.statusCode).toBe(401);
    expect(h.executeCalls).toHaveLength(0);
  });

  it('uses the GRANT run/stage even though the body cannot name one, and refuses injected identity keys', async () => {
    const h = makeHarness();
    mount(h.ctx);
    // A body carrying identity keys is rejected outright by exact-key validation (stronger than "ignored").
    const spoof = { ...imageBody, runRef: 'run-victim', stageRef: 'stage-victim', callOrdinal: 99, attemptRef: 'attempt-x' };
    const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: spoof });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid-body');
    expect(h.executeCalls).toHaveLength(0);
  });

  it('refuses an operation that does not match the grant', async () => {
    const h = makeHarness();
    mount(h.ctx);
    const res = await app.inject({
      method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN),
      payload: { operation: 'fyt.elevenlabs.locked-tts', text: 'hi', expectedArtifactPath: ARTIFACT.replace('.png', '.mp3') },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('operation-mismatch');
    expect(h.executeCalls).toHaveLength(0);
  });

  it('derives the next call ordinal server-side from the paid-action journal', async () => {
    const prior = [
      { runRef: 'run-grant', stageRef: 'stage-images', attemptRef: 'attempt-7', operation: 'fyt.gemini-3-pro-image-2k', callOrdinal: 1 },
      { runRef: 'run-grant', stageRef: 'stage-images', attemptRef: 'attempt-7', operation: 'fyt.gemini-3-pro-image-2k', callOrdinal: 2 },
      // A different attempt / operation must NOT count toward this tuple's ordinal.
      { runRef: 'run-grant', stageRef: 'stage-images', attemptRef: 'attempt-6', operation: 'fyt.gemini-3-pro-image-2k', callOrdinal: 1 },
    ];
    const h = makeHarness({ snapshot: () => prior });
    mount(h.ctx);
    const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: imageBody });
    expect(res.statusCode).toBe(200);
    expect(h.executeCalls[0].callOrdinal).toBe(3);
  });

  it('returns 409 when the run has no active attempt for the grant stage', async () => {
    const h = makeHarness({ currentAttemptRef: null });
    mount(h.ctx);
    const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: imageBody });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ error: 'no-active-attempt', retryable: true });
    expect(h.executeCalls).toHaveLength(0);
  });

  it('maps cap/ceiling exhaustion to 409', async () => {
    const h = makeHarness({ execute: async () => { throw new PaidActionError('cap-exhausted', 'exhausted'); } });
    mount(h.ctx);
    const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: imageBody });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('cap-exhausted');
  });

  it('maps retryable service codes to 503', async () => {
    for (const code of ['journal-unavailable', 'artifact-verification-unavailable'] as const) {
      const h = makeHarness({ execute: async () => { throw new PaidActionError(code, 'transient'); } });
      mount(h.ctx);
      const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: imageBody });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toMatchObject({ error: code, retryable: true });
      await app.close();
    }
  });

  it('surfaces a terminal failed result as a stable 200 status the worker can act on', async () => {
    const h = makeHarness({ execute: async () => ({ status: 'failed', actionRef: 'paid-f', reason: 'credential-unavailable' }) });
    mount(h.ctx);
    const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: imageBody });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'failed', actionRef: 'paid-f', reason: 'credential-unavailable' });
  });

  it('refuses the spend when the audit hook fails, before any draw-down', async () => {
    const h = makeHarness({ appendAuditThrows: true });
    mount(h.ctx);
    const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: imageBody });
    expect(res.statusCode).toBe(500);
    expect(res.json().error).toBe('paid-action-audit-required');
    expect(h.executeCalls).toHaveLength(0);
  });

  it('fails closed with 503 when execution is not activated (service unbound)', async () => {
    const h = makeHarness({ omitPaidExecution: true });
    mount(h.ctx);
    const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: imageBody });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'paid-action-unavailable', retryable: true });
  });

  // PRODUCTION SHAPE: ctx.appendAudit is OMITTED (exactly as index.ts wires it), so `auditFn(ctx)` resolves
  // to the real git-committing appender. A temp repo checked out on `ops` lets the appender's branch guard
  // pass and reach the INJECTED ctx.opsGit, so no real git runs. This proves audit-before-mutate holds in
  // the shape production actually uses — the finding was that the old `if (ctx.appendAudit)` guard skipped
  // the row entirely in prod and spent silently.
  describe('production shape (no injected appendAudit → real git-committing appender)', () => {
    let repoRoot: string;

    beforeEach(() => {
      repoRoot = mkdtempSync(join(tmpdir(), 'paid-audit-'));
      execFileSync('git', ['init', '-q', repoRoot]);
      // Point HEAD at ops with no commits — the appender's read-only `git symbolic-ref --short HEAD` guard
      // resolves 'ops' and proceeds to the injected runGit.
      execFileSync('git', ['-C', repoRoot, 'symbolic-ref', 'HEAD', 'refs/heads/ops']);
    });

    afterEach(() => rmSync(repoRoot, { recursive: true, force: true }));

    function prodCtx(opsGit: SurfaceContext['opsGit']): { ctx: SurfaceContext; executeCalls: PaidActionRequest[] } {
      const executeCalls: PaidActionRequest[] = [];
      const ctx = {
        repoRoot,
        controlStore: {
          getRun: () => ({ ok: true, value: { stages: [{ stageRef: 'stage-images', currentAttemptRef: 'attempt-7' }] } }),
        },
        // appendAudit intentionally omitted — this is the production wiring.
        opsGit,
        now: () => new Date('2026-08-03T13:00:00.000Z'),
        paidActionService: {
          execute: async (input: PaidActionRequest) => {
            executeCalls.push(input);
            return { status: 'succeeded', actionRef: 'paid-abc', output: OUTPUT } as PaidActionResult;
          },
          snapshot: () => [],
        },
        spendGrantStore: { resolve: (token: string) => (token === VALID_TOKEN ? grant() : null) },
      } as unknown as SurfaceContext;
      return { ctx, executeCalls };
    }

    it('records the governance row via the real appender, THEN draws down (audit-before-mutate)', async () => {
      const gitCalls: string[][] = [];
      const opsGit = ((_repo: string, args: string[]) => { gitCalls.push(args); return ''; }) as SurfaceContext['opsGit'];
      const { ctx, executeCalls } = prodCtx(opsGit);
      mount(ctx);
      const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: imageBody });
      expect(res.statusCode).toBe(200);
      // The real appender committed the audit ledger through the injected opsGit (proof the row was recorded
      // in the production shape, not skipped), and only then was the spend executed.
      expect(gitCalls.some((args) => args[0] === 'commit')).toBe(true);
      expect(executeCalls).toHaveLength(1);
    });

    it('refuses the spend with 500 when the real appender fails, before any draw-down', async () => {
      const opsGit = (() => { throw new Error('ops push rejected'); }) as SurfaceContext['opsGit'];
      const { ctx, executeCalls } = prodCtx(opsGit);
      mount(ctx);
      const res = await app.inject({ method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(VALID_TOKEN), payload: imageBody });
      expect(res.statusCode).toBe(500);
      expect(res.json().error).toBe('paid-action-audit-required');
      expect(executeCalls).toHaveLength(0);
    });
  });
});

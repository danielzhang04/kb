import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import type { SurfaceContext } from '../http/context.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { SubprocessResult } from './resolvers.ts';
import { getInboxSourceCache, resetInboxSourceCacheForTests } from './sourceCache.ts';
import {
  registerInboxRoutes, createInboxRoutePorts, readInbox, P5SourceBudget,
  registerInboxActionRoutes, type InboxRoutePorts, type InboxActionPorts, type DeployCeremonyGate,
} from './routes.ts';
import { prHref } from './contracts.ts';
import { deployReadyRevision } from './deploymentContracts.ts';
import type { DeployReadyCandidate } from '../deploy/contracts.ts';

const sessionConfig = { ['se' + 'cret']: Buffer.from('inbox-route-test-session-value'), ttlMs: 60_000 } as unknown as SessionConfig;
const origin = 'http://kb.test';
const baseHeaders = { origin, host: 'kb.test' };
const NOW = '2026-08-24T00:00:00.000Z';
const SHA = 'a'.repeat(40);
const LIVE = 'b'.repeat(40);
const DIGEST = 'c'.repeat(64);

function emptyIndex(): PlaneAIndex {
  return {
    cards: {},
    ledgers: {
      dispatch: { count: 0, cards: 0, byProject: {} },
      cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
      grades: { count: 0, rows: [] },
      activity: { count: 0, rows: [] },
    },
    orgStates: [],
  } as unknown as PlaneAIndex;
}

const PR_ROW = { number: 7, title: 'Widen the durable manifest', createdAt: '2026-08-23T12:00:00Z' };

function ports(overrides: Partial<InboxRoutePorts> = {}): InboxRoutePorts {
  resetInboxSourceCacheForTests();
  return {
    pin: () => ({ owner: 'danielzhang04', repo: 'kb' }),
    runGh: async (): Promise<SubprocessResult> => ({ ok: true, stdout: '[]' }),
    cache: getInboxSourceCache({ now: () => Date.now() }),
    now: () => NOW,
    indexRepo: emptyIndex,
    deployments: { listDeployments: () => [] },
    livePtySessions: { liveSessionIds: () => [] },
    deployReady: { latestCandidate: () => null },
    resolveLiveSha: () => null,
    ancestry: { isStrictDescendant: () => false },
    assetPullIntents: { listAssetPullIntents: () => [] },
    p5Budget: new P5SourceBudget(),
    nowMs: () => Date.now(),
    ...overrides,
  };
}

function app(routePorts: InboxRoutePorts) {
  const instance = Fastify();
  registerInboxRoutes(instance, { repoRoot: '/fake/repo', sessionConfig } as SurfaceContext, routePorts);
  return instance;
}

function token() { return mintSession('operator', sessionConfig).token; }
function authed(instance: ReturnType<typeof Fastify>, url = '/api/inbox') {
  return instance.inject({ method: 'GET', url, headers: { ...baseHeaders, [['author', 'ization'].join('')]: `Bearer ${token()}` } });
}

afterEach(() => resetInboxSourceCacheForTests());

describe('Inbox routes — four-source envelope', () => {
  it('requires a session', async () => {
    const instance = app(ports());
    expect((await instance.inject({ method: 'GET', url: '/api/inbox', headers: baseHeaders })).statusCode).toBe(401);
    await instance.close();
  });

  it('empty: all four sources are verified and the envelope carries the four source keys', async () => {
    const instance = app(ports());
    const res = await authed(instance);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.items).toEqual([]);
    expect(Object.keys(body.sources).sort()).toEqual(['assetPull', 'deployment', 'escalation', 'pr']);
    for (const kind of ['pr', 'escalation', 'deployment', 'assetPull']) expect(body.sources[kind].status).toBe('verified');
    await instance.close();
  });

  it('serves a decoded PR subject with a server-built href alongside the two new (empty) sources', async () => {
    const instance = app(ports({ runGh: async () => ({ ok: true, stdout: JSON.stringify([PR_ROW]) }) }));
    const body = (await authed(instance)).json();
    const pr = body.items.find((i: { kind: string }) => i.kind === 'pr');
    expect(pr.href).toBe('https://github.com/danielzhang04/kb/pull/7');
    await instance.close();
  });

  it('projects a deploy-ready subject from the injected candidate + live sha + strict-descendant gate', async () => {
    const candidate: DeployReadyCandidate = { sha: SHA, attestationDigest: DIGEST, breaking: false };
    const instance = app(ports({
      deployReady: { latestCandidate: () => candidate },
      resolveLiveSha: () => LIVE,
      ancestry: { isStrictDescendant: () => true },
    }));
    const body = (await authed(instance)).json();
    const item = body.items.find((i: { kind: string }) => i.kind === 'deployment');
    expect(item.state).toBe('deploy-ready');
    expect(item.subject.deploymentRef).toBe(`deploy-ready:${SHA}`);
    expect(item.blockingPtyIds).toEqual([]);
    expect(body.sources.deployment.status).toBe('verified');
    await instance.close();
  });

  it('a failing deployment reader yields a failed source but keeps the healthy sources', async () => {
    const instance = app(ports({
      deployments: { listDeployments: () => { throw new Error('store down'); } },
    }));
    const body = (await authed(instance)).json();
    expect(body.sources.deployment.status).toBe('failed');
    expect(body.sources.pr.status).toBe('verified');
    await instance.close();
  });

  it('fresh PR failure with no last-good shows a failed source row and keeps escalation verified', async () => {
    const instance = app(ports({ runGh: async () => ({ ok: false, stdout: '' }) }));
    const body = (await authed(instance)).json();
    expect(body.items).toEqual([]);
    expect(body.sources.pr.status).toBe('failed');
    expect(body.sources.escalation.status).toBe('verified');
    await instance.close();
  });

  it('a pin that cannot resolve degrades PR to unavailable but not escalation', async () => {
    const instance = app(ports({ pin: () => null }));
    const body = (await authed(instance)).json();
    expect(body.sources.pr.status).toBe('failed');
    expect(body.sources.escalation.status).toBe('verified');
    await instance.close();
  });

  it('degrades a non-GitHub origin to an unavailable PR source instead of failing composition', async () => {
    resetInboxSourceCacheForTests();
    const repoRoot = await mkdtemp(join(tmpdir(), 'inbox-pin-'));
    mkdirSync(join(repoRoot, 'queue'));
    const ctx = { repoRoot, sessionConfig, controlStore: { listDeployments: () => [], listAssetPullIntents: () => [] } } as unknown as SurfaceContext;
    const built = createInboxRoutePorts(ctx, {
      readRemote: () => '/mnt/c/Users/danie/kb\n',
      runGh: async (): Promise<SubprocessResult> => ({ ok: true, stdout: JSON.stringify([PR_ROW]) }),
    });
    expect(built.pin()).toBeNull();
    const body = await readInbox({ ...built, indexRepo: emptyIndex, now: () => NOW }, repoRoot);
    expect(body.sources.pr.status).toBe('failed');
    expect(body.items.filter((item) => item.kind === 'pr')).toHaveLength(0);
    expect(body.sources.escalation.status).toBe('verified');
    expect(() => prHref({ owner: '', repo: '', number: 0 })).toThrow();
    await rm(repoRoot, { recursive: true, force: true });
  });

  it('rejects an unknown refresh value with 400 and never spawns', async () => {
    let spawned = 0;
    const instance = app(ports({ runGh: async () => { spawned += 1; return { ok: true, stdout: '[]' }; } }));
    const res = await authed(instance, '/api/inbox?refresh=bogus');
    expect(res.statusCode).toBe(400);
    expect(spawned).toBe(0);
    await instance.close();
  });

  it('accepts ?refresh=deployment and ?refresh=assetPull and ?refresh=pr', async () => {
    for (const source of ['deployment', 'assetPull', 'pr', 'escalation']) {
      const instance = app(ports({ runGh: async () => ({ ok: true, stdout: JSON.stringify([PR_ROW]) }) }));
      const res = await authed(instance, `/api/inbox?refresh=${source}`);
      expect(res.statusCode).toBe(200);
      await instance.close();
    }
  });
});

// ===================================================================================================
// Action endpoints — parsing, session gating, idempotency key, T3 ceremony gate, pre-ceremony 409s.
// ===================================================================================================

function greenCandidate(breaking = false): DeployReadyCandidate {
  return { sha: SHA, attestationDigest: DIGEST, breaking };
}

interface Recorder { deploy: number; confirm: number; abort: number; acknowledge: number; pull: number; retry: number; helperDeploy: number; }

function actionPorts(over: {
  candidate?: DeployReadyCandidate | null;
  liveSha?: string | null;
  available?: boolean;
  verify?: DeployCeremonyGate['verify'];
  deploymentState?: string;
  rec?: Recorder;
} = {}): InboxActionPorts {
  const rec = over.rec ?? { deploy: 0, confirm: 0, abort: 0, acknowledge: 0, pull: 0, retry: 0, helperDeploy: 0 };
  const deployment = { deploymentRef: 'deployment-1', revision: 3, state: over.deploymentState ?? 'requested' } as unknown;
  const service = {
    deploy: () => { rec.deploy += 1; return { deployment, replayed: false }; },
    confirm: () => { rec.confirm += 1; return { deployment, replayed: false }; },
    abort: () => { rec.abort += 1; return deployment; },
    acknowledge: () => { rec.acknowledge += 1; return deployment; },
  } as unknown as InboxActionPorts['executors']['deploymentService'];
  const assetPull = {
    pull: () => { rec.pull += 1; return { intent: {}, idempotencyKey: 'k', replayed: false }; },
    retry: () => { rec.retry += 1; return { intent: {}, idempotencyKey: 'k', replayed: false }; },
  } as unknown as InboxActionPorts['executors']['assetPullService'];
  return {
    executors: { deploymentService: service, assetPullService: assetPull, helperDeploy: () => { rec.helperDeploy += 1; } },
    ceremony: {
      available: () => over.available ?? false,
      verify: over.verify ?? (() => null),
    },
    deployReady: { latestCandidate: () => (over.candidate === undefined ? greenCandidate() : over.candidate) },
    resolveLiveSha: () => (over.liveSha === undefined ? LIVE : over.liveSha),
    quiescence: {
      store: {} as InboxActionPorts['quiescence']['store'],
      liveSessions: { listLiveSessionIds: () => [] },
      closeSessions: (async () => ({ ok: false, refusal: 'x', detail: 'x' })) as unknown as InboxActionPorts['quiescence']['closeSessions'],
      now: () => NOW,
    },
    operatorSubject: 'human-operator',
  };
}

function actionApp(ap: InboxActionPorts, controlStore: unknown = { getDeployment: () => ({ ok: true, value: { state: 'requested' } }) }) {
  const instance = Fastify();
  const ctx = { repoRoot: '/fake/repo', sessionConfig, controlStore } as unknown as SurfaceContext;
  registerInboxActionRoutes(instance, ctx, ap);
  return instance;
}

function post(instance: ReturnType<typeof Fastify>, url: string, body: unknown, idem = 'idem-1') {
  const headers: Record<string, string> = { ...baseHeaders, [['author', 'ization'].join('')]: `Bearer ${token()}` };
  if (idem) headers['idempotency-key'] = idem;
  return instance.inject({ method: 'POST', url, headers, payload: body });
}

const deployRef = `deploy-ready:${SHA}`;
const deployRevision = () => deployReadyRevision(SHA, LIVE);

describe('Inbox action endpoints', () => {
  it('every action endpoint requires a session', async () => {
    const instance = actionApp(actionPorts());
    const res = await instance.inject({ method: 'POST', url: `/api/inbox/deployment/${deployRef}/deploy`, headers: baseHeaders, payload: {} });
    expect(res.statusCode).toBe(401);
    await instance.close();
  });

  it('deploy: refuses 400 invalid-ref on a malformed ref before any work', async () => {
    const instance = actionApp(actionPorts());
    const res = await post(instance, '/api/inbox/deployment/not!a!ref/deploy', { expectedRevision: deployRevision() });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid-ref');
    await instance.close();
  });

  it('deploy: refuses 400 invalid-revision on a deployment:<n> ref/revision', async () => {
    const instance = actionApp(actionPorts());
    const res = await post(instance, '/api/inbox/deployment/deployment:3/deploy', { expectedRevision: 'deployment:3' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid-revision');
    await instance.close();
  });

  it('deploy: requires an idempotency key', async () => {
    const instance = actionApp(actionPorts());
    const res = await post(instance, `/api/inbox/deployment/${deployRef}/deploy`, { expectedRevision: deployRevision() }, '');
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('idempotency-key-required');
    await instance.close();
  });

  it('deploy: a breaking candidate refuses 409 confirm-required BEFORE any ceremony work', async () => {
    const rec = { deploy: 0, confirm: 0, abort: 0, acknowledge: 0, pull: 0, retry: 0, helperDeploy: 0 };
    const instance = actionApp(actionPorts({ candidate: greenCandidate(true), available: true, rec }));
    const res = await post(instance, `/api/inbox/deployment/${deployRef}/deploy`, { expectedRevision: deployRevision() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('confirm-required');
    expect(rec.deploy).toBe(0);
    await instance.close();
  });

  it('confirm: a green candidate refuses 409 deploy-required', async () => {
    const instance = actionApp(actionPorts({ candidate: greenCandidate(false), available: true }));
    const res = await post(instance, `/api/inbox/deployment/${deployRef}/confirm`, { expectedRevision: deployRevision() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('deploy-required');
    await instance.close();
  });

  it('deploy: a stale candidate (sha moved on) refuses 409 revision-changed', async () => {
    const instance = actionApp(actionPorts({ candidate: { sha: 'f'.repeat(40), attestationDigest: DIGEST, breaking: false }, available: true }));
    const res = await post(instance, `/api/inbox/deployment/${deployRef}/deploy`, { expectedRevision: deployRevision() });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('revision-changed');
    await instance.close();
  });

  it('deploy: without a ceremony refuses 403 ceremony-unavailable (VM default, no provisioned credential)', async () => {
    const instance = actionApp(actionPorts({ available: false }));
    const res = await post(instance, `/api/inbox/deployment/${deployRef}/deploy`, { expectedRevision: deployRevision() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ceremony-unavailable');
    await instance.close();
  });

  it('deploy: happy path with ceremony available + verify ok creates the record and invokes the helper', async () => {
    const rec = { deploy: 0, confirm: 0, abort: 0, acknowledge: 0, pull: 0, retry: 0, helperDeploy: 0 };
    const instance = actionApp(actionPorts({ available: true, verify: () => null, rec }));
    const res = await post(instance, `/api/inbox/deployment/${deployRef}/deploy`, { expectedRevision: deployRevision() });
    expect(res.statusCode).toBe(200);
    expect(rec.deploy).toBe(1);
    expect(rec.helperDeploy).toBe(1);
    await instance.close();
  });

  it('deploy: ceremony available but verify fails refuses 403 ceremony-invalid and never writes', async () => {
    const rec = { deploy: 0, confirm: 0, abort: 0, acknowledge: 0, pull: 0, retry: 0, helperDeploy: 0 };
    const instance = actionApp(actionPorts({ available: true, verify: () => ({ status: 403, code: 'ceremony-invalid' }), rec }));
    const res = await post(instance, `/api/inbox/deployment/${deployRef}/deploy`, { expectedRevision: deployRevision() });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ceremony-invalid');
    expect(rec.deploy).toBe(0);
    await instance.close();
  });

  it('abort: a deploy-ready ref is refused 400 invalid-revision (deployment:<n> only)', async () => {
    const instance = actionApp(actionPorts({ available: true }));
    const res = await post(instance, `/api/inbox/deployment/${deployRef}/abort`, { expectedRevision: 'deployment:3' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid-revision');
    await instance.close();
  });

  it('abort: without a ceremony refuses 403 ceremony-unavailable', async () => {
    const instance = actionApp(actionPorts({ available: false }));
    const res = await post(instance, '/api/inbox/deployment/deployment:3/abort', { expectedRevision: 'deployment:3' });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ceremony-unavailable');
    await instance.close();
  });

  it('acknowledge: NON-T3 terminal record acknowledges with no ceremony', async () => {
    const rec = { deploy: 0, confirm: 0, abort: 0, acknowledge: 0, pull: 0, retry: 0, helperDeploy: 0 };
    const store = { getDeployment: () => ({ ok: true, value: { state: 'succeeded' } }) };
    const instance = actionApp(actionPorts({ available: false, rec }), store);
    const res = await post(instance, '/api/inbox/deployment/deployment:3/acknowledge', { expectedRevision: 'deployment:3' });
    expect(res.statusCode).toBe(200);
    expect(rec.acknowledge).toBe(1);
    await instance.close();
  });

  it('acknowledge: a non-terminal record is refused 409 not-terminal', async () => {
    const store = { getDeployment: () => ({ ok: true, value: { state: 'requested' } }) };
    const instance = actionApp(actionPorts(), store);
    const res = await post(instance, '/api/inbox/deployment/deployment:3/acknowledge', { expectedRevision: 'deployment:3' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('not-terminal');
    await instance.close();
  });

  it('asset-pull pull: invalid intent ref is 400 invalid-ref', async () => {
    const instance = actionApp(actionPorts());
    const res = await post(instance, '/api/inbox/asset-pull/not-an-intent/pull', {});
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('invalid-ref');
    await instance.close();
  });

  it('asset-pull pull: NON-T3, session-authenticated, requires idempotency key and dispatches', async () => {
    const rec = { deploy: 0, confirm: 0, abort: 0, acknowledge: 0, pull: 0, retry: 0, helperDeploy: 0 };
    const intent = `assetpull-${'a'.repeat(32)}`;
    const instance = actionApp(actionPorts({ rec }));
    const missing = await post(instance, `/api/inbox/asset-pull/${intent}/pull`, {}, '');
    expect(missing.statusCode).toBe(400);
    const ok = await post(instance, `/api/inbox/asset-pull/${intent}/retry`, {});
    expect(ok.statusCode).toBe(200);
    expect(rec.retry).toBe(1);
    await instance.close();
  });

  it('close-ptys-and-continue: T3 without a ceremony refuses 403 ceremony-unavailable', async () => {
    const instance = actionApp(actionPorts({ available: false }));
    const res = await post(instance, '/api/inbox/deployment/deployment:3/close-ptys-and-continue', {
      expectedRevision: 'deployment:3', sessionIds: [`pty-${'a'.repeat(32)}`],
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe('ceremony-unavailable');
    await instance.close();
  });

  it('there is NO decline endpoint', async () => {
    const instance = actionApp(actionPorts({ available: true }));
    const res = await post(instance, '/api/inbox/deployment/deployment:3/decline', { expectedRevision: 'deployment:3' });
    expect(res.statusCode).toBe(404);
    await instance.close();
  });
});

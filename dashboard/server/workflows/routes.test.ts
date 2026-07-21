import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import type { AuditEvent } from '../audit/log.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import { parseWorkflowDef } from './defs.ts';
import { registerWorkflows } from './routes.ts';

const SESSION: SessionConfig = { secret: Buffer.from('workflow-route-test-secret-32byte!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const HEAD = 'a'.repeat(40);

function headers(token?: string): Record<string, string> {
  const base: Record<string, string> = { origin: ORIGIN, host: 'localhost:5317', 'content-type': 'application/json' };
  if (token) base.authorization = `Bearer ${token}`;
  return base;
}

/** The launch route's injected side-effect runners: no real git, py, or queue tree is ever touched. */
function runners() {
  return {
    appendAudit: (_repoRoot: string, event: AuditEvent) => ({ ts: new Date().toISOString(), ...event }),
    appendAuditLocal: (_repoRoot: string, event: AuditEvent) => ({ ts: new Date().toISOString(), ...event }),
    runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
    opsGit: (_repoRoot: string, args: string[]) => {
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args.join(' ') === 'rev-parse HEAD') return `${HEAD}\n`;
      return '';
    },
    runPy: (_repoRoot: string, _code: string, jsonArg: string) => {
      const op = JSON.parse(jsonArg) as { runId: string; stages: Array<{ id: string }> };
      const cards = op.stages.map((stage) => {
        const cardId = workflowCardId(op.runId, stage.id);
        return { stageId: stage.id, cardId, state: 'blocked', cardPath: `queue/inbox/${cardId}.md` };
      });
      return { exitCode: 0, stdout: `${JSON.stringify({ runId: op.runId, cards })}\n`, stderr: '' };
    },
  };
}

describe('workflow definition routes', () => {
  let app: ReturnType<typeof Fastify>;
  let controlStore: ReturnType<typeof createInMemoryControlPlaneStore>;
  let token: string;
  let auditRows: Array<Record<string, unknown>>;

  beforeEach(async () => {
    let id = 0;
    auditRows = [];
    controlStore = createInMemoryControlPlaneStore({ newId: () => `ref-${++id}` });
    token = mintSession('operator', SESSION).token;
    app = Fastify();
    const injected = runners();
    registerWorkflows(app, makeSurfaceContext({
      repoRoot: REPO_ROOT,
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      credentials: () => [],
      controlStore,
      ...injected,
      appendAudit: (repoRoot, event) => {
        auditRows.push(event as unknown as Record<string, unknown>);
        return injected.appendAudit(repoRoot, event);
      },
      appendAuditLocal: (repoRoot, event) => {
        auditRows.push(event as unknown as Record<string, unknown>);
        return injected.appendAuditLocal(repoRoot, event);
      },
    }));
    await app.ready();
  });

  afterEach(async () => app.close());

  it('lists the shipped org workflow definitions as valid', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect(response.statusCode).toBe(200);
    const items = response.json().items as Array<{ ref: string; valid: boolean; project: string; riskTier: string }>;
    const triage = items.find((item) => item.ref === 'email-triage');
    const brief = items.find((item) => item.ref === 'research-brief');
    expect(triage).toMatchObject({ valid: true, project: 'kb-ops', riskTier: 'T2' });
    expect(brief).toMatchObject({ valid: true, project: 'kb-ops', riskTier: 'T2' });
  });

  it('returns a definition with its compiled proposal preview and content hash', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/workflows/research-brief' });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { definition: { id: string } | null; compiled: { ok: boolean; proposalId: string; contentHash: string; stages: unknown[] } };
    expect(body.definition?.id).toBe('research-brief');
    expect(body.compiled.ok).toBe(true);
    expect(body.compiled.proposalId).toMatch(/^wf-[a-f0-9]{48}$/);
    expect(body.compiled.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.compiled.stages).toHaveLength(1);
  });

  it('404s an unknown definition', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/workflows/nope' });
    expect(response.statusCode).toBe(404);
  });

  it('refuses the launch without a session', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(), payload: { idempotencyKey: 'k1' },
    });
    expect(response.statusCode).toBe(401);
  });

  it('a no-session caller cannot smuggle the internal-service bypass through the request body (still 401)', async () => {
    // The internal service caller is an in-process principal the gated bridge threads directly into
    // executeApprovedLaunch; it is NEVER sourced from the wire. A hostile body carrying `internalService`
    // (or a `sessionToken`) must not reach the launch body — the session chain rejects it, unchanged.
    const response = await app.inject({
      method: 'POST',
      url: '/api/workflows/research-brief/launch',
      headers: headers(),
      payload: { idempotencyKey: 'k1', internalService: { kind: 'internal-service-caller', subject: 'dashboard-engine' }, sessionToken: 'x' },
    });
    expect(response.statusCode).toBe(401);
    expect(controlStore.listRuns('operator')).toHaveLength(0);
  });

  it('refuses the launch from a foreign origin or a rebound host', async () => {
    // security/origin.ts is deliberate: a MISSING Origin is admitted only when the Host still matches
    // the allowlist (non-browser clients), and the Host check is the DNS-rebinding guard. Both halves
    // must reject before the launch body is ever reached.
    const rebound = await app.inject({
      method: 'POST',
      url: '/api/workflows/research-brief/launch',
      headers: { host: 'evil.example', 'content-type': 'application/json', authorization: `Bearer ${token}` },
      payload: { idempotencyKey: 'k1' },
    });
    expect(rebound.statusCode).toBe(403);

    const foreign = await app.inject({
      method: 'POST',
      url: '/api/workflows/research-brief/launch',
      headers: { ...headers(token), origin: 'http://evil.example' },
      payload: { idempotencyKey: 'k1' },
    });
    expect(foreign.statusCode).toBe(403);
    expect(controlStore.listRuns('operator')).toHaveLength(0);
  });

  it('refuses a launch that carries no client idempotencyKey', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(token), payload: {},
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toBe('idempotency-key-required');
    expect(controlStore.listRuns('operator')).toHaveLength(0);
  });

  it('launches a definition through the canonical path and stalls at the activation gate', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(token),
      payload: { idempotencyKey: 'launch-1' },
    });
    expect(response.statusCode).toBe(202);
    const body = response.json() as { ok: boolean; runRef: string; activationGated: boolean; waitingHuman: boolean; cards: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.activationGated).toBe(true);
    expect(body.waitingHuman).toBe(true);
    expect(body.cards).toHaveLength(1);

    // The run is durably projected: published, waiting on the runtime-activation human gate.
    const run = controlStore.getRun('operator', body.runRef);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.run.publicationState).toBe('published');
    expect(run.value.run.state).toBe('waiting-human');
    expect(run.value.humanRequests.some((request) => request.title === 'Automatic execution activation is gated')).toBe(true);
  });

  it('records the canonical audit action names plus the policy snapshot', async () => {
    await app.inject({
      method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(token),
      payload: { idempotencyKey: 'launch-audit' },
    });
    const decision = auditRows.find((row) => row.action === 'control-proposal-decision-authorize');
    const launch = auditRows.find((row) => row.action === 'control-run-launch');
    expect(decision).toBeDefined();
    expect(launch).toBeDefined();
    // `source` stays the discriminator so audit queries by canonical action never miss a workflow launch.
    expect((decision?.detail as { source?: string }).source).toBe('workflow:research-brief');
    const detail = launch?.detail as { source?: string; policyBaseCommit?: string; policyHashes?: Array<{ stageId: string; policyHash: string }> };
    expect(detail.source).toBe('workflow:research-brief');
    expect(detail.policyBaseCommit).toBe(HEAD);
    expect(detail.policyHashes).toHaveLength(1);
    expect(detail.policyHashes?.[0].policyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(auditRows.some((row) => String(row.action).startsWith('workflow-'))).toBe(false);
  });

  it('replays one run for two launches that share an idempotencyKey', async () => {
    const first = await app.inject({
      method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(token),
      payload: { idempotencyKey: 'same-key' },
    });
    const second = await app.inject({
      method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(token),
      payload: { idempotencyKey: 'same-key' },
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().runRef).toBe(first.json().runRef);
    // Exactly one run, one proposal, and one set of canonical cards — no duplicate queue publication.
    expect(controlStore.listRuns('operator')).toHaveLength(1);
    expect(controlStore.listProposalRevisions('operator')).toHaveLength(1);
  });

  it('refuses the one-step launch once automatic execution is activated', async () => {
    const activated = Fastify();
    registerWorkflows(activated, makeSurfaceContext({
      repoRoot: REPO_ROOT,
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      credentials: () => [],
      controlStore: createInMemoryControlPlaneStore({ newId: () => `act-${Math.random()}` }),
      ...runners(),
      controlBroker: { isRunning: () => false } as never,
      runAutomatic: (async () => ({ ok: true })) as never,
    }));
    await activated.ready();
    const response = await activated.inject({
      method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(token),
      payload: { idempotencyKey: 'activated' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().error).toBe('workflow-launch-requires-manual-activation');
    await activated.close();
  });
});

describe('workflow launch governance boundaries', () => {
  let repoRoot: string;
  let app: ReturnType<typeof Fastify>;
  let controlStore: ReturnType<typeof createInMemoryControlPlaneStore>;
  let token: string;

  /** A scratch repo root carrying the real governance/policy files plus one synthetic definition. */
  function writeDefinition(name: string, text: string): void {
    const dir = join(repoRoot, 'orgs', 'kb-ops', 'workflows');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), text, 'utf8');
  }

  beforeEach(async () => {
    repoRoot = mkdtempSync(join(tmpdir(), 'kb-workflow-routes-'));
    for (const rel of ['governance', 'CLAUDE.md', join('orgs', 'kb-ops', 'contract.md')]) {
      const from = join(REPO_ROOT, rel);
      if (existsSync(from)) {
        mkdirSync(join(repoRoot, rel, '..'), { recursive: true });
        cpSync(from, join(repoRoot, rel), { recursive: true });
      }
    }
    let id = 0;
    controlStore = createInMemoryControlPlaneStore({ newId: () => `ref-${++id}` });
    token = mintSession('operator', SESSION).token;
    app = Fastify();
    registerWorkflows(app, makeSurfaceContext({
      repoRoot,
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      credentials: () => [],
      controlStore,
      ...runners(),
    }));
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    rmSync(repoRoot, { recursive: true, force: true });
  });

  it('rejects a definition that targets a tree outside its own org', () => {
    const outside = [
      '---',
      'id: escape',
      'project: kb-ops',
      'title: Escape',
      'profile: research',
      'stages:',
      '  - id: edit',
      '    title: Edit the policy engine',
      '    action: code:patch',
      '    target: dashboard/server/control/policy.ts',
      '    workOrder: rewrite the boundary',
      '---',
      'body',
      '',
    ].join('\n');
    const parsed = parseWorkflowDef(outside);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.detail).toContain("own org tree 'orgs/kb-ops/'");

    // A sibling org's tree is refused too — a def may only target the project it declares.
    const sibling = parseWorkflowDef(outside.replace('dashboard/server/control/policy.ts', 'orgs/other-project/output'));
    expect(sibling.ok).toBe(false);
  });

  it('surfaces an out-of-org definition as invalid rather than launchable', async () => {
    writeDefinition('escape', [
      '---',
      'id: escape',
      'project: kb-ops',
      'title: Escape',
      'profile: research',
      'stages:',
      '  - id: edit',
      '    title: Edit governance',
      '    action: code:patch',
      '    target: governance/risk-tiers.md',
      '    workOrder: rewrite the rules',
      '---',
      'body',
      '',
    ].join('\n'));
    const listed = await app.inject({ method: 'GET', url: '/api/workflows' });
    const entry = (listed.json().items as Array<{ ref: string; valid: boolean }>).find((item) => item.ref === 'kb-ops~escape');
    expect(entry?.valid).toBe(false);

    const launched = await app.inject({
      method: 'POST', url: '/api/workflows/kb-ops~escape/launch', headers: headers(token),
      payload: { idempotencyKey: 'escape' },
    });
    expect(launched.statusCode).toBe(409);
    expect(launched.json().error).toBe('definition-invalid');
    expect(controlStore.listRuns('operator')).toHaveLength(0);
  });

  it('stalls a T3 definition at the human boundary and publishes NO canonical cards', async () => {
    writeDefinition('release', [
      '---',
      'id: release',
      'project: kb-ops',
      'title: Release',
      'profile: research',
      'stages:',
      '  - id: ship',
      '    title: Ship the release',
      '    action: release:cut',
      '    target: orgs/kb-ops/output',
      '    workOrder: cut the release',
      '---',
      'body',
      '',
    ].join('\n'));
    const detail = await app.inject({ method: 'GET', url: '/api/workflows/release' });
    expect((detail.json() as { entry: { riskTier: string } }).entry.riskTier).toBe('T3');

    const response = await app.inject({
      method: 'POST', url: '/api/workflows/release/launch', headers: headers(token),
      payload: { idempotencyKey: 't3-launch' },
    });
    expect(response.statusCode).toBe(202);
    const body = response.json() as { runRef: string; waitingHuman: boolean; cards?: unknown; activationGated?: boolean };
    expect(body.waitingHuman).toBe(true);
    // The human-gate path never published, so it must not claim the post-publication activation gate.
    expect(body.activationGated).toBeUndefined();
    expect(body.cards).toBeUndefined();

    const run = controlStore.getRun('operator', body.runRef);
    expect(run.ok).toBe(true);
    if (!run.ok) return;
    expect(run.value.run.publicationState).toBe('waiting-human');
    expect(run.value.run.state).toBe('waiting-human');
    expect(run.value.stages.every((stage) => stage.canonicalCardRef === null)).toBe(true);
    expect(run.value.humanRequests.length).toBeGreaterThan(0);
  });
});

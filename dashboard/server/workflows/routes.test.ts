import Fastify from 'fastify';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { makeSurfaceContext } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import { createInMemoryComposerStore } from '../composer/store.ts';
import { createProviderIdProtector } from '../composer/protector.ts';
import type { AuditEvent } from '../audit/log.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import { parseWorkflowDef } from './defs.ts';
import { registerWorkflows } from './routes.ts';
import { createFileAssignmentAmendmentStore, createInMemoryAssignmentAmendmentStore } from './amendmentStore.ts';

const SESSION: SessionConfig = { secret: Buffer.from('workflow-route-test-secret-32byte!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';
const REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const HEAD = 'a'.repeat(40);

function headers(token?: string): Record<string, string> {
  const base: Record<string, string> = { origin: ORIGIN, host: 'localhost:5317', 'content-type': 'application/json' };
  if (token) base.authorization = `Bearer ${token}`;
  return base;
}

async function launchPayload(app: ReturnType<typeof Fastify>, id: string, idempotencyKey: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const detail = await app.inject({ method: 'GET', url: `/api/workflows/${encodeURIComponent(id)}` });
  const sourceHash = (detail.json() as { entry?: { sourceHash?: string } }).entry?.sourceHash;
  if (!sourceHash) throw new Error(`missing source hash for test workflow ${id}`);
  return { idempotencyKey, expectedSourceHash: sourceHash, ...extra };
}

/** The launch route's injected side-effect runners: no real git, py, or queue tree is ever touched. */
function runners() {
  return {
    assignmentAmendmentStore: createInMemoryAssignmentAmendmentStore(),
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
  let composerStore: ReturnType<typeof createInMemoryComposerStore>;
  let token: string;
  let auditRows: Array<Record<string, unknown>>;

  beforeEach(async () => {
    let id = 0;
    auditRows = [];
    controlStore = createInMemoryControlPlaneStore({ newId: () => `ref-${++id}` });
    composerStore = createInMemoryComposerStore({ protector: createProviderIdProtector(SESSION.secret) });
    token = mintSession('operator', SESSION).token;
    app = Fastify();
    const injected = runners();
    registerWorkflows(app, makeSurfaceContext({
      repoRoot: REPO_ROOT,
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      credentials: () => [],
      controlStore,
      composerStore,
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

  it('lists server-owned execution profiles in stable order', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/workflows/profiles' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ profiles: ['checker-readonly', 'drive-author', 'gmail-triage', 'producer', 'research'] });
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
      payload: await launchPayload(app, 'research-brief', 'launch-1'),
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
      payload: await launchPayload(app, 'research-brief', 'launch-audit'),
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
      payload: await launchPayload(app, 'research-brief', 'same-key'),
    });
    const second = await app.inject({
      method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(token),
      payload: await launchPayload(app, 'research-brief', 'same-key'),
    });
    expect(first.statusCode).toBe(202);
    expect(second.statusCode).toBe(200);
    expect(second.json().replayed).toBe(true);
    expect(second.json().runRef).toBe(first.json().runRef);
    // Exactly one run, one proposal, and one set of canonical cards — no duplicate queue publication.
    expect(controlStore.listRuns('operator')).toHaveLength(1);
    expect(controlStore.listProposalRevisions('operator')).toHaveLength(1);
  });

  it('requires the exact current source hash before proposal, audit, or run side effects', async () => {
    const response = await app.inject({
      method: 'POST', url: '/api/workflows/research-brief/launch', headers: headers(token),
      payload: { idempotencyKey: 'stale-source', expectedSourceHash: '0'.repeat(64) },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: 'stale-source-hash' });
    expect(controlStore.listRuns('operator')).toHaveLength(0);
    expect(auditRows).toHaveLength(0);
  });

  it('derives durable agent-workspace provenance, replays only the same workspace, and refuses a cross-workspace key reuse', async () => {
    const agent = {
      id: 'fyt-runner', path: 'agents/fyt-runner.md', sourceHash: 'b'.repeat(64), projects: ['faceless-youtube'],
      instructionMarkdown: 'Recorded server declaration context.',
    };
    const firstWorkspace = composerStore.create('operator', 'FYT planning', agent);
    const secondWorkspace = composerStore.create('operator', 'FYT planning fork', agent);
    const first = await app.inject({ method: 'POST', url: '/api/workflows/video-run/launch', headers: headers(token),
      payload: await launchPayload(app, 'video-run', 'workspace-key', { composerRef: firstWorkspace.composerRef, parameters: { channel: 'the-second-take', slug: '2026-07-19-wells-fargo' } }) });
    expect(first.statusCode).toBe(202);
    const replay = await app.inject({ method: 'POST', url: '/api/workflows/video-run/launch', headers: headers(token),
      payload: await launchPayload(app, 'video-run', 'workspace-key', { composerRef: firstWorkspace.composerRef, parameters: { channel: 'the-second-take', slug: '2026-07-19-wells-fargo' } }) });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().runRef).toBe(first.json().runRef);
    const changedParameters = await app.inject({ method: 'POST', url: '/api/workflows/video-run/launch', headers: headers(token),
      payload: await launchPayload(app, 'video-run', 'workspace-key', { composerRef: firstWorkspace.composerRef, parameters: { channel: 'the-second-take', slug: '2026-07-20-other' } }) });
    expect(changedParameters.statusCode).toBe(409);
    const run = controlStore.getRun('operator', first.json().runRef);
    expect(run.ok && run.value.run.agentWorkspaceLaunch).toEqual({
      composerRef: firstWorkspace.composerRef, agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'b'.repeat(64),
    });
    const conflict = await app.inject({ method: 'POST', url: '/api/workflows/video-run/launch', headers: headers(token),
      payload: await launchPayload(app, 'video-run', 'workspace-key', { composerRef: secondWorkspace.composerRef, parameters: { channel: 'the-second-take', slug: '2026-07-19-wells-fargo' } }) });
    expect(conflict.statusCode).toBe(409);
    const crossOwner = await app.inject({ method: 'POST', url: '/api/workflows/video-run/launch', headers: headers(token),
      payload: await launchPayload(app, 'video-run', 'other-key', { composerRef: composerStore.create('mallory', 'Foreign', agent).composerRef, parameters: { channel: 'the-second-take', slug: '2026-07-19-wells-fargo' } }) });
    expect(crossOwner.statusCode).toBe(404);
  });

});

describe('workflow launch governance boundaries', () => {
  let repoRoot: string;
  let app: ReturnType<typeof Fastify>;
  let controlStore: ReturnType<typeof createInMemoryControlPlaneStore>;
  let token: string;

  /** A scratch repo root carrying the real governance/policy files plus one synthetic definition. */
  function writeDefinition(name: string, text: string): void {
    writeDefinitionFor('kb-ops', name, text);
  }

  function writeDefinitionFor(project: string, name: string, text: string): void {
    const dir = join(repoRoot, 'orgs', project, 'workflows');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${name}.md`), text, 'utf8');
  }

  function writeAgent(id: string, lines: string[]): void {
    const dir = join(repoRoot, 'agents');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${id}.md`), ['---', `id: ${id}`, ...lines, '---', 'Bounded declaration instructions.', ''].join('\n'), 'utf8');
  }

  function assignedDefinition(id: string, managerId = 'assigned-manager', workerId = 'assigned-worker', workerProfile = 'worker:claude:claude-sonnet-5'): string {
    return [
      '---', `id: ${id}`, 'project: kb-ops', 'title: Assigned research', 'profile: research',
      'manager:', `  agentId: ${managerId}`, '  profileId: manager:claude:claude-opus-4-8',
      'stages:', '  - id: brief', '    title: Research a topic', '    action: research:web-brief',
      '    target: orgs/kb-ops/output', '    workOrder: research it', `    agentId: ${workerId}`, `    profileId: ${workerProfile}`,
      '---', 'body', '',
    ].join('\n');
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

  it('previews and launches a valid immutable manager/stage assignment from server-owned bindings', async () => {
    writeAgent('assigned-manager', [
      'runtime: claude', 'model: claude-opus-4-8', 'default-profile: manager:claude:claude-opus-4-8',
      'allowed-profiles: [manager:claude:claude-opus-4-8]', 'projects: [kb-ops]', 'runner-bound: true', 'description: Manager.',
    ]);
    writeAgent('assigned-worker', [
      'runtime: claude', 'model: claude-sonnet-5', 'default-profile: worker:claude:claude-sonnet-5',
      'allowed-profiles: [worker:claude:claude-sonnet-5]', 'projects: [kb-ops]', 'runner-bound: true', 'description: Worker.',
    ]);
    writeDefinition('assigned', assignedDefinition('assigned'));

    const listed = await app.inject({ method: 'GET', url: '/api/workflows' });
    const entry = (listed.json().items as Array<Record<string, unknown>>).find((item) => item.ref === 'assigned');
    expect(entry).toMatchObject({ valid: true, launchable: true, manager: { agentId: 'assigned-manager' } });

    const preview = await app.inject({ method: 'GET', url: '/api/workflows/assigned' });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      compiled: {
        ok: true,
        manager: { runtime: 'claude', model: 'claude-opus-4-8', assignment: { agentId: 'assigned-manager', declarationHash: expect.stringMatching(/^[a-f0-9]{64}$/) } },
        stages: [{ worker: { runtime: 'claude', model: 'claude-sonnet-5' }, assignment: { agentId: 'assigned-worker' } }],
      },
    });

    const launched = await app.inject({ method: 'POST', url: '/api/workflows/assigned/launch', headers: headers(token), payload: await launchPayload(app, 'assigned', 'assigned') });
    expect(launched.statusCode).toBe(202);
    expect(controlStore.listRuns('operator')).toHaveLength(1);
  });

  it('keeps parser-valid assignments visible but returns the exact compiler refusal and creates no run', async () => {
    writeAgent('assigned-manager', [
      'runtime: claude', 'model: claude-opus-4-8', 'default-profile: manager:claude:claude-opus-4-8',
      'allowed-profiles: [manager:claude:claude-opus-4-8]', 'projects: [kb-ops]', 'runner-bound: true', 'description: Manager.',
    ]);
    writeAgent('assigned-worker', [
      'runtime: claude', 'model: claude-sonnet-5', 'default-profile: worker:claude:claude-sonnet-5',
      'allowed-profiles: [worker:claude:claude-sonnet-5]', 'projects: [kb-ops]', 'runner-bound: false', 'description: Worker.',
    ]);
    writeDefinition('unbound-assigned', assignedDefinition('unbound-assigned'));

    const listed = await app.inject({ method: 'GET', url: '/api/workflows' });
    const entry = (listed.json().items as Array<Record<string, unknown>>).find((item) => item.ref === 'unbound-assigned');
    expect(entry).toMatchObject({ valid: true, launchable: false, compileError: 'assigned-agent-not-runner-bound' });
    expect(entry?.compileDetail).toBe("assigned agent 'assigned-worker' is not runner-bound");

    const preview = await app.inject({ method: 'GET', url: '/api/workflows/unbound-assigned' });
    expect(preview.json()).toMatchObject({ compiled: { ok: false, error: 'assigned-agent-not-runner-bound', detail: "assigned agent 'assigned-worker' is not runner-bound" } });

    const launched = await app.inject({ method: 'POST', url: '/api/workflows/unbound-assigned/launch', headers: headers(token), payload: await launchPayload(app, 'unbound-assigned', 'unbound') });
    expect(launched.statusCode).toBe(400);
    expect(launched.json()).toEqual({ error: 'assigned-agent-not-runner-bound', detail: "assigned agent 'assigned-worker' is not runner-bound" });
    expect(controlStore.listRuns('operator')).toHaveLength(0);
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

  it('hard-rejects duplicate ids instead of selecting one project definition', async () => {
    const definition = [
      '---',
      'id: shared',
      'project: kb-ops',
      'title: Shared',
      'profile: research',
      'stages:',
      '  - id: research',
      '    title: Research',
      '    action: research:brief',
      '    target: orgs/kb-ops/output',
      '    workOrder: research it',
      '---',
      'body',
      '',
    ].join('\n');
    writeDefinition('shared-a', definition);
    writeDefinitionFor('other', 'shared-b', definition
      .replace('project: kb-ops', 'project: other')
      .replace('target: orgs/kb-ops/output', 'target: orgs/other/output'));

    const listed = await app.inject({ method: 'GET', url: '/api/workflows' });
    const entries = listed.json().items as Array<{ ref: string; valid: boolean; detail: string }>;
    expect(entries.find((entry) => entry.ref === 'kb-ops~shared')).toMatchObject({ valid: false, detail: expect.stringMatching(/duplicated/) });
    expect(entries.find((entry) => entry.ref === 'other~shared')).toMatchObject({ valid: false, detail: expect.stringMatching(/duplicated/) });
    expect((await app.inject({ method: 'GET', url: '/api/workflows/shared' })).statusCode).toBe(404);

    const launched = await app.inject({
      method: 'POST', url: '/api/workflows/kb-ops~shared/launch', headers: headers(token), payload: { idempotencyKey: 'shared' },
    });
    expect(launched.statusCode).toBe(409);
    expect(launched.json()).toMatchObject({ error: 'definition-invalid' });
    expect(controlStore.listRuns('operator')).toHaveLength(0);
  });

  it('does not scan a workflow directory that resolves through a symlink outside its project', async () => {
    const outside = join(repoRoot, 'outside-workflows');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, 'escape.md'), [
      '---', 'id: escape-link', 'project: kb-ops', 'title: Escape', 'profile: research', 'stages:',
      '  - id: research', '    title: Research', '    action: research:brief', '    target: orgs/kb-ops/output', '    workOrder: research it',
      '---', 'body', '',
    ].join('\n'), 'utf8');
    const project = join(repoRoot, 'orgs', 'kb-ops');
    mkdirSync(project, { recursive: true });
    symlinkSync(outside, join(project, 'workflows'), 'junction');

    const listed = await app.inject({ method: 'GET', url: '/api/workflows' });
    expect((listed.json().items as Array<{ ref: string }>).some((entry) => entry.ref === 'escape-link')).toBe(false);
    expect((await app.inject({ method: 'GET', url: '/api/workflows/escape-link' })).statusCode).toBe(404);
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
      payload: await launchPayload(app, 'release', 't3-launch'),
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

  it('drives the one-step launch through the activated executor and hands the run to runAutomatic', async () => {
    // Replaces the pre-2026-07-21 refusal test: with the execution engine injected, the one-step launch
    // no longer 409s — it flows through the canonical executeApprovedLaunch, activates the root card, and
    // fires runAutomatic with the created runRef (Wave-A live-fire runbook D0-A).
    writeDefinition('activated-research', [
      '---',
      'id: activated-research',
      'project: kb-ops',
      'title: Activated research',
      'profile: research',
      'stages:',
      '  - id: research',
      '    title: Research',
      '    action: research:brief',
      '    target: orgs/kb-ops/output',
      '    workOrder: research it',
      '---',
      'body',
      '',
    ].join('\n'));

    const runAutomaticCalls: Array<{ runRef: string }> = [];
    const activated = Fastify();
    registerWorkflows(activated, makeSurfaceContext({
      repoRoot,
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      credentials: () => [],
      controlStore: createInMemoryControlPlaneStore({ newId: () => `act-${Math.random()}` }),
      ...runners(),
      // The activated managed-root step reads each published card back off disk and diffs it against
      // `git show HEAD:<path>` (empty via the stub git). So the launch card op writes an EMPTY card file:
      // the read resolves and the empty on-disk content matches the empty stubbed HEAD content.
      runPy: (_repo: string, _code: string, jsonArg: string) => {
        const op = JSON.parse(jsonArg) as { runId?: string; cardRefs?: string[]; stages?: Array<{ id: string }> };
        if (op.cardRefs) {
          const cards = [...op.cardRefs].sort().map((ref) => ({ cardRef: ref, path: `queue/inbox/${ref}.md`, changed: false }));
          return { exitCode: 0, stdout: `${JSON.stringify({ cards })}\n`, stderr: '' };
        }
        const cards = (op.stages ?? []).map((stage) => {
          const cardId = workflowCardId(op.runId as string, stage.id);
          mkdirSync(join(repoRoot, 'queue', 'inbox'), { recursive: true });
          writeFileSync(join(repoRoot, 'queue', 'inbox', `${cardId}.md`), '', 'utf8');
          return { stageId: stage.id, cardId, state: 'blocked', cardPath: `queue/inbox/${cardId}.md` };
        });
        return { exitCode: 0, stdout: `${JSON.stringify({ runId: op.runId, cards })}\n`, stderr: '' };
      },
      controlBroker: { isRunning: () => true, drain: () => {} } as never,
      // A spy async fn (invoked synchronously before its first await, so the call is recorded by the time
      // the 201 returns even though executeApprovedLaunch fires it un-awaited).
      runAutomatic: (async (arg: { runRef: string }) => { runAutomaticCalls.push(arg); return { ok: true }; }) as never,
    }));
    await activated.ready();

    const response = await activated.inject({
      method: 'POST', url: '/api/workflows/activated-research/launch', headers: headers(token),
      payload: await launchPayload(activated, 'activated-research', 'activated'),
    });
    await activated.close();

    expect(response.statusCode).toBe(201);
    const body = response.json() as { ok: boolean; runRef: string; cards: unknown[] };
    expect(body.ok).toBe(true);
    expect(body.cards).toHaveLength(1);
    expect(runAutomaticCalls).toHaveLength(1);
    expect(runAutomaticCalls[0].runRef).toBe(body.runRef);
  });
});

describe('workflow assignment amendment route', () => {
  let activeRoot: string;
  let durableRoot: string;
  let app: ReturnType<typeof Fastify>;
  let token: string;
  let gitCalls: string[][];
  let prCalls: Array<Record<string, unknown>>;
  let audits: Array<Record<string, unknown>>;

  const definitionText = (): string => [
    '---', 'id: amendable', 'project: kb-ops', 'title: Assigned research', 'profile: research',
    'manager:', '  agentId: assigned-manager', '  profileId: manager:claude:claude-opus-4-8',
    'stages:', '  - id: brief', '    title: Research a topic', '    action: research:web-brief',
    '    target: orgs/kb-ops/output', '    workOrder: research it', '    agentId: assigned-worker', '    profileId: worker:claude:claude-sonnet-5',
    '---', 'body', '',
  ].join('\n');
  function setup(overrides: { gitFailure?: 'commit'; prFailure?: boolean; auditFailure?: boolean } = {}): void {
    gitCalls = []; prCalls = []; audits = [];
    activeRoot = mkdtempSync(join(tmpdir(), 'kb-workflow-amend-active-'));
    durableRoot = mkdtempSync(join(tmpdir(), 'kb-workflow-amend-durable-'));
    for (const root of [activeRoot, durableRoot]) {
      for (const rel of ['governance', 'CLAUDE.md', join('orgs', 'kb-ops', 'contract.md')]) {
        const from = join(REPO_ROOT, rel);
        if (existsSync(from)) { mkdirSync(join(root, rel, '..'), { recursive: true }); cpSync(from, join(root, rel), { recursive: true }); }
      }
      const agents = join(root, 'agents'); mkdirSync(agents, { recursive: true });
      writeFileSync(join(agents, 'assigned-manager.md'), ['---', 'id: assigned-manager', 'runtime: claude', 'model: claude-opus-4-8', 'default-profile: manager:claude:claude-opus-4-8', 'allowed-profiles: [manager:claude:claude-opus-4-8]', 'projects: [kb-ops]', 'runner-bound: true', 'role: manager', '---', 'Manager.'].join('\n'));
      writeFileSync(join(agents, 'assigned-worker.md'), ['---', 'id: assigned-worker', 'runtime: claude', 'model: claude-sonnet-5', 'default-profile: worker:claude:claude-sonnet-5', 'allowed-profiles: [worker:claude:claude-sonnet-5]', 'projects: [kb-ops]', 'runner-bound: true', 'role: worker', '---', 'Worker.'].join('\n'));
      writeFileSync(join(agents, 'unbound-worker.md'), ['---', 'id: unbound-worker', 'runtime: claude', 'model: claude-sonnet-5', 'default-profile: worker:claude:claude-sonnet-5', 'allowed-profiles: [worker:claude:claude-sonnet-5]', 'projects: [kb-ops]', 'runner-bound: false', 'role: worker', '---', 'Unbound worker.'].join('\n'));
      const dir = join(root, 'orgs', 'kb-ops', 'workflows'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'amendable.md'), definitionText());
    }
    token = mintSession('operator', SESSION).token;
    app = Fastify();
    registerWorkflows(app, makeSurfaceContext({ repoRoot: activeRoot, durableRepoRoot: durableRoot, stateRoot: join(activeRoot, 'dashboard-state'), sessionConfig: SESSION, allowedOrigins: [ORIGIN], credentials: () => [], controlStore: createInMemoryControlPlaneStore(), ...runners(), assignmentAmendmentStore: createFileAssignmentAmendmentStore(join(activeRoot, 'dashboard-state')),
      saveGit: async (_root, args) => { gitCalls.push(args); if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'claude/m1-dashboard\n'; if (overrides.gitFailure === 'commit' && args[0] === 'commit') throw new Error('commit refused'); return ''; },
      openPr: async (_root, request) => { prCalls.push(request as unknown as Record<string, unknown>); if (overrides.prFailure) throw new Error('PR unavailable'); return { url: 'https://example.test/pull/9', number: 9 }; },
      appendAudit: (_root, event) => { if (overrides.auditFailure) throw new Error('audit unavailable'); audits.push(event as unknown as Record<string, unknown>); return { ts: 'now', ...event }; },
      appendAuditLocal: (_root, event) => { if (overrides.auditFailure) throw new Error('audit unavailable'); audits.push(event as unknown as Record<string, unknown>); return { ts: 'now', ...event }; },
    }));
  }
  async function amend(body: Record<string, unknown>): Promise<ReturnType<ReturnType<typeof Fastify>['inject']>> { return app.inject({ method: 'POST', url: '/api/workflows/amendable/assignment-amendments', headers: headers(token), payload: body }); }
  async function input(target: Record<string, unknown> = { kind: 'stage', stageId: 'brief' }, assignment: unknown = null): Promise<Record<string, unknown>> { const hash = (await app.inject({ method: 'GET', url: '/api/workflows/amendable' })).json().entry.sourceHash; return { expectedSourceHash: hash, target, assignment }; }

  beforeEach(async () => { setup(); await app.ready(); });
  afterEach(async () => { if (app) await app.close(); if (activeRoot) rmSync(activeRoot, { recursive: true, force: true }); if (durableRoot) rmSync(durableRoot, { recursive: true, force: true }); });

  it('patches exactly one assignment, routes its exact path through a PR, and audits pending human merge', async () => {
    const response = await amend(await input());
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ status: 'pending-human-merge', proposedSourceHash: expect.stringMatching(/^[a-f0-9]{64}$/), pr: { url: 'https://example.test/pull/9' } });
    expect(readFileSync(join(activeRoot, 'orgs/kb-ops/workflows/amendable.md'), 'utf8')).toBe(definitionText());
    expect(readFileSync(join(durableRoot, 'orgs/kb-ops/workflows/amendable.md'), 'utf8')).not.toContain('agentId: assigned-worker');
    expect(gitCalls).toEqual(expect.arrayContaining([['add', '--', 'orgs/kb-ops/workflows/amendable.md'], expect.arrayContaining(['commit']), ['push', 'origin', 'HEAD:refs/heads/claude/m1-dashboard']]));
    expect(prCalls).toHaveLength(1); expect(audits).toHaveLength(1); expect(audits[0].action).toBe('workflow-assignment-amendment');
  });

  it('refuses stale, durable-base-mismatch, and unbound compilation before git, PR, or audit', async () => {
    expect((await amend({ ...(await input()), expectedSourceHash: '0'.repeat(64) })).statusCode).toBe(409);
    writeFileSync(join(durableRoot, 'orgs/kb-ops/workflows/amendable.md'), definitionText().replace('Assigned research', 'different durable base'));
    expect((await amend(await input())).json()).toMatchObject({ error: 'durable-base-mismatch' });
    writeFileSync(join(durableRoot, 'orgs/kb-ops/workflows/amendable.md'), definitionText());
    const durableWorkflowDir = join(durableRoot, 'orgs/kb-ops/workflows');
    rmSync(durableWorkflowDir, { recursive: true }); symlinkSync(join(activeRoot, 'orgs/kb-ops/workflows'), durableWorkflowDir, 'junction');
    expect((await amend(await input())).json()).toMatchObject({ error: 'definition-path-refused' });
    rmSync(durableWorkflowDir, { recursive: true }); mkdirSync(durableWorkflowDir, { recursive: true }); writeFileSync(join(durableWorkflowDir, 'amendable.md'), definitionText());
    expect((await amend(await input({ kind: 'stage', stageId: 'brief' }, { agentId: 'unbound-worker', profileId: 'worker:claude:claude-sonnet-5' }))).statusCode).toBe(409);
    expect(gitCalls).toHaveLength(0); expect(prCalls).toHaveLength(0); expect(audits).toHaveLength(0);
  });

  it('restores bytes on pre-commit failure but reports post-commit PR failure without dirty restoration', async () => {
    await app.close(); setup({ gitFailure: 'commit' }); await app.ready();
    const original = readFileSync(join(durableRoot, 'orgs/kb-ops/workflows/amendable.md'), 'utf8');
    expect((await amend(await input())).statusCode).toBe(500);
    expect(readFileSync(join(durableRoot, 'orgs/kb-ops/workflows/amendable.md'), 'utf8')).toBe(original);
    await app.close(); setup({ prFailure: true }); await app.ready();
    const response = await amend(await input());
    expect(response.statusCode).toBe(502); expect(response.json()).toMatchObject({ error: 'assignment-durable-route-incomplete', committed: true, pushed: true });
    expect(readFileSync(join(durableRoot, 'orgs/kb-ops/workflows/amendable.md'), 'utf8')).not.toBe(definitionText());
  });

  it('returns a loud truthful audit failure with the pending durable branch and PR metadata', async () => {
    await app.close(); setup({ auditFailure: true }); await app.ready();
    const response = await amend(await input());
    expect(response.statusCode).toBe(500); expect(response.json()).toMatchObject({ status: 'pending-human-merge', auditStatus: 'failed', branch: 'claude/m1-dashboard', pr: { url: 'https://example.test/pull/9' }, proposedSourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
  });

  it('keeps a file-backed pending amendment across a new app instance and refuses a direct launch', async () => {
    const amended = await amend(await input()); expect(amended.statusCode).toBe(202);
    const list = (await app.inject({ method: 'GET', url: '/api/workflows' })).json();
    expect(list.items.find((item: { ref: string }) => item.ref === 'amendable').pendingAmendment).toMatchObject({ phase: 'pending-human-merge' });
    const sourceHash = (await app.inject({ method: 'GET', url: '/api/workflows/amendable' })).json().entry.sourceHash;
    const launch = await app.inject({ method: 'POST', url: '/api/workflows/amendable/launch', headers: headers(token), payload: { idempotencyKey: 'must-not-launch', expectedSourceHash: sourceHash, parameters: {} } });
    expect(launch.json()).toMatchObject({ error: 'assignment-amendment-pending' });
    expect(gitCalls.filter((call) => call[0] === 'add')).toHaveLength(1);
    await app.close(); app = Fastify();
    registerWorkflows(app, makeSurfaceContext({ repoRoot: activeRoot, durableRepoRoot: durableRoot, stateRoot: join(activeRoot, 'dashboard-state'), sessionConfig: SESSION, allowedOrigins: [ORIGIN], credentials: () => [], controlStore: createInMemoryControlPlaneStore(), ...runners(), assignmentAmendmentStore: createFileAssignmentAmendmentStore(join(activeRoot, 'dashboard-state')),
      saveGit: async (_root, args) => { gitCalls.push(args); return args.join(' ') === 'rev-parse --abbrev-ref HEAD' ? 'claude/m1-dashboard\n' : ''; },
      openPr: async (_root, request) => { prCalls.push(request as unknown as Record<string, unknown>); return { url: 'https://example.test/pull/9', number: 9 }; },
      appendAudit: (_root, event) => { audits.push(event as unknown as Record<string, unknown>); return { ts: 'now', ...event }; },
      appendAuditLocal: (_root, event) => { audits.push(event as unknown as Record<string, unknown>); return { ts: 'now', ...event }; },
    })); await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/workflows/amendable' })).json().entry.pendingAmendment).toMatchObject({ phase: 'pending-human-merge' });
  });

  it('refuses an aliased default durable root and assignment scalar injection before side effects', async () => {
    await app.close(); app = Fastify();
    registerWorkflows(app, makeSurfaceContext({ repoRoot: activeRoot, durableRepoRoot: activeRoot, stateRoot: join(activeRoot, 'dashboard-state-alias'), sessionConfig: SESSION, allowedOrigins: [ORIGIN], credentials: () => [], controlStore: createInMemoryControlPlaneStore(), ...runners(),
      saveGit: async (_root, args) => { gitCalls.push(args); return 'claude/m1-dashboard\n'; }, openPr: async (_root, request) => { prCalls.push(request as unknown as Record<string, unknown>); return { url: 'https://example.test/pull/9', number: 9 }; }, appendAudit: (_root, event) => { audits.push(event as unknown as Record<string, unknown>); return { ts: 'now', ...event }; }, appendAuditLocal: (_root, event) => { audits.push(event as unknown as Record<string, unknown>); return { ts: 'now', ...event }; },
    })); await app.ready();
    const original = readFileSync(join(activeRoot, 'orgs/kb-ops/workflows/amendable.md'), 'utf8');
    expect((await amend(await input())).json()).toMatchObject({ error: 'durable-worktree-required' });
    expect((await amend({ ...(await input()), assignment: { agentId: 'writer\n    riskTier: T3', profileId: 'worker:claude:claude-sonnet-5' } })).json()).toMatchObject({ error: 'invalid-assignment-amendment-body' });
    expect(readFileSync(join(activeRoot, 'orgs/kb-ops/workflows/amendable.md'), 'utf8')).toBe(original);
    expect(gitCalls).toHaveLength(0); expect(prCalls).toHaveLength(0); expect(audits).toHaveLength(0);
  });
});

/**
 * BLOCKER-1 regression (adversarial security review, 2026-09-16).
 *
 * THE DEFECT. `control/routes.ts#resolveRunWorkflowTags` decided whether a gate resolution needed a
 * signed approval by re-scanning the owning workflow definition FROM DISK at resolve time.
 * `POST /api/write/save` is `open` class and writes into exactly that tree, so the whole escalation
 * came apart over plain open-class HTTP with no signature, no window and no `X-KB-Actor`:
 *
 *   1. launch the publish-tagged workflow                            (open)
 *   2. `POST /api/write/save` the definition MINUS its publish marker — same id, same project, same
 *      path, still parses, still `valid`, so the fail-closed arm never fires                 (open)
 *   3. resolve the parked gate with no `approval`                    → 200, and the audit row said
 *      `workflowTags: []`, `signedRequired: false`
 *   4. `save` the original content back
 *
 * THE FIX, pinned here: the tag set is derived ONCE AT LAUNCH and persisted on the run
 * (`Run.workflowTags`), and the rule reads only what is stored. The first test is the reviewer's own
 * probe — proof that the DISK value really does flip, so the exploit's premise still holds — and the
 * second is the end-to-end proof that flipping it no longer changes what the respond route demands.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveOwnerTags } from '../control/ownerTags.ts';
import { scanWorkflowDefs } from '../workflows/routes.ts';
import { readDeclaredAgentDetails } from '../agents/roster.ts';
import { createInMemoryControlPlaneStore } from '../control/store.ts';
import type { ControlPlaneStore } from '../control/storeTypes.ts';
import type { RunnableRef } from '../control/p2Contracts.ts';
import type { JsonObject } from '../control/types.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import type { PlanProposal } from '../control/proposal.ts';

const SESSION: SessionConfig = { secret: Buffer.from('run-tag-pinning-test-secret-0001'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';
const REAL_REPO_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const TEST_ALLOWED_SIGNERS = '/test/kb-ops-approver.allowed-signers';
const stubSshsigVerifier = { verify: async () => true };

/** `self-lint-report` is a REAL definition in this repo, so the launch route can resolve the run's
 *  workflow owner from the real checkout while the TAG derivation reads the throwaway repo below. */
const WORKFLOW_ID = 'self-lint-report';
const OWNER: RunnableRef = {
  type: 'workflow', id: WORKFLOW_ID, project: 'kb-ops',
  sourcePath: `orgs/kb-ops/workflows/${WORKFLOW_ID}.md`,
};

const proposal: PlanProposal = {
  schema: 'kb.plan-proposal/v1', proposalId: 'tag-pinning', project: 'kb-ops', title: 'Tag pinning',
  summary: 'Prove the governing tag set is pinned at launch.',
  manager: { runtime: 'claude', model: 'claude-opus-5', requiredSkills: [] },
  scope: { read: ['dashboard'], write: ['dashboard'] },
  governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
  stages: [{
    id: 'verify', title: 'Verify', action: 'test:tag-pinning', target: 'dashboard/server/control',
    workOrder: 'Run the focused tag-pinning tests.', riskTier: 'T2', dependsOn: [],
    worker: { runtime: 'codex', model: 'gpt-5.6-sol' }, requiredSkills: [],
    scope: { read: ['dashboard'], write: ['dashboard/server/control'] }, artifacts: [], checkpoints: [], humanGates: [],
  }],
};

/** A parseable definition for `orgs/kb-ops/workflows/self-lint-report.md`, with or without its
 *  publication gate. Both shapes keep the same id/project/path and both are VALID — which is exactly
 *  why the disk re-scan never took its fail-closed arm. */
function definition(withPublicationGate: boolean): string {
  const gate = withPublicationGate
    ? [
      '    humanGates:',
      '      - id: g-publish',
      '        kind: approval',
      '        prompt: Approve the private upload.',
      '        publicationAuthorization: true',
    ]
    : [];
  return [
    '---',
    `id: ${WORKFLOW_ID}`,
    'project: kb-ops',
    'title: Self lint report',
    'profile: scanner',
    'stages:',
    '  - id: report',
    '    title: Scan the repo and write a read-only report',
    '    action: report:self-lint',
    '    target: orgs/kb-ops/output',
    '    riskTier: T1',
    ...gate,
    '---',
    '',
    'The full work order lives in the body.',
    '',
  ].join('\n');
}

function writeDefinition(root: string, withPublicationGate: boolean): void {
  const dir = join(root, 'orgs', 'kb-ops', 'workflows');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${WORKFLOW_ID}.md`), definition(withPublicationGate));
}

/** The PRODUCTION derivation, bound over a throwaway repo this test owns. Identical composition to
 *  `http/surface.ts#makeSurfaceContext`'s default binding. */
function ownerTagsOver(root: string): (owner: RunnableRef) => string[] {
  return (owner) => deriveOwnerTags(owner, {
    workflowDefs: () => scanWorkflowDefs(root),
    agentDeclarations: () => readDeclaredAgentDetails(root),
  });
}

const temps: string[] = [];
const apps: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function tempRepo(withPublicationGate: boolean): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-tag-pin-'));
  temps.push(root);
  writeDefinition(root, withPublicationGate);
  return root;
}

function headers(token: string) {
  return { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}`, 'content-type': 'application/json' };
}

function signedApproval(route: string, entityRef: string, now = Date.now()) {
  const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');
  return {
    payload: JSON.stringify({
      schema: 'kb.human-approval/v1', route, entityRef, actor: 'daniel',
      issuedAt: iso(now), expiresAt: iso(now + 600_000), nonce: 'b'.repeat(32),
    }),
    signature: 'sig',
  };
}

function surface(store: ControlPlaneStore, ownerTags: (owner: RunnableRef) => string[]) {
  const audit: Array<Record<string, unknown>> = [];
  const capture = (_root: string, event: Record<string, unknown>) => {
    audit.push(event);
    return { ts: '2026-09-16T00:00:00.000Z', ...event };
  };
  const app = Fastify();
  apps.push(app);
  registerWriteSurface(app, makeSurfaceContext({
    repoRoot: REAL_REPO_ROOT,
    sessionConfig: SESSION,
    allowedOrigins: [ORIGIN],
    controlStore: store,
    ownerTags,
    appendAudit: capture,
    appendAuditLocal: capture,
    humanApproverAllowedSigners: TEST_ALLOWED_SIGNERS,
    sshsigVerifier: stubSshsigVerifier,
    approvalNonces: { claim: () => 'fresh' as const },
    runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' }),
    opsGit: (_root: string, args: string[]) => {
      if (args.join(' ') === 'rev-parse --abbrev-ref HEAD') return 'ops\n';
      if (args.join(' ') === 'rev-parse HEAD') return `${'a'.repeat(40)}\n`;
      return '';
    },
    runPy: (_root: string, _code: string, jsonArg: string) => {
      const payload = JSON.parse(jsonArg) as {
        runId?: string; managed?: boolean; stages?: Array<{ id: string; dependsOn: string[] }>;
      };
      return {
        exitCode: 0, stderr: '', stdout: JSON.stringify({
          runId: payload.runId,
          cards: (payload.stages ?? []).map((stage) => {
            const cardId = workflowCardId(String(payload.runId), stage.id);
            const state = payload.managed || stage.dependsOn.length ? 'blocked' : 'inbox';
            return { stageId: stage.id, cardId, state, cardPath: `queue/${state === 'blocked' ? 'inbox' : state}/${cardId}.md` };
          }),
        }),
      };
    },
  } as never));
  return { app, audit, token: mintSession('operator', SESSION).token };
}

async function launchRun(
  app: FastifyInstance, store: ControlPlaneStore, token: string,
): Promise<string> {
  const created = store.createProposalRevision('operator', {
    sourceComposerRef: 'workflow-registry', sourceTurnId: WORKFLOW_ID, title: proposal.title,
    snapshot: proposal as unknown as JsonObject,
  });
  if (!created.ok) throw new Error(created.detail);
  const approved = store.decideProposal('operator', created.value.proposalRef, 1, {
    expectedHash: created.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'tag-pin-approve',
  });
  if (!approved.ok) throw new Error(approved.detail);
  const launched = await app.inject({
    method: 'POST',
    url: `/api/control/proposals/${created.value.proposalRef}/revisions/1/launch`,
    headers: headers(token),
    payload: { expectedHash: created.value.hash, idempotencyKey: 'tag-pin-launch' },
  });
  if (launched.statusCode !== 202) throw new Error(`launch failed: ${launched.statusCode} ${launched.body}`);
  return launched.json().runRef as string;
}

describe('the reviewer probe: the DISK tag set really does flip under a rewrite', () => {
  it('flips publish -> untagged with the definition still valid, same id/project/path', () => {
    const root = tempRepo(true);
    const derive = ownerTagsOver(root);
    expect(derive(OWNER)).toEqual(['publish']);
    const before = scanWorkflowDefs(root).find((item) => item.def?.id === WORKFLOW_ID);
    expect(before?.entry.valid).toBe(true);

    writeDefinition(root, false);

    const after = scanWorkflowDefs(root).find((item) => item.def?.id === WORKFLOW_ID);
    // Still valid, still the same definition by every key the owner match uses — which is precisely
    // why the old fail-closed `WORKFLOW_TAGS_UNRESOLVABLE` arm never fired on this rewrite.
    expect(after?.entry.valid).toBe(true);
    expect(after?.entry.path).toBe(before?.entry.path);
    expect(derive(OWNER)).toEqual([]);
  });

  it('fails closed when the owner cannot be pinned to a valid definition at all', () => {
    const root = tempRepo(true);
    expect(ownerTagsOver(root)({ ...OWNER, id: 'no-such-workflow' })).toEqual(['publish', 'spend']);
  });
});

describe('the governing tag set is pinned on the run at launch, not re-read at resolve', () => {
  it('still refuses an unsigned gate resolution after the definition is rewritten to drop publish', async () => {
    const root = tempRepo(true);
    const store = createInMemoryControlPlaneStore();
    const { app, audit, token } = surface(store, ownerTagsOver(root));
    const runRef = await launchRun(app, store, token);

    // Pinned at launch, on the run record itself.
    const launched = store.getRun('operator', runRef);
    expect(launched.ok && launched.value.run.workflowTags).toEqual(['publish']);

    const request = store.createHumanRequest('operator', runRef, {
      kind: 'approval', title: 'Approve the publish', prompt: 'Approve the private upload.',
    });
    if (!request.ok) throw new Error(request.detail);

    // STEP 3 OF THE EXPLOIT: rewrite the definition through the tree an `open`-class save can reach.
    writeDefinition(root, false);
    expect(ownerTagsOver(root)(OWNER)).toEqual([]);

    const unsigned = await app.inject({
      method: 'POST', url: `/api/control/human-requests/${request.value.requestRef}/respond`,
      headers: headers(token),
      payload: {
        expectedRevision: request.value.revision, decision: 'approved',
        idempotencyKey: 'laundered-approve', reason: 'the definition says it is not a publish gate',
      },
    });
    expect(unsigned.statusCode, unsigned.body).toBe(403);
    expect(unsigned.json()).toEqual({ error: 'approval-required' });
    // Nothing resolved, and no `authorized:` row was laundered into the ledger.
    expect(store.getHumanRequest('operator', request.value.requestRef)).toMatchObject({
      ok: true, value: { state: 'open', response: null },
    });
    expect(audit.filter((row) => row.action === 'control-human-response-authorize')).toEqual([]);
    // The run still carries what it was launched with; the rewrite reached nothing.
    const after = store.getRun('operator', runRef);
    expect(after.ok && after.value.run.workflowTags).toEqual(['publish']);
  });

  it('records the STORED tag set on the authorize row when the signed approval is supplied', async () => {
    const root = tempRepo(true);
    const store = createInMemoryControlPlaneStore();
    const { app, audit, token } = surface(store, ownerTagsOver(root));
    const runRef = await launchRun(app, store, token);
    const request = store.createHumanRequest('operator', runRef, {
      kind: 'approval', title: 'Approve the publish', prompt: 'Approve the private upload.',
    });
    if (!request.ok) throw new Error(request.detail);

    writeDefinition(root, false);

    const signed = await app.inject({
      method: 'POST', url: `/api/control/human-requests/${request.value.requestRef}/respond`,
      headers: headers(token),
      payload: {
        expectedRevision: request.value.revision, decision: 'approved', idempotencyKey: 'signed-approve',
        reason: 'Daniel approved the private upload',
        approval: signedApproval(
          'POST /api/control/human-requests/:requestRef/respond', request.value.requestRef,
        ),
      },
    });
    expect(signed.statusCode, signed.body).toBe(200);
    const row = audit.find((item) => item.action === 'control-human-response-authorize');
    expect(row).toBeDefined();
    // The row states what GOVERNED the decision — the pinned set — never what the file says now.
    expect((row as { detail: Record<string, unknown> }).detail).toMatchObject({
      workflowTags: ['publish'], signedRequired: true,
    });
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '../audit/log.ts';
import {
  createHumanResponseService, deployDigest, iterationGateDigest, iterationGateT3Preimage,
  type HumanResponseStorePort, type IterationGateT3Preimage,
} from './humanResponse.ts';
import type { HumanRequest } from './types.ts';
import type { RespondHumanRequestInput } from './store.ts';
import { deployT3Digest } from '../deploy/contracts.ts';
import type { DeployT3Preimage } from '../deploy/contracts.ts';

function request(overrides: Partial<HumanRequest> = {}): HumanRequest {
  return {
    requestRef: 'ask-1', runRef: 'run-1', stageRef: null, kind: 'input', revision: 1,
    state: 'open', title: 'Need input', prompt: 'Choose', response: null,
    createdAt: '2026-08-21T00:00:00.000Z', updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

function harness(
  initial: HumanRequest[],
  reserved = new Set<string>(),
  faults: { append?: number; resume?: number } = {},
) {
  const requests = new Map(initial.map((item) => [item.requestRef, structuredClone(item)]));
  const events: string[] = [];
  const eventKeys = new Set<string>();
  const resumes: string[] = [];
  const resumedRuns = new Set<string>();
  let appendFaults = faults.append ?? 0;
  let resumeFaults = faults.resume ?? 0;
  const audits: AuditEvent[] = [];
  let lastRespondInput: RespondHumanRequestInput | undefined;
  const store: HumanResponseStorePort = {
    getHumanRequest: async (_actor, requestRef) => {
      const found = requests.get(requestRef);
      return found ? { request: found, runOwnerSubject: `owner:${found.runRef}` } : null;
    },
    isReservedIterationGate: async (_actor, requestRef) => reserved.has(requestRef),
    respondHumanRequest: async (actor, requestRef, input) => {
      lastRespondInput = input;
      const current = requests.get(requestRef)!;
      if (current.response) return { request: current, replayed: current.response.idempotencyKey === input.idempotencyKey };
      const responded = {
        ...current, state: 'resolved' as const, revision: current.revision + 1,
        response: {
          requestRevision: current.revision, decision: input.decision, respondedBy: actor,
          idempotencyKey: input.idempotencyKey, response: input.response ?? null,
          respondedAt: '2026-08-21T00:01:00.000Z',
          resolvedBy: input.resolvedBy ?? null,
        },
      };
      requests.set(requestRef, responded);
      return { request: responded, replayed: false };
    },
    listHumanRequestsForRun: async (_actor, runRef) => [...requests.values()].filter((item) => item.runRef === runRef),
    appendResponseEvent: async (_actor, item) => {
      if (appendFaults > 0) {
        appendFaults -= 1;
        throw new Error('event append unavailable');
      }
      const key = `${item.requestRef}:${item.response?.idempotencyKey ?? ''}`;
      if (!eventKeys.has(key)) {
        eventKeys.add(key);
        events.push(item.requestRef);
      }
    },
    resumeRunAfterBoundaryAccepted: async (_actor, runRef) => {
      if (resumeFaults > 0) {
        resumeFaults -= 1;
        throw new Error('resume unavailable');
      }
      if (!resumedRuns.has(runRef)) {
        resumedRuns.add(runRef);
        resumes.push(runRef);
      }
    },
  };
  return {
    requests, events, resumes, audits, store,
    audit: { append: async (row: AuditEvent) => { audits.push(row); } },
    get lastRespondInput() { return lastRespondInput; },
  };
}

const ordinaryInput = {
  actor: { kind: 'operator' as const, subject: 'operator' }, requestRef: 'ask-1',
  expectedRevision: 1, decision: 'responded' as const, idempotencyKey: 'respond-1',
  response: 'continue', origin: 'https://dashboard.test',
  reason: 'looks correct', actorLabel: 'daniel' as const,
};

/** T5 [design:4.4/4.5]: the default `workflowTags` port for scenarios that don't care about escalation —
 *  every run governs no tags, so `respond()` never reaches the signed-approval check. */
const NO_TAGS = () => new Set<string>();

/** A reason made only of whitespace: non-empty as a string, empty after trim. */
const WHITESPACE_ONLY = '\t \n ';

describe('gate-kind-aware human response service', () => {
  it('returns direct generic 409 iteration-gate-reserved before audit or mutation', async () => {
    const h = harness([request({ gateKind: 'iteration-park' })], new Set(['ask-1']));
    const result = await createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS }).respond(ordinaryInput);
    expect(result).toMatchObject({ ok: false, status: 409, error: 'iteration-gate-reserved' });
    expect(h.audits).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('allows a minted intervention even when it carries reserved iteration lineage', async () => {
    const h = harness([request({ kind: 'intervention', gateKind: 'iteration-park' })], new Set(['ask-1']));
    const result = await createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS }).respond(ordinaryInput);
    expect(result).toMatchObject({ ok: true, replayed: false });
    expect(h.audits).toHaveLength(1);
    expect(h.events).toEqual(['ask-1']);
  });

  it('proceeds on the open class for a T3-kind decision on an untagged run (no approval), and still stamps riskTier T3 + responseDigest/origin', async () => {
    const h = harness([request({ kind: 'approval' })]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
    const input = { ...ordinaryInput, decision: 'approved' as const };

    const first = await service.respond(input);
    const replay = await service.respond(input);

    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'control-human-response-authorize',
      riskTier: 'T3',
      detail: {
        runOwnerSubject: 'owner:run-1', signedRequired: false, workflowTags: [],
        responseDigest: expect.stringMatching(/^[a-f0-9]{64}$/), origin: 'https://dashboard.test',
      },
    });
    expect(h.events).toEqual(['ask-1']);
    expect(h.resumes).toEqual(['run-1']);
  });

  it('a non-T3 (input) kind stamps riskTier T2 and carries no responseDigest/origin in the detail', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
    await service.respond(ordinaryInput);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({ riskTier: 'T2' });
    expect(h.audits[0]!.detail).not.toHaveProperty('responseDigest');
    expect(h.audits[0]!.detail).not.toHaveProperty('origin');
  });

  it('emits once per fresh response but resumes only after the last of two requests', async () => {
    const h = harness([request(), request({ requestRef: 'ask-2', kind: 'intervention', title: 'Second' })]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
    await service.respond(ordinaryInput);
    expect(h.events).toEqual(['ask-1']);
    expect(h.resumes).toEqual([]);
    await service.respond({ ...ordinaryInput, requestRef: 'ask-2', idempotencyKey: 'respond-2' });
    expect(h.events).toEqual(['ask-1', 'ask-2']);
    expect(h.resumes).toEqual(['run-1']);
  });

  it('repairs a committed answer when event append fails, without emitting twice', async () => {
    const h = harness([request()], new Set(), { append: 1 });
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });

    await expect(service.respond(ordinaryInput)).rejects.toThrow('event append unavailable');
    expect(h.requests.get('ask-1')?.response?.idempotencyKey).toBe('respond-1');
    expect(h.events).toEqual([]);

    await expect(service.respond(ordinaryInput)).resolves.toMatchObject({ ok: true, replayed: true });
    await expect(service.respond(ordinaryInput)).resolves.toMatchObject({ ok: true, replayed: true });
    expect(h.events).toEqual(['ask-1']);
    expect(h.resumes).toEqual(['run-1']);
  });

  it('repairs a committed answer when resume fails, without appending a second event', async () => {
    const h = harness([request()], new Set(), { resume: 1 });
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });

    await expect(service.respond(ordinaryInput)).rejects.toThrow('resume unavailable');
    expect(h.events).toEqual(['ask-1']);
    expect(h.resumes).toEqual([]);

    await expect(service.respond(ordinaryInput)).resolves.toMatchObject({ ok: true, replayed: true });
    expect(h.events).toEqual(['ask-1']);
    expect(h.resumes).toEqual(['run-1']);
  });

  it('refuses stale revisions and host identities before audit', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
    await expect(service.respond({ ...ordinaryInput, expectedRevision: 0 })).resolves.toEqual({
      ok: false, status: 409, error: 'request-revision-changed',
    });
    await expect(service.respond({ ...ordinaryInput, actor: { kind: 'host', subject: 'desktop-node' } })).resolves.toEqual({
      ok: false, status: 403, error: 'host-human-response-refused',
    });
    expect(h.audits).toEqual([]);
  });

  it('does not mutate when the required audit write fails', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({
      store: h.store,
      audit: { append: async () => { throw new Error('audit unavailable'); } },
      workflowTags: NO_TAGS,
    });
    const result = await service.respond(ordinaryInput);
    expect(result).toEqual({ ok: false, status: 500, error: 'human-response-audit-required' });
    expect(h.requests.get('ask-1')?.state).toBe('open');
    expect(h.events).toEqual([]);
  });
});

// =====================================================================================================
// T5 [design:4.4/4.5] — the boss-intervention rule: an untagged run's decision proceeds on the open
// class; a run whose `effectiveWorkflowTags` include `publish` or `spend` requires a valid signed
// approval, whatever actor is deciding — `daniel` included. `vi.fn()` mocks below replace the removed
// ceremony port the tests above used to exercise; this is what took its place in `respond()`.
// =====================================================================================================
describe('workflow-tag escalation (T5)', () => {
  it('resolves an untagged run with no approval', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
    const result = await service.respond(ordinaryInput);
    expect(result).toMatchObject({ ok: true });
  });

  it('refuses a publish-tagged run with no approval, and LEAVES A REFUSAL ROW', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({
      store: h.store, audit: h.audit,
      workflowTags: () => new Set(['publish']),
      verifyApproval: async () => ({ ok: false, status: 403, error: 'approval-invalid' }),
      escalationBinding: { route: 'POST /api/control/human-requests/:requestRef/respond', entityRef: 'ask-1' },
    });
    const result = await service.respond(ordinaryInput);
    expect(result).toMatchObject({ ok: false, status: 403, error: 'approval-required' });
    // Rehearsal finding (2026-09-16): this refusal used to write NOTHING, while every `signed`-CLASS
    // route's refusal wrote an `authority-approval-refused` row. The one channel the design exists to
    // protect was the one channel with no refusal trail.
    expect(h.audits.filter((row) => row.action === 'control-human-response-authorize')).toEqual([]);
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'authority-approval-refused', result: 'approval-required', riskTier: 'T3',
      owner: 'operator', target: 'ask-1', actor: 'daniel',
      detail: {
        route: 'POST /api/control/human-requests/:requestRef/respond', entityRef: 'ask-1',
        runRef: 'run-1', workflowTags: ['publish'], reason: 'signed-approval-required',
      },
    });
  });

  it('records the actor and the STORED tags on the refusal row, whatever the actor claims', async () => {
    for (const actorLabel of ['daniel', 'boss', 'worker:x', 'unknown'] as const) {
      const h = harness([request()]);
      await createHumanResponseService({
        store: h.store, audit: h.audit, workflowTags: () => new Set(['publish', 'spend']),
        escalationBinding: { route: 'POST /api/control/human-requests/:requestRef/respond', entityRef: 'ask-1' },
      }).respond({ ...ordinaryInput, actorLabel });
      expect(h.audits).toHaveLength(1);
      expect(h.audits[0]).toMatchObject({
        action: 'authority-approval-refused', result: 'approval-unavailable', actor: actorLabel,
        detail: { workflowTags: ['publish', 'spend'], reason: 'signed-approval-required' },
      });
    }
  });

  it('still refuses when the refusal row itself cannot be written — an audit fault never admits', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({
      store: h.store,
      audit: { append: async () => { throw new Error('audit unavailable'); } },
      workflowTags: () => new Set(['publish']),
    });
    const result = await service.respond(ordinaryInput);
    expect(result).toMatchObject({ ok: false, status: 503, error: 'approval-unavailable' });
  });

  it('refuses a spend-tagged run with no approval', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({
      store: h.store, audit: h.audit,
      workflowTags: () => new Set(['spend']),
      verifyApproval: async () => ({ ok: false, status: 403, error: 'approval-invalid' }),
    });
    const result = await service.respond(ordinaryInput);
    expect(result).toMatchObject({ ok: false, status: 403, error: 'approval-required' });
  });

  it('refuses a tagged run with 503 approval-unavailable when no verifier is wired', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: () => new Set(['publish']) });
    const result = await service.respond(ordinaryInput);
    expect(result).toMatchObject({ ok: false, status: 503, error: 'approval-unavailable' });
    expect(h.audits.map((row) => row.action)).toEqual(['authority-approval-refused']);
  });

  it('accepts a tagged run with a valid approval', async () => {
    const h = harness([request()]);
    const verifyApproval = vi.fn().mockResolvedValue({ ok: true });
    const service = createHumanResponseService({
      store: h.store, audit: h.audit, workflowTags: () => new Set(['publish']), verifyApproval,
    });
    const result = await service.respond({ ...ordinaryInput, approval: { payload: 'p', signature: 's' } });
    expect(result).toMatchObject({ ok: true });
    expect(verifyApproval).toHaveBeenCalledWith({ payload: 'p', signature: 's' });
    expect(h.audits[0]).toMatchObject({ detail: { signedRequired: true, workflowTags: ['publish'] } });
  });

  it('passes a verifier refusal through verbatim', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({
      store: h.store, audit: h.audit, workflowTags: () => new Set(['publish']),
      verifyApproval: async () => ({ ok: false, status: 409, error: 'approval-replayed' }),
    });
    const result = await service.respond({ ...ordinaryInput, approval: {} });
    expect(result).toMatchObject({ ok: false, status: 409, error: 'approval-replayed' });
    // The verifier's own refusal code rides the row verbatim, so a replayed approval is distinguishable
    // from a missing one in the ledger.
    expect(h.audits.map((row) => [row.action, row.result]))
      .toEqual([['authority-approval-refused', 'approval-replayed']]);
  });

  it('ignores the actor label when deciding — daniel included, with NO reason in the body', async () => {
    // HIGH-2: the predecessor passed `ordinaryInput`, which already carries `reason: 'looks correct'`,
    // so the reason rule never fired inside the loop and the test could not have caught HIGH-1. With no
    // reason at all, every actor must now get the SAME status — and it is the reason refusal, because
    // that wall runs before the escalation check.
    for (const actorLabel of ['daniel', 'boss', 'worker:x', 'unknown'] as const) {
      const h = harness([request()]);
      const result = await createHumanResponseService({
        store: h.store, audit: h.audit, workflowTags: () => new Set(['publish']),
      }).respond({ ...ordinaryInput, actorLabel, reason: '' });
      expect(result).toMatchObject({ ok: false, status: 400, error: 'reason-required' });
    }
    // And with a reason supplied, every actor still gets the same (escalation) status.
    for (const actorLabel of ['daniel', 'boss', 'worker:x', 'unknown'] as const) {
      const h = harness([request()]);
      const result = await createHumanResponseService({
        store: h.store, audit: h.audit, workflowTags: () => new Set(['publish']),
      }).respond({ ...ordinaryInput, actorLabel });
      expect(result).toMatchObject({ ok: false, status: 503, error: 'approval-unavailable' });
    }
  });

  it('a workflowTags rejection (e.g. an unresolvable workflow) never downgrades to open', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({
      store: h.store, audit: h.audit,
      // Production binds an unresolvable workflow to {'publish','spend'} — fail closed (spec §4.5).
      workflowTags: () => new Set(['publish', 'spend']),
      verifyApproval: async () => ({ ok: false, status: 403, error: 'approval-invalid' }),
    });
    const result = await service.respond(ordinaryInput);
    expect(result).toMatchObject({ ok: false, status: 403, error: 'approval-required' });
  });
});

// =====================================================================================================
// T4 [design:4.3/4.5] — `reason` + `resolvedBy`. `reason` is required (non-empty after trim, <=2000
// chars) from EVERY actor: `boss`, `worker:<id>`, `daniel`, and `unknown` (which is what an absent,
// misspelled, or duplicated `X-KB-Actor` header parses to). Security review HIGH-1: making the rule
// conditional on a self-asserted header made it opt-in by the party it constrains.
// =====================================================================================================
describe('reason + resolvedBy (T4)', () => {
  it('refuses a CLI-actor response with no reason', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
    const result = await service.respond({ ...ordinaryInput, actorLabel: 'boss', reason: '   ' });
    expect(result).toMatchObject({ ok: false, status: 400, error: 'reason-required' });
    expect(h.audits).toEqual([]);
  });

  it('refuses a worker actor with an absent reason', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
    const result = await service.respond({ ...ordinaryInput, actorLabel: 'worker:sonnet-01', reason: '' });
    expect(result).toMatchObject({ ok: false, status: 400, error: 'reason-required' });
  });

  it('requires a reason from daniel and from an unknown actor too — the header cannot buy an exemption', async () => {
    // HIGH-1. This test PINNED THE DEVIATION before: it asserted `{ok: true}` for an empty reason from
    // `daniel`/`unknown`, so a worker that simply omitted `X-KB-Actor` (parsing to `unknown`) resolved
    // any gate with no justification at all. The one field the design added for unattended
    // accountability was opt-in by the party it constrains.
    for (const actorLabel of ['daniel', 'unknown'] as const) {
      for (const reason of ['', '   ', WHITESPACE_ONLY] as const) {
        const h = harness([request()]);
        const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
        const result = await service.respond({ ...ordinaryInput, actorLabel, reason });
        expect(result).toMatchObject({ ok: false, status: 400, error: 'reason-required' });
        expect(h.audits).toEqual([]);
      }
    }
  });

  it('refuses a reason that is not a string, or one over the 2000-char bound, from any actor', async () => {
    for (const actorLabel of ['daniel', 'boss', 'worker:x', 'unknown'] as const) {
      for (const reason of [undefined, null, 42, { text: 'ok' }, 'x'.repeat(2001)] as unknown[]) {
        const h = harness([request()]);
        const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
        const result = await service.respond({ ...ordinaryInput, actorLabel, reason: reason as string });
        expect(result).toMatchObject({ ok: false, status: 400, error: 'reason-required' });
      }
    }
  });

  it('records resolvedBy on the resolved request', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
    const result = await service.respond({ ...ordinaryInput, reason: 'sources look right', actorLabel: 'boss' });
    expect(result.ok).toBe(true);
    expect(h.lastRespondInput?.resolvedBy).toEqual({
      actor: 'boss', tailnetIdentity: null, at: expect.any(String), reason: 'sources look right',
    });
  });

  it('stamps reason + actor onto the audit row detail', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit, workflowTags: NO_TAGS });
    await service.respond({ ...ordinaryInput, reason: 'sources look right', actorLabel: 'boss' });
    expect(h.audits[0]).toMatchObject({ detail: { reason: 'sources look right', actor: 'boss' } });
  });
});

// =====================================================================================================
// P5 W2 — deploy-purpose digest [P5-C20, §3.3]. T2 removed the ceremony that used to verify an
// assertion over this binding; the digest itself remains a canonical, still-used audit primitive.
// =====================================================================================================

const PREIMAGE: DeployT3Preimage = {
  subject: 'deployment',
  ref: 'deploy-ready:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  revision: 'deploy-ready:0365e0f62588dd65f972717fb13fba2ee2fd35b7a0e68e09208313e9a4601e2e',
  decision: 'deploy',
  digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
};

describe('deploy-purpose digest', () => {
  it('digest is the server-side sha256 of the closed binding preimage', () => {
    expect(deployDigest(PREIMAGE)).toBe(deployT3Digest(PREIMAGE));
  });

  it('digest changes when any field of the preimage changes', () => {
    const base = deployDigest(PREIMAGE);
    const mutations: DeployT3Preimage[] = [
      { ...PREIMAGE, ref: 'deploy-ready:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' },
      { ...PREIMAGE, revision: 'deployment:1' },
      { ...PREIMAGE, decision: 'confirm' },
      { ...PREIMAGE, digest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' },
    ];
    for (const mutated of mutations) expect(deployDigest(mutated)).not.toBe(base);
  });
});

/**
 * F3 [baseline-A §3, item 4b] — the iteration-gate purpose's digest. T2 removed the ceremony
 * that used to verify a signature over this binding (`resolveIterationGateRoute` still writes the
 * `riskTier: 'T3'` audit row); the preimage/digest remain the canonical, order-stable encoding of the
 * exact tuple the route CASes.
 */
describe('F3 iteration-gate T3 digest', () => {
  const PREIMAGE: IterationGateT3Preimage = {
    requestRef: 'gate-1', requestRevision: 3, gateRef: 'gate-1', gateKind: 'iteration-park',
    parkReason: 'no-progress', iterationLoopRef: 'loop-1', loopVersion: 7, receiptRef: 'receipt-1',
    receiptVersion: 2, generationRefs: ['generation-a', 'generation-b'], decision: 'approved',
    origin: 'http://localhost:5317', challengeExpiresAt: '2026-08-24T10:05:00.000Z',
  };

  it('is order-stable and binds every field of the CASed tuple', () => {
    const digest = iterationGateDigest(PREIMAGE);
    expect(digest).toEqual(iterationGateDigest({ ...PREIMAGE }));
    const mutations: IterationGateT3Preimage[] = [
      { ...PREIMAGE, requestRef: 'gate-2' },
      { ...PREIMAGE, requestRevision: 4 },
      { ...PREIMAGE, gateRef: 'gate-2' },
      { ...PREIMAGE, gateKind: null },
      { ...PREIMAGE, parkReason: 'exhausted' },
      { ...PREIMAGE, iterationLoopRef: 'loop-2' },
      { ...PREIMAGE, loopVersion: 8 },
      { ...PREIMAGE, receiptRef: null },
      { ...PREIMAGE, receiptVersion: 3 },
      { ...PREIMAGE, generationRefs: ['generation-b', 'generation-a'] },
      { ...PREIMAGE, generationRefs: ['generation-a'] },
      { ...PREIMAGE, generationRefs: [...PREIMAGE.generationRefs, 'generation-c'] },
      { ...PREIMAGE, decision: 'declined' },
      { ...PREIMAGE, origin: 'http://evil.localhost:5317' },
      { ...PREIMAGE, challengeExpiresAt: '2026-08-24T10:06:00.000Z' },
    ];
    for (const mutated of mutations) expect(iterationGateDigest(mutated)).not.toEqual(digest);
  });

  it('the preimage encoding is deterministic JSON, not dependent on caller key order', () => {
    expect(iterationGateT3Preimage(PREIMAGE)).toEqual(iterationGateT3Preimage({ ...PREIMAGE }));
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { AuditEvent } from '../audit/log.ts';
import { createHumanResponseService, type HumanResponseStorePort } from './humanResponse.ts';
import type { HumanRequest } from './types.ts';
import {
  createDeployCeremonyService, deployChallenge, deployDigest,
  type DeployCeremonyContext, type DeployCeremonyRequest,
} from './humanResponse.ts';
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
  const store: HumanResponseStorePort = {
    getHumanRequest: async (_actor, requestRef) => {
      const found = requests.get(requestRef);
      return found ? { request: found, runOwnerSubject: `owner:${found.runRef}` } : null;
    },
    isReservedIterationGate: async (_actor, requestRef) => reserved.has(requestRef),
    respondHumanRequest: async (actor, requestRef, input) => {
      const current = requests.get(requestRef)!;
      if (current.response) return { request: current, replayed: current.response.idempotencyKey === input.idempotencyKey };
      const responded = {
        ...current, state: 'resolved' as const, revision: current.revision + 1,
        response: {
          requestRevision: current.revision, decision: input.decision, respondedBy: actor,
          idempotencyKey: input.idempotencyKey, response: input.response ?? null,
          respondedAt: '2026-08-21T00:01:00.000Z',
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
  };
}

const ordinaryInput = {
  actor: { kind: 'operator' as const, subject: 'operator' }, requestRef: 'ask-1',
  expectedRevision: 1, decision: 'responded' as const, idempotencyKey: 'respond-1',
  response: 'continue', origin: 'https://dashboard.test',
};

describe('gate-kind-aware human response service', () => {
  it('returns direct generic 409 iteration-gate-reserved before audit or mutation', async () => {
    const h = harness([request({ gateKind: 'iteration-park' })], new Set(['ask-1']));
    const result = await createHumanResponseService({ store: h.store, audit: h.audit }).respond(ordinaryInput);
    expect(result).toMatchObject({ ok: false, status: 409, error: 'iteration-gate-reserved' });
    expect(h.audits).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('allows a minted intervention even when it carries reserved iteration lineage', async () => {
    const h = harness([request({ kind: 'intervention', gateKind: 'iteration-park' })], new Set(['ask-1']));
    const result = await createHumanResponseService({ store: h.store, audit: h.audit }).respond(ordinaryInput);
    expect(result).toMatchObject({ ok: true, replayed: false });
    expect(h.audits).toHaveLength(1);
    expect(h.events).toEqual(['ask-1']);
  });

  it('refuses T3 with ceremony-unavailable and never downgrades to the ordinary channel', async () => {
    const h = harness([request({ kind: 'approval' })]);
    const result = await createHumanResponseService({ store: h.store, audit: h.audit }).respond({
      ...ordinaryInput, decision: 'approved',
    });
    expect(result).toEqual({ ok: false, status: 403, error: 'ceremony-unavailable' });
    expect(h.audits).toEqual([]);
    expect(h.events).toEqual([]);
  });

  it('pins a fresh T3 assertion, audits once, emits exactly one event, and resumes exactly once', async () => {
    const h = harness([request({ kind: 'approval' })]);
    const verify = vi.fn().mockResolvedValue(true);
    const service = createHumanResponseService({
      store: h.store, audit: h.audit,
      ceremony: { verify },
    });
    const input = {
      ...ordinaryInput,
      decision: 'approved' as const,
      ceremonyAssertion: { id: 'assertion' },
      challengeExpiresAt: '2099-08-21T00:05:00.000Z',
    };
    const first = await service.respond(input);
    const replay = await service.respond(input);

    expect(first).toMatchObject({ ok: true, replayed: false });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      requestRef: 'ask-1', requestRevision: 1, action: 'approved', origin: 'https://dashboard.test',
      challengeExpiresAt: '2099-08-21T00:05:00.000Z',
      responseDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }));
    expect(h.audits).toHaveLength(1);
    expect(h.audits[0]).toMatchObject({
      action: 'control-human-response-authorize',
      riskTier: 'T3',
      detail: { runOwnerSubject: 'owner:run-1' },
    });
    expect(h.events).toEqual(['ask-1']);
    expect(h.resumes).toEqual(['run-1']);
  });

  it('rejects an expired T3 challenge in the service before verification', async () => {
    const h = harness([request({ kind: 'approval' })]);
    const verify = vi.fn().mockResolvedValue(true);
    const result = await createHumanResponseService({
      store: h.store,
      audit: h.audit,
      ceremony: { verify },
      now: () => Date.parse('2026-08-21T00:05:00.000Z'),
    }).respond({
      ...ordinaryInput,
      decision: 'approved',
      ceremonyAssertion: { id: 'assertion' },
      challengeExpiresAt: '2026-08-21T00:04:59.999Z',
    });
    expect(result).toEqual({ ok: false, status: 403, error: 'ceremony-expired' });
    expect(verify).not.toHaveBeenCalled();
    expect(h.audits).toEqual([]);
  });

  it('rejects a missing T3 assertion locally before verification', async () => {
    const h = harness([request({ kind: 'review' })]);
    const verify = vi.fn().mockResolvedValue(true);
    const result = await createHumanResponseService({
      store: h.store,
      audit: h.audit,
      ceremony: { verify },
    }).respond({
      ...ordinaryInput,
      decision: 'changes-requested',
      challengeExpiresAt: '2099-08-21T00:05:00.000Z',
    });
    expect(result).toEqual({ ok: false, status: 403, error: 'ceremony-invalid' });
    expect(verify).not.toHaveBeenCalled();
    expect(h.audits).toEqual([]);
  });

  it('maps a T3 verifier exception to ceremony-invalid without audit or mutation', async () => {
    const h = harness([request({ kind: 'governance-refusal' })]);
    const verify = vi.fn().mockRejectedValue(new Error('verifier unavailable'));
    const result = await createHumanResponseService({
      store: h.store,
      audit: h.audit,
      ceremony: { verify },
    }).respond({
      ...ordinaryInput,
      decision: 'rejected',
      ceremonyAssertion: { id: 'assertion' },
      challengeExpiresAt: '2099-08-21T00:05:00.000Z',
    });
    expect(result).toEqual({ ok: false, status: 403, error: 'ceremony-invalid' });
    expect(verify).toHaveBeenCalledOnce();
    expect(h.audits).toEqual([]);
    expect(h.requests.get('ask-1')?.state).toBe('open');
  });

  it('emits once per fresh response but resumes only after the last of two requests', async () => {
    const h = harness([request(), request({ requestRef: 'ask-2', kind: 'intervention', title: 'Second' })]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit });
    await service.respond(ordinaryInput);
    expect(h.events).toEqual(['ask-1']);
    expect(h.resumes).toEqual([]);
    await service.respond({ ...ordinaryInput, requestRef: 'ask-2', idempotencyKey: 'respond-2' });
    expect(h.events).toEqual(['ask-1', 'ask-2']);
    expect(h.resumes).toEqual(['run-1']);
  });

  it('repairs a committed answer when event append fails, without emitting twice', async () => {
    const h = harness([request()], new Set(), { append: 1 });
    const service = createHumanResponseService({ store: h.store, audit: h.audit });

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
    const service = createHumanResponseService({ store: h.store, audit: h.audit });

    await expect(service.respond(ordinaryInput)).rejects.toThrow('resume unavailable');
    expect(h.events).toEqual(['ask-1']);
    expect(h.resumes).toEqual([]);

    await expect(service.respond(ordinaryInput)).resolves.toMatchObject({ ok: true, replayed: true });
    expect(h.events).toEqual(['ask-1']);
    expect(h.resumes).toEqual(['run-1']);
  });

  it('refuses stale revisions and host identities before audit', async () => {
    const h = harness([request()]);
    const service = createHumanResponseService({ store: h.store, audit: h.audit });
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
    });
    const result = await service.respond(ordinaryInput);
    expect(result).toEqual({ ok: false, status: 500, error: 'human-response-audit-required' });
    expect(h.requests.get('ask-1')?.state).toBe('open');
    expect(h.events).toEqual([]);
  });
});

// =====================================================================================================
// P5 W2 — deploy-purpose T3 binding [P5-C20, §3.3]. Exercises the ADDED deploy path only; the shipped
// human-response suite above is unchanged.
// =====================================================================================================

const PREIMAGE: DeployT3Preimage = {
  subject: 'deployment',
  ref: 'deploy-ready:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  revision: 'deploy-ready:0365e0f62588dd65f972717fb13fba2ee2fd35b7a0e68e09208313e9a4601e2e',
  decision: 'deploy',
  digest: 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
};

function ceremonyContext(overrides: Partial<DeployCeremonyContext> = {}): DeployCeremonyContext {
  return {
    ceremony: { verify: async () => true },
    credentials: () => ['registered-credential'],
    consume: async (_grantKey: string): Promise<'fresh'> => 'fresh',
    now: () => Date.parse('2026-08-24T10:00:00.000Z'),
    ...overrides,
  };
}

function ceremonyRequest(overrides: Partial<DeployCeremonyRequest> = {}): DeployCeremonyRequest {
  return {
    preimage: PREIMAGE,
    assertion: { id: 'assertion' },
    origin: 'https://kb.command.ts.net',
    challengeExpiresAt: '2026-08-24T10:01:00.000Z',
    grantKey: 'deploy-grant-1',
    ...overrides,
  };
}

describe('deploy-purpose T3 binding', () => {
  it('digest is the server-side sha256 of the closed binding preimage', () => {
    expect(deployDigest(PREIMAGE)).toBe(deployT3Digest(PREIMAGE));
  });

  it('challenge is base64url of the recomputed preimage — never a client-supplied string', () => {
    const challenge = deployChallenge(PREIMAGE);
    expect(challenge.startsWith('kb.deploy-t3.v1.')).toBe(true);
    const encoded = challenge.slice('kb.deploy-t3.v1.'.length);
    const decoded = Buffer.from(encoded, 'base64url').toString('utf8');
    expect(decoded.startsWith('kb.deploy-t3/v1\u0000deployment\u0000')).toBe(true);
    expect(decoded.endsWith(PREIMAGE.digest)).toBe(true);
  });

  it('accepts a verified single-use assertion and returns the recomputed digest', async () => {
    const service = createDeployCeremonyService(ceremonyContext());
    expect(await service.verify(ceremonyRequest())).toEqual({ ok: true, status: 200, digest: deployDigest(PREIMAGE) });
  });

  it('refuses 403 ceremony-unavailable with no ceremony port', async () => {
    const service = createDeployCeremonyService(ceremonyContext({ ceremony: undefined }));
    expect(await service.verify(ceremonyRequest())).toEqual({ ok: false, status: 403, error: 'ceremony-unavailable' });
  });

  it('refuses 403 ceremony-unavailable with zero registered credentials — never downgrades', async () => {
    const service = createDeployCeremonyService(ceremonyContext({ credentials: () => [] }));
    expect(await service.verify(ceremonyRequest())).toEqual({ ok: false, status: 403, error: 'ceremony-unavailable' });
  });

  it('refuses 403 ceremony-invalid on a missing assertion', async () => {
    const service = createDeployCeremonyService(ceremonyContext());
    expect(await service.verify(ceremonyRequest({ assertion: null }))).toEqual({ ok: false, status: 403, error: 'ceremony-invalid' });
  });

  it('refuses 403 ceremony-invalid on a wrong revision/digest — mints no new code', async () => {
    const service = createDeployCeremonyService(ceremonyContext({
      ceremony: { verify: async ({ challenge }) => challenge === deployChallenge(PREIMAGE) },
    }));
    const tampered = ceremonyRequest({
      preimage: { ...PREIMAGE, digest: 'dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd' },
    });
    expect(await service.verify(tampered)).toEqual({ ok: false, status: 403, error: 'ceremony-invalid' });
  });

  it('refuses 403 ceremony-invalid when verification throws', async () => {
    const service = createDeployCeremonyService(ceremonyContext({
      ceremony: { verify: async () => { throw new Error('verifier blew up'); } },
    }));
    expect(await service.verify(ceremonyRequest())).toEqual({ ok: false, status: 403, error: 'ceremony-invalid' });
  });

  it('refuses 403 ceremony-expired past the window', async () => {
    const service = createDeployCeremonyService(ceremonyContext({ now: () => Date.parse('2026-08-24T10:05:00.000Z') }));
    expect(await service.verify(ceremonyRequest())).toEqual({ ok: false, status: 403, error: 'ceremony-expired' });
  });

  it('refuses 409 on a replayed single-use grant', async () => {
    const service = createDeployCeremonyService(ceremonyContext({ consume: async (_grantKey: string): Promise<'replayed'> => 'replayed' }));
    expect(await service.verify(ceremonyRequest())).toEqual({ ok: false, status: 409, error: 'ceremony-replayed' });
  });

  it('no refusal body carries key, signer, or challenge bytes', async () => {
    const contexts: DeployCeremonyContext[] = [
      ceremonyContext({ ceremony: undefined }),
      ceremonyContext({ credentials: () => [] }),
      ceremonyContext({ ceremony: { verify: async () => false } }),
      ceremonyContext({ now: () => Date.parse('2026-08-24T10:05:00.000Z') }),
      ceremonyContext({ consume: async (_grantKey: string): Promise<'replayed'> => 'replayed' }),
    ];
    for (const context of contexts) {
      const outcome = await createDeployCeremonyService(context).verify(ceremonyRequest());
      expect(outcome.ok).toBe(false);
      const serialized = JSON.stringify(outcome);
      expect(serialized).not.toContain('assertion');
      expect(serialized).not.toContain('challenge');
      expect(serialized).not.toContain('kb.deploy-t3');
      expect(serialized).not.toContain('credential');
      expect(Object.keys(outcome).sort()).toEqual(['error', 'ok', 'status']);
    }
  });
});

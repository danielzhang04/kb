import { describe, expect, it, vi } from 'vitest';
import {
  DEPLOY_COOLDOWN_MS, HelperCompositionError, TRANSPORT_TIMEOUT_MS,
  assertHelperOrigin, createHelperClient, helperOriginFromEnv,
  type HelperEscalate, type HelperFetch,
} from './helperClient.ts';
import type {
  HelperDeployRequest, HelperDeploymentResultRequest, HelperPullAssetsRequest, HelperReceipt,
} from './contracts.ts';

const ORIGIN = 'https://kb-desk.command.ts.net';
const SHA = 'a'.repeat(40);
const DIGEST = 'c'.repeat(64);
const MANIFEST = 'd'.repeat(64);

function deployRequest(overrides: Partial<HelperDeployRequest> = {}): HelperDeployRequest {
  return { verb: 'deploy', sourceCommit: SHA, attestationDigest: DIGEST, requestRef: 'req-1', ...overrides };
}
function pullRequest(overrides: Partial<HelperPullAssetsRequest> = {}): HelperPullAssetsRequest {
  return { verb: 'pull-assets', intentRef: 'assetpull-1', runRef: 'run-1', manifestDigest: MANIFEST, ...overrides };
}
function resultRequest(overrides: Partial<HelperDeploymentResultRequest> = {}): HelperDeploymentResultRequest {
  return { verb: 'deployment-result', deploymentRef: 'deployment:1', outcome: 'succeeded', ...overrides };
}

function receiptFor(request: { requestRef?: string }, overrides: Partial<HelperReceipt> = {}): HelperReceipt {
  return {
    time: '2026-08-24T10:00:00Z', requestRef: request.requestRef ?? 'req-echo',
    shortSha: 'aaaaaaa', callerNode: 'vm-node', outcome: 'accepted', ...overrides,
  };
}

interface StubOptions {
  advertise?: (verb: string) => string | null;
  receipt?: (request: any) => unknown;
  postStatus?: number;
}
function stubFetch(options: StubOptions = {}) {
  const posts: Array<{ url: string; body: string | undefined; redirect: string; request: any }> = [];
  const gets: string[] = [];
  const fetch: HelperFetch = async (url, init) => {
    if (init.method === 'GET') {
      gets.push(url);
      const verb = new URL(url).searchParams.get('verb') ?? '';
      const version = options.advertise ? options.advertise(verb) : `${verb}/v1`;
      if (version === null) return { ok: false, status: 500, json: async () => null };
      return { ok: true, status: 200, json: async () => ({ version }) };
    }
    const request = JSON.parse(init.body ?? '{}');
    posts.push({ url, body: init.body, redirect: init.redirect, request });
    if (options.postStatus && options.postStatus >= 400) {
      return { ok: false, status: options.postStatus, json: async () => null };
    }
    const body = options.receipt ? options.receipt(request) : receiptFor(request);
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetch, posts, gets };
}

describe('helper origin composition [P5-C42]', () => {
  it('accepts a bare https tailnet origin', () => {
    expect(assertHelperOrigin('https://kb-desk.command.ts.net')).toBe('https://kb-desk.command.ts.net');
  });
  it('rejects a missing origin — no default', () => {
    expect(() => assertHelperOrigin(undefined)).toThrow(HelperCompositionError);
    expect(() => assertHelperOrigin('')).toThrow(HelperCompositionError);
  });
  it('rejects a non-https origin', () => {
    expect(() => assertHelperOrigin('http://kb-desk.command.ts.net')).toThrow(HelperCompositionError);
  });
  it('rejects a non-tailnet origin', () => {
    expect(() => assertHelperOrigin('https://kb-desk.example.com')).toThrow(HelperCompositionError);
  });
  it('rejects an origin carrying a path/query', () => {
    expect(() => assertHelperOrigin('https://kb-desk.command.ts.net/helper')).toThrow(HelperCompositionError);
    expect(() => assertHelperOrigin('https://kb-desk.command.ts.net/?x=1')).toThrow(HelperCompositionError);
  });
  it('helperOriginFromEnv reads DASHBOARD_DESKTOP_HELPER_ORIGIN and never defaults', () => {
    expect(helperOriginFromEnv({ DASHBOARD_DESKTOP_HELPER_ORIGIN: ORIGIN } as NodeJS.ProcessEnv)).toBe(ORIGIN);
    expect(() => helperOriginFromEnv({} as NodeJS.ProcessEnv)).toThrow(HelperCompositionError);
  });
  it('createHelperClient throws synchronously on a bad origin', () => {
    expect(() => createHelperClient({ origin: 'http://x.example' })).toThrow(HelperCompositionError);
  });
});

describe('helper client transport and outcome', () => {
  it('encodes a deploy request and returns an accepted HelperOutcome', async () => {
    const stub = stubFetch();
    const client = createHelperClient({ origin: ORIGIN, fetch: stub.fetch });
    const result = await client.invoke(deployRequest(), { idempotencyKey: 'k1' });
    expect(result).toEqual({
      ok: true,
      outcome: {
        verb: 'deploy', requestRef: 'req-1', receiptAt: '2026-08-24T10:00:00Z',
        shortSha: 'aaaaaaa', callerNode: 'vm-node', outcome: 'accepted',
      },
    });
    expect(stub.posts).toHaveLength(1);
    expect(stub.posts[0]!.url).toBe(`${ORIGIN}/deploy-helper/invoke`);
    expect(stub.posts[0]!.redirect).toBe('error'); // no redirects
    expect(JSON.parse(stub.posts[0]!.body!)).toEqual(deployRequest());
  });

  it('maps a refused receipt to helper-refused and a failed receipt to helper-failed', async () => {
    const refused = createHelperClient({
      origin: ORIGIN, fetch: stubFetch({ receipt: (r) => receiptFor(r, { outcome: 'refused' }) }).fetch,
    });
    expect(await refused.invoke(resultRequest(), { idempotencyKey: 'r1' })).toEqual({ ok: false, code: 'helper-refused' });
    const failed = createHelperClient({
      origin: ORIGIN, fetch: stubFetch({ receipt: (r) => receiptFor(r, { outcome: 'failed' }) }).fetch,
    });
    expect(await failed.invoke(resultRequest(), { idempotencyKey: 'r2' })).toEqual({ ok: false, code: 'helper-failed' });
  });

  it('fails closed as protocol-invalid on an outbound request with an extra field, sending nothing', async () => {
    const stub = stubFetch();
    const client = createHelperClient({ origin: ORIGIN, fetch: stub.fetch });
    const bad = { ...deployRequest(), path: '/etc/passwd' } as unknown as HelperDeployRequest;
    expect(await client.invoke(bad, { idempotencyKey: 'k1' })).toEqual({ ok: false, code: 'protocol-invalid' });
    expect(stub.posts).toHaveLength(0);
  });

  it('fails closed as protocol-invalid on a receipt with a signature-shaped extra key', async () => {
    const client = createHelperClient({
      origin: ORIGIN,
      fetch: stubFetch({ receipt: (r) => ({ ...receiptFor(r), signature: 'deadbeef' }) }).fetch,
    });
    expect(await client.invoke(resultRequest(), { idempotencyKey: 'r1' })).toEqual({ ok: false, code: 'protocol-invalid' });
  });

  it('fails closed as protocol-invalid when a deploy receipt echoes the wrong requestRef', async () => {
    const client = createHelperClient({
      origin: ORIGIN, fetch: stubFetch({ receipt: () => receiptFor({ requestRef: 'other' }) }).fetch,
    });
    expect(await client.invoke(deployRequest(), { idempotencyKey: 'k1' })).toEqual({ ok: false, code: 'protocol-invalid' });
  });

  it('maps an unreachable helper (non-2xx) to helper-unreachable', async () => {
    const client = createHelperClient({ origin: ORIGIN, fetch: stubFetch({ postStatus: 502 }).fetch });
    expect(await client.invoke(resultRequest(), { idempotencyKey: 'r1' })).toEqual({ ok: false, code: 'helper-unreachable' });
  });
});

describe('movement:235 cooldown and idempotency', () => {
  it('permits one deploy then refuses a second within the five-minute cooldown, sending only once', async () => {
    let clock = 1_000_000;
    const stub = stubFetch();
    const client = createHelperClient({ origin: ORIGIN, fetch: stub.fetch, now: () => clock });
    expect((await client.invoke(deployRequest({ requestRef: 'a' }), { idempotencyKey: 'k1' })).ok).toBe(true);
    clock += DEPLOY_COOLDOWN_MS - 1;
    expect(await client.invoke(deployRequest({ requestRef: 'b' }), { idempotencyKey: 'k2' }))
      .toEqual({ ok: false, code: 'helper-refused' });
    expect(stub.posts).toHaveLength(1); // second deploy never sent
    clock += 2; // now past the cooldown
    expect((await client.invoke(deployRequest({ requestRef: 'c' }), { idempotencyKey: 'k3' })).ok).toBe(true);
    expect(stub.posts).toHaveLength(2);
  });

  it('replays an identical verb+key without re-sending (repeat-key is idempotent, no refusal)', async () => {
    const stub = stubFetch();
    const client = createHelperClient({ origin: ORIGIN, fetch: stub.fetch });
    const first = await client.invoke(deployRequest(), { idempotencyKey: 'k1' });
    const second = await client.invoke(deployRequest(), { idempotencyKey: 'k1' });
    expect(second).toEqual(first);
    expect(stub.posts).toHaveLength(1); // replay bypasses both the network and the cooldown
  });

  it('pull-assets is independently idempotent: same key cached, different key re-sends', async () => {
    const stub = stubFetch();
    const client = createHelperClient({ origin: ORIGIN, fetch: stub.fetch });
    await client.invoke(pullRequest(), { idempotencyKey: 'p1' });
    await client.invoke(pullRequest(), { idempotencyKey: 'p1' });
    expect(stub.posts).toHaveLength(1);
    await client.invoke(pullRequest(), { idempotencyKey: 'p2' });
    expect(stub.posts).toHaveLength(2);
  });
});

describe('design 667 version handshake fails closed', () => {
  it('blocks deploy and escalates once when the advertised version mismatches', async () => {
    const escalate = vi.fn<HelperEscalate>();
    const stub = stubFetch({ advertise: () => 'deploy/v2' });
    const client = createHelperClient({ origin: ORIGIN, fetch: stub.fetch, escalate });
    expect(await client.invoke(deployRequest(), { idempotencyKey: 'k1' })).toEqual({ ok: false, code: 'protocol-invalid' });
    expect(await client.invoke(deployRequest({ requestRef: 'b' }), { idempotencyKey: 'k2' })).toEqual({ ok: false, code: 'protocol-invalid' });
    expect(stub.posts).toHaveLength(0); // never sent
    expect(escalate).toHaveBeenCalledTimes(1); // deduplicated
    expect(escalate.mock.calls[0]![0].verb).toBe('deploy');
  });

  it('blocks deploy and escalates once when the advertisement is unfetchable', async () => {
    const escalate = vi.fn<HelperEscalate>();
    const stub = stubFetch({ advertise: () => null });
    const client = createHelperClient({ origin: ORIGIN, fetch: stub.fetch, escalate });
    expect(await client.invoke(deployRequest(), { idempotencyKey: 'k1' })).toEqual({ ok: false, code: 'protocol-invalid' });
    expect(stub.posts).toHaveLength(0);
    expect(escalate).toHaveBeenCalledTimes(1);
  });

  it('deployment-result needs no advertisement handshake', async () => {
    const stub = stubFetch({ advertise: () => 'wrong' });
    const client = createHelperClient({ origin: ORIGIN, fetch: stub.fetch });
    expect((await client.invoke(resultRequest(), { idempotencyKey: 'r1' })).ok).toBe(true);
    expect(stub.gets).toHaveLength(0); // no handshake GET issued
  });
});

describe('bounded transport [§3.4]', () => {
  it('exports the 20-second bound and 5-minute cooldown', () => {
    expect(TRANSPORT_TIMEOUT_MS).toBe(20_000);
    expect(DEPLOY_COOLDOWN_MS).toBe(300_000);
  });

  it('aborts a hanging call within the bound and returns helper-unreachable', async () => {
    const hanging: HelperFetch = (_url, init) => new Promise((_resolve, reject) => {
      if (init.signal.aborted) { reject(new Error('aborted')); return; }
      init.signal.addEventListener('abort', () => reject(new Error('aborted')));
    });
    // deployment-result skips the handshake, so the hang lands on the invoke POST itself.
    const client = createHelperClient({ origin: ORIGIN, fetch: hanging, timeoutMs: 20 });
    const result = await client.invoke(resultRequest(), { idempotencyKey: 'r1' });
    expect(result).toEqual({ ok: false, code: 'helper-unreachable' });
  });
});

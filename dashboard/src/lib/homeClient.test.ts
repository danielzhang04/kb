import { describe, expect, it, vi } from 'vitest';
import type { HomeResponse } from '../../server/home/contracts.ts';
import homeGolden from '../../server/home/__fixtures__/home.json';
import { decodeHomeResponse, fetchHome } from './homeClient.ts';

const homeResponseFixture = homeGolden as unknown as HomeResponse;

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('Home client', () => {
  it('sends the session bearer and accepts the exact ordered D13 envelope', async () => {
    const fetchImpl = vi.fn(async () => response(homeResponseFixture));

    await expect(fetchHome('session-token', fetchImpl)).resolves.toEqual(homeResponseFixture);
    expect(fetchImpl).toHaveBeenCalledWith('/api/home', {
      headers: { accept: 'application/json', authorization: 'Bearer session-token' },
    });
  });

  it('rejects extra keys, reordered sections, invalid run fields, and unknown failure codes', () => {
    const missingGeneratedAt = structuredClone(homeResponseFixture) as unknown as { generatedAt?: string };
    delete missingGeneratedAt.generatedAt;
    expect(() => decodeHomeResponse(missingGeneratedAt)).toThrow(/invalid home response/i);

    const extra = structuredClone(homeResponseFixture) as unknown as { extra: boolean };
    extra.extra = true;
    expect(() => decodeHomeResponse(extra)).toThrow(/invalid home response/i);

    const reordered = structuredClone(homeResponseFixture) as unknown as { sections: unknown[] };
    [reordered.sections[0], reordered.sections[1]] = [reordered.sections[1], reordered.sections[0]];
    expect(() => decodeHomeResponse(reordered)).toThrow(/invalid home response/i);

    const badRun = structuredClone(homeResponseFixture) as unknown as { sections: Array<{ data?: { runs?: Array<{ lifecycle: string }> } }> };
    badRun.sections[0]!.data!.runs![0]!.lifecycle = 'mystery';
    expect(() => decodeHomeResponse(badRun)).toThrow(/invalid home response/i);

    const badFailure = structuredClone(homeResponseFixture) as unknown as { sections: unknown[] };
    badFailure.sections[2] = { state: 'unavailable', reason: 'unknown-source' };
    expect(() => decodeHomeResponse(badFailure)).toThrow(/invalid home response/i);

    const missingScheduleOwner = structuredClone(homeResponseFixture) as unknown as {
      sections: Array<{ data?: { occurrences?: Array<{ owner?: unknown }> } }>;
    };
    delete missingScheduleOwner.sections[2]!.data!.occurrences![0]!.owner;
    expect(() => decodeHomeResponse(missingScheduleOwner)).toThrow(/invalid home response/i);
  });

  it('fails closed on a non-OK response', async () => {
    await expect(fetchHome('session-token', vi.fn(async () => response({ error: 'nope' }, 503))))
      .rejects.toThrow('GET /api/home failed: 503');
  });
});

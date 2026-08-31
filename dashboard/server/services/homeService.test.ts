// P6 W2 — characterization of `GET /api/home`'s extracted service: the composed projection body and the
// `"<revision>"` ETag/304, over an injected `projectHome` fake (no real store/`gh`/tree).

import { describe, expect, it, vi } from 'vitest';
import { readHome, type HomeServicePort } from './homeService.ts';

function port(over: Partial<HomeServicePort> = {}): HomeServicePort {
  return {
    projectHome: vi.fn(async (nowIso: string) => ({ revision: 'home:42', now: nowIso, sections: [] })),
    ...over,
  };
}

describe('homeService', () => {
  it('returns 200 with the projection and its ETag, passing the clock through', async () => {
    const p = port();
    const out = await readHome(p, '2026-08-25T00:00:00.000Z', undefined);
    expect(out).toEqual({ status: 200, etag: '"home:42"', body: { revision: 'home:42', now: '2026-08-25T00:00:00.000Z', sections: [] } });
    expect(p.projectHome).toHaveBeenCalledWith('2026-08-25T00:00:00.000Z');
  });

  it('returns 304 when the client ETag matches the revision', async () => {
    const out = await readHome(port(), '2026-08-25T00:00:00.000Z', '"home:42"');
    expect(out).toEqual({ status: 304, etag: '"home:42"' });
  });

  it('returns 200 when the client ETag is stale', async () => {
    const out = await readHome(port(), '2026-08-25T00:00:00.000Z', '"home:41"');
    expect(out.status).toBe(200);
    expect(out.etag).toBe('"home:42"');
  });
});

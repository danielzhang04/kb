import { describe, expect, it } from 'vitest';
import { fetchEntityDetail, fetchEntityList } from './entityClient';

describe('entity client', () => {
  it('uses one entity envelope endpoint without client joins', async () => {
    const requests: string[] = [];
    const fetchImpl = async (url: string) => { requests.push(url); return new Response(JSON.stringify({ revision: 'r1', groups: [], items: [] }), { status: 200 }); };
    await expect(fetchEntityList('agents', fetchImpl as typeof fetch)).resolves.toMatchObject({ revision: 'r1' });
    expect(requests).toEqual(['/api/agents']);
  });

  it('keeps failed detail context typed for an overlay Retry state', async () => {
    await expect(fetchEntityDetail('workflows', 'research brief', async () => new Response('no', { status: 503 }) as Response)).rejects.toEqual(expect.objectContaining({ status: 503, scope: 'detail' }));
  });
});

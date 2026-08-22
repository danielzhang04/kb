import { describe, expect, it, vi } from 'vitest';
import { fetchAgentDetail, fetchAgentList } from './agentClient';

describe('agentClient', () => {
  it('reads the shared P2 list and detail envelopes without compatibility requests', async () => {
    const summary = { ref: { type: 'agent', id: 'fyt-checker', sourcePath: 'agents/fyt-checker.md' }, humanName: 'FYT Checker', status: 'idle', modelLabel: 'gpt-5.6-sol', temporalLabel: 'Never run \u00b7 no schedule', host: 'vm', gatedRunCount: 0, activeRuns: [], latestRun: null, nextSchedule: null };
    const fetchImpl = vi.fn(async (input: string | URL | Request) => new Response(JSON.stringify(String(input).endsWith('/fyt-checker')
      ? { revision: 'detail-1', summary, brief: { purpose: 'Checks work.', doingNow: 'Idle.', recentRuns: [], outputs: [], pendingGates: 0, schedule: null, autonomyTier: 'T2' }, details: { sourcePath: 'agents/fyt-checker.md', sourceRevision: 'a'.repeat(64), tools: [], declaredCeiling: 'T2', replaces: [], buildsOn: [], knowledgeSources: [], skills: [], schemas: [], lineage: [], grades: [], ids: ['fyt-checker'] } }
      : { revision: 'list-1', groups: [], items: [] }), { status: 200 })) as unknown as typeof fetch;
    expect((await fetchAgentList(fetchImpl)).revision).toBe('list-1');
    expect((await fetchAgentDetail('fyt-checker', fetchImpl)).revision).toBe('detail-1');
    expect(fetchImpl).toHaveBeenNthCalledWith(1, '/api/agents');
    expect(fetchImpl).toHaveBeenNthCalledWith(2, '/api/agents/fyt-checker');
  });

  it('preserves status and request scope on failures', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 422 })) as unknown as typeof fetch;
    await expect(fetchAgentDetail('broken', fetchImpl)).rejects.toEqual(expect.objectContaining({ status: 422, scope: 'detail' }));
  });
});

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeEntityDetail, decodeEntityList, fetchEntityDetail, fetchEntityList } from './entityClient';

const summary = {
  ref: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }, humanName: 'Grader', status: 'idle',
  modelLabel: 'gpt-5.6-sol', temporalLabel: 'Never run \u00b7 no schedule', host: 'vm', gatedRunCount: 0,
  activeRuns: [], latestRun: null, nextSchedule: null,
};

describe('entity client', () => {
  it('contains no double-decoded C3 82 byte sequence in dashboard source or server code', () => {
    const dashboard = fileURLToPath(new URL('../..', import.meta.url));
    const offenders: string[] = [];
    const visit = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) visit(path);
        else {
          const bytes = readFileSync(path);
          if (bytes.some((byte, index) => byte === 0xc3 && bytes[index + 1] === 0x82)) offenders.push(path.slice(dashboard.length + 1));
        }
      }
    };
    visit(join(dashboard, 'src')); visit(join(dashboard, 'server'));
    expect(offenders).toEqual([]);
  });
  it('uses one entity envelope endpoint without client joins', async () => {
    const requests: string[] = [];
    const fetchImpl = async (url: string) => { requests.push(url); return new Response(JSON.stringify({ revision: 'r1', groups: [], items: [] }), { status: 200 }); };
    await expect(fetchEntityList('agents', fetchImpl as typeof fetch)).resolves.toMatchObject({ revision: 'r1' });
    expect(requests).toEqual(['/api/agents']);
  });

  it('keeps failed detail context typed for an overlay Retry state', async () => {
    await expect(fetchEntityDetail('workflows', 'research brief', async () => new Response('no', { status: 503 }) as Response)).rejects.toEqual(expect.objectContaining({ status: 503, scope: 'detail' }));
  });

  it('rejects extra keys and malformed nested runnable provenance in both closed envelopes', () => {
    expect(() => decodeEntityList({ revision: 'r1', groups: [], items: [], legacy: [] })).toThrow('Invalid Entity list response');
    expect(() => decodeEntityList({ revision: 'r1', groups: [], items: [{ ...summary, ref: { ...summary.ref, sourcePath: '../../CLAUDE.md' } }] })).toThrow('Invalid Entity list response');
    const detail = {
      revision: 'r1', summary,
      brief: { purpose: 'Grades work.', doingNow: 'Idle.', recentRuns: [], outputs: [], pendingGates: 0, schedule: null, autonomyTier: 'T2' },
      details: { sourcePath: 'agents/grader.md', sourceRevision: 'a'.repeat(64), tools: [], declaredCeiling: 'T2', replaces: [], buildsOn: [], knowledgeSources: [], skills: [], schemas: [], lineage: [], grades: [], ids: ['grader'] },
    };
    expect(decodeEntityDetail(detail)).toMatchObject({ summary: { ref: { id: 'grader' } } });
    expect(() => decodeEntityDetail({ ...detail, details: { ...detail.details, owner: 'operator' } })).toThrow('Invalid Entity detail response');
  });
});

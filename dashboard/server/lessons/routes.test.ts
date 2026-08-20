/** U10: proposal-only lesson API, exercised without dashboard/server/index.ts. */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { registerLessons } from './routes.ts';

const dirs: string[] = [];
afterEach(async () => {
  while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true });
});

async function fixtureRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'lesson-proposals-'));
  dirs.push(root);
  const proposals = join(root, 'docs', 'proposals', 'lessons');
  await mkdir(proposals, { recursive: true });
  await writeFile(join(proposals, 'session-a.md'), `# Proposed lessons

status: PROPOSED
source_session: session-a

## ADD 1
- lesson: WORKED: retry Bash with changed arguments after an error.
- confidence: high
- evidence: session-a.jsonl:L2-L5
- source_session: session-a
`, 'utf8');
  await writeFile(join(proposals, 'ignore.txt'), 'not a proposal', 'utf8');
  return root;
}

describe('registerLessons', () => {
  it('lists parsed proposal entries from the injected reviewable area', async () => {
    const app = Fastify({ logger: false });
    registerLessons(app, await fixtureRoot());
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/lessons/proposals' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      files: [{
        file: 'session-a.md', status: 'PROPOSED', sourceSession: 'session-a', entries: [{
          lesson: 'WORKED: retry Bash with changed arguments after an error.', confidence: 'high',
          evidence: 'session-a.jsonl:L2-L5', sourceSession: 'session-a',
        }],
      }],
      entries: [{
        lesson: 'WORKED: retry Bash with changed arguments after an error.', confidence: 'high',
        evidence: 'session-a.jsonl:L2-L5', sourceSession: 'session-a', file: 'session-a.md',
      }],
    });
    await app.close();
  });

  it('is empty-safe and GET-only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'lesson-proposals-empty-'));
    dirs.push(root);
    const app = Fastify({ logger: false });
    registerLessons(app, root);
    await app.ready();
    expect((await app.inject({ method: 'GET', url: '/api/lessons/proposals' })).json()).toEqual({ files: [], entries: [] });
    expect((await app.inject({ method: 'POST', url: '/api/lessons/proposals' })).statusCode).toBe(404);
    await app.close();
  });
});

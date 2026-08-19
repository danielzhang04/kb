import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { runtimeCapabilities } from '../runtime/capabilities.ts';
import { readSystemWorkers, registerAgents } from './routes.ts';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-detail-'));
  mkdirSync(join(root, 'agents'), { recursive: true });
  mkdirSync(join(root, 'orgs', 'kb-ops', 'workflows'), { recursive: true });
  writeFileSync(join(root, 'agents', 'research-worker.md'), [
    '---',
    'id: research-worker',
    'runtime: claude',
    'runner-bound: false',
    'projects: [kb-ops]',
    '---',
    '',
    '# Research worker',
    'Follow the assigned workflow before reporting.',
    '',
  ].join('\n'), 'utf8');
  writeFileSync(join(root, 'orgs', 'kb-ops', 'workflows', 'research-brief.md'), [
    '---',
    'id: research-brief',
    'project: kb-ops',
    'title: Research brief',
    'profile: research',
    'governedBy: research-worker',
    'stages:',
    '  - id: brief',
    '    title: Research',
    '    action: research:web-brief',
    '    target: orgs/kb-ops/output',
    '    governedBy: research-worker',
    '---',
    'Write a bounded research brief.',
    '',
  ].join('\n'), 'utf8');
  return root;
}

describe('agent declaration detail route', () => {
  it('exposes exact governed relationships and excludes same-project workflows with no ownership', async () => {
    const root = fixture();
    writeFileSync(join(root, 'orgs', 'kb-ops', 'workflows', 'unowned.md'), [
      '---', 'id: unowned', 'project: kb-ops', 'title: Unowned', 'stages:',
      '  - id: untouched', '    action: write', '    target: orgs/kb-ops/output', '---', '',
    ].join('\n'), 'utf8');
    const app = Fastify();
    registerAgents(app, root);
    const response = await app.inject({ method: 'GET', url: '/api/agents/research-worker' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      id: 'research-worker',
      declaration: {
        path: 'agents/research-worker.md',
        source: 'agents-declaration',
        sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        instructions: expect.stringContaining('Follow the assigned workflow'),
        defaultProfile: null,
        allowedProfiles: null,
      },
      codebases: [{ project: 'kb-ops', path: 'orgs/kb-ops' }],
      workflows: [{
        ref: 'research-brief', path: 'orgs/kb-ops/workflows/research-brief.md',
        governsWorkflow: true, relationship: 'governor-and-stage-governor',
        stages: [expect.objectContaining({ id: 'brief', dependsOn: [] })],
      }],
      howItRuns: { runner: null, command: null },
    });
    expect(response.json().workflows).toHaveLength(1);
    await app.close();
  });

  it('does not turn non-declared roster names into arbitrary-file reads', async () => {
    const app = Fastify();
    registerAgents(app, fixture());
    const response = await app.inject({ method: 'GET', url: '/api/agents/..%2FCLAUDE.md' });
    expect(response.statusCode).toBe(404);
    await app.close();
  });

  it('does not advertise a declared project as a codebase when its org root is absent', async () => {
    const root = fixture();
    writeFileSync(join(root, 'agents', 'missing-project.md'), [
      '---', 'id: missing-project', 'projects: [not-checked-out]', '---', '', '# Missing project', '',
    ].join('\n'), 'utf8');
    const app = Fastify();
    registerAgents(app, root);
    const response = await app.inject({ method: 'GET', url: '/api/agents/missing-project' });
    expect(response.statusCode).toBe(200);
    expect(response.json().codebases).toEqual([]);
    await app.close();
  });

  it('surfaces a malformed declaration as an explicit unavailable agent rather than silently omitting it', async () => {
    const root = fixture();
    writeFileSync(join(root, 'agents', 'broken.md'), 'not a declaration\n', 'utf8');
    const app = Fastify();
    registerAgents(app, root);
    const detail = await app.inject({ method: 'GET', url: '/api/agents/broken' });
    expect(detail.statusCode).toBe(422);
    expect(detail.json()).toEqual({
      error: 'agent-declaration-invalid',
      declaration: { id: 'broken', source: 'agents/broken.md', problem: 'malformed-frontmatter' },
    });
    const roster = await app.inject({ method: 'GET', url: '/api/agents' });
    expect(roster.json()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'broken', declared: false, declarationProblem: 'malformed-frontmatter' }),
    ]));
    await app.close();
  });

  it('surfaces an incomplete execution-profile contract as an unavailable declaration', async () => {
    const root = fixture();
    writeFileSync(join(root, 'agents', 'broken-profile.md'), [
      '---', 'id: broken-profile', 'default-profile: worker:codex:gpt-5.6-sol', '---', '', '# Broken profile', '',
    ].join('\n'), 'utf8');
    const app = Fastify();
    registerAgents(app, root);
    const detail = await app.inject({ method: 'GET', url: '/api/agents/broken-profile' });
    expect(detail.statusCode).toBe(422);
    expect(detail.json()).toEqual({
      error: 'agent-declaration-invalid',
      declaration: { id: 'broken-profile', source: 'agents/broken-profile.md', problem: 'invalid-profile-config' },
    });
    await app.close();
  });

  it('surfaces a filename/frontmatter id mismatch and never serves it under the claimed id', async () => {
    const root = fixture();
    writeFileSync(join(root, 'agents', 'mismatch.md'), '---\nid: claimed-agent\n---\nambiguous\n', 'utf8');
    const app = Fastify();
    registerAgents(app, root);
    const mismatch = await app.inject({ method: 'GET', url: '/api/agents/mismatch' });
    expect(mismatch.statusCode).toBe(422);
    expect(mismatch.json()).toEqual({
      error: 'agent-declaration-invalid',
      declaration: { id: 'mismatch', source: 'agents/mismatch.md', problem: 'id-mismatch' },
    });
    expect((await app.inject({ method: 'GET', url: '/api/agents/claimed-agent' })).statusCode).toBe(404);
    await app.close();
  });

  it('does not advertise a project root that is symlinked outside the repo', async () => {
    const root = fixture();
    const outside = mkdtempSync(join(tmpdir(), 'agent-codebase-outside-'));
    let linked = false;
    try {
      // Replace the fixture directory only after establishing its exact target; Windows may refuse
      // this without symlink privileges, in which case the containment branch is platform-skipped.
      const orgs = join(root, 'orgs');
      // A second declared project is enough to exercise a final-root symlink.
      mkdirSync(join(outside, 'evil-project'), { recursive: true });
      symlinkSync(join(outside, 'evil-project'), join(orgs, 'outside-project'), 'junction');
      writeFileSync(join(root, 'agents', 'outside-worker.md'), [
        '---', 'id: outside-worker', 'projects: [outside-project]', '---', '', '# Outside', '',
      ].join('\n'), 'utf8');
      linked = true;
    } catch {
      /* Symlink creation is privilege-gated on some Windows hosts. */
    }
    if (!linked) return;
    const app = Fastify();
    registerAgents(app, root);
    const response = await app.inject({ method: 'GET', url: '/api/agents/outside-worker' });
    expect(response.statusCode).toBe(200);
    expect(response.json().codebases).toEqual([]);
    await app.close();
  });
});

function policyRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'system-workers-'));
  mkdirSync(join(root, 'governance'), { recursive: true });
  writeFileSync(join(root, 'governance', 'model-routing.yaml'), [
    'runtimes:',
    '  claude:',
    '    default_worker: worker-desktop',
    '  codex:',
    '    default_worker: codex-worker',
    '',
  ].join('\n'), 'utf8');
  return root;
}

describe('system worker platform registration', () => {
  it('keeps the Windows scheduled worker triggerable', () => {
    const workers = readSystemWorkers(policyRepo(), runtimeCapabilities('win32'));
    expect(workers.find((worker) => worker.id === 'codex-worker')?.dashboardTriggerable).toBe(true);
    expect(workers.find((worker) => worker.id === 'worker-desktop')?.dashboardTriggerable).toBe(false);
  });

  it('keeps Linux runner triggering disabled for this cutover', () => {
    const root = policyRepo();
    const capabilities = runtimeCapabilities('linux');
    expect(capabilities.runnerTrigger).toBe(false);
    expect(readSystemWorkers(root, capabilities).find((worker) => worker.id === 'codex-worker')?.dashboardTriggerable)
      .toBe(false);
  });

  it('retains the closed Linux runner mapping behind the disabled capability', () => {
    const root = policyRepo();
    const futureCapabilities = { ...runtimeCapabilities('linux'), runnerTrigger: true };
    expect(readSystemWorkers(root, futureCapabilities).find((worker) => worker.id === 'codex-worker')?.dashboardTriggerable)
      .toBe(true);
  });
});

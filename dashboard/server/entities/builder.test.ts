import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { materializeEntityBuilderRequest, patchEntityBuilderSource, renderAgentBuilderSource, renderWorkflowBuilderSource, submitEntityBuilder } from './builder.ts';
import { parseWorkflowDef } from '../workflows/defs.ts';
import { readDeclaredAgentDetails } from '../agents/roster.ts';

const catalog = {
  models: ['gpt-5.6-sol'],
  profiles: ['research-profile'],
  tools: ['web.search'],
  skills: ['research'],
  connectors: [{ server: 'github', tools: ['issues.read', 'pulls.read'] }, { server: 'slack', tools: ['messages.read'] }],
  filesystemRoots: { kb: 'orgs/kb-ops' },
  projects: ['kb-ops'],
};

const request = {
  humanName: 'Research Brief',
  purpose: 'Research.',
  model: 'gpt-5.6-sol',
  profile: 'research-profile',
  tools: ['web.search'],
  skills: ['research'],
  connectors: [{ server: 'github', tools: ['issues.read', 'pulls.read'] }, { server: 'slack', tools: ['messages.read'] }],
  filesystemRoots: ['kb'],
};

describe('entity builder', () => {
  it('accepts cataloged display and policy choices, including profiles and symbolic roots', () => {
    expect(materializeEntityBuilderRequest(request, catalog)).toMatchObject({
      model: 'gpt-5.6-sol',
      profile: 'research-profile',
      connectors: request.connectors,
      filesystemRoots: ['kb'],
    });
  });

  it('closes model, profile, capability, connector, and symbolic root catalogs', () => {
    expect(() => materializeEntityBuilderRequest({ ...request, model: 'unknown' }, catalog)).toThrow('unknown-model');
    expect(() => materializeEntityBuilderRequest({ ...request, profile: 'unknown-profile' }, catalog)).toThrow('unknown-profile');
    expect(() => materializeEntityBuilderRequest({ ...request, skills: ['untrusted-capability'] }, catalog)).toThrow('unknown-capability');
    expect(() => materializeEntityBuilderRequest({ ...request, connectors: [{ server: 'github', tools: ['admin'] }] }, catalog)).toThrow('unknown-connector');
    expect(() => materializeEntityBuilderRequest({ ...request, tools: ['shell'] }, catalog)).toThrow('unknown-tool');
    expect(() => materializeEntityBuilderRequest({ ...request, filesystemRoots: ['unknown-root'] }, catalog)).toThrow('unknown-root');
  });

  it('rejects needs, path, sourcePath, and absolute path fields by name', () => {
    for (const [name, value] of [
      ['needs', ['network']],
      ['project', 'kb-ops'],
      ['path', 'orgs/kb-ops/output'],
      ['sourcePath', 'agents/research-brief.md'],
      ['path', 'C:/repo/agent.md'],
    ] as const) {
      expect(() => materializeEntityBuilderRequest({ ...request, [name]: value }, catalog)).toThrow('builder-field-forbidden');
    }
  });

  it('rejects missing source CAS fields before resolving or calling the durable port', async () => {
    const port = { save: async () => ({ status: 'pending' as const, operationId: 'op-1', replayed: false }) };
    const services = { resolve: () => { throw new Error('must-not-resolve'); }, catalog, port };
    await expect(submitEntityBuilder({ selector: { type: 'workflow', id: 'research-brief' }, project: 'kb-ops', expectedSourceRevision: '' as unknown as string, idempotencyKey: 'key-1', request }, services)).rejects.toThrow('missing-source-cas');
    await expect(submitEntityBuilder({ selector: { type: 'workflow', id: 'research-brief' }, project: 'kb-ops', expectedSourceRevision: 'sha-1', idempotencyKey: 42 as unknown as string, request }, services)).rejects.toThrow('missing-source-cas');
  });

  it('requires a known project for workflow creates and rejects unknown agent projects', async () => {
    const port = { save: async () => ({ status: 'pending' as const, operationId: 'op-1', replayed: false }) };
    const services = { resolve: () => { throw new Error('must-not-resolve'); }, catalog, port };
    await expect(submitEntityBuilder({ selector: { type: 'workflow', id: 'research-brief' }, expectedSourceRevision: 'sha-1', idempotencyKey: 'key-1', request }, services)).rejects.toThrow('project-required');
    await expect(submitEntityBuilder({ selector: { type: 'agent', id: 'grader' }, project: 'unknown-org', expectedSourceRevision: 'sha-1', idempotencyKey: 'key-2', request }, services)).rejects.toThrow('unknown-project');
  });

  it('uses the server-resolved source path and delegates exact idempotent replay to the durable port', async () => {
    const calls: unknown[] = [];
    let prior: string | null = null;
    const port = { save: async (input: unknown) => {
      calls.push(input);
      const digest = JSON.stringify(input);
      if (prior !== null && prior !== digest) throw new Error('idempotency-body-conflict');
      const replayed = prior !== null;
      prior = digest;
      return { status: 'pending' as const, operationId: 'op-1', replayed };
    } };
    const args = { selector: { type: 'workflow' as const, id: 'research-brief' }, project: 'kb-ops', expectedSourceRevision: 'sha-1', idempotencyKey: 'key-1', request };
    const services = { resolve: () => ({ type: 'workflow' as const, id: 'research-brief', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/research-brief.md' as const }), catalog, port };
    const first = await submitEntityBuilder(args, services);
    await expect(submitEntityBuilder(args, services)).resolves.toEqual({ ...first, replayed: true });
    await expect(submitEntityBuilder({ ...args, request: { ...request, purpose: 'Changed.' } }, services)).rejects.toThrow('idempotency-body-conflict');
    expect(calls).toHaveLength(3);
    expect(calls[0]).toMatchObject({ sourcePath: 'orgs/kb-ops/workflows/research-brief.md', expectedSourceRevision: 'sha-1' });
  });

  it('serializes server-derived Agent/Workflow paths and patches only form-owned frontmatter', () => {
    const materialized = { ...request, project: 'kb-ops' };
    const agent = renderAgentBuilderSource('researcher', materialized);
    const workflow = renderWorkflowBuilderSource('research-flow', materialized);
    expect(agent).toContain('id: "researcher"');
    expect(agent).toContain('projects: ["kb-ops"]');
    expect(workflow).toContain('target: orgs/kb-ops/output');
    expect(workflow).not.toContain('sourcePath');
    const patched = patchEntityBuilderSource('workflow', workflow.replace('    agentId: none\n', ''), { ...materialized, humanName: 'Renamed' });
    expect(patched).toContain('title: "Renamed"');
    expect(patched).toContain('    action: draft:builder');
  });

  it('round-trips every catalog-backed builder choice through workflow create and edit parsing', () => {
    const materialized = materializeEntityBuilderRequest(request, catalog, {
      selector: { type: 'workflow', id: 'research-flow' }, project: 'kb-ops',
    });
    const created = parseWorkflowDef(renderWorkflowBuilderSource('research-flow', materialized));
    if (!created.ok) throw new Error(created.detail);
    expect(created).toMatchObject({ ok: true, value: {
      project: 'kb-ops', title: request.humanName, purpose: request.purpose,
      model: request.model, profile: request.profile, tools: request.tools, skills: request.skills,
      connectors: request.connectors, filesystemRoots: request.filesystemRoots,
    } });
    const changed = {
      ...materialized, humanName: 'Edited Research Flow', purpose: 'Edited purpose.',
      tools: [...request.tools].reverse(), skills: [...request.skills].reverse(),
      connectors: [...request.connectors].reverse(), filesystemRoots: [...request.filesystemRoots].reverse(),
    };
    const patched = patchEntityBuilderSource('workflow', renderWorkflowBuilderSource('research-flow', materialized), changed);
    expect(patched).not.toBeNull();
    const edited = parseWorkflowDef(patched!);
    expect(edited).toMatchObject({ ok: true, value: {
      project: 'kb-ops', title: changed.humanName, purpose: changed.purpose,
      model: changed.model, profile: changed.profile, tools: changed.tools, skills: changed.skills,
      connectors: changed.connectors, filesystemRoots: changed.filesystemRoots,
    } });
  });

  it('round-trips every catalog-backed builder choice and display name through Agent create and edit parsing', () => {
    const root = mkdtempSync(join(tmpdir(), 'agent-builder-roundtrip-'));
    try {
      mkdirSync(join(root, 'agents'));
      const materialized = materializeEntityBuilderRequest(request, catalog, { selector: { type: 'agent', id: 'researcher' }, project: 'kb-ops' });
      const path = join(root, 'agents', 'researcher.md');
      writeFileSync(path, renderAgentBuilderSource('researcher', materialized));
      const created = readDeclaredAgentDetails(root).get('researcher');
      expect(created).toMatchObject({
        model: request.model, defaultProfile: request.profile, tools: request.tools, skills: request.skills,
        connectors: request.connectors, filesystemRoots: request.filesystemRoots, description: request.purpose,
        instructionMarkdown: expect.stringContaining(`# ${request.humanName}`),
      });
      const changed = { ...materialized, humanName: 'Edited Researcher', purpose: 'Edited purpose.', connectors: [...request.connectors].reverse() };
      const patched = patchEntityBuilderSource('agent', renderAgentBuilderSource('researcher', materialized), changed);
      if (!patched) throw new Error('agent patch refused');
      writeFileSync(path, patched);
      const edited = readDeclaredAgentDetails(root).get('researcher');
      expect(edited).toMatchObject({
        model: changed.model, defaultProfile: changed.profile, tools: changed.tools, skills: changed.skills,
        connectors: changed.connectors, filesystemRoots: changed.filesystemRoots, description: changed.purpose,
        instructionMarkdown: expect.stringContaining(`# ${changed.humanName}`),
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

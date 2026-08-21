import { describe, expect, it } from 'vitest';
import { materializeEntityBuilderRequest, submitEntityBuilder } from './builder.ts';

const catalog = {
  models: ['gpt-5.6-sol'],
  profiles: ['research-profile'],
  tools: ['web.search'],
  skills: ['research'],
  connectors: [{ server: 'github', tools: ['issues.read'] }],
  filesystemRoots: { kb: 'orgs/kb-ops' },
};

const request = {
  humanName: 'Research Brief',
  purpose: 'Research.',
  model: 'gpt-5.6-sol',
  tools: ['web.search'],
  skills: ['research'],
  connectors: [{ server: 'github', tools: ['issues.read'] }],
  filesystemRoots: ['kb'],
};

describe('entity builder', () => {
  it('accepts cataloged display and policy choices, including profiles and symbolic roots', () => {
    expect(materializeEntityBuilderRequest(request, catalog)).toMatchObject({
      model: 'gpt-5.6-sol',
      connectors: [{ server: 'github', tools: ['issues.read'] }],
      filesystemRoots: ['kb'],
    });
    expect(materializeEntityBuilderRequest({ ...request, model: 'research-profile' }, catalog)).toMatchObject({ model: 'research-profile' });
  });

  it('closes model, capability, connector, connector tool, and symbolic root catalogs', () => {
    expect(() => materializeEntityBuilderRequest({ ...request, model: 'unknown' }, catalog)).toThrow('unknown-model');
    expect(() => materializeEntityBuilderRequest({ ...request, skills: ['untrusted-capability'] }, catalog)).toThrow('unknown-capability');
    expect(() => materializeEntityBuilderRequest({ ...request, connectors: [{ server: 'not-github', tools: [] }] }, catalog)).toThrow('unknown-connector');
    expect(() => materializeEntityBuilderRequest({ ...request, connectors: [{ server: 'github', tools: ['repos.write'] }] }, catalog)).toThrow('unknown-tool');
    expect(() => materializeEntityBuilderRequest({ ...request, tools: ['shell'] }, catalog)).toThrow('unknown-tool');
    expect(() => materializeEntityBuilderRequest({ ...request, filesystemRoots: ['unknown-root'] }, catalog)).toThrow('unknown-root');
  });

  it('rejects needs, path, sourcePath, and absolute path fields by name', () => {
    for (const [name, value] of [
      ['needs', ['network']],
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
    await expect(submitEntityBuilder({ selector: { type: 'workflow', id: 'research-brief' }, expectedSourceRevision: '' as unknown as string, idempotencyKey: 'key-1', request }, services)).rejects.toThrow('missing-source-cas');
    await expect(submitEntityBuilder({ selector: { type: 'workflow', id: 'research-brief' }, expectedSourceRevision: 'sha-1', idempotencyKey: 42 as unknown as string, request }, services)).rejects.toThrow('missing-source-cas');
  });

  it('uses the server-resolved source path and owns exact idempotent replay', async () => {
    const calls: unknown[] = [];
    const port = { save: async (input: unknown) => { calls.push(input); return { status: 'pending' as const, operationId: 'op-1', replayed: false }; } };
    const args = { selector: { type: 'workflow' as const, id: 'research-brief' }, expectedSourceRevision: 'sha-1', idempotencyKey: 'key-1', request };
    const services = { resolve: () => ({ type: 'workflow' as const, id: 'research-brief', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/research-brief.md' as const }), catalog, port };
    const first = await submitEntityBuilder(args, services);
    await expect(submitEntityBuilder(args, services)).resolves.toEqual(first);
    await expect(submitEntityBuilder({ ...args, request: { ...request, purpose: 'Changed.' } }, services)).rejects.toThrow('idempotency-body-conflict');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ sourcePath: 'orgs/kb-ops/workflows/research-brief.md', expectedSourceRevision: 'sha-1' });
  });
});

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadExecutionProfiles, loadPolicyEnvironment, loadRuntimeSkillRegistry, loadWorkflowCompileEnvironment, loadWorkflowProfiles } from './environment.ts';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'control-environment-'));
  mkdirSync(join(root, 'governance'), { recursive: true });
  mkdirSync(join(root, 'orgs', 'demo'), { recursive: true });
  mkdirSync(join(root, 'skills', 'curated', 'tests'), { recursive: true });
  mkdirSync(join(root, 'skills', 'learned', 'unsafe'), { recursive: true });
  mkdirSync(join(root, 'agents'), { recursive: true });
  writeFileSync(join(root, 'CLAUDE.md'), 'constitution');
  writeFileSync(join(root, 'governance', 'agent-rules.md'), 'agent rules');
  writeFileSync(join(root, 'orgs', 'demo', 'contract.md'), 'contract');
  writeFileSync(join(root, 'governance', 'model-routing.yaml'), [
    'version: 1', 'runtimes:', '  claude:', '    known_models: [claude-opus]',
    '  codex:', '    known_models: [codex-safe]', '',
  ].join('\n'));
  writeFileSync(join(root, 'skills', 'curated', 'tests', 'SKILL.md'), '---\nname: tests\ndescription: Test safely.\n---\n');
  writeFileSync(join(root, 'skills', 'learned', 'unsafe', 'SKILL.md'), '---\nname: unsafe\ndescription: Not promoted.\n---\n');
  writeFileSync(join(root, 'agents', 'demo-worker.md'), [
    '---', 'id: demo-worker', 'runtime: codex', 'model: codex-safe',
    'default-profile: worker:codex:codex-safe', 'allowed-profiles: [worker:codex:codex-safe]',
    'projects: [demo]', 'runner-bound: true', 'description: Demo worker.', '---', 'Bounded instructions.', '',
  ].join('\n'));
  return root;
}

describe('control environment', () => {
  it('exposes registered runtime/model pairs and curated skills only', () => {
    const registry = loadRuntimeSkillRegistry(fixture());
    expect(registry.runtimes).toEqual({ claude: ['claude-opus'], codex: ['codex-safe'] });
    expect(registry.skills).toContain('tests');
    expect(registry.skills).not.toContain('unsafe');
    expect(registry.repositories.forProject('atlas').id).toBe('atlas@1');
    expect(() => registry.repositories.forProject('atlas-prep')).toThrow(/not registered/);
  });

  it('builds fixed manager/worker profiles without arbitrary browser capabilities', () => {
    const profiles = loadExecutionProfiles(fixture());
    expect(profiles).toContainEqual(expect.objectContaining({ id: 'manager:claude:claude-opus', role: 'manager' }));
    expect(profiles).toContainEqual(expect.objectContaining({ id: 'manager:codex:codex-safe', role: 'manager', runtime: 'codex' }));
    expect(profiles).toContainEqual(expect.objectContaining({ id: 'worker:codex:codex-safe', role: 'worker' }));
  });

  it('loads one server-owned workflow compiler environment from the runtime, declaration, and profile loaders', () => {
    const env = loadWorkflowCompileEnvironment(fixture());
    expect(env.registry.runtimes).toEqual({ claude: ['claude-opus'], codex: ['codex-safe'] });
    expect(env.availableRuntimes).toEqual(new Set(['claude', 'codex']));
    expect(env.executionProfiles).toContainEqual(expect.objectContaining({ id: 'worker:codex:codex-safe' }));
    expect(env.declaredAgents.get('demo-worker')).toMatchObject({
      source: 'agents/demo-worker.md', runnerBound: true, projects: ['demo'],
    });
  });

  it('exposes the readonly checker tool profile without write, shell, network, or publish tools', () => {
    const checker = loadWorkflowProfiles().find((profile) => profile.id === 'checker-readonly');
    expect(checker?.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
  });

  it('loads only supported executable governance references', () => {
    const env = loadPolicyEnvironment(fixture(), 'demo', [
      'CLAUDE.md', 'governance/agent-rules.md', 'orgs/demo/contract.md', 'governance/secrets.md', '../outside',
    ]);
    expect(Object.keys(env.governanceContents).sort()).toEqual([
      'CLAUDE.md', 'governance/agent-rules.md', 'orgs/demo/contract.md',
    ]);
    expect(env.contractText).toBe('contract');
  });
});

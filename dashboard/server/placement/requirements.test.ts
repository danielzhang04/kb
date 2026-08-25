import { describe, expect, it } from 'vitest';
import { ContractDecodeError } from './contracts.ts';
import { computeCapabilityRequirement } from './requirements.ts';
import type { StageAgentCapabilityFields, WorkflowCapabilityFields } from './requirements.ts';

const agent = (overrides: Partial<StageAgentCapabilityFields> = {}): StageAgentCapabilityFields => ({
  skills: [], connectors: [], filesystemRoots: [], runtime: null, ...overrides,
});

describe('computeCapabilityRequirement — union of workflow + every assigned stage agent (§3.2, design:383)', () => {
  it('unions skills and filesystemRoots from the workflow and every stage agent', () => {
    const workflow: WorkflowCapabilityFields = { skills: ['research'], filesystemRoots: ['kb'] };
    const stageAgents = [agent({ skills: ['docx'], filesystemRoots: ['ops'] }), agent({ skills: ['xlsx'] })];
    const req = computeCapabilityRequirement(workflow, stageAgents);
    expect(req.skills).toEqual(['docx', 'research', 'xlsx']);
    expect(req.filesystemRoots).toEqual(['kb', 'ops']);
  });

  it('merges connector tool sets by server rather than colliding as duplicate servers', () => {
    const workflow: WorkflowCapabilityFields = { connectors: [{ server: 'gmail', tools: ['read'] }] };
    const stageAgents = [
      agent({ connectors: [{ server: 'gmail', tools: ['send'] }] }),
      agent({ connectors: [{ server: 'slack', tools: ['post'] }] }),
    ];
    const req = computeCapabilityRequirement(workflow, stageAgents);
    expect(req.connectors).toEqual([
      { server: 'gmail', tools: ['read', 'send'] },
      { server: 'slack', tools: ['post'] },
    ]);
  });

  it('normalises once: mixed-case/underscored declared names come out already canonical', () => {
    const workflow: WorkflowCapabilityFields = { skills: ['Multi_Source_Synthesis'] };
    const req = computeCapabilityRequirement(workflow, []);
    expect(req.skills).toEqual(['multi-source-synthesis']);
  });

  it('rejects an over-bound or malformed union at the same exact-key wall decodeCapabilityRequirement enforces', () => {
    const workflow: WorkflowCapabilityFields = { skills: ['a/b'] };
    expect(() => computeCapabilityRequirement(workflow, [])).toThrow(ContractDecodeError);
  });

  it('ignores workflow.tools — built-in tool ids are not part of CapabilityRequirement (§3.2)', () => {
    const workflow: WorkflowCapabilityFields = { tools: ['web.search', 'shell'] };
    const req = computeCapabilityRequirement(workflow, []);
    expect(Object.keys(req).sort()).toEqual(['clis', 'connectors', 'filesystemRoots', 'gpu', 'pty', 'skills']);
  });

  it('derives the clis requirement from each assigned stage agent\'s declared runtime, ignoring unrecognized/null runtimes', () => {
    const stageAgents = [agent({ runtime: 'claude' }), agent({ runtime: 'codex' }), agent({ runtime: 'claude' }), agent({ runtime: null }), agent({ runtime: 'python' })];
    const req = computeCapabilityRequirement({}, stageAgents);
    expect(req.clis).toEqual(['claude', 'codex']);
  });

  it('merges the same server named with different casing/underscoring by two stage agents into one canonical entry with the union of tools (W3b fix)', () => {
    const stageAgents = [
      agent({ connectors: [{ server: 'Gmail', tools: ['read'] }, { server: 'my_server', tools: ['a'] }] }),
      agent({ connectors: [{ server: 'gmail', tools: ['send'] }, { server: 'my-server', tools: ['b'] }] }),
    ];
    const req = computeCapabilityRequirement({}, stageAgents);
    expect(req.connectors).toEqual([
      { server: 'gmail', tools: ['read', 'send'] },
      { server: 'my-server', tools: ['a', 'b'] },
    ]);
  });

  it('de-dupes overlapping tool sets declared for the same server by different agents', () => {
    const stageAgents = [
      agent({ connectors: [{ server: 'gmail', tools: ['read', 'send'] }] }),
      agent({ connectors: [{ server: 'gmail', tools: ['send', 'draft'] }] }),
    ];
    const req = computeCapabilityRequirement({}, stageAgents);
    expect(req.connectors).toEqual([{ server: 'gmail', tools: ['draft', 'read', 'send'] }]);
  });

  it('defaults pty/gpu closed with no declaration source, but accepts an explicit override', () => {
    expect(computeCapabilityRequirement({}, [])).toMatchObject({ pty: false, gpu: false });
    expect(computeCapabilityRequirement({}, [], { pty: true, gpu: true })).toMatchObject({ pty: true, gpu: true });
  });
});

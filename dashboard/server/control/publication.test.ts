import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GitRunner } from '../write/branch.ts';
import { workflowCardId } from '../write/workflowRun.ts';
import type { PlanProposal } from './proposal.ts';
import { reconcileCanonicalPublication } from './publication.ts';

const proposal: PlanProposal = {
  schema: 'kb.plan-proposal/v1', proposalId: 'two-stage', project: 'kb-ops', title: 'Two', summary: 'Two stages.',
  manager: { runtime: 'claude', model: 'claude-opus', requiredSkills: [] },
  scope: { read: ['dashboard'], write: ['dashboard'] },
  governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/kb-ops/contract.md'],
  stages: [
    { id: 'one', title: 'One', action: 'test:one', target: 'dashboard/server', workOrder: 'One.', riskTier: 'T2', dependsOn: [], worker: { runtime: 'codex', model: 'codex-safe' }, requiredSkills: [], scope: { read: ['dashboard'], write: ['dashboard/server'] }, artifacts: [], checkpoints: [], humanGates: [] },
    { id: 'two', title: 'Two', action: 'test:two', target: 'dashboard/src', workOrder: 'Two.', riskTier: 'T2', dependsOn: ['one'], worker: { runtime: 'codex', model: 'codex-safe' }, requiredSkills: [], scope: { read: ['dashboard'], write: ['dashboard/src'] }, artifacts: [], checkpoints: [], humanGates: [] },
  ],
};

function card(runRef: string, stage: PlanProposal['stages'][number], state: string): string {
  const dependencies = stage.dependsOn.map((id) => workflowCardId(runRef, id));
  return `---\nid: ${workflowCardId(runRef, stage.id)}\nproject: kb-ops\naction: ${stage.action}\ntarget: ${stage.target}\nrisk-tier: T2\nowner: codex-worker\nstate: ${state}\nworkflow: ${runRef}\ndepends-on: [${dependencies.join(', ')}]\nruntime: codex\nmodel: codex-safe\n---\n\n## Work order\n\n${stage.workOrder}\n`;
}

describe('canonical publication reconciliation', () => {
  it('accepts exact tracked cards, including logical blocked under physical inbox', () => {
    const root = mkdtempSync(join(tmpdir(), 'publication-'));
    mkdirSync(join(root, 'queue', 'inbox'), { recursive: true });
    const runRef = 'run-1';
    for (const stage of proposal.stages) writeFileSync(join(root, 'queue', 'inbox', `${workflowCardId(runRef, stage.id)}.md`), card(runRef, stage, stage.dependsOn.length ? 'blocked' : 'inbox'));
    const runGit: GitRunner = (_root, args) => args[0] === 'ls-files' ? String(args.at(-1)) : '';
    expect(reconcileCanonicalPublication({ repoRoot: root, runRef, proposal, defaultWorkers: { codex: 'codex-worker' }, runGit })).toMatchObject({
      ok: true, cards: [{ stageId: 'one', stageState: 'ready' }, { stageId: 'two', stageState: 'blocked' }],
    });
  });

  it('refuses dirty and proposal-mismatched canonical cards', () => {
    const root = mkdtempSync(join(tmpdir(), 'publication-dirty-'));
    mkdirSync(join(root, 'queue', 'inbox'), { recursive: true });
    const runRef = 'run-2';
    for (const stage of proposal.stages) writeFileSync(join(root, 'queue', 'inbox', `${workflowCardId(runRef, stage.id)}.md`), card(runRef, stage, stage.dependsOn.length ? 'blocked' : 'inbox'));
    const dirty: GitRunner = (_root, args) => {
      if (args[0] === 'ls-files') return String(args.at(-1));
      throw new Error('dirty');
    };
    expect(reconcileCanonicalPublication({ repoRoot: root, runRef, proposal, defaultWorkers: { codex: 'codex-worker' }, runGit: dirty })).toMatchObject({ ok: false, reason: 'uncommitted-card' });
    const clean: GitRunner = (_root, args) => args[0] === 'ls-files' ? String(args.at(-1)) : '';
    writeFileSync(join(root, 'queue', 'inbox', `${workflowCardId(runRef, 'one')}.md`), card(runRef, { ...proposal.stages[0], action: 'test:forged' }, 'inbox'));
    expect(reconcileCanonicalPublication({ repoRoot: root, runRef, proposal, defaultWorkers: { codex: 'codex-worker' }, runGit: clean })).toMatchObject({ ok: false, reason: 'card-mismatch' });
  });
});

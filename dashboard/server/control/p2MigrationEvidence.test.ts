import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readDeclaredAgentDetails } from '../agents/roster.ts';
import { compileWorkflowDef } from '../workflows/compile.ts';
import { sourceHash } from '../workflows/amendments.ts';
import { scanWorkflowDefs } from '../workflows/routes.ts';
import { loadWorkflowCompileEnvironment } from './environment.ts';
import { loadP2MigrationEvidence } from './p2MigrationEvidence.ts';
import { proposalContentHash } from './proposal.ts';
import { resolveLegacyRunIdentity } from './runIdentity.ts';

const SOURCE_ROOT = resolve(process.cwd(), '..');
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function canonicalHash(bytes: Buffer): string {
  const withoutBom = bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) ? bytes.subarray(3) : bytes;
  return createHash('sha256').update(Buffer.from(withoutBom.toString('utf8').replace(/\r\n/g, '\n'), 'utf8')).digest('hex');
}

function checkoutBytes(sourcePath: string, eol: '\n' | '\r\n', bom: boolean): Buffer {
  const source = readFileSync(join(SOURCE_ROOT, ...sourcePath.split('/')), 'utf8')
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n');
  return Buffer.from(`${bom ? '\uFEFF' : ''}${source.replace(/\n/g, eol)}`, 'utf8');
}

function write(root: string, relativePath: string, bytes: Buffer | string): void {
  const path = join(root, ...relativePath.split('/'));
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

function workflowProposalHash(repoRoot: string): string {
  const scanned = scanWorkflowDefs(repoRoot).find((candidate) => candidate.def?.id === 'research-brief');
  if (!scanned?.def) throw new Error('research-brief fixture did not parse');
  const compiled = compileWorkflowDef(scanned.def, loadWorkflowCompileEnvironment(repoRoot));
  if (!compiled.ok) throw new Error(`research-brief fixture did not compile: ${compiled.reason}`);
  return proposalContentHash(compiled.value);
}

function evidenceFor(eol: '\n' | '\r\n', bom: boolean) {
  const root = mkdtempSync(join(tmpdir(), 'p2-migration-eol-'));
  roots.push(root);
  write(root, 'agents/grader.md', checkoutBytes('agents/grader.md', eol, bom));
  write(root, 'orgs/kb-ops/workflows/research-brief.md', checkoutBytes('orgs/kb-ops/workflows/research-brief.md', eol, bom));
  write(root, 'governance/model-routing.yaml', checkoutBytes('governance/model-routing.yaml', eol, bom));
  write(root, 'ledgers/audit/dashboard-audit.ndjson', '');
  const proposalHash = workflowProposalHash(root);
  write(root, 'ledgers/audit/dashboard-audit.ndjson', `${JSON.stringify({
    ts: '2026-08-21T00:00:00.000Z', action: 'control-run-launch', owner: 'operator', target: 'run-workflow',
    riskTier: 'T2', result: `launched:run-workflow:${proposalHash}`,
    detail: { source: 'workflow:research-brief', proposalRef: 'proposal-workflow', proposalRevision: 1, proposalHash },
  })}\n`);
  return { root, proposalHash, evidence: loadP2MigrationEvidence(root) };
}

describe('P2 migration evidence text hashing', () => {
  it('resolves the same Agent and Workflow candidates from LF or CRLF checkout bytes and ignores a UTF-8 BOM', () => {
    const lf = evidenceFor('\n', false);
    const crlf = evidenceFor('\r\n', false);
    const storedAgentHash = canonicalHash(checkoutBytes('agents/grader.md', '\n', false));

    expect(sourceHash(checkoutBytes('orgs/kb-ops/workflows/research-brief.md', '\n', true)))
      .toBe(sourceHash(checkoutBytes('orgs/kb-ops/workflows/research-brief.md', '\n', false)));
    expect(readDeclaredAgentDetails(lf.root).get('grader')?.sourceHash).toBe(storedAgentHash);
    expect(readDeclaredAgentDetails(crlf.root).get('grader')?.sourceHash).toBe(storedAgentHash);
    expect(lf.evidence.agentDeclarations).toEqual(crlf.evidence.agentDeclarations);
    expect(lf.evidence.workflowDefinitions).toEqual(crlf.evidence.workflowDefinitions);

    for (const variant of [lf, crlf]) {
      expect(resolveLegacyRunIdentity({
        runRef: 'run-agent', location: 'runs[0]', executionHost: 'vm', proposal: null,
        agentWorkspaceLaunch: {
          agentId: 'grader', declarationPath: 'agents\\grader.md', declarationHash: storedAgentHash,
        },
        agentDeclarations: variant.evidence.agentDeclarations,
        workflowDefinitions: variant.evidence.workflowDefinitions,
        workflowLaunchAudits: variant.evidence.workflowLaunchAudits,
      })).toMatchObject({ ok: true, value: { owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' } } });

      expect(resolveLegacyRunIdentity({
        runRef: 'run-workflow', location: 'runs[1]', executionHost: 'vm', agentWorkspaceLaunch: null,
        proposal: { proposalRef: 'proposal-workflow', proposalRevision: 1, proposalHash: variant.proposalHash },
        agentDeclarations: variant.evidence.agentDeclarations,
        workflowDefinitions: variant.evidence.workflowDefinitions,
        workflowLaunchAudits: variant.evidence.workflowLaunchAudits,
      })).toMatchObject({ ok: true, value: { owner: { type: 'workflow', id: 'research-brief', project: 'kb-ops' } } });
    }
  });
});

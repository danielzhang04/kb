import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { runMigrationReportCli } from './migrationReport.ts';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it('prints one canonical dry-run report and never writes the supplied store copy', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-p2-dry-run-'));
  roots.push(root);
  const path = join(root, 'control-plane-copy.json');
  const source = `${JSON.stringify({
    version: 2, documentRevision: 0, nextEventCursor: 1,
    proposals: [], runs: [], stages: [], attempts: [], sessions: [], humanRequests: [], events: [],
    stageGenerations: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [],
    generationSupersessions: [], quarantine: [], deployments: [],
  })}\n`;
  writeFileSync(path, source, 'utf8');
  const before = readFileSync(path);
  const output: string[] = [];
  const result = runMigrationReportCli(['node', 'migrationReport.ts', '--dry-run', path], {
    writeLine: (line) => output.push(line),
    executionHost: 'desktop',
    agentDeclarations: [], workflowDefinitions: [], workflowLaunchAudits: [], auditRows: [],
  });
  expect(result).toBe(0);
  expect(output).toHaveLength(1);
  expect(JSON.parse(output[0])).toEqual({
    schema: 'kb.control-plane-p2-dry-run/v1',
    source: {
      path,
      sha256: createHash('sha256').update(before).digest('hex'),
      version: 2,
      bytes: before.byteLength,
    },
    runIdentity: { migration: 'migrateRunIdentityV1', total: 0, migrated: 0, errors: [], truncated: false },
    runOutcome: { migration: 'migrateRunOutcomeV1', total: 0, migrated: 0, errors: [], truncated: false },
    wouldWrite: false,
  });
  expect(readFileSync(path)).toEqual(before);
});

it('accepts an explicit run mapping only when it is keyed to the exact store SHA', () => {
  const root = mkdtempSync(join(tmpdir(), 'kb-p2-explicit-map-'));
  roots.push(root);
  const path = join(root, 'control-plane-copy.json');
  const source = `${JSON.stringify({
    version: 2, documentRevision: 0, nextEventCursor: 1,
    proposals: [],
    runs: [{
      subject: 'alice', runRef: 'run-unmapped', predecessorRunRef: null, title: 'Unmapped run',
      proposalRef: null, proposalRevision: null, proposalHash: null,
      publicationState: 'published', lifecycle: { kind: 'running', deployPause: null }, version: 1,
      managerSessionRef: null, managerGeneration: 0, managerAssignment: null,
      agentWorkspaceLaunch: null, activationReceipts: [], authorizedFailedRunReconciliation: null,
      createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
    }],
    stages: [], attempts: [], sessions: [], humanRequests: [], events: [],
    stageGenerations: [], iterationLoops: [], iterationRequests: [], iterationReceipts: [],
    generationSupersessions: [], quarantine: [], deployments: [],
  })}\n`;
  writeFileSync(path, source, 'utf8');
  const sha256 = createHash('sha256').update(source).digest('hex');
  const runs = {
    'run-unmapped': {
      owner: { type: 'agent' as const, id: 'grader', sourcePath: 'agents/grader.md' as const },
      executionHost: 'desktop' as const,
      terminalOutcome: null,
      completedAt: null,
      archivedFrom: null,
    },
  };
  const output: string[] = [];
  expect(runMigrationReportCli(['node', 'migrationReport.ts', '--dry-run', path], {
    explicitMapping: { storeSha256: sha256, runs },
    writeLine: (line) => output.push(line),
  })).toBe(0);
  expect(JSON.parse(output[0])).toMatchObject({
    runIdentity: { total: 1, migrated: 1, errors: [] },
    runOutcome: { total: 1, migrated: 1, errors: [] },
    wouldWrite: false,
  });
  expect(() => runMigrationReportCli(['node', 'migrationReport.ts', '--dry-run', path], {
    explicitMapping: { storeSha256: '0'.repeat(64), runs },
  })).toThrow(/store SHA mismatch/);
  expect(readFileSync(path, 'utf8')).toBe(source);
});

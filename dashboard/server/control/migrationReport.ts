import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { reportP2RunMigrations, type MigrationContext } from './migrations.ts';
import { restoreControlPlaneMigrationBackupSync } from './persistence.ts';
import { acquireWriterLease } from './writerLease.ts';

export interface MigrationReportCliDeps extends Omit<MigrationContext, 'stamp' | 'sourceSha256'> {
  writeLine?: (line: string) => void;
}

export const P2_MAINTENANCE_COMMANDS = {
  dryRun: 'node dashboard/server/control/migrationReport.ts --dry-run <control-plane-copy.json>',
  restore: 'node dashboard/server/control/migrationReport.ts --restore <state-root> <backup.json>',
} as const;

export function runMigrationReportCli(argv: readonly string[], deps: MigrationReportCliDeps = {}): number {
  const restoreIndex = argv.indexOf('--restore');
  if (restoreIndex >= 0) {
    const stateRoot = argv[restoreIndex + 1];
    const backupPath = argv[restoreIndex + 2];
    if (!stateRoot || !backupPath || argv.length !== restoreIndex + 3) return 2;
    const lease = acquireWriterLease({ stateRoot, bootId: `control-plane-restore-${process.pid}` });
    try {
      const restored = restoreControlPlaneMigrationBackupSync(stateRoot, backupPath, lease);
      (deps.writeLine ?? console.log)(JSON.stringify({
        schema: 'kb.control-plane-p2-restore/v1', restored: true,
        stateRoot, backupPath: restored.path, sha256: restored.sha256,
      }));
      return 0;
    } finally {
      lease.release();
    }
  }
  const dryRunIndex = argv.indexOf('--dry-run');
  const path = dryRunIndex < 0 ? undefined : argv[dryRunIndex + 1];
  if (!path || argv.length !== dryRunIndex + 2) return 2;
  const source = readFileSync(path);
  const parsed = JSON.parse(source.toString('utf8')) as Record<string, unknown>;
  const sha256 = createHash('sha256').update(source).digest('hex');
  const report = reportP2RunMigrations(parsed, {
    stamp: new Date(0).toISOString(),
    executionHost: deps.executionHost ?? (process.platform === 'win32' ? 'desktop' : 'vm'),
    agentDeclarations: deps.agentDeclarations ?? [],
    workflowDefinitions: deps.workflowDefinitions ?? [],
    workflowLaunchAudits: deps.workflowLaunchAudits ?? [],
    auditRows: deps.auditRows ?? [],
    explicitMapping: deps.explicitMapping,
    sourceSha256: sha256,
  });
  (deps.writeLine ?? console.log)(JSON.stringify({
    schema: 'kb.control-plane-p2-dry-run/v1',
    source: { path, sha256, version: parsed.version, bytes: source.byteLength },
    runIdentity: report.runIdentity,
    runOutcome: report.runOutcome,
    wouldWrite: false,
  }));
  return report.runIdentity.errors.length === 0 && report.runOutcome.errors.length === 0 ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = runMigrationReportCli(process.argv);
}

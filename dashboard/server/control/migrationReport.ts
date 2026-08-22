import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { reportP2RunMigrations, type MigrationContext } from './migrations.ts';

export interface MigrationReportCliDeps extends Omit<MigrationContext, 'stamp' | 'sourceSha256'> {
  writeLine?: (line: string) => void;
}

export function runMigrationReportCli(argv: readonly string[], deps: MigrationReportCliDeps = {}): number {
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

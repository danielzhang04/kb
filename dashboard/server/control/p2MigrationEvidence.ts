import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readDeclaredAgentDetails } from '../agents/roster.ts';
import { AUDIT_REL_PATH } from '../audit/log.ts';
import { compileWorkflowDef } from '../workflows/compile.ts';
import { scanWorkflowDefs } from '../workflows/routes.ts';
import { loadWorkflowCompileEnvironment } from './environment.ts';
import { proposalContentHash } from './proposal.ts';
import { normalizeRepoRelativePath, normalizedTextSha256 } from './textArtifactHash.ts';
import type { MigrationContext } from './migrations.ts';

type P2Evidence = Required<Pick<MigrationContext,
  'agentDeclarations' | 'workflowDefinitions' | 'workflowLaunchAudits' | 'auditRows'>>;
type ArchiveAudit = NonNullable<MigrationContext['auditRows']>[number];

const MAX_AUDIT_BYTES = 64 * 1024 * 1024;

function checkedDeclarationHash(repoRoot: string, sourcePath: string, scannedHash: string): string {
  const normalizedPath = normalizeRepoRelativePath(sourcePath);
  const recomputed = normalizedTextSha256(readFileSync(join(repoRoot, ...normalizedPath.split('/'))));
  if (normalizedPath !== sourcePath || recomputed !== scannedHash) {
    throw new Error(`migration declaration evidence changed while loading: ${normalizedPath}`);
  }
  return recomputed;
}

function readExactAuditRows(repoRoot: string): ArchiveAudit[] {
  const path = join(repoRoot, ...AUDIT_REL_PATH.split('/'));
  if (!existsSync(path)) throw new Error(`required migration evidence source is missing: ${AUDIT_REL_PATH}`);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_AUDIT_BYTES) {
    throw new Error(`required migration evidence source is unsafe: ${AUDIT_REL_PATH}`);
  }
  return readFileSync(path, 'utf8').split(/\r?\n/).filter(Boolean).map((line, index) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`invalid migration audit evidence at row ${index + 1}`);
    }
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)
      || typeof (parsed as Record<string, unknown>).ts !== 'string'
      || typeof (parsed as Record<string, unknown>).action !== 'string') {
      throw new Error(`invalid migration audit evidence at row ${index + 1}`);
    }
    return parsed as unknown as ArchiveAudit;
  });
}

/** Load every server-owned attestation source before a v2 store is opened or mutated. */
export function loadP2MigrationEvidence(repoRoot: string): P2Evidence {
  const auditRows = readExactAuditRows(repoRoot);
  const agentDeclarations = [...readDeclaredAgentDetails(repoRoot).values()].map((declaration) => ({
    id: declaration.id,
    sourcePath: declaration.source as `agents/${string}.md`,
    declarationHash: checkedDeclarationHash(repoRoot, declaration.source, declaration.sourceHash),
  }));
  const definitions = scanWorkflowDefs(repoRoot).flatMap((scanned) => {
    if (!scanned.def || !scanned.entry.valid || !scanned.entry.sourceHash) return [];
    const compiled = compileWorkflowDef(scanned.def, loadWorkflowCompileEnvironment(repoRoot));
    return compiled.ok ? [{ scanned, proposalHash: proposalContentHash(compiled.value) }] : [];
  });
  const workflowDefinitions: NonNullable<MigrationContext['workflowDefinitions']>[number][] = [];
  const workflowLaunchAudits: NonNullable<MigrationContext['workflowLaunchAudits']>[number][] = [];
  for (const row of auditRows) {
    if (row.action !== 'control-run-launch' || typeof row.result !== 'string') continue;
    const detail = row.detail;
    if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) continue;
    const fields = detail as Record<string, unknown>;
    if (typeof fields.source !== 'string' || !fields.source.startsWith('workflow:')
      || typeof fields.proposalRef !== 'string' || !Number.isSafeInteger(fields.proposalRevision)
      || typeof fields.proposalHash !== 'string') continue;
    const runMatch = /^launched:([^:]+):([a-f0-9]{64})$/.exec(row.result);
    if (!runMatch || runMatch[2] !== fields.proposalHash) continue;
    const workflowId = fields.source.slice('workflow:'.length);
    const definition = definitions.find((candidate) => candidate.scanned.def?.id === workflowId
      && candidate.proposalHash === fields.proposalHash);
    if (!definition || !definition.scanned.entry.sourceHash) continue;
    const { entry } = definition.scanned;
    const declarationHash = checkedDeclarationHash(repoRoot, entry.path, definition.scanned.entry.sourceHash);
    const proposalRef = fields.proposalRef;
    const proposalHash = fields.proposalHash;
    if (typeof proposalRef !== 'string' || typeof proposalHash !== 'string') continue;
    workflowDefinitions.push({
      id: workflowId,
      project: entry.project,
      sourcePath: entry.path as `orgs/${string}/workflows/${string}.md`,
      declarationHash,
      proposalRef,
      proposalRevision: Number(fields.proposalRevision),
      proposalHash,
    });
    workflowLaunchAudits.push({
      runRef: runMatch[1],
      workflowId,
      project: entry.project,
      sourcePath: entry.path as `orgs/${string}/workflows/${string}.md`,
      declarationHash,
    });
  }
  return { agentDeclarations, workflowDefinitions, workflowLaunchAudits, auditRows };
}

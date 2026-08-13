import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface RepositoryBinding { readonly registryId: string; readonly identity: string }
export interface RepositoryRecord extends RepositoryBinding {
  readonly id: string;
  readonly projects: readonly string[];
  readonly root: string;
  readonly remote: string;
  readonly baseRef: string;
  readonly scope: readonly string[];
  readonly credentialIdentity: string;
}
export interface RepositoryRegistry {
  forProject(project: string): RepositoryRecord;
  resolve(binding: RepositoryBinding): RepositoryRecord;
}

export function loadRepositoryRegistry(configPath: string, variables: Readonly<{ repoRoot: string }>): RepositoryRegistry {
  const source = JSON.parse(readFileSync(configPath, 'utf8')) as { version: unknown; repositories: unknown[] };
  if (source.version !== 1 || !Array.isArray(source.repositories)) throw new Error('repository registry version 1 is required');
  const byId = new Map<string, RepositoryRecord>();
  const byProject = new Map<string, RepositoryRecord>();
  for (const raw of source.repositories as Array<Record<string, unknown>>) {
    const allowed = new Set(['id', 'projects', 'root', 'remote', 'baseRef', 'scope', 'credentialIdentity']);
    if (Object.keys(raw).length !== allowed.size || Object.keys(raw).some((key) => !allowed.has(key))) throw new Error('repository registry fields are not the closed v1 set');
    if (typeof raw.id !== 'string' || !Array.isArray(raw.projects) || raw.projects.length === 0 || raw.projects.some((value) => typeof value !== 'string')) throw new Error('repository id/projects are invalid');
    if (raw.root !== '${DASHBOARD_REPO_ROOT}') throw new Error('Phase I repository root must use DASHBOARD_REPO_ROOT');
    if (typeof raw.remote !== 'string' || raw.remote.length === 0 || raw.baseRef !== 'ops' || typeof raw.credentialIdentity !== 'string' || raw.credentialIdentity.length === 0) throw new Error('Phase I repository source fields require recorded remote/credential labels and baseRef ops');
    if (!Array.isArray(raw.scope) || raw.scope.length === 0 || raw.scope.some((value) => typeof value !== 'string')) throw new Error('repository scope is invalid');
    const canonical = JSON.stringify({ id: raw.id, projects: raw.projects, root: raw.root, remote: raw.remote, baseRef: raw.baseRef, scope: raw.scope, credentialIdentity: raw.credentialIdentity });
    const identity = createHash('sha256').update(canonical).digest('hex');
    const root = variables.repoRoot;
    const record = Object.freeze({ ...raw, id: String(raw.id), projects: Object.freeze(raw.projects as string[]), root, remote: String(raw.remote), baseRef: String(raw.baseRef), scope: Object.freeze(raw.scope as string[]), credentialIdentity: String(raw.credentialIdentity), registryId: String(raw.id), identity }) as RepositoryRecord;
    if (byId.has(record.id)) throw new Error(`duplicate repository id: ${record.id}`);
    byId.set(record.id, record);
    for (const project of record.projects) {
      if (byProject.has(project)) throw new Error(`duplicate project registration: ${project}`);
      byProject.set(project, record);
    }
  }
  return Object.freeze({
    forProject(project: string) { const record = byProject.get(project); if (!record) throw new Error(`project is not registered: ${project}`); return record; },
    resolve(binding: RepositoryBinding) { const record = byId.get(binding.registryId); if (!record || record.identity !== binding.identity) throw new Error('repository binding identity is stale or unknown'); return record; },
  });
}

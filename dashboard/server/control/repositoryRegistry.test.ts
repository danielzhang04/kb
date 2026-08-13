import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { loadRepositoryRegistry } from './repositoryRegistry.ts';

it('binds a project immutably and refuses unknown or stale identities', () => {
  const dir = mkdtempSync(join(tmpdir(), 'repo-registry-'));
  const path = join(dir, 'repositories.json');
  writeFileSync(path, JSON.stringify({ version: 1, repositories: [{ id: 'kb-ops@1', projects: ['kb-ops'], root: '${DASHBOARD_REPO_ROOT}', remote: 'origin', baseRef: 'ops', scope: ['orgs/kb-ops/**'], credentialIdentity: 'desktop-promotion' }] }));
  const registry = loadRepositoryRegistry(path, { repoRoot: '/var/lib/kb/ops' });
  const record = registry.forProject('kb-ops');
  expect(record.root).toBe('/var/lib/kb/ops');
  expect(registry.resolve({ registryId: record.id, identity: record.identity })).toEqual(record);
  expect(() => registry.forProject('missing')).toThrow(/not registered/);
  expect(() => registry.resolve({ registryId: record.id, identity: '0'.repeat(64) })).toThrow(/identity/);
});

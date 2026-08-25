import { describe, expect, it } from 'vitest';
import { decodeHealthResponse, fetchHealth } from './healthClient.ts';
import { healthResponseFixture } from '../../server/health/__fixtures__/health.ts';

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}

describe('fetchHealth', () => {
  it('accepts only the closed Health response shape', async () => {
    await expect(fetchHealth((async () => response(healthResponseFixture)) as typeof fetch)).resolves.toEqual(healthResponseFixture);
  });

  it('rejects extra fields, reordered sections, and rows in the wrong section', async () => {
    const extra = structuredClone(healthResponseFixture) as Record<string, unknown>;
    ((extra.sections as Array<Record<string, unknown>>)[0].rows as Array<Record<string, unknown>>)[0].extra = true;
    await expect(fetchHealth((async () => response(extra)) as typeof fetch)).rejects.toThrow(/invalid health response/i);

    const reordered = structuredClone(healthResponseFixture) as unknown as { sections: unknown[] };
    [reordered.sections[0], reordered.sections[1]] = [reordered.sections[1]!, reordered.sections[0]!];
    await expect(fetchHealth((async () => response(reordered)) as typeof fetch)).rejects.toThrow(/invalid health response/i);

    const misplaced = structuredClone(healthResponseFixture) as unknown as { sections: Array<{ rows: unknown[] }> };
    misplaced.sections[0]!.rows = [healthResponseFixture.sections[1]!.rows[0]!];
    await expect(fetchHealth((async () => response(misplaced)) as typeof fetch)).rejects.toThrow(/invalid health response/i);
  });

  it('rejects reordered or missing MCP companions', () => {
    const reorderedMcp = structuredClone(healthResponseFixture);
    [reorderedMcp.sections[3].rows[1], reorderedMcp.sections[3].rows[2]] = [
      reorderedMcp.sections[3].rows[2]!, reorderedMcp.sections[3].rows[1]!,
    ];
    expect(() => decodeHealthResponse(reorderedMcp)).toThrow(/invalid health response/i);

    const missingMcp = structuredClone(healthResponseFixture);
    missingMcp.sections[3].rows.splice(1, 1);
    expect(() => decodeHealthResponse(missingMcp)).toThrow(/invalid health response/i);
  });

  it('rejects more than one Release, Service, or Deployment row', () => {
    const duplicateRelease = structuredClone(healthResponseFixture);
    const release = duplicateRelease.sections[2].rows.find((row) => row.key === 'release');
    duplicateRelease.sections[2].rows.push(structuredClone(release!));
    expect(() => decodeHealthResponse(duplicateRelease)).toThrow(/invalid health response/i);

    const duplicateService = structuredClone(healthResponseFixture);
    const service = duplicateService.sections[2].rows.find((row) => row.key === 'service');
    duplicateService.sections[2].rows.push(structuredClone(service!));
    expect(() => decodeHealthResponse(duplicateService)).toThrow(/invalid health response/i);
  });

  it('accepts a daemon-machine section with no Deployment row (none exists yet — never a synthesized one)', () => {
    const noDeploy = structuredClone(healthResponseFixture);
    noDeploy.sections[2].rows = noDeploy.sections[2].rows.filter((row) => !row.key.startsWith('deploy:'));
    expect(() => decodeHealthResponse(noDeploy)).not.toThrow();
  });

  it('accepts each of the four §3.5 daemon-machine row kinds and rejects an unknown kind', () => {
    expect(() => decodeHealthResponse(healthResponseFixture)).not.toThrow();
    const rows = healthResponseFixture.sections[2].rows;
    expect(rows.map((row) => row.kind)).toEqual(['machine', 'machine', 'machine', 'machine', 'machine', 'daemon', 'release', 'deploy']);

    const unknownKind = structuredClone(healthResponseFixture);
    const daemonMachine = unknownKind.sections[2];
    (daemonMachine.rows[0] as unknown as { kind: string }).kind = 'bogus';
    expect(() => decodeHealthResponse(unknownKind)).toThrow(/invalid health response/i);
  });

  it('rejects a daemon-machine row missing a required field, one kind at a time', () => {
    for (const key of ['cpu', 'memory', 'disk', 'uptime', 'service', 'release', 'deploy:deployment:1']) {
      const broken = structuredClone(healthResponseFixture);
      const row = broken.sections[2].rows.find((candidate) => candidate.key === key) as unknown as { value: Record<string, unknown> };
      delete row.value[Object.keys(row.value)[0]!];
      expect(() => decodeHealthResponse(broken), `key ${key}`).toThrow(/invalid health response/i);
    }
  });
});

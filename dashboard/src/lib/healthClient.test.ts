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

  // P6 W6.2 [P6-C64, P6-C76, P6-C80]: the `fleet` section's integrity wall widens from the single
  // schedule-owner shape into a closed key-prefix/source/label/code quadruple set covering THREE
  // members — schedule-owner (existing), node-proxy, and host-map (both new, failure-only).
  const INTEGRITY_VARIANTS = [
    {
      key: 'schedule-owner:agent:deleted-owner', source: 'schedule-store', label: 'Schedule owner',
      code: 'schedule-owner-unresolvable', owner: { type: 'agent', id: 'deleted-owner', sourcePath: 'agents/deleted-owner.md' } as unknown,
    },
    { key: 'node-proxy:kb-node-proxy', source: 'node-proxy', label: 'Node proxy', code: 'node-proxy-unreachable', owner: 'kb-node-proxy' as unknown },
    { key: 'host-map:host-nodes.json', source: 'host-map', label: 'Host map', code: 'host-map-invalid', owner: 'host-nodes.json' as unknown },
  ] as const;

  function withIntegrityRow(variant: typeof INTEGRITY_VARIANTS[number]) {
    const body = structuredClone(healthResponseFixture);
    body.sections[0]!.rows = [{
      kind: 'integrity', key: variant.key, label: variant.label,
      value: { status: 'error', code: variant.code, owner: variant.owner },
      observedAt: '2026-08-25T00:00:00.000Z', source: variant.source,
    }] as unknown as typeof body.sections[0]['rows'];
    return body;
  }

  it('accepts each of the three closed fleet-integrity variants (source, label, code, and key prefix)', () => {
    for (const variant of INTEGRITY_VARIANTS) {
      expect(() => decodeHealthResponse(withIntegrityRow(variant)), variant.key).not.toThrow();
    }
  });

  it('rejects an unknown integrity source, an unlisted label, and an unlisted code', () => {
    const unknownSource = withIntegrityRow(INTEGRITY_VARIANTS[1]);
    (unknownSource.sections[0]!.rows[0] as unknown as { source: string }).source = 'bogus-source';
    expect(() => decodeHealthResponse(unknownSource)).toThrow(/invalid health response/i);

    const unlistedLabel = withIntegrityRow(INTEGRITY_VARIANTS[2]);
    (unlistedLabel.sections[0]!.rows[0] as unknown as { label: string }).label = 'Bogus label';
    expect(() => decodeHealthResponse(unlistedLabel)).toThrow(/invalid health response/i);

    const unlistedCode = withIntegrityRow(INTEGRITY_VARIANTS[0]);
    (unlistedCode.sections[0]!.rows[0] as unknown as { value: { code: string } }).value.code = 'bogus-code';
    expect(() => decodeHealthResponse(unlistedCode)).toThrow(/invalid health response/i);
  });

  it('still enforces status:error and the exact {status,code,owner} body wall on every integrity variant', () => {
    for (const variant of INTEGRITY_VARIANTS) {
      const wrongStatus = withIntegrityRow(variant);
      (wrongStatus.sections[0]!.rows[0] as unknown as { value: { status: string } }).value.status = 'ok';
      expect(() => decodeHealthResponse(wrongStatus), `${variant.key} status`).toThrow(/invalid health response/i);

      const extraKey = withIntegrityRow(variant);
      (extraKey.sections[0]!.rows[0] as unknown as { value: Record<string, unknown> }).value.extra = true;
      expect(() => decodeHealthResponse(extraKey), `${variant.key} extra key`).toThrow(/invalid health response/i);
    }
  });
});

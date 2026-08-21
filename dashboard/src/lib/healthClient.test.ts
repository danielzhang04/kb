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

  it('rejects reordered or missing MCP companions and requires exactly one Release row', () => {
    const reorderedMcp = structuredClone(healthResponseFixture);
    [reorderedMcp.sections[3].rows[1], reorderedMcp.sections[3].rows[2]] = [
      reorderedMcp.sections[3].rows[2]!, reorderedMcp.sections[3].rows[1]!,
    ];
    expect(() => decodeHealthResponse(reorderedMcp)).toThrow(/invalid health response/i);

    const missingMcp = structuredClone(healthResponseFixture);
    missingMcp.sections[3].rows.splice(1, 1);
    expect(() => decodeHealthResponse(missingMcp)).toThrow(/invalid health response/i);

    const missingRelease = structuredClone(healthResponseFixture);
    missingRelease.sections[2].rows = missingRelease.sections[2].rows.filter((row) => row.key !== 'release');
    expect(() => decodeHealthResponse(missingRelease)).toThrow(/invalid health response/i);

    const duplicateRelease = structuredClone(healthResponseFixture);
    duplicateRelease.sections[2].rows.push(structuredClone(healthResponseFixture.sections[2].rows[1]!));
    expect(() => decodeHealthResponse(duplicateRelease)).toThrow(/invalid health response/i);
  });
});

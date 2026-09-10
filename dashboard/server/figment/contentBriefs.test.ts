import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { collectContentBriefs } from './contentBriefs.ts';

const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

function record(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 'figment/content-brief@1', brief_date: '2026-09-08',
    creator: { id: 'creator-001', persona: { path: 'personas/creator-001/persona.yaml', sha256: 'a'.repeat(64) }, canonical_reference: { declared_path: 'anchors/g01.jpg', path: 'personas/creator-001/anchors/g01.jpg', sha256: 'b'.repeat(64) } },
    content: { surface: 'carousel', template_id: 'CT-2', template_sha256: 'c'.repeat(64), taxonomy_sha256: 'd'.repeat(64), required_asset_slots: [{ index: 1, role: 'hook', taxonomy_type: 'A', kind: 'persona' }, { index: 2, role: 'punchline', taxonomy_type: 'A', kind: 'persona' }] },
    sources: [{ citation: 'https://example.test/research', observed_date: '2026-09-03' }],
    hypothesis: 'A bounded planning hypothesis.', intended_metric: 'saves per reached account', observed_metrics: null,
    internal_note: 'must-not-project', ...overrides,
  };
}
async function fixture(withBrief = true, folderName = '2026-09-08-creator-001-two-frame'): Promise<{ repo: string; briefs: string; folder: string; brief: string }> {
  const repo = await mkdtemp(join(tmpdir(), 'figment-content-briefs-')); temporary.push(repo);
  const briefs = join(repo, 'orgs', 'figment', 'content', 'briefs'), folder = join(briefs, folderName), brief = join(folder, 'brief.json');
  await mkdir(folder, { recursive: true }); if (withBrief) await writeFile(brief, JSON.stringify(record()));
  return { repo, briefs, folder, brief };
}

describe('content brief inventory', () => {
  it('projects only bounded planning fields from one compiler-shaped brief', async () => {
    const item = await fixture();
    const projection = collectContentBriefs(item.repo);
    expect(projection).toEqual({ status: 'recorded', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items: [{ briefId: '2026-09-08-creator-001-two-frame', briefDate: '2026-09-08', creatorId: 'creator-001', surface: 'carousel', templateId: 'CT-2', requiredAssetCount: 2, requiredAssetSlots: [{ role: 'hook', kind: 'persona' }, { role: 'punchline', kind: 'persona' }], hypothesis: 'A bounded planning hypothesis.', intendedMetric: 'saves per reached account', sourceCount: 1, sourceDates: ['2026-09-03'], observedMetrics: null, renderAs: 'text' }] });
    expect(JSON.stringify(projection)).not.toMatch(/citation|sha256|persona\.yaml|anchors\/|must-not-project|quality|accept/i);
  });

  it('accepts a safe one-level brief id that is independent of record date and creator', async () => {
    const item = await fixture(true, 'summer-test');
    expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ briefId: 'summer-test', briefDate: '2026-09-08', creatorId: 'creator-001' }] });
  });

  it('distinguishes omitted configuration and empty inventory from invalid evidence', async () => {
    expect(collectContentBriefs()).toEqual({ status: 'not-configured', items: [] });
    const repo = await mkdtemp(join(tmpdir(), 'figment-content-empty-')); temporary.push(repo);
    expect(collectContentBriefs(repo)).toEqual({ status: 'empty', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items: [] });
    const item = await fixture(false);
    expect(collectContentBriefs(item.repo)).toEqual({ status: 'empty', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items: [] });
    await writeFile(item.brief, '{broken');
    expect(collectContentBriefs(item.repo)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable', items: [] });
  });

  it('rejects oversized and over-deep JSON before projecting it', async () => {
    const item = await fixture();
    await writeFile(item.brief, Buffer.alloc(256 * 1024 + 1, 0x20));
    expect(collectContentBriefs(item.repo).status).toBe('unavailable');
    const deep = `${'{"schema":"figment/content-brief@1","nested":'}${'['.repeat(33)}null${']'.repeat(33)}}`;
    await writeFile(item.brief, deep);
    expect(collectContentBriefs(item.repo).status).toBe('unavailable');
  });

  it('rejects approval-bearing fields and any observed metric claim', async () => {
    const item = await fixture();
    await writeFile(item.brief, JSON.stringify(record({ accepted_checkpoint: 'none' })));
    expect(collectContentBriefs(item.repo).status).toBe('unavailable');
    await writeFile(item.brief, JSON.stringify(record({ observed_metrics: { saves: 5 } })));
    expect(collectContentBriefs(item.repo).status).toBe('unavailable');
  });

  it('fails closed for a one-level junction and physical directory overflow', async () => {
    const item = await fixture(false), outside = await mkdtemp(join(tmpdir(), 'figment-content-foreign-')); temporary.push(outside);
    await symlink(outside, join(item.briefs, '2026-09-09-creator-001-linked'), 'junction');
    expect(collectContentBriefs(item.repo).status).toBe('unavailable');
    await rm(join(item.briefs, '2026-09-09-creator-001-linked'));
    for (let index = 0; index < 65; index += 1) await mkdir(join(item.briefs, `2026-09-09-creator-001-empty-${String(index).padStart(2, '0')}`));
    expect(collectContentBriefs(item.repo).status).toBe('unavailable');
  });

  it('projects the checked-in compiled brief as a recorded planning snapshot', () => {
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const projection = collectContentBriefs(repo);
    expect(projection).toMatchObject({ status: 'recorded', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items: [{ briefId: '2026-09-08-creator-001-two-frame', briefDate: '2026-09-08', creatorId: 'creator-001', surface: 'carousel', templateId: 'CT-2', requiredAssetCount: 2, sourceCount: 1, sourceDates: ['2026-09-03'], observedMetrics: null, renderAs: 'text' }] });
  });
});

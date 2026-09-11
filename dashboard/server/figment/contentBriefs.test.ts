import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
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
async function assignment(item: { brief: string }, overrides: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const briefSha = createHash('sha256').update(await readFile(item.brief)).digest('hex');
  return {
    schema: 'figment/content-asset-assignment@1', not_promotable: true, provenance: 'offline planning evidence',
    brief: { path: 'arbitrary-root/brief.json', sha256: briefSha }, request: { path: 'arbitrary-root/request.json', sha256: 'c'.repeat(64) }, rulings: { path: 'arbitrary-root/rulings.json', sha256: 'd'.repeat(64) }, creator: 'creator-001',
    assignments: [{ slot_index: 1, role: 'hook', taxonomy_type: 'A', kind: 'persona', slot_fit: { decision: 'fit', decided_by: 'operator-fixture', decided_at: '2026-09-10T04:00:00Z' }, asset: { kind: 'approved-gen-still', image_id: 'image-01', path: 'private/images/image-01.png', sha256: 'e'.repeat(64), bytes: 12, source_plan: { path: 'private/plan.json', sha256: 'f'.repeat(64) }, approval_lineage: { path: 'private/approval.json', sha256: 'a'.repeat(64) }, approved_list: { path: 'private/approved.json', sha256: 'b'.repeat(64) } } }, { slot_index: 2, role: 'punchline', taxonomy_type: 'A', kind: 'persona', slot_fit: { decision: 'fit', decided_by: 'operator-fixture', decided_at: '2026-09-10T04:00:00Z' }, asset: { kind: 'approved-gen-still', image_id: 'image-02', path: 'private/images/image-02.png', sha256: '1'.repeat(64), bytes: 13, source_plan: { path: 'private/plan.json', sha256: 'f'.repeat(64) }, approval_lineage: { path: 'private/approval.json', sha256: 'a'.repeat(64) }, approved_list: { path: 'private/approved.json', sha256: 'b'.repeat(64) } } }],
    ...overrides,
  };
}
async function nativeAssignment(item: { brief: string }): Promise<Record<string, unknown>> {
  const briefSha = createHash('sha256').update(await readFile(item.brief)).digest('hex');
  const fit = { decision: 'fit', decided_by: 'slot-reviewer', decided_at: '2026-09-10T04:00:00Z' };
  const persona = { kind: 'approved-gen-still', image_id: 'image-01', path: 'private/images/image-01.png', sha256: 'e'.repeat(64), bytes: 12, source_plan: { path: 'private/plan.json', sha256: 'f'.repeat(64) }, approval_lineage: { path: 'private/approval.json', sha256: 'a'.repeat(64) }, approved_list: { path: 'private/approved.json', sha256: 'b'.repeat(64) } };
  const native = (letter: string, hash: string) => ({ kind: 'visually-ruled-nonpersona-still', scope: 'source-material-only', stage: 'native-source', cell_id: `cell-${letter}`, path: `private/native/${letter}.png`, bytes: 100, sha256: hash, native_dimensions: { width: 1200, height: 1600 }, delivery_target: { aspect: '3:4', width: 1200, height: 1600 }, delivery_quality: 'not-assessed', delivery_transform: null, retained: { path: `private/retained/${letter}.json`, bytes: 200, sha256: '9'.repeat(64) }, visual_ruling: { path: `private/rulings/${letter}.json`, bytes: 300, sha256: '8'.repeat(64), authority: 'human-visual-ruling', decision: 'accept-native', decided_by: 'human-reviewer', decided_at: '2026-09-10T05:00:00Z' } });
  return {
    schema: 'figment/content-asset-assignment@3', not_promotable: true,
    provenance: 'offline content-slot planning evidence; nonpersona images are native source material with delivery review pending; no new asset, batch, publication, or metric approval',
    brief: { path: 'arbitrary-root/brief.json', sha256: briefSha }, request: { path: 'arbitrary-root/request.json', sha256: 'c'.repeat(64) }, rulings: { path: 'arbitrary-root/rulings.json', sha256: 'd'.repeat(64) }, creator: 'creator-001',
    assignments: [
      { slot_index: 1, role: 'hook', taxonomy_type: 'A', kind: 'persona', slot_fit: fit, asset: persona },
      { slot_index: 2, role: 'scene-c', taxonomy_type: 'C', kind: 'nonpersona', slot_fit: fit, asset: native('c', '1'.repeat(64)) },
      { slot_index: 3, role: 'scene-d', taxonomy_type: 'D', kind: 'nonpersona', slot_fit: fit, asset: native('d', '2'.repeat(64)) },
      { slot_index: 4, role: 'scene-e', taxonomy_type: 'E', kind: 'nonpersona', slot_fit: fit, asset: native('e', '3'.repeat(64)) },
    ],
  };
}
function nativeBrief(): Record<string, unknown> {
  const value = record();
  (value.content as Record<string, unknown>).required_asset_slots = [
    { index: 1, role: 'hook', taxonomy_type: 'A', kind: 'persona' },
    { index: 2, role: 'scene-c', taxonomy_type: 'C', kind: 'nonpersona' },
    { index: 3, role: 'scene-d', taxonomy_type: 'D', kind: 'nonpersona' },
    { index: 4, role: 'scene-e', taxonomy_type: 'E', kind: 'nonpersona' },
  ];
  return value;
}

describe('content brief inventory', () => {
  it('projects motion as source footage and refuses delivery claims or legacy relabeling', async () => {
    const item = await fixture();
    const brief = record();
    brief.content = { surface: 'reel', template_id: 'RT-1', template_sha256: 'c'.repeat(64), taxonomy_sha256: 'd'.repeat(64), required_asset_slots: [{ index: 1, role: 'motion', taxonomy_type: 'G', kind: 'persona' }] };
    await writeFile(item.brief, JSON.stringify(brief));
    const value = await assignment(item);
    const old = value.assignments as Array<Record<string, unknown>>;
    const snapshot = (path: string) => ({ path, bytes: 10, sha256: 'a'.repeat(64) });
    const motionAsset = { kind: 'accepted-video-source', scope: 'source-material-only', candidate_id: 'candidate-01', ...snapshot('private/movie.mp4'), accepted_lineage: snapshot('private/accepted-video.json'), candidate_manifest: snapshot('private/candidate.json'), approved_still: old[0].asset };
    value.schema = 'figment/content-asset-assignment@2';
    value.assignments = [{ ...old[0], role: 'motion', taxonomy_type: 'G', asset: motionAsset }];
    const target = join(item.folder, 'assignment.json');
    await writeFile(target, JSON.stringify(value));
    expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'recorded-source-snapshot' }] });
    for (const invalid of [
      { ...value, schema: 'figment/content-asset-assignment@1' },
      { ...value, assignments: [{ ...old[0], role: 'motion', taxonomy_type: 'G', asset: { ...motionAsset, scope: 'delivery-approved' } }] },
      { ...value, assignments: [{ ...old[0], role: 'motion', taxonomy_type: 'G', asset: { ...motionAsset, delivery_approved: true } }] },
    ]) {
      await writeFile(target, JSON.stringify(invalid));
      expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] });
    }
  });

  it('namespaces asset ids by source kind and refuses padded candidate ids', async () => {
    const item = await fixture();
    const slots = (roles: Array<[string, string]>) => roles.map(([role, taxonomy_type], index) => ({ index: index + 1, role, taxonomy_type, kind: 'persona' }));
    const writeBrief = async (roles: Array<[string, string]>): Promise<void> => { const brief = record(); (brief.content as Record<string, unknown>).required_asset_slots = slots(roles); await writeFile(item.brief, JSON.stringify(brief)); };
    const old = (await assignment(item)).assignments as Array<Record<string, unknown>>;
    const snapshot = (path: string) => ({ path, bytes: 10, sha256: 'a'.repeat(64) });
    const motionAsset = (candidateId: string) => ({ kind: 'accepted-video-source', scope: 'source-material-only', candidate_id: candidateId, ...snapshot('private/movie.mp4'), accepted_lineage: snapshot('private/accepted-video.json'), candidate_manifest: snapshot('private/candidate.json'), approved_still: old[0].asset });
    const motionRow = (candidateId: string, index = 1) => ({ ...old[0], slot_index: index, role: `motion-${index}`, taxonomy_type: 'G', asset: motionAsset(candidateId) });
    const target = join(item.folder, 'assignment.json');
    const project = async (rows: unknown[]) => { await writeFile(target, JSON.stringify({ ...(await assignment(item)), schema: 'figment/content-asset-assignment@2', assignments: rows })); return collectContentBriefs(item.repo); };
    await writeBrief([['motion-1', 'G'], ['punchline', 'A']]);
    expect(await project([motionRow('image-02'), old[1]])).toMatchObject({ status: 'recorded', items: [{ assignment: 'recorded-source-snapshot' }] });
    await writeBrief([['motion-1', 'G'], ['motion-2', 'G']]);
    expect(await project([motionRow('candidate-01'), motionRow('candidate-01', 2)])).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] });
    await writeBrief([['motion-1', 'G']]);
    expect(await project([motionRow('candidate-01')])).toMatchObject({ status: 'recorded', items: [{ assignment: 'recorded-source-snapshot' }] });
    for (const padded of [' candidate-01', 'candidate-01 ', 'candidate-01\t']) expect(await project([motionRow(padded)])).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] });
  });

  it('projects v3 native nonpersona C/D/E snapshots without private ruling metadata', async () => {
    const item = await fixture(); await writeFile(item.brief, JSON.stringify(nativeBrief()));
    await writeFile(join(item.folder, 'assignment.json'), JSON.stringify(await nativeAssignment(item)));
    const projection = collectContentBriefs(item.repo);
    expect(projection).toMatchObject({ status: 'recorded', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items: [{ assignment: 'recorded-native-source-snapshot' }] });
    expect(JSON.stringify(projection)).not.toMatch(/private\/|sha256|human-reviewer|accept-native|delivery_quality/i);
  });

  it('refuses malformed or delivery-claiming v3 native snapshot evidence', async () => {
    const item = await fixture(); await writeFile(item.brief, JSON.stringify(nativeBrief()));
    const valid = await nativeAssignment(item), target = join(item.folder, 'assignment.json');
    const invalid = (mutate: (value: Record<string, unknown>) => void): Record<string, unknown> => { const value = structuredClone(valid); mutate(value); return value; };
    const rows = (value: Record<string, unknown>) => value.assignments as Array<Record<string, any>>;
    const cases = [
      invalid((value) => { value.provenance = 'research evidence says this is accepted'; }),
      invalid((value) => { (rows(value)[1].asset.visual_ruling as Record<string, unknown>).decision = 'reject'; }),
      invalid((value) => { (rows(value)[1].asset.visual_ruling as Record<string, unknown>).authority = 'research-disposition'; }),
      invalid((value) => { rows(value)[1].asset.delivery_quality = 'delivery-approved'; }),
      invalid((value) => { rows(value)[1].asset.delivery_transform = { width: 1200, height: 1600 }; }),
      invalid((value) => { rows(value)[1].asset.stage = 'delivery'; }),
      invalid((value) => { delete rows(value)[1].asset.delivery_target.aspect; }),
      invalid((value) => { rows(value)[1].asset.sha256 = 'A'.repeat(64); }),
      invalid((value) => { rows(value)[1].asset.native_dimensions.extra = 1; }),
      invalid((value) => { rows(value)[2].asset.sha256 = rows(value)[1].asset.sha256; }),
    ];
    for (const value of cases) { await writeFile(target, JSON.stringify(value)); expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] }); }
  });

  it('requires v3 only for carousel nonpersona C/D/E briefs and keeps v1 nonpersona unavailable', async () => {
    const item = await fixture(); const target = join(item.folder, 'assignment.json');
    const personOnly = await assignment(item); personOnly.schema = 'figment/content-asset-assignment@3'; await writeFile(target, JSON.stringify(personOnly));
    expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] });
    await writeFile(item.brief, JSON.stringify(nativeBrief())); const v3 = await nativeAssignment(item); v3.schema = 'figment/content-asset-assignment@1'; await writeFile(target, JSON.stringify(v3));
    expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] });
    const wrongType = nativeBrief(); ((wrongType.content as Record<string, any>).required_asset_slots[1] as Record<string, unknown>).taxonomy_type = 'A'; await writeFile(item.brief, JSON.stringify(wrongType));
    const wrongTypeAssignment = await nativeAssignment(item); (wrongTypeAssignment.assignments as Array<Record<string, unknown>>)[1].taxonomy_type = 'A'; await writeFile(target, JSON.stringify(wrongTypeAssignment));
    expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] });
    const mixed = nativeBrief(); const content = mixed.content as Record<string, any>; content.surface = 'reel'; content.template_id = 'RT-1'; content.required_asset_slots[0] = { index: 1, role: 'motion', taxonomy_type: 'G', kind: 'persona' }; await writeFile(item.brief, JSON.stringify(mixed));
    await writeFile(target, JSON.stringify(await nativeAssignment(item)));
    expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] });
  });

  it('projects only bounded planning fields from one compiler-shaped brief', async () => {
    const item = await fixture();
    const projection = collectContentBriefs(item.repo);
    expect(projection).toEqual({ status: 'recorded', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items: [{ briefId: '2026-09-08-creator-001-two-frame', briefDate: '2026-09-08', creatorId: 'creator-001', surface: 'carousel', templateId: 'CT-2', requiredAssetCount: 2, requiredAssetSlots: [{ role: 'hook', kind: 'persona' }, { role: 'punchline', kind: 'persona' }], hypothesis: 'A bounded planning hypothesis.', intendedMetric: 'saves per reached account', sourceCount: 1, sourceDates: ['2026-09-03'], observedMetrics: null, renderAs: 'text', assignment: 'missing' }] });
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

  it('projects a hash-bound assignment snapshot without its private provenance fields', async () => {
    const item = await fixture();
    await writeFile(join(item.folder, 'assignment.json'), JSON.stringify(await assignment(item)));
    const projection = collectContentBriefs(item.repo);
    expect(projection).toMatchObject({ status: 'recorded', items: [{ assignment: 'recorded-snapshot' }] });
    expect(JSON.stringify(projection)).not.toMatch(/private\/|sha256|operator-fixture|image-01|approved-gen|approval/i);
  });

  it('marks malformed assignment evidence unavailable without hiding valid briefs', async () => {
    const item = await fixture();
    const writeAssignment = async (value: Record<string, unknown>): Promise<void> => { await writeFile(join(item.folder, 'assignment.json'), JSON.stringify(value)); expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] }); };
    await writeAssignment(await assignment(item, { private_prompt: 'must not project' }));
    await writeAssignment(await assignment(item, { brief: { path: 'any/brief.json', sha256: '0'.repeat(64) } }));
    await writeAssignment(await assignment(item, { assignments: [] }));
    const duplicate = await assignment(item); const duplicateRows = duplicate.assignments as Array<Record<string, unknown>>;
    (duplicateRows[1].asset as Record<string, unknown>).image_id = 'image-01'; await writeAssignment(duplicate);
    const nonpersona = record(); (nonpersona.content as Record<string, unknown>).required_asset_slots = [{ index: 1, role: 'hook', taxonomy_type: 'A', kind: 'nonpersona' }, { index: 2, role: 'punchline', taxonomy_type: 'A', kind: 'persona' }]; await writeFile(item.brief, JSON.stringify(nonpersona));
    const nonpersonaAssignment = await assignment(item); (nonpersonaAssignment.assignments as Array<Record<string, unknown>>)[0].kind = 'nonpersona'; await writeAssignment(nonpersonaAssignment);
    const motion = record(); (motion.content as Record<string, unknown>).required_asset_slots = [{ index: 1, role: 'motion', taxonomy_type: 'G', kind: 'persona' }, { index: 2, role: 'punchline', taxonomy_type: 'A', kind: 'persona' }]; await writeFile(item.brief, JSON.stringify(motion));
    const motionAssignment = await assignment(item); (motionAssignment.assignments as Array<Record<string, unknown>>)[0].taxonomy_type = 'G'; await writeAssignment(motionAssignment);
    await writeFile(join(item.folder, 'assignment.json'), `${'{"schema":"figment/content-asset-assignment@1","nested":'}${'['.repeat(33)}null${']'.repeat(33)}}`);
    expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] });
    await writeFile(join(item.folder, 'assignment.json'), Buffer.alloc(256 * 1024 + 1, 0x20));
    expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] });
    await rm(join(item.folder, 'assignment.json'));
    const outside = await mkdtemp(join(tmpdir(), 'figment-assignment-linked-')); temporary.push(outside);
    await writeFile(join(outside, 'assignment.json'), JSON.stringify(await assignment(item)));
    await symlink(join(outside, 'assignment.json'), join(item.folder, 'assignment.json'));
    expect(collectContentBriefs(item.repo)).toMatchObject({ status: 'recorded', items: [{ assignment: 'unavailable' }] });
    const other = join(item.briefs, 'other-brief'); await mkdir(other); await writeFile(join(other, 'brief.json'), JSON.stringify(record()));
    const retained = collectContentBriefs(item.repo); expect(retained.status).toBe('recorded');
    if (retained.status === 'recorded') {
      expect(retained.items.find((brief) => brief.briefId === '2026-09-08-creator-001-two-frame')).toMatchObject({ assignment: 'unavailable' });
      expect(retained.items.find((brief) => brief.briefId === 'other-brief')).toMatchObject({ assignment: 'missing' });
    }
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

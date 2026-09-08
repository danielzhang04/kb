import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { PNG } from 'pngjs';
import { buildFigmentProjection, registerFigmentRead } from './routes.ts';

const temporary: string[] = [];
afterEach(async () => { while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true }); });

function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function png(salt = 0, width = 4, height = 3): Buffer {
  const image = new PNG({ width, height });
  for (let index = 0; index < image.data.length; index += 1) image.data[index] = (index * 31 + salt) & 255;
  return Buffer.from(PNG.sync.write(image));
}
async function json(path: string, value: unknown): Promise<void> { await mkdir(join(path, '..'), { recursive: true }); await writeFile(path, JSON.stringify(value), 'utf8'); }

async function fixture(): Promise<{ repo: string; diagnostic: string; subject: string; accepted: string }> {
  const repo = await mkdtemp(join(tmpdir(), 'figment-hub-'));
  const figment = join(repo, 'orgs', 'figment');
  temporary.push(repo);
  await json(join(figment, 'personas', 'creator-a', 'persona.yaml'), {
    id: 'creator-a', lora: { tier: 'provisional', trigger: 'creatora' }, accounts: [{ tier: 'instagram' }],
  });
  await writeFile(join(figment, 'personas', 'broken', 'persona.yaml'), '{bad json', { encoding: 'utf8', flag: 'w' }).catch(async () => {
    await mkdir(join(figment, 'personas', 'broken'), { recursive: true });
    await writeFile(join(figment, 'personas', 'broken', 'persona.yaml'), '{bad json', 'utf8');
  });
  const subject = join(figment, 'personas', 'creator-a', 'subject.txt');
  await writeFile(subject, 'current review subject', 'utf8');
  await json(join(figment, 'personas', 'creator-a', 'batches', 'one', 'gate.json'), {
    gate_id: 'gate-a', subject_path: 'personas/creator-a/subject.txt', subject_sha256: digest('current review subject'), decision: 'verified', decided_by: 'operator', decided_at: '2026-09-08T00:00:00Z',
  });
  await json(join(figment, 'personas', 'creator-a', 'batches', 'one', 'run.json'), { schema: 'figment/runpod-run@1', dry_run: true });
  await json(join(figment, 'runs', 'current', 'driver-plan.json'), {
    schema: 'figment/train-plan@1', creator: 'creator-a', variant: 'studio-preview',
    stages: {
      train: { runs: [{ ceiling_usd: 1.25, argv: ['must-not-project'], prompt: 'must-not-project' }] },
      tester: { runs: [{ ceiling_usd: 0.5 }] },
    },
  });
  await json(join(figment, 'personas', 'creator-a', 'batches', 'one', 'rulings.json'), { decision: 'keep' });
  const plan = join(figment, 'personas', 'creator-a', 'batches', 'one', 'plan.json');
  const approval = join(figment, 'personas', 'creator-a', 'batches', 'one', 'approval-lineage.json');
  await json(plan, { schema: 'figment/train-plan@1' });
  const lineageSubject = { creator: 'creator-a', stage: 'tester' };
  const canonical = '{"creator":"creator-a","stage":"tester"}';
  await json(approval, { schema: 'figment/approval-lineage@1', subject: lineageSubject, subject_sha256: digest(canonical) });
  const accepted = join(figment, 'personas', 'creator-a', 'batches', 'one', 'accepted-checkpoint.json');
  await json(accepted, {
    schema: 'figment/accepted-checkpoint@1', source_plan: plan, source_plan_sha256: digest(JSON.stringify({ schema: 'figment/train-plan@1' })),
    approval_lineage: approval, approval_lineage_sha256: digest(JSON.stringify({ schema: 'figment/approval-lineage@1', subject: lineageSubject, subject_sha256: digest(canonical) })),
  });
  await writeFile(join(figment, 'research', 'index.md'), 'research index', { encoding: 'utf8', flag: 'w' }).catch(async () => {
    await mkdir(join(figment, 'research'), { recursive: true }); await writeFile(join(figment, 'research', 'index.md'), 'research index', 'utf8');
  });
  await mkdir(join(figment, 'research', 'book'), { recursive: true });
  await writeFile(join(figment, 'research', 'book', 'chapter.md'), 'book', 'utf8');
  const diagnostic = await mkdtemp(join(tmpdir(), 'figment-diagnostic-'));
  temporary.push(diagnostic);
  const proof = png();
  await writeFile(join(diagnostic, 'proof.png'), proof);
  await json(join(diagnostic, 'run.json'), { dry_run: false, pod_id: 'fixture-pod', jobs: [{ files: [{ path: 'proof.png', bytes: proof.length }] }] });
  return { repo, diagnostic, subject, accepted };
}

describe('Figment read projection', () => {
  it('lists fixed Figment records and artifact metadata without treating rulings as approval', async () => {
    const paths = await fixture();
    const projection = buildFigmentProjection(paths.repo, paths.diagnostic);
    expect(projection.available).toBe(true);
    expect(projection.creatorsTruncated).toBe(false);
    expect(projection.creators).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'creator-a', persona: 'valid', loraTier: 'provisional' }),
      expect.objectContaining({ id: 'broken', persona: 'malformed' }),
    ]));
    expect(projection.records).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'gate', reviewState: 'unknown', machineGateState: 'current' }),
      expect.objectContaining({ type: 'run', reviewState: 'unreviewed' }),
      expect.objectContaining({ path: 'runs/current/driver-plan.json', type: 'plan', reviewState: 'unreviewed' }),
      // The projection verifies record integrity, but does not reimplement train's complete freshness proof.
      expect.objectContaining({ type: 'accepted-checkpoint', reviewState: 'unknown' }),
    ]));
    expect(projection.records.some((record) => record.path.endsWith('rulings.json'))).toBe(false);
    expect(projection.research.artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ area: 'research', name: 'index.md' }),
      expect.objectContaining({ area: 'book', name: 'chapter.md' }),
    ]));
    expect(projection.diagnostic).toMatchObject({ status: 'diagnostic-not-promotable', podId: 'fixture-pod', artifacts: [{ name: 'proof.png', width: 4, height: 3, sha256: digest(png()) }], artifactsTruncated: false });
  });

  it('marks changed gate subjects and checkpoint hashes stale', async () => {
    const paths = await fixture();
    await writeFile(paths.subject, 'changed', 'utf8');
    let projection = buildFigmentProjection(paths.repo);
    expect(projection.records.find((record) => record.type === 'gate')).toMatchObject({ reviewState: 'stale', machineGateState: 'stale' });
    const accepted = JSON.parse(await (await import('node:fs/promises')).readFile(paths.accepted, 'utf8')) as Record<string, unknown>;
    accepted.source_plan_sha256 = '0'.repeat(64);
    await json(paths.accepted, accepted);
    projection = buildFigmentProjection(paths.repo);
    expect(projection.records.find((record) => record.type === 'accepted-checkpoint')?.reviewState).toBe('stale');
  });

  it('projects only bounded summaries for schema-identified frozen plans', async () => {
    const paths = await fixture();
    const figment = join(paths.repo, 'orgs', 'figment');
    await json(join(figment, 'runs', 'generic', 'plan.json'), { schema: 'figment/runpod-run@1', jobs: [{ prompt: 'not a plan' }] });
    await symlink(join(figment, 'runs', 'current'), join(figment, 'runs', 'linked'), 'junction');
    await json(join(figment, 'runs', 'over-bound', 'plan.json'), {
      schema: 'figment/train-plan@1', creator: 'creator-a', stages: { train: { runs: Array.from({ length: 33 }, () => ({ ceiling_usd: 1 })) } },
    });
    await json(join(figment, 'runs', 'missing-stages', 'plan.json'), { schema: 'figment/train-plan@1', creator: 'creator-a' });
    await json(join(figment, 'runs', 'nonobject-stages', 'plan.json'), { schema: 'figment/train-plan@1', creator: 'creator-a', stages: [] });
    await json(join(figment, 'runs', 'overflow', 'plan.json'), {
      schema: 'figment/train-plan@1', creator: 'creator-a', stages: { train: { runs: [{ ceiling_usd: 1e308 }, { ceiling_usd: 1e308 }] } },
    });
    const projection = buildFigmentProjection(paths.repo);
    expect(projection.plans).toEqual({
      truncated: false,
      items: [{
        path: 'runs/current/driver-plan.json', creator: 'creator-a', variant: 'studio-preview', declaredCeilingUsd: 1.75,
        stages: [
          { name: 'train', runCount: 1, declaredCeilingUsd: 1.25 },
          { name: 'tester', runCount: 1, declaredCeilingUsd: 0.5 },
        ],
      }],
    });
    expect(JSON.stringify(projection.plans)).not.toContain('must-not-project');
  });

  it('rejects diagnostic artifact traversal and serves the read-only route', async () => {
    const paths = await fixture();
    const link = `${paths.diagnostic}-link`;
    temporary.push(link);
    await symlink(paths.diagnostic, link, 'junction');
    expect(buildFigmentProjection(paths.repo, link).diagnostic).toEqual({ status: 'unavailable', reason: 'unsafe-configured-root' });
    await symlink(join(paths.diagnostic, 'proof.png'), join(paths.diagnostic, 'linked.png'), 'file');
    await json(join(paths.diagnostic, 'run.json'), { jobs: [{ files: [{ path: 'linked.png', bytes: png().length }] }] });
    expect(buildFigmentProjection(paths.repo, paths.diagnostic).diagnostic).toEqual({ status: 'unavailable', reason: 'unsafe-artifact-reference' });
    await json(join(paths.diagnostic, 'run.json'), { jobs: [{ files: [{ path: '../outside.txt', bytes: 1 }] }] });
    expect(buildFigmentProjection(paths.repo, paths.diagnostic).diagnostic).toEqual({ status: 'unavailable', reason: 'unsafe-artifact-reference' });
    let handler: (() => unknown) | undefined;
    const app = { get: (path: string, candidate: () => unknown) => {
      if (path === '/api/figment') handler = candidate;
      else expect(path).toBe('/api/figment/diagnostic-assets/:name');
    } };
    registerFigmentRead(app as never, { repoRoot: paths.repo, diagnosticRoot: paths.diagnostic });
    const response = await handler!();
    expect((response as { diagnostic: { status: string } }).diagnostic.status).toBe('unavailable');
  });

  it('streams only a receipt-listed PNG at the displayed hash and detects stale substitution', async () => {
    const paths = await fixture();
    const projection = buildFigmentProjection(paths.repo, paths.diagnostic);
    if (projection.diagnostic.status !== 'diagnostic-not-promotable') throw new Error('fixture diagnostic unavailable');
    const asset = projection.diagnostic.artifacts[0];
    const app = Fastify(); registerFigmentRead(app, { repoRoot: paths.repo, diagnosticRoot: paths.diagnostic }); await app.ready();
    const url = `/api/figment/diagnostic-assets/${asset.name}?sha256=${asset.sha256}`;
    // This listed sibling is deliberately not a PNG. Serving the first asset proves the
    // binary route validates receipt membership but reads only its requested file.
    const sibling = Buffer.from('not a PNG');
    await writeFile(join(paths.diagnostic, 'unrequested.png'), sibling);
    await json(join(paths.diagnostic, 'run.json'), { dry_run: false, pod_id: 'fixture-pod', jobs: [{ files: [{ path: 'proof.png', bytes: asset.bytes }, { path: 'unrequested.png', bytes: sibling.length }] }] });
    const response = await app.inject({ method: 'GET', url });
    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('image/png');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.rawPayload).toEqual(png());
    const replacement = png(19);
    expect(replacement.length).toBe(asset.bytes);
    await writeFile(join(paths.diagnostic, asset.name), replacement);
    expect((await app.inject({ method: 'GET', url })).statusCode).toBe(409);
    expect((await app.inject({ method: 'GET', url: '/api/figment/diagnostic-assets/..%2Foutside.png?sha256=' + asset.sha256 })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/figment/diagnostic-assets/not-listed.png?sha256=' + asset.sha256 })).statusCode).toBe(404);
    await app.close();
  });

  it('truncates after exactly 128 receipt-listed PNGs and refuses oversized assets', async () => {
    const paths = await fixture();
    const files: Array<{ path: string; bytes: number }> = [];
    const bytes = png();
    for (let index = 0; index < 129; index += 1) {
      const name = `proof-${String(index).padStart(3, '0')}.png`;
      await writeFile(join(paths.diagnostic, name), bytes); files.push({ path: name, bytes: bytes.length });
    }
    await json(join(paths.diagnostic, 'run.json'), { jobs: Array.from({ length: 5 }, (_unused, index) => ({ files: files.slice(index * 32, (index + 1) * 32) })) });
    const diagnostic = buildFigmentProjection(paths.repo, paths.diagnostic).diagnostic;
    expect(diagnostic).toMatchObject({ status: 'diagnostic-not-promotable', artifactsTruncated: true });
    if (diagnostic.status === 'diagnostic-not-promotable') expect(diagnostic.artifacts).toHaveLength(128);
    const oversized = Buffer.alloc(16 * 1024 * 1024 + 1);
    await writeFile(join(paths.diagnostic, 'too-large.png'), oversized);
    await json(join(paths.diagnostic, 'run.json'), { jobs: [{ files: [{ path: 'too-large.png', bytes: oversized.length }] }] });
    expect(buildFigmentProjection(paths.repo, paths.diagnostic).diagnostic).toEqual({ status: 'unavailable', reason: 'malformed-run-record' });
    const oversizedDimensions = png(); oversizedDimensions.writeUInt32BE(100_000, 16); oversizedDimensions.writeUInt32BE(100_000, 20);
    await writeFile(join(paths.diagnostic, 'too-wide.png'), oversizedDimensions);
    await json(join(paths.diagnostic, 'run.json'), { jobs: [{ files: [{ path: 'too-wide.png', bytes: oversizedDimensions.length }] }] });
    expect(buildFigmentProjection(paths.repo, paths.diagnostic).diagnostic).toEqual({ status: 'unavailable', reason: 'malformed-run-record' });
  });

  it('accepts a single receipt job with the actual 81-frame video output shape', async () => {
    const paths = await fixture();
    const image = png(); const files: Array<{ path: string; bytes: number }> = [];
    for (let index = 0; index < 81; index += 1) {
      const name = `frame-${String(index).padStart(3, '0')}.png`;
      await writeFile(join(paths.diagnostic, name), image);
      files.push({ path: name, bytes: image.length });
    }
    await json(join(paths.diagnostic, 'run.json'), { dry_run: false, pod_id: 'fixture-pod', jobs: [{ files }] });
    const diagnostic = buildFigmentProjection(paths.repo, paths.diagnostic).diagnostic;
    expect(diagnostic).toMatchObject({ status: 'diagnostic-not-promotable', artifactsTruncated: false });
    if (diagnostic.status === 'diagnostic-not-promotable') expect(diagnostic.artifacts).toHaveLength(81);
  });

  it('stops at the aggregate cap before opening the next receipt-listed artifact', async () => {
    const paths = await fixture();
    const limit = 16 * 1024 * 1024;
    const head = png(); const atPerFileLimit = Buffer.concat([head, Buffer.alloc(limit - head.length)]);
    const files: Array<{ path: string; bytes: number }> = [];
    for (let index = 0; index < 8; index += 1) {
      const name = `cap-${index}.png`;
      await writeFile(join(paths.diagnostic, name), atPerFileLimit);
      files.push({ path: name, bytes: limit });
    }
    // The ninth listed file is deliberately absent: at 128 MiB, projection must mark
    // truncation without attempting to open it.
    files.push({ path: 'must-not-open.png', bytes: limit });
    await json(join(paths.diagnostic, 'run.json'), { jobs: [{ files }] });
    const diagnostic = buildFigmentProjection(paths.repo, paths.diagnostic).diagnostic;
    expect(diagnostic).toMatchObject({ status: 'diagnostic-not-promotable', artifactsTruncated: true });
    if (diagnostic.status === 'diagnostic-not-promotable') expect(diagnostic.artifacts).toHaveLength(8);
  });

  it('skips oversized JSON records with a readable warning', async () => {
    const paths = await fixture();
    const oversized = join(paths.repo, 'orgs', 'figment', 'runs', 'oversized', 'run.json');
    await mkdir(join(oversized, '..'), { recursive: true });
    await writeFile(oversized, ' '.repeat(1_048_577), 'utf8');
    const projection = buildFigmentProjection(paths.repo);
    expect(projection.records.some((record) => record.path.endsWith('oversized/run.json'))).toBe(true);
    expect(projection.warnings).toContain('Skipped oversized JSON record: runs/oversized/run.json');
  });

  it('caps 257 creator and research entries and marks the research list truncated', async () => {
    const paths = await fixture();
    const figment = join(paths.repo, 'orgs', 'figment');
    for (let index = 0; index < 256; index += 1) {
      await json(join(figment, 'personas', `creator-${String(index).padStart(3, '0')}`, 'persona.yaml'), { id: index });
      await writeFile(join(figment, 'research', `note-${String(index).padStart(3, '0')}.md`), 'x', 'utf8');
    }
    const projection = buildFigmentProjection(paths.repo);
    expect(projection.creators).toHaveLength(256);
    // The one book artifact shares the global 256-artifact response budget.
    expect(projection.research.artifacts.filter((artifact) => artifact.area === 'research')).toHaveLength(255);
    expect(projection.research.truncated).toBe(true);
  });

  it('caps exactly 257 creators and identifies the omitted creator list entry', async () => {
    const paths = await fixture();
    const personas = join(paths.repo, 'orgs', 'figment', 'personas');
    // The fixture supplies creator-a and broken; 255 more makes the directory exactly 257 entries.
    for (let index = 0; index < 255; index += 1) {
      await json(join(personas, `creator-${String(index).padStart(3, '0')}`, 'persona.yaml'), { id: index });
    }
    const projection = buildFigmentProjection(paths.repo);
    expect(projection.creators).toHaveLength(256);
    expect(projection.creatorsTruncated).toBe(true);
  });

  it('does not hash oversized gate subjects or accepted checkpoint inputs', async () => {
    const paths = await fixture();
    await writeFile(paths.subject, 'x'.repeat(1_048_577), 'utf8');
    let projection = buildFigmentProjection(paths.repo);
    expect(projection.records.find((record) => record.type === 'gate')?.machineGateState).toBe('stale');
    const plan = join(paths.repo, 'orgs', 'figment', 'personas', 'creator-a', 'batches', 'one', 'plan.json');
    await writeFile(plan, 'x'.repeat(1_048_577), 'utf8');
    projection = buildFigmentProjection(paths.repo);
    expect(projection.records.find((record) => record.type === 'accepted-checkpoint')?.reviewState).toBe('unknown');
  });
});

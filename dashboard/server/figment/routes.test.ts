import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildFigmentProjection, registerFigmentRead } from './routes.ts';

const temporary: string[] = [];
afterEach(async () => { while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true }); });

function digest(value: string): string { return createHash('sha256').update(value).digest('hex'); }
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
  await json(join(figment, 'runs', 'current', 'driver-plan.json'), { schema: 'figment/train-plan@1' });
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
  await writeFile(join(diagnostic, 'proof.png'), 'fixture image', 'utf8');
  await json(join(diagnostic, 'run.json'), { dry_run: false, pod_id: 'fixture-pod', jobs: [{ files: [{ path: 'proof.png' }] }] });
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
    expect(projection.diagnostic).toMatchObject({ status: 'diagnostic-not-promotable', podId: 'fixture-pod', artifacts: [{ name: 'proof.png' }] });
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

  it('rejects diagnostic artifact traversal and serves the read-only route', async () => {
    const paths = await fixture();
    const link = `${paths.diagnostic}-link`;
    temporary.push(link);
    await symlink(paths.diagnostic, link, 'junction');
    expect(buildFigmentProjection(paths.repo, link).diagnostic).toEqual({ status: 'unavailable', reason: 'unsafe-configured-root' });
    await json(join(paths.diagnostic, 'run.json'), { jobs: [{ files: [{ path: '../outside.txt' }] }] });
    expect(buildFigmentProjection(paths.repo, paths.diagnostic).diagnostic).toEqual({ status: 'unavailable', reason: 'unsafe-artifact-reference' });
    let handler: (() => unknown) | undefined;
    const app = { get: (path: string, candidate: () => unknown) => {
      expect(path).toBe('/api/figment');
      handler = candidate;
    } };
    registerFigmentRead(app as never, { repoRoot: paths.repo, diagnosticRoot: paths.diagnostic });
    const response = await handler!();
    expect((response as { diagnostic: { status: string } }).diagnostic.status).toBe('unavailable');
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

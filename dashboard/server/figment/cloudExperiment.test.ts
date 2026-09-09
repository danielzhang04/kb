import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { collectCloudExperiment, collectTrainFirst } from './cloudExperiment.ts';

const temporary: string[] = [];
async function fixture(overrides: Record<string, unknown> = {}): Promise<string> { const root = await mkdtemp(join(tmpdir(), 'figment-cloud-experiment-')); temporary.push(root); await writeFile(join(root, 'run.json'), JSON.stringify({ schema: 'figment/runpod-run@1', dry_run: false, started_utc: '2026-09-09T07:33:27+00:00', finished_utc: '2026-09-09T07:34:21+00:00', max_minutes: 60, preflight_estimate_usd: 1.3, estimated_actual_usd: 0.019366, termination_verified: true, jobs: [], artifacts: [], error: 'BootstrapFailed: bootstrap failed after 3 attempts', pod_id: 'must-not-project', uploads: [{ name: 'g01.jpg' }], bootstrap_log_tail: 'must-not-project', ...overrides })); return root; }
afterEach(async () => { await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });

describe('cloud experiment projection', () => {
  it('refuses malformed error values instead of labeling a failed receipt completed', async () => {
    for (const error of [null, false, 7, {}, '']) {
      const root = await fixture({ error });
      expect(collectCloudExperiment(root)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    }
  });
  it('distinguishes a terminal bootstrap failure from quality review and redacts sensitive run fields', async () => { const root = await fixture(); const result = collectCloudExperiment(root); expect(result).toEqual({ status: 'recorded', execution: 'failed', liveness: null, maxMinutes: 60, maxUsd: null, preflightEstimateUsd: 1.3, estimatedActualUsd: 0.019366, startedUtc: '2026-09-09T07:33:27+00:00', finishedUtc: '2026-09-09T07:34:21+00:00', terminationVerified: true, outputCount: 0, quality: 'not-reviewed', failure: 'bootstrap' }); expect(JSON.stringify(result)).not.toContain('must-not-project'); });
  it('counts validated producer job files and never ancillary artifacts as output images', async () => { const completed = await fixture({ error: undefined, jobs: [{ files: [{ path: 'seed-481516234.png', bytes: 721 }, { path: 'seed-90210.png', bytes: 722 }] }], artifacts: [{ private_path: 'not-projected' }] }); expect(collectCloudExperiment(completed)).toMatchObject({ execution: 'completed', outputCount: 2, quality: 'not-reviewed', failure: null }); });
  it('reads one producer-shaped acquired journal without mislabeling its spend cap as an estimate', async () => { const root = await mkdtemp(join(tmpdir(), 'figment-cloud-experiment-')); temporary.push(root); const podName = 'figment-bakeoff-20260909-074204-64f1e1'; const record = { schema: 'figment/pod-recovery@1', state: 'acquired', attempt_id: podName, pod_name: podName, manifest_path: join(root, 'driver-plan.json'), manifest_sha256: 'a'.repeat(64), max_minutes: 60, max_usd: 10, created_utc: '2026-09-09T07:42:04+00:00', receipt_path: join(root, 'run.json'), pod_id: 'must-not-project', absence_verified: false, intent_sha256: 'b'.repeat(64) }; await writeFile(join(root, `recovery-${podName}.json`), JSON.stringify(record)); expect(collectCloudExperiment(root)).toEqual({ status: 'recorded', execution: 'started-pending-final', liveness: 'unknown', maxMinutes: 60, maxUsd: 10, preflightEstimateUsd: null, estimatedActualUsd: null, startedUtc: '2026-09-09T07:42:04+00:00', finishedUtc: null, terminationVerified: null, outputCount: 0, quality: 'not-reviewed', failure: null }); await writeFile(join(root, 'recovery-figment-bakeoff-20260909-074205-64f1e2.json'), JSON.stringify(record)); expect(collectCloudExperiment(root)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' }); });
  it('refuses incomplete acquired journals and receipts outside the configured run directory', async () => { const root = await mkdtemp(join(tmpdir(), 'figment-cloud-experiment-')); temporary.push(root); const podName = 'figment-bakeoff-20260909-074204-64f1e1'; const path = join(root, `recovery-${podName}.json`); const record = { schema: 'figment/pod-recovery@1', state: 'acquired', attempt_id: podName, pod_name: podName, manifest_path: join(root, 'driver-plan.json'), manifest_sha256: 'a'.repeat(64), max_minutes: 60, max_usd: 10, created_utc: '2026-09-09T07:42:04+00:00', receipt_path: join(root, 'run.json'), pod_id: 'pod-1', absence_verified: false, intent_sha256: 'b'.repeat(64) }; const { pod_id: _podId, ...missingPod } = record; await writeFile(path, JSON.stringify(missingPod)); expect(collectCloudExperiment(root)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' }); await writeFile(path, JSON.stringify({ ...record, receipt_path: join(tmpdir(), 'foreign', 'run.json') })); expect(collectCloudExperiment(root)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' }); });
  it('fails closed for malformed records and reparse roots', async () => { const malformed = await fixture({ schema: 'wrong' }); expect(collectCloudExperiment(malformed)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' }); const root = await fixture(); const link = `${root}-link`; temporary.push(link); await symlink(root, link, 'junction'); expect(collectCloudExperiment(link)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' }); expect(collectCloudExperiment()).toEqual({ status: 'not-configured' }); });
});

async function trainFirstFixture(): Promise<{ root: string; planSha256: string; trainManifest: string; testerManifest: string; trainOut: string; testerOut: string }> {
  const root = await mkdtemp(join(tmpdir(), 'figment-train-first-')); temporary.push(root);
  const trainManifest = 'train/runs/train.yaml', testerManifest = 'train/runs/tester.yaml';
  const trainOut = 'train/runs/out/train', testerOut = 'train/runs/out/tester';
  await mkdir(join(root, 'train', 'runs'), { recursive: true });
  const hash = (source: string): string => createHash('sha256').update(source).digest('hex');
  const artifacts = Array.from({ length: 5 }, (_, index) => { const name = `creator-step-${(index + 1) * 250}.safetensors`; return { remote: name, local: name, type: 'output', wait_for: '_training.complete' }; });
  const outputs = Array.from({ length: 5 }, (_, index) => `tester-${index + 1}`);
  const trainSource = JSON.stringify({ artifacts, jobs: [{ output_name: 'training-sentinel', expected_images: 1 }] });
  const testerSource = JSON.stringify({ artifacts: [], jobs: outputs.map((output_name) => ({ output_name, expected_images: 1 })) });
  await writeFile(join(root, trainManifest), trainSource); await writeFile(join(root, testerManifest), testerSource);
  const run = (manifest: string, manifestSource: string, out: string, maxMinutes: number, maxUsd: string) => ({ manifest, sha256: hash(manifestSource), ceiling_usd: maxUsd, out, argv: ['python', 'runpod_run.py', 'run', '--manifest', join(root, manifest), '--out', join(root, out), '--max-usd', maxUsd, '--max-minutes', String(maxMinutes)] });
  const plan = { schema: 'figment/train-plan@1', creator: 'creator-001', variant: 'train-first', stages: { train: { runs: [run(trainManifest, trainSource, trainOut, 351, '7.61')] }, tester: { runs: [run(testerManifest, testerSource, testerOut, 115, '2.50')] } } };
  const source = JSON.stringify(plan); await writeFile(join(root, 'plan.json'), source);
  return { root, planSha256: hash(source), trainManifest, testerManifest, trainOut, testerOut };
}
const stage = (fixture: Awaited<ReturnType<typeof trainFirstFixture>>, selected: 'train' | 'tester', status: 'running' | 'failed' | 'complete') => ({ schema: 'figment/train-stage@1', creator: 'creator-001', plan_sha256: fixture.planSha256, status: status === 'running' ? `running:${selected}` : status === 'failed' ? `stopped:${selected}` : `complete:${selected}`, runs: { [selected === 'train' ? fixture.trainManifest : fixture.testerManifest]: { status, started_utc: '2026-09-09T20:12:32Z' } }, completed_stages: status === 'complete' ? selected === 'train' ? ['train'] : ['train', 'tester'] : selected === 'tester' ? ['train'] : [] });
const receipt = (maxMinutes: number, maxUsd: number, extra: Record<string, unknown>) => ({ schema: 'figment/runpod-run@1', dry_run: false, max_minutes: maxMinutes, preflight_estimate_usd: maxUsd, started_utc: '2026-09-09T20:12:33Z', finished_utc: '2026-09-09T20:20:33Z', termination_verified: true, placement_attempts: [{ termination_verified: true }], ...extra });

describe('train-first lifecycle projection', () => {
  it('requires both an exact configured root and exact plan digest', async () => {
    const item = await trainFirstFixture();
    expect(collectTrainFirst()).toEqual({ status: 'not-configured' });
    expect(collectTrainFirst(item.root)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    expect(collectTrainFirst(item.root, '0'.repeat(64))).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    expect(collectTrainFirst(item.root, item.planSha256)).toMatchObject({ status: 'recorded', stage: 'train', execution: 'planned', maxMinutes: 351, maxUsd: 7.61 });
  });
  it('projects an active train attempt without claiming process or provider liveness', async () => {
    const item = await trainFirstFixture(); await writeFile(join(item.root, 'stage.json'), JSON.stringify(stage(item, 'train', 'running')));
    const result = collectTrainFirst(item.root, item.planSha256);
    expect(result).toMatchObject({ status: 'recorded', stage: 'train', execution: 'running', liveness: 'unknown', startedUtc: '2026-09-09T20:12:32Z', checkpoints: [], outputCount: 0, quality: 'not-reviewed' });
    expect(JSON.stringify(result)).not.toMatch(/pod|path|prompt|error/i);
  });
  it('projects exactly five manifest-bound safetensors after verified teardown without reading their contents', async () => {
    const item = await trainFirstFixture(), output = join(item.root, item.trainOut); await mkdir(output, { recursive: true });
    const artifacts = [];
    for (let index = 1; index <= 5; index += 1) { const name = `creator-step-${index * 250}.safetensors`, body = Buffer.from(`checkpoint-${index}`); await writeFile(join(output, name), body); artifacts.push({ remote: name, path: name, type: 'output', wait_for: '_training.complete', bytes: body.length }); }
    await writeFile(join(item.root, 'stage.json'), JSON.stringify(stage(item, 'train', 'complete')));
    await writeFile(join(output, 'run.json'), JSON.stringify(receipt(351, 7.61, { artifacts, jobs: [] })));
    const result = collectTrainFirst(item.root, item.planSha256);
    expect(result).toMatchObject({ status: 'recorded', stage: 'train', execution: 'completed', terminationVerified: true, outputCount: 0 });
    expect(result.status === 'recorded' ? result.checkpoints : []).toHaveLength(5);
    expect(result.status === 'recorded' ? result.checkpoints[0] : null).toEqual({ name: 'creator-step-250.safetensors', bytes: Buffer.byteLength('checkpoint-1') });
    await writeFile(join(output, artifacts[0].path), 'changed-checkpoint-bytes');
    expect(collectTrainFirst(item.root, item.planSha256)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });
  it('counts five tester PNGs and rejects dry-run, stale, or inconsistent terminal evidence', async () => {
    const item = await trainFirstFixture(), output = join(item.root, item.testerOut); await mkdir(output, { recursive: true });
    const complete = stage(item, 'tester', 'complete'); await writeFile(join(item.root, 'stage.json'), JSON.stringify(complete));
    const jobs = [];
    for (let index = 0; index < 5; index += 1) { const name = `tester-${index + 1}.png`, body = Buffer.alloc(100 + index, index); await writeFile(join(output, name), body); jobs.push({ output_name: `tester-${index + 1}`, files: [{ path: name, bytes: body.length }] }); }
    await writeFile(join(output, 'run.json'), JSON.stringify(receipt(115, 2.5, { artifacts: [], jobs })));
    expect(collectTrainFirst(item.root, item.planSha256)).toMatchObject({ status: 'recorded', stage: 'tester', execution: 'completed', outputCount: 5, checkpoints: [], terminationVerified: true });
    await writeFile(join(output, 'run.json'), JSON.stringify(receipt(115, 2.5, { artifacts: [], jobs: [{ ...jobs[0], output_name: 'unrelated' }, ...jobs.slice(1)] })));
    expect(collectTrainFirst(item.root, item.planSha256)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    await writeFile(join(output, 'run.json'), JSON.stringify({ ...receipt(115, 2.5, { artifacts: [], jobs }), dry_run: true }));
    expect(collectTrainFirst(item.root, item.planSha256)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    await writeFile(join(output, 'run.json'), JSON.stringify(receipt(115, 2.5, { artifacts: [], jobs })));
    await writeFile(join(item.root, 'stage.json'), JSON.stringify({ ...complete, status: 'running:tester' }));
    expect(collectTrainFirst(item.root, item.planSha256)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });
  it('fails closed for a reparse root', async () => {
    const item = await trainFirstFixture(), link = `${item.root}-link`; temporary.push(link); await symlink(item.root, link, 'junction');
    expect(collectTrainFirst(link, item.planSha256)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });
  it('reports a plan-bound failed terminal receipt without projecting its error', async () => {
    const item = await trainFirstFixture(), output = join(item.root, item.trainOut); await mkdir(output, { recursive: true });
    await writeFile(join(item.root, 'stage.json'), JSON.stringify(stage(item, 'train', 'failed')));
    await writeFile(join(output, 'run.json'), JSON.stringify(receipt(351, 7.61, { artifacts: [], jobs: [], error: 'must-not-project' })));
    const result = collectTrainFirst(item.root, item.planSha256);
    expect(result).toMatchObject({ status: 'recorded', stage: 'train', execution: 'failed', terminationVerified: true, checkpoints: [], outputCount: 0 });
    expect(JSON.stringify(result)).not.toContain('must-not-project');
  });
  it('does not treat an unsafe stage entry as an absent, unstarted stage', async () => {
    const item = await trainFirstFixture(), foreign = await mkdtemp(join(tmpdir(), 'figment-stage-foreign-')); temporary.push(foreign); await symlink(foreign, join(item.root, 'stage.json'), 'junction');
    expect(collectTrainFirst(item.root, item.planSha256)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });
});

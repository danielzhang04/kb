import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectLocalTrainingReadiness, type FigmentLocalTrainingEvidenceRoots } from './localTraining.ts';

const temporary: string[] = [];
afterEach(async () => { while (temporary.length) await rm(temporary.pop()!, { recursive: true, force: true }); });

function digest(value: string | Buffer): string { return createHash('sha256').update(value).digest('hex'); }
function canonical(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value) as string;
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}
function frozen(value: Record<string, unknown>): Record<string, unknown> { return { ...value, frozen_sha256: digest(canonical(value)) }; }
async function json(path: string, value: unknown): Promise<Buffer> { const raw = Buffer.from(JSON.stringify(value), 'utf8'); await writeFile(path, raw); return raw; }

async function fixture(): Promise<{ roots: FigmentLocalTrainingEvidenceRoots; cpuReceipt: string; planReceipt: string; tokenizerLaunchReceipt: string; tokenizerReceipt: string }> {
  const root = await mkdtemp(join(tmpdir(), 'figment-local-training-')); temporary.push(root);
  const cpu = join(root, 'cpu'), launch = join(root, 'launch'), planRoot = join(root, 'plan'), tokens = join(root, 'tokens');
  await Promise.all([mkdir(cpu), mkdir(launch), mkdir(planRoot), mkdir(tokens)]);
  const plan = frozen({
    schema: 'figment/local-single-observation-lora-plan@1', creator: 'creator-001', not_promotable: true,
    execution: { cpu_preflight_allowed: true, gpu_fit_probe_allowed: false, checkpoint_acceptance_allowed: false, sample_export_allowed: false },
    observation: { count: 1, independent_views: 1, kind: 'canonical-original-pixels' },
    fit_probe: { max_train_steps: 10, samples: 0, exports: 0 }, source: { logical_path: 'anchors/g01.jpg' },
  });
  const planRaw = await json(join(planRoot, 'local-single-observation-plan.json'), plan);
  await json(join(cpu, 'receipt.json'), {
    schema: 'figment/local-cpu-preflight-launch@1', status: 'complete', plan_sha256: plan.frozen_sha256,
    inputs: { plan_canonical_sha256: plan.frozen_sha256, plan_file_sha256: digest(planRaw) }, process: { exit_code: 0 }, teardown: { verified_stopped: true },
    result: { schema: 'figment/local-single-observation-cpu-preflight@1', plan_sha256: plan.frozen_sha256, observations: 1, unique_source_images: 1, repeat_count: 1, cuda_visible_devices: '-1', cuda_available: false, cuda_device_count: 0, cuda_initialized: false, not_promotable: true, gpu_fit_probe_allowed: false, offline_environment: ['PYTORCH_NVML_BASED_CUDA_CHECK'], target_resolution: [768, 768], effective_buckets: [[896, 512]] },
  });
  const inner = frozen({
    schema: 'figment/local-tokenizer-load@1', not_promotable: true, runtime_or_training_approval: false, cuda_visible_devices: '-1', pytorch_nvml_based_cuda_check: '1', cuda_available: false, cuda_device_count: 0, cuda_initialized: false, torch_imported: true,
    tokenizers: [
      { id: 'openai/clip-vit-large-patch14', class: 'CLIPTokenizer', local_files_only: true, caption_token_count: 19, effective_pad_token_id: 49407 },
      { id: 'laion/CLIP-ViT-bigG-14-laion2B-39B-b160k', class: 'CLIPTokenizer', local_files_only: true, caption_token_count: 19, effective_pad_token_id: 0 },
    ],
  });
  const innerRaw = await json(join(tokens, 'local-tokenizer-load.json'), inner);
  const launchRaw = {
    schema: 'figment/local-tokenizer-load-launch@1', status: 'complete', process: { exit_code: 0 }, teardown: { verified_stopped: true },
    tokenizer_load_receipt_raw_sha256: digest(innerRaw), tokenizer_load_receipt_frozen_sha256: inner.frozen_sha256,
  };
  const cpuReceipt = join(cpu, 'receipt.json'); const planReceipt = join(planRoot, 'local-single-observation-plan.json'); const tokenizerLaunchReceipt = join(launch, 'receipt.json'); const tokenizerReceipt = join(tokens, 'local-tokenizer-load.json');
  await json(tokenizerLaunchReceipt, launchRaw);
  return { roots: { cpuPreflight: cpu, tokenizerLaunch: launch, plan: planRoot, tokenizerLoad: tokens }, cpuReceipt, planReceipt, tokenizerLaunchReceipt, tokenizerReceipt };
}

describe('local training readiness projection', () => {
  it('projects only a historical local preparation snapshot', async () => {
    const evidence = await fixture(); const projection = collectLocalTrainingReadiness(evidence.roots);
    expect(projection).toEqual(expect.objectContaining({ status: 'recorded', historical: true, preparation: expect.objectContaining({ source: 'anchors/g01.jpg', originalObservations: 1, repeatCount: 1, targetResolution: [768, 768], effectiveBucket: [896, 512], tokenizerLoads: [{ id: 'laion/CLIP-ViT-bigG-14-laion2B-39B-b160k', probeTokenCount: 19 }, { id: 'openai/clip-vit-large-patch14', probeTokenCount: 19 }] }) }));
    const serialized = JSON.stringify(projection);
    for (const forbidden of ['logs', 'caption', 'pid', 'stdout', 'stderr', evidence.cpuReceipt, evidence.planReceipt]) expect(serialized).not.toContain(forbidden);
  });

  it('fails closed when a plan binding changes', async () => {
    const evidence = await fixture();
    const cpu = JSON.parse(await (await import('node:fs/promises')).readFile(evidence.cpuReceipt, 'utf8')) as Record<string, unknown>;
    (cpu.inputs as Record<string, unknown>).plan_file_sha256 = '0'.repeat(64);
    await json(evidence.cpuReceipt, cpu);
    expect(collectLocalTrainingReadiness(evidence.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });

  it('refuses a missing inner frozen hash even when an untyped wrapper null would compare equal', async () => {
    const evidence = await fixture();
    const inner = JSON.parse(await (await import('node:fs/promises')).readFile(evidence.tokenizerReceipt, 'utf8')) as Record<string, unknown>;
    delete inner.frozen_sha256;
    const innerRaw = await json(evidence.tokenizerReceipt, inner);
    const launch = JSON.parse(await (await import('node:fs/promises')).readFile(evidence.tokenizerLaunchReceipt, 'utf8')) as Record<string, unknown>;
    launch.tokenizer_load_receipt_raw_sha256 = digest(innerRaw);
    launch.tokenizer_load_receipt_frozen_sha256 = null;
    await json(evidence.tokenizerLaunchReceipt, launch);
    expect(collectLocalTrainingReadiness(evidence.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });

  it('refuses unsafe and incomplete configured roots without discovery', async () => {
    const evidence = await fixture(); const linked = `${evidence.roots.cpuPreflight}-link`;
    await symlink(evidence.roots.cpuPreflight, linked, 'dir'); temporary.push(linked);
    expect(collectLocalTrainingReadiness({ ...evidence.roots, cpuPreflight: linked })).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    expect(collectLocalTrainingReadiness({ ...evidence.roots, tokenizerLoad: join(evidence.roots.tokenizerLoad, 'missing') })).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });

  it('reports no configured evidence separately from invalid evidence', () => {
    expect(collectLocalTrainingReadiness()).toEqual({ status: 'not-configured' });
  });
});

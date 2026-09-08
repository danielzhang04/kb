import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { collectLocalTrainingReadiness, collectLocalTrainingResults, type FigmentLocalTrainingEvidenceRoots, type FigmentLocalTrainingResultRoots } from './localTraining.ts';

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

async function resultFixture(): Promise<{ roots: FigmentLocalTrainingResultRoots; currentReceipt: string; currentCpuReceipt: string; currentAdmission: string }> {
  const root = await mkdtemp(join(tmpdir(), 'figment-local-results-')); temporary.push(root);
  const tenRun = join(root, 'ten-run'), tenPlanRoot = join(root, 'ten-plan'), currentRun = join(root, 'current-run'), currentPlanRoot = join(root, 'current-plan'), cpuRoot = join(root, 'current-cpu'), admissions = join(root, 'admissions');
  await Promise.all([mkdir(tenRun), mkdir(tenPlanRoot), mkdir(currentRun), mkdir(currentPlanRoot), mkdir(cpuRoot), mkdir(admissions)]);
  const tenPlan = frozen({
    schema: 'figment/local-single-observation-lora-plan@1', creator: 'creator-001', not_promotable: true,
    execution: { cpu_preflight_allowed: true, gpu_fit_probe_allowed: false, checkpoint_acceptance_allowed: false, sample_export_allowed: false },
    observation: { count: 1, independent_views: 1, kind: 'canonical-original-pixels' }, fit_probe: { max_train_steps: 10, samples: 0, exports: 0 }, source: { logical_path: 'anchors/g01.jpg' },
  });
  await json(join(tenPlanRoot, 'local-single-observation-plan.json'), tenPlan);
  const recipeNames = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100].map((step) => `figmentlocalg01quality-current-100-step${String(step).padStart(8, '0')}.safetensors`).concat('figmentlocalg01quality-current-100.safetensors');
  const recipeSteps = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 100];
  const currentPlan = frozen({
    schema: 'figment/local-one-source-quality-plan@1', creator: 'creator-001', branch: 'current', purpose: 'one-source-local-quality-diagnostic', not_promotable: true,
    execution: { cpu_preflight_allowed: true, gpu_quality_allowed: false, checkpoint_acceptance_allowed: false, sample_export_allowed: false },
    observation: { count: 1, independent_views: 1, kind: 'canonical-original-pixels' },
    recipe: { max_train_steps: 100, save_every_n_steps: 10, samples: 0, exports: 0, save_state: false, checkpoint_names: recipeNames, checkpoint_steps: recipeSteps },
  });
  const currentPlanRaw = await json(join(currentPlanRoot, 'local-quality-plan.json'), currentPlan);
  const tenLauncher = 'a'.repeat(64), currentLauncher = 'b'.repeat(64);
  const tenAdmission = frozen({ schema: 'figment/local-single-observation-fit-admission@1', admission_id: 'ten-admission', plan_sha256: tenPlan.frozen_sha256, max_train_steps: 10, not_promotable: true, launcher_sha256: tenLauncher, allow_gpu_fit_probe: true });
  const currentAdmission = { schema: 'figment/local-quality-fit-admission@1', admission_id: 'current-admission', plan_sha256: currentPlan.frozen_sha256, max_train_steps: 100, not_promotable: true, launcher_sha256: currentLauncher, allow_gpu_quality: true, cpu_receipt_sha256: '' };
  const cpuReceipt = join(cpuRoot, 'receipt.json');
  const cpuRaw = await json(cpuReceipt, {
    schema: 'figment/local-quality-cpu-preflight-launch@1', status: 'complete', branch: 'current', inputs: { plan_canonical_sha256: currentPlan.frozen_sha256, plan_file_sha256: digest(currentPlanRaw) }, process: { exit_code: 0 }, teardown: { verified_stopped: true },
    result: { schema: 'figment/local-quality-cpu-preflight@1', plan_sha256: currentPlan.frozen_sha256, not_promotable: true, cuda_visible_devices: '-1', cuda_available: false, cuda_device_count: 0, cuda_initialized: false },
  });
  currentAdmission.cpu_receipt_sha256 = digest(cpuRaw);
  const currentAdmissionRecord = frozen(currentAdmission);
  await json(join(admissions, 'figment-local-lora-fit-admission-20260908-v2.json'), tenAdmission);
  await json(join(admissions, 'figment-local-quality-current-fit-admission-20260908-v1.json'), currentAdmissionRecord);
  await json(join(tenRun, 'receipt.json'), {
    schema: 'figment/local-single-observation-fit-probe@1', status: 'complete', exit_code: 0, failure: null, log_truncated: false, not_promotable: true, teardown: { verified_stopped: true }, duration_seconds: 10.5,
    admission_id: 'ten-admission', plan_sha256: tenPlan.frozen_sha256, launcher_sha256: tenLauncher,
    final_checkpoint: { path: 'figmentlocalg01probe.safetensors', sha256: 'c'.repeat(64), bytes: 100 },
  });
  const currentReceipt = join(currentRun, 'receipt.json');
  await json(currentReceipt, {
    schema: 'figment/local-quality-fit@1', status: 'complete', exit_code: 0, failure: null, log_truncated: false, not_promotable: true, teardown: { verified_stopped: true }, duration_seconds: 100.5,
    admission_id: 'current-admission', plan_sha256: currentPlan.frozen_sha256, launcher_sha256: currentLauncher,
    inputs: { plan_sha256: currentPlan.frozen_sha256, plan_file_sha256: digest(currentPlanRaw), cpu_receipt_sha256: digest(cpuRaw) },
    checkpoints: recipeNames.map((path, index) => ({ path, ss_steps: recipeSteps[index], sha256: `${index}`.padStart(64, 'd'), bytes: 100 + index })),
  });
  return { roots: { tenStep: { run: tenRun, plan: tenPlanRoot, admissionParent: admissions }, currentQuality: { run: currentRun, plan: currentPlanRoot, admissionParent: admissions, cpu: cpuRoot } }, currentReceipt, currentCpuReceipt: cpuReceipt, currentAdmission: join(admissions, 'figment-local-quality-current-fit-admission-20260908-v1.json') };
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

describe('local training results projection', () => {
  it('projects the closed ten-step and current historical receipts without paths or logs', async () => {
    const evidence = await resultFixture();
    expect(collectLocalTrainingResults(evidence.roots)).toEqual({ status: 'recorded', historical: true, items: [
      { kind: 'availability-probe', completed: true, durationSeconds: 10.5, steps: 10, artifactCount: 1, checkpoints: [{ step: 10, sha256: 'c'.repeat(64), bytes: 100 }], quality: 'not-evaluated' },
      { kind: 'current-quality-fit', completed: true, durationSeconds: 100.5, steps: 100, artifactCount: 11, checkpoints: [
        { step: 20, sha256: 'd'.repeat(63) + '1', bytes: 101 }, { step: 50, sha256: 'd'.repeat(63) + '4', bytes: 104 }, { step: 100, sha256: 'd'.repeat(62) + '10', bytes: 110 },
      ], quality: 'not-evaluated' },
    ] });
    const serialised = JSON.stringify(collectLocalTrainingResults(evidence.roots));
    for (const forbidden of [evidence.currentReceipt, evidence.currentCpuReceipt, 'stderr', 'stdout', 'caption', 'pid']) expect(serialised).not.toContain(forbidden);
  });

  it('fails closed for a malformed checkpoint inventory or a masked-CPU violation', async () => {
    const evidence = await resultFixture();
    const current = JSON.parse(await readFile(evidence.currentReceipt, 'utf8')) as Record<string, unknown>;
    ((current.checkpoints as Array<Record<string, unknown>>)[3]).path = 'duplicate-name.safetensors';
    await json(evidence.currentReceipt, current);
    expect(collectLocalTrainingResults(evidence.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    const second = await resultFixture(); const cpu = JSON.parse(await readFile(second.currentCpuReceipt, 'utf8')) as Record<string, unknown>;
    ((cpu.result as Record<string, unknown>).cuda_available) = true;
    await json(second.currentCpuReceipt, cpu);
    expect(collectLocalTrainingResults(second.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });

  it('fails closed for mismatched admission identity or a changed frozen admission', async () => {
    const evidence = await resultFixture();
    const current = JSON.parse(await readFile(evidence.currentReceipt, 'utf8')) as Record<string, unknown>;
    current.admission_id = 'other-admission'; await json(evidence.currentReceipt, current);
    expect(collectLocalTrainingResults(evidence.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    const second = await resultFixture(); const admission = JSON.parse(await readFile(second.currentAdmission, 'utf8')) as Record<string, unknown>;
    admission.max_train_steps = 1; await json(second.currentAdmission, admission);
    expect(collectLocalTrainingResults(second.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });

  it('requires the current receipt to bind the exact CPU receipt and a positive bounded duration', async () => {
    const evidence = await resultFixture();
    const current = JSON.parse(await readFile(evidence.currentReceipt, 'utf8')) as Record<string, unknown>;
    (current.inputs as Record<string, unknown>).cpu_receipt_sha256 = '0'.repeat(64);
    await json(evidence.currentReceipt, current);
    expect(collectLocalTrainingResults(evidence.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    const second = await resultFixture(); const ten = JSON.parse(await readFile(join(second.roots.tenStep.run, 'receipt.json'), 'utf8')) as Record<string, unknown>;
    ten.duration_seconds = 0; await json(join(second.roots.tenStep.run, 'receipt.json'), ten);
    expect(collectLocalTrainingResults(second.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });

  it('requires the frozen admission authorization flag and rejects malformed configured groups', async () => {
    const evidence = await resultFixture();
    const admission = JSON.parse(await readFile(evidence.currentAdmission, 'utf8')) as Record<string, unknown>;
    delete admission.frozen_sha256; admission.allow_gpu_quality = false;
    await json(evidence.currentAdmission, frozen(admission));
    expect(collectLocalTrainingResults(evidence.roots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
    expect(collectLocalTrainingResults({} as FigmentLocalTrainingResultRoots)).toEqual({ status: 'unavailable', reason: 'evidence-unavailable' });
  });

  it('reports an omitted results configuration as not configured', () => {
    expect(collectLocalTrainingResults()).toEqual({ status: 'not-configured' });
  });
});

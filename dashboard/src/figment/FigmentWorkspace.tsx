import { Fragment, useEffect, useRef, useState } from 'react';
import { renderMarkdown } from '../lib/markdown';
import './figment.css';

type ReviewState = 'unreviewed' | 'stale' | 'approved' | 'unknown';
type MachineGateState = 'current' | 'stale' | null;
type Tab = 'creators' | 'assets' | 'plans' | 'training' | 'records' | 'research';
interface RecordRow { path: string; type: string; creator: string | null; reviewState: ReviewState; machineGateState: MachineGateState; schema: string | null; }
interface ResearchArtifact { area: 'research' | 'book'; name: string; bytes: number; modifiedAt: string; }
interface TesterPreview { schema: 'figment/plan-preview@1'; offlinePreview: true; notPromotable: true; creator: 'creator-001'; stage: 'tester'; runCount: number; declaredCeilingUsd: number; manifestSha256: string; }
interface StudioGenPlan { schema: 'figment/studio-gen-plan@1'; id: string; status: 'prepared'; creator: 'creator-001'; stage: 'gen'; runCount: 1; declaredCeilingUsd: number; planSha256: string; }
interface DeclaredReference { creator: string; name: string; bytes: number; sha256: string; width: number; height: number; modifiedAt: string; }
interface GeneratedInput { name: string; bytes: number; sha256: string; width: number; height: number; sourceReference: string; sourceSha256: string; generatedOn: string | null; reviewStatus: string; visualReview: Record<string, string>; }
type LocalTraining = { status: 'not-configured' } | { status: 'unavailable'; reason: 'evidence-unavailable' } | { status: 'recorded'; historical: true; preparation: { source: 'anchors/g01.jpg'; originalObservations: 1; repeatCount: 1; targetResolution: [number, number]; effectiveBucket: [number, number]; cpuCudaMasked: true; cpuVerifiedTeardown: true; tokenizerLoads: Array<{ id: string; probeTokenCount: number }> } };
type LocalTrainingResults = { status: 'not-configured' } | { status: 'unavailable'; reason: 'evidence-unavailable' } | { status: 'recorded'; historical: true; items: Array<{ kind: 'availability-probe' | 'current-quality-fit'; completed: true; durationSeconds: number; steps: number; artifactCount: number; checkpoints: Array<{ step: number; sha256: string; bytes: number }>; quality: 'not-evaluated' }> };
type MatchedObservation = { realism: string; resemblance_to_g01: string; pose: string; apparent_adulthood: string; apparent_age_fit: string; clothing: string; defects: string; };
type MatchedAsset = { assetId: 'base-481516234' | 'base-90210' | 'current-20-481516234' | 'current-20-90210'; sha256: string; bytes: number; width: 1024; height: 1024; };
type MatchedReview = { disposition: 'continue' | 'stop'; observations: MatchedObservation; };
type MatchedGallery = { status: 'not-configured' } | { status: 'unavailable'; reason: 'evidence-unavailable' } | { status: 'recorded'; historical: true; notPromotable: true; conditioning: 'no-pixel-reference-conditioning'; pairs: Array<{ seed: 481516234 | 90210; base: MatchedAsset; current20: MatchedAsset; reviews: { root: { base: MatchedReview; current20: MatchedReview }; independent: { base: MatchedReview; current20: MatchedReview } } }> };
type ProfileReview = { disposition: 'stop'; reason: string; observations: MatchedObservation; };
type ProfileRow = { seed: 481516234 | 90210; asset: { assetId: 'profile-base-481516234' | 'profile-base-90210'; sha256: string; bytes: number; width: 1024; height: 1024 }; reviews: { root: ProfileReview; independent: ProfileReview } };
type ProfileGallery = { status: 'not-configured' } | { status: 'unavailable'; reason: 'evidence-unavailable' } | { status: 'recorded'; stage: 'profile-base'; historical: true; notPromotable: true; conditioning: 'no-pixel-reference-conditioning'; selectedCheckpoint: null; rows: ProfileRow[] };
type CloudExperiment = { status: 'not-configured' } | { status: 'unavailable'; reason: 'evidence-unavailable' } | { status: 'recorded'; execution: 'started-pending-final' | 'failed' | 'completed'; liveness: 'unknown' | null; maxMinutes: number; maxUsd: number | null; preflightEstimateUsd: number | null; estimatedActualUsd: number | null; startedUtc: string; finishedUtc: string | null; terminationVerified: boolean | null; outputCount: number; quality: 'not-reviewed'; failure: 'bootstrap' | 'run' | null };
type TrainFirst = { status: 'not-configured' } | { status: 'unavailable'; reason: 'evidence-unavailable' } | { status: 'recorded'; planSha256: string; creator: string; stage: 'train' | 'tester'; execution: 'planned' | 'running' | 'failed' | 'completed'; liveness: 'unknown' | null; maxMinutes: number; maxUsd: number; startedUtc: string | null; finishedUtc: string | null; terminationVerified: boolean | null; checkpoints: Array<{ name: string; bytes: number }>; outputCount: number; quality: 'not-reviewed' | 'recorded-rejection' | 'unavailable' };
type CloudPairReview = { disposition: 'stop'; source: string; observations: { identity: string; realism: string; composition: string; clothing: string; safety: string } };
type CloudPairGallery = { status: 'not-configured' } | { status: 'unavailable'; reason: 'evidence-unavailable' } | { status: 'recorded'; experimentId: string; modelFamily: string; notPromotable: true; trainingEligible: false; rows: Array<{ seed: number; asset: { assetId: string; sha256: string; bytes: number; width: number; height: number }; reviews: { root: CloudPairReview; independent: CloudPairReview } }> };
type ContentBriefItem = { briefId: string; briefDate: string; creatorId: string; surface: 'carousel' | 'reel'; templateId: string; requiredAssetCount: number; requiredAssetSlots: Array<{ role: string; kind: 'persona' | 'nonpersona' }>; hypothesis: string; intendedMetric: string; sourceCount: number; sourceDates: string[]; observedMetrics: null; renderAs: 'text'; assignment?: 'missing' | 'recorded-snapshot' | 'recorded-source-snapshot' | 'unavailable' };
type ContentBriefs = { status: 'not-configured'; items: [] } | { status: 'empty'; recordKind: 'planning-snapshot'; currentSourceRevalidated: false; items: [] } | { status: 'unavailable'; reason: 'evidence-unavailable'; items: [] } | { status: 'recorded'; recordKind: 'planning-snapshot'; currentSourceRevalidated: false; items: ContentBriefItem[] };
interface Projection {
  schema: 'figment/hub@1'; available: boolean;
  creators: Array<{ id: string; persona: 'valid' | 'malformed'; loraTier: string | null; loraTrigger: string | null; accountTiers: string[] }>;
  creatorsTruncated: boolean; records: RecordRow[]; recordsTruncated: boolean;
  plans: { items: Array<{ path: string; creator: string; variant: string | null; stages: Array<{ name: string; runCount: number; declaredCeilingUsd: number | null }>; declaredCeilingUsd: number }>; truncated: boolean };
  research: { available: boolean; artifacts: ResearchArtifact[]; truncated: boolean };
  contentBriefs: ContentBriefs;
  references: { items: DeclaredReference[]; truncated: boolean };
  generatedInputs: { available: boolean; items: GeneratedInput[]; truncated: boolean };
  localTraining: LocalTraining;
  localTrainingResults: LocalTrainingResults;
  matchedGallery: MatchedGallery;
  profileGallery: ProfileGallery;
  cloudExperiment: CloudExperiment;
  trainFirst: TrainFirst;
  cloudPairGallery: CloudPairGallery;
  diagnostic: { status: 'not-configured' } | { status: 'unavailable'; reason: string } | { status: 'diagnostic-not-promotable'; dryRun: boolean | null; podId: string | null; artifacts: Array<{ name: string; bytes: number; sha256: string; width: number; height: number; modifiedAt: string }>; artifactsTruncated: boolean };
}

const states = new Set<ReviewState>(['unreviewed', 'stale', 'approved', 'unknown']);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const nullableString = (value: unknown): value is string | null => value === null || string(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const bounded = (value: unknown): value is unknown[] => Array.isArray(value) && value.length <= 512;
const safeArtifactName = (name: string): boolean => /^[A-Za-z0-9][A-Za-z0-9._ -]{0,180}$/.test(name) && name !== '.' && name !== '..' && !name.includes('..');
const sha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const nullableIso = (value: unknown): value is string | null => value === null || string(value) && value.length <= 40 && Number.isFinite(Date.parse(value));
const pair = (value: unknown): value is [number, number] => Array.isArray(value) && value.length === 2 && finite(value[0]) && value[0] > 0 && finite(value[1]) && value[1] > 0;

function localTraining(value: unknown): LocalTraining | null {
  // Older @1 hubs did not have this optional historical projection.
  if (value === undefined) return { status: 'not-configured' };
  if (!object(value)) return null;
  if (value.status === 'not-configured') return { status: 'not-configured' };
  if (value.status === 'unavailable' && value.reason === 'evidence-unavailable') return { status: 'unavailable', reason: 'evidence-unavailable' };
  const preparation = object(value.preparation) ? value.preparation : null;
  if (value.status !== 'recorded' || value.historical !== true || preparation === null || preparation.source !== 'anchors/g01.jpg' || preparation.originalObservations !== 1 || preparation.repeatCount !== 1 || !pair(preparation.targetResolution) || !pair(preparation.effectiveBucket) || preparation.cpuCudaMasked !== true || preparation.cpuVerifiedTeardown !== true || !Array.isArray(preparation.tokenizerLoads) || preparation.tokenizerLoads.length !== 2) return null;
  const seen = new Set<string>();
  for (const row of preparation.tokenizerLoads) {
    if (!object(row) || (row.id !== 'openai/clip-vit-large-patch14' && row.id !== 'laion/CLIP-ViT-bigG-14-laion2B-39B-b160k') || seen.has(row.id) || row.probeTokenCount !== 19) return null;
    seen.add(row.id);
  }
  return value as unknown as LocalTraining;
}

function localTrainingResults(value: unknown): LocalTrainingResults | null {
  // Older @1 hubs did not have this optional historical projection.
  if (value === undefined) return { status: 'not-configured' };
  if (!object(value)) return null;
  if (value.status === 'not-configured') return { status: 'not-configured' };
  if (value.status === 'unavailable' && value.reason === 'evidence-unavailable') return { status: 'unavailable', reason: 'evidence-unavailable' };
  if (value.status !== 'recorded' || value.historical !== true || !Array.isArray(value.items) || value.items.length !== 2) return null;
  const expected = new Map([['availability-probe', { steps: 10, artifacts: 1, checkpointSteps: [10] }], ['current-quality-fit', { steps: 100, artifacts: 11, checkpointSteps: [20, 50, 100] }]]);
  const seen = new Set<string>();
  for (const item of value.items) {
    if (!object(item) || typeof item.kind !== 'string' || seen.has(item.kind)) return null;
    const shape = expected.get(item.kind); if (!shape || item.completed !== true || item.steps !== shape.steps || item.artifactCount !== shape.artifacts || item.quality !== 'not-evaluated' || !finite(item.durationSeconds) || item.durationSeconds <= 0 || item.durationSeconds > 1200 || !Array.isArray(item.checkpoints) || item.checkpoints.length !== shape.checkpointSteps.length) return null;
    const checkpointSteps = new Set<number>();
    for (const [index, checkpoint] of item.checkpoints.entries()) if (!object(checkpoint) || checkpoint.step !== shape.checkpointSteps[index] || !finite(checkpoint.step) || checkpointSteps.has(checkpoint.step) || !sha256(checkpoint.sha256) || !finite(checkpoint.bytes) || checkpoint.bytes <= 0) return null; else checkpointSteps.add(checkpoint.step);
    seen.add(item.kind);
  }
  return seen.size === 2 ? value as unknown as LocalTrainingResults : null;
}

function matchedGallery(value: unknown): MatchedGallery | null {
  // Older @1 hubs did not have this optional historical projection.
  if (value === undefined) return { status: 'not-configured' };
  if (!object(value)) return null;
  if (value.status === 'not-configured') return { status: 'not-configured' };
  if (value.status === 'unavailable' && value.reason === 'evidence-unavailable') return { status: 'unavailable', reason: 'evidence-unavailable' };
  if (value.status !== 'recorded' || value.historical !== true || value.notPromotable !== true || value.conditioning !== 'no-pixel-reference-conditioning' || !Array.isArray(value.pairs) || value.pairs.length !== 2) return null;
  const seeds = [481516234, 90210] as const;
  const fields = ['realism', 'resemblance_to_g01', 'pose', 'apparent_adulthood', 'apparent_age_fit', 'clothing', 'defects'] as const;
  for (const [index, pairValue] of value.pairs.entries()) {
    if (!object(pairValue) || pairValue.seed !== seeds[index] || !object(pairValue.base) || !object(pairValue.current20) || !object(pairValue.reviews)) return null;
    for (const [kind, asset] of [['base', pairValue.base], ['current-20', pairValue.current20]] as const) if (asset.assetId !== `${kind}-${seeds[index]}` || !sha256(asset.sha256) || typeof asset.bytes !== 'number' || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 8 * 1024 * 1024 || asset.width !== 1024 || asset.height !== 1024) return null;
    for (const role of ['root', 'independent'] as const) {
      const reviewSet = pairValue.reviews[role]; if (!object(reviewSet)) return null;
      for (const kind of ['base', 'current20'] as const) { const review = reviewSet[kind]; const observations = object(review) && object(review.observations) ? review.observations : null; if (!object(review) || (review.disposition !== 'continue' && review.disposition !== 'stop') || observations === null || !fields.every((field) => string(observations[field]) && observations[field].length > 0 && observations[field].length <= 4096)) return null; }
    }
  }
  return value as unknown as MatchedGallery;
}

function profileGallery(value: unknown): ProfileGallery | null {
  // Older @1 hubs did not have this optional historical projection.
  if (value === undefined) return { status: 'not-configured' };
  if (!object(value)) return null;
  if (value.status === 'not-configured') return { status: 'not-configured' };
  if (value.status === 'unavailable' && value.reason === 'evidence-unavailable') return { status: 'unavailable', reason: 'evidence-unavailable' };
  if (value.status !== 'recorded' || value.stage !== 'profile-base' || value.historical !== true || value.notPromotable !== true || value.conditioning !== 'no-pixel-reference-conditioning' || value.selectedCheckpoint !== null || !Array.isArray(value.rows) || value.rows.length !== 2) return null;
  const seeds = [481516234, 90210] as const;
  const fields = ['realism', 'resemblance_to_g01', 'pose', 'apparent_adulthood', 'apparent_age_fit', 'clothing', 'defects'] as const;
  for (const [index, row] of value.rows.entries()) {
    if (!object(row) || row.seed !== seeds[index] || !object(row.asset) || !object(row.reviews)) return null;
    const asset = row.asset;
    if (asset.assetId !== `profile-base-${seeds[index]}` || !sha256(asset.sha256) || typeof asset.bytes !== 'number' || !Number.isSafeInteger(asset.bytes) || asset.bytes < 1 || asset.bytes > 8 * 1024 * 1024 || asset.width !== 1024 || asset.height !== 1024) return null;
    for (const role of ['root', 'independent'] as const) {
      const review = row.reviews[role]; const observations = object(review) && object(review.observations) ? review.observations : null;
      if (!object(review) || review.disposition !== 'stop' || !string(review.reason) || review.reason.length < 1 || review.reason.length > 2048 || observations === null || !fields.every((field) => string(observations[field]) && observations[field].length > 0 && observations[field].length <= 4096)) return null;
    }
  }
  return value as unknown as ProfileGallery;
}
function cloudExperiment(value: unknown): CloudExperiment | null { if (!object(value)) return null; if (value.status === 'not-configured') return value as CloudExperiment; if (value.status === 'unavailable' && value.reason === 'evidence-unavailable') return value as CloudExperiment; return value.status === 'recorded' && (value.execution === 'started-pending-final' || value.execution === 'failed' || value.execution === 'completed') && (value.liveness === null || value.liveness === 'unknown') && finite(value.maxMinutes) && (value.maxUsd === null || finite(value.maxUsd)) && (value.preflightEstimateUsd === null || finite(value.preflightEstimateUsd)) && (value.estimatedActualUsd === null || finite(value.estimatedActualUsd)) && string(value.startedUtc) && (value.finishedUtc === null || string(value.finishedUtc)) && (value.terminationVerified === null || typeof value.terminationVerified === 'boolean') && finite(value.outputCount) && value.outputCount >= 0 && value.quality === 'not-reviewed' && (value.failure === null || value.failure === 'bootstrap' || value.failure === 'run') ? value as CloudExperiment : null; }
function trainFirst(value: unknown): TrainFirst | null {
  if (value === undefined) return { status: 'not-configured' };
  if (!object(value)) return null;
  if (value.status === 'not-configured') return { status: 'not-configured' };
  if (value.status === 'unavailable' && value.reason === 'evidence-unavailable') return { status: 'unavailable', reason: 'evidence-unavailable' };
  if (value.status !== 'recorded' || !sha256(value.planSha256) || !string(value.creator) || !/^[A-Za-z0-9._-]{1,80}$/.test(value.creator) || (value.stage !== 'train' && value.stage !== 'tester') || !['planned', 'running', 'failed', 'completed'].includes(String(value.execution)) || (value.liveness !== null && value.liveness !== 'unknown') || !finite(value.maxMinutes) || value.maxMinutes <= 0 || value.maxMinutes > 840 || !finite(value.maxUsd) || value.maxUsd <= 0 || value.maxUsd > 50 || !nullableIso(value.startedUtc) || !nullableIso(value.finishedUtc) || (value.terminationVerified !== null && typeof value.terminationVerified !== 'boolean') || !Array.isArray(value.checkpoints) || value.checkpoints.length > 8 || !finite(value.outputCount) || !Number.isSafeInteger(value.outputCount) || value.outputCount > 128 || !['not-reviewed', 'recorded-rejection', 'unavailable'].includes(String(value.quality))) return null;
  if (value.startedUtc !== null && value.finishedUtc !== null && Date.parse(value.finishedUtc) < Date.parse(value.startedUtc)) return null;
  for (const checkpoint of value.checkpoints) if (!object(checkpoint) || !string(checkpoint.name) || !safeArtifactName(checkpoint.name) || !checkpoint.name.endsWith('.safetensors') || !finite(checkpoint.bytes) || !Number.isSafeInteger(checkpoint.bytes) || checkpoint.bytes < 1 || checkpoint.bytes > 512 * 1024 * 1024) return null;
  if (value.execution === 'planned' && (value.liveness !== null || value.startedUtc !== null || value.finishedUtc !== null || value.terminationVerified !== null || value.checkpoints.length !== 0 || value.outputCount !== 0)) return null;
  if (value.execution === 'running' && (value.liveness !== 'unknown' || value.startedUtc === null || value.finishedUtc !== null || value.terminationVerified !== null || value.checkpoints.length !== 0 || value.outputCount !== 0)) return null;
  if ((value.execution === 'failed' || value.execution === 'completed') && (value.liveness !== null || value.startedUtc === null || value.finishedUtc === null || value.terminationVerified !== true)) return null;
  if (value.execution === 'failed' && (value.checkpoints.length !== 0 || value.outputCount !== 0)) return null;
  if (value.execution === 'completed' && value.stage === 'train' && (value.checkpoints.length !== 5 || value.outputCount !== 0)) return null;
  if (value.execution === 'completed' && value.stage === 'tester' && (value.checkpoints.length !== 0 || value.outputCount !== 5)) return null;
  if (value.quality !== 'not-reviewed' && (value.stage !== 'tester' || value.execution !== 'completed' || value.outputCount !== 5)) return null;
  return value as unknown as TrainFirst;
}
function cloudPairGallery(value: unknown): CloudPairGallery | null {
  if (!object(value)) return null; if (value.status === 'not-configured') return value as CloudPairGallery; if (value.status === 'unavailable' && value.reason === 'evidence-unavailable') return value as CloudPairGallery;
  if (value.status !== 'recorded' || !string(value.experimentId) || !string(value.modelFamily) || value.notPromotable !== true || value.trainingEligible !== false || !Array.isArray(value.rows) || value.rows.length !== 2) return null;
  const fields = ['identity', 'realism', 'composition', 'clothing', 'safety'];
  for (const row of value.rows) { if (!object(row) || !finite(row.seed) || !object(row.asset) || !string(row.asset.assetId) || !sha256(row.asset.sha256) || !finite(row.asset.bytes) || row.asset.bytes < 1 || row.asset.bytes > 8 * 1024 * 1024 || !finite(row.asset.width) || !finite(row.asset.height) || !object(row.reviews)) return null; for (const role of ['root', 'independent']) { const review = row.reviews[role]; if (!object(review) || review.disposition !== 'stop' || !string(review.source) || !object(review.observations)) return null; const observations = review.observations; if (!fields.every((key) => string(observations[key]))) return null; } }
  return value as unknown as CloudPairGallery;
}
function contentBriefs(value: unknown): ContentBriefs | null {
  if (value === undefined) return { status: 'not-configured', items: [] };
  if (!object(value) || !Array.isArray(value.items)) return null;
  if (value.status === 'not-configured' && value.items.length === 0) return { status: 'not-configured', items: [] };
  if (value.status === 'empty' && value.recordKind === 'planning-snapshot' && value.currentSourceRevalidated === false && value.items.length === 0) return value as unknown as ContentBriefs;
  if (value.status === 'unavailable' && value.reason === 'evidence-unavailable' && value.items.length === 0) return value as unknown as ContentBriefs;
  if (value.status !== 'recorded' || value.recordKind !== 'planning-snapshot' || value.currentSourceRevalidated !== false || value.items.length < 1 || value.items.length > 64) return null;
  const safeText = (item: unknown, maximum: number): item is string => typeof item === 'string' && item.length > 0 && item.length <= maximum && !/[\u0000-\u001f\u007f]/.test(item);
  const isoDate = (item: unknown): item is string => typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(item) && new Date(`${item}T00:00:00Z`).toISOString().slice(0, 10) === item;
  for (const item of value.items) {
    if (!object(item) || !safeText(item.briefId, 128) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.briefId) || !isoDate(item.briefDate) || !safeText(item.creatorId, 80) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(item.creatorId) || (item.surface !== 'carousel' && item.surface !== 'reel') || !safeText(item.templateId, 16) || (item.surface === 'carousel' ? !/^CT-[1-7]$/.test(item.templateId) : !/^RT-[1-6]$/.test(item.templateId)) || !Number.isSafeInteger(item.requiredAssetCount) || !Array.isArray(item.requiredAssetSlots) || item.requiredAssetSlots.length !== item.requiredAssetCount || item.requiredAssetSlots.length < 1 || item.requiredAssetSlots.length > 16 || !safeText(item.hypothesis, 4096) || !safeText(item.intendedMetric, 4096) || !Number.isSafeInteger(item.sourceCount) || !Array.isArray(item.sourceDates) || item.sourceDates.length !== item.sourceCount || item.sourceDates.length < 1 || item.sourceDates.length > 16 || !item.sourceDates.every(isoDate) || item.observedMetrics !== null || item.renderAs !== 'text' || (item.assignment !== undefined && item.assignment !== 'missing' && item.assignment !== 'recorded-snapshot' && item.assignment !== 'recorded-source-snapshot' && item.assignment !== 'unavailable')) return null;
    if (!item.requiredAssetSlots.every((slot) => object(slot) && safeText(slot.role, 80) && (slot.kind === 'persona' || slot.kind === 'nonpersona'))) return null;
  }
  return value as unknown as ContentBriefs;
}

function valid(value: unknown): Projection | null {
  if (!object(value) || value.schema !== 'figment/hub@1' || typeof value.available !== 'boolean' || !bounded(value.creators) || typeof value.creatorsTruncated !== 'boolean' || !bounded(value.records) || typeof value.recordsTruncated !== 'boolean' || !object(value.plans) || !bounded(value.plans.items) || typeof value.plans.truncated !== 'boolean' || !object(value.research) || typeof value.research.available !== 'boolean' || !bounded(value.research.artifacts) || typeof value.research.truncated !== 'boolean' || !object(value.references) || !bounded(value.references.items) || typeof value.references.truncated !== 'boolean' || !object(value.generatedInputs) || typeof value.generatedInputs.available !== 'boolean' || !bounded(value.generatedInputs.items) || typeof value.generatedInputs.truncated !== 'boolean' || !object(value.diagnostic)) return null;
  if (!value.creators.every((row) => object(row) && string(row.id) && (row.persona === 'valid' || row.persona === 'malformed') && nullableString(row.loraTier) && nullableString(row.loraTrigger) && bounded(row.accountTiers) && row.accountTiers.every(string))) return null;
  if (!value.records.every((row) => object(row) && string(row.path) && string(row.type) && nullableString(row.creator) && nullableString(row.schema) && states.has(row.reviewState as ReviewState) && (row.machineGateState === null || row.machineGateState === 'current' || row.machineGateState === 'stale'))) return null;
  if (!value.plans.items.every((plan) => object(plan) && string(plan.path) && string(plan.creator) && nullableString(plan.variant) && finite(plan.declaredCeilingUsd) && bounded(plan.stages) && plan.stages.every((stage) => object(stage) && string(stage.name) && finite(stage.runCount) && (stage.declaredCeilingUsd === null || finite(stage.declaredCeilingUsd))))) return null;
  if (!value.research.artifacts.every((row) => object(row) && (row.area === 'research' || row.area === 'book') && string(row.name) && finite(row.bytes) && string(row.modifiedAt) && Number.isFinite(Date.parse(row.modifiedAt)))) return null;
  if (!value.references.items.every((row) => object(row) && string(row.creator) && string(row.name) && safeArtifactName(row.name) && finite(row.bytes) && sha256(row.sha256) && finite(row.width) && finite(row.height) && string(row.modifiedAt) && Number.isFinite(Date.parse(row.modifiedAt)))) return null;
  if (!value.generatedInputs.items.every((row) => object(row) && string(row.name) && safeArtifactName(row.name) && finite(row.bytes) && sha256(row.sha256) && finite(row.width) && finite(row.height) && string(row.sourceReference) && sha256(row.sourceSha256) && nullableString(row.generatedOn) && string(row.reviewStatus) && object(row.visualReview) && Object.values(row.visualReview).every(string))) return null;
  const d = value.diagnostic;
  if (!(d.status === 'not-configured' || d.status === 'unavailable' && string(d.reason) || d.status === 'diagnostic-not-promotable' && (typeof d.dryRun === 'boolean' || d.dryRun === null) && nullableString(d.podId) && typeof d.artifactsTruncated === 'boolean' && bounded(d.artifacts) && d.artifacts.every((row) => object(row) && string(row.name) && safeArtifactName(row.name) && finite(row.bytes) && sha256(row.sha256) && finite(row.width) && finite(row.height) && string(row.modifiedAt) && Number.isFinite(Date.parse(row.modifiedAt))))) return null;
  const training = localTraining(value.localTraining);
  const results = localTrainingResults(value.localTrainingResults);
  const gallery = matchedGallery(value.matchedGallery);
  const profile = profileGallery(value.profileGallery);
  const cloud = value.cloudExperiment === undefined ? { status: 'not-configured' } : cloudExperiment(value.cloudExperiment);
  const currentTrain = trainFirst(value.trainFirst);
  const pair = value.cloudPairGallery === undefined ? { status: 'not-configured' } : cloudPairGallery(value.cloudPairGallery);
  const briefs = contentBriefs(value.contentBriefs);
  return training === null || results === null || gallery === null || profile === null || cloud === null || currentTrain === null || pair === null || briefs === null ? null : { ...value, localTraining: training, localTrainingResults: results, matchedGallery: gallery, profileGallery: profile, cloudExperiment: cloud, trainFirst: currentTrain, cloudPairGallery: pair, contentBriefs: briefs } as unknown as Projection;
}

function validTesterPreview(value: unknown): TesterPreview | null {
  return object(value) && value.schema === 'figment/plan-preview@1' && value.offlinePreview === true && value.notPromotable === true && value.creator === 'creator-001' && value.stage === 'tester' && finite(value.runCount) && value.runCount >= 1 && value.runCount <= 8 && finite(value.declaredCeilingUsd) && value.declaredCeilingUsd <= 50 && sha256(value.manifestSha256) ? value as unknown as TesterPreview : null;
}

function validStudioGenPlan(value: unknown): StudioGenPlan | null { return object(value) && value.schema === 'figment/studio-gen-plan@1' && string(value.id) && /^[0-9a-f-]{36}$/.test(value.id) && value.status === 'prepared' && value.creator === 'creator-001' && value.stage === 'gen' && value.runCount === 1 && finite(value.declaredCeilingUsd) && value.declaredCeilingUsd <= 50 && sha256(value.planSha256) ? value as unknown as StudioGenPlan : null; }

function bytes(value: number): string { return value < 1024 ? `${value} B` : value < 1048576 ? `${Math.round(value / 1024)} KB` : `${(value / 1048576).toFixed(1)} MB`; }
function approval(state: ReviewState): string { return state === 'approved' ? 'Approved' : state === 'stale' ? 'Stale' : state === 'unreviewed' ? 'Unreviewed' : 'Approval unknown'; }
function diagnostic(d: Projection['diagnostic']): string { return d.status === 'diagnostic-not-promotable' ? 'Diagnostic evidence — not promotable' : d.status === 'not-configured' ? 'No diagnostic root configured' : `Diagnostic evidence unavailable: ${d.reason.replaceAll('-', ' ')}`; }
function requestOptions(token?: string): RequestInit { return token ? { headers: { authorization: `Bearer ${token}` } } : {}; }
function artifactPath(artifact: ResearchArtifact): string | null {
  if (!safeArtifactName(artifact.name)) return null;
  return artifact.area === 'book' ? `orgs/figment/research/book/${artifact.name}` : `orgs/figment/research/${artifact.name}`;
}
function resolveArticleLink(current: string, href: string, known: ReadonlySet<string>): string | null {
  if (href.startsWith('#') || /^(?:https?:|mailto:)/i.test(href)) return null;
  try {
    const base = `https://figment.local/${current.slice(0, current.lastIndexOf('/') + 1)}`;
    const resolved = new URL(href, base);
    return resolved.origin === 'https://figment.local' && known.has(resolved.pathname.slice(1)) ? resolved.pathname.slice(1) : null;
  } catch { return null; }
}

function CopyPath({ path }: { path: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = (): void => { const clipboard = navigator.clipboard; if (clipboard) void clipboard.writeText(path).then(() => setCopied(true)).catch(() => undefined); };
  return <button type="button" className="figment__copy" title={path} aria-label={`Copy record path ${path}`} onClick={copy}>{copied ? 'Copied' : 'Copy path'}</button>;
}

function Creators({ rows, truncated }: { rows: Projection['creators']; truncated: boolean }): React.JSX.Element {
  if (!rows.length) return <p className="figment__empty">No creator personas are recorded.</p>;
  return <><div className="figment__grid">{rows.map((c) => <article className="figment__card" key={c.id}><h2>{c.id}</h2><p><span className={`figment__badge figment__badge--${c.persona}`}>{c.persona === 'valid' ? 'Persona record' : 'Malformed persona record'}</span></p><dl><dt>LoRA tier</dt><dd>{c.loraTier ?? 'Not set'}</dd><dt>Persona LoRA trigger</dt><dd>{c.loraTrigger ?? 'Not recorded in persona'}</dd><dt>Account tiers</dt><dd>{c.accountTiers.join(', ') || 'None recorded'}</dd></dl></article>)}</div>{truncated ? <p className="figment__notice">The creator list reached its safe display limit.</p> : null}</>;
}

function Records({ rows, truncated }: { rows: RecordRow[]; truncated: boolean }): React.JSX.Element {
  if (!rows.length) return <p className="figment__empty">No driver, run, gate, or accepted-checkpoint records are available.</p>;
  return <><div className="figment__records">{rows.map((r) => <article className="figment__record" key={r.path}><div><h2>{r.type.replaceAll('-', ' ')}</h2><p>{r.creator ?? 'Shared Figment record'}{r.schema ? ` · ${r.schema}` : ''}</p><code className="figment__record-path">{r.path}</code></div><div className="figment__evidence"><span className={`figment__badge figment__badge--${r.reviewState}`}>{approval(r.reviewState)}</span>{r.machineGateState ? <span className={`figment__badge figment__badge--machine-${r.machineGateState}`}>Machine gate {r.machineGateState}</span> : null}<CopyPath path={r.path} /></div></article>)}</div>{truncated ? <p className="figment__notice">The record list reached its safe display limit.</p> : null}</>;
}

function Plans({ plans, token, fetchImpl }: { plans: Projection['plans']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const prepareIntent = useRef<string | null>(null);
  const [preview, setPreview] = useState<TesterPreview | null>(null); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null); const [prepared, setPrepared] = useState<StudioGenPlan | null>(null); const [preparePending, setPreparePending] = useState(false); const [prepareError, setPrepareError] = useState<string | null>(null);
  const generateTesterPreview = (): void => {
    setPending(true); setError(null); setPreview(null);
    void fetchImpl('/api/figment/plan-preview/tester', { ...requestOptions(token), method: 'POST' }).then(async (response) => {
      const payload: unknown = await response.json(); const decoded = response.ok ? validTesterPreview(payload) : null;
      if (decoded === null) throw new Error('The offline tester preview is unavailable.');
      setPreview(decoded);
    }).catch((cause) => setError(cause instanceof Error ? cause.message : 'The offline tester preview is unavailable.')).finally(() => setPending(false));
  };
  const prepareGenPlan = (): void => {
    setPreparePending(true); setPrepareError(null); setPrepared(null);
    if (prepareIntent.current === null) {
      const bytes = new Uint8Array(24); crypto.getRandomValues(bytes);
      prepareIntent.current = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
    }
    // Every failure — refusal, network loss, malformed body — shows one fixed message: fetch/JSON errors
    // can carry response text. The intent key survives until a validated plan, so a retry replays it.
    void fetchImpl('/api/figment/studio/gen-plan', { method: 'POST', headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), 'Idempotency-Key': prepareIntent.current } }).then(async (response) => {
      const payload: unknown = await response.json(); const decoded = response.ok ? validStudioGenPlan(payload) : null;
      if (decoded === null) throw new Error('invalid-gen-plan');
      prepareIntent.current = null; setPrepared(decoded);
    }).catch(() => setPrepareError('Generation plan preparation is unavailable. A current selected checkpoint and source authority are required before a plan can be prepared.')).finally(() => setPreparePending(false));
  };
  return <><p className="figment__inert">Offline preview of existing plans. Declared ceilings are not live estimates and this page cannot start a run.</p><section className="figment__preview"><h2>Prepare generation plan</h2><p>Prepares one local generation plan only. It requires a current selected checkpoint and source authority; it does not launch a run or create an approval.</p><button type="button" className="mc-btn" onClick={prepareGenPlan} disabled={preparePending}>{preparePending ? 'Preparing generation plan…' : 'Prepare generation plan'}</button>{prepareError ? <p className="figment__reader-error" role="alert">{prepareError}</p> : null}{prepared ? <p role="status">{prepared.creator} · {prepared.stage} · one prepared run · declared ${prepared.declaredCeilingUsd.toFixed(2)} · plan {prepared.planSha256.slice(0, 12)}</p> : null}</section><section className="figment__preview"><h2>Tester plan preview</h2><p>Builds a fresh, local-only tester plan for creator-001 with pin verification skipped. It cannot run a pod, create an approval, or promote a checkpoint.</p><button type="button" className="mc-btn" onClick={generateTesterPreview} disabled={pending}>{pending ? 'Building preview…' : 'Preview tester plan'}</button>{error ? <p className="figment__reader-error" role="alert">{error}</p> : null}{preview ? <p role="status">{preview.creator} · {preview.stage} · {preview.runCount} planned run{preview.runCount === 1 ? '' : 's'} · declared ${preview.declaredCeilingUsd.toFixed(2)} · manifest {preview.manifestSha256.slice(0, 12)}</p> : null}</section>{plans.items.length ? <div className="figment__plans">{plans.items.map((plan) => <article className="figment__plan" key={plan.path}><h2>{plan.creator}{plan.variant ? ` · ${plan.variant}` : ''}</h2><code className="figment__record-path">{plan.path}</code><p>Declared ceiling: ${plan.declaredCeilingUsd.toFixed(2)}</p><ul>{plan.stages.map((stage) => <li key={stage.name}><strong>{stage.name}</strong> · {stage.runCount} run{stage.runCount === 1 ? '' : 's'} · declared ${stage.declaredCeilingUsd?.toFixed(2) ?? 'unavailable'}</li>)}</ul></article>)}</div> : <p className="figment__empty">No frozen Figment plans are available.</p>}{plans.truncated ? <p className="figment__notice">The plan list reached its safe display limit.</p> : null}</>;
}

function DeclaredReferences({ references, token, fetchImpl }: { references: Projection['references']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const creators = [...new Set(references.items.map((item) => item.creator))]; const [creator, setCreator] = useState(creators[0] ?? ''); const [assets, setAssets] = useState<Array<{ name: string; url: string; width: number; height: number }>>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!creators.includes(creator)) setCreator(creators[0] ?? ''); }, [creator, creators.join('|')]);
  const selected = references.items.filter((item) => item.creator === creator);
  useEffect(() => {
    let live = true; const controllers: AbortController[] = []; const urls: string[] = []; let next = 0; const results: Array<{ name: string; url: string; width: number; height: number } | undefined> = new Array(selected.length);
    setAssets([]); setError(null);
    const load = async (): Promise<void> => { while (live && next < selected.length) { const index = next; next += 1; const asset = selected[index]; const controller = new AbortController(); controllers.push(controller); try { const response = await fetchImpl(`/api/figment/reference-assets/${encodeURIComponent(asset.creator)}/${encodeURIComponent(asset.name)}?sha256=${asset.sha256}`, { ...requestOptions(token), signal: controller.signal }); if (!response.ok) throw new Error(response.status === 409 ? 'A declared reference changed before it could be viewed.' : 'A declared reference could not be read.'); const blob = await response.blob(); if (!live) return; const url = URL.createObjectURL(blob); urls.push(url); results[index] = { name: asset.name, url, width: asset.width, height: asset.height }; setAssets(results.filter((item): item is NonNullable<typeof item> => item !== undefined)); } catch (cause) { if (live && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'A declared reference could not be read.'); } } };
    void Promise.all(Array.from({ length: Math.min(3, selected.length) }, () => load()));
    return () => { live = false; controllers.forEach((controller) => controller.abort()); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [creator, fetchImpl, token, references]);
  if (!creators.length) return <section className="figment__references"><h2>Declared persona references</h2><p className="figment__empty">No declared persona references are available.</p></section>;
  return <section className="figment__references"><h2>Declared persona references</h2><p className="figment__inert">Declared inputs only. They do not associate a diagnostic with this creator and do not approve an identity or checkpoint.</p><label>Selected creator <select aria-label="Selected reference creator" value={creator} onChange={(event) => setCreator(event.target.value)}>{creators.map((id) => <option key={id} value={id}>{id}</option>)}</select></label><p className="figment__inert">Reference files: {selected.map((asset) => asset.name).join(', ')}</p>{error ? <p className="figment__reader-error" role="alert">{error}</p> : null}<div className="figment__assets">{assets.map((asset) => <figure className="figment__asset" key={asset.name}><img src={asset.url} alt={`Declared reference ${creator} ${asset.name}`} /><figcaption>{asset.name} | {asset.width}x{asset.height}</figcaption></figure>)}</div>{references.truncated ? <p className="figment__notice">The declared reference list reached its safe review limit.</p> : null}</section>;
}

function DiagnosticAssets({ diagnostic, token, fetchImpl }: { diagnostic: Projection['diagnostic']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const [assets, setAssets] = useState<Array<{ name: string; url: string; width: number; height: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (diagnostic.status !== 'diagnostic-not-promotable' || !diagnostic.artifacts.length) { setAssets([]); setError(null); return; }
    let live = true; let next = 0; const controllers: AbortController[] = []; const urls: string[] = [];
    const results: Array<{ name: string; url: string; width: number; height: number } | undefined> = new Array(diagnostic.artifacts.length);
    setAssets([]); setError(null);
    const load = async (): Promise<void> => {
      while (live && next < diagnostic.artifacts.length) {
        const index = next; next += 1; const artifact = diagnostic.artifacts[index]; const controller = new AbortController(); controllers.push(controller);
        try {
          const response = await fetchImpl(`/api/figment/diagnostic-assets/${encodeURIComponent(artifact.name)}?sha256=${artifact.sha256}`, { ...requestOptions(token), signal: controller.signal });
          if (!response.ok) throw new Error(response.status === 409 ? 'A listed diagnostic asset changed before it could be reviewed.' : 'A listed diagnostic asset could not be read.');
          const blob = await response.blob(); if (!live) return;
          const url = URL.createObjectURL(blob); urls.push(url); results[index] = { name: artifact.name, url, width: artifact.width, height: artifact.height };
          setAssets(results.filter((item): item is NonNullable<typeof item> => item !== undefined));
        } catch (cause) { if (live && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'A listed diagnostic asset could not be read.'); }
      }
    };
    void Promise.all(Array.from({ length: Math.min(3, diagnostic.artifacts.length) }, () => load()));
    return () => { live = false; controllers.forEach((controller) => controller.abort()); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [diagnostic, fetchImpl, token]);
  if (diagnostic.status !== 'diagnostic-not-promotable') return <p className="figment__empty">No diagnostic assets are available for review.</p>;
  if (!diagnostic.artifacts.length) return <p className="figment__empty">This diagnostic record lists no reviewable PNG assets.</p>;
  return <><p className="figment__inert">Diagnostic assets only. They are not promotable and do not approve identity, quality, or a checkpoint.</p>{error ? <p className="figment__reader-error" role="alert">{error}</p> : null}<div className="figment__assets">{assets.map((asset) => <figure className="figment__asset" key={asset.name}><img src={asset.url} alt={`Diagnostic asset ${asset.name}`} /><figcaption>{asset.name} · {asset.width}×{asset.height}</figcaption></figure>)}</div>{diagnostic.artifactsTruncated ? <p className="figment__notice">The diagnostic asset list reached its safe review limit.</p> : null}</>;
}

function CloudExperimentStatus({ experiment }: { experiment: CloudExperiment }): React.JSX.Element | null {
  if (experiment.status === 'not-configured') return null;
  if (experiment.status === 'unavailable') return <section className="figment__references"><h2>Reference-cloud experiment</h2><p className="figment__empty">Configured experiment evidence could not be verified.</p></section>;
  const cost = experiment.estimatedActualUsd === null ? 'not recorded' : `$${experiment.estimatedActualUsd.toFixed(6)}`;
  const termination = experiment.terminationVerified === true ? 'termination verified' : experiment.terminationVerified === false ? 'termination not verified' : 'termination not recorded';
  const outcome = experiment.execution === 'started-pending-final' ? 'Started; final result not recorded.' : experiment.execution === 'failed' ? `Execution stopped during ${experiment.failure === 'bootstrap' ? 'bootstrap' : 'the run'}; no quality result is implied.` : `${experiment.outputCount} output${experiment.outputCount === 1 ? '' : 's'} recorded. Lifecycle evidence only; visual review is recorded separately.`;
  const lifecycle = experiment.execution === 'started-pending-final' ? 'liveness unknown; awaiting final result' : termination;
  const ceiling = experiment.maxUsd === null ? 'not recorded' : `$${experiment.maxUsd.toFixed(2)}`;
  const preflight = experiment.preflightEstimateUsd === null ? 'not recorded' : `$${experiment.preflightEstimateUsd.toFixed(2)}`;
  return <section className="figment__references" aria-label="Reference cloud experiment"><h2>Reference-cloud experiment</h2><p className="figment__inert">{outcome}</p><dl><dt>Runtime bound</dt><dd>{experiment.maxMinutes} minutes</dd><dt>Spend ceiling</dt><dd>{ceiling}</dd><dt>Preflight estimate</dt><dd>{preflight}</dd><dt>Actual estimate</dt><dd>{cost}</dd><dt>Lifecycle</dt><dd>{lifecycle}</dd><dt>Quality</dt><dd>Lifecycle evidence only; visual review is recorded separately.</dd></dl></section>;
}

function CloudPairGallery({ gallery, token, fetchImpl }: { gallery: CloudPairGallery; token?: string; fetchImpl: typeof fetch }): React.JSX.Element | null {
  const [assets, setAssets] = useState<Record<string, string | null>>({});
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (gallery.status !== 'recorded') return;
    let live = true;
    const controllers: AbortController[] = [];
    const urls: string[] = [];
    setAssets({});
    setError(null);
    void Promise.all(gallery.rows.map(async ({ asset }) => {
      const controller = new AbortController();
      controllers.push(controller);
      try {
        const response = await fetchImpl(`/api/figment/cloud-pair-assets/${encodeURIComponent(asset.assetId)}?sha256=${asset.sha256}`, {
          ...requestOptions(token),
          signal: controller.signal,
        });
        if (!response.ok) throw new Error('A recorded cloud-pair image could not be read.');
        const url = URL.createObjectURL(await response.blob());
        if (!live) {
          URL.revokeObjectURL(url);
          return;
        }
        urls.push(url);
        setAssets((previous) => ({ ...previous, [asset.assetId]: url }));
      } catch {
        if (live && !controller.signal.aborted) {
          setAssets((previous) => ({ ...previous, [asset.assetId]: null }));
          setError('A recorded cloud-pair image could not be read.');
        }
      }
    }));
    return () => {
      live = false;
      controllers.forEach((controller) => controller.abort());
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [gallery, token, fetchImpl]);
  if (gallery.status === 'not-configured') return null;
  if (gallery.status === 'unavailable') {
    return <section className="figment__references"><h2>Cloud reference pair</h2><p className="figment__empty">Configured cloud-pair evidence could not be verified.</p></section>;
  }
  const review = (role: 'root' | 'independent', value: CloudPairReview) => (
    <div className="figment__observation">
      <strong>{role === 'root' ? 'Root' : 'Independent'} — STOP</strong>
      <span>{value.observations.identity}</span>
      <span>{value.observations.realism}</span>
      <span>{value.observations.composition}</span>
      <span>{value.observations.clothing}</span>
      <span>{value.observations.safety}</span>
    </div>
  );
  return (
    <section className="figment__references" aria-label="Cloud reference pair">
      <h2>Cloud reference pair — {gallery.modelFamily}</h2>
      <p className="figment__inert">Both reviews stopped before the six-row pilot. These originals are rejected research evidence: not promotable and not training eligible.</p>
      {error ? <p className="figment__reader-error" role="alert">{error}</p> : null}
      <div className="figment__assets figment__generated-assets">
        {gallery.rows.map((row) => (
          <figure className="figment__asset figment__generated-asset" key={row.asset.assetId}>
            {assets[row.asset.assetId]
              ? <img src={assets[row.asset.assetId] ?? undefined} alt={`Cloud reference pair seed ${row.seed}`} />
              : assets[row.asset.assetId] === null
                ? <div className="figment__empty">Recorded image unavailable.</div>
                : <div className="figment__empty" role="status">Loading recorded image…</div>}
            <figcaption>
              <strong>Seed {row.seed}</strong>
              <span>{row.asset.width}x{row.asset.height}</span>
              {review('root', row.reviews.root)}
              {review('independent', row.reviews.independent)}
            </figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}

const generatedObservationLabels: Record<string, string> = {
  identity: 'Identity',
  clothing: 'Clothing',
  adult_presentation: 'Adult presentation',
  realism: 'Realism',
  coverage: 'Coverage',
  independent_findings: 'Independent observation',
  independent_observation: 'Independent observation',
};

function generatedObservationLabel(name: string): string {
  return generatedObservationLabels[name] ?? name.replaceAll('_', ' ');
}

function GeneratedInputs({ generated, token, fetchImpl }: { generated: Projection['generatedInputs']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const [assets, setAssets] = useState<Array<{ name: string; url: string }>>([]); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!generated.available || !generated.items.length) { setAssets([]); return; } let live = true; const controllers: AbortController[] = []; const urls: string[] = []; let next = 0; const results: Array<{ name: string; url: string } | undefined> = new Array(generated.items.length); setAssets([]); setError(null); const load = async (): Promise<void> => { while (live && next < generated.items.length) { const index = next++; const item = generated.items[index]; const controller = new AbortController(); controllers.push(controller); try { const response = await fetchImpl(`/api/figment/generated-input-assets/${encodeURIComponent(item.name)}?sha256=${item.sha256}`, { ...requestOptions(token), signal: controller.signal }); if (!response.ok) throw new Error('A listed generated input changed before it could be viewed.'); const url = URL.createObjectURL(await response.blob()); if (!live) { URL.revokeObjectURL(url); return; } urls.push(url); results[index] = { name: item.name, url }; setAssets(results.filter((row): row is { name: string; url: string } => row !== undefined)); } catch (cause) { if (live && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'A generated input could not be read.'); } } }; void Promise.all(Array.from({ length: Math.min(3, generated.items.length) }, () => load())); return () => { live = false; controllers.forEach((controller) => controller.abort()); urls.forEach((url) => URL.revokeObjectURL(url)); }; }, [generated, token, fetchImpl]);
  if (!generated.available) return <></>;
  return <section className="figment__references"><h2>Generated-input experiments: creator-001 (unapproved)</h2><p className="figment__inert">These creator-001 experiments use g01 as the provisional seed; g02 and g07 remain comparators. Immutable provenance snapshots and recorded review declarations only. They may not reflect later independent review. These are not accepted references, identity proof, training data, or approvals.</p>{error ? <p className="figment__reader-error" role="alert">{error}</p> : null}<div className="figment__assets figment__generated-assets">{assets.map((asset) => { const item = generated.items.find((row) => row.name === asset.name); return item ? <figure className="figment__asset figment__generated-asset" key={item.name}><img src={asset.url} alt={`Generated input experiment ${item.name}`} /><figcaption><strong>{item.name}</strong><span>{item.width}x{item.height} · Generated on: {item.generatedOn ?? 'not recorded'}</span><dl className="figment__generated-observations"><dt>Recorded observations</dt><dd><strong>Status</strong>: {item.reviewStatus}</dd>{Object.entries(item.visualReview).map(([label, observation]) => <dd key={label}><strong>{generatedObservationLabel(label)}</strong>: {observation}</dd>)}</dl><details><summary>Source and hashes</summary><dl><dt>Declared source</dt><dd>{item.sourceReference}</dd><dt>Source SHA-256</dt><dd>{item.sourceSha256}</dd><dt>Output SHA-256</dt><dd>{item.sha256}</dd></dl></details></figcaption></figure> : null; })}</div>{generated.truncated ? <p className="figment__notice">The generated-input list reached its safe review limit.</p> : null}</section>;
}

function MatchedGallery({ gallery, token, fetchImpl }: { gallery: Projection['matchedGallery']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const [assets, setAssets] = useState<Record<string, string>>({}); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (gallery.status !== 'recorded') { setAssets({}); return; }
    let live = true; const controllers: AbortController[] = []; const urls: string[] = []; setAssets({}); setError(null);
    const listed = gallery.pairs.flatMap((pair) => [pair.base, pair.current20]);
    void Promise.all(listed.map(async (asset) => { const controller = new AbortController(); controllers.push(controller); try { const response = await fetchImpl(`/api/figment/matched-gallery-assets/${encodeURIComponent(asset.assetId)}?sha256=${asset.sha256}`, { ...requestOptions(token), signal: controller.signal }); if (!response.ok) throw new Error('A recorded matched image could not be read.'); const url = URL.createObjectURL(await response.blob()); if (!live) { URL.revokeObjectURL(url); return; } urls.push(url); setAssets((previous) => ({ ...previous, [asset.assetId]: url })); } catch (cause) { if (live && !controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'A recorded matched image could not be read.'); } }));
    return () => { live = false; controllers.forEach((controller) => controller.abort()); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [gallery, token, fetchImpl]);
  if (gallery.status === 'not-configured') return <></>;
  if (gallery.status === 'unavailable') return <section className="figment__references"><h2>Matched diagnostic pairs</h2><p className="figment__empty">Recorded matched diagnostic evidence could not be verified.</p></section>;
  const labels: Record<keyof MatchedObservation, string> = { realism: 'Realism', resemblance_to_g01: 'Resemblance to g01', pose: 'Pose', apparent_adulthood: 'Apparent adulthood', apparent_age_fit: 'Apparent age fit', clothing: 'Clothing', defects: 'Defects' };
  const review = (role: 'root' | 'independent', stage: 'base' | 'current20', item: MatchedReview): React.JSX.Element => <details key={`${role}-${stage}`}><summary>{role === 'root' ? 'Root' : 'Independent'} diagnostic — {item.disposition}</summary><dl>{(Object.keys(labels) as Array<keyof MatchedObservation>).map((key) => <Fragment key={key}><dt>{labels[key]}</dt><dd>{item.observations[key]}</dd></Fragment>)}</dl></details>;
  const image = (pair: Extract<MatchedGallery, { status: 'recorded' }>['pairs'][number], label: 'Base' | 'Current step 20', asset: MatchedAsset, stage: 'base' | 'current20'): React.JSX.Element => <figure className="figment__asset figment__generated-asset" key={asset.assetId}>{assets[asset.assetId] ? <img src={assets[asset.assetId]} alt={`Matched diagnostic ${label.toLowerCase()} seed ${pair.seed}`} /> : <div className="figment__empty" role="status">Loading recorded image…</div>}<figcaption><strong>Seed {pair.seed} · {label}</strong><span>{asset.width}x{asset.height}</span>{review('root', stage, pair.reviews.root[stage])}{review('independent', stage, pair.reviews.independent[stage])}</figcaption></figure>;
  return <section className="figment__references"><h2>Matched diagnostic pairs</h2><p className="figment__inert">Matched diagnostic only. Base used no reference pixel conditioning; current step 20 applies a locally trained adapter and also used no reference pixel conditioning.</p><p className="figment__inert">Training complete; image quality reviewed separately. These recorded diagnostic observations are not a promotion or human QA.</p>{error ? <p className="figment__reader-error" role="alert">{error}</p> : null}{gallery.pairs.map((pair) => <section key={pair.seed} aria-label={`Matched diagnostic pair seed ${pair.seed}`}><h3>Seed {pair.seed}</h3><div className="figment__assets figment__generated-assets">{image(pair, 'Base', pair.base, 'base')}{image(pair, 'Current step 20', pair.current20, 'current20')}</div></section>)}</section>;
}

function ProfileGallery({ gallery, token, fetchImpl }: { gallery: Projection['profileGallery']; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const [assets, setAssets] = useState<Record<string, string | null>>({}); const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (gallery.status !== 'recorded') { setAssets({}); return; }
    let live = true; const controllers: AbortController[] = []; const urls: string[] = []; setAssets({}); setError(null);
    void Promise.all(gallery.rows.map(async ({ asset }) => { const controller = new AbortController(); controllers.push(controller); try { const response = await fetchImpl(`/api/figment/profile-gallery-assets/${encodeURIComponent(asset.assetId)}?sha256=${asset.sha256}`, { ...requestOptions(token), signal: controller.signal }); if (!response.ok) throw new Error('A recorded prompt-profile image could not be read.'); const url = URL.createObjectURL(await response.blob()); if (!live) { URL.revokeObjectURL(url); return; } urls.push(url); setAssets((previous) => ({ ...previous, [asset.assetId]: url })); } catch (cause) { if (live && !controller.signal.aborted) { setAssets((previous) => ({ ...previous, [asset.assetId]: null })); setError(cause instanceof Error ? cause.message : 'A recorded prompt-profile image could not be read.'); } } }));
    return () => { live = false; controllers.forEach((controller) => controller.abort()); urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [gallery, token, fetchImpl]);
  if (gallery.status === 'not-configured') return <></>;
  if (gallery.status === 'unavailable') return <section className="figment__references"><h2>Prompt-profile diagnostic</h2><p className="figment__empty">Recorded prompt-profile diagnostic evidence could not be verified.</p></section>;
  const labels: Record<keyof MatchedObservation, string> = { realism: 'Realism', resemblance_to_g01: 'Resemblance to g01', pose: 'Pose', apparent_adulthood: 'Apparent adulthood', apparent_age_fit: 'Apparent age fit', clothing: 'Clothing', defects: 'Defects' };
  const review = (role: 'root' | 'independent', item: ProfileReview): React.JSX.Element => <details key={role}><summary>{role === 'root' ? 'Root' : 'Independent'} review — {item.disposition}</summary><p>{item.reason}</p><dl>{(Object.keys(labels) as Array<keyof MatchedObservation>).map((key) => <Fragment key={key}><dt>{labels[key]}</dt><dd>{item.observations[key]}</dd></Fragment>)}</dl></details>;
  return <section className="figment__references" aria-label="Prompt-profile diagnostic"><h2>Prompt-profile diagnostic</h2><p className="figment__inert">Both reviews stopped this prompt-profile test. No adapter comparison followed.</p><p className="figment__inert">Two base images from one prompt profile, without any reference image guiding generation. Each review is recorded separately and neither approves quality or selects a checkpoint.</p>{error ? <p className="figment__reader-error" role="alert">{error}</p> : null}<div className="figment__assets figment__generated-assets">{gallery.rows.map((row) => <figure className="figment__asset figment__generated-asset" key={row.asset.assetId}>{assets[row.asset.assetId] ? <img src={assets[row.asset.assetId] ?? undefined} alt={`Prompt-profile diagnostic seed ${row.seed}`} /> : assets[row.asset.assetId] === null ? <div className="figment__empty">Recorded image unavailable.</div> : <div className="figment__empty" role="status">Loading recorded image…</div>}<figcaption><strong>Seed {row.seed}</strong><span>{row.asset.width}x{row.asset.height}</span>{review('root', row.reviews.root)}{review('independent', row.reviews.independent)}</figcaption></figure>)}</div></section>;
}

function Assets({ diagnostic, references, generatedInputs, matchedGallery, profileGallery, cloudExperiment, cloudPairGallery, token, fetchImpl }: { diagnostic: Projection['diagnostic']; references: Projection['references']; generatedInputs: Projection['generatedInputs']; matchedGallery: Projection['matchedGallery']; profileGallery: Projection['profileGallery']; cloudExperiment: CloudExperiment; cloudPairGallery: CloudPairGallery; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const hideEmptyDiagnostic = (matchedGallery.status === 'recorded' || profileGallery.status === 'recorded' || cloudPairGallery.status === 'recorded') && diagnostic.status !== 'diagnostic-not-promotable';
  return <><CloudExperimentStatus experiment={cloudExperiment} /><CloudPairGallery gallery={cloudPairGallery} token={token} fetchImpl={fetchImpl} /><DeclaredReferences references={references} token={token} fetchImpl={fetchImpl} /><GeneratedInputs generated={generatedInputs} token={token} fetchImpl={fetchImpl} /><MatchedGallery gallery={matchedGallery} token={token} fetchImpl={fetchImpl} /><ProfileGallery gallery={profileGallery} token={token} fetchImpl={fetchImpl} />{hideEmptyDiagnostic ? null : <DiagnosticAssets diagnostic={diagnostic} token={token} fetchImpl={fetchImpl} />}</>;
}

function TrainingReadiness({ training, results, current }: { training: LocalTraining; results: LocalTrainingResults; current: TrainFirst }): React.JSX.Element {
  const quality = current.status !== 'recorded' ? '' : current.quality === 'recorded-rejection' ? `Recorded review rejected all ${current.outputCount} tester outputs. No checkpoint selected for this run.` : current.quality === 'unavailable' ? 'Run lifecycle is verified, but quality review evidence is unavailable or stale. No checkpoint acceptance is shown.' : 'Quality has not been reviewed.';
  const currentLifecycle = current.status === 'recorded' ? <section className="figment__references" aria-label="Current train-first lifecycle"><h2>Current train-first lifecycle</h2><p className="figment__inert">Plan-bound lifecycle evidence only. Liveness is unknown while a stage is running. {quality}</p><div className="figment__grid"><article className="figment__card"><h2>{current.creator} · {current.stage}</h2><p>{current.execution.replace('-', ' ')} · up to {current.maxMinutes} minutes · ${current.maxUsd.toFixed(2)} ceiling</p><dl><dt>Plan</dt><dd>{current.planSha256.slice(0, 12)}…</dd><dt>Teardown</dt><dd>{current.terminationVerified === true ? 'Verified' : current.terminationVerified === false ? 'Not verified' : 'Not yet recorded'}</dd><dt>Quality review</dt><dd>{current.quality === 'recorded-rejection' ? 'Recorded rejection' : current.quality === 'unavailable' ? 'Unavailable' : 'Not reviewed'}</dd></dl>{current.checkpoints.length > 0 ? <><h3>Receipt-bound checkpoints</h3><ul>{current.checkpoints.map((checkpoint) => <li key={checkpoint.name}>{checkpoint.name} · {bytes(checkpoint.bytes)}</li>)}</ul><p>Checkpoint hashes are not present in the run receipt.</p></> : null}{current.outputCount > 0 ? <p>{current.outputCount} tester originals recorded. {quality}</p> : null}</article></div></section> : <p className="figment__empty">{current.status === 'not-configured' ? 'No current train-first lifecycle is configured.' : 'Configured train-first lifecycle evidence could not be verified.'}</p>;
  const preparation = training.status === 'recorded' ? <><p className="figment__inert">Historical local preparation evidence. It does not state current training eligibility.</p><div className="figment__grid"><article className="figment__card"><h2>Recorded local preparation</h2><p>CPU dataset parsing completed for {training.preparation.originalObservations} original observation and {training.preparation.repeatCount} repeat. CUDA was masked and the owned process stopped.</p><dl><dt>Target</dt><dd>{training.preparation.targetResolution[0]} × {training.preparation.targetResolution[1]}</dd><dt>Effective bucket</dt><dd>{training.preparation.effectiveBucket[0]} × {training.preparation.effectiveBucket[1]}</dd><dt>Source</dt><dd>{training.preparation.source}</dd></dl></article><article className="figment__card"><h2>Local tokenizer preparation</h2><p>{training.preparation.tokenizerLoads.length} local-only tokenizer inventories loaded. The recorded 19-token result is an availability probe, not a training-caption count.</p></article>{results.status !== 'recorded' ? <><article className="figment__card"><h2>GPU training</h2><p>Not reported by these receipts.</p></article><article className="figment__card"><h2>Quality review</h2><p>Not reported by these receipts.</p></article></> : null}</div></> : <p className="figment__empty">{training.status === 'not-configured' ? 'No local training evidence source is configured.' : 'Configured local training evidence could not be verified.'}</p>;
  const completed = results.status === 'recorded' ? <section className="figment__references"><h2>Completed local runs</h2><p className="figment__inert">These records show completed local runs and artifact bindings. Quality has not been evaluated here.</p><div className="figment__grid">{results.items.map((item) => <article className="figment__card" key={item.kind}><h2>{item.kind === 'availability-probe' ? '10-step local availability probe' : 'Current-caption 100-step local fit'} — Completed</h2><p>{item.artifactCount} checkpoint{item.artifactCount === 1 ? '' : 's'} · {item.steps} steps · {item.durationSeconds.toFixed(3)} s</p><p>Quality not evaluated by these records.</p></article>)}</div></section> : results.status === 'unavailable' ? <p className="figment__empty">Configured completed-run records could not be verified.</p> : null;
  return <section aria-label="Training readiness"><h2>Training readiness</h2>{currentLifecycle}{preparation}{completed}</section>;
}

function Research({ research, contentBriefs, token, fetchImpl }: { research: Projection['research']; contentBriefs: ContentBriefs; token?: string; fetchImpl: typeof fetch }): React.JSX.Element {
  const [article, setArticle] = useState<{ path: string; content: string | null }>({ path: '', content: null });
  const [error, setError] = useState<string | null>(null);
  const request = useRef<{ generation: number; controller: AbortController | null }>({ generation: 0, controller: null });
  const known = new Set(research.artifacts.flatMap((artifact) => { const path = artifactPath(artifact); return path ? [path] : []; }));
  const invalidateRequest = (): void => {
    request.current.controller?.abort();
    request.current = { generation: request.current.generation + 1, controller: null };
  };
  useEffect(() => () => invalidateRequest(), []);
  const open = (path: string): void => {
    if (!known.has(path)) { setError('This item is outside the listed Figment research artifacts.'); return; }
    invalidateRequest();
    const controller = new AbortController();
    const generation = request.current.generation + 1;
    request.current = { generation, controller };
    setArticle({ path, content: null }); setError(null);
    void fetchImpl(`/api/kb/file?path=${encodeURIComponent(path)}`, { ...requestOptions(token), signal: controller.signal }).then(async (response) => {
      if (!response.ok) throw new Error('research file unavailable');
      const payload: unknown = await response.json();
      if (!object(payload) || payload.path !== path || !string(payload.content)) throw new Error('invalid research file response');
      if (request.current.generation === generation && !controller.signal.aborted) setArticle({ path, content: payload.content });
    }).catch(() => {
      if (request.current.generation === generation && !controller.signal.aborted) setError('This research artifact could not be read.');
    });
  };
  const followLink = (event: React.MouseEvent<HTMLElement>): void => {
    const anchor = (event.target as Element).closest('a');
    const href = anchor?.getAttribute('href');
    if (!href || /^https?:\/\//i.test(href) || href.startsWith('#') || /^mailto:/i.test(href)) return;
    event.preventDefault();
    const target = article.path ? resolveArticleLink(article.path, href, known) : null;
    if (target === null) { setError('This link is not a listed Figment research artifact.'); return; }
    open(target);
  };
  const briefs = contentBriefs.status === 'not-configured' ? null : <section className="figment__references" aria-label="Recorded content briefs"><h2>Recorded content briefs</h2><p className="figment__inert">Offline planning snapshots only. Sources and compiler inputs are not revalidated here, and observed results are not recorded.</p>{contentBriefs.status === 'unavailable' ? <p className="figment__empty">Content brief planning records are unavailable.</p> : contentBriefs.status === 'empty' ? <p className="figment__empty">No compiled content briefs are recorded.</p> : <div className="figment__grid">{contentBriefs.items.map((brief) => <article className="figment__card" key={brief.briefId}><h2>{brief.creatorId} · {brief.surface} {brief.templateId}</h2><time dateTime={brief.briefDate}>{brief.briefDate}</time><p>{brief.hypothesis}</p><dl><dt>Intended metric</dt><dd>{brief.intendedMetric}</dd><dt>Required assets</dt><dd>{brief.requiredAssetCount}: {brief.requiredAssetSlots.map((slot) => `${slot.role} (${slot.kind})`).join(', ')}</dd><dt>Assignment</dt><dd>{brief.assignment === 'recorded-source-snapshot' ? 'Recorded source footage; delivery review pending' : brief.assignment === 'recorded-snapshot' ? 'Recorded planning snapshot' : brief.assignment === 'unavailable' ? 'Assignment evidence unavailable' : 'No recorded assignment'}</dd><dt>Sources</dt><dd>{brief.sourceCount}: {brief.sourceDates.join(', ')}</dd><dt>Observed metrics</dt><dd>Not recorded</dd></dl></article>)}</div>}</section>;
  if (!research.available) return <>{briefs}<p className="figment__empty">Research records are unavailable.</p></>;
  if (article.path) return <section className="figment__reader" aria-label="Research reader"><button type="button" className="figment__back" onClick={() => { invalidateRequest(); setArticle({ path: '', content: null }); setError(null); }}>Back to research index</button><p className="figment__reader-path">{article.path}</p>{error ? <div className="figment__reader-error" role="alert"><p>{error}</p><button type="button" className="mc-btn" onClick={() => open(article.path)}>Retry</button></div> : article.content === null ? <p role="status">Loading research artifact…</p> : <article className="figment__reader-content" onClick={followLink} dangerouslySetInnerHTML={{ __html: renderMarkdown(article.content, { tables: true }) }} />}</section>;
  if (!research.artifacts.length) return <>{briefs}<p className="figment__empty">No research or book artifacts are recorded.</p></>;
  return <>{briefs}<div className="figment__records">{research.artifacts.map((a) => { const path = artifactPath(a); return <article className="figment__record" key={`${a.area}/${a.name}`}><div><h2>{a.name}</h2><p>{a.area === 'book' ? 'Book artifact' : 'Research artifact'} · {bytes(a.bytes)}</p></div>{path ? <button type="button" className="figment__open" onClick={() => open(path)}>Read</button> : <span className="figment__inert">Unavailable filename</span>}<time dateTime={a.modifiedAt}>{new Date(a.modifiedAt).toLocaleDateString()}</time></article>; })}</div>{research.truncated ? <p className="figment__notice">The artifact list reached its safe display limit.</p> : null}</>;
}

export function FigmentWorkspace({ token, fetchImpl = fetch }: { token?: string; fetchImpl?: typeof fetch }): React.JSX.Element {
  const [projection, setProjection] = useState<Projection | null>(null); const [error, setError] = useState(false); const [refresh, setRefresh] = useState(0); const [tab, setTab] = useState<Tab>('creators');
  useEffect(() => { let live = true; setError(false); setProjection(null); void fetchImpl('/api/figment', requestOptions(token)).then(async (response) => { if (!response.ok) throw new Error('figment unavailable'); const decoded = valid(await response.json()); if (!decoded) throw new Error('invalid figment projection'); if (live) setProjection(decoded); }).catch(() => { if (live) setError(true); }); return () => { live = false; }; }, [fetchImpl, refresh, token]);
  if (!projection) return <main className="figment" aria-label="Figment workspace"><h1>Figment</h1><p role="status">{error ? 'Figment records are unavailable.' : 'Loading Figment records…'}</p>{error ? <button type="button" className="mc-btn" onClick={() => setRefresh((v) => v + 1)}>Retry</button> : null}</main>;
  if (!projection.available) return <main className="figment" aria-label="Figment workspace"><h1>Figment</h1><p className="figment__empty">The Figment project records are unavailable.</p></main>;
  return <main className="figment" aria-label="Figment workspace"><header className="figment__header"><div><h1>Figment</h1><p>Read-only project evidence. Machine-gate state does not approve a checkpoint.</p></div><p className={`figment__diagnostic figment__diagnostic--${projection.diagnostic.status}`}>{diagnostic(projection.diagnostic)}</p></header><div className="figment__tabs" role="tablist" aria-label="Figment workspace sections">{([['creators', 'Creators'], ['assets', 'Asset review'], ['plans', 'Frozen plans'], ['training', 'Training readiness'], ['records', 'Runs & review'], ['research', 'Research']] as const).map(([id, label]) => <button key={id} type="button" role="tab" aria-selected={tab === id} className={tab === id ? 'figment__tab figment__tab--active' : 'figment__tab'} onClick={() => setTab(id)}>{label}</button>)}</div><section role="tabpanel" className="figment__panel">{tab === 'creators' ? <Creators rows={projection.creators} truncated={projection.creatorsTruncated} /> : tab === 'assets' ? <Assets diagnostic={projection.diagnostic} references={projection.references} generatedInputs={projection.generatedInputs} matchedGallery={projection.matchedGallery} profileGallery={projection.profileGallery} cloudExperiment={projection.cloudExperiment} cloudPairGallery={projection.cloudPairGallery} token={token} fetchImpl={fetchImpl} /> : tab === 'plans' ? <Plans plans={projection.plans} token={token} fetchImpl={fetchImpl} /> : tab === 'training' ? <TrainingReadiness training={projection.localTraining} results={projection.localTrainingResults} current={projection.trainFirst} /> : tab === 'records' ? <Records rows={projection.records} truncated={projection.recordsTruncated} /> : <Research research={projection.research} contentBriefs={projection.contentBriefs} token={token} fetchImpl={fetchImpl} />}</section></main>;
}

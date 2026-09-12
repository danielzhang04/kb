// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FigmentWorkspace } from './FigmentWorkspace';

const projection = { schema: 'figment/hub@1' as const, available: true, creators: [{ id: 'creator-a', persona: 'valid' as const, loraTier: 'provisional', loraTrigger: null, accountTiers: ['instagram'] }], creatorsTruncated: false, records: [{ path: 'runs/a/run.json', type: 'run', creator: 'creator-a', reviewState: 'unknown' as const, machineGateState: 'current' as const, schema: 'figment/runpod-run@1' }], recordsTruncated: false, plans: { items: [{ path: 'runs/a/driver-plan.json', creator: 'creator-a', variant: 'studio-preview', stages: [{ name: 'train', runCount: 1, declaredCeilingUsd: 1.25 }, { name: 'tester', runCount: 2, declaredCeilingUsd: null }], declaredCeilingUsd: 1.25 }], truncated: false }, research: { available: true, artifacts: [{ area: 'book' as const, name: 'chapter.md', bytes: 2048, modifiedAt: '2026-09-08T00:00:00Z' }], truncated: false }, references: { items: [{ creator: 'creator-a', name: 'g01.jpg', bytes: 90, sha256: 'b'.repeat(64), width: 4, height: 3, modifiedAt: '2026-09-08T00:00:00Z' }], truncated: false }, generatedInputs: { available: false, items: [], truncated: false }, diagnostic: { status: 'diagnostic-not-promotable' as const, dryRun: false, podId: 'pod', artifacts: [], artifactsTruncated: false } };
const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
const recordedBriefs = (hypothesis = 'A recorded planning hypothesis.') => ({ status: 'recorded' as const, recordKind: 'planning-snapshot' as const, currentSourceRevalidated: false as const, items: [{ briefId: 'summer-test', briefDate: '2026-09-08', creatorId: 'creator-a', surface: 'carousel' as const, templateId: 'CT-2', requiredAssetCount: 2, requiredAssetSlots: [{ role: 'hook', kind: 'persona' as const }, { role: 'payoff', kind: 'persona' as const }], hypothesis, intendedMetric: 'saves per reached account', sourceCount: 1, sourceDates: ['2026-09-07'], observedMetrics: null, renderAs: 'text' as const }] });

afterEach(cleanup);

describe('FigmentWorkspace', () => {
  it('renders evidence states without treating a machine gate as checkpoint approval', async () => {
    const fetchImpl = vi.fn(() => response(projection)) as unknown as typeof fetch;
    render(<FigmentWorkspace token="session" fetchImpl={fetchImpl} />);
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Runs & review' }));
    expect(screen.getByText('Approval unknown')).toBeTruthy();
    expect(screen.getByText('Machine gate current')).toBeTruthy();
    expect(screen.getByText('Diagnostic evidence — not promotable')).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/api/figment', { headers: { authorization: 'Bearer session' } });
  });

  it('mounts video review claims only in Runs & review while preserving records and fetch context', async () => {
    const inventory = { schema: 'figment/studio-video-rulings@1', ids: ['clip-1'], availability: 'available' };
    const fetchImpl = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/figment') return response(projection);
      if (url === '/api/figment/video-rulings') return response(inventory);
      return Promise.reject(new Error(`unexpected request: ${url}`));
    }) as unknown as typeof fetch;
    render(<FigmentWorkspace token="current-session" fetchImpl={fetchImpl} />);

    await screen.findByText('creator-a');
    expect(screen.queryByRole('heading', { name: 'Video review claims' })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('tab', { name: 'Runs & review' }));
    await screen.findByRole('heading', { name: 'Video review claims' });
    expect(screen.getByText('runs/a/run.json')).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/api/figment/video-rulings', {
      headers: { authorization: 'Bearer current-session' },
    });

    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.queryByRole('heading', { name: 'Video review claims' })).toBeNull();
  });

  it('never auto-POSTs from default mount, Runs & review navigation, or status refresh', async () => {
    const inventory = { schema: 'figment/studio-video-rulings@1', ids: ['clip-1'], availability: 'available' };
    const fetchImpl = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      const url = String(input);
      if (url === '/api/figment') return response(projection);
      if (url === '/api/figment/video-rulings') return response(inventory);
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });
    render(<FigmentWorkspace token="session" fetchImpl={fetchImpl as unknown as typeof fetch} />);

    await screen.findByText('creator-a');
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
    fireEvent.click(screen.getByRole('tab', { name: 'Runs & review' }));
    await screen.findByRole('combobox');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh status' }));
    await waitFor(() => expect(fetchImpl.mock.calls.filter(([url]) => String(url) === '/api/figment/video-rulings')).toHaveLength(2));
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('shows loading then a recoverable unavailable state', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    expect(screen.getByText('Loading Figment records…')).toBeTruthy();
    await screen.findByText('Figment records are unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it('identifies a truncated creator list in the creator tab', async () => {
    const fetchImpl = vi.fn(() => response({ ...projection, creatorsTruncated: true })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('The creator list reached its safe display limit.');
  });

  it('shows bounded frozen-plan stages as declared, offline budgets', async () => {
    const fetchImpl = vi.fn(() => response(projection)) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Frozen plans' }));
    expect(screen.getByText('Offline preview of existing plans. Declared ceilings are not live estimates and this page cannot start a run.')).toBeTruthy();
    expect(screen.getByText('runs/a/driver-plan.json')).toBeTruthy();
    expect(screen.getByText(/train/)).toBeTruthy();
    expect(screen.getAllByText(/tester/).length).toBeGreaterThan(0);
    expect(screen.getByText('Declared ceiling: $1.25')).toBeTruthy();
  });

  it('wires the Frozen plans tab to the gen-plans endpoint with the session token and no POST on mount', async () => {
    const genPlansBody = { schema: 'figment/studio-gen-plans@2' as const, requestScope: 'a'.repeat(64), plans: [], executionRecords: [], preparation: 'available' as const };
    const fetchImpl: ReturnType<typeof vi.fn> = vi.fn((url: string) => url === '/api/figment' ? response(projection) : url === '/api/figment/studio/gen-plans' ? response(genPlansBody) : Promise.reject(new Error(`unexpected request: ${url}`)));
    render(<FigmentWorkspace token="session" fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Frozen plans' }));
    await screen.findByRole('heading', { name: 'Prepare generation plan' });
    await screen.findByText('Preparation status: Local preparation checks passed. Checkpoint and source authority are checked when preparation runs.');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Prepare generation plan' }) as HTMLButtonElement).disabled).toBe(false));
    expect(fetchImpl).toHaveBeenCalledWith('/api/figment/studio/gen-plans', { headers: { authorization: 'Bearer session' } });
    expect(fetchImpl.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST')).toBe(false);
  });

  it('shows terminal cloud execution separately from a quality disposition', async () => {
    const cloudExperiment = { status: 'recorded' as const, execution: 'failed' as const, liveness: null, maxMinutes: 60, maxUsd: null, preflightEstimateUsd: 1.3, estimatedActualUsd: 0.019366, startedUtc: '2026-09-09T07:33:27+00:00', finishedUtc: '2026-09-09T07:34:21+00:00', terminationVerified: true, outputCount: 0, quality: 'not-reviewed' as const, failure: 'bootstrap' as const };
    const fetchImpl = vi.fn(() => response({ ...projection, cloudExperiment })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Asset review' }));
    expect(screen.getByText('Reference-cloud experiment')).toBeTruthy();
    expect(screen.getByText(/Execution stopped during bootstrap/)).toBeTruthy();
    expect(screen.getByText('Preflight estimate')).toBeTruthy();
    expect(screen.getByText('$1.30')).toBeTruthy();
    expect(screen.getByText('Spend ceiling')).toBeTruthy();
    expect(screen.getAllByText('not recorded').length).toBeGreaterThan(0);
    expect(screen.getByText('Lifecycle evidence only; visual review is recorded separately.')).toBeTruthy();
    expect(screen.queryByText('must-not-project')).toBeNull();
  });

  it('shows two cloud-pair originals with separate STOP reviews and no eligibility claim', async () => {
    const observations = { identity: 'geometry differs', realism: 'skin is smoothed', composition: 'turn absent', clothing: 'crew-neck inconsistent', safety: 'clothed adult' };
    const cloudPairGallery = { status: 'recorded' as const, experimentId: 'omnigen2-v3', modelFamily: 'OmniGen2', notPromotable: true as const, trainingEligible: false as const, rows: [481516234, 90210].map((seed) => ({ seed, asset: { assetId: `omnigen2-v3-${seed}`, sha256: 'd'.repeat(64), bytes: 90, width: 768, height: 768 }, reviews: { root: { disposition: 'stop' as const, source: 'docs/figment/root.md', observations }, independent: { disposition: 'stop' as const, source: 'docs/figment/independent.md', observations } } })) };
    const fetchImpl = vi.fn((input: RequestInfo | URL) => String(input) === '/api/figment' ? response({ ...projection, cloudPairGallery }) : Promise.resolve(new Response(new Blob(['png']), { status: 200 }))) as unknown as typeof fetch;
    const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL; Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:cloud-pair') }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    try { render(<FigmentWorkspace token="session" fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Asset review' })); await screen.findByRole('img', { name: 'Cloud reference pair seed 481516234' }); expect(screen.getByText('Cloud reference pair — OmniGen2')).toBeTruthy(); expect(screen.getAllByText('Root — STOP')).toHaveLength(2); expect(screen.getAllByText('Independent — STOP')).toHaveLength(2); expect(screen.getByText(/not promotable and not training eligible/)).toBeTruthy(); expect(screen.queryByText('No diagnostic assets are available for review.')).toBeNull(); expect(fetchImpl).toHaveBeenCalledWith('/api/figment/cloud-pair-assets/omnigen2-v3-481516234?sha256=' + 'd'.repeat(64), expect.objectContaining({ headers: { authorization: 'Bearer session' } })); } finally { Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke }); }
  });

  it('shows historical preparation without claiming GPU or quality evidence', async () => {
    const localTraining = { status: 'recorded' as const, historical: true as const, preparation: { source: 'anchors/g01.jpg' as const, originalObservations: 1 as const, repeatCount: 1 as const, targetResolution: [768, 768] as [number, number], effectiveBucket: [896, 512] as [number, number], cpuCudaMasked: true as const, cpuVerifiedTeardown: true as const, tokenizerLoads: [{ id: 'openai/clip-vit-large-patch14', probeTokenCount: 19 }, { id: 'laion/CLIP-ViT-bigG-14-laion2B-39B-b160k', probeTokenCount: 19 }] } };
    const fetchImpl = vi.fn(() => response({ ...projection, localTraining })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Training readiness' }));
    expect(screen.getByText('Recorded local preparation')).toBeTruthy();
    expect(screen.getByText('GPU training')).toBeTruthy();
    expect(screen.getAllByText('Not reported by these receipts.')).toHaveLength(2);
    expect(screen.getByText(/availability probe, not a training-caption count/)).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('shows two historical completed-run cards without another request or a quality claim', async () => {
    const localTrainingResults = { status: 'recorded' as const, historical: true as const, items: [
      { kind: 'availability-probe' as const, completed: true as const, durationSeconds: 79.234, steps: 10, artifactCount: 1, checkpoints: [{ step: 10, sha256: 'a'.repeat(64), bytes: 170540916 }], quality: 'not-evaluated' as const },
      { kind: 'current-quality-fit' as const, completed: true as const, durationSeconds: 217.629, steps: 100, artifactCount: 11, checkpoints: [{ step: 20, sha256: 'b'.repeat(64), bytes: 170540948 }, { step: 50, sha256: 'c'.repeat(64), bytes: 170540948 }, { step: 100, sha256: 'd'.repeat(64), bytes: 170540948 }], quality: 'not-evaluated' as const },
    ] };
    const fetchImpl = vi.fn(() => response({ ...projection, localTrainingResults })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Training readiness' }));
    expect(screen.getByText('10-step local availability probe — Completed')).toBeTruthy();
    expect(screen.getByText('Current-caption 100-step local fit — Completed')).toBeTruthy();
    expect(screen.getByText('These records show completed local runs and artifact bindings. Quality has not been evaluated here.')).toBeTruthy();
    expect(screen.getAllByText('Quality not evaluated by these records.')).toHaveLength(2);
    expect(screen.queryByText('GPU training')).toBeNull();
    expect(screen.queryByText('Quality review')).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('normalizes an older hub response and rejects malformed local-training evidence', async () => {
    const oldHub = vi.fn(() => response(projection)) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={oldHub} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Training readiness' }));
    expect(screen.getByText('No local training evidence source is configured.')).toBeTruthy(); cleanup();
    const malformed = vi.fn(() => response({ ...projection, localTraining: { status: 'recorded', historical: false } })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={malformed} />); await screen.findByText('Figment records are unavailable.');
  });

  it('rejects malformed completed-run evidence', async () => {
    const malformed = vi.fn(() => response({ ...projection, localTrainingResults: { status: 'recorded', historical: true, items: [] } })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={malformed} />); await screen.findByText('Figment records are unavailable.');
  });

  it('rejects completed-run evidence with unselected checkpoint steps', async () => {
    const malformed = vi.fn(() => response({ ...projection, localTrainingResults: { status: 'recorded', historical: true, items: [
      { kind: 'availability-probe', completed: true, durationSeconds: 1, steps: 10, artifactCount: 1, checkpoints: [{ step: 9, sha256: 'a'.repeat(64), bytes: 1 }], quality: 'not-evaluated' },
      { kind: 'current-quality-fit', completed: true, durationSeconds: 1, steps: 100, artifactCount: 11, checkpoints: [{ step: 10, sha256: 'b'.repeat(64), bytes: 1 }, { step: 30, sha256: 'c'.repeat(64), bytes: 1 }, { step: 70, sha256: 'd'.repeat(64), bytes: 1 }], quality: 'not-evaluated' },
    ] } })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={malformed} />); await screen.findByText('Figment records are unavailable.');
  });

  it('shows four opaque matched assets and preserves the recorded review disagreement', async () => {
    const observations = { realism: 'recorded realism', resemblance_to_g01: 'recorded resemblance', pose: 'recorded pose', apparent_adulthood: 'recorded adulthood', apparent_age_fit: 'recorded age', clothing: 'recorded clothing', defects: 'recorded defects' };
    const review = (disposition: 'continue' | 'stop') => ({ disposition, observations });
    const matchedGallery = { status: 'recorded' as const, historical: true as const, notPromotable: true as const, conditioning: 'no-pixel-reference-conditioning' as const, pairs: [481516234, 90210].map((seed) => ({ seed, base: { assetId: `base-${seed}` as const, sha256: 'a'.repeat(64), bytes: 90, width: 1024 as const, height: 1024 as const }, current20: { assetId: `current-20-${seed}` as const, sha256: 'b'.repeat(64), bytes: 90, width: 1024 as const, height: 1024 as const }, reviews: { root: { base: review('continue'), current20: review('continue') }, independent: { base: review('continue'), current20: review('stop') } } })) };
    const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:matched') }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    try {
      const fetchImpl = vi.fn((url: string) => url === '/api/figment' ? response({ ...projection, diagnostic: { status: 'not-configured' }, matchedGallery }) : response('png', 200)) as unknown as typeof fetch;
      render(<FigmentWorkspace token="session" fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Asset review' }));
      await screen.findByRole('img', { name: 'Matched diagnostic base seed 481516234' });
      expect(screen.getByText('Matched diagnostic pairs')).toBeTruthy(); expect(screen.getAllByText(/Independent diagnostic — stop/)).toHaveLength(2); expect(screen.queryByText('No diagnostic assets are available for review.')).toBeNull();
      const assetCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).includes('/matched-gallery-assets/'));
      expect(assetCalls).toHaveLength(4); expect(assetCalls.every(([url]) => !String(url).includes('output') && !String(url).includes('receipt'))).toBe(true);
      expect(fetchImpl).toHaveBeenCalledWith('/api/figment/matched-gallery-assets/base-481516234?sha256=' + 'a'.repeat(64), expect.objectContaining({ headers: { authorization: 'Bearer session' } }));
      cleanup();
      const oversized = { ...matchedGallery, pairs: matchedGallery.pairs.map((pair, index) => index === 0 ? { ...pair, base: { ...pair.base, bytes: 8 * 1024 * 1024 + 1 } } : pair) };
      const malformedFetch = vi.fn(() => response({ ...projection, matchedGallery: oversized })) as unknown as typeof fetch;
      render(<FigmentWorkspace fetchImpl={malformedFetch} />); await screen.findByText('Figment records are unavailable.');
    } finally { Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke }); }
  });

  it('rejects malformed matched-gallery evidence while accepting an older absent field', async () => {
    const older = vi.fn(() => response(projection)) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={older} />); await screen.findByText('creator-a'); cleanup();
    const malformed = vi.fn(() => response({ ...projection, matchedGallery: { status: 'recorded', historical: true, notPromotable: true, conditioning: 'no-pixel-reference-conditioning', pairs: [] } })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={malformed} />); await screen.findByText('Figment records are unavailable.');
  });

  it('shows two separate stopped prompt-profile reviews and keeps the recorded gaze disagreement', async () => {
    const observations = (gaze: string) => ({ realism: 'recorded realism', resemblance_to_g01: 'recorded resemblance', pose: gaze, apparent_adulthood: 'recorded adulthood', apparent_age_fit: 'recorded age', clothing: 'recorded clothing', defects: 'recorded defects' });
    const profileGallery = { status: 'recorded' as const, stage: 'profile-base' as const, historical: true as const, notPromotable: true as const, conditioning: 'no-pixel-reference-conditioning' as const, selectedCheckpoint: null, rows: [481516234, 90210].map((seed, index) => ({ seed, asset: { assetId: `profile-base-${seed}`, sha256: 'c'.repeat(64), bytes: 90, width: 1024, height: 1024 }, reviews: { root: { disposition: 'stop' as const, reason: 'root stop reason', observations: observations(index === 1 ? 'gaze toward camera' : 'recorded pose') }, independent: { disposition: 'stop' as const, reason: 'independent stop reason', observations: observations(index === 1 ? 'gaze away from camera' : 'recorded pose') } } })) };
    const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:profile') }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    try {
      const fetchImpl = vi.fn((url: string) => url === '/api/figment' ? response({ ...projection, diagnostic: { status: 'not-configured' }, profileGallery }) : url.endsWith('90210?sha256=' + 'c'.repeat(64)) ? response('', 409) : response('png', 200)) as unknown as typeof fetch;
      render(<FigmentWorkspace token="session" fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Asset review' }));
      await screen.findByRole('img', { name: 'Prompt-profile diagnostic seed 481516234' });
      expect(screen.getByText('Prompt-profile diagnostic')).toBeTruthy();
      expect(screen.getByText('Both reviews stopped this prompt-profile test. No adapter comparison followed.')).toBeTruthy();
      expect(screen.getAllByText('Root review — stop')).toHaveLength(2); expect(screen.getAllByText('Independent review — stop')).toHaveLength(2);
      expect(screen.getAllByText('root stop reason')).toHaveLength(2); expect(screen.getAllByText('independent stop reason')).toHaveLength(2);
      expect(screen.getByText('gaze toward camera')).toBeTruthy(); expect(screen.getByText('gaze away from camera')).toBeTruthy();
      expect(screen.queryByText('Matched diagnostic pairs')).toBeNull(); expect(screen.queryByText('No diagnostic assets are available for review.')).toBeNull();
      await screen.findByText('A recorded prompt-profile image could not be read.');
      await screen.findByText('Recorded image unavailable.');
      const assetCalls = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(([url]) => String(url).includes('/profile-gallery-assets/'));
      expect(assetCalls).toHaveLength(2); expect(assetCalls.every(([, init]) => (init as RequestInit | undefined)?.method === undefined)).toBe(true);
      expect(fetchImpl).toHaveBeenCalledWith('/api/figment/profile-gallery-assets/profile-base-481516234?sha256=' + 'c'.repeat(64), expect.objectContaining({ headers: { authorization: 'Bearer session' } }));
    } finally { Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke }); }
  });

  it('rejects malformed prompt-profile evidence while accepting an older absent field', async () => {
    const older = vi.fn(() => response(projection)) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={older} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Asset review' }));
    expect(screen.queryByText('Prompt-profile diagnostic')).toBeNull(); cleanup();
    const base = { status: 'recorded', stage: 'profile-base', historical: true, notPromotable: true, conditioning: 'no-pixel-reference-conditioning', selectedCheckpoint: null };
    for (const profileGallery of [{ ...base, rows: [] }, { ...base, selectedCheckpoint: 'step-20', rows: [] }]) {
      const malformed = vi.fn(() => response({ ...projection, profileGallery })) as unknown as typeof fetch;
      render(<FigmentWorkspace fetchImpl={malformed} />); await screen.findByText('Figment records are unavailable.'); cleanup();
    }
  });

  it('requests only the fixed offline tester preview and labels its limits', async () => {
    const preview = { schema: 'figment/plan-preview@1', offlinePreview: true, notPromotable: true, creator: 'creator-001', stage: 'tester', runCount: 1, declaredCeilingUsd: 2.5, manifestSha256: 'a'.repeat(64) };
    const fetchImpl = vi.fn((url: string) => url === '/api/figment' ? response(projection) : response(preview)) as unknown as typeof fetch;
    render(<FigmentWorkspace token="session" fetchImpl={fetchImpl} />);
    await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Frozen plans' }));
    expect(screen.getByText(/cannot run a pod, create an approval, or promote a checkpoint/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preview tester plan' }));
    await screen.findByText(/creator-001.*tester.*declared \$2\.50/);
    expect(fetchImpl).toHaveBeenCalledWith('/api/figment/plan-preview/tester', { method: 'POST', headers: { authorization: 'Bearer session' } });
  });

  it('fetches only listed diagnostic PNG assets with their projection hash', async () => {
    const created: string[] = []; const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => { const url = `blob:fixture-${created.length}`; created.push(url); return url; }) });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    try {
      const diagnostic = { ...projection.diagnostic, artifacts: [{ name: 'proof.png', bytes: 90, sha256: 'a'.repeat(64), width: 4, height: 3, modifiedAt: '2026-09-08T00:00:00Z' }] };
      const fetchImpl = vi.fn((url: string) => url === '/api/figment' ? response({ ...projection, diagnostic }) : response('png', 200)) as unknown as typeof fetch;
      render(<FigmentWorkspace token="session" fetchImpl={fetchImpl} />);
      await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Asset review' }));
      await screen.findByRole('img', { name: 'Diagnostic asset proof.png' });
      expect(fetchImpl).toHaveBeenCalledWith('/api/figment/diagnostic-assets/proof.png?sha256=' + 'a'.repeat(64), expect.objectContaining({ headers: { authorization: 'Bearer session' } }));
      expect(screen.getAllByText(/not promotable/).length).toBeGreaterThan(1);
    } finally {
      Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate });
      Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke });
    }
  });

  it('shows selected declared references separately from diagnostics and cleans object URLs', async () => {
    const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:reference') }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    try {
      const fetchImpl = vi.fn((url: string) => url === '/api/figment' ? response(projection) : response('jpeg', 200)) as unknown as typeof fetch;
      const view = render(<FigmentWorkspace token="session" fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Asset review' }));
      await screen.findByRole('img', { name: 'Declared reference creator-a g01.jpg' });
      expect(screen.getByText('g01.jpg | 4x3')).toBeTruthy();
      expect(screen.getByText(/do not associate a diagnostic with this creator/)).toBeTruthy(); expect((screen.getByLabelText('Selected reference creator') as HTMLSelectElement).value).toBe('creator-a');
      expect(fetchImpl).toHaveBeenCalledWith('/api/figment/reference-assets/creator-a/g01.jpg?sha256=' + 'b'.repeat(64), expect.objectContaining({ headers: { authorization: 'Bearer session' } }));
      view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:reference');
    } finally { Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke }); }
  });

  it('shows dated generated-input observations and cleans their object URL', async () => {
    const originalCreate = URL.createObjectURL; const originalRevoke = URL.revokeObjectURL;
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:generated') }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    try {
      const generatedInputs = { available: true, truncated: false, items: [{ name: 'g01-e01-shoulders-up-v1.png', bytes: 90, sha256: 'c'.repeat(64), width: 1697, height: 927, sourceReference: 'anchors/g01.jpg', sourceSha256: 'd'.repeat(64), generatedOn: '2026-09-08', reviewStatus: 'experimental-unreviewed', visualReview: { identity: 'independent review pending', clothing: 'opaque black top' } }] };
      const fetchImpl = vi.fn((url: string) => url === '/api/figment' ? response({ ...projection, generatedInputs }) : response('png', 200)) as unknown as typeof fetch;
      const view = render(<FigmentWorkspace token="session" fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Asset review' }));
      await screen.findByRole('img', { name: 'Generated input experiment g01-e01-shoulders-up-v1.png' });
      expect(screen.getByText(/Generated on:\s*2026-09-08/)).toBeTruthy(); expect(screen.getByText('Recorded observations')).toBeTruthy(); expect(screen.getByText((_, element) => element?.tagName === 'DD' && element.textContent === 'Identity: independent review pending')).toBeTruthy(); expect(screen.getByText((_, element) => element?.tagName === 'DD' && element.textContent === 'Clothing: opaque black top')).toBeTruthy(); expect(screen.getByText('Source and hashes')).toBeTruthy();
      expect(fetchImpl).toHaveBeenCalledWith('/api/figment/generated-input-assets/g01-e01-shoulders-up-v1.png?sha256=' + 'c'.repeat(64), expect.objectContaining({ headers: { authorization: 'Bearer session' } }));
      view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:generated');
    } finally { Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke }); }
  });

  it('keeps an older payload without content briefs compatible', async () => {
    const fetchImpl = vi.fn(() => response(projection)) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByText('chapter.md')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Recorded content briefs' })).toBeNull();
  });

  it('renders a recorded brief as inert text even when research artifacts are unavailable', async () => {
    const malicious = '<img src=x onerror="window.pwned=true">';
    const fetchImpl = vi.fn(() => response({ ...projection, research: { available: false, artifacts: [], truncated: false }, contentBriefs: recordedBriefs(malicious) })) as unknown as typeof fetch;
    const rendered = render(<FigmentWorkspace fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByRole('heading', { name: 'Recorded content briefs' })).toBeTruthy();
    expect(screen.getByText('2026-09-08')).toBeTruthy();
    expect(screen.getByText(malicious)).toBeTruthy();
    expect(rendered.container.querySelector('img')).toBeNull();
    expect(rendered.container.innerHTML).toContain('&lt;img src=x onerror="window.pwned=true"&gt;');
    expect(screen.getByText('Research records are unavailable.')).toBeTruthy();
    expect(screen.getByText('Not recorded')).toBeTruthy();
  });

  it('renders assignment state as inert planning evidence and accepts older brief payloads', async () => {
    const baseAssigned = recordedBriefs(); const assigned = { ...baseAssigned, items: baseAssigned.items.map((item) => ({ ...item, assignment: 'recorded-snapshot' as const })) };
    const fetchImpl = vi.fn(() => response({ ...projection, research: { available: false, artifacts: [], truncated: false }, contentBriefs: assigned })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByText('Recorded planning snapshot')).toBeTruthy();
    cleanup();
    const oldFetch = vi.fn(() => response({ ...projection, research: { available: false, artifacts: [], truncated: false }, contentBriefs: recordedBriefs() })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={oldFetch} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByText('No recorded assignment')).toBeTruthy();
    cleanup();
    const baseUnavailable = recordedBriefs(); const unavailable = { ...baseUnavailable, items: baseUnavailable.items.map((item) => ({ ...item, assignment: 'unavailable' as const })) };
    const unavailableFetch = vi.fn(() => response({ ...projection, research: { available: false, artifacts: [], truncated: false }, contentBriefs: unavailable })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={unavailableFetch} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByText('Assignment evidence unavailable')).toBeTruthy();
  });

  it('labels recorded motion footage as pending delivery review', async () => {
    const base = recordedBriefs();
    const contentBriefs = { ...base, items: base.items.map((item) => ({ ...item, surface: 'reel', templateId: 'RT-1', assignment: 'recorded-source-snapshot' })) };
    const fetchImpl = vi.fn(() => response({ ...projection, contentBriefs })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />); await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByText('Recorded source footage; delivery review pending')).toBeTruthy();
  });

  it('labels recorded native scene sources honestly without rendering private metadata', async () => {
    const base = recordedBriefs();
    const contentBriefs = { ...base, items: base.items.map((item) => ({ ...item, requiredAssetSlots: [{ role: 'scene', kind: 'nonpersona' as const }], requiredAssetCount: 1, assignment: 'recorded-native-source-snapshot' as const, privateNativePath: 'private/rulings/scene.json', reviewer: 'human-reviewer' })) };
    const fetchImpl = vi.fn(() => response({ ...projection, contentBriefs })) as unknown as typeof fetch;
    const rendered = render(<FigmentWorkspace fetchImpl={fetchImpl} />); await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByText('Recorded plan; scene images still need delivery review')).toBeTruthy();
    expect(rendered.container.textContent).not.toMatch(/private\/rulings|human-reviewer|accept-native|sha256/i);
  });

  it('rejects an unknown content brief assignment state', async () => {
    const base = recordedBriefs();
    const contentBriefs = { ...base, items: base.items.map((item) => ({ ...item, assignment: 'recorded-native-source-review-approved' })) };
    const fetchImpl = vi.fn(() => response({ ...projection, contentBriefs })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('Figment records are unavailable.');
  });

  it('keeps research artifacts visible for empty and unavailable brief inventories', async () => {
    for (const contentBriefs of [{ status: 'empty', recordKind: 'planning-snapshot', currentSourceRevalidated: false, items: [] }, { status: 'unavailable', reason: 'evidence-unavailable', items: [] }]) {
      const fetchImpl = vi.fn(() => response({ ...projection, contentBriefs })) as unknown as typeof fetch;
      render(<FigmentWorkspace fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
      expect(screen.getByText('chapter.md')).toBeTruthy();
      expect(screen.getByText(contentBriefs.status === 'empty' ? 'No compiled content briefs are recorded.' : 'Content brief planning records are unavailable.')).toBeTruthy();
      cleanup();
    }
  });

  it('shows a distinguishable record path and reads only listed research artifacts through the KB reader', async () => {
    const research = {
      ...projection.research,
      artifacts: [
        { area: 'book' as const, name: 'chapter.md', bytes: 2048, modifiedAt: '2026-09-08T00:00:00Z' },
        { area: 'book' as const, name: 'next.md', bytes: 1024, modifiedAt: '2026-09-08T00:00:00Z' },
      ],
    };
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/api/figment') return response({ ...projection, research });
      if (url.includes('chapter.md')) return response({ path: 'orgs/figment/research/book/chapter.md', content: '# Chapter\n[Next](next.md)\n[External](https://example.com)' });
      if (url.includes('next.md')) return response({ path: 'orgs/figment/research/book/next.md', content: '# Next chapter' });
      return Promise.reject(new Error('unexpected URL'));
    }) as unknown as typeof fetch;
    render(<FigmentWorkspace token="session" fetchImpl={fetchImpl} />);
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Runs & review' }));
    expect(screen.getByText('runs/a/run.json')).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    fireEvent.click(screen.getAllByRole('button', { name: 'Read' })[0]);
    await screen.findByRole('heading', { name: 'Chapter' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/kb/file?path=orgs%2Ffigment%2Fresearch%2Fbook%2Fchapter.md', expect.objectContaining({ headers: { authorization: 'Bearer session' } }));
    expect(screen.getByRole('link', { name: 'External' }).getAttribute('href')).toBe('https://example.com');
    fireEvent.click(screen.getByRole('link', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Next chapter' });
    expect(fetchImpl).toHaveBeenCalledWith('/api/kb/file?path=orgs%2Ffigment%2Fresearch%2Fbook%2Fnext.md', expect.objectContaining({ headers: { authorization: 'Bearer session' } }));
    fireEvent.click(screen.getByRole('button', { name: 'Back to research index' }));
    await screen.findByText('chapter.md');
  });

  it('does not reopen the reader when a deferred request resolves after Back', async () => {
    let resolveChapter: ((value: Response) => void) | undefined;
    let chapterSignal: AbortSignal | null = null;
    const delayedChapter = new Promise<Response>((resolve) => { resolveChapter = resolve; });
    const fetchImpl = vi.fn((url: string, options?: RequestInit) => {
      if (url === '/api/figment') return response(projection);
      if (url.includes('chapter.md')) { chapterSignal = options?.signal instanceof AbortSignal ? options.signal : null; return delayedChapter; }
      return Promise.reject(new Error('unexpected URL'));
    }) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    fireEvent.click(screen.getByRole('button', { name: 'Read' }));
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Back to research index' }));
    expect((chapterSignal as AbortSignal | null)?.aborted).toBe(true);
    resolveChapter?.(new Response(JSON.stringify({ path: 'orgs/figment/research/book/chapter.md', content: '# Late chapter' }), { headers: { 'content-type': 'application/json' } }));
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(screen.queryByLabelText('Research reader')).toBeNull();
    expect(screen.getByText('chapter.md')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Late chapter' })).toBeNull();
  });

  it('keeps malformed research filenames inert rather than constructing a KB path', async () => {
    const fetchImpl = vi.fn(() => response({ ...projection, research: { ...projection.research, artifacts: [{ area: 'research' as const, name: '../outside.md', bytes: 1, modifiedAt: '2026-09-08T00:00:00Z' }] } })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    expect(screen.getByText('Unavailable filename')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Read' })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails closed when nested diagnostic or record fields are malformed', async () => {
    const malformed = { ...projection, diagnostic: { status: 'unavailable', reason: null }, records: [{ ...projection.records[0], machineGateState: 'invented' }] };
    const fetchImpl = vi.fn(() => response(malformed)) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('Figment records are unavailable.');
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });

  it('fails closed when a frozen-plan total is not a finite number', async () => {
    const malformed = { ...projection, plans: { ...projection.plans, items: [{ ...projection.plans.items[0], declaredCeilingUsd: null }] } };
    const fetchImpl = vi.fn(() => response(malformed)) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('Figment records are unavailable.');
  });

  it('shows the exact current train-first lifecycle without implying liveness or quality', async () => {
    const trainFirst = { status: 'recorded' as const, planSha256: 'e'.repeat(64), creator: 'creator-001', stage: 'train' as const, execution: 'completed' as const, liveness: null, maxMinutes: 351, maxUsd: 7.61, startedUtc: '2026-09-09T20:12:32Z', finishedUtc: '2026-09-09T22:12:32Z', terminationVerified: true, checkpoints: Array.from({ length: 5 }, (_, index) => ({ name: `creator-step-${(index + 1) * 250}.safetensors`, bytes: 1024 + index })), outputCount: 0, quality: 'not-reviewed' as const };
    const fetchImpl = vi.fn(() => response({ ...projection, trainFirst })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Training readiness' }));
    expect(screen.getByRole('heading', { name: 'Current train-first lifecycle' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'creator-001 · train' })).toBeTruthy();
    expect(screen.getByText(/completed · up to 351 minutes · \$7\.61 ceiling/)).toBeTruthy();
    expect(screen.getByText('Verified')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Receipt-bound checkpoints' })).toBeTruthy();
    expect(screen.getByText('Checkpoint hashes are not present in the run receipt.')).toBeTruthy();
    expect(screen.getByText('Plan-bound lifecycle evidence only. Liveness is unknown while a stage is running. Quality has not been reviewed.')).toBeTruthy();
    expect(screen.queryByText(/pod|prompt/i)).toBeNull();
  });

  it('shows a recorded tester rejection without implying checkpoint acceptance', async () => {
    const trainFirst = { status: 'recorded' as const, planSha256: 'e'.repeat(64), creator: 'creator-001', stage: 'tester' as const, execution: 'completed' as const, liveness: null, maxMinutes: 115, maxUsd: 2.5, startedUtc: '2026-09-09T22:42:16Z', finishedUtc: '2026-09-09T23:03:12Z', terminationVerified: true, checkpoints: [], outputCount: 5, quality: 'recorded-rejection' as const };
    const fetchImpl = vi.fn(() => response({ ...projection, trainFirst })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Training readiness' }));
    expect(screen.getByText('Recorded rejection')).toBeTruthy();
    expect(screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === '5 tester originals recorded. Recorded review rejected all 5 tester outputs. No checkpoint selected for this run.')).toBeTruthy();
    expect(screen.queryByText(/approved checkpoint/i)).toBeNull();
  });

  it('fails closed for an inconsistent train-first terminal projection', async () => {
    const trainFirst = { status: 'recorded', planSha256: 'e'.repeat(64), creator: 'creator-001', stage: 'tester', execution: 'completed', liveness: 'unknown', maxMinutes: 115, maxUsd: 2.5, startedUtc: null, finishedUtc: null, terminationVerified: false, checkpoints: [], outputCount: 5, quality: 'not-reviewed' };
    const fetchImpl = vi.fn(() => response({ ...projection, trainFirst })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />); await screen.findByText('Figment records are unavailable.');
  });
});

const revisionHash = 'a'.repeat(64);
const revisionBriefs = (includePublished = false) => {
  const base = recordedBriefs();
  const creatorBase = { ...base.items[0], briefId: 'creator001-base', briefDate: '2026-09-10', creatorId: 'creator-001' };
  const otherCreator = { ...base.items[0], briefId: 'other-creator-base', briefDate: '2026-09-09', creatorId: 'creator-002' };
  const published = { ...creatorBase, briefId: '2026-09-12-creator-001-revision-a', briefDate: '2026-09-12', hypothesis: 'A refreshed planning hypothesis.' };
  return { ...base, items: includePublished ? [creatorBase, otherCreator, published] : [creatorBase, otherCreator] };
};

const revisionSuccess = {
  schema: 'figment/studio-content-brief-revision@1',
  status: 'published',
  briefId: '2026-09-12-creator-001-revision-a',
  briefSha256: revisionHash,
};

function fillRevisionForm(): void {
  fireEvent.change(screen.getByLabelText('Revision date'), { target: { value: '2026-09-12' } });
  fireEvent.change(screen.getByLabelText('Slug'), { target: { value: 'revision-a' } });
  fireEvent.change(screen.getByLabelText('Hypothesis'), { target: { value: 'A bounded local planning hypothesis.' } });
  fireEvent.change(screen.getByLabelText('Intended metric'), { target: { value: 'profile visits per reached account' } });
}

const figmentGets = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.filter(([url]) => String(url) === '/api/figment');
const revisionPosts = (mock: ReturnType<typeof vi.fn>) => mock.mock.calls.filter(([url, init]) => String(url) === '/api/figment/studio/content-brief-revisions' && (init as RequestInit | undefined)?.method === 'POST');

describe('FigmentWorkspace content-brief revision composition', () => {
  it('offers only recorded creator-001 briefs as revision bases', async () => {
    const fetchImpl = vi.fn((url: string) => url === '/api/figment'
      ? response({ ...projection, contentBriefs: revisionBriefs() })
      : Promise.reject(new Error(`unexpected request: ${url}`)));
    render(<FigmentWorkspace token="session" fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    const select = await screen.findByLabelText('Base brief') as HTMLSelectElement;
    expect(Array.from(select.options, (option) => option.value)).toEqual(['creator001-base']);
    expect(Array.from(select.options, (option) => option.textContent).join(' ')).not.toContain('other-creator-base');
    expect(revisionPosts(fetchImpl)).toHaveLength(0);
  });

  it('never POSTs on mount, tab navigation, or a parent projection retry', async () => {
    let projectionCalls = 0;
    const fetchImpl = vi.fn((url: string) => {
      if (url !== '/api/figment') return Promise.reject(new Error(`unexpected request: ${url}`));
      projectionCalls += 1;
      return projectionCalls === 1
        ? Promise.reject(new Error('synthetic projection interruption'))
        : response({ ...projection, contentBriefs: revisionBriefs() });
    });
    render(<FigmentWorkspace token="session" fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await screen.findByText('Figment records are unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    await screen.findByLabelText('Base brief');
    fireEvent.click(screen.getByRole('tab', { name: 'Creators' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    await screen.findByLabelText('Base brief');
    expect(figmentGets(fetchImpl)).toHaveLength(2);
    expect(revisionPosts(fetchImpl)).toHaveLength(0);
  });

  it('keeps a successful POST local until an explicit refresh gets the current-token inventory', async () => {
    let projectionCalls = 0;
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/api/figment') {
        projectionCalls += 1;
        return response({ ...projection, contentBriefs: revisionBriefs(projectionCalls > 1) });
      }
      if (url === '/api/figment/studio/content-brief-revisions') return response(revisionSuccess);
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });
    render(<FigmentWorkspace token="current-session" fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    await screen.findByLabelText('Base brief');
    fillRevisionForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create local planning revision' }));
    await screen.findByText(`Local planning revision created: ${revisionSuccess.briefId}.`);
    expect(figmentGets(fetchImpl)).toHaveLength(1);
    expect(revisionPosts(fetchImpl)).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh recorded briefs' }));
    await waitFor(() => expect(figmentGets(fetchImpl)).toHaveLength(2));
    expect(figmentGets(fetchImpl)[1]?.[1]).toEqual({ headers: { authorization: 'Bearer current-session' } });
    expect(await screen.findByRole('option', { name: /2026-09-12-creator-001-revision-a/ })).toBeTruthy();
    expect(revisionPosts(fetchImpl)).toHaveLength(1);
  });

  it('hides an old-token pending revision completion and never posts under the replacement token', async () => {
    let resolvePost!: (value: Response) => void;
    const pendingPost = new Promise<Response>((resolve) => { resolvePost = resolve; });
    const fetchImpl = vi.fn((url: string) => {
      if (url === '/api/figment') return response({ ...projection, contentBriefs: revisionBriefs() });
      if (url === '/api/figment/studio/content-brief-revisions') return pendingPost;
      return Promise.reject(new Error(`unexpected request: ${url}`));
    });
    const view = render(<FigmentWorkspace token="old-session" fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Research' }));
    await screen.findByLabelText('Base brief');
    fillRevisionForm();
    fireEvent.click(screen.getByRole('button', { name: 'Create local planning revision' }));
    expect(revisionPosts(fetchImpl)).toHaveLength(1);
    expect(new Headers((revisionPosts(fetchImpl)[0]?.[1] as RequestInit).headers).get('authorization')).toBe('Bearer old-session');
    view.rerender(<FigmentWorkspace token="new-session" fetchImpl={fetchImpl as unknown as typeof fetch} />);
    await waitFor(() => expect(figmentGets(fetchImpl)).toHaveLength(2));
    await act(async () => { resolvePost(await response(revisionSuccess)); });
    expect(screen.queryByText(`Local planning revision created: ${revisionSuccess.briefId}.`)).toBeNull();
    expect(revisionPosts(fetchImpl)).toHaveLength(1);
    expect(revisionPosts(fetchImpl).every(([, init]) => new Headers((init as RequestInit).headers).get('authorization') === 'Bearer old-session')).toBe(true);
  });
});

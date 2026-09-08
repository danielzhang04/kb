// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FigmentWorkspace } from './FigmentWorkspace';

const projection = { schema: 'figment/hub@1' as const, available: true, creators: [{ id: 'creator-a', persona: 'valid' as const, loraTier: 'provisional', loraTrigger: null, accountTiers: ['instagram'] }], creatorsTruncated: false, records: [{ path: 'runs/a/run.json', type: 'run', creator: 'creator-a', reviewState: 'unknown' as const, machineGateState: 'current' as const, schema: 'figment/runpod-run@1' }], recordsTruncated: false, plans: { items: [{ path: 'runs/a/driver-plan.json', creator: 'creator-a', variant: 'studio-preview', stages: [{ name: 'train', runCount: 1, declaredCeilingUsd: 1.25 }, { name: 'tester', runCount: 2, declaredCeilingUsd: null }], declaredCeilingUsd: 1.25 }], truncated: false }, research: { available: true, artifacts: [{ area: 'book' as const, name: 'chapter.md', bytes: 2048, modifiedAt: '2026-09-08T00:00:00Z' }], truncated: false }, references: { items: [{ creator: 'creator-a', name: 'g01.jpg', bytes: 90, sha256: 'b'.repeat(64), width: 4, height: 3, modifiedAt: '2026-09-08T00:00:00Z' }], truncated: false }, generatedInputs: { available: false, items: [], truncated: false }, diagnostic: { status: 'diagnostic-not-promotable' as const, dryRun: false, podId: 'pod', artifacts: [], artifactsTruncated: false } };
const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

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

  it('normalizes an older hub response and rejects malformed local-training evidence', async () => {
    const oldHub = vi.fn(() => response(projection)) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={oldHub} />); await screen.findByText('creator-a'); fireEvent.click(screen.getByRole('tab', { name: 'Training readiness' }));
    expect(screen.getByText('No local training evidence source is configured.')).toBeTruthy(); cleanup();
    const malformed = vi.fn(() => response({ ...projection, localTraining: { status: 'recorded', historical: false } })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={malformed} />); await screen.findByText('Figment records are unavailable.');
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
});

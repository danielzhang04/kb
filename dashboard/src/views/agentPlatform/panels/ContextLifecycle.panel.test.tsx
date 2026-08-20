// @vitest-environment jsdom
/**
 * Context Lifecycle panel (Wave-1 U8).
 *
 * What these tests pin: the panel registers itself by file drop (no shared-file edit), it lists the
 * session stores the daemon reports, it opens one into its sections, it renders the U7 SEAM
 * sub-block — and only the two sections the re-grounding hook actually lifts — and each degraded
 * state gets its OWN named message.
 *
 * The empty state is load-bearing here in a way it is not for most panels: the hooks are inert, so on
 * an unarmed machine the honest answer is "no stores yet, because nothing is armed". A blank panel
 * would read as a broken fetch, so the wording is asserted, not just the absence of rows.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AGENT_PLATFORM_PANELS } from '../registry';
import { panel } from './ContextLifecycle.panel';

/**
 * Paths are resolved from the vitest root (the `dashboard/` directory) rather than
 * `import.meta.url`: under the jsdom environment this file's `import.meta.url` is not a `file:` URL,
 * so `fileURLToPath` throws at module load.
 */
const REPO_ROOT = resolve(process.cwd(), '..');
/** The committed U7 hook — the authority on which sections re-grounding actually injects. */
const REGROUNDING_HOOK = resolve(REPO_ROOT, 'scripts/hooks/regrounding_hook.js');
const PANEL_SOURCE = resolve(process.cwd(), 'src/views/agentPlatform/panels/ContextLifecycle.panel.tsx');

const SESSIONS = [
  { sessionId: 'session-alpha', modifiedAt: '2026-08-18T04:00:00.000Z', bytes: 512 },
  { sessionId: 'session-beta', modifiedAt: '2026-08-17T22:00:00.000Z', bytes: 128 },
];

const STORE = {
  sessionId: 'session-alpha',
  modifiedAt: '2026-08-18T04:00:00.000Z',
  sections: [
    { heading: 'North star', body: 'Ship the Wave-1 platform slice.' },
    { heading: 'Invariants', body: 'Never spend real money.' },
    { heading: 'Resumed-session summary', body: '- user: pick the run back up' },
    { heading: 'Recent activity', body: '- Bash git status' },
  ],
};

/** Route the two endpoints; anything else is a test bug, not a 404 to swallow. */
function mockFetch(handlers: { list?: unknown; listStatus?: number; store?: unknown; storeStatus?: number }) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === '/api/context-lifecycle') {
      const status = handlers.listStatus ?? 200;
      return { ok: status < 400, status, json: async () => handlers.list } as Response;
    }
    if (url.startsWith('/api/context-lifecycle/')) {
      const status = handlers.storeStatus ?? 200;
      return { ok: status < 400, status, json: async () => handlers.store } as Response;
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

beforeEach(() => {
  vi.stubGlobal('fetch', mockFetch({ list: { available: true, storeRoot: 'C:/store', sessions: SESSIONS }, store: STORE }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Render the panel through its own `render`, the same call the section shell makes. */
async function renderPanel() {
  render(panel.render() as React.JSX.Element);
  return screen.findByTestId;
}

describe('ContextLifecycle panel', () => {
  it('registers itself in the panel registry by file drop', () => {
    expect(panel.id).toBe('context-lifecycle');
    expect(AGENT_PLATFORM_PANELS.map((p) => p.id)).toContain('context-lifecycle');
    const registered = AGENT_PLATFORM_PANELS.find((p) => p.id === 'context-lifecycle');
    expect(registered?.title).toBe(panel.title);
  });

  it('pins the seam headings against the committed re-grounding hook', () => {
    /**
     * The seam sub-block claims to show what `regrounding_hook.js` injects. That claim is only true
     * while the panel's headings match that hook's WANTED_SECTIONS, so the array is read out of the
     * hook source rather than restated here. Reading the declaration (not just grepping for the two
     * strings) is what catches a THIRD section being added to U7 — the case where the panel would
     * quietly start under-reporting.
     */
    const source = readFileSync(REGROUNDING_HOOK, 'utf8');
    const declaration = /const WANTED_SECTIONS\s*=\s*\[([^\]]*)\]/.exec(source);
    expect(declaration, 'WANTED_SECTIONS not found in regrounding_hook.js').toBeTruthy();
    const wanted = Array.from(declaration![1].matchAll(/"([^"]+)"/g)).map((m) => m[1]);
    expect(wanted).toEqual(['North star', 'Invariants']);

    // Every heading the seam block renders, in the hook's own emission order.
    const seamHeadings = Array.from(
      readFileSync(PANEL_SOURCE, 'utf8')
        .match(/const REGROUNDING_HEADINGS = \[([^\]]*)\]/)![1]
        .matchAll(/'([^']+)'/g),
    ).map((m) => m[1]);
    expect(seamHeadings).toEqual(wanted);
  });

  it('lists the session stores the daemon reports', async () => {
    await renderPanel();
    expect(await screen.findByTestId('ap-ctxlife-row-session-alpha')).toBeTruthy();
    expect(screen.getByTestId('ap-ctxlife-row-session-beta')).toBeTruthy();
    expect(screen.queryByTestId('ap-ctxlife-empty')).toBeNull();
  });

  it('opens a store into its sections', async () => {
    await renderPanel();
    fireEvent.click(await screen.findByTestId('ap-ctxlife-row-session-alpha'));
    const full = await screen.findByTestId('ap-ctxlife-full');
    for (const heading of ['North star', 'Invariants', 'Resumed-session summary', 'Recent activity']) {
      expect(full.textContent).toContain(heading);
    }
    expect(full.textContent).toContain('- Bash git status');
  });

  it('renders the U7 seam sub-block with ONLY the sections re-grounding lifts', async () => {
    await renderPanel();
    fireEvent.click(await screen.findByTestId('ap-ctxlife-row-session-alpha'));
    const seam = await screen.findByTestId('ap-ctxlife-seam');
    expect(seam.textContent).toContain('What re-grounding injects');
    expect(seam.textContent).toContain('Ship the Wave-1 platform slice.');
    expect(seam.textContent).toContain('Never spend real money.');
    // The summary and the activity buffer are NOT what the re-grounding hook injects.
    expect(seam.textContent).not.toContain('pick the run back up');
    expect(seam.textContent).not.toContain('Bash git status');
  });

  it('says so when a store has nothing the re-grounding hook would lift', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({
        list: { available: true, storeRoot: 'C:/store', sessions: SESSIONS },
        store: { ...STORE, sections: [{ heading: 'Recent activity', body: '- Bash ls' }] },
      }),
    );
    await renderPanel();
    fireEvent.click(await screen.findByTestId('ap-ctxlife-row-session-alpha'));
    expect((await screen.findByTestId('ap-ctxlife-seam-empty')).textContent).toContain(
      'would inject nothing',
    );
  });

  it('states the honest empty answer when no store exists — the inert-hooks state', async () => {
    vi.stubGlobal('fetch', mockFetch({ list: { available: false, storeRoot: 'C:/store', sessions: [] } }));
    await renderPanel();
    const empty = await screen.findByTestId('ap-ctxlife-empty');
    expect(empty.textContent).toContain('No session stores yet');
    expect(empty.textContent).toContain('inert until armed');
    expect(empty.textContent).toContain('docs/proposals/context-lifecycle-hooks.md');
  });

  it('names a failed listing rather than rendering an empty list', async () => {
    vi.stubGlobal('fetch', mockFetch({ listStatus: 500, list: null }));
    await renderPanel();
    expect((await screen.findByTestId('ap-ctxlife-unavailable')).textContent).toContain(
      '/api/context-lifecycle',
    );
    expect(screen.queryByTestId('ap-ctxlife-empty')).toBeNull();
  });

  it('names a failed store read separately from a failed listing', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetch({ list: { available: true, storeRoot: 'C:/store', sessions: SESSIONS }, storeStatus: 404, store: null }),
    );
    await renderPanel();
    fireEvent.click(await screen.findByTestId('ap-ctxlife-row-session-alpha'));
    expect((await screen.findByTestId('ap-ctxlife-store-error')).textContent).toContain('could not be read');
    // The back affordance survives the failure, so the operator is never stranded on it.
    fireEvent.click(screen.getByTestId('ap-ctxlife-back'));
    expect(await screen.findByTestId('ap-ctxlife-row-session-beta')).toBeTruthy();
  });

  it('shows a loading state before the listing resolves', () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => {})));
    render(panel.render() as React.JSX.Element);
    expect(screen.getByTestId('ap-ctxlife-loading')).toBeTruthy();
  });
});

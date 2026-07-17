// @vitest-environment jsdom
/**
 * U3 — Projects view. Pins the landing→browse→back flow: one card per org from the scoped `orgs/`
 * tree, clicking a card enters the shared folder browse of that org, and the breadcrumb returns to
 * the grid. fetch is stubbed so no real /api/kb server, git, or checkout is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Projects } from './Projects';

function jsonOk(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response);
}

const ORG_SUBTREES: Record<string, Array<{ name: string; path: string; type: 'dir' | 'file' }>> = {
  'orgs/faceless-youtube': [
    { name: 'STATE.md', path: 'orgs/faceless-youtube/STATE.md', type: 'file' },
    { name: '_index.md', path: 'orgs/faceless-youtube/_index.md', type: 'file' },
    { name: 'videos', path: 'orgs/faceless-youtube/videos', type: 'dir' },
  ],
  'orgs/atlas': [{ name: '_index.md', path: 'orgs/atlas/_index.md', type: 'file' }],
};

function stubFetch(): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const path = decodeURIComponent(new URL(url, 'http://x').searchParams.get('path') ?? '');
    if (url.startsWith('/api/kb/tree')) {
      if (path === 'orgs') {
        return jsonOk({
          path: 'orgs',
          entries: [
            { name: 'atlas', path: 'orgs/atlas', type: 'dir' },
            { name: 'faceless-youtube', path: 'orgs/faceless-youtube', type: 'dir' },
          ],
        });
      }
      return jsonOk({ path, entries: ORG_SUBTREES[path] ?? [] });
    }
    if (url.startsWith('/api/kb/file')) return jsonOk({ path, content: '# doc' });
    if (url.startsWith('/api/kb/history')) return jsonOk({ path, commits: [] });
    return Promise.reject(new Error(`unexpected url ${url}`));
  }) as typeof fetch;
}

beforeEach(stubFetch);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Projects', () => {
  it('renders one card per org from the scoped orgs/ tree', async () => {
    render(<Projects />);
    await screen.findByRole('button', { name: /faceless-youtube/ });
    expect(screen.getByRole('button', { name: /atlas/ })).toBeTruthy();
    // Two org dirs in the fixture → exactly two project cards, nothing else clickable.
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('enters the folder browse on card click and the breadcrumb returns to the grid', async () => {
    render(<Projects />);
    const card = await screen.findByRole('button', { name: /faceless-youtube/ });
    fireEvent.click(card);

    // Folder browse of the org: its subtree renders (STATE.md tree node) + breadcrumb present.
    await screen.findByLabelText('Breadcrumb');
    await waitFor(() => expect(screen.getByRole('button', { name: /STATE\.md/ })).toBeTruthy());

    // Breadcrumb back → the all-projects grid returns.
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }));
    await waitFor(() => expect(screen.getByRole('button', { name: /atlas/ })).toBeTruthy());
    expect(screen.getByRole('button', { name: /faceless-youtube/ })).toBeTruthy();
  });
});

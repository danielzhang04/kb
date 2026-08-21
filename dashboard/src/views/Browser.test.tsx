// @vitest-environment jsdom
/**
 * U3 — Files view (restyled Browser over the shared FolderView). These tests pin the read-only
 * behaviour the restyle must preserve: the tree lists the KB root, selecting a file renders its
 * markdown in reading mode, and the selected node wears the single left-border accent class.
 * fetch is stubbed so no real /api/kb server, git, or checkout is touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Browser } from './Browser';
import { fileUrl, historyUrl, treeUrl } from './folderView';

function jsonOk(body: unknown): Promise<Response> {
  return Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  } as Response);
}

/** Route stubbed /api/kb/* GETs by the decoded `path` query param. */
function stubFetch(): void {
  globalThis.fetch = vi.fn((input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    const path = decodeURIComponent(new URL(url, 'http://x').searchParams.get('path') ?? '');
    if (url.startsWith('/api/kb/tree')) {
      if (path === '') {
        return jsonOk({
          path: '',
          entries: [
            { name: 'orgs', path: 'orgs', type: 'dir' },
            { name: 'README.md', path: 'README.md', type: 'file' },
          ],
        });
      }
      return jsonOk({ path, entries: [] });
    }
    if (url.startsWith('/api/kb/file')) {
      return jsonOk({ path, content: '# Hello KB\n\nA reading-mode paragraph.' });
    }
    if (url.startsWith('/api/kb/history')) {
      return jsonOk({ path, commits: [] });
    }
    return Promise.reject(new Error(`unexpected url ${url}`));
  }) as typeof fetch;
}

beforeEach(stubFetch);
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Files (Browser)', () => {
  it('encodes every path exactly once and round-trips hostile-looking names', () => {
    for (const path of ['two words', 'hash#mark', 'question?mark', 'percent%mark', 'embedded/slash', '../x']) {
      for (const url of [treeUrl(path), fileUrl(path), historyUrl(path)]) {
        const rawQuery = url.split('=')[1];
        expect(rawQuery).toBe(encodeURIComponent(path));
        expect(new URL(url, 'http://x').searchParams.get('path')).toBe(path);
      }
    }
  });

  it('lists the KB root tree (behavior preserved)', async () => {
    render(<Browser />);
    expect(await screen.findByRole('button', { name: /README\.md/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /orgs/ })).toBeTruthy();
  });

  it('renders markdown in reading mode and marks the selected node with the left-border accent class', async () => {
    render(<Browser />);
    const fileBtn = await screen.findByRole('button', { name: /README\.md/ });
    fireEvent.click(fileBtn);

    // Markdown rendered-first: the h1 comes through the safe renderer.
    const rendered = await screen.findByTestId('folder-markdown');
    await waitFor(() => expect(rendered.innerHTML).toContain('<h1>Hello KB</h1>'));

    // Active node wears the single left-border accent language.
    expect(fileBtn.className).toContain('v-folder__row--active');
    expect(fileBtn.getAttribute('aria-current')).toBe('true');
  });
});

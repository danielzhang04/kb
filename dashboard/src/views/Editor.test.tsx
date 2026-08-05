// @vitest-environment jsdom
/**
 * D2.5 — CodeMirror 6 editor + governed save. `save` is injected so these tests never touch a real
 * server, WebAuthn session, or git checkout — they only assert the component wires the doc content
 * and the point-of-action bearer through to `save` and renders the outcome.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Editor } from './Editor';
import type { SaveFn } from './Editor';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

afterEach(() => {
  cleanup();
  clearStoredSession();
});

describe('Editor', () => {
  it('mounts CodeMirror with the initial content and saves the edited doc through the injected save fn', async () => {
    const calls: Array<{ relpath: string; content: string; sessionToken: string | undefined }> = [];
    const save: SaveFn = vi.fn(async (relpath, content, sessionToken) => {
      calls.push({ relpath, content, sessionToken });
      return { ok: true, target: 'durable' as const };
    });

    persistSession({ token: 'tok-123', expiresAt: Date.now() + 60_000 });
    render(
      <SessionProvider>
        <Editor
          relpath="skills/curated/alpha-skill/SKILL.md"
          initialContent="# alpha skill"
          save={save}
        />
      </SessionProvider>,
    );

    // CodeMirror rendered the seeded doc into the surface.
    const surface = screen.getByTestId('editor-surface');
    await waitFor(() => expect(surface.textContent).toContain('alpha skill'));

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].relpath).toBe('skills/curated/alpha-skill/SKILL.md');
    expect(calls[0].content).toContain('alpha skill');
    expect(calls[0].sessionToken).toBe('tok-123');

    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Saved'));
  });

  it('surfaces a failed save (e.g. 401 without a session) instead of silently succeeding', async () => {
    const save: SaveFn = vi.fn(async () => ({ ok: false, status: 401, reason: 'invalid session: expired' }));

    persistSession({ token: 'tok-123', expiresAt: Date.now() + 60_000 });
    render(
      <SessionProvider>
        <Editor relpath="docs/notes.md" initialContent="notes" save={save} />
      </SessionProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/invalid session/));
  });
});

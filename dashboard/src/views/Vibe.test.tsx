// @vitest-environment jsdom
/**
 * D2.7 — vibe-code chat box view. `stream` is injected (mirrors `Editor.test.tsx`'s `SaveFn` DI) so
 * these tests never touch a real network, a real WebAuthn session, or a real `claude` process — they
 * only assert the component wires the prompt/point-of-action bearer through to `stream`, renders live deltas
 * through the shared `Timeline`, and surfaces a refusal instead of silently proceeding.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { Vibe, defaultVibeStream } from './Vibe';
import type { VibeStreamFn } from './Vibe';
import type { TimelineModel } from '../lib/timelineModel';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

afterEach(() => {
  cleanup();
  clearStoredSession();
});

/** The one unlock: a stored fresh bearer the provider reads on mount. */
function renderUnlocked(ui: React.ReactElement, token = 'tok-abc'): void {
  persistSession({ token, expiresAt: Date.now() + 60_000 });
  render(<SessionProvider>{ui}</SessionProvider>);
}

const ASSISTANT_TEXT = (text: string): TimelineModel => ({
  turns: [{ index: 0, model: 'claude-sonnet-5', timestamp: null, usage: null, steps: [{ kind: 'text', text }] }],
});

describe('Vibe', () => {
  it('never calls stream when the point-of-action ceremony is refused', async () => {
    const stream: VibeStreamFn = vi.fn();
    render(
      <SessionProvider deps={{ signIn: async () => { throw new Error('refused'); } }}>
        <Vibe stream={stream} />
      </SessionProvider>,
    );

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'do a thing' } });
    fireEvent.submit(screen.getByLabelText('Vibe prompt'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/dashboard is locked/i));
    expect(stream).not.toHaveBeenCalled();
  });

  it('disables Send for an empty/whitespace-only prompt even with a session', () => {
    const stream: VibeStreamFn = vi.fn();
    renderUnlocked(<Vibe stream={stream} />, 'tok-123');
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: '   ' } });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('POSTs the prompt through the injected stream with the bearer session token, and renders live deltas via Timeline', async () => {
    const calls: Array<{ prompt: string; sessionToken: string | undefined }> = [];
    const stream: VibeStreamFn = vi.fn(async (prompt, sessionToken, onDelta) => {
      calls.push({ prompt, sessionToken });
      onDelta(ASSISTANT_TEXT('hello from vibe'));
      return { ok: true };
    });

    renderUnlocked(<Vibe stream={stream} />);
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'summarize the repo' } });
    fireEvent.submit(screen.getByLabelText('Vibe prompt'));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ prompt: 'summarize the repo', sessionToken: 'tok-abc' });

    // The delta the injected stream pushed rendered through the shared Timeline component.
    await waitFor(() => expect(screen.getByText('hello from vibe')).toBeTruthy());
  });

  it('surfaces a refused spawn (e.g. fleet-frozen / rate-limited) instead of silently proceeding', async () => {
    const stream: VibeStreamFn = vi.fn(async () => ({ ok: false, status: 429, reason: 'locked-out' }));
    renderUnlocked(<Vibe stream={stream} />);

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByLabelText('Vibe prompt'));

    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/locked-out/));
  });

  it('Stop aborts the in-flight stream via the signal and disables further Stop clicks', async () => {
    let capturedSignal: AbortSignal | undefined;
    let resolveStream: (() => void) | undefined;
    const stream: VibeStreamFn = vi.fn(
      (_prompt, _token, _onDelta, signal) =>
        new Promise<{ ok: false; reason: string }>((resolve) => {
          capturedSignal = signal;
          resolveStream = () => resolve({ ok: false, reason: 'stopped' });
        }),
    );

    renderUnlocked(<Vibe stream={stream} />);
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'long running thing' } });
    fireEvent.submit(screen.getByLabelText('Vibe prompt'));

    await waitFor(() =>
      expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));

    expect(capturedSignal?.aborted).toBe(true);
    resolveStream?.();

    await waitFor(() => expect(screen.getByTestId('vibe-status').textContent).toBe('stopped'));
    expect((screen.getByRole('button', { name: 'Stop' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('defaultVibeStream (real fetch + stream-json line parsing)', () => {
  afterEach(() => vi.unstubAllGlobals());

  function fakeStreamingResponse(lines: string[], opts: { ok?: boolean; status?: number } = {}): Response {
    const chunks = lines.map((l) => `${l}\n`);
    let i = 0;
    const encoder = new TextEncoder();
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      statusText: 'OK',
      json: () => Promise.resolve({}),
      body: {
        getReader: () => ({
          read: () => {
            if (i >= chunks.length) return Promise.resolve({ value: undefined, done: true });
            const value = encoder.encode(chunks[i]);
            i += 1;
            return Promise.resolve({ value, done: false });
          },
        }),
      },
    } as unknown as Response;
  }

  it('parses stream-json lines from the response body into folded TimelineModel deltas', async () => {
    const lines = [
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'first' }] } }),
      'not json, dropped defensively',
      JSON.stringify({ type: 'assistant', message: { model: 'claude-sonnet-5', content: [{ type: 'text', text: 'second' }] } }),
    ];
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(fakeStreamingResponse(lines))));

    const deltas: TimelineModel[] = [];
    const controller = new AbortController();
    const outcome = await defaultVibeStream('hi', 'tok-1', (m) => deltas.push(m), controller.signal);

    expect(outcome).toEqual({ ok: true });
    expect(deltas).toHaveLength(2);
    expect(deltas[1].turns).toHaveLength(2);
  });

  it('surfaces a non-ok response as a refusal reason without throwing', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          json: () => Promise.resolve({ reason: 'invalid session: expired' }),
        } as unknown as Response),
      ),
    );

    const controller = new AbortController();
    const outcome = await defaultVibeStream('hi', undefined, () => {}, controller.signal);
    expect(outcome).toEqual({ ok: false, status: 401, reason: 'invalid session: expired' });
  });
});

// @vitest-environment jsdom
/**
 * C1 — the Composer multi-turn chat pane. `stream` is injected (mirrors `Vibe.test.tsx`'s DI) so these
 * tests never touch a real network, session, or `claude` process. The load-bearing behaviour is the
 * multi-turn thread: the CLI session id captured on turn N is fed back in as turn N+1's `resumeId`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ComposerChat } from './ComposerChat';
import type { ComposerStreamFn } from './chatClient';
import type { TimelineModel } from '../lib/timelineModel';

afterEach(() => cleanup());

const REPLY = (text: string): TimelineModel => ({
  turns: [{ index: 0, model: 'claude-sonnet-5', timestamp: null, usage: null, steps: [{ kind: 'text', text }] }],
});

describe('ComposerChat', () => {
  it('disables Send without a sessionToken and never calls stream', () => {
    const stream: ComposerStreamFn = vi.fn();
    render(<ComposerChat stream={stream} />);
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'an idea' } });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText('Composer prompt'));
    expect(stream).not.toHaveBeenCalled();
  });

  it('signs in at point of action and preserves the drafted prompt', async () => {
    const onRequestSession = vi.fn(async () => ({ token: 'fresh-token', expiresAt: Date.now() + 60_000 }));
    const stream: ComposerStreamFn = vi.fn(async () => ({ ok: true }));
    render(<ComposerChat onRequestSession={onRequestSession} stream={stream} />);

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'keep this draft' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with your passkey' }));
    await waitFor(() => expect(onRequestSession).toHaveBeenCalledTimes(1));
    await waitFor(() => expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false));

    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('keep this draft');
    fireEvent.submit(screen.getByLabelText('Composer prompt'));
    await waitFor(() => expect(stream).toHaveBeenCalledTimes(1));
    expect(stream).toHaveBeenCalledWith(
      'keep this draft',
      undefined,
      'fresh-token',
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('surfaces a point-of-action sign-in failure without sending', async () => {
    const onRequestSession = vi.fn(async () => null);
    const stream: ComposerStreamFn = vi.fn();
    render(<ComposerChat onRequestSession={onRequestSession} stream={stream} />);

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'still here' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with your passkey' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/sign-in failed/i));
    expect((screen.getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe('still here');
    expect(stream).not.toHaveBeenCalled();
  });

  it('threads the captured resumeId from turn 1 into turn 2', async () => {
    const calls: Array<{ prompt: string; resumeId: string | undefined }> = [];
    const stream: ComposerStreamFn = vi.fn(async (prompt, resumeId, _token, onDelta) => {
      calls.push({ prompt, resumeId });
      onDelta(REPLY(`reply to ${prompt}`));
      return { ok: true, resumeId: `sess-${calls.length}` };
    });
    render(<ComposerChat sessionToken="tok" stream={stream} />);

    // Turn 1: no prior session id.
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'first' } });
    fireEvent.submit(screen.getByLabelText('Composer prompt'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual({ prompt: 'first', resumeId: undefined });
    await screen.findByText('reply to first');

    // Turn 2: carries turn 1's captured id.
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'second' } });
    fireEvent.submit(screen.getByLabelText('Composer prompt'));
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual({ prompt: 'second', resumeId: 'sess-1' });
    await screen.findByText('reply to second');
  });

  it('surfaces a refused turn instead of silently proceeding', async () => {
    const stream: ComposerStreamFn = vi.fn(async () => ({ ok: false, status: 429, reason: 'locked-out' }));
    render(<ComposerChat sessionToken="tok" stream={stream} />);
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'x' } });
    fireEvent.submit(screen.getByLabelText('Composer prompt'));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/locked-out/));
  });

  it('aborts the active request when Composer unmounts', async () => {
    let activeSignal: AbortSignal | undefined;
    const stream: ComposerStreamFn = vi.fn((_prompt, _resumeId, _token, _onDelta, signal) => {
      activeSignal = signal;
      return new Promise<never>(() => {});
    });
    const view = render(<ComposerChat sessionToken="tok" stream={stream} />);

    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'long research' } });
    fireEvent.submit(screen.getByLabelText('Composer prompt'));
    await waitFor(() => expect(activeSignal).toBeDefined());
    expect(activeSignal?.aborted).toBe(false);

    view.unmount();
    expect(activeSignal?.aborted).toBe(true);
  });
});

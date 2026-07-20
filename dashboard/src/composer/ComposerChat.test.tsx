// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ComposerChat } from './ComposerChat';
import type { ComposerSession, ComposerStreamFn } from './workspaceClient';
import type { TimelineModel } from '../lib/timelineModel';

afterEach(cleanup);

const MODEL: TimelineModel = {
  turns: [{ index: 0, model: 'claude', timestamp: null, usage: null, steps: [{ kind: 'text', text: 'A useful answer' }] }],
};

const SESSION: ComposerSession = {
  composerRef: 'cw_alpha', title: 'Atlas idea', state: 'open', createdAt: 'now', updatedAt: 'now', sourceComposerRef: null,
  turns: [{ turnId: 't1', prompt: 'Earlier question', state: 'complete', model: MODEL, error: null, startedAt: 'now', endedAt: 'now' }],
};

describe('ComposerChat workspace', () => {
  it('shows server history including user prompts and no provider identifiers', () => {
    render(<ComposerChat composerSession={SESSION} sessionToken="tok" />);
    expect(screen.getByText('Earlier question')).toBeTruthy();
    expect(screen.getByText('A useful answer')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/resumeId|sessionId/);
  });

  it('uses one primary control that changes from Send to Stop while running', async () => {
    let finish: (() => void) | undefined;
    const stream: ComposerStreamFn = (_ref, _prompt, _token, onDelta) => new Promise((resolve) => {
      onDelta(MODEL);
      finish = () => resolve({ ok: true });
    });
    render(<ComposerChat composerSession={{ ...SESSION, turns: [] }} sessionToken="tok" stream={stream} />);
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Plan Atlas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByRole('button', { name: 'Stop' });
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    expect(screen.getByText('Plan Atlas')).toBeTruthy();
    expect(screen.getByText('A useful answer')).toBeTruthy();
    finish?.();
    await screen.findByRole('button', { name: 'Send' });
  });

  it('reports live running state to the workspace tab host', async () => {
    const onRunningChange = vi.fn();
    let finish: (() => void) | undefined;
    const stream: ComposerStreamFn = () => new Promise((resolve) => {
      finish = () => resolve({ ok: true });
    });
    render(<ComposerChat
      composerSession={{ ...SESSION, turns: [] }}
      sessionToken="tok"
      stream={stream}
      onRunningChange={onRunningChange}
    />);
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Long plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(onRunningChange).toHaveBeenCalledWith(true));
    finish?.();
    await waitFor(() => expect(onRunningChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByText(/do not paste passwords/i)).toBeTruthy();
  });

  it('aborts from the same Stop control', async () => {
    let signal: AbortSignal | undefined;
    const stream: ComposerStreamFn = (_ref, _prompt, _token, _delta, activeSignal) => {
      signal = activeSignal;
      return new Promise(() => {});
    };
    render(<ComposerChat composerSession={{ ...SESSION, turns: [] }} sessionToken="tok" stream={stream} />);
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Long task' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    await waitFor(() => expect(signal?.aborted).toBe(true));
    expect(screen.getByRole('status').textContent).toMatch(/Stopped/);
  });

  it('unlocks at send time and preserves the drafted prompt', async () => {
    const onRequestSession = vi.fn(async () => ({ token: 'fresh', expiresAt: Date.now() + 60_000 }));
    const stream: ComposerStreamFn = vi.fn(async () => ({ ok: true }));
    render(<ComposerChat composerSession={{ ...SESSION, turns: [] }} onRequestSession={onRequestSession} stream={stream} />);
    fireEvent.change(screen.getByLabelText('Prompt'), { target: { value: 'Keep me' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(stream).toHaveBeenCalledWith('cw_alpha', 'Keep me', 'fresh', expect.any(Function), expect.any(AbortSignal)));
  });
});

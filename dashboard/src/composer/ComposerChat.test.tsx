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
  composerRef: 'cw_alpha', title: 'Atlas idea', state: 'open', createdAt: 'now', updatedAt: 'now', sourceComposerRef: null, agent: null,
  turns: [{ turnId: 't1', prompt: 'Earlier question', state: 'complete', model: MODEL, error: null, startedAt: 'now', endedAt: 'now' }],
};

describe('ComposerChat workspace', () => {
  it('filters agent workflows, sends exact declared parameters, restores linked runs, and opens the cockpit', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/workflows') return { ok: true, json: async () => ({ items: [
        { ref: 'video-run', project: 'faceless-youtube', title: 'Video', profile: 'producer', sourceHash: 'b'.repeat(64), valid: true, stageCount: 2, parameters: ['channel', 'slug'], stages: [] },
        { ref: 'other', project: 'other', title: 'Other', profile: 'research', valid: true, stageCount: 1, parameters: [], stages: [] },
      ] }) } as Response;
      if (input === '/api/control/runs') return { ok: true, json: async () => ({ runs: [{ runRef: 'run-linked', state: 'waiting-human', agentWorkspaceLaunch: { composerRef: 'cw_agent', agentId: 'fyt-runner', declarationPath: 'agents/fyt-runner.md', declarationHash: 'a'.repeat(64) } }] }) } as Response;
      if (String(input) === '/api/workflows/video-run/launch') return { ok: true, json: async () => ({ runRef: 'run-new', waitingHuman: true, activationGated: true }) } as Response;
      throw new Error(`unexpected ${String(input)}`);
    });
    const onOpenRun = vi.fn();
    render(<ComposerChat composerSession={{ ...SESSION, composerRef: 'cw_agent', agent: { id: 'fyt-runner', path: 'agents/fyt-runner.md', sourceHash: 'a'.repeat(64), projects: ['faceless-youtube'] } }} sessionToken="tok" fetchImpl={fetchImpl} onOpenRun={onOpenRun} />);
    expect(await screen.findByRole('option', { name: /Video/ })).toBeTruthy();
    expect(screen.queryByText('Other')).toBeNull();
    fireEvent.change(screen.getByLabelText('Workflow parameter channel'), { target: { value: 'the-second-take' } });
    fireEvent.change(screen.getByLabelText('Workflow parameter slug'), { target: { value: '2026-07-19-wells-fargo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Launch workflow' }));
    expect((await screen.findByText(/run-new.*activation is off.*waiting/i)).textContent).toMatch(/human requests/i);
    const launch = (fetchImpl.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit]>).find(([url]) => String(url).includes('/launch'))?.[1];
    expect(launch).toBeTruthy();
    if (!launch) return;
    expect(JSON.parse(launch.body as string)).toEqual({ idempotencyKey: expect.any(String), composerRef: 'cw_agent', expectedSourceHash: 'b'.repeat(64), parameters: { channel: 'the-second-take', slug: '2026-07-19-wells-fargo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Open run run-linked' }));
    expect(onOpenRun).toHaveBeenCalledWith('run-linked');
  });

  it('does not render a workflow launcher for unbound Composer workspaces', () => {
    render(<ComposerChat composerSession={SESSION} sessionToken="tok" />);
    expect(screen.queryByRole('button', { name: 'Launch workflow' })).toBeNull();
  });

  it('uses server pending-amendment truth to visibly disable a workflow launch', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (input === '/api/workflows') return { ok: true, json: async () => ({ items: [{ ref: 'video-run', project: 'faceless-youtube', title: 'Video', profile: 'producer', sourceHash: 'b'.repeat(64), valid: true, stageCount: 2, parameters: [], stages: [], pendingAmendment: { proposedSourceHash: 'c'.repeat(64), branch: 'claude/m1-dashboard', pr: {}, phase: 'prepared' } }] }) } as Response;
      if (input === '/api/control/runs') return { ok: true, json: async () => ({ runs: [] }) } as Response;
      throw new Error(`unexpected ${String(input)}`);
    });
    render(<ComposerChat composerSession={{ ...SESSION, composerRef: 'cw_agent', agent: { id: 'fyt-runner', path: 'agents/fyt-runner.md', sourceHash: 'a'.repeat(64), projects: ['faceless-youtube'] } }} sessionToken="tok" fetchImpl={fetchImpl} />);
    expect((await screen.findByTestId('agent-workspace-pending-amendment')).textContent).toMatch(/recovery is required/i);
    expect((screen.getByRole('button', { name: 'Launch workflow' }) as HTMLButtonElement).disabled).toBe(true);
    expect((fetchImpl.mock.calls as unknown as Array<[RequestInfo | URL]>).some(([url]) => String(url).includes('/launch'))).toBe(false);
  });
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

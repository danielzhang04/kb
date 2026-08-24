// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SessionWorkspaceModel } from '../console/sessionWorkspaceModel.ts';
import { TerminalSessionHeader } from './TerminalSessionHeader.tsx';

afterEach(cleanup);

const model: SessionWorkspaceModel = {
  availability: {
    kind: 'available',
    hostLabel: 'Desktop',
    launchers: ['shell', 'claude', 'codex'],
    roots: ['repo', 'worktrees'],
  },
  sessions: [
    {
      sessionId: 'pty-11111111111111111111111111111111',
      name: 'Builder',
      host: 'desktop',
      launcher: 'shell',
      rootId: 'repo',
      cwd: '',
      state: 'live',
      attachmentCount: 1,
      attachmentState: 'attached',
      startedAt: '2026-08-22T00:00:00.000Z',
      endedAt: null,
      exit: null,
    },
    {
      sessionId: 'pty-22222222222222222222222222222222',
      name: 'Review',
      host: 'vm',
      launcher: 'codex',
      rootId: 'worktrees',
      cwd: 'review',
      state: 'closing',
      attachmentCount: 0,
      attachmentState: 'detached',
      startedAt: '2026-08-22T00:01:00.000Z',
      endedAt: null,
      exit: null,
    },
  ],
  attachments: {},
  selectedSessionId: 'pty-11111111111111111111111111111111',
};

describe('TerminalSessionHeader', () => {
  // (a) Row copy intentionally widened: P3 \u00a78 requires "server-derived name/host/root/relative cwd"
  // to render, not just the name and state.
  it('renders server names in order with launcher, host, root, relative cwd, and human state copy', () => {
    render(<TerminalSessionHeader model={model} onSelectSession={() => undefined} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      'Builder \u00b7 Shell \u00b7 Desktop/repo \u00b7 Live',
      'Review \u00b7 Codex \u00b7 VM/worktrees/review \u00b7 Closing',
    ]);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    expect(tabs[1]?.getAttribute('aria-selected')).toBe('false');
    expect(document.body.textContent).not.toContain('pty-11111111111111111111111111111111');
  });

  it('selects a session by its opaque id without displaying the id', () => {
    const onSelectSession = vi.fn();
    render(<TerminalSessionHeader model={model} onSelectSession={onSelectSession} />);

    fireEvent.click(screen.getByRole('tab', { name: 'Review \u00b7 Codex \u00b7 VM/worktrees/review \u00b7 Closing' }));
    expect(onSelectSession).toHaveBeenCalledWith('pty-22222222222222222222222222222222');
  });
});

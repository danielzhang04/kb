// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { WorkspaceTabs } from './WorkspaceTabs';
import type { ComposerSession } from './workspaceClient';

afterEach(cleanup);

const session: ComposerSession = {
  composerRef: 'cw-live', title: 'Live plan', state: 'open', sourceComposerRef: null, agent: null,
  createdAt: 'now', updatedAt: 'now', turns: [],
};

describe('WorkspaceTabs live state', () => {
  it('shows the live running indicator and requires Stop before Close', () => {
    const onClose = vi.fn();
    render(<WorkspaceTabs
      open={[session]}
      recent={[]}
      archived={[]}
      activeRef="cw-live"
      runningRefs={new Set(['cw-live'])}
      busy={false}
      onNew={() => {}}
      onSelect={() => {}}
      onClose={onClose}
      onReopen={() => {}}
      onArchive={() => {}}
      onFork={() => {}}
      onRestore={() => {}}
    />);
    expect(screen.getByRole('tab', { name: 'Live plan' }).querySelector('.mc-status-dot--running')).toBeTruthy();
    const close = screen.getByRole('button', { name: 'Stop turn before closing Live plan' }) as HTMLButtonElement;
    expect(close.disabled).toBe(true);
    expect(onClose).not.toHaveBeenCalled();
  });
});

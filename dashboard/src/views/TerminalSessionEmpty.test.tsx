// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PtyProbeReason } from '../../shared/ptyProtocol.ts';
import {
  createSessionWorkspaceModel,
  type SessionWorkspaceAvailability,
} from '../console/sessionWorkspaceModel.ts';
import { TerminalSessionEmpty } from './TerminalSessionEmpty.tsx';

afterEach(cleanup);

const diagnosticDetail = '<script>x</script> /etc/passwd';
const diagnosticCases = [
  ['node-pty-unavailable', 'Terminal is not available on this host.'],
  ['shell-unavailable', 'Terminal is not available on this host.'],
  ['broker-unavailable', 'Terminal is unavailable right now.'],
  ['broker-identity-mismatch', 'Terminal access needs attention.'],
  ['root-policy-invalid', 'Terminal access needs attention.'],
  ['launcher-unavailable', 'Terminal is not available on this host.'],
] as const satisfies readonly (readonly [PtyProbeReason, string])[];

describe('TerminalSessionEmpty', () => {
  it('offers the three approved launchers when Terminal is available', () => {
    const onLaunch = vi.fn();
    const availability: SessionWorkspaceAvailability = {
      kind: 'available',
      hostLabel: 'VM',
      launchers: ['shell', 'claude', 'codex'],
      roots: ['repo', 'worktrees'],
    };

    render(
      <TerminalSessionEmpty
        availability={availability}
        onLaunch={onLaunch}
        onOpenHealth={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Start a session' })).toBeTruthy();
    expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Shell',
      'Claude',
      'Codex',
    ]);
    fireEvent.click(screen.getByRole('button', { name: 'Codex' }));
    expect(onLaunch).toHaveBeenCalledWith('codex');
  });

  it.each(diagnosticCases)('shows closed safe copy for %s without rendering diagnostics', (reason, message) => {
    const onOpenHealth = vi.fn();
    const model = createSessionWorkspaceModel({
      pty: false,
      diagnostic: { reason, detail: diagnosticDetail, checkedAt: '2026-08-22T00:00:00.000Z' },
    });

    render(
      <TerminalSessionEmpty
        availability={model.availability}
        onLaunch={() => undefined}
        onOpenHealth={onOpenHealth}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Terminal unavailable' })).toBeTruthy();
    expect(screen.getByText(message)).toBeTruthy();
    expect(JSON.stringify(model)).not.toContain(diagnosticDetail);
    expect(document.body.textContent).not.toContain(diagnosticDetail);
    fireEvent.click(screen.getByRole('button', { name: 'Open Health' }));
    expect(onOpenHealth).toHaveBeenCalledOnce();
  });
});

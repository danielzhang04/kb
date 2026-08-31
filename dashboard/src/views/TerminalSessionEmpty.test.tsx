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

  // (a) Behaviour intentionally changed per P3 §8 ("Unavailable shows bounded reason/detail and Health
  // link with literal `pty:false`") and the live browser evidence that the panel showed only the generic
  // sentence. The detail is now RENDERED; the security property it was guarding is restated as the two
  // assertions that matter — it lands as inert text, never as markup, and the reason enum is never copy.
  it.each(diagnosticCases)('shows closed safe copy plus the bounded host detail for %s', (reason, message) => {
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
    expect(screen.getByTestId('terminal-unavailable-detail').textContent).toBe(diagnosticDetail);
    // Inert text, never markup: a hostile detail contributes no element to the document.
    expect(document.querySelector('script')).toBeNull();
    // The closed probe reason is a code, not copy (ux-rules 13: "raw ids as names" is a violation).
    expect(document.body.textContent).not.toContain(reason);
    // The literal `pty:false` state P3 §8 requires, where a DOM assertion can read it.
    expect(screen.getByTestId('terminal-unavailable').getAttribute('data-pty-state')).toBe('pty:false');
    fireEvent.click(screen.getByRole('button', { name: 'Open Health' }));
    expect(onOpenHealth).toHaveBeenCalledOnce();
  });

  it('omits the detail paragraph when the host gave no sentence', () => {
    const model = createSessionWorkspaceModel({
      pty: false,
      diagnostic: { reason: 'node-pty-unavailable', detail: null, checkedAt: '' },
    });

    render(
      <TerminalSessionEmpty
        availability={model.availability}
        onLaunch={() => undefined}
        onOpenHealth={() => undefined}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Terminal unavailable' })).toBeTruthy();
    expect(screen.queryByTestId('terminal-unavailable-detail')).toBeNull();
  });
});

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createSessionWorkspaceModel } from '../console/sessionWorkspaceModel.ts';
import {
  decodeRuntimeCapabilities,
  RuntimeCapabilitiesProvider,
  UNAVAILABLE_RUNTIME_CAPABILITIES,
  useRuntimeCapabilities,
} from './runtimeCapabilities.tsx';

const CHECKED_AT = '2026-08-22T09:00:00.000Z';
const AVAILABLE = {
  pty: true, host: 'desktop', launchers: ['shell', 'claude', 'codex'], roots: ['repo', 'worktrees'],
  checkedAt: CHECKED_AT, localTranscripts: true, platform: 'win32', dashboardBridge: true,
};

function Probe(): ReactElement {
  const capabilities = useRuntimeCapabilities();
  return (
    <span data-testid="probe">
      {capabilities.pty === true ? 'pty' : `closed:${capabilities.diagnostic.reason}`}
    </span>
  );
}

afterEach(cleanup);

describe('decodeRuntimeCapabilities', () => {
  it('accepts the closed available capability and ignores the surrounding non-PTY payload', () => {
    expect(decodeRuntimeCapabilities(AVAILABLE)).toEqual({
      pty: true, host: 'desktop', launchers: ['shell', 'claude', 'codex'],
      roots: ['repo', 'worktrees'], checkedAt: CHECKED_AT, localTranscripts: true,
    });
  });

  it('accepts the closed unavailable capability with its diagnostic', () => {
    expect(decodeRuntimeCapabilities({
      pty: false, localTranscripts: false,
      diagnostic: { reason: 'broker-unavailable', detail: 'broker did not answer', checkedAt: CHECKED_AT },
    })).toEqual({
      pty: false, localTranscripts: false,
      diagnostic: { reason: 'broker-unavailable', detail: 'broker did not answer', checkedAt: CHECKED_AT },
    });
  });

  it('rejects a payload without the closed capability rather than reading a bare boolean', () => {
    // The retired OS boolean payload: `pty` alone carries no closed capability and must not decode.
    expect(decodeRuntimeCapabilities({ pty: false, localTranscripts: false })).toBe(null);
    expect(decodeRuntimeCapabilities({ pty: true, localTranscripts: false })).toBe(null);
    expect(decodeRuntimeCapabilities({ localTranscripts: false })).toBe(null);
    expect(decodeRuntimeCapabilities({ pty: 'true', localTranscripts: false })).toBe(null);
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, localTranscripts: 'yes' })).toBe(null);
    expect(decodeRuntimeCapabilities(null)).toBe(null);
    expect(decodeRuntimeCapabilities([AVAILABLE])).toBe(null);
  });

  it('decodes the available branch exactly and publishes droppedLaunchers to the browser', () => {
    // m1: only the six PTY members, the optional droppedLaunchers, and the declared non-PTY host
    // slice. An undeclared key is a payload nobody agreed to; a dropped launcher is the operator's
    // only trace of a tampered launcher tree and must reach the browser, not just Health.
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, sideChannel: 'anything' })).toBe(null);
    expect(decodeRuntimeCapabilities({
      ...AVAILABLE,
      droppedLaunchers: [{ launcher: 'codex', refusal: 'launcher-changed' }],
    })).toEqual({
      pty: true, host: 'desktop', launchers: ['shell', 'claude', 'codex'],
      roots: ['repo', 'worktrees'], checkedAt: CHECKED_AT, localTranscripts: true,
      droppedLaunchers: [{ launcher: 'codex', refusal: 'launcher-changed' }],
    });
    for (const bad of [
      [],
      [{ launcher: 'codex' }],
      [{ launcher: 'codex', refusal: 'because' }],
      [{ launcher: 'bash', refusal: 'launcher-changed' }],
      [{ launcher: 'codex', refusal: 'launcher-changed', detail: 'C:\shim.exe' }],
      [{ launcher: 'codex', refusal: 'launcher-changed' }, { launcher: 'codex', refusal: 'launcher-unavailable' }],
    ]) expect(decodeRuntimeCapabilities({ ...AVAILABLE, droppedLaunchers: bad })).toBe(null);
  });

  it('rejects an available capability that is not the exact closed shape', () => {
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, host: 'laptop' })).toBe(null);
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, launchers: ['shell', 'shell'] })).toBe(null);
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, launchers: ['claude', 'shell'] })).toBe(null);
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, launchers: ['bash'] })).toBe(null);
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, launchers: [] })).toBe(null);
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, roots: ['worktrees', 'repo'] })).toBe(null);
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, checkedAt: '' })).toBe(null);
  });

  it('rejects a diagnostic that is not the closed reason/detail/checkedAt triple', () => {
    const closed = (diagnostic: unknown): unknown => ({ pty: false, localTranscripts: false, diagnostic });
    expect(decodeRuntimeCapabilities(closed({ reason: 'nope', detail: null, checkedAt: CHECKED_AT }))).toBe(null);
    expect(decodeRuntimeCapabilities(closed({ reason: 'broker-unavailable', checkedAt: CHECKED_AT }))).toBe(null);
    expect(decodeRuntimeCapabilities(closed({
      reason: 'broker-unavailable', detail: null, checkedAt: CHECKED_AT, epochId: 'epoch-1',
    }))).toBe(null);
    expect(decodeRuntimeCapabilities(closed({
      reason: 'broker-unavailable', detail: 'a'.repeat(161), checkedAt: CHECKED_AT,
    }))).toBe(null);
    expect(decodeRuntimeCapabilities(closed({
      reason: 'broker-unavailable', detail: 'line\nbreak', checkedAt: CHECKED_AT,
    }))).toBe(null);
    expect(decodeRuntimeCapabilities(closed({ reason: 'broker-unavailable', detail: null, checkedAt: 7 }))).toBe(null);
  });

  it('accepts the never-checked sentinel on the refusal only, so its own fallback round-trips', () => {
    // A composition that never probed has no check time; the sentinel is the agreed representation,
    // shared with the server's NEVER_CHECKED_AT, and must survive this decoder.
    expect(decodeRuntimeCapabilities({
      pty: false, localTranscripts: false,
      diagnostic: { reason: 'broker-unavailable', detail: null, checkedAt: '' },
    })).toEqual(UNAVAILABLE_RUNTIME_CAPABILITIES);
    expect(decodeRuntimeCapabilities({
      ...UNAVAILABLE_RUNTIME_CAPABILITIES,
    })).toEqual(UNAVAILABLE_RUNTIME_CAPABILITIES);
    // An advertised terminal was always probed, so the sentinel stays refused on that branch.
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, checkedAt: '' })).toBe(null);
  });

  it('rejects an available payload that leaked a probe internal, closing the branch both ways', () => {
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, epochId: 'epoch-1' })).toBe(null);
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, transport: 'local-node-pty' })).toBe(null);
    expect(decodeRuntimeCapabilities({ ...AVAILABLE, available: true })).toBe(null);
    expect(decodeRuntimeCapabilities({
      ...AVAILABLE, diagnostic: { reason: 'broker-unavailable', detail: null, checkedAt: CHECKED_AT },
    })).toBe(null);
  });
});

describe('runtime capability context', () => {
  it('defaults to the closed unavailable capability, never an assumed terminal', () => {
    expect(UNAVAILABLE_RUNTIME_CAPABILITIES).toEqual({
      pty: false,
      diagnostic: { reason: 'broker-unavailable', detail: null, checkedAt: '' },
      localTranscripts: false,
    });
    render(<Probe />);
    expect(screen.getByTestId('probe').textContent).toBe('closed:broker-unavailable');
  });

  it('publishes the decoded capability to consumers', () => {
    const decoded = decodeRuntimeCapabilities(AVAILABLE);
    if (decoded === null) throw new Error('expected the available capability to decode');
    render(<RuntimeCapabilitiesProvider value={decoded}><Probe /></RuntimeCapabilitiesProvider>);
    expect(screen.getByTestId('probe').textContent).toBe('pty');
  });

  it('renders the closed unavailable workspace copy for the fallback capability', () => {
    const model = createSessionWorkspaceModel(UNAVAILABLE_RUNTIME_CAPABILITIES);
    expect(model.availability).toEqual({
      kind: 'unavailable',
      title: 'Terminal unavailable',
      message: 'Terminal is unavailable right now.',
      // (b) Assertion extended for a field the projector now carries. The fail-closed constant was
      // never probed, so it has no host sentence to show and its detail is null.
      detail: null,
      actionLabel: 'Open Health',
    });
  });

  it('carries the host\'s bounded detail from a decoded pty:false payload into the workspace copy', () => {
    const decoded = decodeRuntimeCapabilities({
      pty: false,
      diagnostic: {
        reason: 'broker-unavailable',
        detail: 'kb-shell-broker socket is not listening',
        checkedAt: '2026-08-22T00:00:00.000Z',
      },
      localTranscripts: false,
    });
    if (decoded === null) throw new Error('expected the closed capability to decode');
    const availability = createSessionWorkspaceModel(decoded).availability;
    expect(availability.kind === 'unavailable' && availability.detail)
      .toBe('kb-shell-broker socket is not listening');
  });
});

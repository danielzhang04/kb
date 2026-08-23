import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  invalidPtyProtocolVectors,
  validBrowserServerFrames,
} from '../../shared/ptyProtocolVectors.ts';
import type {
  AttemptSessionPublicRow,
  BrowserServerFrame,
  PublicPtyCapability,
  PtyProbeReason,
  SessionSummary,
} from '../../shared/ptyProtocol.ts';
import {
  createSessionWorkspaceModel,
  decodeBrowserServerFrame,
  projectRunSessionWorkspace,
  reduceSessionWorkspace,
} from './sessionWorkspaceModel.ts';

const capability: PublicPtyCapability = {
  pty: true,
  host: 'desktop',
  launchers: ['shell', 'claude', 'codex'],
  roots: ['repo', 'worktrees'],
  checkedAt: '2026-08-22T00:00:00.000Z',
};

const diagnosticDetail = '<script>x</script> /etc/passwd';
const diagnosticCases = [
  ['node-pty-unavailable', 'Terminal is not available on this host.'],
  ['shell-unavailable', 'Terminal is not available on this host.'],
  ['broker-unavailable', 'Terminal is unavailable right now.'],
  ['broker-identity-mismatch', 'Terminal access needs attention.'],
  ['root-policy-invalid', 'Terminal access needs attention.'],
  ['launcher-unavailable', 'Terminal is not available on this host.'],
] as const satisfies readonly (readonly [PtyProbeReason, string])[];

const summary = (sessionId: string, name: string): SessionSummary => ({
  sessionId,
  name,
  host: 'desktop',
  launcher: 'shell',
  rootId: 'repo',
  cwd: '',
  state: 'live',
  attachmentCount: 0,
  attachmentState: 'detached',
  startedAt: '2026-08-22T00:00:00.000Z',
  endedAt: null,
  exit: null,
});

const sessionFrame = (session: SessionSummary, revision: number): BrowserServerFrame => ({
  type: 'session',
  requestId: null,
  revision,
  session,
});

describe('session workspace model', () => {
  it('keeps server order and server-provided names while updating rows in place', () => {
    const firstId = 'pty-11111111111111111111111111111111';
    const secondId = 'pty-22222222222222222222222222222222';
    let model = createSessionWorkspaceModel(capability);

    model = reduceSessionWorkspace(model, sessionFrame(summary(firstId, 'Build Shell'), 1));
    model = reduceSessionWorkspace(model, sessionFrame(summary(secondId, 'Review Shell'), 2));
    model = reduceSessionWorkspace(model, sessionFrame(summary(firstId, 'Builder'), 3));

    expect(model.sessions.map(({ sessionId, name }) => ({ sessionId, name }))).toEqual([
      { sessionId: firstId, name: 'Builder' },
      { sessionId: secondId, name: 'Review Shell' },
    ]);
  });

  it('deduplicates the same attachment and adds distinct same-cookie tab attachments', () => {
    const sessionId = 'pty-11111111111111111111111111111111';
    const base = summary(sessionId, 'Shell');
    let model = reduceSessionWorkspace(
      createSessionWorkspaceModel(capability),
      sessionFrame(base, 1),
    );

    const firstAttachment: BrowserServerFrame = {
      type: 'attached',
      requestId: 'req-11111111111111111111111111111111',
      revision: 2,
      session: { ...base, attachmentCount: 1, attachmentState: 'attached' },
      attachmentId: 'att-11111111111111111111111111111111',
      replayFrom: 0,
      nextSequence: 1,
    };
    model = reduceSessionWorkspace(model, firstAttachment);
    model = reduceSessionWorkspace(model, firstAttachment);
    expect(model.attachments[sessionId]).toEqual([
      'att-11111111111111111111111111111111',
    ]);

    model = reduceSessionWorkspace(model, {
      type: 'attached',
      requestId: 'req-22222222222222222222222222222222',
      revision: 3,
      session: { ...base, attachmentCount: 2, attachmentState: 'attached' },
      attachmentId: 'att-22222222222222222222222222222222',
      replayFrom: 0,
      nextSequence: 1,
    });

    expect(model.attachments[sessionId]).toEqual([
      'att-11111111111111111111111111111111',
      'att-22222222222222222222222222222222',
    ]);
    expect(model.sessions).toHaveLength(1);
    expect(model.sessions[0]?.attachmentCount).toBe(2);
  });

  it.each(diagnosticCases)('projects %s with closed safe copy and no diagnostic detail', (reason, message) => {
    const model = createSessionWorkspaceModel({
      pty: false,
      diagnostic: {
        reason,
        detail: diagnosticDetail,
        checkedAt: '2026-08-22T00:00:00.000Z',
      },
    });

    expect(model.availability).toEqual({
      kind: 'unavailable',
      title: 'Terminal unavailable',
      message,
      actionLabel: 'Open Health',
    });
    expect(JSON.stringify(model)).not.toContain(diagnosticDetail);
  });

  it('selects the active Run session and keeps prior attempts replay-only', () => {
    const rows: AttemptSessionPublicRow[] = [
      {
        attemptRef: 'attempt-old',
        sessionId: 'pty-11111111111111111111111111111111',
        launcher: 'claude',
        state: 'exited',
        startedAt: '2026-08-22T00:00:00.000Z',
        endedAt: '2026-08-22T00:01:00.000Z',
        exit: { exitCode: 0, reason: 'exited', observedAt: '2026-08-22T00:01:00.000Z' },
        controllerClaimed: true,
        liveControl: false,
      },
      {
        attemptRef: 'attempt-active',
        sessionId: 'pty-22222222222222222222222222222222',
        launcher: 'codex',
        state: 'live',
        startedAt: '2026-08-22T00:02:00.000Z',
        endedAt: null,
        exit: null,
        controllerClaimed: true,
        liveControl: true,
      },
    ];

    expect(projectRunSessionWorkspace(rows)).toEqual({
      selectedSessionId: 'pty-22222222222222222222222222222222',
      sessions: [
        { ...rows[0], mode: 'replay' },
        { ...rows[1], mode: 'live-control' },
      ],
    });
  });

  it('selects the newest attempt when history is replay-only', () => {
    const rows: AttemptSessionPublicRow[] = [
      {
        attemptRef: 'attempt-old',
        sessionId: 'pty-11111111111111111111111111111111',
        launcher: 'claude',
        state: 'abandoned',
        startedAt: '2026-08-22T00:00:00.000Z',
        endedAt: '2026-08-22T00:01:00.000Z',
        exit: { exitCode: null, reason: 'abandoned', observedAt: '2026-08-22T00:01:00.000Z' },
        controllerClaimed: false,
        liveControl: false,
      },
      {
        attemptRef: 'attempt-new',
        sessionId: 'pty-22222222222222222222222222222222',
        launcher: 'codex',
        state: 'exited',
        startedAt: '2026-08-22T00:02:00.000Z',
        endedAt: '2026-08-22T00:03:00.000Z',
        exit: { exitCode: 1, reason: 'exited', observedAt: '2026-08-22T00:03:00.000Z' },
        controllerClaimed: true,
        liveControl: false,
      },
    ];

    const projected = projectRunSessionWorkspace(rows);
    expect(projected.selectedSessionId).toBe(rows[1]?.sessionId);
    expect(projected.sessions.every((row) => row.mode === 'replay')).toBe(true);
  });

  it('projects the active session as live-observe when control is not claimed', () => {
    const row: AttemptSessionPublicRow = {
      attemptRef: 'attempt-observe',
      sessionId: 'pty-11111111111111111111111111111111',
      launcher: 'codex',
      state: 'live',
      startedAt: '2026-08-22T00:00:00.000Z',
      endedAt: null,
      exit: null,
      controllerClaimed: false,
      liveControl: false,
    };

    expect(projectRunSessionWorkspace([row])).toEqual({
      selectedSessionId: row.sessionId,
      sessions: [{ ...row, mode: 'live-observe' }],
    });
  });

  it('keeps browser identity out of local persistence and workspace state', () => {
    const sources = [
      './sessionWorkspaceModel.ts',
      '../views/TerminalSessionHeader.tsx',
      '../views/TerminalSessionEmpty.tsx',
    ].map((path) => readFileSync(new URL(path, import.meta.url), 'utf8'));
    const persistenceNeedles = [
      ['local', 'Storage'].join(''),
      'sessionStorage',
      'indexedDB',
      'document.cookie',
    ];

    for (const source of sources) {
      for (const needle of persistenceNeedles) expect(source).not.toContain(needle);
      expect(source).not.toContain('browserSessionRef');
    }
    expect(Object.keys(createSessionWorkspaceModel(capability))).toEqual([
      'availability',
      'sessions',
      'attachments',
      'selectedSessionId',
    ]);
  });
});

describe('browser server frame decoder', () => {
  it('decodes every shared valid browser-server vector', () => {
    for (const vector of validBrowserServerFrames) {
      expect(decodeBrowserServerFrame(vector), vector.type).toEqual(vector);
    }
  });

  it('returns the section 3 refusal for every shared adversarial vector', () => {
    for (const vector of invalidPtyProtocolVectors) {
      const candidate = 'frame' in vector ? vector.frame : vector;
      expect(decodeBrowserServerFrame(candidate), vector.case).toBeNull();
    }
  });

  it('accepts finite fractional exit codes and refuses non-finite or non-number values', () => {
    const valid = validBrowserServerFrames[4];
    const fractional = { ...valid, exit: { ...valid.exit, exitCode: 1.5 } };
    expect(decodeBrowserServerFrame(fractional)).toEqual(fractional);

    for (const exitCode of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '1']) {
      expect(decodeBrowserServerFrame({ ...valid, exit: { ...valid.exit, exitCode } })).toBeNull();
    }
  });

  it('rejects an extra top-level key and a missing required top-level key for every valid vector', () => {
    validBrowserServerFrames.forEach((vector, index) => {
      expect(
        decodeBrowserServerFrame({ ...vector, unexpected: true }),
        `${index}:${vector.type}:extra`,
      ).toBeNull();

      const withoutRequired: Record<string, unknown> = { ...vector };
      const requiredKey = Object.keys(vector).find((key) => key !== 'type') ?? 'type';
      delete withoutRequired[requiredKey];
      expect(
        decodeBrowserServerFrame(withoutRequired),
        `${index}:${vector.type}:missing-${requiredKey}`,
      ).toBeNull();
    });
  });

  it('rejects extra keys recursively', () => {
    const valid = validBrowserServerFrames[0];
    expect(decodeBrowserServerFrame({ ...valid, session: { ...valid.session, owner: 'hidden' } })).toBeNull();

    const closeAck = validBrowserServerFrames[7];
    expect(decodeBrowserServerFrame({ ...closeAck, exit: { ...closeAck.exit, signal: 9 } })).toBeNull();

    const resizeAck = validBrowserServerFrames[6];
    expect(decodeBrowserServerFrame({ ...resizeAck, size: { ...resizeAck.size, pixels: 1 } })).toBeNull();
  });
});

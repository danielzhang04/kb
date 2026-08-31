import type { SessionHostKind, SessionLauncher, SessionState, SessionSummary } from '../../shared/ptyProtocol.ts';
import type { SessionWorkspaceModel } from '../console/sessionWorkspaceModel.ts';

const STATE_LABELS: Record<SessionState, string> = {
  starting: 'Starting',
  live: 'Live',
  closing: 'Closing',
  exited: 'Ended',
  abandoned: 'Interrupted',
};

const LAUNCHER_LABELS: Record<SessionLauncher, string> = {
  shell: 'Shell',
  claude: 'Claude',
  codex: 'Codex',
};

const HOST_LABELS: Record<SessionHostKind, string> = { desktop: 'Desktop', vm: 'VM' };

/**
 * One row of the roster, in the order P3 §8 names it: server-derived name, launcher, host, root, and
 * relative cwd, then the state. Every part is the SERVER's answer — the opaque `sessionId` is never one
 * of them, because ux-rules 13 counts "raw ids as names" as a violation and because a name the host
 * derived is the only label that stays true when the host disagrees with this browser.
 */
export function sessionRowLabel(session: SessionSummary): string {
  const place = session.cwd === ''
    ? `${HOST_LABELS[session.host]}/${session.rootId}`
    : `${HOST_LABELS[session.host]}/${session.rootId}/${session.cwd}`;
  return [session.name, LAUNCHER_LABELS[session.launcher], place, STATE_LABELS[session.state]]
    .join(' · ');
}

export interface TerminalSessionHeaderProps {
  model: SessionWorkspaceModel;
  onSelectSession(sessionId: string): void;
}

export function TerminalSessionHeader({ model, onSelectSession }: TerminalSessionHeaderProps) {
  return (
    <header aria-label="Terminal sessions">
      <div role="tablist" aria-label="Sessions" data-testid="terminal-session-rows">
        {model.sessions.map((session) => (
          <button
            key={session.sessionId}
            type="button"
            role="tab"
            aria-selected={session.sessionId === model.selectedSessionId}
            onClick={() => onSelectSession(session.sessionId)}
          >
            {sessionRowLabel(session)}
          </button>
        ))}
      </div>
    </header>
  );
}

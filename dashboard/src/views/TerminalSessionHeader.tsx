import type { SessionState } from '../../shared/ptyProtocol.ts';
import type { SessionWorkspaceModel } from '../console/sessionWorkspaceModel.ts';

const STATE_LABELS: Record<SessionState, string> = {
  starting: 'Starting',
  live: 'Live',
  closing: 'Closing',
  exited: 'Ended',
  abandoned: 'Interrupted',
};

export interface TerminalSessionHeaderProps {
  model: SessionWorkspaceModel;
  onSelectSession(sessionId: string): void;
}

export function TerminalSessionHeader({ model, onSelectSession }: TerminalSessionHeaderProps) {
  return (
    <header aria-label="Terminal sessions">
      <div role="tablist" aria-label="Sessions">
        {model.sessions.map((session) => (
          <button
            key={session.sessionId}
            type="button"
            role="tab"
            aria-selected={session.sessionId === model.selectedSessionId}
            onClick={() => onSelectSession(session.sessionId)}
          >
            {session.name}{' \u00b7 '}{STATE_LABELS[session.state]}
          </button>
        ))}
      </div>
    </header>
  );
}

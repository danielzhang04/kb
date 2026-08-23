import type { SessionLauncher } from '../../shared/ptyProtocol.ts';
import type { SessionWorkspaceAvailability } from '../console/sessionWorkspaceModel.ts';

const LAUNCHER_LABELS: Record<SessionLauncher, string> = {
  shell: 'Shell',
  claude: 'Claude',
  codex: 'Codex',
};

export interface TerminalSessionEmptyProps {
  availability: SessionWorkspaceAvailability;
  onLaunch(launcher: SessionLauncher): void;
  onOpenHealth(): void;
}

export function TerminalSessionEmpty({
  availability,
  onLaunch,
  onOpenHealth,
}: TerminalSessionEmptyProps) {
  if (availability.kind === 'unavailable') {
    return (
      <section aria-labelledby="terminal-unavailable-title">
        <h2 id="terminal-unavailable-title">{availability.title}</h2>
        <p>{availability.message}</p>
        <button type="button" onClick={onOpenHealth}>{availability.actionLabel}</button>
      </section>
    );
  }

  return (
    <section aria-labelledby="terminal-empty-title">
      <h2 id="terminal-empty-title">Start a session</h2>
      <div aria-label={`${availability.hostLabel} launchers`}>
        {availability.launchers.map((launcher) => (
          <button key={launcher} type="button" onClick={() => onLaunch(launcher)}>
            {LAUNCHER_LABELS[launcher]}
          </button>
        ))}
      </div>
    </section>
  );
}

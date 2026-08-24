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
      // `data-pty-state` carries P3 §8's literal `pty:false` where a DOM assertion can read it while the
      // visible copy stays human: ux-rules 13 counts "raw ids as names" as a violation, so the probe
      // reason enum never becomes a sentence. The detail below is the host's own sanitized sentence,
      // bounded by the projector, and React renders it as inert text — never as markup.
      <section
        aria-labelledby="terminal-unavailable-title"
        data-testid="terminal-unavailable"
        data-pty-state="pty:false"
      >
        <h2 id="terminal-unavailable-title">{availability.title}</h2>
        <p>{availability.message}</p>
        {availability.detail !== null ? (
          <p data-testid="terminal-unavailable-detail">{availability.detail}</p>
        ) : null}
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

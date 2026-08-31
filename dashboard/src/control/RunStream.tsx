import { useEffect, useRef, useState } from 'react';
import type { RunEventPage } from '../../server/control/p2Contracts.ts';
import { foldRunEventRecords } from './runEventRecords.ts';

type RunEvent = RunEventPage['items'][number];
type FoldedStep = ReturnType<typeof foldRunEventRecords>['turns'][number]['steps'][number];

function renderStep(step: FoldedStep, key: string): React.JSX.Element {
  if (step.kind === 'tool_use') return <div key={key}>
    <span>{step.name || 'tool'}</span>
    {step.result ? <span>{step.result.isError ? 'failed' : 'completed'}</span> : null}
  </div>;
  if (step.kind === 'file') return <div key={key} data-testid="run-event-file" data-event-kind="file">
    <strong>File</strong> <span>{step.path ?? step.text}</span>{step.status ? <span> · {step.status}</span> : null}
  </div>;
  if (step.kind === 'diff') return <div key={key} data-testid="run-event-diff" data-event-kind="diff">
    <strong>Diff{step.path ? ` · ${step.path}` : ''}</strong>
    <pre>{step.diff ?? step.text}</pre>
    {step.truncated ? <span data-testid="run-event-truncation">Diff truncated for display.</span> : null}
  </div>;
  if (step.kind === 'checkpoint') return <div key={key} data-testid="run-event-checkpoint" data-event-kind="checkpoint">
    <strong>Checkpoint</strong> <span>{step.checkpoint ?? step.text}</span>{step.status ? <span> · {step.status}</span> : null}
  </div>;
  if (step.kind === 'lifecycle') return <div key={key} data-testid="run-event-lifecycle" data-event-kind="lifecycle">
    <strong>Lifecycle</strong> <span>{step.text}</span>{step.status ? <span> · {step.status}</span> : null}
  </div>;
  return <p key={key}>{step.text}</p>;
}

export interface RunStreamProps {
  events: readonly RunEvent[];
  selectedStageRef?: string | null;
  connection: 'live' | 'reconnecting' | 'replay';
}

export function RunStream({ events, selectedStageRef = null, connection }: RunStreamProps): React.JSX.Element {
  const [followTail, setFollowTail] = useState(true);
  const tail = useRef<HTMLLIElement | null>(null);
  const model = foldRunEventRecords(events, selectedStageRef);

  useEffect(() => {
    if (followTail) tail.current?.scrollIntoView?.({ block: 'end' });
  }, [events, followTail, selectedStageRef]);

  return <section
    aria-label="Run stream"
    data-testid="run-stream"
    data-layout="full-width"
    data-following={followTail ? 'tail' : 'history'}
  >
    <header>
      <span aria-live="polite">{connection === 'reconnecting' ? 'Reconnecting…' : connection === 'replay' ? 'Replay' : 'Live'}</span>
      {connection !== 'replay' ? <button type="button" onClick={() => setFollowTail((value) => !value)}>
        {followTail ? 'Pause follow' : 'Follow live'}
      </button> : null}
    </header>
    {model.turns.length === 0 ? <p>No stream events yet.</p> : <ol>
      {model.turns.map((turn, turnIndex) => <li key={`${turn.timestamp ?? 'turn'}-${turn.index}-${turnIndex}`} ref={turnIndex === model.turns.length - 1 ? tail : undefined}>
        {turn.steps.map((step, stepIndex) => renderStep(
          step,
          `${step.kind === 'tool_use' ? step.toolUseId ?? 'tool' : step.kind}-${stepIndex}`,
        ))}
      </li>)}
    </ol>}
  </section>;
}

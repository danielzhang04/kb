import { useEffect, useRef, useState } from 'react';
import type { RunEventPage } from '../../server/control/p2Contracts.ts';
import { foldRunEventRecords } from './runEventRecords.ts';

type RunEvent = RunEventPage['items'][number];

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
        {turn.steps.map((step, stepIndex) => step.kind === 'tool_use'
          ? <div key={`${step.toolUseId ?? 'tool'}-${stepIndex}`}>
              <span>{step.name || 'tool'}</span>
              {step.result ? <span>{step.result.isError ? 'failed' : 'completed'}</span> : null}
            </div>
          : <p key={`${step.kind}-${stepIndex}`}>{step.text}</p>)}
      </li>)}
    </ol>}
  </section>;
}

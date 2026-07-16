/**
 * Live spectator timeline (D0.7). Renders a session's turns at message granularity
 * (thinking → tool_use → tool_result, nested subagent turns, per-turn tokens) from the shared
 * `TimelineModel`. The SAME model powers a live tail (fed over SSE from `server/timeline/stream.ts`)
 * and a static replay — this view never knows which, so live and replay render identically.
 *
 * The surface is labelled message-granular: there is NO intra-turn token claim (that arrives only
 * with the v2 Broker). Full wiring into the Control shell + SSE lands in D0.9; here the view accepts
 * a model directly (tests/D0.9) or self-fetches a replay from `/api/timeline`.
 */
import { useEffect, useState } from 'react';
import type { Turn, TimelineStep, SubagentView, TimelineModel } from '../lib/timelineModel';

const EMPTY: TimelineModel = { turns: [] };

function ToolResultBlock({ result }: { result: NonNullable<TimelineStep['result']> }): React.JSX.Element {
  return (
    <div className={`timeline__result${result.isError ? ' timeline__result--error' : ''}`}>
      <span className="timeline__result-label">{result.isError ? 'tool error' : 'tool result'}</span>
      <pre className="timeline__result-body">{String(result.content ?? '')}</pre>
    </div>
  );
}

function StepBlock({ step }: { step: TimelineStep }): React.JSX.Element {
  if (step.kind === 'thinking') {
    return (
      <div className="timeline__step timeline__step--thinking">
        <span className="timeline__step-label">thinking</span>
        <p>{step.text}</p>
      </div>
    );
  }
  if (step.kind === 'text') {
    return (
      <div className="timeline__step timeline__step--text">
        <p>{step.text}</p>
      </div>
    );
  }
  // tool_use
  return (
    <div className="timeline__step timeline__step--tool">
      <div className="timeline__tool-head">
        <strong className="timeline__tool-name">{step.name}</strong>
        <code className="timeline__tool-input">{JSON.stringify(step.input)}</code>
      </div>
      {step.result ? <ToolResultBlock result={step.result} /> : null}
      {step.subagent ? <SubagentBlock subagent={step.subagent} /> : null}
    </div>
  );
}

function SubagentBlock({ subagent }: { subagent: SubagentView }): React.JSX.Element {
  return (
    <div className="timeline__subagent" data-spawn-depth={subagent.spawnDepth ?? undefined}>
      <div className="timeline__subagent-head">
        <span className="timeline__subagent-type">{subagent.agentType ?? 'subagent'}</span>
        {subagent.description ? <span className="timeline__subagent-desc">{subagent.description}</span> : null}
        {subagent.model ? <span className="timeline__subagent-model">{subagent.model}</span> : null}
      </div>
      {subagent.turns.map((turn) => (
        <TurnBlock key={`sub-${turn.index}`} turn={turn} />
      ))}
    </div>
  );
}

function UsageBadge({ turn }: { turn: Turn }): React.JSX.Element | null {
  if (!turn.usage || turn.usage.totalTokens === null) return null;
  return (
    <span className="timeline__usage" title="per-turn tokens (message-granular)">
      {turn.usage.totalTokens.toLocaleString()} tok
    </span>
  );
}

function TurnBlock({ turn }: { turn: Turn }): React.JSX.Element {
  return (
    <section className="timeline__turn" aria-label={`turn ${turn.index}`}>
      <header className="timeline__turn-head">
        {turn.model ? <span className="timeline__turn-model">{turn.model}</span> : null}
        <UsageBadge turn={turn} />
      </header>
      {turn.steps.map((step, i) => (
        <StepBlock key={i} step={step} />
      ))}
    </section>
  );
}

/** Timeline view. Accepts a model directly (live tail / tests / D0.9) or self-fetches a replay. */
export function Timeline({ model, sessionPath }: { model?: TimelineModel; sessionPath?: string }): React.JSX.Element {
  const [fetched, setFetched] = useState<TimelineModel | null>(null);

  useEffect(() => {
    if (model || !sessionPath) return;
    let cancelled = false;
    fetch(`/api/timeline?session=${encodeURIComponent(sessionPath)}`)
      .then((r) => r.json() as Promise<TimelineModel>)
      .then((d) => {
        if (!cancelled) setFetched(d);
      })
      .catch(() => {
        /* read-only view: on failure keep the empty scaffold, never crash the shell */
      });
    return () => {
      cancelled = true;
    };
  }, [model, sessionPath]);

  const view = model ?? fetched ?? EMPTY;
  return (
    <div className="timeline">
      <div className="timeline__banner">
        <span className="timeline__granularity">message-granular</span>
        <span className="timeline__hint">thinking → tool_use → tool_result · live and replay share one fold</span>
      </div>
      {view.turns.length === 0 ? (
        <p className="timeline__empty">No timeline records yet.</p>
      ) : (
        view.turns.map((turn) => <TurnBlock key={turn.index} turn={turn} />)
      )}
    </div>
  );
}

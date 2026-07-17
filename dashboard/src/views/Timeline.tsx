/**
 * Live spectator timeline (D0.7) — now the "Activity" destination (U3).
 *
 * Renders a session's turns at message granularity (thinking → tool_use → tool_result, nested
 * subagent turns, per-turn tokens) from the shared `TimelineModel`. The SAME model powers a live tail
 * (fed over SSE from `server/timeline/stream.ts`) and a static replay — this view never knows which,
 * so live and replay render identically. That stream/data logic and the shared live↔replay fold are
 * UNTOUCHED here; U3 is a presentation + interaction pass (Timeline §E):
 *
 *   - dense single-column log; mono actor/ordinal, fg-dim content
 *   - tool-use rows carry the one terracotta accent as a LEFT-BORDER (never a full-row highlight)
 *   - auto-scroll while tailing; FREEZE on manual scroll-up, with an "N new" pill that jumps to live
 *
 * The surface is labelled message-granular: there is NO intra-turn token claim (that arrives only
 * with the v2 Broker). The view accepts a model directly (live tail / Vibe / tests) or self-fetches a
 * replay from `/api/timeline`.
 */
import { useEffect, useRef, useState } from 'react';
import type { Turn, TimelineStep, SubagentView, TimelineModel } from '../lib/timelineModel';
import '../styles/views/activity.css';

const EMPTY: TimelineModel = { turns: [] };

/** How close to the bottom (px) still counts as "tailing" — under jsdom all metrics are 0 ⇒ at bottom. */
const AT_BOTTOM_SLACK = 24;

function ToolResultBlock({ result }: { result: NonNullable<TimelineStep['result']> }): React.JSX.Element {
  return (
    <div className={`v-activity__result${result.isError ? ' v-activity__result--error' : ''}`}>
      <span className="v-activity__result-label">{result.isError ? 'tool error' : 'tool result'}</span>
      <pre className="v-activity__result-body">{String(result.content ?? '')}</pre>
    </div>
  );
}

function StepBlock({ step }: { step: TimelineStep }): React.JSX.Element {
  if (step.kind === 'thinking') {
    return (
      <div className="v-activity__step v-activity__step--thinking">
        <span className="v-activity__step-label">thinking</span>
        <p>{step.text}</p>
      </div>
    );
  }
  if (step.kind === 'text') {
    return (
      <div className="v-activity__step v-activity__step--text">
        <p>{step.text}</p>
      </div>
    );
  }
  // tool_use — the one accent, as a left-border.
  return (
    <div className="v-activity__step v-activity__step--tool">
      <div className="v-activity__tool-head">
        <strong className="v-activity__tool-name">{step.name}</strong>
        <code className="v-activity__tool-input">{JSON.stringify(step.input)}</code>
      </div>
      {step.result ? <ToolResultBlock result={step.result} /> : null}
      {step.subagent ? <SubagentBlock subagent={step.subagent} /> : null}
    </div>
  );
}

function SubagentBlock({ subagent }: { subagent: SubagentView }): React.JSX.Element {
  return (
    <div className="v-activity__subagent" data-spawn-depth={subagent.spawnDepth ?? undefined}>
      <div className="v-activity__subagent-head">
        <span className="v-activity__subagent-type">{subagent.agentType ?? 'subagent'}</span>
        {subagent.description ? <span className="v-activity__subagent-desc">{subagent.description}</span> : null}
        {subagent.model ? <span className="v-activity__subagent-model">{subagent.model}</span> : null}
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
    <span className="v-activity__usage" title="per-turn tokens (message-granular)">
      {turn.usage.totalTokens.toLocaleString()} tok
    </span>
  );
}

function TurnBlock({ turn }: { turn: Turn }): React.JSX.Element {
  return (
    <section className="v-activity__turn" aria-label={`turn ${turn.index}`}>
      <header className="v-activity__turn-head">
        <span className="v-activity__ordinal">#{turn.index}</span>
        {/* Actor: the model is the only identifier the message-granular fold carries — the
            transcript timestamp is not part of TimelineModel, so we lead with the actor, not a
            fabricated clock. */}
        {turn.model ? <span className="v-activity__actor">{turn.model}</span> : null}
        <UsageBadge turn={turn} />
      </header>
      {turn.steps.map((step, i) => (
        <StepBlock key={i} step={step} />
      ))}
    </section>
  );
}

/** Timeline / Activity view. Accepts a model directly (live tail / Vibe / tests) or self-fetches a replay. */
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
  const turnCount = view.turns.length;

  // ---- Tail vs freeze -------------------------------------------------------------------------
  // Auto-scroll to the newest turn while the operator is reading the live tail; the instant they
  // scroll UP (away from the bottom) we freeze and count arrivals, surfacing an "N new" pill that
  // jumps back to live on click. Pure presentation state — the shared data fold is untouched.
  const logRef = useRef<HTMLDivElement | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const prevCountRef = useRef(0);

  function isAtBottom(el: HTMLDivElement): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= AT_BOTTOM_SLACK;
  }

  function scrollToLive(): void {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  function handleScroll(): void {
    const el = logRef.current;
    if (!el) return;
    if (isAtBottom(el)) {
      setFrozen(false);
      setNewCount(0);
    } else {
      setFrozen(true);
    }
  }

  function jumpToLive(): void {
    scrollToLive();
    setFrozen(false);
    setNewCount(0);
  }

  useEffect(() => {
    const prev = prevCountRef.current;
    if (turnCount > prev) {
      if (frozen) {
        // Reading history: don't yank the viewport — just tally what arrived.
        setNewCount((n) => n + (turnCount - prev));
      } else {
        scrollToLive();
      }
    }
    prevCountRef.current = turnCount;
  }, [turnCount, frozen]);

  return (
    <div className="v-activity">
      <div className="v-activity__header">
        <span className="v-activity__granularity">message-granular</span>
        <span className="v-activity__hint">thinking → tool_use → tool_result · live and replay share one fold</span>
      </div>
      <div className="v-activity__viewport">
        <div className="v-activity__log" ref={logRef} onScroll={handleScroll} data-testid="activity-log">
          {turnCount === 0 ? (
            <p className="v-activity__empty">No timeline records yet.</p>
          ) : (
            view.turns.map((turn) => <TurnBlock key={turn.index} turn={turn} />)
          )}
        </div>
        {frozen && newCount > 0 ? (
          <button type="button" className="v-activity__newpill" onClick={jumpToLive}>
            {newCount} new ↓
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Run Envelope panel (Agent Platform, Wave-1 U6).
 *
 * TWO THINGS, both read-only:
 *  1. the ENVELOPE of a real run — the payload-elided step skeleton served by `GET /api/trace/:id`
 *     (`server/trace/envelope.ts`): step order, tool name, model, result/error state, duration;
 *  2. a step-check REPORT over a fixture envelope — the prototype of "did this run stay inside its
 *     envelope?". It reports; it never mutates, retries, blocks or writes anything.
 *
 * NOT the Flight Recorder (`views/panels/FlightRecorder.tsx`). That panel is a link index over
 * COMMITTED distilled trace permalinks; this one reads a live session's structure over the API.
 *
 * IMPORT-GRAPH NOTE. `checkSteps` is imported at RUNTIME, which is legal precisely because
 * `server/trace/stepCheck.ts` is a pure data function with no node builtins (its own types come in
 * type-only) — see `src/lib/clientImportGraph.test.ts`, which is the gate on this. Reimplementing the
 * rules client-side would be the wrong fix: client and server evaluate the SAME function here.
 *
 * Self-fetches by default; accepts `envelope` / `sessionId` props (tests, or an already-loaded
 * parent) per the FlightRecorder `cardIds` idiom. Empty-safe and fetch-failure-safe: never throws.
 */
import { useEffect, useState } from 'react';
import type { AgentPlatformPanel } from '../types';
import type { RunEnvelope } from '../../../../server/trace/envelope.ts';
import type { StepVerdict } from '../../../../server/trace/stepCheck.ts';
import { checkSteps } from '../../../../server/trace/stepCheck.ts';
import { ModelBadge } from '../../../components/ModelBadge';
import { FIXTURE_ENVELOPE, FIXTURE_RULES } from './runEnvelopeFixture';
import '../../../styles/views/agentPlatformRunEnvelope.css';

/** A real kb session on this machine — the default subject when no `sessionId` prop is given. */
const DEFAULT_SESSION_ID = '76c6e6b5-0f33-4fc0-8085-b66a9e593e21';

export interface RunEnvelopeProps {
  /** Session to fetch. Ignored when `envelope` is supplied. */
  sessionId?: string;
  /** Pre-loaded envelope (tests / a parent that already fetched). Suppresses the fetch entirely. */
  envelope?: RunEnvelope;
  /** The envelope the step-check section reports on. Defaults to the committed fixture; injectable so
   *  a test can exercise verdicts (e.g. `not-evaluated`) the fixture does not happen to produce. */
  fixtureEnvelope?: RunEnvelope;
}

type LoadState = 'loading' | 'ready' | 'unavailable';

function resultBadge(step: RunEnvelope['steps'][number]): React.JSX.Element {
  if (step.isError === true) return <span className="ap-runenv__badge ap-runenv__badge--error">error</span>;
  if (step.hasResult) return <span className="ap-runenv__badge ap-runenv__badge--ok">result</span>;
  return <span className="ap-runenv__badge ap-runenv__badge--pending">no result</span>;
}

/** THREE distinct renderings — "could not check" must never look like "checked and clean". */
const VERDICT_STYLE: Record<StepVerdict, { modifier: string; label: string }> = {
  pass: { modifier: 'ok', label: 'pass' },
  fail: { modifier: 'error', label: 'fail' },
  'not-evaluated': { modifier: 'skipped', label: 'not evaluated' },
};

function RunEnvelopeBody({
  sessionId = DEFAULT_SESSION_ID,
  envelope,
  fixtureEnvelope = FIXTURE_ENVELOPE,
}: RunEnvelopeProps = {}): React.JSX.Element {
  const [fetched, setFetched] = useState<RunEnvelope | null>(null);
  const [state, setState] = useState<LoadState>(envelope ? 'ready' : 'loading');

  useEffect(() => {
    if (envelope) return;
    let cancelled = false;
    fetch(`/api/trace/${encodeURIComponent(sessionId)}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<RunEnvelope>;
      })
      .then((d) => {
        if (cancelled) return;
        setFetched(d);
        setState('ready');
      })
      .catch(() => {
        // Read-only view: degrade to an explicit "unavailable" line, never crash the shell.
        if (!cancelled) setState('unavailable');
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId, envelope]);

  const run = envelope ?? fetched;
  const steps = run?.steps ?? [];
  // Report-only, computed at render off the FIXTURE envelope — never off the live run above.
  const report = checkSteps(fixtureEnvelope, FIXTURE_RULES);

  return (
    <div className="ap-runenv" aria-label="Run Envelope panel">
      <section className="ap-runenv__section">
        <h3 className="ap-runenv__heading">Run envelope — {run?.sessionId ?? sessionId}</h3>
        <p className="ap-runenv__note">
          Step skeleton of a real session. Tool inputs and results are elided server-side and never travel here.
        </p>
        {state === 'unavailable' ? (
          <p className="ap-runenv__empty" data-testid="runenv-unavailable">
            Envelope unavailable — no transcript served for this session.
          </p>
        ) : steps.length === 0 ? (
          <p className="ap-runenv__empty" data-testid="runenv-empty">
            {state === 'loading' ? 'Loading envelope…' : 'No tool steps in this run.'}
          </p>
        ) : (
          <table className="ap-runenv__table">
            <thead>
              <tr>
                <th>#</th>
                <th>Tool</th>
                <th>Model</th>
                <th>Result</th>
                <th>Duration</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step) => (
                <tr key={step.id} data-testid={`runenv-step-${step.index}`}>
                  <td className="ap-runenv__mono">{step.index}</td>
                  <td className="ap-runenv__mono">{step.name}</td>
                  <td>
                    <ModelBadge tier={step.model} />
                  </td>
                  <td>{resultBadge(step)}</td>
                  <td className="ap-runenv__mono">{step.durationMs === null ? '—' : `${step.durationMs}ms`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="ap-runenv__section">
        <h3 className="ap-runenv__heading">Step check — fixture {fixtureEnvelope.sessionId}</h3>
        <p className="ap-runenv__note">prototype — fixture only, report-only, never mutates</p>
        <table className="ap-runenv__table">
          <thead>
            <tr>
              <th>Step</th>
              <th>Rule</th>
              <th>Outcome</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {report.results.map((row, i) => (
              <tr key={`${row.stepId}-${row.rule}-${i}`} data-testid={`stepcheck-row-${i}`}>
                <td className="ap-runenv__mono">{row.stepId.slice(0, 12)}</td>
                <td className="ap-runenv__mono">{row.rule}</td>
                <td>
                  <span
                    className={`ap-runenv__badge ap-runenv__badge--${VERDICT_STYLE[row.verdict].modifier}`}
                    data-testid={`stepcheck-outcome-${i}`}
                    data-verdict={row.verdict}
                  >
                    {VERDICT_STYLE[row.verdict].label}
                  </span>
                </td>
                <td>{row.detail ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

export const panel: AgentPlatformPanel = {
  id: 'run-envelope',
  title: 'Run Envelope',
  description: "One run's payload-elided step skeleton, with a report-only step check.",
  render: () => <RunEnvelopeBody />,
};

export { RunEnvelopeBody };

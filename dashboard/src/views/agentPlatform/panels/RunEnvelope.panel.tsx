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
 * ── Choosing the subject (U12) ──
 * The subject used to be ONE hard-coded session id, which is a claim about one machine: everywhere
 * else it 404s and the panel reads as broken rather than as empty. It is now a PICKER over
 * `GET /api/trace` — the transcripts that actually exist under the configured root — with that id kept
 * as the default WHEN IT IS PRESENT, and an explicit "no transcript on this machine" line when the
 * root holds none. The control plane's `listRuns` is deliberately NOT the source: a `runRef` is a
 * control-plane identifier and a session id is a Claude Code transcript stem, so feeding one into the
 * other 404s by construction.
 *
 * ── Locked is not broken (U12) ──
 * Every route this panel reads sits behind the session pre-handler, so a LOCKED dashboard would 401.
 * The lock check here is defense-in-depth so the panel never has to render that 401 as "no transcript
 * served for this session" — locked means ZERO fetches and a stated locked notice, exactly as
 * `WatchAgentsRunBody` does it. The step-check section stays visible while locked — it reads nothing,
 * so hiding it would be its own small lie about what is unavailable.
 *
 * ── Badges (U12) ──
 * The result and verdict chips are the SHARED `.mc-badge` system from `styles/app.css`, not a
 * panel-local copy of it: a green "result" here and a green chip anywhere else in the app now come
 * from one rule. `not-evaluated` gets `.mc-badge--unevaluated` — dashed and muted, so "could not
 * check" can never be mistaken for "checked and clean".
 *
 * IMPORT-GRAPH NOTE. `checkSteps` is imported at RUNTIME, which is legal precisely because
 * `server/trace/stepCheck.ts` is a pure data function with no node builtins (its own types come in
 * type-only) — see `src/lib/clientImportGraph.test.ts`, which is the gate on this. Reimplementing the
 * rules client-side would be the wrong fix: client and server evaluate the SAME function here.
 *
 * Self-fetches by default; accepts `envelope` / `sessionId` props (tests, or an already-loaded
 * parent) per the FlightRecorder `cardIds` idiom. Empty-safe and fetch-failure-safe: never throws.
 */
import { useState } from 'react';
import type { AgentPlatformPanel } from '../types';
import type { RunEnvelope } from '../../../../server/trace/envelope.ts';
import type { SessionListEntry, SessionListResponse } from '../../../../server/trace/routes.ts';
import type { StepVerdict } from '../../../../server/trace/stepCheck.ts';
import { checkSteps } from '../../../../server/trace/stepCheck.ts';
import { ModelBadge } from '../../../components/ModelBadge';
import { useSession } from '../../../lib/sessionContext';
import { useReadPanel } from '../../../lib/useReadPanel';
import { FIXTURE_ENVELOPE, FIXTURE_RULES } from './runEnvelopeFixture';
import '../../../styles/views/agentPlatformRunEnvelope.css';

/**
 * A real kb session on the machine this panel was built on. It is a PREFERENCE, not a requirement:
 * it is selected only when `/api/trace` reports it, and its absence is an ordinary case.
 */
export const PREFERRED_SESSION_ID = '76c6e6b5-0f33-4fc0-8085-b66a9e593e21';

export interface RunEnvelopeProps {
  /** Pin the subject explicitly. Suppresses the picker AND its list request; ignored when `envelope`
   *  is supplied. A parent that already knows which session it wants pays for one request, not two. */
  sessionId?: string;
  /** Pre-loaded envelope (tests / a parent that already fetched). Suppresses every fetch. */
  envelope?: RunEnvelope;
  /** The envelope the step-check section reports on. Defaults to the committed fixture; injectable so
   *  a test can exercise verdicts on data the fixture does not happen to produce. */
  fixtureEnvelope?: RunEnvelope;
}

/** Result state, in the shared badge vocabulary. A plain `.mc-badge` is the app's neutral chip — the
 *  right rendering for "no result yet", which is neither good news nor bad. */
function resultBadge(step: RunEnvelope['steps'][number]): React.JSX.Element {
  if (step.isError === true) return <span className="mc-badge mc-badge--error">error</span>;
  if (step.hasResult) return <span className="mc-badge mc-badge--done">result</span>;
  return <span className="mc-badge">no result</span>;
}

/** THREE distinct renderings — "could not check" must never look like "checked and clean". */
const VERDICT_STYLE: Record<StepVerdict, { modifier: string; label: string }> = {
  pass: { modifier: 'mc-badge--done', label: 'pass' },
  fail: { modifier: 'mc-badge--error', label: 'fail' },
  'not-evaluated': { modifier: 'mc-badge--unevaluated', label: 'not evaluated' },
};

/** The option label for one transcript: its id, its project directory, and when it last changed. */
function sessionLabel(entry: SessionListEntry): string {
  const when = Number.isNaN(Date.parse(entry.modifiedAt))
    ? entry.modifiedAt
    : new Date(entry.modifiedAt).toLocaleString();
  return entry.project === null ? `${entry.sessionId} — ${when}` : `${entry.sessionId} — ${entry.project} — ${when}`;
}

/** The default subject: the preferred id when the machine actually has it, else the newest listed. */
export function defaultSubject(sessions: SessionListEntry[]): string | null {
  if (sessions.some((s) => s.sessionId === PREFERRED_SESSION_ID)) return PREFERRED_SESSION_ID;
  return sessions[0]?.sessionId ?? null;
}

function RunEnvelopeBody({
  sessionId,
  envelope,
  fixtureEnvelope = FIXTURE_ENVELOPE,
}: RunEnvelopeProps = {}): React.JSX.Element {
  const { session } = useSession();
  /** The operator's explicit pick, if they have made one. Null means "still on the default". */
  const [picked, setPicked] = useState<string | null>(null);

  /** True when this panel owns subject selection (no pinned id, no injected envelope). */
  const picking = envelope === undefined && sessionId === undefined;

  // Both reads go through the shared hook, and both are GATED BY THE URL rather than inside the
  // effect: locked ⇒ null ⇒ no request at all. An injected envelope or a pinned id suppresses the
  // list, so a parent that already knows its subject pays for one request rather than two.
  const { data: list, state: listState } = useReadPanel<SessionListResponse>(
    picking && session ? '/api/trace' : null,
  );
  const sessions = list === null ? null : list.available ? list.sessions : [];
  // The default is DERIVED, never written into state by the list effect: a stored default would go
  // stale the moment the list changed, and would need its own reset to avoid pointing at a session
  // that is no longer there.
  const subject = sessionId ?? picked ?? (sessions === null ? null : defaultSubject(sessions));

  const { data: fetched, state } = useReadPanel<RunEnvelope>(
    envelope === undefined && session && subject !== null ? `/api/trace/${encodeURIComponent(subject)}` : null,
  );

  const run = envelope ?? fetched;
  const steps = run?.steps ?? [];
  // Report-only, computed at render off the FIXTURE envelope — never off the live run above.
  const report = checkSteps(fixtureEnvelope, FIXTURE_RULES);
  /** The list came back readable and held nothing — a fact about the machine, not a failure. */
  const noTranscripts = picking && listState === 'ready' && (sessions?.length ?? 0) === 0;
  /** A run is actually in hand: injected, or read. Anything else is still loading, never "empty". */
  const envelopeKnown = envelope !== undefined || state === 'ready';

  return (
    <div className="ap-runenv" aria-label="Run Envelope panel">
      <section className="ap-runenv__section">
        {/* h4: the section shell owns h3 (`ap__body-title`), so a panel body starts one level in. */}
        <h4 className="ap-runenv__heading">Run envelope — {run?.sessionId ?? subject ?? 'no session selected'}</h4>
        <p className="ap-runenv__note">
          Step skeleton of a real session. Tool inputs and results are elided server-side and never travel here.
        </p>

        {!session ? (
          <p className="ap-runenv__empty" data-testid="runenv-locked">
            Unlock the dashboard to read a run envelope. Nothing is read while it is locked.
          </p>
        ) : picking && sessions !== null && sessions.length > 0 ? (
          <div className="ap-runenv__picker">
            <label className="ap-runenv__picker-label" htmlFor="ap-runenv-session">
              Session
            </label>
            <select
              id="ap-runenv-session"
              className="ap-runenv__picker-select"
              data-testid="runenv-session-picker"
              value={subject ?? ''}
              onChange={(event) => setPicked(event.target.value)}
            >
              {sessions.map((entry) => (
                <option key={entry.sessionId} value={entry.sessionId}>
                  {sessionLabel(entry)}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {!session ? null : noTranscripts ? (
          <p className="ap-runenv__empty" data-testid="runenv-no-transcripts">
            No transcript on this machine — nothing under the configured trace root to read.
          </p>
        ) : picking && listState === 'unavailable' ? (
          <p className="ap-runenv__empty" data-testid="runenv-list-unavailable">
            The transcript list could not be read. Nothing was changed.
          </p>
        ) : state === 'unavailable' ? (
          <p className="ap-runenv__empty" data-testid="runenv-unavailable">
            Envelope unavailable — no transcript served for this session.
          </p>
        ) : steps.length === 0 ? (
          <p className="ap-runenv__empty" data-testid="runenv-empty">
            {/* "No tool steps" is a CLAIM ABOUT A RUN, so it may only be made once a run is actually
                in hand. Every frame before that — the list still loading, no subject resolved yet,
                the envelope in flight — is still loading, not an empty run. */}
            {envelopeKnown ? 'No tool steps in this run.' : 'Loading envelope…'}
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
        <h4 className="ap-runenv__heading">Step check — fixture {fixtureEnvelope.sessionId}</h4>
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
                    className={`mc-badge ${VERDICT_STYLE[row.verdict].modifier}`}
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
  order: 50,
  title: 'Run Envelope',
  description: "One run's payload-elided step skeleton, with a report-only step check.",
  render: () => <RunEnvelopeBody />,
};

export { RunEnvelopeBody };

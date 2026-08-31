import { useCallback, useEffect, useMemo, useState } from 'react';
import type { OutputRef } from '../../server/control/p2Contracts.ts';
import type { NavTarget } from '../nav/stack.ts';
import {
  ControlApiError,
  getRun,
  listRunEvents,
  readRunSessionReplay,
  type AttemptSessionPublicRow,
  type RunSessionReplayRefusal,
  respondToHumanRequest,
  respondToHumanRequestWithCeremony,
  stopManager,
  type FetchLike,
  type OperationalEventDto,
  type RunDetailDto,
} from '../control/controlClient.ts';
import { loadRunEventWindow } from '../control/runEventWindow.ts';
import { stepDagFromRun } from '../control/runGraph.ts';
import { RunInspector, type RunInspectorResponse } from '../control/RunInspector.tsx';
import { RunStream } from '../control/RunStream.tsx';
import { ConsolePane } from '../console/ConsolePane.tsx';
import { useSession } from '../lib/sessionContext.tsx';
import { useRunEventStream } from '../lib/sseClient.ts';
import { humanizeEntityId } from '../entity/humanizeEntityId.ts';

export interface RunDetailProps {
  runRef: string;
  onBack?: () => void;
  backLabel?: string;
  onNavigate?: (target: NavTarget) => void;
  now?: number;
  detail?: RunDetailDto;
  events?: OperationalEventDto[];
  outputs?: OutputRef[];
  connection?: 'live' | 'reconnecting' | 'replay';
  fetchImpl?: FetchLike;
  onDetach?: () => void;
  onReattach?: () => void;
  onStop?: () => void | Promise<void>;
  copyText?: (value: string) => void | Promise<void>;
}

type StopState = 'idle' | 'pending' | 'confirmed' | 'failed';

/** Launcher names as an operator says them. The wire enum is closed, so this map is exhaustive. */
const LAUNCHER_LABEL: Record<AttemptSessionPublicRow['launcher'], string> = { claude: 'Claude', codex: 'Codex' };

/** The house separator, escaped so this file's label text stays ASCII on disk. */
const DOT = '\u00b7';

/**
 * One attempt's row label. It is built from the attempt's POSITION in the server's list, its launcher,
 * and its state — never from `attemptRef` or `sessionId`, which are machine ids the operator has no use
 * for and which the ux rules keep off every surface.
 */
function attemptLabel(row: AttemptSessionPublicRow, index: number): string {
  const runningWord = row.state === 'starting' ? 'starting'
    : row.state === 'live' ? 'running'
      : row.state === 'closing' ? 'finishing' : null;
  if (runningWord !== null) return `Attempt ${index + 1} ${DOT} ${LAUNCHER_LABEL[row.launcher]} ${DOT} ${runningWord}`;
  const ended = row.state === 'abandoned' ? 'abandoned'
    : row.exit === null || row.exit.exitCode === null ? 'ended'
      : row.exit.exitCode === 0 ? 'finished' : `exit ${row.exit.exitCode}`;
  return `Attempt ${index + 1} ${DOT} ${LAUNCHER_LABEL[row.launcher]} ${DOT} ${ended}`;
}

/** True while the attempt's child is still on the host — the only case a live attach can succeed. */
function attemptIsRunning(row: AttemptSessionPublicRow): boolean {
  return row.state === 'starting' || row.state === 'live' || row.state === 'closing';
}

/** One sentence per closed refusal member. None of them mentions a log file, a path, or a second stream. */
function replayNotice(refusal: RunSessionReplayRefusal): string {
  switch (refusal.kind) {
    case 'not-found': return 'This attempt has no terminal output on this run.';
    case 'gap': return 'Only part of this attempt was kept, and the rest could not be read.';
    case 'invalid': return 'This attempt could not be requested. Reload the run.';
    default: return 'This attempt\u2019s terminal output could not be read.';
  }
}

interface RunConsoleProps {
  runRef: string;
  token: string | null;
  /** The server's selection among `attemptSessions`, or null when this run has no session to open. */
  serverSelectedSessionId: string | null;
  attemptSessions: AttemptSessionPublicRow[];
  fetchImpl?: FetchLike;
}

/**
 * The Run's terminal, and the ONE console in this view.
 *
 * A PTY attempt has no second output stream: the child's stdout and stderr are the same pseudo-terminal
 * bytes, which is why every attempt's `stderrTail` is empty. So this surface has no "stderr" panel and
 * no copy that implies one — the output IS the console, and a failure is read there and in the exit
 * line beside the attempt.
 *
 * The running attempt mounts a live, controllable pane; every earlier attempt mounts the SAME pane in
 * read-only replay fed by the scoped replay route ([C-R6]). Switching attempts remounts that one pane
 * (keyed by session) rather than adding a second grid.
 */
function RunConsole({ runRef, token, serverSelectedSessionId, attemptSessions, fetchImpl }: RunConsoleProps): React.JSX.Element {
  // The server's choice is the default and the only source of truth on load; an operator selection
  // replaces it only until the next detail load names a different attempt.
  const [chosen, setChosen] = useState<string | null>(null);
  const selectedId = chosen !== null && attemptSessions.some((row) => row.sessionId === chosen)
    ? chosen
    : serverSelectedSessionId;
  const selected = attemptSessions.find((row) => row.sessionId === selectedId) ?? null;

  const replaySource = useCallback(async (sessionId: string) => {
    if (token === null) return { ok: false as const, notice: 'Sign in to read this attempt\u2019s output.' };
    let page = await readRunSessionReplay(runRef, sessionId, 0, token, fetchImpl);
    let lostOutput = false;
    // A gap means the retention window dropped the head. The server names the offset it CAN serve, so
    // read from there and say the earlier output is gone — never present the remainder as the whole.
    if (!page.ok && page.refusal.kind === 'gap' && page.refusal.nextSequence !== null) {
      lostOutput = true;
      page = await readRunSessionReplay(runRef, sessionId, page.refusal.nextSequence, token, fetchImpl);
    }
    if (!page.ok) return { ok: false as const, notice: replayNotice(page.refusal) };
    return { ok: true as const, frames: page.value.frames, lostOutput };
  }, [fetchImpl, runRef, token]);

  if (selectedId === null) {
    return <p role="status">
      This run has no terminal session. Terminal availability for this host is reported in Health.
    </p>;
  }
  // A selected session with no attempt row is a run whose PTY document rows are gone (or a stream the
  // control store knows about and the PTY document does not). Neither surface can serve it: a live
  // attach names no attempt binding and the principal check refuses it, and a replay has no row to read
  // from. Say so, instead of opening a socket that will fail and showing the operator a socket error.
  if (selected === null) {
    return <p role="status">
      This attempt&#8217;s terminal output is no longer available. Terminal availability for this host is
      reported in Health.
    </p>;
  }
  const live = attemptIsRunning(selected);
  return <div className="run-v3__console">
    {attemptSessions.length > 1 ? <nav aria-label="Run attempts">
      {attemptSessions.map((row, index) => <button
        type="button"
        key={row.sessionId}
        aria-pressed={row.sessionId === selectedId}
        onClick={() => setChosen(row.sessionId)}
      >{attemptLabel(row, index)}</button>)}
    </nav> : null}
    <ConsolePane
      key={selectedId}
      target={live ? { mode: 'attach', sessionId: selectedId } : { mode: 'replay', sessionId: selectedId }}
      replaySource={live ? undefined : replaySource}
      visible
      ariaLabel={live ? 'Run terminal' : 'Run terminal replay'}
    />
  </div>;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : 'unknown error';
}

function safeExternalPr(output: OutputRef): string | null {
  if (output.kind !== 'external-pr'
    || !/^[A-Za-z0-9_.-]+$/.test(output.owner)
    || !/^[A-Za-z0-9_.-]+$/.test(output.repository)
    || !Number.isSafeInteger(output.number)
    || output.number < 1) return null;
  return `https://github.com/${output.owner}/${output.repository}/pull/${output.number}`;
}

function defaultCopy(value: string): Promise<void> {
  if (!globalThis.navigator?.clipboard) return Promise.reject(new Error('clipboard unavailable'));
  return globalThis.navigator.clipboard.writeText(value);
}

const LIVE_RUN_STATES = new Set(['planned', 'recovering', 'running', 'waiting-human', 'stopping']);

/** Dashboard v3 Run: one redacted stream, one inspector, and no second execution canvas. */
export function RunDetail(props: RunDetailProps): React.JSX.Element {
  const session = useSession();
  const [loadedDetail, setLoadedDetail] = useState<RunDetailDto | null>(props.detail ?? null);
  const [replay, setReplay] = useState<OperationalEventDto[]>(props.events ?? []);
  const [replayComplete, setReplayComplete] = useState(true);
  const [replayReady, setReplayReady] = useState(props.events !== undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(props.detail === undefined);
  const [loadVersion, setLoadVersion] = useState(0);
  const [selectedStageRef, setSelectedStageRef] = useState<string | null>(null);
  const [attached, setAttached] = useState(true);
  const [stopState, setStopState] = useState<StopState>('idle');
  const [stopError, setStopError] = useState<string | null>(null);
  const [inspectorOpen, setInspectorOpen] = useState(true);

  useEffect(() => {
    if (props.detail !== undefined) setLoadedDetail(props.detail);
  }, [props.detail]);
  useEffect(() => {
    if (props.events !== undefined) {
      setReplay(props.events);
      setReplayComplete(true);
      setReplayReady(true);
    }
  }, [props.events]);

  useEffect(() => {
    if (props.detail !== undefined && props.events !== undefined) return;
    if (session.mode === null) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    if (props.events === undefined) setReplayReady(false);
    void session.requireSession().then(async (active) => {
      if (!active) throw new Error('Session required');
      const [nextDetail, window] = await Promise.all([
        props.detail ?? getRun(props.runRef, active.token, props.fetchImpl),
        props.events === undefined
          ? loadRunEventWindow(
              props.runRef,
              active.token,
              (runRef, after, limit, token) => listRunEvents(runRef, after, limit, token, props.fetchImpl),
            )
          : Promise.resolve({ events: props.events, seen: props.events.length, complete: true }),
      ]);
      if (!alive) return;
      setLoadedDetail(nextDetail);
      setReplay(window.events);
      setReplayComplete(window.complete);
      setReplayReady(true);
    }).catch((cause: unknown) => {
      if (alive) setLoadError(errorMessage(cause));
    }).finally(() => {
      if (alive) setLoading(false);
    });
    return () => { alive = false; };
  }, [loadVersion, props.detail, props.events, props.fetchImpl, props.runRef, session.mode, session.requireSession]);

  const detail = loadedDetail;
  const streamKind = detail?.streamKind ?? 'transcript';
  const liveLifecycle = detail !== null && LIVE_RUN_STATES.has(detail.run.state);
  const liveTranscript = liveLifecycle && streamKind === 'transcript';
  const stream = useRunEventStream(props.runRef, replay, attached && liveTranscript && replayReady);
  const outputs = props.outputs ?? detail?.outputs ?? [];
  const graph = useMemo(
    () => detail === null ? null : stepDagFromRun(detail, stream.events),
    [detail, stream.events],
  );
  const visibleEvents = graph?.eventsFor(selectedStageRef) as OperationalEventDto[] | undefined;
  const openGates = detail?.humanRequests.filter((request) => request.state === 'open') ?? [];

  const detach = (): void => {
    setAttached(false);
    props.onDetach?.();
  };
  const reattach = (): void => {
    setAttached(true);
    props.onReattach?.();
  };

  const stop = useCallback(async (): Promise<void> => {
    if (!detail || stopState === 'pending') return;
    setStopState('pending');
    setStopError(null);
    try {
      if (props.onStop) {
        await props.onStop();
      } else {
        const active = await session.requireSession();
        if (!active) throw new Error('Session required');
        await stopManager(detail.run.runRef, {
          expectedRunVersion: detail.run.version,
          expectedManagerGeneration: detail.run.managerGeneration,
          idempotencyKey: `manager-stop:${detail.run.runRef}:${detail.run.version}:${detail.run.managerGeneration}`,
        }, active.token, props.fetchImpl);
      }
      setStopState('confirmed');
    } catch (cause) {
      if (!props.onStop && cause instanceof ControlApiError && cause.status === 409) {
        const active = await session.requireSession();
        if (active) {
          try {
            setLoadedDetail(await getRun(detail.run.runRef, active.token, props.fetchImpl));
          } catch {
            // Preserve the original conflict if refreshing the CAS snapshot also fails.
          }
        }
      }
      setStopError(errorMessage(cause));
      setStopState('failed');
    }
  }, [detail, props.fetchImpl, props.onStop, session.requireSession, stopState]);

  const respond = async (input: RunInspectorResponse): Promise<void> => {
    const active = await session.requireSession();
    if (!active) throw new Error('Session required');
    const body = {
      expectedRevision: input.expectedRevision,
      decision: input.decision,
      response: input.response,
      idempotencyKey: `human-response:${input.requestRef}:${input.expectedRevision}:${input.decision}`,
    };
    const gate = openGates.find((request) => request.requestRef === input.requestRef);
    const t3 = gate !== undefined && ['approval', 'review', 'governance-refusal'].includes(gate.kind);
    await (t3 ? respondToHumanRequestWithCeremony : respondToHumanRequest)(
      input.requestRef, body, active.token, props.fetchImpl,
    );
    if (props.detail === undefined) setLoadVersion((value) => value + 1);
  };

  if (loading && detail === null) return <main className="run-v3"><p role="status">Loading run…</p></main>;
  if (detail === null) return <main className="run-v3">
    <p role="alert">Run failed to load{loadError ? `: ${loadError}` : '.'}</p>
    <button type="button" onClick={() => setLoadVersion((value) => value + 1)}>Retry</button>
  </main>;

  const copy = props.copyText ?? defaultCopy;
  const activeStop = ['running', 'recovering', 'waiting-human', 'stopping'].includes(detail.run.state);
  const stepSkeleton = graph?.nodes.map((node) => node.label).join(' → ') ?? 'No steps';
  const evidence = stream.events
    .filter((event) => event.kind === 'checkpoint' || event.kind === 'tool')
    .map((event) => event.summary ?? event.toolName ?? event.kind);
  const linkedCards = detail.stages.flatMap((stage) => stage.canonicalCardRef ? [stage.canonicalCardRef] : []);

  return <main className="run-v3">
    <header className="run-v3__header">
      {props.onBack ? <button type="button" onClick={props.onBack}>{props.backLabel ?? 'Back'}</button> : null}
      <div>
        <p>Run {'\u00b7'} {detail.run.runRef}</p>
        <h1>{detail.run.title}</h1>
        <p>{detail.run.state} {'\u00b7'} {humanizeEntityId(detail.run.owner.id)} {'\u00b7'} {detail.run.executionHost === 'vm' ? 'VM' : 'Desktop'}</p>
      </div>
      <div className="run-v3__actions">
        {liveLifecycle && (attached
          ? <button type="button" onClick={detach}>Detach</button>
          : <button type="button" onClick={reattach}>Reattach</button>)}
        {activeStop ? <button type="button" disabled={stopState === 'pending' || session.mode === null} onClick={() => void stop()}>
          {stopState === 'pending' ? 'Stopping…' : stopState === 'failed' ? 'Retry Stop' : 'Stop'}
        </button> : null}
      </div>
    </header>

    {loadError ? <p role="alert">Refresh failed: {loadError}</p> : null}
    {!replayComplete ? <p role="alert">Replay incomplete: the server cursor did not reach the end.</p> : null}
    {stopState === 'failed' ? <p role="alert">Stop failed: {stopError}</p> : null}
    {stopState === 'confirmed' ? <p role="status">Stop confirmed</p> : null}
    {detail.run.state === 'waiting-human' && openGates.length === 0
      ? <p role="alert">Run is waiting without an open request. Repair required.</p>
      : null}

    <nav aria-label="Step stream filter" className="run-v3__steps">
      <button type="button" aria-pressed={selectedStageRef === null} onClick={() => setSelectedStageRef(null)}>All steps</button>
      {graph?.nodes.map((node) => <button
        type="button"
        key={node.stageRef}
        aria-pressed={selectedStageRef === node.stageRef}
        onClick={() => setSelectedStageRef(node.stageRef)}
      >{node.label}</button>)}
    </nav>

    <div className={`run-v3__body${inspectorOpen ? '' : ' run-v3__body--collapsed'}`}>
      <div className="run-v3__stream-pane">
        {streamKind === 'pty'
          ? <RunConsole
              runRef={props.runRef}
              token={session.session?.token ?? null}
              serverSelectedSessionId={detail.sessionId}
              attemptSessions={detail.attemptSessions}
              fetchImpl={props.fetchImpl}
            />
          : <RunStream
              events={visibleEvents ?? []}
              selectedStageRef={null}
              connection={liveTranscript ? props.connection ?? stream.connection : 'replay'}
            />}
      </div>

      <div className="run-v3__inspector-shell">
        <button
          type="button"
          aria-controls="run-v3-inspector"
          aria-expanded={inspectorOpen}
          onClick={() => setInspectorOpen((value) => !value)}
        >{inspectorOpen ? 'Collapse inspector' : 'Expand inspector'}</button>
        {inspectorOpen ? <aside id="run-v3-inspector" aria-label="Run inspector">
          <RunInspector
            plan={detail.run.title}
            milestones={detail.stages.map((stage) => `${stage.title} · ${stage.state}`)}
            outputs={outputs}
            gate={openGates[0] ?? null}
            additionalGates={openGates.slice(1)}
            ceremonyAvailable={session.mode === 'win32-desktop'}
            details={{
              stepSkeleton,
              envelope: `${detail.run.owner.type} · ${detail.run.executionHost}`,
              linkedCards,
              evidence,
              ids: [detail.run.runRef, ...detail.stages.map((stage) => stage.stageRef)],
            }}
            onRespond={respond}
          />
          {outputs.length > 0 ? <section aria-label="Output actions">
            <h2>Output links</h2>
            {outputs.map((output) => {
              const url = safeExternalPr(output);
              return <div key={`${output.kind}:${output.label}`}>
                <span>{output.label}</span>
                {url ? <button type="button" onClick={() => void copy(url)}>Copy {output.label} link</button> : null}
              </div>;
            })}
          </section> : null}
        </aside> : null}
      </div>
    </div>
  </main>;
}

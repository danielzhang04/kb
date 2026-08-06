import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { TimelineModel } from '../lib/timelineModel';
import { useSession } from '../lib/sessionContext';
import { Timeline } from '../views/Timeline';
import { defaultComposerStream, getComposerSession } from './workspaceClient';
import type { ComposerSession, ComposerStreamFn } from './workspaceClient';
import { listRuns, type RunMetadataDto } from '../control/controlClient';

export interface ComposerChatProps {
  composerSession?: ComposerSession;
  onSessionChange?: (session: ComposerSession) => void;
  onRunningChange?: (running: boolean) => void;
  stream?: ComposerStreamFn;
  /** Opens the governed Run Cockpit after an agent-workspace workflow launch. */
  onOpenRun?: (runRef: string) => void;
  fetchImpl?: typeof fetch;
}

interface WorkflowChoice {
  ref: string;
  project: string;
  title: string | null;
  profile: string | null;
  valid: boolean;
  sourceHash: string | null;
  pendingAmendment?: { proposedSourceHash: string; branch: string; pr: { url?: string }; phase: string } | null;
  pendingAmendmentError?: string | null;
  stageCount: number;
  parameters?: string[];
  stages: Array<{ id: string; riskTier: string; review?: { subjectStageId: string; maxCreatorReworks: number } | null; completionGate?: { id: string; kind: string; requiresReview: string } | null }>;
}

type Status = 'idle' | 'running' | 'stopped' | 'error';

const FALLBACK_SESSION: ComposerSession = {
  composerRef: 'local-preview',
  title: 'New idea',
  state: 'open',
  createdAt: '',
  updatedAt: '',
  sourceComposerRef: null,
  agent: null,
  turns: [],
};

function pendingPhaseTruth(phase: string): string {
  if (phase === 'pending-human-merge') return 'Assignment amendment is pending human merge';
  if (phase === 'audit-pending') return 'Durable amendment exists; its required audit is pending';
  if (phase === 'audit-failed') return 'Required amendment audit failed';
  if (phase === 'prepared' || phase === 'committed' || phase === 'pushed') return 'Durable amendment recovery is required';
  return 'Assignment amendment state is unresolved';
}

function LiveAssistant({ model }: { model: TimelineModel }): React.JSX.Element {
  const text = model.turns.flatMap((turn) => turn.steps)
    .filter((step) => step.kind === 'text')
    .map((step) => step.kind === 'text' ? step.text : '')
    .filter(Boolean);
  const operations = model.turns.flatMap((turn) => turn.steps).filter((step) => step.kind !== 'text').length;
  return (
    <div className="composer-chat__assistant">
      {text.map((part, index) => <p key={index}>{part}</p>)}
      {operations > 0 || text.length === 0 ? (
        <details className="composer-chat__operations" open={text.length === 0}>
          <summary>{operations > 0 ? `${operations} operational step${operations === 1 ? '' : 's'}` : 'Working'}</summary>
          <Timeline model={model} />
        </details>
      ) : null}
    </div>
  );
}

/** Workspace-scoped operational chat. Its component stays mounted while its tab is open. */
export function ComposerChat({
  composerSession = FALLBACK_SESSION,
  onSessionChange,
  onRunningChange,
  stream = defaultComposerStream,
  onOpenRun,
  fetchImpl = fetch,
}: ComposerChatProps): React.JSX.Element {
  const { session, requireSession } = useSession();
  const token = session?.token;
  const [prompt, setPrompt] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState<string | null>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [livePrompt, setLivePrompt] = useState<string | null>(null);
  const [liveModel, setLiveModel] = useState<TimelineModel | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const runningObserverRef = useRef(onRunningChange);
  const launchKeys = useRef(new Map<string, string>());
  const [workflows, setWorkflows] = useState<WorkflowChoice[] | null>(null);
  const [workflowRef, setWorkflowRef] = useState('');
  const [launching, setLaunching] = useState(false);
  const [launchStatus, setLaunchStatus] = useState<string | null>(null);
  const [parameterValues, setParameterValues] = useState<Record<string, string>>({});
  const [linkedRuns, setLinkedRuns] = useState<RunMetadataDto[] | null>(null);

  useEffect(() => { runningObserverRef.current = onRunningChange; }, [onRunningChange]);

  useEffect(() => {
    runningObserverRef.current?.(status === 'running');
  }, [status]);

  useEffect(() => () => runningObserverRef.current?.(false), []);

  // A closed workspace tab may unmount this pane. Switching tabs or navigating never does, so independent
  // active turns continue. An actual unmount still releases the request instead of orphaning it.
  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!composerSession.agent) return;
    let alive = true;
    void fetchImpl('/api/workflows').then(async (response) => {
      if (!response.ok) throw new Error('workflow registry unavailable');
      return await response.json() as { items?: WorkflowChoice[] };
    }).then((body) => {
      const projects = new Set(composerSession.agent!.projects ?? []);
      const choices = Array.isArray(body.items) ? body.items.filter((item) => item.valid && projects.has(item.project)) : [];
      if (!alive) return;
      setWorkflows(choices);
      setWorkflowRef((current) => choices.some((item) => item.ref === current) ? current : (choices[0]?.ref ?? ''));
    }).catch(() => { if (alive) setWorkflows([]); });
    return () => { alive = false; };
  }, [composerSession.agent, fetchImpl]);

  const historicalTurns = useMemo(() => composerSession.turns, [composerSession.turns]);

  useEffect(() => {
    if (!composerSession.agent || !token) return;
    let alive = true;
    void listRuns(token, fetchImpl).then((runs) => {
      if (alive) setLinkedRuns(runs.filter((run) => run.agentWorkspaceLaunch?.composerRef === composerSession.composerRef));
    }).catch(() => { if (alive) setLinkedRuns([]); });
    return () => { alive = false; };
  }, [composerSession.agent, composerSession.composerRef, fetchImpl, token]);

  /** Point-of-action unlock through the app's ONE ceremony; a refusal is reported, never retried in a loop. */
  const resolveToken = useCallback(async (): Promise<string | undefined> => {
    if (token) return token;
    if (signingIn) return undefined;
    setSigningIn(true);
    setError(null);
    try {
      const next = await requireSession();
      if (!next) {
        setError('passkey sign-in failed — no session was created');
        return undefined;
      }
      return next.token;
    } finally {
      setSigningIn(false);
    }
  }, [requireSession, signingIn, token]);

  const refresh = useCallback(async (activeToken: string): Promise<void> => {
    if (!onSessionChange || composerSession.composerRef === FALLBACK_SESSION.composerRef) return;
    try {
      onSessionChange(await getComposerSession(composerSession.composerRef, activeToken));
    } catch {
      // The live turn remains visible; a later workspace refresh can reconcile server history.
    }
  }, [composerSession.composerRef, onSessionChange]);

  const onSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (status === 'running' || !prompt.trim()) return;
    const activeToken = await resolveToken();
    if (!activeToken) return;

    const sentPrompt = prompt.trim();
    setPrompt('');
    setLivePrompt(sentPrompt);
    setLiveModel(null);
    setStatus('running');
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;
    const outcome = await stream(
      composerSession.composerRef,
      sentPrompt,
      activeToken,
      setLiveModel,
      controller.signal,
    );
    const stopped = controller.signal.aborted;
    abortRef.current = null;
    await refresh(activeToken);
    if (stopped) {
      setStatus('stopped');
      return;
    }
    if (!outcome.ok) {
      setStatus('error');
      setError(outcome.reason ?? `refused${outcome.status ? ` (${outcome.status})` : ''}`);
      return;
    }
    setStatus('idle');
    setLivePrompt(null);
    setLiveModel(null);
  }, [composerSession.composerRef, prompt, refresh, resolveToken, status, stream]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setStatus('stopped');
  }, []);

  const launchWorkflow = useCallback(async () => {
    if (!composerSession.agent || !workflowRef || launching) return;
    const activeToken = await resolveToken();
    if (!activeToken) return;
    const selected = workflows?.find((workflow) => workflow.ref === workflowRef);
    if (selected?.pendingAmendmentError) {
      setLaunchStatus('Workflow amendment state is invalid; launch remains blocked until an operator resolves it.');
      return;
    }
    if (selected?.pendingAmendment) {
      setLaunchStatus(`${pendingPhaseTruth(selected.pendingAmendment.phase)} on ${selected.pendingAmendment.branch}; launch remains blocked.`);
      return;
    }
    if (!selected?.sourceHash) {
      setLaunchStatus('Workflow source revision is unavailable; refresh before launching.');
      return;
    }
    const parameters = Object.fromEntries((selected?.parameters ?? []).map((parameter) => [parameter, parameterValues[parameter] ?? '']));
    const operation = `${workflowRef}:${JSON.stringify(parameters)}`;
    const key = launchKeys.current.get(operation)
      ?? `agent-workspace-launch:${composerSession.composerRef}:${workflowRef}:${typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Date.now().toString(36)}`;
    launchKeys.current.set(operation, key);
    setLaunching(true);
    setLaunchStatus(null);
    try {
      const response = await fetchImpl(`/api/workflows/${encodeURIComponent(workflowRef)}/launch`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${activeToken}` },
        body: JSON.stringify({ idempotencyKey: key, composerRef: composerSession.composerRef, parameters, expectedSourceHash: selected?.sourceHash }),
      });
      const body = await response.json() as { runRef?: string; waitingHuman?: boolean; activationGated?: boolean; error?: string };
      if (!response.ok || !body.runRef) throw new Error(body.error ?? `launch refused (${response.status})`);
      const outcome = [
        body.activationGated ? 'execution activation is off' : null,
        body.waitingHuman ? 'waiting for the required human requests' : null,
      ].filter((value): value is string => value !== null);
      setLaunchStatus(outcome.length ? `Run ${body.runRef} is ${outcome.join(' and ')}.` : `Run ${body.runRef} launched through the governed workflow.`);
      onOpenRun?.(body.runRef);
    } catch (error) {
      setLaunchStatus(error instanceof Error ? error.message : 'workflow launch failed');
    } finally { setLaunching(false); }
  }, [composerSession, fetchImpl, launching, onOpenRun, parameterValues, resolveToken, workflowRef, workflows]);

  const selectedWorkflow = workflows?.find((workflow) => workflow.ref === workflowRef);
  const selectedWorkflowBlocked = Boolean(selectedWorkflow?.pendingAmendment || selectedWorkflow?.pendingAmendmentError);

  return (
    <section className="composer-chat" aria-label="Composer chat">
      {composerSession.agent ? (
        <section className="composer-chat__workflow-launch" aria-label="Launch workflow">
          <h3>Launch workflow</h3>
          <p>Uses this workspace’s recorded declaration revision. It does not run {composerSession.agent.id} directly.</p>
          {workflows === null ? <p>Loading canonical workflows…</p> : workflows.length === 0 ? <p>No valid workflow is declared for this agent’s projects.</p> : (
            <>
              <label>Workflow
                <select value={workflowRef} onChange={(event) => setWorkflowRef(event.target.value)} disabled={launching}>
                  {workflows.map((workflow) => <option key={workflow.ref} value={workflow.ref}>{workflow.title ?? workflow.ref} · {workflow.profile ?? 'no profile'} · {workflow.stageCount} stages</option>)}
                </select>
              </label>
              {selectedWorkflow ? (
                <p>Profile <code>{selectedWorkflow.profile}</code>; stages {selectedWorkflow.stages.map((stage) => `${stage.id} (${stage.riskTier})${stage.review ? ` reviews ${stage.review.subjectStageId}, max ${stage.review.maxCreatorReworks} reworks` : ''}${stage.completionGate ? `; completion gate ${stage.completionGate.id}` : ''}`).join(', ')}. Activation gates remain enforced by the canonical launch.</p>
              ) : null}
              {selectedWorkflow?.pendingAmendment ? <p data-testid="agent-workspace-pending-amendment">{pendingPhaseTruth(selectedWorkflow.pendingAmendment.phase)} on <code>{selectedWorkflow.pendingAmendment.branch}</code>; this workspace cannot launch the old definition.</p> : null}
              {selectedWorkflow?.pendingAmendmentError ? <p data-testid="agent-workspace-pending-amendment">Workflow amendment state is invalid; this workspace cannot launch it.</p> : null}
              {(selectedWorkflow?.parameters ?? []).map((parameter) => (
                <label key={parameter}>{parameter}<input aria-label={`Workflow parameter ${parameter}`} value={parameterValues[parameter] ?? ''} onChange={(event) => setParameterValues((current) => ({ ...current, [parameter]: event.target.value }))} /></label>
              ))}
              <button type="button" className="mc-btn mc-btn--primary" onClick={() => void launchWorkflow()} disabled={launching || !workflowRef || selectedWorkflowBlocked || (selectedWorkflow?.parameters ?? []).some((parameter) => !(parameterValues[parameter] ?? '').trim())}>{launching ? 'Launching…' : 'Launch workflow'}</button>
            </>
          )}
          {launchStatus ? <p data-testid="agent-workspace-launch-status">{launchStatus}</p> : <p>Registered workflows may still wait for human approval or disabled execution activation.</p>}
          {linkedRuns?.length ? <ol data-testid="agent-workspace-linked-runs">{linkedRuns.map((run) => <li key={run.runRef}><button type="button" onClick={() => onOpenRun?.(run.runRef)}>Open run {run.runRef}</button> <span>{run.state}</span></li>)}</ol> : null}
        </section>
      ) : null}
      <div className="composer-chat__timeline" aria-label="Conversation history">
        {historicalTurns.length === 0 && !livePrompt ? (
          <div className="composer-chat__empty">
            <h3>What do you want to accomplish?</h3>
            <p>Explore the idea here. Composer can inspect the kb, ask questions, and help shape an executable plan.</p>
          </div>
        ) : null}
        {historicalTurns.map((turn) => (
          <article key={turn.turnId} className="composer-chat__exchange">
            <div className="composer-chat__user"><span>You</span><p>{turn.prompt}</p></div>
            <div className="composer-chat__assistant composer-chat__assistant--history">
              <span>Composer</span>
              {turn.model ? <LiveAssistant model={turn.model} /> : (
                <p>{turn.error ? turn.error : turn.state === 'complete' ? 'Completed response' : turn.state}</p>
              )}
            </div>
          </article>
        ))}
        {livePrompt ? (
          <article className="composer-chat__exchange" data-testid="composer-live-turn">
            <div className="composer-chat__user"><span>You</span><p>{livePrompt}</p></div>
            {liveModel ? <LiveAssistant model={liveModel} /> : <p className="composer-chat__working">Composer is working…</p>}
          </article>
        ) : null}
      </div>

      <form className="composer-chat__input" aria-label="Composer prompt" onSubmit={(event) => void onSubmit(event)}>
        <textarea
          aria-label="Prompt"
          value={prompt}
          placeholder="Describe what you want to research, build, or change…"
          onChange={(event) => setPrompt(event.target.value)}
          disabled={status === 'running'}
        />
        <button
          type={status === 'running' ? 'button' : 'submit'}
          className="mc-btn mc-btn--primary composer-chat__primary"
          disabled={status !== 'running' && (!prompt.trim() || signingIn)}
          onClick={status === 'running' ? stop : undefined}
        >
          {status === 'running' ? 'Stop' : signingIn ? 'Unlocking…' : 'Send'}
        </button>
      </form>
      <p className="composer-chat__safety-note">Do not paste passwords, API keys, private keys, or access tokens.</p>
      {status === 'stopped' ? <p data-testid="composer-status" role="status">Stopped.</p> : null}
      {error ? <p data-testid="composer-status" role="alert">{error}</p> : null}
    </section>
  );
}

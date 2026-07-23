/**
 * C3 — the idea-first convergence surface. This is what the [+ New ▾] → "Idea…" entry mounts (replacing
 * C1's bare ComposerChat pane); it wraps three parts into one convergence flow:
 *
 *   1. A TYPE CHIP row — starts at `idea` (unknown). The operator sets a concrete type (task | workflow |
 *      skill | project | agent); setting it swaps that type's seedTemplate onto
 *      the NEXT turn. An optional `initialKind` prop lets C5's entity pickers pre-seed the type.
 *   2. The CHAT PANE — C1's ComposerChat, unchanged, driven through its injectable `stream` seam. Composer
 *      WRAPS the stream so the seed is composed on the seed turn: the first turn (and every turn right
 *      after a type switch) prepends `seedTemplate(currentKind, ideaText)` to the operator's text. The
 *      resume id ComposerChat threads is passed through UNTOUCHED — a type switch re-seeds the next turn
 *      but never tears down the in-flight session, so the operator's iteration survives a chip change while
 *      the fresh seed re-orients the same conversation toward the new target type.
 *   3. A DRAFT PREVIEW panel — a form-backed draft for the selected type (fields per C2's Draft types). It
 *      renders the exact target relpath, the branch class legibly, and inline validation from validateDraft.
 *      Deploy is DISABLED until validateDraft returns []; on click it calls the injected `onDeploy(plan)`
 *      (C4's dispatcher is built in parallel; C5 wires the real one — a fake is injected in tests).
 *
 * Composer adds NO new gate, NO new auth, NO I/O of its own: the chat rides ComposerChat's governed
 * /api/composer/turn path, and deploy is delegated to the injected dispatcher. Pure composition + UI.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ComposerChat } from './ComposerChat';
import { defaultComposerStream } from './chatClient';
import type { ComposerStreamFn } from './chatClient';
import type { Session } from '../lib/authClient';
import { RISK_TIERS, seedTemplate, toDeploy, validateDraft } from './artifactTypes';
import type {
  ArtifactKind,
  AgentDraft,
  DeployPlan,
  Problem,
  ProjectDraft,
  RiskTier,
  SeedKind,
  SkillDraft,
  TaskDraft,
  WorkflowDraft,
  WorkflowManagerDraft,
  WorkflowStageDraft,
} from './artifactTypes';
import type { ComposerSession } from './workspaceClient';
import '../styles/views/composer.css';

/** The seedable chips: `idea` (unknown, idea-first entry) then every concrete kind with a draft form.
 *  Explicit rather than derived so a future registry kind never silently grows a half-built chip. */
const CHIP_KINDS: SeedKind[] = ['idea', 'task', 'workflow', 'skill', 'project', 'agent'];

const CHIP_LABEL: Record<SeedKind, string> = {
  idea: 'Idea',
  task: 'Task',
  workflow: 'Workflow',
  skill: 'Skill',
  project: 'Project',
  agent: 'Agent',
};

/** Legible branch-class line for the preview: the governed discipline the write routes through. */
const BRANCH_LABEL = {
  coordination: 'coordination → ops',
  durable: 'durable → PR to main',
} as const;

export interface ComposerProps {
  composerSession?: ComposerSession;
  onComposerSessionChange?: (session: ComposerSession) => void;
  onRunningChange?: (running: boolean) => void;
  onOpenRun?: (runRef: string) => void;
  /** WebAuthn session token — forwarded to ComposerChat, which gates every turn on it (no token, no send). */
  sessionToken?: string;
  /** Point-of-action passkey mint for signed-out Composer chat. DeployOutcome uses the same callback for
   *  writes; Composer only forwards it to the chat pane. */
  onRequestSession?: () => Promise<Session | null>;
  /** Pre-seed the type. `idea` (default) is the idea-first entry; entity pickers (C5) pass a concrete kind. */
  initialKind?: SeedKind;
  /** Out-of-band idea text an entity picker may pre-fill; if set, it is the seed's idea and the operator's
   *  chat text elaborates it. When empty (the pure idea-first path) the operator's first message IS the idea. */
  ideaText?: string;
  /** Governed deploy dispatcher (C4). Invoked with the validated DeployPlan when Deploy is pressed. */
  onDeploy: (plan: DeployPlan) => void | Promise<void>;
  /** True while the wrapper is resolving auth or deploying. Disables the primary action to prevent duplicates. */
  deployPending?: boolean;
  /** Return to the underlying view — the Back affordance (parity with the former placeholder). */
  onBack?: () => void;
  /** Injected chat stream (DI seam, mirrors ComposerChat). Composer wraps it to compose the seed. */
  stream?: ComposerStreamFn;
  /** Optional slot rendered inside the draft panel, right after the Deploy button. C5 mounts the governed
   *  deploy-outcome strip here so the result appears where the operator pressed Deploy. Purely additive:
   *  when omitted (C3's original contract) the panel renders exactly as before. */
  renderOutcome?: React.ReactNode;
  /** Secondary immutable proposal review, shown after the primary conversation. */
  renderProposalReview?: React.ReactNode;
}

/** Today's date (YYYY-MM-DD) for rendered artifact metadata. The UI owns this impurity once at form
 *  initialization; the registry stays pure by taking dates in through each draft. */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** All draft fields across kinds, held flat so a single form state serves every type. */
interface FormState {
  // task
  project: string;
  action: string;
  target: string;
  riskTier: RiskTier;
  taskBody: string;
  taskOwner: string;
  // skill
  skillName: string;
  skillDescription: string;
  skillBody: string;
  skillDate: string;
  // workflow
  wfFilename: string;
  wfBody: string;
  wfProject: string;
  wfProfile: string;
  wfGovernedBy: string;
  wfManager: WorkflowManagerDraft;
  wfStages: WorkflowStageDraft[];
  // project
  projName: string;
  projDate: string;
  // agent
  agentId: string;
  agentRole: string;
  agentRuntime: string;
  agentModel: string;
  agentProjects: string;
  agentDescription: string;
  agentBody: string;
}

function initialForm(): FormState {
  return {
    project: '',
    action: '',
    target: '',
    riskTier: 'T2',
    taskBody: '',
    taskOwner: 'codex-worker',
    skillName: '',
    skillDescription: '',
    skillBody: '',
    skillDate: today(),
    wfFilename: '',
    wfBody: '',
    wfProject: '',
    wfProfile: '',
    wfGovernedBy: '',
    wfManager: {},
    wfStages: [{ id: 'stage-1', action: '', target: '.', workOrder: '', riskTier: 'T2', dependsOn: [] }],
    projName: '',
    projDate: today(),
    agentId: '',
    agentRole: 'work',
    agentRuntime: 'claude',
    agentModel: '',
    agentProjects: '',
    agentDescription: '',
    agentBody: '',
  };
}

/** Safe browser projection of the declaration metadata exposed by GET /api/agents. */
interface WorkflowRosterAgent {
  id: string;
  declared: boolean;
  projects: string[];
  runnerBound: boolean;
  defaultProfile: string | null;
  allowedProfiles: string[] | null;
}

type AssignmentRole = 'manager' | 'worker';

function profilePrefix(role: AssignmentRole): string {
  return `${role}:`;
}

function asWorkflowRosterAgent(value: unknown): WorkflowRosterAgent | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.id !== 'string'
    || raw.id === ''
    || typeof raw.declared !== 'boolean'
    || !Array.isArray(raw.projects)
    || raw.projects.some((project) => typeof project !== 'string')
    || typeof raw.runnerBound !== 'boolean'
    || (raw.defaultProfile !== undefined && raw.defaultProfile !== null && typeof raw.defaultProfile !== 'string')
    || (raw.allowedProfiles !== undefined
      && raw.allowedProfiles !== null
      && (!Array.isArray(raw.allowedProfiles) || raw.allowedProfiles.some((profile) => typeof profile !== 'string')))
  ) return null;
  return {
    id: raw.id,
    declared: raw.declared,
    projects: [...raw.projects] as string[],
    runnerBound: raw.runnerBound,
    defaultProfile: typeof raw.defaultProfile === 'string' && raw.defaultProfile !== '' ? raw.defaultProfile : null,
    allowedProfiles: Array.isArray(raw.allowedProfiles) ? [...raw.allowedProfiles] as string[] : null,
  };
}

function profilesForRole(agent: WorkflowRosterAgent, role: AssignmentRole): string[] {
  return (agent.allowedProfiles ?? []).filter((profile) => profile.startsWith(profilePrefix(role)));
}

function eligibleWorkflowAgents(
  agents: WorkflowRosterAgent[] | null,
  project: string,
  role: AssignmentRole,
): WorkflowRosterAgent[] {
  if (!agents || project === '') return [];
  return agents
    .filter((agent) => (
      agent.declared
      && agent.projects.includes(project)
      && agent.defaultProfile?.startsWith(profilePrefix(role))
      && profilesForRole(agent, role).length > 0
    ))
    .sort((left, right) => left.id.localeCompare(right.id));
}

/** Governance is project-scoped declaration metadata, deliberately independent of runner/profile eligibility. */
function eligibleGovernanceAgents(agents: WorkflowRosterAgent[] | null, project: string): WorkflowRosterAgent[] {
  if (!agents || project === '') return [];
  return agents
    .filter((agent) => agent.declared && agent.projects.includes(project))
    .sort((left, right) => left.id.localeCompare(right.id));
}

function assignmentForAgent(agent: WorkflowRosterAgent, role: AssignmentRole): WorkflowManagerDraft {
  const profiles = profilesForRole(agent, role);
  const profileId = agent.defaultProfile && profiles.includes(agent.defaultProfile)
    ? agent.defaultProfile
    : profiles[0];
  return profileId ? { agentId: agent.id, profileId } : {};
}

/** Build the concrete C2 draft for `kind` from the flat form state. `idea` has no draft (type unresolved). */
function buildDraft(
  kind: SeedKind,
  f: FormState,
): TaskDraft | SkillDraft | WorkflowDraft | ProjectDraft | AgentDraft | null {
  switch (kind) {
    case 'task':
      return { project: f.project, action: f.action, target: f.target, riskTier: f.riskTier, body: f.taskBody, owner: f.taskOwner };
    case 'skill':
      return { name: f.skillName, description: f.skillDescription, body: f.skillBody, date: f.skillDate };
    case 'workflow':
      return {
        filename: f.wfFilename,
        project: f.wfProject,
        profile: f.wfProfile,
        governedBy: f.wfGovernedBy === '' ? undefined : f.wfGovernedBy,
        manager: f.wfManager.agentId !== undefined || f.wfManager.profileId !== undefined ? f.wfManager : undefined,
        body: f.wfBody,
        stages: f.wfStages,
      };
    case 'project':
      return { name: f.projName, date: f.projDate };
    case 'agent':
      return {
        id: f.agentId,
        role: f.agentRole,
        runtime: f.agentRuntime,
        model: f.agentModel.trim() === '' ? undefined : f.agentModel,
        projects: f.agentProjects.split(',').map((p) => p.trim()).filter(Boolean),
        description: f.agentDescription,
        body: f.agentBody,
      };
    default:
      return null;
  }
}

/** Compose the seed turn's prompt: seedTemplate(kind, idea) plus the operator's text. When `ideaText` is
 *  empty (pure idea-first), the operator's message IS the idea and is embedded by the seed; when an entity
 *  picker pre-filled `ideaText`, the operator's message elaborates the pre-seeded idea. */
function composeSeed(kind: SeedKind, ideaText: string, operatorText: string): string {
  const hasIdea = ideaText.trim() !== '';
  const seed = seedTemplate(kind, hasIdea ? ideaText : operatorText);
  return hasIdea && operatorText.trim() !== '' ? `${seed}\n\n${operatorText}` : seed;
}

export function Composer({
  composerSession,
  onComposerSessionChange,
  onRunningChange,
  onOpenRun,
  sessionToken,
  onRequestSession,
  initialKind = 'idea',
  ideaText = '',
  onDeploy,
  deployPending = false,
  onBack,
  stream = defaultComposerStream,
  renderOutcome,
  renderProposalReview,
}: ComposerProps): React.JSX.Element {
  const [kind, setKind] = useState<SeedKind>(initialKind);
  const [form, setForm] = useState<FormState>(initialForm);
  const [workflowProfiles, setWorkflowProfiles] = useState<string[] | null>(null);
  const [workflowProfilesError, setWorkflowProfilesError] = useState(false);
  const [workflowAgents, setWorkflowAgents] = useState<WorkflowRosterAgent[] | null>(null);
  const [workflowAgentsError, setWorkflowAgentsError] = useState(false);

  // Profiles are server-owned execution policy. Do not infer a default: a workflow remains undeployable
  // until this read-only registry has loaded and the operator explicitly selects one.
  useEffect(() => {
    if (kind !== 'workflow' || workflowProfiles !== null) return;
    let cancelled = false;
    void fetch('/api/workflows/profiles')
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as { profiles?: unknown };
        if (!Array.isArray(body.profiles) || body.profiles.some((profile) => typeof profile !== 'string' || profile === '')) {
          throw new Error('invalid profile registry');
        }
        if (!cancelled) setWorkflowProfiles([...body.profiles].sort());
      })
      .catch(() => {
        if (!cancelled) setWorkflowProfilesError(true);
      });
    return () => { cancelled = true; };
  }, [kind, workflowProfiles]);

  // Agent declarations are composition metadata only: this read narrows the UI choices but cannot prove
  // a profile is live or an adapter is available. The compiler validates both before execution exists.
  useEffect(() => {
    if (kind !== 'workflow' || workflowAgents !== null) return;
    let cancelled = false;
    void fetch('/api/agents')
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.json() as unknown;
        if (!Array.isArray(body)) throw new Error('invalid agent roster');
        const agents = body.map(asWorkflowRosterAgent);
        if (agents.some((agent) => agent === null)) throw new Error('invalid agent roster');
        if (!cancelled) setWorkflowAgents(agents as WorkflowRosterAgent[]);
      })
      .catch(() => {
        if (!cancelled) setWorkflowAgentsError(true);
      });
    return () => { cancelled = true; };
  }, [kind, workflowAgents]);

  // Refs so the wrapped stream closure always reads the CURRENT kind and re-seed flag regardless of React
  // batching / closure staleness. The seed turn is: the first turn, and every turn right after a chip swap.
  const kindRef = useRef<SeedKind>(initialKind);
  const reseedPendingRef = useRef(composerSession ? composerSession.turns.length === 0 : true);

  const setField = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]): void =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  const selectKind = useCallback((next: SeedKind): void => {
    setKind(next);
    kindRef.current = next;
    // A type switch re-seeds the NEXT turn (mid-session too — resume id still threads through untouched).
    reseedPendingRef.current = true;
  }, []);

  // The stream Composer hands ComposerChat: identical signature, but on a seed turn it prepends the seed.
  // resumeId / token / onDelta / signal pass straight through so continuity + gating are ComposerChat's.
  const seedingStream: ComposerStreamFn = useCallback(
    (composerRef, operatorPrompt, token, onDelta, signal) => {
      let prompt = operatorPrompt;
      if (reseedPendingRef.current) {
        prompt = composeSeed(kindRef.current, ideaText, operatorPrompt);
        reseedPendingRef.current = false;
      }
      return stream(composerRef, prompt, token, onDelta, signal);
    },
    [stream, ideaText, composerSession],
  );

  const draft = buildDraft(kind, form);
  const draftProblems: Problem[] = kind === 'idea' || draft === null ? [] : validateDraft(kind, draft as never);
  const problems: Problem[] = kind === 'workflow' && workflowProfiles === null
    ? [...draftProblems, { field: 'profile', message: workflowProfilesError ? 'execution profiles could not be loaded' : 'execution profiles are loading' }]
    : draftProblems;
  const isConcrete = kind !== 'idea' && draft !== null;
  const isValid = isConcrete && problems.length === 0;
  const plan: DeployPlan | null = useMemo(
    () => (isValid && draft !== null ? toDeploy(kind as ArtifactKind, draft as never) : null),
    [isValid, kind, draft],
  );

  const onDeployClick = useCallback((): void => {
    if (plan && !deployPending) void onDeploy(plan);
  }, [plan, onDeploy, deployPending]);

  return (
    <section className="v-composer" aria-label="Composer">
      <header className="v-composer__head">
        <div>
          <h2 className="v-composer__title">{composerSession?.title ?? 'Composer'}</h2>
          <p className="v-composer__lede">
            Explore the idea with a read-only planning model, then open Draft &amp; run when the plan is ready.
          </p>
          {composerSession?.agent ? (
            <p className="v-composer__agent-target mc-mono" data-testid="composer-agent-target">
              Agent workspace · {composerSession.agent.id} · {composerSession.agent.path} · revision{' '}
              {composerSession.agent.sourceHash.slice(0, 12)}
            </p>
          ) : null}
        </div>
        {onBack ? <button type="button" className="mc-btn mc-btn--quiet" onClick={onBack}>Back</button> : null}
      </header>

      {/* ── Type chip row ─────────────────────────────────────────────────── */}
      <div className="v-composer__chat">
        <ComposerChat
          composerSession={composerSession}
          sessionToken={sessionToken}
          onRequestSession={onRequestSession}
          onSessionChange={onComposerSessionChange}
          onRunningChange={onRunningChange}
          onOpenRun={onOpenRun}
          stream={seedingStream}
        />
      </div>

      {renderProposalReview}

      <details className="v-composer__draft-run">
        <summary>Draft &amp; run</summary>
      <div className="v-composer__chips" role="group" aria-label="Artifact type">
        {CHIP_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            className={`v-composer__chip${k === kind ? ' v-composer__chip--active' : ''}`}
            aria-pressed={k === kind}
            onClick={() => selectKind(k)}
          >
            {CHIP_LABEL[k]}
          </button>
        ))}
        <span className="v-composer__type-note" data-testid="composer-type">
          type: {kind}
        </span>
      </div>

        {/* ── Chat pane (C1) ─────────────────────────────────────────────── */}

        {/* ── Draft preview panel ────────────────────────────────────────── */}
        <aside className="v-composer__draft" aria-label="Draft preview">
          <h3 className="v-composer__draft-title">Draft</h3>
          {!isConcrete ? (
            <p className="v-composer__draft-hint">
              Pick a type above (or let the conversation converge to one) to draft a deployable artifact.
            </p>
          ) : (
            <>
              <DraftForm
                kind={kind as ArtifactKind}
                form={form}
                setField={setField}
                workflowProfiles={workflowProfiles}
                workflowAgents={workflowAgents}
                workflowAgentsError={workflowAgentsError}
              />

              <p className="v-composer__deploy-note" data-testid="composer-deploy-note">
                {deployNote(kind as ArtifactKind)}
              </p>

              <dl className="v-composer__target">
                <dt>Target</dt>
                <dd className="v-composer__target-path" data-testid="composer-target">
                  {plan ? plan.relpath : '— resolves once the draft validates —'}
                </dd>
                <dt>Branch</dt>
                <dd data-testid="composer-branch">
                  {plan ? BRANCH_LABEL[plan.branchClass] : '—'}
                </dd>
              </dl>

              {problems.length > 0 ? (
                <ul className="v-composer__problems" aria-label="Validation problems">
                  {problems.map((p) => (
                    <li key={`${p.field}:${p.message}`} className="v-composer__problem">
                      <span className="v-composer__problem-field">{p.field}</span> {p.message}
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="v-composer__actions">
                <button
                  type="button"
                  className="mc-btn mc-btn--primary v-composer__deploy"
                  onClick={onDeployClick}
                  disabled={!isValid || deployPending}
                >
                  {deployPending ? (kind === 'task' ? 'Launching…' : 'Saving…') : kind === 'workflow' ? 'Save definition' : kind === 'task' ? 'Run task' : 'Deploy'}
                </button>
              </div>

              {/* C5 mounts the governed deploy-outcome strip here (result / refusal / follow-up saves). */}
              {renderOutcome}
            </>
          )}
        </aside>
      </details>
    </section>
  );
}

/** Per-kind draft form. Each field is aria-labelled so the operator (and tests) address it directly. */
function DraftForm({
  kind,
  form,
  setField,
  workflowProfiles,
  workflowAgents,
  workflowAgentsError,
}: {
  kind: ArtifactKind;
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  workflowProfiles: string[] | null;
  workflowAgents: WorkflowRosterAgent[] | null;
  workflowAgentsError: boolean;
}): React.JSX.Element {
  switch (kind) {
    case 'task':
      return (
        <div className="v-composer__fields">
          <Field label="Task project" value={form.project} onChange={(v) => setField('project', v)} />
          <Field label="Task action" value={form.action} onChange={(v) => setField('action', v)} />
          <Field label="Task target" value={form.target} onChange={(v) => setField('target', v)} />
          <label className="v-composer__field">
            <span className="v-composer__field-label">Runner</span>
            <select aria-label="Task runner" value={form.taskOwner} onChange={(e) => setField('taskOwner', e.target.value)}>
              <option value="codex-worker">Codex worker · background</option>
              <option value="">Unassigned · will not run</option>
            </select>
          </label>
          <label className="v-composer__field">
            <span className="v-composer__field-label">Risk tier</span>
            <select
              aria-label="Risk tier"
              value={form.riskTier}
              onChange={(e) => setField('riskTier', e.target.value as RiskTier)}
            >
              {RISK_TIERS.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <Field label="Task body" value={form.taskBody} onChange={(v) => setField('taskBody', v)} multiline />
        </div>
      );
    case 'skill':
      return (
        <div className="v-composer__fields">
          <Field label="Skill name" value={form.skillName} onChange={(v) => setField('skillName', v)} />
          <Field
            label="Skill description"
            value={form.skillDescription}
            onChange={(v) => setField('skillDescription', v)}
          />
          <Field label="Skill body" value={form.skillBody} onChange={(v) => setField('skillBody', v)} multiline />
        </div>
      );
    case 'workflow':
      const managerAgents = eligibleWorkflowAgents(workflowAgents, form.wfProject, 'manager');
      const workerAgents = eligibleWorkflowAgents(workflowAgents, form.wfProject, 'worker');
      const governanceAgents = eligibleGovernanceAgents(workflowAgents, form.wfProject);
      const updateWorkflowProject = (project: string): void => {
        // A declaration's project scope is part of the option filter. Changing it clears ownership and
        // assignments rather than leaving a hidden cross-project logical identity in the draft.
        setField('wfProject', project);
        setField('wfGovernedBy', '');
        setField('wfManager', {});
        setField('wfStages', form.wfStages.map((stage) => ({ ...stage, governedBy: undefined, agentId: undefined, profileId: undefined })));
      };
      return (
        <div className="v-composer__fields">
          <Field
            label="Workflow filename"
            value={form.wfFilename}
            onChange={(v) => setField('wfFilename', v)}
            placeholder="<slug>.md"
          />
          <Field label="Workflow project" value={form.wfProject} onChange={updateWorkflowProject} />
          <label className="v-composer__field">
            <span className="v-composer__field-label">Execution profile</span>
            <select
              aria-label="Execution profile"
              value={form.wfProfile}
              disabled={workflowProfiles === null}
              onChange={(e) => setField('wfProfile', e.target.value)}
            >
              <option value="">{workflowProfiles === null ? 'Loading profiles…' : 'Choose a profile…'}</option>
              {(workflowProfiles ?? []).map((profile) => <option key={profile} value={profile}>{profile}</option>)}
            </select>
          </label>
          <GovernanceControls
            label="Workflow governance"
            agentLabel="Workflow governor"
            agents={governanceAgents}
            value={form.wfGovernedBy}
            onChange={(governedBy) => setField('wfGovernedBy', governedBy)}
          />
          <AssignmentControls
            label="Workflow manager"
            agentLabel="Workflow manager agent"
            profileLabel="Workflow manager profile"
            agents={managerAgents}
            assignment={form.wfManager}
            role="manager"
            onChange={(next) => setField('wfManager', next)}
          />
          <p className="v-composer__deploy-note" data-testid="workflow-assignment-note">
            Logical assignments do not choose a technical executor or prove adapter availability. Composition
            and compile validate profile registry membership and adapter availability before execution.
            {workflowAgentsError ? ' Agent declarations could not be loaded; assignments remain optional.' : ''}
          </p>
          <Field label="Workflow notes" value={form.wfBody} onChange={(v) => setField('wfBody', v)} multiline />
          <div className="v-composer__stages" aria-label="Workflow stages">
            {form.wfStages.map((stage, index) => {
              const update = <K extends keyof WorkflowStageDraft>(key: K, value: WorkflowStageDraft[K]): void => {
                const next = form.wfStages.map((item, i) => i === index ? { ...item, [key]: value } : item);
                setField('wfStages', next);
              };
              return (
                <fieldset key={`${index}:${stage.id}`} className="v-composer__stage">
                  <legend>Stage {index + 1}</legend>
                  <Field label={`Stage ${index + 1} id`} value={stage.id} onChange={(v) => update('id', v)} />
                  <Field label={`Stage ${index + 1} action`} value={stage.action} onChange={(v) => update('action', v)} />
                  <Field label={`Stage ${index + 1} target`} value={stage.target} onChange={(v) => update('target', v)} />
                  <Field label={`Stage ${index + 1} work order`} value={stage.workOrder} onChange={(v) => update('workOrder', v)} multiline />
                  <Field
                    label={`Stage ${index + 1} dependencies`}
                    value={stage.dependsOn.join(', ')}
                    onChange={(v) => update('dependsOn', v.split(',').map((part) => part.trim()).filter(Boolean))}
                    placeholder="comma-separated stage ids"
                  />
                  <label className="v-composer__field">
                    <span className="v-composer__field-label">Risk tier</span>
                    <select value={stage.riskTier} onChange={(e) => update('riskTier', e.target.value as 'T1' | 'T2')}>
                      <option value="T1">T1</option><option value="T2">T2</option>
                    </select>
                  </label>
                  <GovernanceControls
                    label={`Stage ${index + 1} governance`}
                    agentLabel={`Stage ${index + 1} governor`}
                    agents={governanceAgents}
                    value={stage.governedBy ?? ''}
                    onChange={(governedBy) => update('governedBy', governedBy === '' ? undefined : governedBy)}
                  />
                  <AssignmentControls
                    label={`Stage ${index + 1} assignment`}
                    agentLabel={`Stage ${index + 1} agent`}
                    profileLabel={`Stage ${index + 1} profile`}
                    agents={workerAgents}
                    assignment={stage}
                    role="worker"
                    onChange={(next) => setField('wfStages', form.wfStages.map((item, i) => (
                      i === index ? { ...item, agentId: next.agentId, profileId: next.profileId } : item
                    )))}
                  />
                  {form.wfStages.length > 1 ? (
                    <button type="button" className="mc-btn mc-btn--quiet" onClick={() => setField('wfStages', form.wfStages.filter((_, i) => i !== index))}>
                      Remove stage
                    </button>
                  ) : null}
                </fieldset>
              );
            })}
            <button
              type="button"
              className="mc-btn mc-btn--quiet"
              onClick={() => setField('wfStages', [...form.wfStages, {
                id: `stage-${form.wfStages.length + 1}`,
                action: '', target: '.', workOrder: '', riskTier: 'T2',
                dependsOn: form.wfStages.length ? [form.wfStages.at(-1)!.id] : [],
              }])}
            >
              Add stage
            </button>
          </div>
        </div>
      );
    case 'project':
      return (
        <div className="v-composer__fields">
          <Field label="Project name" value={form.projName} onChange={(v) => setField('projName', v)} />
          <Field label="Project date" value={form.projDate} onChange={(v) => setField('projDate', v)} />
        </div>
      );
    case 'agent':
      return (
        <div className="v-composer__fields">
          <Field label="Agent id" value={form.agentId} onChange={(v) => setField('agentId', v)} />
          <label className="v-composer__field">
            <span className="v-composer__field-label">Agent role</span>
            <select aria-label="Agent role" value={form.agentRole} onChange={(e) => setField('agentRole', e.target.value)}>
              {['scout', 'manage', 'work', 'inspect', 'consolidate'].map((role) => <option key={role} value={role}>{role}</option>)}
            </select>
          </label>
          <label className="v-composer__field">
            <span className="v-composer__field-label">Agent runtime</span>
            <select aria-label="Agent runtime" value={form.agentRuntime} onChange={(e) => setField('agentRuntime', e.target.value)}>
              {['claude', 'codex'].map((runtime) => <option key={runtime} value={runtime}>{runtime}</option>)}
            </select>
          </label>
          <Field label="Agent model" value={form.agentModel} onChange={(v) => setField('agentModel', v)} placeholder="optional" />
          <Field label="Agent projects" value={form.agentProjects} onChange={(v) => setField('agentProjects', v)} placeholder="comma-separated" />
          <Field label="Agent description" value={form.agentDescription} onChange={(v) => setField('agentDescription', v)} />
          <Field label="Agent body" value={form.agentBody} onChange={(v) => setField('agentBody', v)} multiline />
        </div>
      );
  }
}

/** One ownership selector. It only changes `governedBy`; assignments retain their own controls. */
function GovernanceControls({
  label,
  agentLabel,
  agents,
  value,
  onChange,
}: {
  label: string;
  agentLabel: string;
  agents: WorkflowRosterAgent[];
  value: string;
  onChange: (governedBy: string) => void;
}): React.JSX.Element {
  return (
    <fieldset className="v-composer__stage" aria-label={label}>
      <legend>{label}</legend>
      <label className="v-composer__field">
        <span className="v-composer__field-label">Declared governor</span>
        <select aria-label={agentLabel} value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Unassigned governance</option>
          {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.id} · declared agent</option>)}
        </select>
      </label>
      <p className="v-composer__deploy-note">Governance records accountability only; it does not bind a runner or assign execution.</p>
    </fieldset>
  );
}

/** One logical assignment selector. It never exposes or changes a queue-card owner/runtime/model. */
function AssignmentControls({
  label,
  agentLabel,
  profileLabel,
  agents,
  assignment,
  role,
  onChange,
}: {
  label: string;
  agentLabel: string;
  profileLabel: string;
  agents: WorkflowRosterAgent[];
  assignment: Pick<WorkflowManagerDraft, 'agentId' | 'profileId'>;
  role: AssignmentRole;
  onChange: (assignment: WorkflowManagerDraft) => void;
}): React.JSX.Element {
  const selectedAgent = agents.find((agent) => agent.id === assignment.agentId);
  const profiles = selectedAgent ? profilesForRole(selectedAgent, role) : [];
  const selectedProfile = assignment.profileId ?? '';
  const isOverride = Boolean(
    selectedAgent
    && selectedAgent.defaultProfile
    && selectedProfile !== selectedAgent.defaultProfile,
  );

  return (
    <fieldset className="v-composer__stage" aria-label={label}>
      <legend>{label}</legend>
      <label className="v-composer__field">
        <span className="v-composer__field-label">Logical agent</span>
        <select
          aria-label={agentLabel}
          value={assignment.agentId ?? ''}
          onChange={(event) => {
            const agent = agents.find((candidate) => candidate.id === event.target.value);
            onChange(agent ? assignmentForAgent(agent, role) : {});
          }}
        >
          <option value="">No logical assignment</option>
          {agents.map((agent) => (
            <option key={agent.id} value={agent.id}>
              {agent.id} · {agent.runnerBound ? 'runner-bound' : 'declared only'}
            </option>
          ))}
        </select>
      </label>
      <label className="v-composer__field">
        <span className="v-composer__field-label">Declared execution profile</span>
        <select
          aria-label={profileLabel}
          value={selectedProfile}
          disabled={!selectedAgent}
          onChange={(event) => {
            if (!selectedAgent) return;
            onChange({ agentId: selectedAgent.id, profileId: event.target.value });
          }}
        >
          {!selectedAgent ? <option value="">Choose an agent first</option> : null}
          {profiles.map((profile) => <option key={profile} value={profile}>{profile}</option>)}
        </select>
      </label>
      {selectedAgent ? (
        <p className="v-composer__deploy-note" data-testid={`${agentLabel.replaceAll(' ', '-').toLowerCase()}-selection`}>
          {isOverride
            ? `Profile override — declared default: ${selectedAgent.defaultProfile}`
            : selectedAgent.defaultProfile === selectedProfile
              ? 'Declared default profile selected.'
              : 'No declared default profile for this assignment role.'}
        </p>
      ) : null}
    </fieldset>
  );
}

/** Honest boundary copy: deploy creates a governed record; it never promises that a runner executes it. */
function deployNote(kind: ArtifactKind): string {
  switch (kind) {
    case 'task':
      return 'Run task files a queue card assigned to its background runner and signals pickup. No Terminal tab is opened.';
    case 'workflow':
      return 'Save definition creates a canonical workflow definition; it does not run the workflow.';
    case 'skill':
      return 'Deploy registers a learned skill; it does not promote or activate the skill.';
    case 'project':
      return 'Deploy registers project scaffold files through the governed review path; it does not run project work.';
    case 'agent':
      return 'Deploy registers an agent with runner-bound: false. It does not provision or bind a runner.';
  }
}

function Field({
  label,
  value,
  onChange,
  multiline,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  placeholder?: string;
}): React.JSX.Element {
  return (
    <label className="v-composer__field">
      <span className="v-composer__field-label">{label}</span>
      {multiline ? (
        <textarea
          aria-label={label}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input
          type="text"
          aria-label={label}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </label>
  );
}

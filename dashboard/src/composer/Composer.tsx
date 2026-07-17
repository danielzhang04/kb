/**
 * C3 — the idea-first convergence surface. This is what the [+ New ▾] → "Idea…" entry mounts (replacing
 * C1's bare ComposerChat pane); it wraps three parts into one convergence flow:
 *
 *   1. A TYPE CHIP row — starts at `idea` (unknown). The operator sets a concrete type (task | workflow |
 *      skill | project — NEVER `agent`, which is deferred); setting it swaps that type's seedTemplate onto
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
import { useCallback, useMemo, useRef, useState } from 'react';
import { ComposerChat } from './ComposerChat';
import { defaultComposerStream } from './chatClient';
import type { ComposerStreamFn } from './chatClient';
import {
  ARTIFACT_KINDS,
  RISK_TIERS,
  seedTemplate,
  toDeploy,
  validateDraft,
} from './artifactTypes';
import type {
  ArtifactKind,
  DeployPlan,
  Problem,
  ProjectDraft,
  RiskTier,
  SeedKind,
  SkillDraft,
  TaskDraft,
  WorkflowDraft,
} from './artifactTypes';
import '../styles/views/composer.css';

/** The seedable chips: `idea` (unknown, idea-first entry) then the four concrete v1 kinds. `agent` is
 *  intentionally absent — deferred per the plan's Flagged #4. */
const CHIP_KINDS: SeedKind[] = ['idea', ...ARTIFACT_KINDS];

const CHIP_LABEL: Record<SeedKind, string> = {
  idea: 'Idea',
  task: 'Task',
  workflow: 'Workflow',
  skill: 'Skill',
  project: 'Project',
};

/** Legible branch-class line for the preview: the governed discipline the write routes through. */
const BRANCH_LABEL = {
  coordination: 'coordination → ops',
  durable: 'durable → PR to main',
} as const;

export interface ComposerProps {
  /** WebAuthn session token — forwarded to ComposerChat, which gates every turn on it (no token, no send). */
  sessionToken?: string;
  /** Pre-seed the type. `idea` (default) is the idea-first entry; entity pickers (C5) pass a concrete kind. */
  initialKind?: SeedKind;
  /** Out-of-band idea text an entity picker may pre-fill; if set, it is the seed's idea and the operator's
   *  chat text elaborates it. When empty (the pure idea-first path) the operator's first message IS the idea. */
  ideaText?: string;
  /** Governed deploy dispatcher (C4). Invoked with the validated DeployPlan when Deploy is pressed. */
  onDeploy: (plan: DeployPlan) => void | Promise<void>;
  /** Return to the underlying view — the Back affordance (parity with the former placeholder). */
  onBack: () => void;
  /** Injected chat stream (DI seam, mirrors ComposerChat). Composer wraps it to compose the seed. */
  stream?: ComposerStreamFn;
  /** Optional slot rendered inside the draft panel, right after the Deploy button. C5 mounts the governed
   *  deploy-outcome strip here so the result appears where the operator pressed Deploy. Purely additive:
   *  when omitted (C3's original contract) the panel renders exactly as before. */
  renderOutcome?: React.ReactNode;
}

/** Today's date (YYYY-MM-DD) for the project template's `{{date}}`. This is the ONE impurity the UI owns
 *  (the registry stays pure by taking the date IN); it seeds the editable Project date field. */
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
  // skill
  skillName: string;
  skillDescription: string;
  skillBody: string;
  // workflow
  wfFilename: string;
  wfBody: string;
  // project
  projName: string;
  projDate: string;
}

function initialForm(): FormState {
  return {
    project: '',
    action: '',
    target: '',
    riskTier: 'T2',
    taskBody: '',
    skillName: '',
    skillDescription: '',
    skillBody: '',
    wfFilename: '',
    wfBody: '',
    projName: '',
    projDate: today(),
  };
}

/** Build the concrete C2 draft for `kind` from the flat form state. `idea` has no draft (type unresolved). */
function buildDraft(kind: SeedKind, f: FormState): TaskDraft | SkillDraft | WorkflowDraft | ProjectDraft | null {
  switch (kind) {
    case 'task':
      return { project: f.project, action: f.action, target: f.target, riskTier: f.riskTier, body: f.taskBody };
    case 'skill':
      return { name: f.skillName, description: f.skillDescription, body: f.skillBody };
    case 'workflow':
      return { filename: f.wfFilename, body: f.wfBody };
    case 'project':
      return { name: f.projName, date: f.projDate };
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
  sessionToken,
  initialKind = 'idea',
  ideaText = '',
  onDeploy,
  onBack,
  stream = defaultComposerStream,
  renderOutcome,
}: ComposerProps): React.JSX.Element {
  const [kind, setKind] = useState<SeedKind>(initialKind);
  const [form, setForm] = useState<FormState>(initialForm);

  // Refs so the wrapped stream closure always reads the CURRENT kind and re-seed flag regardless of React
  // batching / closure staleness. The seed turn is: the first turn, and every turn right after a chip swap.
  const kindRef = useRef<SeedKind>(initialKind);
  const reseedPendingRef = useRef(true);

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
    (operatorPrompt, resumeId, token, onDelta, signal) => {
      let prompt = operatorPrompt;
      if (reseedPendingRef.current) {
        prompt = composeSeed(kindRef.current, ideaText, operatorPrompt);
        reseedPendingRef.current = false;
      }
      return stream(prompt, resumeId, token, onDelta, signal);
    },
    [stream, ideaText],
  );

  const draft = buildDraft(kind, form);
  const problems: Problem[] = kind === 'idea' || draft === null ? [] : validateDraft(kind, draft as never);
  const isConcrete = kind !== 'idea' && draft !== null;
  const isValid = isConcrete && problems.length === 0;
  const plan: DeployPlan | null = useMemo(
    () => (isValid && draft !== null ? toDeploy(kind as ArtifactKind, draft as never) : null),
    [isValid, kind, draft],
  );

  const onDeployClick = useCallback((): void => {
    if (plan) void onDeploy(plan);
  }, [plan, onDeploy]);

  return (
    <section className="v-composer" aria-label="Composer">
      <header className="v-composer__head">
        <div>
          <h2 className="v-composer__title">Composer</h2>
          <p className="v-composer__lede">
            Start from an idea and converge it to a typed, governed artifact.
          </p>
        </div>
        <button type="button" className="mc-btn mc-btn--quiet" onClick={onBack}>
          Back
        </button>
      </header>

      {/* ── Type chip row ─────────────────────────────────────────────────── */}
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

      <div className="v-composer__panes">
        {/* ── Chat pane (C1) ─────────────────────────────────────────────── */}
        <div className="v-composer__chat">
          <ComposerChat sessionToken={sessionToken} stream={seedingStream} />
        </div>

        {/* ── Draft preview panel ────────────────────────────────────────── */}
        <aside className="v-composer__draft" aria-label="Draft preview">
          <h3 className="v-composer__draft-title">Draft</h3>
          {!isConcrete ? (
            <p className="v-composer__draft-hint">
              Pick a type above (or let the conversation converge to one) to draft a deployable artifact.
            </p>
          ) : (
            <>
              <DraftForm kind={kind as ArtifactKind} form={form} setField={setField} />

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

              <button
                type="button"
                className="mc-btn mc-btn--primary v-composer__deploy"
                onClick={onDeployClick}
                disabled={!isValid}
              >
                Deploy
              </button>

              {/* C5 mounts the governed deploy-outcome strip here (result / refusal / follow-up saves). */}
              {renderOutcome}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}

/** Per-kind draft form. Each field is aria-labelled so the operator (and tests) address it directly. */
function DraftForm({
  kind,
  form,
  setField,
}: {
  kind: ArtifactKind;
  form: FormState;
  setField: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
}): React.JSX.Element {
  switch (kind) {
    case 'task':
      return (
        <div className="v-composer__fields">
          <Field label="Task project" value={form.project} onChange={(v) => setField('project', v)} />
          <Field label="Task action" value={form.action} onChange={(v) => setField('action', v)} />
          <Field label="Task target" value={form.target} onChange={(v) => setField('target', v)} />
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
      return (
        <div className="v-composer__fields">
          <Field
            label="Workflow filename"
            value={form.wfFilename}
            onChange={(v) => setField('wfFilename', v)}
            placeholder="wf_<name>.md"
          />
          <Field label="Workflow body" value={form.wfBody} onChange={(v) => setField('wfBody', v)} multiline />
        </div>
      );
    case 'project':
      return (
        <div className="v-composer__fields">
          <Field label="Project name" value={form.projName} onChange={(v) => setField('projName', v)} />
          <Field label="Project date" value={form.projDate} onChange={(v) => setField('projDate', v)} />
        </div>
      );
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

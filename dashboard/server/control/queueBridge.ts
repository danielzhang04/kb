/**
 * Wave A — the queue -> governed-engine bridge (T3: discovery + inverse filter predicate; NO dispatch).
 *
 * The bridge is the counterpart of the legacy `scripts/agent_runner.ps1` runner. Each executor claims a
 * disjoint slice of the queue, arbitrated by ONE frontmatter flag, `execution-controller`:
 *   - legacy runner claims iff `execution-controller != "dashboard"` (absent/null included) — ps1 step 6;
 *   - this bridge claims iff `execution-controller === "dashboard"` (the exact literal) AND
 *     `owner === <dashboard subject>` AND `state ∈ {inbox, working}`.
 * The two predicates partition the owner/state-matched card space with no overlap and no gap — that is
 * the double-execution guard. `bridgeClaimsCard` is the authoritative TS statement of the bridge side;
 * `scripts/queue_bridge_select.py#claims_card` is its Python mirror (unit-tested for parity on both
 * sides). Keeping the controller test an EXACT string equality — never a truthiness or "not legacy"
 * test — is what makes the partition hold.
 *
 * This module (T3) only DISCOVERS owned cards and gates a poll tick on the shared preamble (STOP file +
 * budget, via `assertFleetRunnable`, D7 — never re-implemented in TS). Mapping a card to a run and
 * driving the launch machinery is T4/T5, injected through `dispatch`.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with explicit `.ts` specifiers.
 */
import { defaultPyRunner, type PyRunner } from '../write/launch.ts';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { assertFleetRunnable, type PreambleRunner } from '../write/preambleGate.ts';
import { DASHBOARD_EXECUTOR_SUBJECT, createInternalServiceCaller } from './activation.ts';
import type { InternalServiceCaller } from '../auth/session.ts';
import { MAX_DEFINITION_BYTES, instantiateWorkflowDef, parseWorkflowDef, type WorkflowDef } from '../workflows/defs.ts';
import { compileWorkflowDef } from '../workflows/compile.ts';
import { loadRuntimeSkillRegistry, workflowProfileIds, type RuntimeSkillRegistry } from './environment.ts';
import { validateServerCompiledPlanProposal, type ProposalRiskTier } from './proposal.ts';
import { proposalSnapshotHash, type ControlPlaneStore } from './store.ts';
import { executeApprovedLaunch, type LaunchOutcome } from './launch.ts';
import type { JsonObject, RunDetail } from './types.ts';
import { auditFn, type SurfaceContext } from '../http/context.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import { commitPreparedCoordination, defaultGitRunner, prepareCoordination, type GitRunner } from '../write/branch.ts';
import type { CoordinationPublication } from '../write/outbox.ts';

export class QueueBridgeError extends Error {}

/** The claim-relevant slice of a card's parsed frontmatter. Only these three fields decide ownership. */
export interface CardClaimMeta {
  'execution-controller'?: string | null;
  owner?: string | null;
  state?: string | null;
}

/** The literal controller value that routes a card to the dashboard engine. */
export const DASHBOARD_CONTROLLER = 'dashboard';
/** The only two states a card can be claimed in — matches the legacy runner's inbox|working scan. */
export const CLAIMABLE_STATES: readonly string[] = ['inbox', 'working'];

/**
 * The bridge side of the double-execution guard: true iff the dashboard engine (not the legacy runner)
 * owns this card. The exact inverse, on the `execution-controller` axis, of `agent_runner.ps1` step 6.
 * `subject` defaults to the single dashboard executor identity (D1); T4 re-asserts this on the full card
 * meta read at dispatch time, so a card the Python selector returned is never dispatched on stale state.
 */
export function bridgeClaimsCard(meta: CardClaimMeta, subject: string = DASHBOARD_EXECUTOR_SUBJECT): boolean {
  return meta['execution-controller'] === DASHBOARD_CONTROLLER
    && meta.owner === subject
    && typeof meta.state === 'string'
    && CLAIMABLE_STATES.includes(meta.state);
}

/** One discovered, bridge-owned card. `path` is repo-relative (as emitted by the Python selector). */
export interface OwnedCard {
  id: string;
  path: string;
  state: string;
}

/**
 * The embedded-python invocation (CANONICAL_RESULT_*_SCRIPT discipline): a fixed, non-interpolated script
 * whose ONLY input, the JSON op, arrives as `sys.argv[1]`. It defers all parsing/filtering to the
 * committed `scripts/queue_bridge_select.py` module (so `cards.parse` semantics are identical to the
 * legacy runner and the same code is exercised by `tests/test_queue_bridge_select.py`).
 */
export const QUEUE_BRIDGE_SELECT_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import queue_bridge_select
op = json.loads(sys.argv[1])
print(json.dumps(queue_bridge_select.select_owned_dashboard_cards(Path(op.get("queueRoot", "queue")), op["subject"])))
`.trim();

export interface ScanDeps {
  repoRoot: string;
  runPy?: PyRunner;
}

export interface ScanOptions {
  subject?: string;
  /** Overrides the default `queue` root (repo-relative), for tests/fixtures. */
  queueRoot?: string;
}

/**
 * Enumerate `queue/inbox` + `queue/working` under the ops repo and return the bridge-owned cards, via the
 * Python selector for parse-parity with `cards.py`. Fail-closed: a non-zero selector exit or unparseable
 * JSON throws (the poller catches and reports) rather than silently returning an empty claim set.
 */
export function scanOwnedDashboardCards(deps: ScanDeps, options: ScanOptions = {}): OwnedCard[] {
  const runPy = deps.runPy ?? defaultPyRunner;
  const subject = options.subject ?? DASHBOARD_EXECUTOR_SUBJECT;
  const op: Record<string, string> = { subject };
  if (options.queueRoot !== undefined) op.queueRoot = options.queueRoot;

  const result = runPy(deps.repoRoot, QUEUE_BRIDGE_SELECT_SCRIPT, JSON.stringify(op));
  if (result.exitCode !== 0) {
    throw new QueueBridgeError(
      `queue selector exited ${result.exitCode}: ${result.stderr.trim() || result.stdout.trim() || '(no output)'}`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(result.stdout.trim() || '[]');
  } catch (err) {
    throw new QueueBridgeError(`queue selector produced unparseable JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!Array.isArray(parsed)) throw new QueueBridgeError('queue selector did not return a JSON array');
  return parsed.map((row) => {
    const r = row as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.path !== 'string' || typeof r.state !== 'string') {
      throw new QueueBridgeError('queue selector row missing id/path/state');
    }
    return { id: r.id, path: r.path, state: r.state };
  });
}

export interface QueueBridgeOptions {
  repoRoot: string;
  subject?: string;
  runPy?: PyRunner;
  runPreamble?: PreambleRunner;
  queueRoot?: string;
  /**
   * Dispatch one owned card. T3 default: a no-op (discovery only). T4/T5 supply the real drive
   * (card -> workflow request -> `executeApprovedLaunch` -> fleet ledger). Awaited per card so a slow
   * dispatch cannot overlap the next.
   */
  dispatch?: (card: OwnedCard) => Promise<void>;
  /** Surfaces a tick error without crashing the interval (default: swallow). */
  onError?: (err: unknown) => void;
}

export interface QueueBridgeTickResult {
  /** false when a prior tick was still in flight (single-flight guard skipped this one). */
  ran: boolean;
  /** true when the preamble/STOP/budget gate refused — nothing was scanned or dispatched. */
  blocked: boolean;
  discovered: number;
  dispatched: number;
}

export interface QueueBridge {
  /** Run one poll cycle: preamble gate -> scan -> dispatch each owned card. Single-flight. */
  tick(): Promise<QueueBridgeTickResult>;
  /** Begin polling every `intervalMs`. Idempotent; the interval is unref'd so it never holds the loop open. */
  start(intervalMs: number): void;
  stop(): void;
}

const NOOP_DISPATCH = async (_card: OwnedCard): Promise<void> => {};

/**
 * Create the bridge poller. The tick gates on `assertFleetRunnable` (the sanctioned preamble seam, D7)
 * BEFORE any scan or dispatch, so a present STOP file or blown budget halts the bridge exactly as it
 * halts every other governed writer. A single-flight guard prevents overlapping ticks.
 */
export function createQueueBridge(options: QueueBridgeOptions): QueueBridge {
  const subject = options.subject ?? DASHBOARD_EXECUTOR_SUBJECT;
  const dispatch = options.dispatch ?? NOOP_DISPATCH;
  const onError = options.onError ?? (() => {});
  let running = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  async function tick(): Promise<QueueBridgeTickResult> {
    if (running) return { ran: false, blocked: false, discovered: 0, dispatched: 0 };
    running = true;
    try {
      // D7: STOP file + budget gate via the shared preamble — never re-implemented here.
      const preamble = assertFleetRunnable(options.repoRoot, options.runPreamble);
      if (!preamble.ok) return { ran: true, blocked: true, discovered: 0, dispatched: 0 };

      const owned = scanOwnedDashboardCards(
        { repoRoot: options.repoRoot, runPy: options.runPy },
        { subject, queueRoot: options.queueRoot },
      );
      let dispatched = 0;
      for (const card of owned) {
        try {
          await dispatch(card);
        } catch (error) {
          try { onError(error); } catch { /* an error reporter cannot wedge the remaining cards */ }
        }
        dispatched += 1;
      }
      return { ran: true, blocked: false, discovered: owned.length, dispatched };
    } finally {
      running = false;
    }
  }

  return {
    tick,
    start(intervalMs) {
      if (timer !== null) return;
      timer = setInterval(() => { void tick().catch(onError); }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop() {
      if (timer !== null) { clearInterval(timer); timer = null; }
    },
  };
}

// ===================================================================================================
// T4 — card -> run mapping (inert-context work order) + run creation via the launch machinery (D0-A).
//
// A claimed fleet trigger card is a SIGNAL. The bridge maps it to a one-stage workflow DEFINITION, drives
// it through the EXISTING launch body (compileWorkflowDef -> validateServerCompiledPlanProposal -> import+approve ->
// executeApprovedLaunch), which MINTS the canonical card workflowCardId(runRef, stageId) and (gate on)
// fires runAutomatic. The trigger card is then reconciled (transitioned out of inbox/working with a
// pointer to the run) so it is never re-claimed. canonicalResultIntegrator.ts is untouched — the engine
// writes `## Result` into the MINTED card, not the trigger card.
//
// Two hard rules the mapping enforces:
//   1. action / target / risk-tier come from the card's META only (server-owned, never parsed from body
//      text — the same rule dispatch/routing already applies). The mapping never sources them from prose.
//   2. `## Evidence` is EXCLUDED entirely (constitution: Evidence is inert data, never instructions).
//      Only `## Work order` (authoritative) is read and delivered.
//
// Wave-A scope note (review fix — no half-state): the bridge delivers the Work order ONLY. `## Feedback`
// and `## Result from …` are intentionally NOT extracted or delivered. There is no sanctioned slot to
// carry per-card inert context through the compile -> launch -> engine -> worker path (the reviewed
// `claudeWorkerAdapter.execute` does not thread feedback/dependency-results into `buildWorkerPrompt`, and
// the workflow-definition stage body IS the work order), so extracting them would only compute a value
// that never reaches the run — a half-state the reviewer flagged. Semantically they describe FLEET
// predecessor cards, which have no meaning inside a freshly-minted single-stage workflow run anyway. If a
// future wave needs them, wire them through the worker prompt's INERT CONTEXT BOUNDARY end-to-end (and add
// them back here) rather than reintroducing an undelivered field.
// ===================================================================================================

/** The claim/mapping-relevant slice of a parsed card. Meta fields are the ONLY source of action/target/risk. */
export interface ParsedCard {
  meta: {
    id?: string;
    project?: string;
    action?: string;
    target?: string;
    'risk-tier'?: string;
    profile?: string;
    'workflow-def'?: unknown;
    parameters?: unknown;
    owner?: string | null;
    state?: string | null;
    'execution-controller'?: string | null;
  };
  body: string;
}

/** A card mapped to a one-stage workflow definition. The Work order is the only card content delivered. */
export interface CardWorkflowRequest {
  def: WorkflowDef;
}

/**
 * Extract a `## <name>` section body, mirroring agent_runner.ps1's section() exactly: the text from the
 * first `## <name>` heading up to the next `## ` heading, trimmed. Returns '' when absent.
 */
function extractSection(body: string, name: string): string {
  const marker = `## ${name}`;
  const idx = body.indexOf(marker);
  if (idx === -1) return '';
  const rest = body.slice(idx + marker.length);
  const end = rest.indexOf('\n## ');
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

/** Read only the sanctioned, delivered section. `## Evidence` (and, for Wave A, Feedback/Result-from) is never referenced here. */
export function parseCardSections(body: string): { workOrder: string } {
  return { workOrder: extractSection(body, 'Work order') };
}

function requireMetaString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new QueueBridgeError(`card meta '${field}' is required to map to a governed run`);
  }
  return value;
}

export interface CardToWorkflowOptions {
  /** When supplied, the card's `profile` must name a server-owned execution profile (fail-closed). */
  knownProfiles?: ReadonlySet<string>;
  /** Required only for a card naming a registered workflow definition. */
  repoRoot?: string;
  /** File-read seam used only after the definition's lstat size cap passes. */
  readDefinitionFile?: (path: string) => string;
}

const SAFE_WORKFLOW_SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const RISK_TIER_RANK: Record<ProposalRiskTier, number> = { T1: 1, T2: 2, T3: 3 };

function highestRiskTier(stages: readonly { riskTier: ProposalRiskTier }[]): ProposalRiskTier {
  return stages.reduce<ProposalRiskTier>(
    (highest, stage) => RISK_TIER_RANK[stage.riskTier] > RISK_TIER_RANK[highest] ? stage.riskTier : highest,
    'T1',
  );
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function registeredWorkflowRequest(
  card: ParsedCard,
  id: string,
  project: string,
  options: CardToWorkflowOptions,
): CardWorkflowRequest {
  const workflowId = card.meta['workflow-def'];
  if (typeof workflowId !== 'string' || !SAFE_WORKFLOW_SEGMENT_RE.test(workflowId)) {
    throw new QueueBridgeError(`card '${id}' workflow-def must be a safe identifier`);
  }
  if (!SAFE_WORKFLOW_SEGMENT_RE.test(project)) {
    throw new QueueBridgeError(`card '${id}' project must be a safe identifier`);
  }
  if (typeof options.repoRoot !== 'string' || options.repoRoot.trim() === '') {
    throw new QueueBridgeError(`card '${id}' names workflow-def '${workflowId}' but no repository root was supplied`);
  }

  let source: string;
  try {
    const rootReal = realpathSync(resolve(options.repoRoot));
    const projectDir = join(rootReal, 'orgs', project);
    if (!lstatSync(projectDir).isDirectory() || lstatSync(projectDir).isSymbolicLink()) {
      throw new QueueBridgeError(`registered workflow definition '${workflowId}' was not found in project '${project}'`);
    }
    const projectReal = realpathSync(projectDir);
    const workflowsDir = join(projectReal, 'workflows');
    if (!isWithin(rootReal, projectReal)
      || !lstatSync(workflowsDir).isDirectory()
      || lstatSync(workflowsDir).isSymbolicLink()) {
      throw new QueueBridgeError(`registered workflow definition '${workflowId}' was not found in project '${project}'`);
    }
    const workflowsReal = realpathSync(workflowsDir);
    if (!isWithin(projectReal, workflowsReal)) {
      throw new QueueBridgeError(`registered workflow definition '${workflowId}' escapes project '${project}'`);
    }
    const candidate = join(workflowsReal, `${workflowId}.md`);
    const candidateStat = lstatSync(candidate);
    if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
      throw new QueueBridgeError(`registered workflow definition '${workflowId}' was not found in project '${project}'`);
    }
    if (candidateStat.size > MAX_DEFINITION_BYTES) {
      throw new QueueBridgeError(`registered workflow definition '${workflowId}' is invalid: definition must be at most ${MAX_DEFINITION_BYTES} bytes`);
    }
    const fileReal = realpathSync(candidate);
    if (!isWithin(workflowsReal, fileReal)) {
      throw new QueueBridgeError(`registered workflow definition '${workflowId}' escapes project '${project}'`);
    }
    source = options.readDefinitionFile?.(fileReal) ?? readFileSync(fileReal, 'utf8');
  } catch (error) {
    if (error instanceof QueueBridgeError) throw error;
    throw new QueueBridgeError(`registered workflow definition '${workflowId}' was not found in project '${project}'`);
  }

  const parsed = parseWorkflowDef(source, { knownProfiles: options.knownProfiles });
  if (!parsed.ok) {
    console.error(`queue bridge definition '${workflowId}' failed to parse`, parsed.detail);
    throw new QueueBridgeError(`registered workflow definition '${workflowId}' failed to parse`);
  }
  if (parsed.value.id !== workflowId) {
    throw new QueueBridgeError(`registered workflow definition id '${parsed.value.id}' does not match requested id '${workflowId}'`);
  }
  if (parsed.value.project !== project) {
    throw new QueueBridgeError(`registered workflow definition project '${parsed.value.project}' does not match card project '${project}'`);
  }

  const rawParameters = card.meta.parameters;
  if (rawParameters !== undefined && (rawParameters === null || typeof rawParameters !== 'object' || Array.isArray(rawParameters))) {
    throw new QueueBridgeError(`card '${id}' parameters must be a YAML mapping`);
  }
  const instantiated = instantiateWorkflowDef(
    parsed.value,
    (rawParameters ?? {}) as Record<string, string>,
  );
  if (!instantiated.ok) {
    throw new QueueBridgeError(`card '${id}' cannot instantiate workflow-def '${workflowId}': ${instantiated.detail}`);
  }
  const requiredTier = highestRiskTier(instantiated.value.stages);
  const cardTier = card.meta['risk-tier'];
  if ((cardTier !== 'T1' && cardTier !== 'T2' && cardTier !== 'T3')
    || RISK_TIER_RANK[cardTier] < RISK_TIER_RANK[requiredTier]) {
    throw new QueueBridgeError(`card '${id}' risk-tier is below the workflow definition's required tier ${requiredTier}`);
  }

  // The existing launch shape has no run-level context slot. The trigger card's Work order therefore
  // remains advisory for a registered definition; its parsed per-stage workOrders are authoritative.
  return { def: instantiated.value };
}

/**
 * Map a claimed card to a one-stage workflow request. action/target/risk-tier are read from META; the
 * `## Work order` section is the authoritative stage work order; `## Evidence` is excluded; Feedback and
 * Result-from ride along as inert context only.
 *
 * The definition is SYNTHESIZED as workflow-definition markdown and round-tripped through the server-owned
 * parseWorkflowDef, so EVERY server-owned guard (safe action/path, org containment, the classified risk
 * FLOOR — prose can never lower it, forbidden-namespace refusal, NUL/byte bounds) applies unchanged. The
 * bridge re-implements none of that validation.
 */
export function cardToWorkflowRequest(card: ParsedCard, options: CardToWorkflowOptions = {}): CardWorkflowRequest {
  const id = requireMetaString(card.meta.id, 'id');
  const project = requireMetaString(card.meta.project, 'project');
  // `workflow-def: null` is an invalid declaration and is rejected; only an absent key uses synthesis.
  if (card.meta['workflow-def'] !== undefined) {
    return registeredWorkflowRequest(card, id, project, options);
  }
  const action = requireMetaString(card.meta.action, 'action');
  const target = requireMetaString(card.meta.target, 'target');
  const profile = requireMetaString(card.meta.profile, 'profile');
  const riskTier = typeof card.meta['risk-tier'] === 'string' ? card.meta['risk-tier'] : null;

  const sections = parseCardSections(card.body);
  if (sections.workOrder.trim() === '') {
    throw new QueueBridgeError(`card '${id}' has no '## Work order' section; nothing authoritative to run`);
  }

  // Synthesize the definition markdown. Every scalar is JSON-quoted (valid YAML) so a value can never
  // break the frontmatter; the authoritative work order is the Markdown BODY (multi-line safe), which the
  // single stage inherits. action/target/riskTier are the META values — never body text. Evidence is not
  // present in the source at all.
  const stageLines = [
    'stages:',
    '  - id: "run"',
    `    title: ${JSON.stringify(`Run ${action}`)}`,
    `    action: ${JSON.stringify(action)}`,
    `    target: ${JSON.stringify(target)}`,
  ];
  if (riskTier !== null) stageLines.push(`    riskTier: ${JSON.stringify(riskTier)}`);
  const markdown = [
    '---',
    `id: ${JSON.stringify(`bridge-${id}`)}`,
    `project: ${JSON.stringify(project)}`,
    `title: ${JSON.stringify(`Bridged trigger card ${id}`)}`,
    `profile: ${JSON.stringify(profile)}`,
    ...stageLines,
    '---',
    '',
    sections.workOrder,
    '',
  ].join('\n');

  const parsed = parseWorkflowDef(markdown, { knownProfiles: options.knownProfiles });
  if (!parsed.ok) {
    throw new QueueBridgeError(`card '${id}' does not map to a valid governed workflow: ${parsed.detail}`);
  }
  return { def: parsed.value };
}

/**
 * Read a full card (meta + body) from its repo-relative path, via cards.parse for exact parity.
 *
 * `default=str` (2026-08-11 fix): YAML auto-types a bare frontmatter scalar like `2026-08-04` into a
 * Python `datetime.date`, which the stdlib `json` module cannot serialize — an UNGUARDED `json.dumps`
 * raised `TypeError: Object of type date is not JSON serializable` for any such card, so the bridge could
 * never read it (a 500 'failed' dispatch outcome, plus a noisy traceback on stderr). `default=str` is the
 * standard escape hatch: for any value `json.dumps` cannot natively encode, it calls `str(value)` instead
 * of raising, so the value reaches the TS side as a string and the card is readable.
 *
 * What that string IS, precisely: for `date`, `str()` is the ISO-8601 form (`date(2026,8,4)` ->
 * "2026-08-04"). For `datetime` it is NOT — `str()` joins date and time with a SPACE where ISO-8601 uses
 * 'T' ("2026-08-04 09:30:00"), and the same goes for any other type this fallback stringifies. Nothing
 * downstream parses a meta value as a timestamp (the bridge reads `id`/`owner`/`state`/`profile`/
 * `action`/`target`/`risk-tier`/`parameters`, all strings by construction), so this is a faithfulness
 * note, not a live defect: if a consumer ever does need one, normalize it in THIS script with an
 * `isoformat()`-aware default rather than teaching the TS side to parse Python's `str()`.
 */
export const QUEUE_BRIDGE_READ_CARD_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards
op = json.loads(sys.argv[1])
card = cards.parse(Path(op["path"]))
print(json.dumps({"meta": card.meta, "body": card.body}, default=str))
`.trim();

/**
 * Walk the trigger card out of inbox/working to `done`, appending a `## Bridged run` pointer to the minted
 * run so the signal card is traceable and never re-claimed. Runs inside the ops transaction (the default
 * reconciler commits it there); returns the card's new path. `## Result` is deliberately NOT written here
 * — that belongs to the minted canonical card, written by the untouched canonical integrator.
 */
export const QUEUE_BRIDGE_RECONCILE_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards
op = json.loads(sys.argv[1])
card_id = op["cardId"]
run_ref = op["runRef"]
candidates = [Path("queue/inbox") / (card_id + ".md"), Path("queue/working") / (card_id + ".md")]
found = [p for p in candidates if p.is_file()]
if len(found) != 1:
    raise cards.ValidationError("trigger card is not in inbox/working (already reconciled?)")
card = cards.parse(found[0])
pointer = "## Bridged run\\n\\nThis trigger card was consumed by the dashboard engine and run as " + run_ref + ".\\n"
if "## Bridged run" not in card.body:
    card.body = card.body.rstrip() + "\\n\\n" + pointer
if card.meta.get("state") == "inbox":
    cards.transition(card, "working", Path("queue"))
result_path = cards.transition(card, "done", Path("queue"))
print(json.dumps({"resultPath": str(result_path)}))
`.trim();

/** The launch input executeApprovedLaunch consumes for a fresh (non-retry) bridge launch. */
type ApprovedLaunchArgs = Parameters<typeof executeApprovedLaunch>[2];

export interface DispatchCardDeps {
  subject?: string;
  loadRegistry?: (repoRoot: string) => RuntimeSkillRegistry;
  knownProfiles?: () => ReadonlySet<string>;
  compile?: typeof compileWorkflowDef;
  validate?: typeof validateServerCompiledPlanProposal;
  snapshotHash?: (snapshot: JsonObject) => string;
  launch?: (ctx: SurfaceContext, sub: string, input: ApprovedLaunchArgs) => Promise<LaunchOutcome>;
  readCard?: (ctx: SurfaceContext, cardPath: string) => ParsedCard;
  /** Durably transition the trigger card out of inbox/working; T7 exercises the default's ops commit. */
  reconcile?: (ctx: SurfaceContext, card: OwnedCard, runRef: string) => Promise<void>;
  /** The shared preamble seam re-asserted before dispatch (D7). Default: the real `scripts/preamble.py`. */
  runPreamble?: PreambleRunner;
  /**
   * Construct the sanctioned internal service caller presented to `executeApprovedLaunch` in lieu of a
   * WebAuthn session token (the bridge is a daemon-internal dispatcher with no human session). Default: the
   * `createInternalServiceCaller`, which requires either the headless env override or a fresh latch unlock
   * grant — so a bridge ever driven outside an armed window fails closed instead of launching
   * unauthenticated. Tests inject a stub to drive dispatch hermetically.
   */
  internalCaller?: (subject: string) => InternalServiceCaller;
  /** Re-assert that this dispatch still belongs to the same armed execution window. */
  isArmed?: () => boolean;
}

export interface DispatchCardResult {
  cardId: string;
  /**
   * launched: 201 fresh launch; replayed: 200 idempotent replay of a run this card already minted (the
   * trigger card is reconciled either way); gated: 202 activationGated (run published-parked, card kept
   * one tick); blocked: preamble/STOP refused; skipped: not claimed; failed: refused.
   */
  outcome: 'launched' | 'replayed' | 'gated' | 'blocked' | 'skipped' | 'failed';
  status: number;
  runRef?: string;
  reconciled: boolean;
  detail?: string;
}

function defaultReadCard(ctx: SurfaceContext, cardPath: string): ParsedCard {
  const runPy = ctx.runPy ?? defaultPyRunner;
  const result = runPy(ctx.repoRoot, QUEUE_BRIDGE_READ_CARD_SCRIPT, JSON.stringify({ path: cardPath }));
  if (result.exitCode !== 0) {
    throw new QueueBridgeError(`could not read card ${cardPath}: ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return JSON.parse(result.stdout.trim()) as ParsedCard;
}

/**
 * Create the canonical run for one claimed card via the launch machinery. Idempotent per card: the
 * idempotencyKey/source are derived from the card id, so a re-tick after a crash replays the same run
 * rather than minting a duplicate. Reconciles the trigger card ONLY after a successful (201) launch — a
 * gated (202) or failed launch leaves it in place for the next tick / human.
 */
export async function dispatchClaimedCard(
  ctx: SurfaceContext,
  card: OwnedCard,
  deps: DispatchCardDeps = {},
): Promise<DispatchCardResult> {
  const subject = deps.subject ?? DASHBOARD_EXECUTOR_SUBJECT;
  const readCard = deps.readCard ?? defaultReadCard;
  const loadRegistry = deps.loadRegistry ?? loadRuntimeSkillRegistry;
  const knownProfiles = deps.knownProfiles ?? workflowProfileIds;
  const compile = deps.compile ?? compileWorkflowDef;
  const validate = deps.validate ?? validateServerCompiledPlanProposal;
  const snapshotHash = deps.snapshotHash ?? proposalSnapshotHash;
  const launch = deps.launch ?? executeApprovedLaunch;
  const reconcile = deps.reconcile ?? defaultReconcileTriggerCard;
  const internalCaller = deps.internalCaller ?? createInternalServiceCaller;

  // D7 belt-and-suspenders: re-assert the shared preamble (STOP file + budget) immediately before
  // dispatch, even though the poll tick already gated on it — a STOP dropped mid-batch must halt the very
  // next card, and never re-implemented in TS.
  const preamble = assertFleetRunnable(ctx.repoRoot, deps.runPreamble ?? ctx.runPreamble);
  if (!preamble.ok) {
    return { cardId: card.id, outcome: 'blocked', status: 0, reconciled: false, detail: preamble.problems[0] ?? 'preamble refused dispatch' };
  }

  try {
    // Re-assert the claim on the card's CURRENT meta: it may have changed between scan and dispatch.
    const parsed = readCard(ctx, card.path);
    if (!bridgeClaimsCard(parsed.meta, subject)) {
      return { cardId: card.id, outcome: 'skipped', status: 0, reconciled: false, detail: 'card no longer claimed by the bridge' };
    }

  let mapped: CardWorkflowRequest;
  try {
    mapped = cardToWorkflowRequest(parsed, { knownProfiles: knownProfiles(), repoRoot: ctx.repoRoot });
  } catch (error) {
    return { cardId: card.id, outcome: 'failed', status: 400, reconciled: false, detail: String(error) };
  }
  const registry = loadRegistry(ctx.repoRoot);
  const compiled = compile(mapped.def, { registry });
  if (!compiled.ok) return { cardId: card.id, outcome: 'failed', status: 400, reconciled: false, detail: `${compiled.reason}: ${compiled.detail}` };
  const validation = validate(compiled.value as unknown, registry);
  if (!validation.ok) return { cardId: card.id, outcome: 'failed', status: 500, reconciled: false, detail: `compiled-proposal-invalid: ${validation.detail}` };

  const proposal = validation.value;
  const snapshot = proposal as unknown as JsonObject;
  const contentHash = snapshotHash(snapshot);

  // Reuse the revision this exact card content already imported to (matched on sourceTurnId + hash), else
  // import a fresh one. An APPROVED match is used as-is; an UNDECIDED match (approval still null, e.g. a
  // prior tick whose decision audit threw AFTER createProposalRevision, or that crashed before deciding)
  // is REUSED rather than left behind — otherwise a repeatedly-failing audit mints a fresh undecided
  // revision every re-dispatch and leaks an unbounded pile of them. The audit + idempotent decide below
  // then run against whichever revision (fresh or reused-undecided) we settled on.
  //
  // WHY ADOPTING AN UNDECIDED REVISION IS SAFE — and what actually makes it safe. Re-driving someone
  // else's undecided revision to `approved` would be a real defect: `server/workflows/routes.ts` can
  // 500 AFTER `createProposalRevision` and leave an undecided revision behind for the SAME definition
  // id, and the bridge must never adopt that and approve it on the human's behalf. What prevents it is
  // NOT the sourceTurnId (since the Bug-B fix below, the bridge and the SPA route use the identical
  // one) and NOT the hash: it is SUBJECT OWNERSHIP. Proposal revisions are subject-scoped, the SPA
  // route creates under the operator's session subject, and this read is `'own-subject'` — the bridge's
  // own `dashboard-engine` — so the only revisions in `matching` are ones the bridge itself created.
  // The default read scope is therefore load-bearing here, not incidental: it must stay own-subject
  // even though the operator's READ surface is now cross-subject (`store.ts` {@link ReadScope}).
  // Pinned by 'refuses to adopt an undecided revision owned by another subject' in queueBridge.test.ts.
  //
  // Bug B fix (2026-08-11): match the SPA launch route's convention EXACTLY — routes.ts's
  // `launchDefinition` creates its proposal revision with `sourceComposerRef: 'workflow-registry'`,
  // `sourceTurnId: def.id` (no prefix). The Workflows view's run -> definition linkage
  // (`routes.ts#workflowRefIndex`) keys purely on `sourceTurnId` under that composer ref, matched
  // against each `WorkflowDefEntry.ref` (= the definition's `id`). A bridge-only `bridge:`-prefixed
  // sourceTurnId never matched any def's `ref`, so every def-card-launched run silently lost its
  // project/title linkage and was unreachable from its workflow's row. Reusing the identical
  // convention here is not a new risk: a bridge launch and a human SPA launch of the SAME definition
  // content are recognized as the same lineage only when `hash` also matches (see the
  // undecided/approved revision reuse a few lines below, which already relies on exactly that).
  const sourceTurnId = mapped.def.id;
  const idempotencyKey = `queue-bridge:${card.id}`;
  const matching = ctx.controlStore
    // Own-subject scope, explicitly: see the ownership argument above — this is what stops the bridge
    // approving a revision a human's failed launch left behind.
    .listProposalRevisionsForComposer(subject, 'workflow-registry', 'own-subject')
    .filter((c) => c.sourceTurnId === sourceTurnId && c.hash === contentHash);
  const approved = matching.find((c) => c.approval?.decision === 'approved');

  let proposalRef: string;
  let revision: number;
  if (approved) {
    proposalRef = approved.proposalRef;
    revision = approved.revision;
  } else {
    const undecided = matching.find((c) => !c.approval);
    if (undecided) {
      proposalRef = undecided.proposalRef;
      revision = undecided.revision;
    } else {
      const created = ctx.controlStore.createProposalRevision(subject, {
        sourceComposerRef: 'workflow-registry',
        sourceTurnId,
        title: proposal.title,
        snapshot,
      });
      if (!created.ok) return { cardId: card.id, outcome: 'failed', status: 400, reconciled: false, detail: `${created.reason}: ${created.detail}` };
      proposalRef = created.value.proposalRef;
      revision = created.value.revision;
    }

    const decisionRisk = proposal.stages.some((s) => s.riskTier === 'T3') ? 'T3'
      : proposal.stages.some((s) => s.riskTier === 'T2') ? 'T2' : 'T1';
    try {
      await auditFn(ctx)(ctx.repoRoot, {
        action: 'control-proposal-decision-authorize', owner: subject, target: proposalRef,
        riskTier: decisionRisk, result: `authorized:approved:${contentHash}`,
        detail: { proposalRef, revision, proposalHash: contentHash, decision: 'approved', source: `queue-bridge:${card.id}` },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return { cardId: card.id, outcome: 'failed', status: 500, reconciled: false, detail: 'decision-audit-required' };
    }
    const decided = ctx.controlStore.decideProposal(subject, proposalRef, revision, {
      expectedHash: contentHash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: `${idempotencyKey}:decision`,
    });
    if (!decided.ok) return { cardId: card.id, outcome: 'failed', status: 409, reconciled: false, detail: `${decided.reason}: ${decided.detail}` };
  }

  if (deps.isArmed && !deps.isArmed()) {
    return { cardId: card.id, outcome: 'failed', status: 409, reconciled: false, detail: 'execution window changed' };
  }
  const serviceCaller = internalCaller(subject);
  const result = await launch(ctx, subject, {
    proposalRef,
    revision,
    storedHash: contentHash,
    snapshot,
    // The bridge has no human WebAuthn session. It authorizes the launch of the run it just imported and
    // approved under its OWN subject with a gated internal service caller (constructible only when the
    // activation gate is on), NOT a token. The HTTP launch surfaces still require a WebAuthn token.
    sessionToken: undefined,
    internalService: serviceCaller,
    idempotencyKey,
    predecessorRunRef: null,
    expectedPredecessorVersion: -1,
    source: `queue-bridge:${card.id}`,
  });

  const runRef = typeof result.body.runRef === 'string' ? result.body.runRef : undefined;
  if (result.status === 201 && runRef) {
    await reconcile(ctx, card, runRef);
    return { cardId: card.id, outcome: 'launched', status: 201, runRef, reconciled: true };
  }
  if (result.status === 200 && runRef) {
    // A 200 from executeApprovedLaunch is ALWAYS an idempotent replay of the run THIS card already minted
    // (createRun matched the `queue-bridge:<id>` idempotency key). The run is durably published and owns
    // its own lifecycle now; the trigger card's signalling job is complete, so we reconcile it — the exact
    // defect the reviewer flagged: without this, a crash between the 201 launch and the reconcile (or a
    // gate-off park that later replays to 200) leaves the card re-dispatching forever as 'failed', never
    // cleared.
    //
    // Published-parked case (dispatched while the gate was off — the run is published but parked behind the
    // daemon's own governance-refusal "automatic execution activation is gated" human request, which
    // replays here as 200-published): we deliberately do NOT auto-resume it. Releasing a gated run is
    // Daniel's alone — the Wave-A authorization boundary is that only he flips the gate, in a watched
    // session; the bridge auto-starting a parked run would override that human governance gate. So we
    // reconcile the trigger card with a pointer to the parked run and leave releasing it to the human. The
    // parked run remains independently tracked by its own state + its open governance-refusal request.
    await reconcile(ctx, card, runRef);
    const detail = result.body.waitingHuman === true ? 'replayed-waiting-human' : 'replayed-published';
    return { cardId: card.id, outcome: 'replayed', status: 200, runRef, reconciled: true, detail };
  }
  if (result.status === 202 && result.body.activationGated === true) {
    // Gate is off (or broker absent): the run is published-and-parked. Do NOT reconcile on this FIRST park
    // — the very next tick observes the idempotent 200-published replay above and reconciles then (whether
    // or not the gate has since flipped), so the card is always eventually cleared while the parked run
    // still awaits Daniel's gate release.
    return { cardId: card.id, outcome: 'gated', status: 202, runRef, reconciled: false, detail: 'activationGated' };
  }
    return { cardId: card.id, outcome: 'failed', status: result.status, runRef, reconciled: false, detail: JSON.stringify(result.body) };
  } catch (error) {
    return { cardId: card.id, outcome: 'failed', status: 500, reconciled: false, detail: String(error) };
  }
}

/**
 * The default trigger-card reconciler: pull ops, move the card inbox/working -> done with a run pointer,
 * then commit that exact path set atomically to ops (reusing the coordination-commit discipline every
 * other governed writer uses — never hand-rolled git). Runs entirely inside one ops transaction. The pull
 * precedes the mutation so the move lands on top of the latest ops, mirroring the canonical integrator.
 * Its git mechanics are exercised end-to-end by the T7 human-supervised acceptance.
 */
async function defaultReconcileTriggerCard(ctx: SurfaceContext, card: OwnedCard, runRef: string): Promise<void> {
  const runPy = ctx.runPy ?? defaultPyRunner;
  const runGit = ctx.opsGit ?? defaultGitRunner;
  await withOpsTransaction(async () => {
    await prepareCoordination(ctx.repoRoot, runGit, ctx.coordinationPublication, ctx.outboxRoot);
    const res = runPy(ctx.repoRoot, QUEUE_BRIDGE_RECONCILE_SCRIPT, JSON.stringify({ cardId: card.id, runRef }));
    if (res.exitCode !== 0) {
      throw new QueueBridgeError(`trigger-card reconciliation failed: ${res.stderr.trim() || res.stdout.trim() || '(no output)'}`);
    }
    const donePath = `queue/done/${card.id}.md`;
    await commitPreparedCoordination(ctx.repoRoot, donePath, {
      runGit,
      alsoStage: [card.path],
      message: `chore(queue): reconcile bridged trigger card ${card.id} -> ${runRef}`,
      publication: ctx.coordinationPublication,
      outboxRoot: ctx.outboxRoot,
    });
  });
}

// ===================================================================================================
// T5 — dual ledger: the FLEET cost row (scripts/ledger.py-compatible) emitted from the bridge post-run
// seam. This is NOT a substitute for the control plane's own accounting (D8): the engine's
// AccountingAdapter writes the control-plane row; this writes the fleet row. Both, not either.
//
// The `## Result` writeback + `cards.transition` to done happen INSIDE the engine via
// createCanonicalGitResultIntegrator (wired in T2), under withOpsTransaction — this module does NOT
// re-implement writeback; the T7/T8 acceptance verifies that path end-to-end on the real daemon.
// ===================================================================================================

/** Append one fleet cost row via scripts/ledger.py (columns are the sorted record keys: billing/card_id/model/usd). */
export const QUEUE_BRIDGE_LEDGER_COST_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import ledger
op = json.loads(sys.argv[1])
path = ledger.append(Path("."), "cost", op["agent"], op["record"])
print(json.dumps({"path": str(path)}))
`.trim();

/** One fleet cost row. `usd` is the DERIVED dollar amount (micros/1e6) — 0.0 for subscription billing. */
export interface FleetCostRow {
  subject: string;
  model: string;
  cardId: string;
  usd: number;
}

/**
 * Emit one fleet `ledgers/cost/<subject>-<date>.tsv` row via scripts/ledger.py and RETURN the repo-relative
 * shard path the script appended to (backslashes normalized to forward slashes). `billing` is always
 * `subscription` (the fleet never spends metered dollars); `usd` is derived, never invented. Fail-closed:
 * a non-zero exit throws (a missed cost row is loud), and unparseable/path-less stdout throws too — an
 * appended row whose path the caller cannot recover would stay UNCOMMITTED and poison the next run's
 * canonical-integrator guard.
 */
export function emitFleetCostRow(deps: { repoRoot: string; runPy?: PyRunner }, row: FleetCostRow): string {
  const runPy = deps.runPy ?? defaultPyRunner;
  const record = { usd: row.usd, billing: 'subscription', model: row.model, card_id: row.cardId };
  const res = runPy(deps.repoRoot, QUEUE_BRIDGE_LEDGER_COST_SCRIPT, JSON.stringify({ agent: row.subject, record }));
  if (res.exitCode !== 0) {
    throw new QueueBridgeError(`fleet cost-ledger append failed: ${res.stderr.trim() || res.stdout.trim() || '(no output)'}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.stdout.trim());
  } catch {
    throw new QueueBridgeError(`fleet cost-ledger append returned unparseable stdout: ${res.stdout.trim() || '(empty)'}`);
  }
  const path = (parsed as { path?: unknown }).path;
  if (typeof path !== 'string' || path.length === 0) {
    throw new QueueBridgeError(`fleet cost-ledger append returned no path: ${res.stdout.trim() || '(empty)'}`);
  }
  return path.replace(/\\/g, '/');
}

const TERMINAL_STAGE_STATES: readonly string[] = ['succeeded', 'failed', 'stopped', 'interrupted'];

/** The cost-bearing facts of one terminal stage: its minted canonical card, its worker model, its usage. */
export interface TerminalStageCost {
  cardId: string;
  model: string;
  costUsdMicros: number;
}

/**
 * Project a control-plane RunDetail to the per-terminal-stage cost facts the fleet ledger needs: the
 * minted `canonicalCardRef`, the worker `model` from the stage's current attempt, and the usage micros
 * (read via `readUsageMicros` — the control-plane accounting is the source; subscription reports 0).
 * A stage with no minted card or no resolvable attempt model is skipped (nothing to bill).
 */
export function collectTerminalStageCosts(
  detail: RunDetail,
  readUsageMicros: (stageRef: string, attemptRef: string | null) => number,
): TerminalStageCost[] {
  const out: TerminalStageCost[] = [];
  for (const stage of detail.stages) {
    if (!TERMINAL_STAGE_STATES.includes(stage.state)) continue;
    if (!stage.canonicalCardRef) continue;
    const attempt = detail.attempts.find((a) => a.attemptRef === stage.currentAttemptRef);
    if (!attempt || !attempt.model) continue;
    out.push({
      cardId: stage.canonicalCardRef,
      model: attempt.model,
      costUsdMicros: readUsageMicros(stage.stageRef, stage.currentAttemptRef),
    });
  }
  return out;
}

export interface SettleFleetLedgerDeps {
  repoRoot: string;
  runPy?: PyRunner;
  runPreamble?: PreambleRunner;
  /** Ops-checkout git seam (D2.5). Injected for hermetic tests; defaults to the shared async runner. */
  opsGit?: GitRunner;
  publication?: CoordinationPublication;
  outboxRoot?: string;
}

export interface SettleFleetLedgerInput {
  subject?: string;
  runRef: string;
  stages: TerminalStageCost[];
}

export interface SettleFleetLedgerResult {
  emitted: number;
  blocked: boolean;
}

/**
 * The bridge post-run seam: emit one fleet cost row per terminal stage of a completed run, then COMMIT+PUSH
 * the appended shard(s) to `ops`. Gated on the shared preamble (D7) — a present STOP file or blown budget
 * suppresses emission entirely (`blocked`, no git), exactly like every other governed writer. `usd` is
 * derived from usage micros (0.0 for subscription).
 *
 * The rows are appended as UNTRACKED files; leaving them uncommitted trips the canonical integrator's
 * unrelated-change guard on the NEXT run (its allowlist rightly excludes ledgers/). So each run settles its
 * own rows through the governed coordination-commit discipline (never hand-rolled git): the checkout must be
 * `ops` (else it throws), the exact shard paths are staged and committed `--only`, and the push reconciles a
 * rejection once via `pull --rebase`. A final push failure LEAVES the local commit in place (the poison is
 * already cured — the integrator guard checks staged/dirty/untracked only, and a committed row is none) and
 * rethrows only to surface the unpushed row.
 */
export async function settleFleetCostLedger(deps: SettleFleetLedgerDeps, input: SettleFleetLedgerInput): Promise<SettleFleetLedgerResult> {
  const preamble = assertFleetRunnable(deps.repoRoot, deps.runPreamble);
  if (!preamble.ok) return { emitted: 0, blocked: true };
  const subject = input.subject ?? DASHBOARD_EXECUTOR_SUBJECT;
  const paths: string[] = []; // unique appended shards, first-seen order, committed atomically below
  let emitted = 0;
  for (const stage of input.stages) {
    const path = emitFleetCostRow({ repoRoot: deps.repoRoot, runPy: deps.runPy }, {
      subject,
      model: stage.model,
      cardId: stage.cardId,
      usd: stage.costUsdMicros / 1_000_000,
    });
    if (!paths.includes(path)) paths.push(path);
    emitted += 1;
  }
  if (paths.length > 0) {
    const [first, ...rest] = paths;
    await commitPreparedCoordination(deps.repoRoot, first, {
      runGit: deps.opsGit,
      alsoStage: rest,
      message: `chore(ledgers): settle fleet cost rows for ${input.runRef}`,
      maxRetryPushes: 1,
      publication: deps.publication,
      outboxRoot: deps.outboxRoot,
    });
  }
  return { emitted, blocked: false };
}

// ===================================================================================================
// T6 wire-up — the terminal-run observation seam (the T5-left-open point).
//
// After the gated executor drives a run to a terminal boundary, this reads the run's RunDetail from the
// control store, projects its terminal stage costs, and settles the fleet cost ledger. It is invoked from
// the ACTIVATION-GATED runAutomatic wrapper (activation.ts), so it exists ONLY when the gate is on — no
// separate polling loop or timer is introduced. The engine's `runToBoundary` already runs a single-stage,
// no-gate run to its terminal run state in one call and returns there (the "boundary"), so observing that
// return IS the poll-to-terminal: reading `getRun` once at that moment yields the terminal RunDetail. A
// run that returns at a NON-terminal boundary (waiting-human) is not settled here; the later runAutomatic
// call that drives it to terminal settles it then. Fleet settlement therefore fires exactly once per run,
// on the terminal boundary — no double emission for Wave-A's single-stage shape.
// ===================================================================================================

/** The terminal RUN states (not stage states): a run in one of these will never advance further. */
const TERMINAL_RUN_STATES: readonly string[] = ['succeeded', 'failed', 'stopped', 'interrupted'];

export interface SettleRunLedgerDeps {
  controlStore: Pick<ControlPlaneStore, 'getRun'>;
  repoRoot: string;
  runPy?: PyRunner;
  runPreamble?: PreambleRunner;
  /** Ops-checkout git seam (D2.5). Injected for hermetic tests; defaults to the shared async runner. */
  opsGit?: GitRunner;
  publication?: CoordinationPublication;
  outboxRoot?: string;
}

export interface SettleRunLedgerInput {
  subject?: string;
  runRef: string;
  /**
   * Reads settled usage micro-dollars for one terminal stage attempt. Injected (D4 seam). Wave-A runs
   * under subscription billing (no ANTHROPIC_API_KEY; the worker reports $0), so the default reader
   * returns 0 — the FAITHFUL subscription value, never an invented number. A future metered-billing wave
   * supplies a reader over the control-plane accounting ledger through this same seam.
   */
  readUsageMicros?: (stageRef: string, attemptRef: string | null) => number;
}

export interface SettleRunLedgerResult {
  /** true once the run is terminal and (preamble permitting) its fleet rows were emitted. */
  settled: boolean;
  emitted: number;
  /** true when the preamble/STOP/budget gate suppressed emission for an otherwise-terminal run. */
  blocked: boolean;
}

const ZERO_USAGE_MICROS = (): number => 0;

/**
 * Settle the fleet cost ledger for a run IF it has reached a terminal run state. Reads RunDetail via the
 * control store (a single projection at the terminal boundary — see the module note above), projects the
 * terminal stage costs, and emits one fleet cost row per terminal stage through the preamble-gated
 * `settleFleetCostLedger`. A non-terminal or unknown run is a no-op (`settled: false`), never an error, so
 * the wrapper can call it unconditionally after every boundary return.
 */
export async function settleFleetLedgerForRun(deps: SettleRunLedgerDeps, input: SettleRunLedgerInput): Promise<SettleRunLedgerResult> {
  const subject = input.subject ?? DASHBOARD_EXECUTOR_SUBJECT;
  const got = deps.controlStore.getRun(subject, input.runRef);
  if (!got.ok) return { settled: false, emitted: 0, blocked: false };
  if (!TERMINAL_RUN_STATES.includes(got.value.run.state)) return { settled: false, emitted: 0, blocked: false };
  const stages = collectTerminalStageCosts(got.value, input.readUsageMicros ?? ZERO_USAGE_MICROS);
  const res = await settleFleetCostLedger(
    {
      repoRoot: deps.repoRoot,
      runPy: deps.runPy,
      runPreamble: deps.runPreamble,
      opsGit: deps.opsGit,
      publication: deps.publication,
      outboxRoot: deps.outboxRoot,
    },
    { subject, runRef: input.runRef, stages },
  );
  return { settled: !res.blocked, emitted: res.emitted, blocked: res.blocked };
}

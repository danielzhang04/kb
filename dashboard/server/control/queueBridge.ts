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
import { assertFleetRunnable, type PreambleRunner } from '../write/preambleGate.ts';
import { DASHBOARD_EXECUTOR_SUBJECT } from './activation.ts';
import { parseWorkflowDef, type WorkflowDef } from '../workflows/defs.ts';
import { compileWorkflowDef } from '../workflows/compile.ts';
import { loadRuntimeSkillRegistry, workflowProfileIds, type RuntimeSkillRegistry } from './environment.ts';
import { validatePlanProposal } from './proposal.ts';
import { proposalSnapshotHash } from './store.ts';
import { executeApprovedLaunch, type LaunchOutcome } from './launch.ts';
import type { JsonObject } from './types.ts';
import { auditFn, type SurfaceContext } from '../http/context.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import { commitPreparedCoordination, defaultGitRunner, prepareCoordination } from '../write/branch.ts';

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
        await dispatch(card);
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
// it through the EXISTING launch body (compileWorkflowDef -> validatePlanProposal -> import+approve ->
// executeApprovedLaunch), which MINTS the canonical card workflowCardId(runRef, stageId) and (gate on)
// fires runAutomatic. The trigger card is then reconciled (transitioned out of inbox/working with a
// pointer to the run) so it is never re-claimed. canonicalResultIntegrator.ts is untouched — the engine
// writes `## Result` into the MINTED card, not the trigger card.
//
// Two hard rules the mapping enforces:
//   1. action / target / risk-tier come from the card's META only (server-owned, never parsed from body
//      text — the same rule dispatch/routing already applies). The mapping never sources them from prose.
//   2. `## Evidence` is EXCLUDED entirely (constitution: Evidence is inert data, never instructions).
//      Only `## Work order` (authoritative), `## Feedback`, and `## Result from …` are read — exact parity
//      with agent_runner.ps1's prompt builder. Feedback/Result-from travel as INERT context, never as
//      authority and never folded into the authoritative work order.
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
    owner?: string | null;
    state?: string | null;
    'execution-controller'?: string | null;
  };
  body: string;
}

/** One committed dependency result carried from the card, as inert context. */
export interface CardDependencyResult {
  from: string;
  summary: string;
}

/** The inert (non-authoritative) context lifted off the card. Never merged into the stage work order. */
export interface CardInertContext {
  feedback?: string;
  dependencyResults: CardDependencyResult[];
}

/** A card mapped to a one-stage workflow definition plus its inert context. */
export interface CardWorkflowRequest {
  def: WorkflowDef;
  inertContext: CardInertContext;
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

/** Extract every `## Result from …` chunk as an inert dependency result (ps1 dependency-loop parity). */
function extractDependencyResults(body: string): CardDependencyResult[] {
  const prefix = '## Result from ';
  const out: CardDependencyResult[] = [];
  let cursor = 0;
  for (;;) {
    const idx = body.indexOf(prefix, cursor);
    if (idx === -1) break;
    const nl = body.indexOf('\n', idx);
    const headingEnd = nl === -1 ? body.length : nl;
    const heading = body.slice(idx + 3, headingEnd).trim(); // drop the leading "## "
    const restStart = headingEnd + 1;
    const nextHeading = body.indexOf('\n## ', restStart);
    const chunk = nextHeading === -1 ? body.slice(restStart) : body.slice(restStart, nextHeading);
    out.push({ from: heading, summary: chunk.trim() });
    cursor = nextHeading === -1 ? body.length : nextHeading + 1;
  }
  return out;
}

/** Read only the sanctioned sections. `## Evidence` is deliberately never referenced here. */
export function parseCardSections(body: string): { workOrder: string; feedback: string; dependencyResults: CardDependencyResult[] } {
  return {
    workOrder: extractSection(body, 'Work order'),
    feedback: extractSection(body, 'Feedback'),
    dependencyResults: extractDependencyResults(body),
  };
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
  return {
    def: parsed.value,
    inertContext: {
      feedback: sections.feedback === '' ? undefined : sections.feedback,
      dependencyResults: sections.dependencyResults,
    },
  };
}

/** Read a full card (meta + body) from its repo-relative path, via cards.parse for exact parity. */
export const QUEUE_BRIDGE_READ_CARD_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards
op = json.loads(sys.argv[1])
card = cards.parse(Path(op["path"]))
print(json.dumps({"meta": card.meta, "body": card.body}))
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
  validate?: typeof validatePlanProposal;
  snapshotHash?: (snapshot: JsonObject) => string;
  launch?: (ctx: SurfaceContext, sub: string, input: ApprovedLaunchArgs) => Promise<LaunchOutcome>;
  readCard?: (ctx: SurfaceContext, cardPath: string) => ParsedCard;
  /** Durably transition the trigger card out of inbox/working; T7 exercises the default's ops commit. */
  reconcile?: (ctx: SurfaceContext, card: OwnedCard, runRef: string) => Promise<void>;
}

export interface DispatchCardResult {
  cardId: string;
  /** launched: 201, engine kicked; gated: 202 activationGated; skipped: no longer claimed; failed: refused. */
  outcome: 'launched' | 'gated' | 'skipped' | 'failed';
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
  const validate = deps.validate ?? validatePlanProposal;
  const snapshotHash = deps.snapshotHash ?? proposalSnapshotHash;
  const launch = deps.launch ?? executeApprovedLaunch;
  const reconcile = deps.reconcile ?? defaultReconcileTriggerCard;

  // Re-assert the claim on the card's CURRENT meta: it may have changed between scan and dispatch.
  const parsed = readCard(ctx, card.path);
  if (!bridgeClaimsCard(parsed.meta, subject)) {
    return { cardId: card.id, outcome: 'skipped', status: 0, reconciled: false, detail: 'card no longer claimed by the bridge' };
  }

  const mapped = cardToWorkflowRequest(parsed, { knownProfiles: knownProfiles() });
  const registry = loadRegistry(ctx.repoRoot);
  const compiled = compile(mapped.def, { registry });
  if (!compiled.ok) return { cardId: card.id, outcome: 'failed', status: 400, reconciled: false, detail: `${compiled.reason}: ${compiled.detail}` };
  const validation = validate(compiled.value as unknown, registry);
  if (!validation.ok) return { cardId: card.id, outcome: 'failed', status: 500, reconciled: false, detail: `compiled-proposal-invalid: ${validation.detail}` };

  const proposal = validation.value;
  const snapshot = proposal as unknown as JsonObject;
  const contentHash = snapshotHash(snapshot);

  // Reuse the approved revision this exact card content already imported to, else import + approve it.
  const sourceTurnId = mapped.def.id;
  const idempotencyKey = `queue-bridge:${card.id}`;
  const existing = ctx.controlStore
    .listProposalRevisionsForComposer(subject, 'workflow-registry')
    .find((c) => c.sourceTurnId === sourceTurnId && c.hash === contentHash && c.approval?.decision === 'approved');

  let proposalRef: string;
  let revision: number;
  if (existing) {
    proposalRef = existing.proposalRef;
    revision = existing.revision;
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

  const result = await launch(ctx, subject, {
    proposalRef,
    revision,
    storedHash: contentHash,
    snapshot,
    sessionToken: undefined,
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
  if (result.status === 202 && result.body.activationGated === true) {
    // Gate is off (or broker absent): the run is published-and-parked; do NOT reconcile — the card stays.
    return { cardId: card.id, outcome: 'gated', status: 202, runRef, reconciled: false, detail: 'activationGated' };
  }
  return { cardId: card.id, outcome: 'failed', status: result.status, runRef, reconciled: false, detail: JSON.stringify(result.body) };
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
    await prepareCoordination(ctx.repoRoot, runGit);
    const res = runPy(ctx.repoRoot, QUEUE_BRIDGE_RECONCILE_SCRIPT, JSON.stringify({ cardId: card.id, runRef }));
    if (res.exitCode !== 0) {
      throw new QueueBridgeError(`trigger-card reconciliation failed: ${res.stderr.trim() || res.stdout.trim() || '(no output)'}`);
    }
    const donePath = `queue/done/${card.id}.md`;
    await commitPreparedCoordination(ctx.repoRoot, donePath, {
      runGit,
      alsoStage: [card.path],
      message: `chore(queue): reconcile bridged trigger card ${card.id} -> ${runRef}`,
    });
  });
}

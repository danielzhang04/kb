/**
 * Daniel-authorized settlement for one failed FYT launch. This is intentionally not a generic repair
 * API: every identity, card claim token, durable accounting receipt, and allowed filesystem transition
 * is server-fixed below. It cannot create a successor, start an executor, spend, generate, or publish.
 */
import { createHash } from 'node:crypto';
import { AUDIT_REL_PATH, type AuditEvent } from '../audit/log.ts';
import { openNoReparseFileTree, type NoReparseFileTree } from '../win32/noReparseFiles.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import {
  createPreparedCoordinationCommit,
  defaultGitRunner,
  prepareCoordination,
  publishPreparedCoordinationCommit,
  PublishedCoordinationCommitError,
  type GitRunner,
} from '../write/branch.ts';
import { defaultPyRunner, type PyRunner } from '../write/launch.ts';
import type { WorkflowRunRequest } from '../write/workflowRun.ts';
import type { CoordinationPublication } from '../write/outbox.ts';
import {
  AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY,
  AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH,
  AUTHORIZED_20260801_FAILED_RUN_REF,
  AUTHORIZED_20260801_FAILED_RUN_STAGES,
  proposalSnapshotHash,
  type ControlPlaneStore,
  type ReconcileAuthorized20260801FailedRunInput,
  type ReconcileAuthorized20260801FailedRunResult,
} from './store.ts';
import type { JsonObject } from './types.ts';

const CLAIM_TOKENS: Readonly<Record<string, string>> = {
  idea: '423acd3901711d91', story: '42dc12e28c9cfdb9', 'judge-gate': '9e26962980f35e51',
  packaging: '0e3adb64cdbbe9f2', 'visual-plan': '9f92e7398245f981', 'shots-merge': 'f97c896d9febbe16',
  'slice-contract': '93bb455ea6be1e6e', images: '76494f40955f289a', 'image-review': 'e6bfb9e9f7636bf4',
  audio: '3f7d1f006bd55c24', 'audio-plan-merge': 'b9f371852559abe0', render: 'c770b38ecfba9a75',
  verify: '304c44e349cdb3bc',
};

// Mirror scripts/cards.py#STATE_DIR.  Logical card states are intentionally not filesystem directory
// names: blocked shares inbox; rejected shares done; and all stop states share working.
const CARD_STATE_DIR: Readonly<Record<string, string>> = {
  inbox: 'inbox', blocked: 'inbox', working: 'working', done: 'done', rejected: 'done',
  approvals: 'approvals', approved: 'approvals', 'stop-requested': 'working', halting: 'working', halted: 'working',
};
const AUTHORIZED_FAILED_RUN_TARGET_ROOT = 'orgs/faceless-youtube/channels/the-second-take/videos/2026-07-31-codex-thin-slice';

export const AUTHORIZED_FAILED_RUN_CARD_SCRIPT = `
import json, sys
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

op = json.loads(sys.argv[1])

def expected_meta(spec, state):
    stage = spec["stage"]
    return {
        "id": spec["cardRef"], "project": op["workflow"]["project"],
        "action": stage["action"], "target": stage["target"], "risk-tier": stage["riskTier"],
        "owner": stage["owner"], "claim-token": spec["claimToken"], "state": state,
        "approval": None, "workflow": op["runRef"], "depends-on": spec["dependsOn"],
        "variant-group": None, "role": "work", "session-id": None,
        "runtime": spec["runtime"], "model": spec["model"], "execution-controller": "dashboard",
    }

def expected_body(spec):
    return "## Work order\\n\\n" + spec["stage"]["workOrder"] + "\\n"

plans = []
for spec in op["cards"]:
    sequence = spec["sequence"]
    initial = sequence[0]
    final = sequence[-1]
    card = cards.parse_text(spec["initialContents"], Path(spec["source"]))
    if card.meta != expected_meta(spec, initial) or card.body != expected_body(spec):
        raise cards.ValidationError("origin card blob differs from the exact authorized preimage")
    # width=10**9 disables PyYAML's ~80-column plain-scalar folding. A folded value becomes an
    # indented continuation line, which the TS card reader (server/planeA/cards.ts) rejects outright,
    # so a folded card would be unreadable by every dashboard reader. Unfoldable here means an
    # already-folded origin blob fails the byte-for-byte compare below instead of being reproduced.
    initial_fm = cards.yaml.safe_dump(card.meta, sort_keys=False, allow_unicode=True, width=10**9)
    if spec["initialContents"] != f"---\\n{initial_fm}---\\n\\n{card.body}":
        raise cards.ValidationError("origin card blob is not canonical byte-for-byte")
    for next_state in sequence[1:]:
        if next_state not in cards.LEGAL.get(card.meta["state"], set()):
            raise cards.ValidationError("authorized transition is not canonical")
        card.meta["state"] = next_state
    fm = cards.yaml.safe_dump(card.meta, sort_keys=False, allow_unicode=True, width=10**9)
    contents = f"---\\n{fm}---\\n\\n{card.body}"
    if card.meta != expected_meta(spec, final) or card.body != expected_body(spec):
        raise cards.ValidationError("terminal card serialization differs")
    plans.append({"cardRef": spec["cardRef"], "source": spec["source"], "destination": spec["destination"],
                  "initialContents": spec["initialContents"], "contents": contents})
print(json.dumps({"cards": plans}))
`.trim();

export const AUTHORIZED_FAILED_RUN_BLOB_SCRIPT = `
import json, sys
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

op = json.loads(sys.argv[1])
for spec in op["cards"]:
    path = Path(spec["path"])
    card = cards.parse_text(spec["contents"], path)
    stage = spec["stage"]
    expected = {
        "id": spec["cardRef"], "project": op["project"], "action": stage["action"],
        "target": stage["target"], "risk-tier": stage["riskTier"], "owner": stage["owner"],
        "claim-token": spec["claimToken"], "state": spec["state"], "approval": None,
        "workflow": op["runRef"], "depends-on": spec["dependsOn"], "variant-group": None,
        "role": "work", "session-id": None, "runtime": spec["runtime"], "model": spec["model"],
        "execution-controller": "dashboard",
    }
    body = "## Work order\\n\\n" + stage["workOrder"] + "\\n"
    if card.meta != expected or card.body != body:
        raise cards.ValidationError("committed card blob differs from the exact settlement")
print(json.dumps({"validated": len(op["cards"])}))
`.trim();

type CardProjection = {
  stageId: string; cardRef: string; runtime: string; model: string; claimToken: string;
  dependsOn: string[]; sequence: string[]; stage: WorkflowRunRequest['stages'][number];
};

export interface AuthorizedFailedRunReconciliationDeps {
  repoRoot: string;
  stateRoot: string;
  subject: string;
  input: ReconcileAuthorized20260801FailedRunInput;
  proposalSnapshot: JsonObject;
  workflow: WorkflowRunRequest;
  artifactPaths: string[];
  store: ControlPlaneStore;
  assertAuthorized(): void;
  runGit?: GitRunner;
  runPy?: PyRunner;
  fileTree?: NoReparseFileTree;
  stateTree?: NoReparseFileTree;
  faultAfterMoves?: number;
  faultAfterAudit?: boolean;
  faultAfterGitAdd?: boolean;
  publication?: CoordinationPublication;
  outboxRoot?: string;
}

export interface AuthorizedFailedRunReconciliationOutcome {
  result: ReconcileAuthorized20260801FailedRunResult;
  replayed: boolean;
  canonicalCommit: string;
}

/**
 * The settlement commit IS durable on origin/ops, but the control-plane record was not finalized.
 * This is not a refusal: nothing was rolled back and re-invoking finishes the operation. Callers must
 * report it as its own state, because telling the operator "refused" here is the opposite of the truth.
 */
export class AuthorizedFailedRunPublishedUncommittedError extends Error {
  readonly canonicalCommit: string;
  // No TS parameter property here: the daemon runs under Node strip-only mode, which rejects them.
  constructor(canonicalCommit: string, cause: unknown) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'AuthorizedFailedRunPublishedUncommittedError';
    this.canonicalCommit = canonicalCommit;
  }
}

function exactKeys(value: Record<string, unknown>, expected: string[]): boolean {
  return JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

function assertExactProposalSnapshot(deps: AuthorizedFailedRunReconciliationDeps): void {
  if (proposalSnapshotHash(deps.proposalSnapshot) !== AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH) {
    throw new Error('authorized reconciliation proposal snapshot digest differs');
  }
}

function treeJson(tree: NoReparseFileTree, parts: string[], unavailable: string): Record<string, unknown> {
  const contents = tree.readUtf8(parts);
  if (contents === null) throw new Error(unavailable);
  try {
    const value = JSON.parse(contents) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value as Record<string, unknown>;
  } catch {
    throw new Error(unavailable);
  }
}

function exactAccounting(tree: NoReparseFileTree): void {
  const value = treeJson(
    tree, ['control', 'execution-accounting', '2026-08-01.json'],
    'authorized reconciliation accounting receipt is unavailable',
  );
  const reservations = Array.isArray(value.reservations) ? value.reservations as Array<Record<string, unknown>> : [];
  const record = reservations[0];
  if (!exactKeys(value, ['schema', 'revision', 'policyHash', 'windowId', 'reservations'])
    || value.schema !== 'kb.execution-accounting/v1' || value.revision !== 2 || value.windowId !== '2026-08-01'
    || value.policyHash !== 'c637d06def982e6470ecd7777132cbdbcd0fbd34cdbab6649c3cfa1246dbe941'
    || reservations.length !== 1 || !record
    || !exactKeys(record, ['reservationRef', 'operationKey', 'fingerprint', 'subject', 'runRef', 'attemptRef', 'limits',
      'state', 'usage', 'settlementOperationKey', 'settlementFingerprint', 'reservedAt', 'settledAt'])
    || record.reservationRef !== 'reservation-32549b92-2dcb-4467-b12a-5e98cb4295ab'
    || record.fingerprint !== '49a073543e2dc332926189f4758405f032f21758aa846b259fe10c4b66a3fdb1'
    || record.subject !== 'operator' || record.runRef !== AUTHORIZED_20260801_FAILED_RUN_REF
    || record.attemptRef !== 'attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7'
    || record.state !== 'settled' || record.reservedAt !== '2026-08-01T03:32:49.199Z'
    || record.settledAt !== '2026-08-01T03:32:49.316Z'
    || record.settlementFingerprint !== '9b60e23a694ee81c9c15647f587d2df747d730d0fdb4d981a72a2a7afd8e1cef') {
    throw new Error('authorized reconciliation accounting receipt differs');
  }
  const limits = record.limits as Record<string, unknown>;
  const usage = record.usage as Record<string, unknown>;
  if (!limits || !exactKeys(limits, ['maxAttempts', 'maxInputTokens', 'maxOutputTokens', 'maxCostUsdMicros'])
    || !usage || !exactKeys(usage, ['inputTokens', 'outputTokens', 'costUsdMicros'])
    || limits.maxAttempts !== 3 || limits.maxInputTokens !== 2_000_000 || limits.maxOutputTokens !== 400_000
    || limits.maxCostUsdMicros !== 5_000_000
    || usage.inputTokens !== 0 || usage.outputTokens !== 0 || usage.costUsdMicros !== 0
    || record.operationKey !== 'reserve:attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7'
    || record.settlementOperationKey !== 'settle:attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7') {
    throw new Error('authorized reconciliation accounting settlement differs');
  }
}

function assertNoRunRecords(tree: NoReparseFileTree, parts: string[], collection: string, runRef: string): void {
  const contents = tree.readUtf8(parts);
  if (contents === null) return;
  let value: Record<string, unknown>;
  try { value = JSON.parse(contents) as Record<string, unknown>; }
  catch { throw new Error('authorized reconciliation external journal is unsafe'); }
  const records = value[collection];
  if (!Array.isArray(records) || records.some((record) => record && typeof record === 'object'
    && (record as Record<string, unknown>).runRef === runRef)) {
    throw new Error('authorized reconciliation found downstream durable activity');
  }
}

function assertExternalState(deps: AuthorizedFailedRunReconciliationDeps): void {
  const state = deps.stateTree ?? openNoReparseFileTree(deps.stateRoot, { createRoot: false });
  const repo = reconciliationTree(deps);
  exactAccounting(state);
  assertNoRunRecords(state, ['control', 'execution-results.json'], 'results', AUTHORIZED_20260801_FAILED_RUN_REF);
  assertNoRunRecords(state, ['control', 'paid-actions.json'], 'actions', AUTHORIZED_20260801_FAILED_RUN_REF);
  assertNoRunRecords(state, ['control', 'canonical-integration.json'], 'records', AUTHORIZED_20260801_FAILED_RUN_REF);

  const integrationRef = createHash('sha256').update(AUTHORIZED_20260801_FAILED_RUN_REF).digest('hex').slice(0, 24);
  if (state.pathKind(['control', 'integration', integrationRef]) !== null) {
    throw new Error('authorized reconciliation found an integration worktree');
  }
  try { state.assertEmptyDirectory(['control', 'worktrees', AUTHORIZED_20260801_FAILED_RUN_REF]); }
  catch { throw new Error('authorized reconciliation run worktree parent is not the exact empty server directory'); }
  if (repo.pathKind(AUTHORIZED_FAILED_RUN_TARGET_ROOT.split('/')) !== null) {
    throw new Error('authorized reconciliation found the exact produced target directory');
  }
  for (const relpath of deps.artifactPaths) {
    if (repo.pathKind(relpath.replace(/\\/g, '/').split('/')) !== null) {
      throw new Error('authorized reconciliation found a produced artifact');
    }
  }
}

function projections(workflow: WorkflowRunRequest): CardProjection[] {
  if (workflow.name !== 'wf-097e79d2cedb6372a0ddc5cd329e28a1f23bcedcf42e8d36'
    || workflow.workflowDefinitionId !== workflow.name || workflow.project !== 'faceless-youtube'
    || workflow.stages.length !== AUTHORIZED_20260801_FAILED_RUN_STAGES.length) {
    throw new Error('authorized reconciliation compiled workflow differs');
  }
  const refs = new Map<string, string>(AUTHORIZED_20260801_FAILED_RUN_STAGES.map((stage) => [stage.stageId, stage.cardRef]));
  return AUTHORIZED_20260801_FAILED_RUN_STAGES.map((expected) => {
    const stage = workflow.stages.find((candidate) => candidate.id === expected.stageId);
    if (!stage || !CLAIM_TOKENS[expected.stageId]) throw new Error('authorized reconciliation stage differs');
    const dependsOn = stage.dependsOn.map((dependency) => refs.get(dependency));
    if (dependsOn.some((dependency) => !dependency)) throw new Error('authorized reconciliation dependency differs');
    return {
      stageId: expected.stageId,
      cardRef: expected.cardRef,
      runtime: expected.runtime,
      model: expected.model,
      claimToken: CLAIM_TOKENS[expected.stageId],
      dependsOn: dependsOn as string[],
      sequence: expected.stageId === 'idea'
        ? ['inbox', 'working', 'approvals', 'rejected']
        : ['blocked', 'inbox', 'working', 'stop-requested', 'halting', 'halted'],
      stage,
    };
  });
}

type ExactCardPlan = {
  cardRef: string;
  source: string;
  destination: string;
  initialBlob: string;
  initialContents: string;
  blobContents: string;
  contents: string;
};

async function exactCardPlans(
  deps: AuthorizedFailedRunReconciliationDeps,
  runGit: GitRunner,
  revision: string,
): Promise<ExactCardPlan[]> {
  const specs = await Promise.all(projections(deps.workflow).map(async (card) => {
    const source = cardPath(card.cardRef, card.sequence[0] as string);
    const destination = cardPath(card.cardRef, card.sequence.at(-1) as string);
    const initialContents = await blobAt(deps.repoRoot, runGit, revision, source);
    if (initialContents === null) throw new Error('authorized reconciliation origin omitted an initial card');
    return { ...card, source, destination, initialContents };
  }));
  const operation = JSON.stringify({
    runRef: AUTHORIZED_20260801_FAILED_RUN_REF,
    workflow: { project: deps.workflow.project },
    cards: specs,
  });
  const result = (deps.runPy ?? defaultPyRunner)(deps.repoRoot, AUTHORIZED_FAILED_RUN_CARD_SCRIPT, operation);
  if (result.exitCode !== 0) {
    throw new Error(`authorized reconciliation card plan failed: ${result.stderr.trim() || result.stdout.trim() || `exit ${result.exitCode}`}`);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(result.stdout.trim()); }
  catch { throw new Error('authorized reconciliation card plan returned invalid JSON'); }
  const rows = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as { cards?: unknown }).cards : null;
  if (!Array.isArray(rows) || rows.length !== specs.length) {
    throw new Error('authorized reconciliation card plan returned an incomplete set');
  }
  const expected = new Map(specs.map((spec) => [spec.cardRef, spec]));
  const rawPlans = rows.map((value) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('authorized reconciliation card plan row is invalid');
    const row = value as Record<string, unknown>;
    const spec = typeof row.cardRef === 'string' ? expected.get(row.cardRef) : undefined;
    if (!spec || !exactKeys(row, ['cardRef', 'source', 'destination', 'initialContents', 'contents'])
      || row.source !== spec.source || row.destination !== spec.destination || row.initialContents !== spec.initialContents
      || typeof row.contents !== 'string') {
      throw new Error('authorized reconciliation card plan differs from the fixed set');
    }
    expected.delete(spec.cardRef);
    return row as Omit<ExactCardPlan, 'initialBlob' | 'blobContents'>;
  });
  return Promise.all(rawPlans.map(async (plan) => {
    const filtered = await runGit(deps.repoRoot, [
      'cat-file', '--filters', `--path=${plan.source}`, `${revision}:${plan.source}`,
    ]);
    let contents: string;
    if (filtered === plan.initialContents) contents = plan.contents;
    else if (filtered === plan.initialContents.replace(/\n/g, '\r\n')) contents = plan.contents.replace(/\n/g, '\r\n');
    else throw new Error('authorized reconciliation working-tree card filter differs from the exact supported forms');
    return {
      ...plan,
      initialBlob: plan.initialContents,
      initialContents: filtered,
      blobContents: plan.contents,
      contents,
    };
  }));
}

function initialCardPaths(workflow: WorkflowRunRequest): string[] {
  // The one canonical publication put every card physically in inbox/; `blocked` is also stored there,
  // but its logical metadata was never a separate directory.
  return projections(workflow).map((card) => cardPath(card.cardRef, 'inbox'));
}

function expectedCardPaths(workflow: WorkflowRunRequest): string[] {
  return projections(workflow).map((card) => cardPath(card.cardRef, card.sequence.at(-1) as string));
}

function cardPath(cardRef: string, state: string): string {
  const directory = CARD_STATE_DIR[state];
  if (!directory) throw new Error(`authorized reconciliation state '${state}' has no cards.py directory mapping`);
  return `queue/${directory}/${cardRef}.md`;
}

/**
 * The exact path set of the settlement commit. It is also the workspace write allowlist: nothing may
 * change that the commit does not carry, so the two can never be allowed to drift apart.
 */
function exactCommitPaths(workflow: WorkflowRunRequest): string[] {
  return [...new Set([...initialCardPaths(workflow), ...expectedCardPaths(workflow), AUDIT_REL_PATH])].sort();
}

function reconcileCards(
  deps: AuthorizedFailedRunReconciliationDeps,
  plans: ExactCardPlan[],
  apply: boolean,
): { final: boolean; paths: string[] } {
  const tree = reconciliationTree(deps);
  const paths: string[] = [];
  let final = true;
  let moves = 0;
  for (const plan of plans) {
    const source = plan.source.split('/');
    const destination = plan.destination.split('/');
    const sourceExists = tree.inspectRegularFile(source, 'never') !== null;
    const destinationExists = tree.inspectRegularFile(destination, 'never') !== null;
    if (!sourceExists) {
      if (!destinationExists || tree.readUtf8(destination) !== plan.contents) {
        throw new Error('authorized reconciliation card has no exact recoverable preimage');
      }
      paths.push(plan.destination);
      continue;
    }
    if (apply) tree.completeUtf8FromPrefix(source, plan.initialContents);
    if (tree.readUtf8(source) !== plan.initialContents) throw new Error('authorized reconciliation source card differs from origin/ops');
    if (apply) {
      const before = tree.inspectRegularFile(destination, 'never');
      if (before && before.size > Buffer.byteLength(plan.contents, 'utf8')) {
        throw new Error(`authorized reconciliation terminal card '${plan.cardRef}' exceeds its exact planned byte length`);
      }
      tree.completeUtf8FromPrefix(destination, plan.contents);
    }
    if (!destinationExists && !apply) {
      final = false;
      paths.push(plan.source);
      continue;
    }
    if (tree.readUtf8(destination) !== plan.contents) throw new Error('authorized reconciliation terminal card differs');
    if (apply) {
      moves += 1;
      if (deps.faultAfterMoves === moves) throw new Error('injected card transition fault');
      tree.deleteFileIfPresent(source);
    }
    paths.push(plan.destination);
  }
  return { final, paths };
}

const AUDIT_EVENT: AuditEvent = {
  action: 'control-authorized-failed-run-reconciliation-authorize',
  owner: 'operator',
  target: AUTHORIZED_20260801_FAILED_RUN_REF,
  riskTier: 'T3',
  result: 'authorized:rejected-one-failed-and-halted-twelve-unstarted',
  detail: {
    idempotencyKey: AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY,
    proposalRef: 'proposal-3725fb98-e20e-4619-b6e7-c9055138a50d',
    expectedRunVersion: 7,
    expectedManagerGeneration: 1,
    expectedRequestRevision: 2,
    expectedNextEventCursor: 6,
  },
};

function sameAuditEvent(row: Record<string, unknown>): boolean {
  return exactKeys(row, ['ts', 'action', 'owner', 'target', 'riskTier', 'result', 'detail'])
    && typeof row.ts === 'string' && !Number.isNaN(Date.parse(row.ts))
    && row.action === AUDIT_EVENT.action && row.owner === AUDIT_EVENT.owner && row.target === AUDIT_EVENT.target
    && row.riskTier === AUDIT_EVENT.riskTier && row.result === AUDIT_EVENT.result
    && JSON.stringify(row.detail) === JSON.stringify(AUDIT_EVENT.detail);
}

function reconciliationTree(deps: AuthorizedFailedRunReconciliationDeps): NoReparseFileTree {
  return deps.fileTree ?? openNoReparseFileTree(deps.repoRoot, { createRoot: false });
}

function assertOneAuditRow(deps: AuthorizedFailedRunReconciliationDeps, baseline?: string, expectedSuffix?: string): boolean {
  const contents = reconciliationTree(deps).readUtf8(AUDIT_REL_PATH.split('/')) ?? '';
  if (baseline !== undefined && contents !== baseline && !contents.startsWith(baseline)) {
    throw new Error('authorized reconciliation audit ledger drifted from origin/ops');
  }
  const suffix = baseline === undefined ? contents : contents.slice(baseline.length);
  if (expectedSuffix !== undefined && suffix !== expectedSuffix) return false;
  const rows = suffix.split(/\r?\n/).filter(Boolean).map((line) => {
    try {
      const value = JSON.parse(line);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error();
      return value as Record<string, unknown>;
    } catch {
      throw new Error('authorized reconciliation audit ledger contains malformed JSON');
    }
  }).filter(sameAuditEvent);
  if (rows.length > 1) throw new Error('authorized reconciliation audit row is duplicated');
  if (baseline !== undefined && expectedSuffix === undefined && rows.length === 1
    && `${baseline}${JSON.stringify(rows[0])}\n` !== contents) {
    throw new Error('authorized reconciliation audit delta is not one canonical row');
  }
  return rows.length === 1 && sameAuditEvent(rows[0] as Record<string, unknown>);
}

type ExactAuditPlan = { blobBaseline: string; baseline: string; blobSuffix: string; suffix: string };

async function remoteAuditPlan(
  deps: AuthorizedFailedRunReconciliationDeps,
  runGit: GitRunner,
  revision = 'refs/remotes/origin/ops',
): Promise<ExactAuditPlan> {
  const repoRoot = deps.repoRoot;
  const remote = (await runGit(repoRoot, ['rev-parse', revision])).trim();
  const path = (await runGit(repoRoot, ['ls-tree', '--name-only', remote, '--', AUDIT_REL_PATH])).trim();
  const blobBaseline = path === AUDIT_REL_PATH ? await runGit(repoRoot, ['show', `${remote}:${AUDIT_REL_PATH}`]) : '';
  const baseline = path === AUDIT_REL_PATH
    ? await runGit(repoRoot, ['cat-file', '--filters', `--path=${AUDIT_REL_PATH}`, `${remote}:${AUDIT_REL_PATH}`]) : '';
  if (blobBaseline && !blobBaseline.endsWith('\n')) throw new Error('authorized reconciliation origin audit baseline is not canonical NDJSON');
  for (const line of blobBaseline.split(/\r?\n/).filter(Boolean)) {
    let row: Record<string, unknown>;
    try { row = JSON.parse(line) as Record<string, unknown>; }
    catch { throw new Error('authorized reconciliation origin audit baseline is malformed'); }
    if (!row || typeof row !== 'object' || Array.isArray(row) || sameAuditEvent(row)) {
      throw new Error('authorized reconciliation origin audit baseline is ambiguous');
    }
  }
  const blobSuffix = exactAuditSuffix(deps);
  const filteredSuffix = blobSuffix.replace(/\n/g, '\r\n');
  const current = reconciliationTree(deps).readUtf8(AUDIT_REL_PATH.split('/')) ?? '';
  const candidates = [
    { baseline: blobBaseline, suffix: blobSuffix },
    { baseline, suffix: baseline === blobBaseline ? blobSuffix : filteredSuffix },
  ].filter((candidate, index, all) => index === all.findIndex((other) =>
    other.baseline === candidate.baseline && other.suffix === candidate.suffix));
  const working = candidates.find((candidate) => current.length >= candidate.baseline.length
    && `${candidate.baseline}${candidate.suffix}`.startsWith(current));
  if (!working) throw new Error('authorized reconciliation working-tree audit is not an exact recoverable prefix');
  return { blobBaseline, baseline: working.baseline, blobSuffix, suffix: working.suffix };
}

async function blobAt(repoRoot: string, runGit: GitRunner, revision: string, path: string): Promise<string | null> {
  const listed = (await runGit(repoRoot, ['ls-tree', '--name-only', revision, '--', path])).trim();
  return listed === path ? await runGit(repoRoot, ['show', `${revision}:${path}`]) : null;
}

type RawCommitChange = { oldMode: string; newMode: string; status: string };

async function rawCommitChanges(repoRoot: string, runGit: GitRunner, commit: string): Promise<Map<string, RawCommitChange>> {
  const raw = await runGit(repoRoot, [
    'diff-tree', '--raw', '-z', '--no-renames', '--no-abbrev', '--no-commit-id', '-r', commit,
  ]);
  const fields = raw.split('\0');
  if (fields.at(-1) === '') fields.pop();
  if (fields.length % 2 !== 0) throw new Error('authorized reconciliation raw commit proof is malformed');
  const changes = new Map<string, RawCommitChange>();
  for (let index = 0; index < fields.length; index += 2) {
    const header = fields[index] as string;
    const path = fields[index + 1] as string;
    const match = /^:([0-7]{6}) ([0-7]{6}) [0-9a-f]{40} [0-9a-f]{40} ([ADM])$/.exec(header);
    if (!match || !path || path.includes('\\') || changes.has(path)) {
      throw new Error('authorized reconciliation raw commit proof is malformed');
    }
    changes.set(path, { oldMode: match[1] as string, newMode: match[2] as string, status: match[3] as string });
  }
  return changes;
}

export async function validateSettlementCommitObject(
  deps: AuthorizedFailedRunReconciliationDeps,
  runGit: GitRunner,
  commit: string,
): Promise<void> {
  const parent = (await runGit(deps.repoRoot, ['rev-parse', `${commit}^`])).trim();
  const plans = await exactCardPlans(deps, runGit, parent);
  const changes = await rawCommitChanges(deps.repoRoot, runGit, commit);
  const expectedPaths = new Set(exactCommitPaths(deps.workflow));
  if (changes.size !== expectedPaths.size || [...changes.keys()].some((path) => !expectedPaths.has(path))) {
    throw new Error('authorized reconciliation commit raw path set differs');
  }
  for (const plan of plans) {
    const deleted = changes.get(plan.source);
    const added = changes.get(plan.destination);
    if (!deleted || deleted.status !== 'D' || deleted.oldMode !== '100644' || deleted.newMode !== '000000'
      || !added || added.status !== 'A' || added.oldMode !== '000000' || added.newMode !== '100644'
      || await blobAt(deps.repoRoot, runGit, commit, plan.source) !== null
      || await blobAt(deps.repoRoot, runGit, commit, plan.destination) !== plan.blobContents) {
      throw new Error('authorized reconciliation card source/terminal raw transition differs');
    }
  }
  const cards = projections(deps.workflow).map((card) => {
    const state = card.sequence.at(-1) as string;
    const path = cardPath(card.cardRef, state);
    return { ...card, state, path };
  });
  const payload = JSON.stringify({
    project: deps.workflow.project,
    runRef: AUTHORIZED_20260801_FAILED_RUN_REF,
    cards: await Promise.all(cards.map(async (card) => ({
      ...card,
      contents: await blobAt(deps.repoRoot, runGit, commit, card.path),
    }))),
  });
  if (JSON.parse(payload).cards.some((card: { contents: unknown }) => typeof card.contents !== 'string')) {
    throw new Error('authorized reconciliation commit omitted a terminal card blob');
  }
  const checked = (deps.runPy ?? defaultPyRunner)(deps.repoRoot, AUTHORIZED_FAILED_RUN_BLOB_SCRIPT, payload);
  if (checked.exitCode !== 0) {
    throw new Error(`authorized reconciliation committed card proof failed: ${checked.stderr.trim() || checked.stdout.trim()}`);
  }
  const before = await blobAt(deps.repoRoot, runGit, parent, AUDIT_REL_PATH) ?? '';
  const after = await blobAt(deps.repoRoot, runGit, commit, AUDIT_REL_PATH);
  const auditChange = changes.get(AUDIT_REL_PATH);
  const expectedAuditStatus = before === '' ? 'A' : 'M';
  if (!auditChange || auditChange.status !== expectedAuditStatus
    || auditChange.oldMode !== (before === '' ? '000000' : '100644') || auditChange.newMode !== '100644') {
    throw new Error('authorized reconciliation committed audit raw transition differs');
  }
  if (after === null || !after.startsWith(before)) throw new Error('authorized reconciliation committed audit baseline differs');
  const suffix = after.slice(before.length);
  const lines = suffix.split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error('authorized reconciliation commit did not append exactly one audit row');
  let row: Record<string, unknown>;
  try { row = JSON.parse(lines[0] as string) as Record<string, unknown>; }
  catch { throw new Error('authorized reconciliation committed audit row is malformed'); }
  if (!sameAuditEvent(row) || suffix !== exactAuditSuffix(deps)) {
    throw new Error('authorized reconciliation committed audit row differs');
  }
}

function claimedAt(deps: AuthorizedFailedRunReconciliationDeps): string {
  const preflight = deps.store.preflightAuthorized20260801FailedRunReconciliation(deps.subject, deps.input);
  const value = preflight.ok && (preflight.value.disposition === 'claimed' || preflight.value.disposition === 'replay')
    ? preflight.value.receipt?.claimedAt : null;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error('authorized reconciliation claim timestamp is unavailable');
  }
  return value;
}

function exactAuditSuffix(deps: AuthorizedFailedRunReconciliationDeps): string {
  const row = { ts: claimedAt(deps), ...AUDIT_EVENT };
  if (!sameAuditEvent(row)) throw new Error('authorized reconciliation audit row schema differs');
  return `${JSON.stringify(row)}\n`;
}

function appendExactAuditRow(deps: AuthorizedFailedRunReconciliationDeps, plan: ExactAuditPlan): void {
  const tree = reconciliationTree(deps);
  tree.ensureDir(['ledgers', 'audit']);
  tree.appendUtf8IfExact(AUDIT_REL_PATH.split('/'), plan.baseline, plan.suffix);
}

function assertClaimed(deps: AuthorizedFailedRunReconciliationDeps): void {
  assertExactProposalSnapshot(deps);
  deps.assertAuthorized();
  const preflight = deps.store.preflightAuthorized20260801FailedRunReconciliation(deps.subject, deps.input);
  if (!preflight.ok) throw new Error(`authorized reconciliation preflight failed: ${preflight.reason}`);
  if (preflight.value.disposition === 'replay') throw new Error('authorized reconciliation completed concurrently');
  if (preflight.value.disposition !== 'claimed') throw new Error('authorized reconciliation claim was lost');
}

function pathsFromStatus(status: string): string[] {
  const rows = status.split('\0').filter(Boolean);
  const paths: string[] = [];
  for (const row of rows) {
    // Renames carry a second NUL-delimited pathname.  They can never be part of this fixed card/audit
    // settlement, so treating either half as a path makes the allowlist reject them.
    if (row.length < 4 || row[2] !== ' ') throw new Error('authorized reconciliation workspace status is malformed');
    paths.push(row.slice(3).replace(/\\/g, '/'));
  }
  return paths;
}

async function reconciliationChanges(
  deps: AuthorizedFailedRunReconciliationDeps,
  runGit: GitRunner,
): Promise<string[]> {
  const paths = pathsFromStatus(await runGit(deps.repoRoot, [
    'status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames',
  ]));
  const allowed = new Set(exactCommitPaths(deps.workflow));
  if (paths.some((path) => !allowed.has(path))) {
    throw new Error('authorized reconciliation workspace contains a changed path outside the fixed settlement');
  }
  return paths;
}

function samePathSet(actual: string[], expected: string[]): boolean {
  return JSON.stringify([...actual].sort()) === JSON.stringify([...expected].sort());
}

async function isPreparedSettlementCommit(
  deps: AuthorizedFailedRunReconciliationDeps,
  runGit: GitRunner,
): Promise<{ commit: string; alreadyPublished: boolean } | null> {
  if ((await reconciliationChanges(deps, runGit)).length > 0) return null;
  const head = (await runGit(deps.repoRoot, ['rev-parse', 'HEAD'])).trim();
  if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('authorized reconciliation local HEAD is invalid');
  const expected = exactCommitPaths(deps.workflow);
  const pathsFor = async (commit: string): Promise<string[]> => (await runGit(
    deps.repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '--no-renames', '-r', '-z', commit],
  )).split('\0').filter((path) => path.length > 0).map((path) => path.replace(/\\/g, '/'));
  if (samePathSet(await pathsFor(head), expected)) return { commit: head, alreadyPublished: false };

  // A later clean coordination commit may sit atop a settlement whose successful push response was lost.
  // Never repush the newer HEAD: find the exact ancestor, then accept it only after proving origin/ops
  // already reaches that object.
  const candidates = (await runGit(deps.repoRoot, ['log', '--format=%H', '--max-count=128', 'HEAD', '--', ...expected]))
    .split(/\r?\n/).map((value) => value.trim()).filter((value) => /^[a-f0-9]{40}$/.test(value));
  for (const candidate of candidates) {
    if (!samePathSet(await pathsFor(candidate), expected)) continue;
    let remote: string;
    if ((deps.publication ?? 'direct') === 'outbox') {
      remote = (await runGit(deps.repoRoot, ['rev-parse', '--verify', 'refs/kb-outbox/spooled'])).trim();
    } else {
      await runGit(deps.repoRoot, ['fetch', 'origin', 'ops']);
      remote = (await runGit(deps.repoRoot, ['rev-parse', 'refs/remotes/origin/ops'])).trim();
    }
    try {
      await runGit(deps.repoRoot, ['merge-base', '--is-ancestor', candidate, remote]);
      return { commit: candidate, alreadyPublished: true };
    } catch { /* exact ancestor is local-only; refuse rather than push a newer head */ }
  }
  return null;
}

async function finalizePreparedSettlement(
  deps: AuthorizedFailedRunReconciliationDeps,
  runGit: GitRunner,
  prepared: { commit: string; alreadyPublished: boolean },
): Promise<AuthorizedFailedRunReconciliationOutcome> {
  if (prepared.alreadyPublished) await validateSettlementCommitObject(deps, runGit, prepared.commit);
  let canonicalCommit: string;
  if (prepared.alreadyPublished) {
    canonicalCommit = prepared.commit;
  } else {
    try {
      canonicalCommit = await publishPreparedCoordinationCommit(deps.repoRoot, prepared.commit, {
        runGit,
        relpaths: exactCommitPaths(deps.workflow),
        assertAuthorized: () => {
          assertClaimed(deps);
          assertExternalState(deps);
        },
        validateCommit: async (commit) => {
          await validateSettlementCommitObject(deps, runGit, commit);
        },
        publication: deps.publication,
        outboxRoot: deps.outboxRoot,
      });
    } catch (error) {
      // The push exited 0 and the publish then lost its confirmation or its authorization re-check:
      // the ops write may be durable and nothing was rewound, which is the published-uncommitted
      // state, not a refusal. Anything else genuinely refused before the remote heard from us.
      if (error instanceof PublishedCoordinationCommitError) {
        throw new AuthorizedFailedRunPublishedUncommittedError(error.commit, error);
      }
      throw error;
    }
  }
  // Everything below runs with the settlement already durable on origin/ops, so every failure here is
  // 'published but not finalized', never 'refused' — the distinction the operator acts on.
  try {
    // `publishPreparedCoordinationCommit` returns only after remote reachability.  Re-prove every local
    // safety predicate in the tiny return-to-v8 window: a lock/re-unlock, a downstream journal write, or
    // card/audit drift must leave the durable store at v7 rather than falsely settled.
    deps.assertAuthorized();
    assertClaimed(deps);
    assertExternalState(deps);
    const parent = (await runGit(deps.repoRoot, ['rev-parse', `${canonicalCommit}^`])).trim();
    const plans = await exactCardPlans(deps, runGit, parent);
    if (!reconcileCards(deps, plans, false).final) throw new Error('authorized reconciliation terminal cards disappeared after publish');
    if (!assertOneAuditRow(deps)) throw new Error('authorized reconciliation audit row disappeared after publish');
    const committed = deps.store.commitAuthorized20260801FailedRunReconciliation(
      deps.subject, deps.input, canonicalCommit,
    );
    if (!committed.ok) throw new Error(`authorized reconciliation control-plane commit failed: ${committed.reason}`);
    return { result: committed.value, replayed: committed.replayed === true, canonicalCommit };
  } catch (error) {
    throw new AuthorizedFailedRunPublishedUncommittedError(canonicalCommit, error);
  }
}

/**
 * Perform the sole Daniel-authorized settlement.  The store claim is deliberately taken before any
 * filesystem write, so a process loss leaves a restartable claimed receipt rather than another eligible
 * transaction.  v8 is not recorded until the exact multi-path ops commit is reachable from origin/ops.
 */
export async function reconcileAuthorized20260801FailedRun(
  deps: AuthorizedFailedRunReconciliationDeps,
): Promise<AuthorizedFailedRunReconciliationOutcome> {
  return withOpsTransaction(async () => {
    assertExactProposalSnapshot(deps);
    deps.assertAuthorized();
    const runGit = deps.runGit ?? defaultGitRunner;
    const initial = deps.store.preflightAuthorized20260801FailedRunReconciliation(deps.subject, deps.input);
    if (!initial.ok) throw new Error(`authorized reconciliation preflight failed: ${initial.reason}`);
    if (initial.value.disposition === 'replay') {
      if (!initial.value.result.receipt.canonicalCommit) throw new Error('authorized reconciliation replay has no canonical commit');
      const canonicalCommit = initial.value.result.receipt.canonicalCommit;
      assertExternalState(deps);
      if ((await reconciliationChanges(deps, runGit)).length !== 0) {
        throw new Error('authorized reconciliation replay workspace is not clean');
      }
      await runGit(deps.repoRoot, ['fetch', 'origin', 'ops']);
      const remote = (await runGit(deps.repoRoot, ['rev-parse', 'refs/remotes/origin/ops'])).trim();
      try { await runGit(deps.repoRoot, ['merge-base', '--is-ancestor', canonicalCommit, remote]); }
      catch { throw new Error('authorized reconciliation replay commit is not canonical on origin/ops'); }
      await validateSettlementCommitObject(deps, runGit, canonicalCommit);
      const parent = (await runGit(deps.repoRoot, ['rev-parse', `${canonicalCommit}^`])).trim();
      const plans = await exactCardPlans(deps, runGit, parent);
      if (!reconcileCards(deps, plans, false).final || !assertOneAuditRow(deps)) {
        throw new Error('authorized reconciliation replay worktree differs from its canonical commit');
      }
      return {
        result: initial.value.result,
        replayed: true,
        canonicalCommit,
      };
    }
    assertExternalState(deps);
    if (initial.value.disposition === 'eligible') {
      const claimed = deps.store.claimAuthorized20260801FailedRunReconciliation(deps.subject, deps.input);
      if (!claimed.ok) throw new Error(`authorized reconciliation claim failed: ${claimed.reason}`);
    }
    assertClaimed(deps);

    const dirty = (await reconciliationChanges(deps, runGit)).length > 0;
    if (!dirty) {
      const prepared = await isPreparedSettlementCommit(deps, runGit);
      if (prepared) return finalizePreparedSettlement(deps, runGit, prepared);
      await prepareCoordination(deps.repoRoot, runGit, deps.publication, deps.outboxRoot);
    }
    assertClaimed(deps);
    assertExternalState(deps);
    let base: string;
    if ((deps.publication ?? 'direct') === 'outbox') {
      base = (await runGit(deps.repoRoot, ['rev-parse', 'HEAD'])).trim();
    } else {
      await runGit(deps.repoRoot, ['fetch', 'origin', 'ops']);
      base = (await runGit(deps.repoRoot, ['rev-parse', 'refs/remotes/origin/ops'])).trim();
    }
    const plans = await exactCardPlans(deps, runGit, base);
    const auditPlan = (deps.publication ?? 'direct') === 'outbox'
      ? await remoteAuditPlan(deps, runGit, base)
      : await remoteAuditPlan(deps, runGit);

    // Python proves the exact origin blobs and every logical edge, then Node completes one physical
    // inbox -> terminal copy through a same-handle prefix operation before deleting the exact source.
    reconcileCards(deps, plans, true);
    if (!reconcileCards(deps, plans, false).final) throw new Error('authorized reconciliation cards did not reach terminal state');
    assertClaimed(deps);
    assertExternalState(deps);

    appendExactAuditRow(deps, auditPlan);
    if (!assertOneAuditRow(deps, auditPlan.baseline, auditPlan.suffix)) throw new Error('authorized reconciliation audit row was not durably appended');
    if (deps.faultAfterAudit) throw new Error('injected authorized reconciliation audit fault');
    assertClaimed(deps);

    const stagePaths = await reconciliationChanges(deps, runGit);
    if (!samePathSet(stagePaths, exactCommitPaths(deps.workflow))) {
      throw new Error('authorized reconciliation changed an unexpected card or audit path');
    }
    const localCommit = await createPreparedCoordinationCommit(deps.repoRoot, stagePaths, {
      runGit,
      message: 'chore(ops): reconcile authorized failed FYT predecessor',
      afterStage: deps.faultAfterGitAdd ? () => { throw new Error('injected authorized reconciliation post-add fault'); } : undefined,
    });
    assertClaimed(deps);
    assertExternalState(deps);
    if (!reconcileCards(deps, plans, false).final) throw new Error('authorized reconciliation terminal cards disappeared after local commit');
    if (!assertOneAuditRow(deps, auditPlan.baseline, auditPlan.suffix)) throw new Error('authorized reconciliation audit row disappeared after local commit');
    const prepared = await isPreparedSettlementCommit(deps, runGit);
    if (!prepared || prepared.commit !== localCommit || prepared.alreadyPublished) {
      throw new Error('authorized reconciliation commit changed an unexpected path set');
    }
    return finalizePreparedSettlement(deps, runGit, prepared);
  });
}

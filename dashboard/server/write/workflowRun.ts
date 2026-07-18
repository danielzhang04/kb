/**
 * Execute a validated v1 workflow definition by expanding it into one governed card DAG.
 *
 * The request is deliberately smaller than the full card schema. The authenticated operator supplies
 * intent and dependencies; the server supplies card ids, the workflow run id, claim tokens, and routing.
 * Every card is prepared and published by one fixed Python subprocess through scripts/cards.py.
 */
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { readAssignableOwners } from '../agents/assignable.ts';
import { defaultOwnerRouting } from './launch.ts';
import type { OwnerRouting, PyRunner } from './launch.ts';
import { assertFleetRunnable, defaultPreambleRunner } from './preambleGate.ts';
import type { PreambleRunner } from './preambleGate.ts';

export const MAX_WORKFLOW_STAGES = 32;

export type WorkflowRiskTier = 'T1' | 'T2';
export type WorkflowCardState = 'inbox' | 'blocked';

export interface WorkflowRunStageRequest {
  id: string;
  action: string;
  target: string;
  workOrder: string;
  riskTier: WorkflowRiskTier;
  owner: string;
  dependsOn: string[];
}

export interface WorkflowRunRequest {
  name: string;
  project: string;
  /** Optional durable-definition join key. It is metadata only; the server still mints a fresh runId. */
  workflowDefinitionId?: string;
  stages: WorkflowRunStageRequest[];
}

export interface WorkflowRunCardResult {
  stageId: string;
  cardId: string;
  state: WorkflowCardState;
  cardPath: string;
}

export interface WorkflowRunSuccess {
  ok: true;
  runId: string;
  cards: WorkflowRunCardResult[];
}

export type WorkflowRunOutcome =
  | WorkflowRunSuccess
  | { ok: false; reason: 'fleet-frozen'; problems: string[] }
  | { ok: false; reason: 'unauthenticated'; detail: string }
  | { ok: false; reason: 'invalid-workflow'; detail: string }
  | { ok: false; reason: 'owner-not-registered'; detail: string }
  | { ok: false; reason: 'routing-failed'; detail: string }
  | { ok: false; reason: 'card-op-failed'; detail: string };

export interface WorkflowRunDeps {
  repoRoot: string;
  runPreamble?: PreambleRunner;
  runPy?: PyRunner;
  assignableOwners?: (repoRoot: string) => Set<string>;
  ownerRouting?: (owner: string, repoRoot: string) => OwnerRouting;
  makeRunId?: () => string;
  /** Reconcile ops only after every gate, schema check, owner check, and routing resolution succeeds. */
  prepareWrite?: (repoRoot: string) => void;
}

interface SessionInput {
  token: string | null | undefined;
  config: SessionConfig;
}

interface PreparedStage extends WorkflowRunStageRequest {
  runtime: string;
  model: string;
}

interface WorkflowSubprocessPayload {
  runId: string;
  name: string;
  project: string;
  workflowDefinitionId?: string;
  stages: PreparedStage[];
}

const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TOP_LEVEL_FIELDS = new Set(['name', 'project', 'workflowDefinitionId', 'stages']);
const STAGE_FIELDS = new Set(['id', 'action', 'target', 'workOrder', 'riskTier', 'owner', 'dependsOn']);
const MAX_ACTION_LENGTH = 256;
const MAX_TARGET_LENGTH = 2048;
const MAX_WORK_ORDER_LENGTH = 64 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>, allowed: Set<string>, required: string[]): string | null {
  const unknown = Object.keys(value).find((key) => !allowed.has(key));
  if (unknown) return `unknown field '${unknown}'`;
  const missing = required.find((key) => !(key in value));
  return missing ? `missing field '${missing}'` : null;
}

function safeId(value: unknown, label: string): string | null {
  if (typeof value !== 'string' || !SAFE_ID_RE.test(value)) {
    return `${label} must be a filename-safe id of 1-64 characters`;
  }
  return null;
}

function boundedText(value: unknown, label: string, max: number): string | null {
  if (typeof value !== 'string' || value.trim() === '') return `${label} must be a non-empty string`;
  if (value.length > max) return `${label} must be at most ${max} characters`;
  if (value.includes('\0')) return `${label} must not contain NUL bytes`;
  return null;
}

/** Parse the closed v1 wire format. No coercion and no unknown fields. */
export function validateWorkflowRunRequest(input: unknown):
  | { ok: true; value: WorkflowRunRequest }
  | { ok: false; detail: string } {
  if (!isRecord(input)) return { ok: false, detail: 'request body must be an object' };
  const topError = exactFields(input, TOP_LEVEL_FIELDS, ['name', 'project', 'stages']);
  if (topError) return { ok: false, detail: topError };

  const nameError = safeId(input.name, 'name');
  if (nameError) return { ok: false, detail: nameError };
  const projectError = safeId(input.project, 'project');
  if (projectError) return { ok: false, detail: projectError };
  if (input.workflowDefinitionId !== undefined) {
    const definitionError = safeId(input.workflowDefinitionId, 'workflowDefinitionId');
    if (definitionError) return { ok: false, detail: definitionError };
  }
  if (!Array.isArray(input.stages) || input.stages.length === 0 || input.stages.length > MAX_WORKFLOW_STAGES) {
    return { ok: false, detail: `stages must contain 1-${MAX_WORKFLOW_STAGES} items` };
  }

  const stages: WorkflowRunStageRequest[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < input.stages.length; index += 1) {
    const raw = input.stages[index];
    if (!isRecord(raw)) return { ok: false, detail: `stages[${index}] must be an object` };
    const fieldsError = exactFields(raw, STAGE_FIELDS, [...STAGE_FIELDS]);
    if (fieldsError) return { ok: false, detail: `stages[${index}]: ${fieldsError}` };

    const idError = safeId(raw.id, `stages[${index}].id`);
    if (idError) return { ok: false, detail: idError };
    const id = raw.id as string;
    if (ids.has(id)) return { ok: false, detail: `duplicate stage id '${id}'` };
    ids.add(id);

    const actionError = boundedText(raw.action, `stages[${index}].action`, MAX_ACTION_LENGTH);
    if (actionError) return { ok: false, detail: actionError };
    const targetError = boundedText(raw.target, `stages[${index}].target`, MAX_TARGET_LENGTH);
    if (targetError) return { ok: false, detail: targetError };
    const workOrderError = boundedText(raw.workOrder, `stages[${index}].workOrder`, MAX_WORK_ORDER_LENGTH);
    if (workOrderError) return { ok: false, detail: workOrderError };
    if (raw.riskTier !== 'T1' && raw.riskTier !== 'T2') {
      return { ok: false, detail: `stages[${index}].riskTier must be T1 or T2; T3 requires the approvals path` };
    }
    const ownerError = safeId(raw.owner, `stages[${index}].owner`);
    if (ownerError) return { ok: false, detail: ownerError };
    if (!Array.isArray(raw.dependsOn) || raw.dependsOn.some((dep) => typeof dep !== 'string')) {
      return { ok: false, detail: `stages[${index}].dependsOn must be an array of stage ids` };
    }
    const dependsOn = raw.dependsOn as string[];
    if (new Set(dependsOn).size !== dependsOn.length) {
      return { ok: false, detail: `stages[${index}].dependsOn must not contain duplicates` };
    }

    stages.push({
      id,
      action: raw.action as string,
      target: raw.target as string,
      workOrder: raw.workOrder as string,
      riskTier: raw.riskTier,
      owner: raw.owner as string,
      dependsOn,
    });
  }

  for (const stage of stages) {
    for (const dependency of stage.dependsOn) {
      if (!ids.has(dependency)) return { ok: false, detail: `stage '${stage.id}' depends on missing stage '${dependency}'` };
      if (dependency === stage.id) return { ok: false, detail: `stage '${stage.id}' cannot depend on itself` };
    }
  }

  // Kahn's algorithm: consuming every node proves the graph is acyclic.
  const indegree = new Map(stages.map((stage) => [stage.id, stage.dependsOn.length]));
  const children = new Map(stages.map((stage) => [stage.id, [] as string[]]));
  for (const stage of stages) {
    for (const dependency of stage.dependsOn) children.get(dependency)?.push(stage.id);
  }
  const ready = stages.filter((stage) => stage.dependsOn.length === 0).map((stage) => stage.id);
  let visited = 0;
  while (ready.length > 0) {
    const id = ready.pop() as string;
    visited += 1;
    for (const child of children.get(id) ?? []) {
      const next = (indegree.get(child) ?? 0) - 1;
      indegree.set(child, next);
      if (next === 0) ready.push(child);
    }
  }
  if (visited !== stages.length) return { ok: false, detail: 'workflow stage graph contains a cycle' };

  return {
    ok: true,
    value: {
      name: input.name as string,
      project: input.project as string,
      ...(input.workflowDefinitionId === undefined ? {} : { workflowDefinitionId: input.workflowDefinitionId as string }),
      stages,
    },
  };
}

/**
 * Fixed subprocess program. It builds and validates every card first, saves all bytes under a temporary
 * queue root through cards.save, then publishes unique final paths. Any publication error removes every
 * path published by this invocation before exiting non-zero, so callers never observe a prefix DAG.
 */
export const WORKFLOW_CARD_OP_SCRIPT = `
import sys, json, os, tempfile
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

op = json.loads(sys.argv[1])
queue_root = Path("queue")
by_stage = {}

for stage in op["stages"]:
    body = "## Work order\\n\\n" + stage["workOrder"] + "\\n"
    card = cards.new_card(op["project"], stage["action"], stage["target"], stage["riskTier"], body=body)
    card.meta["workflow"] = op["runId"]
    cards.claim(card, stage["owner"])
    cards.stamp_routing(card, stage["runtime"], stage["model"])
    by_stage[stage["id"]] = card

for stage in op["stages"]:
    card = by_stage[stage["id"]]
    card.meta["depends-on"] = [by_stage[dep].meta["id"] for dep in stage["dependsOn"]]
    card.meta["state"] = "blocked" if card.meta["depends-on"] else "inbox"
    cards._validate(card.meta)

published = []
results = []
queue_root.parent.mkdir(parents=True, exist_ok=True)
try:
    with tempfile.TemporaryDirectory(prefix=".workflow-run-", dir=str(queue_root.parent)) as temp_dir:
        staged_root = Path(temp_dir)
        for stage in op["stages"]:
            card = by_stage[stage["id"]]
            cards.save(card, staged_root)
        for stage in op["stages"]:
            card = by_stage[stage["id"]]
            src = staged_root / cards.STATE_DIR[card.meta["state"]] / (card.meta["id"] + ".md")
            dest = queue_root / cards.STATE_DIR[card.meta["state"]] / (card.meta["id"] + ".md")
            dest.parent.mkdir(parents=True, exist_ok=True)
            if dest.exists():
                raise FileExistsError(str(dest))
            os.replace(src, dest)
            published.append(dest)
            results.append({"stageId": stage["id"], "cardId": card.meta["id"], "state": card.meta["state"], "cardPath": str(dest)})
except Exception:
    for path in reversed(published):
        try:
            path.unlink()
        except FileNotFoundError:
            pass
    raise

print(json.dumps({"runId": op["runId"], "cards": results}))
`.trim();

const defaultPyRunner: PyRunner = (repoRoot, code, jsonArg) => {
  try {
    const stdout = execFileSync('py', ['-3', '-c', code, jsonArg], { cwd: repoRoot, encoding: 'utf-8' });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: typeof err.status === 'number' ? err.status : 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
};

function generatedRunId(): string {
  return `wf-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function parseSuccess(stdout: string, expectedRunId: string, expectedStageIds: string[]): WorkflowRunSuccess {
  const line = stdout.trim().split(/\r?\n/).filter(Boolean).pop() ?? '';
  const parsed = JSON.parse(line) as { runId?: unknown; cards?: unknown };
  if (parsed.runId !== expectedRunId || !Array.isArray(parsed.cards) || parsed.cards.length !== expectedStageIds.length) {
    throw new Error('workflow card subprocess returned an invalid result');
  }
  const cards = parsed.cards.map((raw, index): WorkflowRunCardResult => {
    if (!isRecord(raw)) throw new Error('workflow card subprocess returned a malformed card result');
    const expectedStageId = expectedStageIds[index];
    if (raw.stageId !== expectedStageId || typeof raw.cardId !== 'string' || !SAFE_ID_RE.test(raw.cardId)) {
      throw new Error('workflow card subprocess returned an invalid card identity');
    }
    if (raw.state !== 'inbox' && raw.state !== 'blocked') throw new Error('workflow card subprocess returned an invalid card state');
    if (typeof raw.cardPath !== 'string') throw new Error('workflow card subprocess returned an invalid card path');
    const normalizedPath = raw.cardPath.replace(/\\/g, '/');
    const expectedPath = `queue/inbox/${raw.cardId}.md`;
    if (normalizedPath !== expectedPath) throw new Error('workflow card subprocess returned a path outside the expected queue location');
    return { stageId: expectedStageId, cardId: raw.cardId, state: raw.state, cardPath: normalizedPath };
  });
  return { ok: true, runId: expectedRunId, cards };
}

/** Gate, validate, resolve every owner, reconcile ops, and atomically publish the entire DAG. */
export function launchWorkflowRun(input: unknown, session: SessionInput, deps: WorkflowRunDeps): WorkflowRunOutcome {
  const preamble = assertFleetRunnable(deps.repoRoot, deps.runPreamble ?? defaultPreambleRunner);
  if (!preamble.ok) return { ok: false, reason: 'fleet-frozen', problems: preamble.problems };
  if (!session.token) return { ok: false, reason: 'unauthenticated', detail: 'no WebAuthn session token supplied' };
  const verified = verifySession(session.token, session.config);
  if (!verified.ok) return { ok: false, reason: 'unauthenticated', detail: verified.reason };

  const validated = validateWorkflowRunRequest(input);
  if (!validated.ok) return { ok: false, reason: 'invalid-workflow', detail: validated.detail };

  const assignable = (deps.assignableOwners ?? readAssignableOwners)(deps.repoRoot);
  const preparedStages: PreparedStage[] = [];
  const route = deps.ownerRouting ?? defaultOwnerRouting;
  for (const stage of validated.value.stages) {
    if (!assignable.has(stage.owner)) {
      return {
        ok: false,
        reason: 'owner-not-registered',
        detail: `owner '${stage.owner}' on stage '${stage.id}' is not a declared agent or registered default_worker`,
      };
    }
    try {
      preparedStages.push({ ...stage, ...route(stage.owner, deps.repoRoot) });
    } catch (error) {
      return {
        ok: false,
        reason: 'routing-failed',
        detail: `could not resolve routing for owner '${stage.owner}' on stage '${stage.id}': ${(error as Error).message}`,
      };
    }
  }

  const runId = (deps.makeRunId ?? generatedRunId)();
  if (!SAFE_ID_RE.test(runId)) return { ok: false, reason: 'card-op-failed', detail: 'server generated an invalid run id' };

  try {
    deps.prepareWrite?.(deps.repoRoot);
  } catch (error) {
    return { ok: false, reason: 'card-op-failed', detail: `could not prepare coordination write: ${(error as Error).message}` };
  }

  const payload: WorkflowSubprocessPayload = {
    runId,
    name: validated.value.name,
    project: validated.value.project,
    ...(validated.value.workflowDefinitionId === undefined ? {} : { workflowDefinitionId: validated.value.workflowDefinitionId }),
    stages: preparedStages,
  };
  const result = (deps.runPy ?? defaultPyRunner)(deps.repoRoot, WORKFLOW_CARD_OP_SCRIPT, JSON.stringify(payload));
  if (result.exitCode !== 0) {
    return { ok: false, reason: 'card-op-failed', detail: result.stderr.trim() || result.stdout.trim() || `cards.py exited ${result.exitCode}` };
  }
  try {
    return parseSuccess(result.stdout, runId, preparedStages.map((stage) => stage.id));
  } catch (error) {
    return { ok: false, reason: 'card-op-failed', detail: (error as Error).message };
  }
}

import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { pythonInvocation } from '../platform/python.ts';
import { commitPreparedCoordination, type GitRunner } from '../write/branch.ts';
import type { PyRunner } from '../write/launch.ts';
import type { WorkflowRunRequest } from '../write/workflowRun.ts';
import { openNoReparseFileTree, type NoReparseFileTree } from '../win32/noReparseFiles.ts';
import { parseCardFrontmatter } from '../planeA/cards.ts';
import { loadPolicyEnvironment, loadRuntimeSkillRegistry } from './environment.ts';
import { compileApprovedProposal } from './compiler.ts';
import { defaultWorkers } from './launch.ts';
import { validateServerCompiledPlanProposal } from './proposal.ts';
import {
  AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY,
  AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH,
  AUTHORIZED_20260801_FAILED_RUN_REF,
  AUTHORIZED_20260801_FAILED_RUN_STAGES,
  proposalSnapshotHash,
  type ControlPlaneStore,
  type ReconcileAuthorized20260801FailedRunInput,
} from './store.ts';
import type { JsonObject } from './types.ts';
import {
  AUTHORIZED_FAILED_RUN_CARD_SCRIPT,
  AuthorizedFailedRunPublishedUncommittedError,
  reconcileAuthorized20260801FailedRun,
  validateSettlementCommitObject,
} from './authorizedFailedRunReconciliation.ts';

const SOURCE_ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const HISTORICAL_PROPOSAL = JSON.parse(readFileSync(join(
  SOURCE_ROOT, 'dashboard', 'server', 'control', 'test-fixtures', 'authorized-20260801-fyt-proposal.json',
), 'utf8')) as JsonObject;
const AUDIT_PATH = 'ledgers/audit/dashboard-audit.ndjson';
const PYTHON = pythonInvocation();

const CLAIM_TOKENS: Readonly<Record<string, string>> = {
  idea: '423acd3901711d91', story: '42dc12e28c9cfdb9', 'judge-gate': '9e26962980f35e51',
  packaging: '0e3adb64cdbbe9f2', 'visual-plan': '9f92e7398245f981', 'shots-merge': 'f97c896d9febbe16',
  'slice-contract': '93bb455ea6be1e6e', images: '76494f40955f289a', 'image-review': 'e6bfb9e9f7636bf4',
  audio: '3f7d1f006bd55c24', 'audio-plan-merge': 'b9f371852559abe0', render: 'c770b38ecfba9a75',
  verify: '304c44e349cdb3bc',
};

const INPUT: ReconcileAuthorized20260801FailedRunInput = {
  expectedRunVersion: 7,
  expectedManagerGeneration: 1,
  expectedRequestRevision: 2,
  expectedNextEventCursor: 6,
  expectedProposalHash: AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH,
  idempotencyKey: AUTHORIZED_20260801_FAILED_RUN_IDEMPOTENCY_KEY,
};

function exactWorkflow(): { workflow: WorkflowRunRequest; artifactPaths: string[]; proposalSnapshot: JsonObject } {
  const proposalSnapshot = structuredClone(HISTORICAL_PROPOSAL);
  expect(proposalSnapshot.schema).toBe('kb.plan-proposal/v1');
  expect(proposalSnapshotHash(proposalSnapshot)).toBe(AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH);
  const proposal = validateServerCompiledPlanProposal(proposalSnapshot, loadRuntimeSkillRegistry(SOURCE_ROOT));
  if (!proposal.ok) throw new Error(proposal.detail);
  const compiled = compileApprovedProposal(
    proposal.value,
    AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH,
    AUTHORIZED_20260801_FAILED_RUN_PROPOSAL_HASH,
    {
      policy: loadPolicyEnvironment(SOURCE_ROOT, proposal.value.project, proposal.value.governanceRefs),
      defaultWorkers: defaultWorkers(SOURCE_ROOT),
    },
  );
  if (!compiled.ok || !compiled.value.workflow) {
    throw new Error(compiled.ok ? 'compiled workflow was unavailable' : compiled.detail);
  }
  return {
    workflow: compiled.value.workflow,
    proposalSnapshot,
    artifactPaths: proposal.value.stages.flatMap((stage) => stage.artifacts.map((artifact) => artifact.path)),
  };
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function seedAccounting(stateRoot: string): void {
  writeJson(join(stateRoot, 'control', 'execution-accounting', '2026-08-01.json'), {
    schema: 'kb.execution-accounting/v1',
    revision: 2,
    policyHash: 'c637d06def982e6470ecd7777132cbdbcd0fbd34cdbab6649c3cfa1246dbe941',
    windowId: '2026-08-01',
    reservations: [{
      reservationRef: 'reservation-32549b92-2dcb-4467-b12a-5e98cb4295ab',
      operationKey: 'reserve:attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7',
      fingerprint: '49a073543e2dc332926189f4758405f032f21758aa846b259fe10c4b66a3fdb1',
      subject: 'operator',
      runRef: AUTHORIZED_20260801_FAILED_RUN_REF,
      attemptRef: 'attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7',
      limits: { maxAttempts: 3, maxInputTokens: 2_000_000, maxOutputTokens: 400_000, maxCostUsdMicros: 5_000_000 },
      state: 'settled',
      usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 },
      settlementOperationKey: 'settle:attempt-e5672116-acdb-4dfd-887a-5c0566b92ae7',
      settlementFingerprint: '9b60e23a694ee81c9c15647f587d2df747d730d0fdb4d981a72a2a7afd8e1cef',
      reservedAt: '2026-08-01T03:32:49.199Z',
      settledAt: '2026-08-01T03:32:49.316Z',
    }],
  });
}

function cardSpecs(workflow: WorkflowRunRequest) {
  const refs = new Map<string, string>(
    AUTHORIZED_20260801_FAILED_RUN_STAGES.map((stage) => [stage.stageId, stage.cardRef]),
  );
  return AUTHORIZED_20260801_FAILED_RUN_STAGES.map((expected) => {
    const stage = workflow.stages.find((candidate) => candidate.id === expected.stageId);
    if (!stage) throw new Error(`missing compiled stage ${expected.stageId}`);
    return {
      cardRef: expected.cardRef,
      meta: {
        id: expected.cardRef,
        project: workflow.project,
        action: stage.action,
        target: stage.target,
        'risk-tier': stage.riskTier,
        owner: stage.owner,
        'claim-token': CLAIM_TOKENS[stage.id],
        state: stage.id === 'idea' ? 'inbox' : 'blocked',
        approval: null,
        workflow: AUTHORIZED_20260801_FAILED_RUN_REF,
        'depends-on': stage.dependsOn.map((dependency) => refs.get(dependency)),
        'variant-group': null,
        role: 'work',
        'session-id': null,
        runtime: expected.runtime,
        model: expected.model,
        'execution-controller': 'dashboard',
      },
      body: `## Work order\n\n${stage.workOrder}\n`,
    };
  });
}

function seedCards(repoRoot: string, workflow: WorkflowRunRequest): void {
  const script = `
import json, sys
from pathlib import Path
sys.path.insert(0, "scripts")
import cards
for spec in json.loads(sys.argv[1]):
    cards.save(cards.Card(meta=spec["meta"], body=spec["body"]), Path("queue"))
`;
  execFileSync('python', ['-c', script, JSON.stringify(cardSpecs(workflow))], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function readCard(repoRoot: string, relpath: string): { meta: Record<string, unknown>; body: string } {
  const script = `
import json, sys
from pathlib import Path
sys.path.insert(0, "scripts")
import cards
card = cards.parse(Path(sys.argv[1]))
print(json.dumps({"meta": card.meta, "body": card.body}))
`;
  return JSON.parse(execFileSync('python', ['-c', script, relpath], {
    cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()) as { meta: Record<string, unknown>; body: string };
}

class ReconciliationStore {
  phase: 'eligible' | 'claimed' | 'committed' = 'eligible';
  commitCalls: string[] = [];
  claimCalls = 0;
  throwBeforeFirstCommit = false;

  private receipt(canonicalCommit: string | null = null) {
    return {
      idempotencyKey: INPUT.idempotencyKey,
      fingerprint: 'fixed-test-fingerprint',
      phase: canonicalCommit ? 'committed' : 'claimed',
      claimedAt: '2026-08-01T04:00:00.000Z',
      updatedAt: canonicalCommit ? '2026-08-01T04:01:00.000Z' : '2026-08-01T04:00:00.000Z',
      canonicalCommit,
      eventCursor: canonicalCommit ? 6 : null,
    };
  }

  private result(canonicalCommit: string) {
    return {
      run: { runRef: AUTHORIZED_20260801_FAILED_RUN_REF, version: 8 },
      event: { cursor: 6, runRef: AUTHORIZED_20260801_FAILED_RUN_REF },
      receipt: this.receipt(canonicalCommit),
    };
  }

  preflightAuthorized20260801FailedRunReconciliation() {
    if (this.phase === 'eligible') return { ok: true as const, value: { disposition: 'eligible' as const, receipt: null, result: null } };
    if (this.phase === 'claimed') return { ok: true as const, value: { disposition: 'claimed' as const, receipt: this.receipt(), result: null } };
    const commit = this.commitCalls.at(-1) as string;
    return { ok: true as const, value: { disposition: 'replay' as const, receipt: this.receipt(commit), result: this.result(commit) } };
  }

  claimAuthorized20260801FailedRunReconciliation() {
    this.claimCalls += 1;
    this.phase = 'claimed';
    return { ok: true as const, value: this.receipt() };
  }

  commitAuthorized20260801FailedRunReconciliation(_subject: string, _input: unknown, canonicalCommit: string) {
    this.commitCalls.push(canonicalCommit);
    if (this.throwBeforeFirstCommit && this.commitCalls.length === 1) {
      throw new Error('simulated process loss before store commit');
    }
    this.phase = 'committed';
    return { ok: true as const, value: this.result(canonicalCommit) };
  }
}

interface Fixture {
  repoRoot: string;
  stateRoot: string;
  workflow: WorkflowRunRequest;
  proposalSnapshot: JsonObject;
  artifactPaths: string[];
  storeImpl: ReconciliationStore;
  store: ControlPlaneStore;
  runGit: GitRunner;
  runPy: PyRunner;
  gitCalls: string[][];
  initialBodies: Map<string, string>;
  baseline: string;
}

function fixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'authorized-reconciliation-'));
  const repoRoot = join(root, 'repo');
  const origin = join(root, 'origin.git');
  const stateRoot = join(root, 'state');
  mkdirSync(repoRoot, { recursive: true });
  mkdirSync(join(repoRoot, 'scripts'), { recursive: true });
  copyFileSync(join(SOURCE_ROOT, '.gitignore'), join(repoRoot, '.gitignore'));
  copyFileSync(join(SOURCE_ROOT, 'scripts', 'cards.py'), join(repoRoot, 'scripts', 'cards.py'));
  const { workflow, artifactPaths, proposalSnapshot } = exactWorkflow();
  expect(workflow.name).toBe('wf-097e79d2cedb6372a0ddc5cd329e28a1f23bcedcf42e8d36');
  expect(workflow.stages).toHaveLength(13);
  for (const directory of ['inbox', 'working', 'approvals', 'done']) {
    mkdirSync(join(repoRoot, 'queue', directory), { recursive: true });
  }
  seedCards(repoRoot, workflow);
  seedAccounting(stateRoot);
  mkdirSync(join(stateRoot, 'control', 'worktrees', AUTHORIZED_20260801_FAILED_RUN_REF), { recursive: true });

  git(root, ['init', '--bare', origin]);
  git(repoRoot, ['init', '-b', 'ops']);
  git(repoRoot, ['config', 'user.name', 'reconciliation-test']);
  git(repoRoot, ['config', 'user.email', 'reconciliation-test@agents.local']);
  git(repoRoot, ['remote', 'add', 'origin', origin]);
  git(repoRoot, ['add', '--', '.gitignore', 'scripts/cards.py', 'queue']);
  git(repoRoot, ['commit', '-m', 'test: seed exact failed run']);
  git(repoRoot, ['push', '-u', 'origin', 'ops']);
  const baseline = git(repoRoot, ['rev-parse', 'HEAD']).trim();

  const initialBodies = new Map(cardSpecs(workflow).map((spec) => [spec.cardRef, spec.body]));
  const gitCalls: string[][] = [];
  const runGit: GitRunner = (_root, args) => {
    gitCalls.push([...args]);
    return git(repoRoot, args);
  };
  const runPy: PyRunner = (_root, script, payload) => {
    const result = spawnSync(PYTHON.command, [...PYTHON.baseArgs, '-c', script, payload], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
  };
  const storeImpl = new ReconciliationStore();
  return {
    repoRoot, stateRoot, workflow, proposalSnapshot, artifactPaths, storeImpl,
    store: storeImpl as unknown as ControlPlaneStore,
    runGit, runPy, gitCalls, initialBodies, baseline,
  };
}

function deps(f: Fixture, overrides: Record<string, unknown> = {}) {
  return {
    repoRoot: f.repoRoot,
    stateRoot: f.stateRoot,
    subject: 'operator',
    input: INPUT,
    proposalSnapshot: f.proposalSnapshot,
    workflow: f.workflow,
    artifactPaths: f.artifactPaths,
    store: f.store,
    assertAuthorized: vi.fn(),
    runGit: f.runGit,
    runPy: f.runPy,
    ...overrides,
  };
}

function auditRows(f: Fixture): Record<string, unknown>[] {
  return readFileSync(join(f.repoRoot, ...AUDIT_PATH.split('/')), 'utf8')
    .split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

function assertTerminalCards(f: Fixture): void {
  for (const stage of AUTHORIZED_20260801_FAILED_RUN_STAGES) {
    const expectedState = stage.stageId === 'idea' ? 'rejected' : 'halted';
    const directory = stage.stageId === 'idea' ? 'done' : 'working';
    const card = readCard(f.repoRoot, `queue/${directory}/${stage.cardRef}.md`);
    expect(card.meta.state, stage.stageId).toBe(expectedState);
    expect(card.body, stage.stageId).toBe(f.initialBodies.get(stage.cardRef));
  }
}

describe('authorized failed FYT run reconciliation', () => {
  it('emits syntactically valid Python for the fixed card operation', () => {
    const result = spawnSync(PYTHON.command, [...PYTHON.baseArgs,
      '-c',
      'import sys; compile(sys.argv[1], "authorized-failed-run-card-script", "exec")',
      AUTHORIZED_FAILED_RUN_CARD_SCRIPT,
    ], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  });

  /*
   * PyYAML folds plain scalars at ~80 columns, at whitespace. A folded value becomes an indented
   * continuation line, which the TS card reader rejects outright — so a long `target:` would produce a
   * settled card no dashboard reader could parse. Both settlement dumps must disable folding.
   */
  it('writes long card values on one line that the TS card reader round-trips', () => {
    expect(AUTHORIZED_FAILED_RUN_CARD_SCRIPT.match(/safe_dump\([^)]*width=10\*\*9\)/g)).toHaveLength(2);
    const target = `orgs/faceless-youtube/channels/the-second-take/videos/2026-07-31-codex-thin-slice ${'and one more long segment '.repeat(4)}tail`;
    expect(target.length).toBeGreaterThan(120);
    const dumped = spawnSync(PYTHON.command, [...PYTHON.baseArgs, '-c', `
import json, sys, yaml
meta = json.loads(sys.argv[1])
print(yaml.safe_dump(meta, sort_keys=False, allow_unicode=True, width=10**9), end="")
`, JSON.stringify({ id: 'wf-long', project: 'faceless-youtube', action: 'render:slice', target, 'risk-tier': 'T2', owner: 'codex', state: 'blocked' })], { encoding: 'utf8' });
    expect(dumped.stderr).toBe('');
    expect(dumped.status).toBe(0);
    expect(dumped.stdout.split('\n').some((line) => /^\s/.test(line) && line.trim() !== '')).toBe(false);

    const card = parseCardFrontmatter(`---\n${dumped.stdout}---\n\n## Work order\n\nInert body.\n`);
    expect(card.meta.target).toBe(target);
    expect(card.meta.state).toBe('blocked');
  });

  it('settles all 13 exact cards in one canonical commit and one push', async () => {
    const f = fixture();
    expect(git(f.repoRoot, ['config', 'core.autocrlf']).trim()).toBe('true');
    const outcome = await reconcileAuthorized20260801FailedRun(deps(f));

    expect(outcome.replayed).toBe(false);
    expect(outcome.result.run.version).toBe(8);
    expect(f.storeImpl.claimCalls).toBe(1);
    expect(f.storeImpl.commitCalls).toEqual([outcome.canonicalCommit]);
    expect(f.gitCalls.filter((args) => args[0] === 'push')).toEqual([[
      'push', 'origin', `${outcome.canonicalCommit}:refs/heads/ops`,
      `--force-with-lease=refs/heads/ops:${f.baseline}`,
    ]]);
    expect(git(f.repoRoot, ['rev-list', '--count', `${f.baseline}..HEAD`]).trim()).toBe('1');
    expect(auditRows(f).filter((row) => row.action === 'control-authorized-failed-run-reconciliation-authorize')).toHaveLength(1);
    assertTerminalCards(f);

    const changed = git(f.repoRoot, ['diff-tree', '--no-commit-id', '--name-only', '-r', outcome.canonicalCommit])
      .split(/\r?\n/).filter(Boolean).sort();
    const expected = [
      AUDIT_PATH,
      ...AUTHORIZED_20260801_FAILED_RUN_STAGES.flatMap((stage) => [
        `queue/inbox/${stage.cardRef}.md`,
        `queue/${stage.stageId === 'idea' ? 'done' : 'working'}/${stage.cardRef}.md`,
      ]),
    ].sort();
    expect(changed).toEqual(expected);
  }, 30_000);

  it('heals an injected short terminal-card write without losing its exact origin preimage', async () => {
    const f = fixture();
    const faulting = openNoReparseFileTree(f.repoRoot, { createRoot: false, testShortWriteBytesOnce: 31 });
    await expect(reconcileAuthorized20260801FailedRun(deps(f, { fileTree: faulting })))
      .rejects.toThrow('injected-short-write');
    const idea = AUTHORIZED_20260801_FAILED_RUN_STAGES[0] as (typeof AUTHORIZED_20260801_FAILED_RUN_STAGES)[number];
    expect(readCard(f.repoRoot, `queue/inbox/${idea.cardRef}.md`).meta.state).toBe('inbox');

    const outcome = await reconcileAuthorized20260801FailedRun(deps(f));
    expect(outcome.result.run.version).toBe(8);
    assertTerminalCards(f);
  }, 30_000);

  it('resumes an injected short audit append without truncating the canonical baseline', async () => {
    const f = fixture();
    const normal = openNoReparseFileTree(f.repoRoot, { createRoot: false });
    const faulting = openNoReparseFileTree(f.repoRoot, { createRoot: false, testShortWriteBytesOnce: 19 });
    const fileTree: NoReparseFileTree = { ...normal, appendUtf8IfExact: faulting.appendUtf8IfExact };
    await expect(reconcileAuthorized20260801FailedRun(deps(f, { fileTree })))
      .rejects.toThrow('injected-short-write');
    const partial = readFileSync(join(f.repoRoot, ...AUDIT_PATH.split('/')), 'utf8');
    expect(partial).toHaveLength(19);

    const outcome = await reconcileAuthorized20260801FailedRun(deps(f));
    expect(outcome.result.run.version).toBe(8);
    expect(auditRows(f)).toHaveLength(1);
  }, 30_000);

  it('refuses a concurrent or extra-key audit row without overwriting it', async () => {
    const f = fixture();
    const normal = openNoReparseFileTree(f.repoRoot, { createRoot: false });
    const extra = JSON.stringify({
      ts: '2026-08-01T04:00:00.000Z', action: 'control-authorized-failed-run-reconciliation-authorize',
      owner: 'operator', target: AUTHORIZED_20260801_FAILED_RUN_REF, riskTier: 'T3',
      result: 'authorized:rejected-one-failed-and-halted-twelve-unstarted', detail: {}, extra: true,
    }) + '\n';
    const fileTree: NoReparseFileTree = {
      ...normal,
      appendUtf8IfExact(parts, expected, suffix) {
        writeFileSync(join(f.repoRoot, ...parts), extra, 'utf8');
        normal.appendUtf8IfExact(parts, expected, suffix);
      },
    };
    await expect(reconcileAuthorized20260801FailedRun(deps(f, { fileTree }))).rejects.toThrow('append-baseline');
    expect(readFileSync(join(f.repoRoot, ...AUDIT_PATH.split('/')), 'utf8')).toBe(extra);
  }, 30_000);

  it('restarts after save-before-unlink left an adjacent duplicate', async () => {
    const f = fixture();
    await expect(reconcileAuthorized20260801FailedRun(deps(f, { faultAfterMoves: 1 })))
      .rejects.toThrow('injected card transition fault');
    expect(f.storeImpl.phase).toBe('claimed');
    expect(git(f.repoRoot, ['status', '--porcelain']).trim()).not.toBe('');

    const outcome = await reconcileAuthorized20260801FailedRun(deps(f));
    expect(outcome.result.run.version).toBe(8);
    expect(f.gitCalls.filter((args) => args[0] === 'push')).toHaveLength(1);
    expect(auditRows(f)).toHaveLength(1);
    assertTerminalCards(f);
    // Two complete settlements (13 cards, python proofs, real git) run back to back; 30s is under the
    // real cost of this case once the whole file competes for the same CPU.
  }, 60_000);

  it('restarts after the audit append without duplicating the row', async () => {
    const f = fixture();
    await expect(reconcileAuthorized20260801FailedRun(deps(f, { faultAfterAudit: true })))
      .rejects.toThrow('injected authorized reconciliation audit fault');
    expect(auditRows(f)).toHaveLength(1);

    const outcome = await reconcileAuthorized20260801FailedRun(deps(f));
    expect(outcome.result.run.version).toBe(8);
    expect(auditRows(f)).toHaveLength(1);
    expect(f.gitCalls.filter((args) => args[0] === 'push')).toHaveLength(1);
    assertTerminalCards(f);
  }, 60_000); // two complete settlements back to back — see the note above

  it('preserves the exact origin/ops audit baseline and appends only its one row', async () => {
    const f = fixture();
    const baselineRow = { ts: '2026-07-31T23:59:59.000Z', action: 'pre-existing-baseline' };
    const audit = join(f.repoRoot, ...AUDIT_PATH.split('/'));
    mkdirSync(dirname(audit), { recursive: true });
    writeFileSync(audit, `${JSON.stringify(baselineRow)}\n`, 'utf8');
    git(f.repoRoot, ['add', '--', AUDIT_PATH]);
    git(f.repoRoot, ['commit', '-m', 'test: canonical audit baseline']);
    git(f.repoRoot, ['push', 'origin', 'ops']);

    await reconcileAuthorized20260801FailedRun(deps(f));
    const rows = auditRows(f);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual(baselineRow);
    expect(rows[1]?.action).toBe('control-authorized-failed-run-reconciliation-authorize');
  }, 30_000);

  it('restarts after git add left exactly the authorized 27 paths staged', async () => {
    const f = fixture();
    await expect(reconcileAuthorized20260801FailedRun(deps(f, { faultAfterGitAdd: true })))
      .rejects.toThrow('injected authorized reconciliation post-add fault');
    const staged = git(f.repoRoot, ['diff', '--cached', '--name-only', '--no-renames'])
      .split(/\r?\n/).filter(Boolean);
    expect(staged).toHaveLength(27);

    const outcome = await reconcileAuthorized20260801FailedRun(deps(f));
    expect(outcome.result.run.version).toBe(8);
    expect(f.gitCalls.filter((args) => args[0] === 'push')).toHaveLength(1);
    assertTerminalCards(f);
  }, 30_000);

  it('finalizes a pushed commit after process loss without a second git mutation', async () => {
    const f = fixture();
    f.storeImpl.throwBeforeFirstCommit = true;
    await expect(reconcileAuthorized20260801FailedRun(deps(f)))
      .rejects.toThrow('simulated process loss before store commit');
    const committedHead = git(f.repoRoot, ['rev-parse', 'HEAD']).trim();
    const mutationCount = () => f.gitCalls.filter((args) => args[0] === 'commit' || args[0] === 'push').length;
    expect(mutationCount()).toBe(2);

    const outcome = await reconcileAuthorized20260801FailedRun(deps(f));
    expect(outcome.canonicalCommit).toBe(committedHead);
    expect(outcome.result.run.version).toBe(8);
    expect(mutationCount()).toBe(2);
    expect(f.gitCalls.filter((args) => args[0] === 'push')).toHaveLength(1);
    expect(auditRows(f)).toHaveLength(1);
    assertTerminalCards(f);
  }, 30_000);

  it('refuses an unexpected dirty path before any commit or push', async () => {
    const f = fixture();
    writeFileSync(join(f.repoRoot, 'unexpected.txt'), 'not authorized\n', 'utf8');
    await expect(reconcileAuthorized20260801FailedRun(deps(f)))
      .rejects.toThrow('changed path outside the fixed settlement');
    expect(f.gitCalls.some((args) => args[0] === 'commit' || args[0] === 'push')).toBe(false);
  }, 30_000);

  it('refuses a pre-existing unrelated local commit without advancing origin/ops', async () => {
    const f = fixture();
    mkdirSync(join(f.repoRoot, 'ledgers'), { recursive: true });
    writeFileSync(join(f.repoRoot, 'ledgers', 'unrelated.ndjson'), '{"unrelated":true}\n', 'utf8');
    git(f.repoRoot, ['add', '--', 'ledgers/unrelated.ndjson']);
    git(f.repoRoot, ['commit', '-m', 'test: unrelated local coordination history']);

    await expect(reconcileAuthorized20260801FailedRun(deps(f)))
      .rejects.toThrow('sole unpublished commit');
    expect(git(f.repoRoot, ['rev-parse', 'refs/remotes/origin/ops']).trim()).toBe(f.baseline);
    expect(git(f.repoRoot, ['ls-remote', 'origin', 'refs/heads/ops']).trim().split(/\s+/)[0]).toBe(f.baseline);
    expect(f.gitCalls.some((args) => args[0] === 'push')).toBe(false);
    expect(f.storeImpl.phase).toBe('claimed');
    expect(f.storeImpl.commitCalls).toEqual([]);
  }, 30_000);

  /*
   * The coordination checkout is shared, and its other writers publish ops wholesale. A refused
   * publish that left the settlement commit behind would be pushed later by an unrelated save, with
   * none of its content proofs and with the store still at v7.
   */
  it('leaves no unpushed settlement commit for the next coordination writer to publish', async () => {
    const f = fixture();
    mkdirSync(join(f.repoRoot, 'ledgers'), { recursive: true });
    writeFileSync(join(f.repoRoot, 'ledgers', 'unrelated.ndjson'), '{"unrelated":true}\n', 'utf8');
    git(f.repoRoot, ['add', '--', 'ledgers/unrelated.ndjson']);
    git(f.repoRoot, ['commit', '-m', 'test: unrelated local coordination history']);
    const strandedParent = git(f.repoRoot, ['rev-parse', 'HEAD']).trim();

    await expect(reconcileAuthorized20260801FailedRun(deps(f))).rejects.toThrow('sole unpublished commit');
    expect(git(f.repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(strandedParent);
    expect(git(f.repoRoot, ['status', '--porcelain']).trim()).toBe('');
    expect(f.storeImpl.phase).toBe('claimed');

    // The next unrelated writer publishes ops wholesale; it must carry nothing of the settlement.
    writeFileSync(join(f.repoRoot, 'ledgers', 'later.ndjson'), '{"later":true}\n', 'utf8');
    await commitPreparedCoordination(f.repoRoot, 'ledgers/later.ndjson', {
      runGit: f.runGit, message: 'test: unrelated coordination write',
    });
    const published = git(f.repoRoot, ['ls-tree', '-r', '--name-only', 'refs/remotes/origin/ops'])
      .split(/\r?\n/).filter(Boolean);
    expect(published).toContain('ledgers/later.ndjson');
    expect(published.filter((path) => path.startsWith('queue/done/') || path.startsWith('queue/working/'))).toEqual([]);
    expect(published).not.toContain(AUDIT_PATH);
  }, 30_000);

  /*
   * The push exits 0 and the confirming fetch then flakes. `refs/remotes/origin/ops` is still the
   * pre-push view, so rolling back here would rewind local ops while the remote already holds the
   * settlement, report "refused" for a durable write, and leave the next invoke unable to read its own
   * origin cards.
   */
  it('keeps a lost publish confirmation durable: no rewind, published-uncommitted, re-invoke finalizes', async () => {
    const f = fixture();
    let pushed = false;
    const runGit: GitRunner = (root, args) => {
      if (args[0] === 'fetch' && pushed) throw new Error('fetch: connection reset by peer');
      if (args[0] === 'push') pushed = true;
      return f.runGit(root, args);
    };
    const failure = await reconcileAuthorized20260801FailedRun(deps(f, { runGit })).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AuthorizedFailedRunPublishedUncommittedError);

    const head = git(f.repoRoot, ['rev-parse', 'HEAD']).trim();
    expect((failure as AuthorizedFailedRunPublishedUncommittedError).canonicalCommit).toBe(head);
    expect(git(f.repoRoot, ['ls-remote', 'origin', 'refs/heads/ops']).trim().split(/\s+/)[0]).toBe(head);
    expect(f.storeImpl.phase).toBe('claimed');
    assertTerminalCards(f);

    const outcome = await reconcileAuthorized20260801FailedRun(deps(f));
    expect(outcome.canonicalCommit).toBe(head);
    expect(outcome.result.run.version).toBe(8);
    expect(f.gitCalls.filter((args) => args[0] === 'push')).toHaveLength(1);
  }, 60_000); // two complete settlements back to back

  it('reports a durable-but-unfinalized settlement as its own class, never as a refusal', async () => {
    const f = fixture();
    f.storeImpl.throwBeforeFirstCommit = true;
    const failure = await reconcileAuthorized20260801FailedRun(deps(f)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(AuthorizedFailedRunPublishedUncommittedError);
    const published = (failure as AuthorizedFailedRunPublishedUncommittedError).canonicalCommit;
    expect(published).toBe(git(f.repoRoot, ['rev-parse', 'HEAD']).trim());
    // The ops write really is durable: the operator must not be told it was refused.
    expect(git(f.repoRoot, ['ls-remote', 'origin', 'refs/heads/ops']).trim().split(/\s+/)[0]).toBe(published);
    assertTerminalCards(f);

    const outcome = await reconcileAuthorized20260801FailedRun(deps(f));
    expect(outcome.canonicalCommit).toBe(published);
    expect(outcome.result.run.version).toBe(8);
  }, 60_000); // two complete settlements back to back

  it('validates the named candidate object even when the worktree has been repaired', async () => {
    const f = fixture();
    await reconcileAuthorized20260801FailedRun(deps(f));
    const path = `queue/done/${AUTHORIZED_20260801_FAILED_RUN_STAGES[0]?.cardRef}.md`;
    const absolute = join(f.repoRoot, ...path.split('/'));
    const good = readFileSync(absolute, 'utf8');
    writeFileSync(absolute, `${good}malicious candidate drift\n`, 'utf8');
    git(f.repoRoot, ['add', '--', path]);
    git(f.repoRoot, ['commit', '--amend', '--no-edit']);
    const malicious = git(f.repoRoot, ['rev-parse', 'HEAD']).trim();
    writeFileSync(absolute, good, 'utf8');

    await expect(validateSettlementCommitObject(deps(f), f.runGit, malicious))
      .rejects.toThrow('card source/terminal raw transition differs');
  }, 30_000);

  it('rejects a candidate that recreates a schema-equivalent original inbox duplicate', async () => {
    const f = fixture();
    const outcome = await reconcileAuthorized20260801FailedRun(deps(f));
    const parent = git(f.repoRoot, ['rev-parse', `${outcome.canonicalCommit}^`]).trim();
    const stage = AUTHORIZED_20260801_FAILED_RUN_STAGES[0] as (typeof AUTHORIZED_20260801_FAILED_RUN_STAGES)[number];
    const path = `queue/inbox/${stage.cardRef}.md`;
    const filtered = git(f.repoRoot, ['cat-file', '--filters', `--path=${path}`, `${parent}:${path}`]);
    writeFileSync(join(f.repoRoot, ...path.split('/')), filtered, 'utf8');
    git(f.repoRoot, ['add', '--', path]);
    git(f.repoRoot, ['commit', '--amend', '--no-edit']);
    const duplicate = git(f.repoRoot, ['rev-parse', 'HEAD']).trim();
    await expect(validateSettlementCommitObject(deps(f), f.runGit, duplicate))
      .rejects.toThrow('raw path set differs');
  }, 30_000);

  it('rejects a candidate audit row with any extra top-level key', async () => {
    const f = fixture();
    await reconcileAuthorized20260801FailedRun(deps(f));
    const audit = join(f.repoRoot, ...AUDIT_PATH.split('/'));
    const row = auditRows(f)[0] as Record<string, unknown>;
    writeFileSync(audit, `${JSON.stringify({ ...row, extra: true })}\n`, 'utf8');
    git(f.repoRoot, ['add', '--', AUDIT_PATH]);
    git(f.repoRoot, ['commit', '--amend', '--no-edit']);
    const candidate = git(f.repoRoot, ['rev-parse', 'HEAD']).trim();
    await expect(validateSettlementCommitObject(deps(f), f.runGit, candidate))
      .rejects.toThrow('committed audit row differs');
  }, 30_000);

  it('revalidates committed replay reachability instead of returning v8 from store alone', async () => {
    const f = fixture();
    await reconcileAuthorized20260801FailedRun(deps(f));
    git(f.repoRoot, ['push', 'origin', `${f.baseline}:refs/heads/ops`, '--force']);
    await expect(reconcileAuthorized20260801FailedRun(deps(f)))
      .rejects.toThrow('replay commit is not canonical on origin/ops');
  }, 30_000);

  it('refuses a drifted proposal snapshot before store, filesystem, or git mutation', async () => {
    const f = fixture();
    const drifted = structuredClone(f.proposalSnapshot);
    const stages = drifted.stages as Array<Record<string, unknown>>;
    stages[0] = { ...stages[0], workOrder: `${String(stages[0]?.workOrder)} drifted` };

    await expect(reconcileAuthorized20260801FailedRun(deps(f, { proposalSnapshot: drifted })))
      .rejects.toThrow('proposal snapshot digest differs');
    expect(f.storeImpl.phase).toBe('eligible');
    expect(f.storeImpl.claimCalls).toBe(0);
    expect(f.gitCalls).toEqual([]);
    expect(git(f.repoRoot, ['status', '--porcelain']).trim()).toBe('');
    expect(git(f.repoRoot, ['rev-parse', 'HEAD']).trim()).toBe(f.baseline);
  }, 30_000);

  it('refuses a linked destination directory before writing outside queue', async () => {
    const f = fixture();
    const external = join(dirname(f.repoRoot), 'external-done');
    mkdirSync(external, { recursive: true });
    const destination = join(f.repoRoot, 'queue', 'done');
    rmSync(destination, { recursive: true });
    symlinkSync(external, destination, 'junction');

    await expect(reconcileAuthorized20260801FailedRun(deps(f)))
      .rejects.toThrow('unsafe-path');
    expect(readdirSync(external)).toEqual([]);
    expect(f.gitCalls.some((args) => args[0] === 'commit' || args[0] === 'push')).toBe(false);
    expect(f.storeImpl.phase).toBe('claimed');
  }, 30_000);

  it('refuses an intermediate state-root junction even when it exposes an exact-looking receipt', async () => {
    const f = fixture();
    const source = join(f.stateRoot, 'control', 'execution-accounting', '2026-08-01.json');
    const outside = join(dirname(f.stateRoot), 'outside-accounting');
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, '2026-08-01.json'), readFileSync(source));
    rmSync(dirname(source), { recursive: true });
    symlinkSync(outside, dirname(source), 'junction');
    await expect(reconcileAuthorized20260801FailedRun(deps(f))).rejects.toThrow('unsafe-path');
    expect(f.storeImpl.phase).toBe('eligible');
    expect(f.gitCalls).toEqual([]);
  }, 30_000);
});

/**
 * P4 W6.3 — the closed System-schedule → execution-path resolver and the seven execution paths
 * (plan §3.6, §5 W6.3). Every effectful capability is injected, so this suite drives the real mapping,
 * cap, batch-selection, merge-poll, and composition logic with in-memory fakes.
 */
import { describe, expect, it } from 'vitest';
import type { ProposalRecord } from './contracts.ts';
import type { BoundedProcessRequest, PathFacts, TargetWallPorts } from './targetWall.ts';
import { buildLearningImplementationManifest } from '../write/durableManifestService.ts';
import type { RouteDurableReceipt } from '../write/durableManifest.ts';
import type { ImplementerBatchRef, MergePollDeps } from '../reconciliation/mergePoll.ts';
import type { SweeperReadPorts, SweeperSnapshot } from '../reconciliation/sweeper.ts';
import { RepositoryPinError } from '../runtime/repoPin.ts';
import {
  composeSystemExecution,
  createImplementerBatchRegistry,
  ExecutionEngineError,
  ExecutionResolutionError,
  implementerBatchRef,
  ImplementerCapabilityError,
  resolveExecutionPath,
  runLearningsImplementer,
  runProposalProducer,
  runSystemSweeper,
  startMergePollTimer,
  SYSTEM_EXECUTION_PATHS,
  SYSTEM_SCHEDULE_IDS,
  type ImplementerPorts,
  type ProducerPorts,
  type ProposalCandidate,
} from './execution.ts';

const HEX40 = 'a'.repeat(40);
const HEX40_B = 'b'.repeat(40);

function record(overrides: Partial<ProposalRecord> & { id: string }): ProposalRecord {
  return {
    schema: 'kb.learning-proposal/v1',
    kind: 'lesson',
    sourceAgent: 'lessons-miner',
    sourceRun: 'run_01HXYZ',
    createdAt: '2026-08-20T05:30:00Z',
    target: 'agents/fyt-checker.md',
    status: 'proposed',
    batchId: null,
    implementedAt: null,
    contentHash: 'a'.repeat(64),
    evidence: [{ path: 'memory/lessons-miner.md', locator: '2026-08-20 run_01HXYZ' }],
    proposedChange: 'One bounded, testable change.',
    ...overrides,
  };
}

/** A wall that passes any `agents/<name>.md` / `routines/roles/<name>.md` target and refuses the rest. */
function wallPorts(): TargetWallPorts {
  return {
    runPython: async (request: BoundedProcessRequest) =>
      JSON.stringify({ ok: true, normalized: (JSON.parse(request.stdin) as { target: string }).target }),
    lstatPath: async (): Promise<PathFacts> => ({ exists: true, isFile: true, isSymbolicLink: false }),
  };
}

const COORD_RECEIPT: RouteDurableReceipt = { mode: 'coordination', branch: 'ops', commit: HEX40 };
const PR_RECEIPT: RouteDurableReceipt = {
  mode: 'pr', branch: 'dv3-p4/learning-implementation-x', pr: { owner: 'kb', repo: 'kb', number: 7, url: 'https://github.com/kb/kb/pull/7' },
};

describe('resolveExecutionPath — the closed seven', () => {
  it('maps each of the seven schedule IDs to exactly one path', () => {
    expect(SYSTEM_SCHEDULE_IDS).toHaveLength(7);
    const kinds = SYSTEM_SCHEDULE_IDS.map((id) => resolveExecutionPath(id, id).kind);
    expect(kinds).toEqual([
      'proposal-producer', 'proposal-producer', 'proposal-producer', 'proposal-producer',
      'proposal-producer', 'learnings-implementer', 'system-sweeper',
    ]);
  });

  it('only the Implementer among the seven requires durablePrWrites', () => {
    const need = SYSTEM_SCHEDULE_IDS.filter((id) => SYSTEM_EXECUTION_PATHS[id].requiresDurablePrWrites);
    expect(need).toEqual(['learnings-implementer']);
  });

  it('names the produced kind for each of the five producers', () => {
    expect(SYSTEM_EXECUTION_PATHS['lessons-miner'].producedKind).toBe('lesson');
    expect(SYSTEM_EXECUTION_PATHS['grader'].producedKind).toBe('grade-finding');
    expect(SYSTEM_EXECUTION_PATHS['model-audit'].producedKind).toBe('model-audit');
    expect(SYSTEM_EXECUTION_PATHS['hygiene'].producedKind).toBe('hygiene');
    expect(SYSTEM_EXECUTION_PATHS['context-lifecycle'].producedKind).toBe('context-lifecycle');
    expect(SYSTEM_EXECUTION_PATHS['learnings-implementer'].producedKind).toBeNull();
    expect(SYSTEM_EXECUTION_PATHS['system-sweeper'].producedKind).toBeNull();
  });

  it('refuses an unknown schedule ID before any launch', () => {
    expect(() => resolveExecutionPath('nightly-review', 'dispatcher-cloud'))
      .toThrowError(ExecutionResolutionError);
    try { resolveExecutionPath('bogus', 'bogus'); } catch (error) {
      expect((error as ExecutionResolutionError).reason).toBe('unknown-schedule');
    }
  });

  it('refuses a schedule fired against the wrong agent before any launch', () => {
    try {
      resolveExecutionPath('lessons-miner', 'system-sweeper');
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ExecutionResolutionError);
      expect((error as ExecutionResolutionError).reason).toBe('agent-mismatch');
    }
  });
});

describe('runProposalProducer — coordination-mode, no PR', () => {
  function candidate(kind: ProposalCandidate['kind'], target: string): ProposalCandidate {
    return { kind, target, evidence: [{ path: 'memory/x.md', locator: 'l' }], proposedChange: 'c' };
  }
  function producerPorts(overrides: Partial<ProducerPorts> = {}): { ports: ProducerPorts; published: RouteDurableReceipt[] } {
    const published: RouteDurableReceipt[] = [];
    return {
      published,
      ports: {
        runEngine: async () => [candidate('lesson', 'agents/fyt-checker.md')],
        renderRecords: async (_d, candidates) =>
          candidates.map((_c, i) => ({ relpath: `docs/proposals/learnings/2026-08-20-r${i}.md`, bytes: 'status: proposed' })),
        publishCoordination: async () => { published.push(COORD_RECEIPT); return COORD_RECEIPT; },
        baseCommit: async () => HEX40,
        ...overrides,
      },
    };
  }

  it('publishes rendered records in coordination mode', async () => {
    const { ports, published } = producerPorts();
    const outcome = await runProposalProducer(SYSTEM_EXECUTION_PATHS['lessons-miner'], 'run_01HXYZ', ports);
    expect(outcome.published).toBe(true);
    expect(published).toHaveLength(1);
    expect(published[0]!.mode).toBe('coordination');
  });

  it('zero candidates is a successful no-op that opens no publish', async () => {
    const { ports, published } = producerPorts({ runEngine: async () => [] });
    const outcome = await runProposalProducer(SYSTEM_EXECUTION_PATHS['hygiene'], 'run_a', ports);
    expect(outcome).toEqual({ published: false, reason: 'no-candidates' });
    expect(published).toHaveLength(0);
  });

  it('rejects a fire above the five-candidate cap', async () => {
    const six = Array.from({ length: 6 }, () => candidate('lesson', 'agents/fyt-checker.md'));
    const { ports } = producerPorts({ runEngine: async () => six });
    await expect(runProposalProducer(SYSTEM_EXECUTION_PATHS['lessons-miner'], 'run_a', ports))
      .rejects.toBeInstanceOf(ExecutionEngineError);
  });

  it('classifies an engine failure (timeout / engine crash)', async () => {
    const { ports } = producerPorts({ runEngine: async () => { throw new Error('worker timed out'); } });
    try {
      await runProposalProducer(SYSTEM_EXECUTION_PATHS['grader'], 'run_a', ports);
      throw new Error('expected rejection');
    } catch (error) {
      expect((error as ExecutionEngineError).stage).toBe('engine');
    }
  });

  it('rejects a candidate whose kind is not the producer’s sole declared kind', async () => {
    const { ports } = producerPorts({ runEngine: async () => [candidate('hygiene', 'agents/x.md')] });
    await expect(runProposalProducer(SYSTEM_EXECUTION_PATHS['lessons-miner'], 'run_a', ports))
      .rejects.toBeInstanceOf(ExecutionEngineError);
  });

  it('refuses to accept a PR receipt from a producer (coordination only)', async () => {
    const { ports } = producerPorts({ publishCoordination: async () => PR_RECEIPT });
    await expect(runProposalProducer(SYSTEM_EXECUTION_PATHS['model-audit'], 'run_a', ports))
      .rejects.toBeInstanceOf(ExecutionEngineError);
  });
});

describe('runLearningsImplementer — 4 staged / 5 skipped', () => {
  // One lesson + one agent-improvement in-wall (batched); one lesson out-of-wall + one each of the four
  // records-only kinds (skipped) — seven records total [P4-C22].
  const records: ProposalRecord[] = [
    record({ id: 'lessons-miner-run_01HXYZ-01', kind: 'lesson', target: 'agents/fyt-checker.md' }),
    record({ id: 'lessons-miner-run_01HXYZ-02', kind: 'agent-improvement', target: 'agents/grader.md' }),
    record({ id: 'lessons-miner-run_01HXYZ-03', kind: 'lesson', target: 'scripts/foo.py' }),
    record({ id: 'lessons-miner-run_01HXYZ-04', kind: 'hygiene', target: 'governance/x.md' }),
    record({ id: 'lessons-miner-run_01HXYZ-05', kind: 'model-audit', target: 'governance/y.md' }),
    record({ id: 'lessons-miner-run_01AAAA-01', kind: 'grade-finding', target: 'ledgers/z.tsv' }),
    record({ id: 'lessons-miner-run_01AAAA-02', kind: 'context-lifecycle', target: 'orgs/a/STATE.md' }),
  ];

  function implementerPorts(overrides: Partial<ImplementerPorts> = {}): {
    ports: ImplementerPorts; staged: string[][]; readRoots: string[];
  } {
    const staged: string[][] = [];
    const readRoots: string[] = [];
    return {
      staged,
      readRoots,
      ports: {
        readProposed: (root) => { readRoots.push(root); return records; },
        wallPorts: wallPorts(),
        publishImplementation: async (_batch, manifest) => { staged.push([...manifest.relpaths]); return PR_RECEIPT; },
        baseCommit: async () => HEX40,
        implementedAt: () => '2026-08-21T00:00:00Z',
        durablePrWrites: true,
        buildManifest: buildLearningImplementationManifest,
        ...overrides,
      },
    };
  }

  it('stages exactly four paths (two targets + two records) and skips five', async () => {
    const { ports, staged, readRoots } = implementerPorts();
    const outcome = await runLearningsImplementer('/abs/ops', ports);
    expect(readRoots).toEqual(['/abs/ops']); // read from the coordination checkout it was handed
    expect(outcome.published).toBe(true);
    if (!outcome.published) throw new Error('unreachable');
    expect(outcome.staged).toHaveLength(4);
    expect(outcome.staged).toEqual(expect.arrayContaining([
      'agents/fyt-checker.md', 'agents/grader.md',
    ]));
    expect(outcome.staged.filter((p) => p.startsWith('docs/proposals/learnings/'))).toHaveLength(2);
    expect(outcome.skipped).toHaveLength(5);
    expect(staged[0]).toHaveLength(4);
  });

  it('fails closed without durablePrWrites — no PR opens', async () => {
    const { ports, staged } = implementerPorts({ durablePrWrites: false });
    await expect(runLearningsImplementer('/abs/ops', ports)).rejects.toBeInstanceOf(ImplementerCapabilityError);
    expect(staged).toHaveLength(0);
  });

  it('a batch of zero candidates opens no PR', async () => {
    const onlyRecordsOnly = records.filter((r) => r.kind === 'hygiene' || r.kind === 'model-audit');
    const { ports, staged } = implementerPorts({ readProposed: () => onlyRecordsOnly });
    const outcome = await runLearningsImplementer('/abs/ops', ports);
    expect(outcome.published).toBe(false);
    if (outcome.published) throw new Error('unreachable');
    expect(outcome.skipped).toHaveLength(2);
    expect(staged).toHaveLength(0);
  });

  it('leaves every skipped record status:proposed and byte-identical (never mutated)', async () => {
    const before = records.map((r) => JSON.stringify(r));
    const { ports } = implementerPorts();
    await runLearningsImplementer('/abs/ops', ports);
    expect(records.map((r) => JSON.stringify(r))).toEqual(before);
    for (const r of records.filter((x) => x.id.endsWith('-03') || x.kind !== 'lesson' && x.kind !== 'agent-improvement')) {
      expect(r.status).toBe('proposed');
    }
  });
});

describe('createImplementerBatchRegistry — the merge-poll source', () => {
  const batch = {
    batchId: 'learn-' + 'd'.repeat(24), baseCommit: HEX40, implementedAt: '2026-08-21T00:00:00Z',
    records: [], targetPaths: ['agents/x.md'], recordPaths: ['docs/proposals/learnings/2026-08-20-r0.md'],
    relpaths: ['agents/x.md', 'docs/proposals/learnings/2026-08-20-r0.md'],
  };

  it('records an opened PR batch, lists it, and forgets it after retire', () => {
    const registry = createImplementerBatchRegistry();
    registry.record(implementerBatchRef(batch, PR_RECEIPT));
    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]!.batchId).toBe(batch.batchId);
    expect(registry.list()[0]!.recordPaths).toEqual(['docs/proposals/learnings/2026-08-20-r0.md']);
    registry.forget(batch.batchId);
    expect(registry.list()).toHaveLength(0);
  });

  it('refuses to derive a poll ref from a coordination (non-PR) receipt', () => {
    expect(() => implementerBatchRef(batch, COORD_RECEIPT)).toThrowError(ImplementerCapabilityError);
  });
});

describe('runSystemSweeper — read-only intent builder', () => {
  it('emits intents from a read-only snapshot and mutates nothing', async () => {
    const snapshot: SweeperSnapshot = {
      sourceRevision: HEX40, storeRevision: '3', cards: [], escalations: [], mirrorDrift: null, mergedMirrors: [],
    };
    const readPorts: SweeperReadPorts = { readSnapshot: async () => snapshot };
    const outcome = await runSystemSweeper(readPorts, {
      sweeperRef: 'fire-1', subjectRef: 'system-sweeper', now: '2026-08-21T00:00:00Z',
      fallbackRevisions: { sourceRevision: HEX40, storeRevision: '3' }, failureCardPath: null,
    });
    expect(outcome.failed).toBe(false);
    expect(Array.isArray(outcome.intents)).toBe(true);
  });
});

describe('startMergePollTimer — the Implementer-batch source', () => {
  function pollDeps(overrides: Partial<MergePollDeps> = {}): { deps: MergePollDeps; retired: string[]; batchReads: number } {
    const retired: string[] = [];
    const counters = { batchReads: 0 };
    const impl: ImplementerBatchRef = {
      batchId: 'learn-' + 'c'.repeat(24),
      recordPaths: ['docs/proposals/learnings/2026-08-20-r0.md'],
      pr: { owner: 'kb', repo: 'kb', number: 7 },
    };
    const deps: MergePollDeps = {
      repoPin: { owner: 'kb', repo: 'kb' },
      gh: async () => ({ merged: true, mergeCommit: HEX40_B, mergedAt: '2026-08-21T00:00:00Z' }),
      readOpenMirrorBatch: async () => null,
      readOpenImplementerBatches: async () => { counters.batchReads += 1; return [impl]; },
      readSourceRevision: async () => HEX40,
      readStoreRevision: () => '3',
      publish: async () => ({ outcome: 'applied', revision: HEX40 }),
      retire: async (input) => { retired.push(input.batchId); return { outcome: 'applied', revision: HEX40_B }; },
      invalidatePr: () => {},
      ...overrides,
    };
    return { deps, retired, get batchReads() { return counters.batchReads; } };
  }

  it('polls the open Implementer batches and drives the retire action on a confirmed merge', async () => {
    const state = pollDeps();
    const polled = new Promise<void>((resolve) => {
      const stop = startMergePollTimer(state.deps, { intervalMs: 60_000, onPoll: () => { stop(); resolve(); } });
    });
    await polled;
    expect(state.batchReads).toBeGreaterThanOrEqual(1); // the source IS the open Implementer batches
    expect(state.retired).toEqual(['learn-' + 'c'.repeat(24)]);
  });

  it('stop() halts the timer', async () => {
    const state = pollDeps();
    const stop = startMergePollTimer(state.deps, { intervalMs: 5, runImmediately: false });
    stop();
    await new Promise((r) => setTimeout(r, 30));
    expect(state.retired).toHaveLength(0);
  });
});

describe('composeSystemExecution — eager root, degrading pin', () => {
  const goodProbe = () => true;

  it('fails composition on a non-absolute or queue-less coordination root', () => {
    expect(() => composeSystemExecution({ coordinationRoot: 'relative', readRemote: () => 'https://github.com/kb/kb.git', directoryProbe: goodProbe }))
      .toThrowError(RepositoryPinError);
    expect(() => composeSystemExecution({ coordinationRoot: '/abs', readRemote: () => 'https://github.com/kb/kb.git', directoryProbe: () => false }))
      .toThrowError(RepositoryPinError);
  });

  it('pins a GitHub remote', () => {
    const composed = composeSystemExecution({
      coordinationRoot: '/abs/ops', readRemote: () => 'git@github.com:kb/kb.git', directoryProbe: goodProbe,
    });
    expect(composed.repoPin).toEqual({ owner: 'kb', repo: 'kb' });
    expect(composed.prSourceDegraded).toBe(false);
  });

  it('DEGRADES on a non-GitHub remote rather than crashing boot [W6.1c ruling]', () => {
    const composed = composeSystemExecution({
      coordinationRoot: '/abs/ops', readRemote: () => 'https://gitlab.com/kb/kb.git', directoryProbe: goodProbe,
    });
    expect(composed.repoPin).toBeNull();
    expect(composed.prSourceDegraded).toBe(true);
  });
});

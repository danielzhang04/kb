/**
 * Hermetic tests for the run-roster pty sessions and gated work-order delivery.
 *
 * Nothing real is touched: a fake `PtyHost` (recording every byte written into each session, and able to
 * emit output) drives the REAL persistent session registry, the control store is the in-memory one, and
 * the filesystem is a recording map. The load-bearing test is the STRUCTURAL HALT: with a gate
 * unapproved, the session's input transcript must contain no work order at all.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { HostOpenRequest, PtyHandle, PtyHost, PtySession } from '../pty/host.ts';
import { createPersistentSessionRegistry } from '../pty/persistentSessions.ts';
import { createInMemoryControlPlaneStore, type ControlPlaneStore } from './store.ts';
import type { JsonObject, RunDetail } from './types.ts';
import type { PlanProposal, ProposalStage, ResolvedAgentAssignment } from './proposal.ts';
import type { ExecutionProfile } from './policy.ts';
import type { AssignedAgentResolver } from './agentAssignmentResolver.ts';
import {
  buildRosterPermissionSettings,
  createRosterSessionManager,
  createRosterWorkerAdapter,
  detectReplReadiness,
  detectReplReadinessFresh,
  detectTurnEngaged,
  STALE_BUSY_QUIET_MS,
  matchCompletionMarker,
  projectRosterState,
  resolveRosterWorkDir,
  rosterAgentIds,
  rosterAgentScope,
  rosterAgentTools,
  stripTerminalControl,
  DELIVERY_NOT_READY_REASON,
  DELIVERY_NOT_ENGAGED_REASON,
  DELIVERY_TIMEOUT_REASON,
  type RosterFileSystem,
  type RosterSessionManager,
} from './rosterSessions.ts';

const PROFILES: ExecutionProfile[] = [
  { id: 'manager:claude:claude-fable-5', role: 'manager', runtime: 'claude', model: 'claude-fable-5', capabilities: ['read', 'emit-events'] },
  {
    id: 'worker:claude:claude-fable-5', role: 'worker', runtime: 'claude', model: 'claude-fable-5',
    capabilities: ['read', 'write-approved-scope', 'run-approved-commands', 'emit-events'],
  },
];

function assignment(agentId: string, role: 'manager' | 'worker'): ResolvedAgentAssignment {
  return {
    agentId,
    declarationPath: `agents/${agentId}.md`,
    declarationHash: 'a'.repeat(64),
    profileId: role === 'manager' ? 'manager:claude:claude-fable-5' : 'worker:claude:claude-fable-5',
    runtime: 'claude',
    model: 'claude-fable-5',
  };
}

function stage(input: {
  id: string;
  agentId: string;
  dependsOn?: string[];
  gates?: ProposalStage['humanGates'];
  artifacts?: ProposalStage['artifacts'];
}): ProposalStage {
  return {
    id: input.id,
    title: `Stage ${input.id}`,
    action: `build:${input.id}`,
    target: 'orgs/faceless-youtube/channels',
    workOrder: `Do ${input.id} for the slice.`,
    riskTier: 'T2',
    dependsOn: input.dependsOn ?? [],
    worker: { runtime: 'claude', model: 'claude-fable-5' },
    requiredSkills: [],
    scope: { read: ['orgs/faceless-youtube'], write: ['orgs/faceless-youtube/channels'] },
    artifacts: input.artifacts ?? [],
    checkpoints: [],
    humanGates: input.gates ?? [],
    assignment: assignment(input.agentId, 'worker'),
  };
}

function proposalFixture(): PlanProposal {
  return {
    schema: 'kb.plan-proposal/v1',
    proposalId: 'video-run-fixture',
    project: 'faceless-youtube',
    title: 'Produce one video',
    summary: 'Roster fixture.',
    manager: { runtime: 'claude', model: 'claude-fable-5', requiredSkills: [], assignment: assignment('fyt-runner', 'manager') },
    scope: { read: ['orgs/faceless-youtube'], write: ['orgs/faceless-youtube/channels'] },
    governanceRefs: ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md', 'orgs/faceless-youtube/contract.md'],
    stages: [
      stage({ id: 'idea', agentId: 'fyt-story' }),
      stage({
        id: 'story', agentId: 'fyt-story', dependsOn: ['idea'],
        gates: [{ id: 'g0-idea-pick', kind: 'approval', prompt: 'GATE 0 — pick the idea.' }],
      }),
      stage({
        id: 'images', agentId: 'fyt-visuals', dependsOn: ['story'],
        gates: [{ id: 'g2-visual-plan', kind: 'approval', prompt: 'GATE 2 — approve the plan.', spendAuthorization: true }],
      }),
    ],
    parameters: { channel: 'the-second-take', slug: 'st-042', slice: '2min' },
  };
}

/** Normalize path separators so assertions read the same on Windows and POSIX. */
function norm(value: string): string {
  return value.split('\\').join('/');
}

/** The exact title `execution.ts#stableHumanTitle` gives a declared gate's boundary. */
function gateTitle(stageId: string, gateId: string): string {
  return `automatic:gate:${stageId}:${gateId}`;
}

let sequence = 0;

function createApprovedRun(store: ControlPlaneStore, plan: PlanProposal): string {
  const created = store.createProposalRevision('operator', {
    sourceComposerRef: 'composer-1', sourceTurnId: 'video-run', title: plan.title,
    snapshot: plan as unknown as JsonObject,
  });
  if (!created.ok) throw new Error(created.detail);
  const approved = store.decideProposal('operator', created.value.proposalRef, 1, {
    expectedHash: created.value.hash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: 'approve-1',
  });
  if (!approved.ok) throw new Error(approved.detail);
  const run = store.createRun('operator', {
    title: plan.title,
    proposalRef: created.value.proposalRef,
    proposalRevision: 1,
    expectedProposalHash: created.value.hash,
    managerRuntime: plan.manager.runtime,
    managerModel: plan.manager.model,
    managerAssignment: plan.manager.assignment,
    idempotencyKey: 'launch-1',
    stages: plan.stages.map((item) => ({
      stageId: item.id, title: item.title, dependsOn: item.dependsOn, assignment: item.assignment,
    })),
  });
  if (!run.ok) throw new Error(run.detail);
  return run.value.run.runRef;
}

function detailOf(store: ControlPlaneStore, runRef: string): RunDetail {
  const detail = store.getRun('operator', runRef);
  if (!detail.ok) throw new Error(detail.detail);
  return detail.value;
}

/** Drive a stage to `succeeded` the way the engine does (ready → running → succeeded). */
function succeedStage(store: ControlPlaneStore, runRef: string, stageId: string): void {
  // blocked -> ready -> running -> succeeded; a stage already in one of those states replays harmlessly.
  for (const next of ['ready', 'running', 'succeeded'] as const) {
    const stageRow = detailOf(store, runRef).stages.find((item) => item.stageId === stageId);
    if (!stageRow) throw new Error(`stage ${stageId} missing`);
    const moved = store.transitionStage('operator', stageRow.stageRef, stageRow.version, next);
    if (!moved.ok) throw new Error(`${stageId}->${next}: ${moved.detail}`);
  }
}

/** Record the gate boundary the engine would create, and resolve it with a human decision. */
function resolveGate(
  store: ControlPlaneStore,
  runRef: string,
  stageId: string,
  gateId: string,
  decision: 'approved' | 'rejected',
): void {
  const stageRow = detailOf(store, runRef).stages.find((item) => item.stageId === stageId);
  if (!stageRow) throw new Error(`stage ${stageId} missing`);
  const created = store.createHumanRequest('operator', runRef, {
    stageRef: stageRow.stageRef, kind: 'approval', title: gateTitle(stageId, gateId), prompt: 'gate',
  });
  if (!created.ok) throw new Error(created.detail);
  const responded = store.respondHumanRequest('operator', created.value.requestRef, {
    expectedRevision: created.value.revision, decision, idempotencyKey: `respond-${stageId}-${gateId}`,
  });
  if (!responded.ok) throw new Error(responded.detail);
}

interface FakeHost {
  host: PtyHost;
  /** Every byte written into a session, in order. */
  writes: Map<string, string[]>;
  killed: Set<string>;
  emit(sessionId: string, chunk: string): void;
  exit(sessionId: string): void;
  opened: HostOpenRequest[];
}

function fakeHost(): FakeHost {
  let counter = 0;
  const writes = new Map<string, string[]>();
  const killed = new Set<string>();
  const opened: HostOpenRequest[] = [];
  const data = new Map<string, Array<(chunk: string) => void>>();
  const exits = new Map<string, Array<(evt: { exitCode: number; signal?: number }) => void>>();
  const host: PtyHost = {
    open(req: HostOpenRequest): PtySession {
      opened.push(req);
      const sessionId = `pty-roster-${(counter += 1)}`;
      writes.set(sessionId, []);
      data.set(sessionId, []);
      exits.set(sessionId, []);
      const handle: PtyHandle = {
        pid: 5000 + counter,
        onData(cb) { data.get(sessionId)?.push(cb); },
        onExit(cb) { exits.get(sessionId)?.push(cb); },
        write(chunk) { writes.get(sessionId)?.push(chunk); },
        resize() {},
        kill() { killed.add(sessionId); },
      };
      return { sessionId, handle };
    },
    stop(sessionId) { killed.add(sessionId); return true; },
    stopAll() { for (const id of writes.keys()) killed.add(id); },
    sessions() { return [...writes.keys()]; },
  };
  return {
    host, writes, killed, opened,
    emit(sessionId, chunk) { for (const cb of data.get(sessionId) ?? []) cb(chunk); },
    exit(sessionId) { for (const cb of exits.get(sessionId) ?? []) cb({ exitCode: 0 }); },
  };
}

/**
 * Recording filesystem. `stat`/`hashFile` replace the old `exists`, because `existsSync` was true for a
 * DIRECTORY named `shots.json` and for a 0-byte file — both of which satisfied a declared artifact.
 * `putDir` and a 0-byte `put` let a test stand exactly those two things where an artifact belongs.
 */
function fakeFs(existing: string[] = [], seed: { directories?: string[]; contents?: Record<string, string> } = {}): RosterFileSystem & {
  files: Map<string, string>;
  dirs: string[];
  removed: string[];
  /** Every `hashFile` call, in order — the cost assertion (a big artifact must not be hashed twice). */
  hashed: string[];
  /** Write real bytes at a path, the way a stage producing its artifact would. */
  put(path: string, contents: string): void;
  /** Stand a DIRECTORY where an artifact is declared. */
  putDir(path: string): void;
} {
  const files = new Map<string, string>();
  const dirs: string[] = [];
  const removed: string[] = [];
  const hashed: string[] = [];
  const directories = new Set((seed.directories ?? []).map((path) => norm(path)));
  for (const path of existing) files.set(norm(path), `seed:${norm(path)}`);
  for (const [path, value] of Object.entries(seed.contents ?? {})) files.set(norm(path), value);
  return {
    files,
    dirs,
    removed,
    hashed,
    ensureDir(path) { dirs.push(path); },
    readFile(path) { return files.get(norm(path)) ?? null; },
    writeFile(path, contents) { files.set(norm(path), contents); },
    stat(path) {
      const key = norm(path);
      if (directories.has(key)) return { regularFile: false, size: 0 };
      const value = files.get(key);
      return value === undefined ? null : { regularFile: true, size: Buffer.byteLength(value, 'utf8') };
    },
    hashFile(path) {
      const key = norm(path);
      hashed.push(key);
      return createHash('sha256').update(files.get(key) ?? '').digest('hex');
    },
    removeDir(path) {
      const prefix = `${norm(path)}/`;
      removed.push(norm(path));
      for (const key of [...files.keys()]) if (key.startsWith(prefix)) files.delete(key);
    },
    put(path, contents) { files.set(norm(path), contents); },
    putDir(path) { directories.add(norm(path)); },
  };
}

/**
 * A settled REPL frame: the idle input box AND the permission-mode cycler footer the CLI renders on every
 * in-REPL frame. Emitted into every freshly spawned test terminal because readiness now requires POSITIVE
 * evidence the input line is live (a `shift+tab to cycle` match), not merely a non-empty, menu-free frame —
 * the acceptance-modal/onboarding frames that swallowed a work order were exactly non-empty and menu-free.
 */
const IDLE_FRAME = '╭───╮\r\n│ >  │\r\n╰───╯\r\n  ⏵⏵ auto mode on (shift+tab to cycle)\r\n';

/**
 * A LIVE running-turn frame — the spinner footer the CLI paints while a turn is in flight (captured shape:
 * the interrupt hint + elapsed-seconds counter + in-flight token counter, all {@link BUSY_MARKERS}). This
 * is the POSITIVE evidence the outcome-verified submit (2026-07-30) requires before it records "working": a
 * delivered order must be OBSERVED to start a turn, never merely written. Emitted after a delivery to stand
 * the engaged turn a real terminal would show.
 */
const BUSY_FRAME = '✻ Working… ❯ esc to interrupt (2s · thinking) ↓ 40 tokens\r\n';

function harness(options: {
  plan?: PlanProposal;
  existingPaths?: string[];
  deliveryTimeoutMs?: number;
  replReadyTimeoutMs?: number;
  /** The server-owned workflow tool cap the per-run permission settings are built from. */
  workflowTools?: (workflowProfileId: string | null) => readonly string[];
  /** Runs on every readiness-backoff sleep, so a test can change what is on screen between polls. */
  onSleep?: (elapsedMs: number) => void;
  seed?: { directories?: string[]; contents?: Record<string, string> };
  /**
   * Leave freshly spawned terminals SILENT — nothing on screen at all, which is what a terminal that
   * has not yet booted `claude` looks like. Off by default: see {@link IDLE_FRAME}.
   */
  coldTerminals?: boolean;
} = {}) {
  const plan = options.plan ?? proposalFixture();
  const store = createInMemoryControlPlaneStore({ newId: () => `id-${++sequence}` });
  const runRef = createApprovedRun(store, plan);
  const registry = createPersistentSessionRegistry();
  const host = fakeHost();
  const fs = fakeFs(options.existingPaths ?? [], options.seed ?? {});
  const resolve = vi.fn((input: Parameters<AssignedAgentResolver['resolve']>[0]) => ({
    assignment: { ...input.assignment },
    instructionMarkdown: `# ${input.assignment.agentId}\n\nYou own your phase.`,
  }));
  let token = 0;
  // A fake clock the injected backoff sleep advances, so readiness polling is deterministic and the
  // suite never waits on a real timer.
  let clock = 0;
  const sleeps: number[] = [];
  const sessions = createRosterSessionManager({
    store,
    repoRoot: '/repo',
    stateRoot: '/state',
    host: host.host,
    registry,
    assignedAgents: { resolve },
    resolveProfiles: () => PROFILES,
    fs,
    mintToken: () => `${(token += 1)}`.padStart(32, '0').replace(/[^0-9a-f]/g, '0'),
    now: () => clock,
    sleep: async (ms) => { sleeps.push(ms); clock += ms; options.onSleep?.(clock); },
    resolveWorkflowTools: options.workflowTools ?? (() => ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']),
    ...(options.deliveryTimeoutMs === undefined ? {} : { deliveryTimeoutMs: options.deliveryTimeoutMs }),
    ...(options.replReadyTimeoutMs === undefined ? {} : { replReadyTimeoutMs: options.replReadyTimeoutMs }),
  });
  // A spawned terminal is stood up at a settled prompt unless the test asked for a cold one. An empty
  // screen is no longer `ready` — it is the "the REPL never came up" case — so a fixture that spawns and
  // immediately delivers would otherwise be testing the cold-start park rather than what it means to.
  // This mirrors reality: a real pty answers within milliseconds of the launch line.
  const spawned: RosterSessionManager = {
    ...sessions,
    ensureRoster(input) {
      const result = sessions.ensureRoster(input);
      if (!options.coldTerminals) {
        for (const row of sessions.state(input.subject, input.runRef)) {
          if (row.sessionId) host.emit(row.sessionId, IDLE_FRAME);
        }
      }
      return result;
    },
  };
  return { plan, store, runRef, registry, host, fs, sessions: spawned, resolve, sleeps };
}

function stageOf(plan: PlanProposal, stageId: string): ProposalStage {
  const found = plan.stages.find((item) => item.id === stageId);
  if (!found) throw new Error(`stage ${stageId} missing`);
  return found;
}

function stageRefOf(store: ControlPlaneStore, runRef: string, stageId: string): string {
  const found = detailOf(store, runRef).stages.find((item) => item.stageId === stageId);
  if (!found) throw new Error(`stage ${stageId} missing`);
  return found.stageRef;
}

function deliverInput(store: ControlPlaneStore, runRef: string, plan: PlanProposal, stageId: string) {
  const proposalStage = stageOf(plan, stageId);
  return {
    subject: 'operator',
    runRef,
    stageRef: stageRefOf(store, runRef, stageId),
    stageId,
    attemptRef: `attempt-${stageId}`,
    project: plan.project,
    proposalStage,
    assignedAgent: {
      assignment: proposalStage.assignment as ResolvedAgentAssignment,
      instructionMarkdown: '# agent',
    },
  };
}

function sessionIdFor(sessions: RosterSessionManager, runRef: string, agentId: string): string {
  const row = sessions.state('operator', runRef).find((item) => item.agentId === agentId);
  if (!row?.sessionId) throw new Error(`agent ${agentId} has no session`);
  return row.sessionId;
}

describe('roster spawn lifecycle', () => {
  it('spawns exactly one session per DISTINCT agent id, manager included', () => {
    const { plan, sessions, runRef, registry, host } = harness();
    expect(rosterAgentIds(plan)).toEqual(['fyt-runner', 'fyt-story', 'fyt-visuals']);
    const ensured = sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    // Two stages share fyt-story: one session, not two.
    expect(ensured.spawned).toEqual(['fyt-runner', 'fyt-story', 'fyt-visuals']);
    expect(registry.list('operator')).toHaveLength(3);
    expect(host.opened.every((req) => norm(req.cwd) === '/repo/orgs/faceless-youtube')).toBe(true);
    // A second ensure is idempotent: nothing respawns.
    const again = sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    expect(again).toMatchObject({ spawned: [], existing: ['fyt-runner', 'fyt-story', 'fyt-visuals'] });
    expect(registry.list('operator')).toHaveLength(3);
  });

  it('boots each session with the verified declaration, run params, and work dir as binding context', () => {
    const { plan, sessions, runRef, fs, host, resolve } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    // The SAME server-owned resolver the engine uses re-proves every declaration before a spawn.
    expect(resolve).toHaveBeenCalledTimes(3);
    expect(resolve.mock.calls.map(([input]) => [input.assignment.agentId, input.role, input.project])).toEqual([
      ['fyt-runner', 'manager', 'faceless-youtube'],
      ['fyt-story', 'worker', 'faceless-youtube'],
      ['fyt-visuals', 'worker', 'faceless-youtube'],
    ]);
    const binding = fs.files.get('/state/control/roster/' + runRef + '/fyt-story/binding.md');
    expect(binding).toBeDefined();
    expect(binding).toContain('agents/fyt-story.md');
    expect(binding).toContain('a'.repeat(64));
    expect(binding).toContain('worker:claude:claude-fable-5');
    expect(binding).toContain('- channel: the-second-take');
    expect(binding).toContain('- slug: st-042');
    expect(binding).toContain('- slice: 2min');
    expect(norm(binding ?? '')).toContain('/repo/orgs/faceless-youtube');
    expect(binding).toContain('# fyt-story');
    // The only thing written into the terminal at spawn is the launch line pointing at that binding.
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    expect(host.writes.get(sessionId)).toHaveLength(1);
    expect(host.writes.get(sessionId)?.[0]).toContain('claude --model claude-fable-5');
    expect(host.writes.get(sessionId)?.[0]).toContain('binding.md');
  });

  it('refuses to spawn an agent whose declaration no longer verifies', () => {
    const { plan, store, runRef, registry, host, fs } = harness();
    const sessions = createRosterSessionManager({
      store, repoRoot: '/repo', stateRoot: '/state', host: host.host, registry, fs,
      assignedAgents: { resolve: () => { throw new Error('assigned agent resolution refused: declaration hash changed'); } },
      resolveProfiles: () => PROFILES,
    });
    expect(() => sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan })).toThrow(/declaration hash changed/);
  });

  it('deletes the retired run\'s order files and binding contexts (they carry live tokens)', async () => {
    const { plan, store, sessions, runRef, fs } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    const orderPath = `/state/control/roster/${runRef}/fyt-story/orders/story.md`;
    expect(fs.files.get(orderPath)).toMatch(/completion token: [0-9a-f]{32}/);
    sessions.retire(runRef, 'run succeeded');
    await pending;
    // A retired roster's tokens are dead; keeping them on disk is a needless durable copy. Resume
    // re-authors both files from the immutable proposal, so nothing load-bearing is lost.
    expect(fs.removed).toContain(`/state/control/roster/${runRef}`);
    expect([...fs.files.keys()].filter((path) => path.includes(`/roster/${runRef}/`))).toEqual([]);
  });

  it('retires the roster on completion and re-spawns it on a later ensure (resume)', () => {
    const { plan, sessions, runRef, host, registry } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const storySession = sessionIdFor(sessions, runRef, 'fyt-story');
    const retired = sessions.retire(runRef, 'run succeeded');
    expect(retired).toHaveLength(3);
    expect(host.killed.has(storySession)).toBe(true);
    // Graceful stop first, then the reap: the last byte written is an explicit exit.
    expect(host.writes.get(storySession)?.at(-1)).toBe('/exit\r');
    expect(registry.list('operator')).toHaveLength(0);
    expect(sessions.hasRoster(runRef)).toBe(false);
    const resumed = sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    expect(resumed.spawned).toEqual(['fyt-runner', 'fyt-story', 'fyt-visuals']);
  });

  it('re-spawns a session whose shell exited, instead of delivering into a corpse', () => {
    const { plan, sessions, runRef, host } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const dead = sessionIdFor(sessions, runRef, 'fyt-visuals');
    host.exit(dead);
    const ensured = sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    expect(ensured.spawned).toEqual(['fyt-visuals']);
    expect(ensured.existing).toEqual(['fyt-runner', 'fyt-story']);
    expect(sessionIdFor(sessions, runRef, 'fyt-visuals')).not.toBe(dead);
  });

  it('resumes a run after a simulated daemon restart from durable store state alone', () => {
    const { plan, store, runRef, sessions } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    // A daemon restart loses every pty child AND the whole roster manager. A fresh one, over the same
    // durable store, brings the roster back.
    const restartedHost = fakeHost();
    const restarted = createRosterSessionManager({
      store, repoRoot: '/repo', stateRoot: '/state', host: restartedHost.host,
      registry: createPersistentSessionRegistry(), fs: fakeFs(),
      assignedAgents: { resolve: (input) => ({ assignment: { ...input.assignment }, instructionMarkdown: '# agent' }) },
      resolveProfiles: () => PROFILES,
    });
    expect(restarted.hasRoster(runRef)).toBe(false);
    const ensured = restarted.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    expect(ensured.spawned).toEqual(['fyt-runner', 'fyt-story', 'fyt-visuals']);
    expect(restarted.hasRoster(runRef)).toBe(true);
    // The recovered roster still reports state for the run.
    expect(restarted.state('operator', runRef).map((row) => row.agentId))
      .toEqual(['fyt-runner', 'fyt-story', 'fyt-visuals']);
  });
});

describe('gated work-order delivery', () => {
  it('THE STRUCTURAL HALT: an unapproved gate means the work order never reaches the session', async () => {
    const { plan, store, sessions, runRef, fs, host } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    const writesBefore = [...(host.writes.get(sessionId) ?? [])];
    succeedStage(store, runRef, 'idea'); // dependency satisfied; ONLY the gate is missing

    const result = await sessions.deliver(deliverInput(store, runRef, plan, 'story'));

    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain("human gate 'g0-idea-pick' is not approved");
    // 1. No order file was authored anywhere.
    expect([...fs.files.keys()].filter((path) => path.includes('/orders/'))).toEqual([]);
    // 2. The session's INPUT TRANSCRIPT is byte-identical to what it was before the delivery attempt:
    //    not one character of the work order was written into the terminal.
    expect(host.writes.get(sessionId)).toEqual(writesBefore);
    expect(norm(host.writes.get(sessionId)?.join('') ?? '')).not.toContain('Do story');
    expect(norm(host.writes.get(sessionId)?.join('') ?? '')).not.toContain('orders/story.md');
  });

  it('withholds delivery while a gate is REJECTED, and while a dependency has not succeeded', async () => {
    const { plan, store, sessions, runRef, host } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');

    // Dependency not yet succeeded, gate approved → still withheld, and named as the dependency.
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const blockedByDependency = await sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    expect(blockedByDependency.summary).toContain("dependency stage 'idea' has not succeeded");

    expect(norm(host.writes.get(sessionId)?.join('') ?? '')).not.toContain('orders/story.md');
  });

  it('an open (unanswered) request on the stage also withholds delivery', async () => {
    const { plan, store, sessions, runRef } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    succeedStage(store, runRef, 'idea');
    const stageRef = stageRefOf(store, runRef, 'story');
    const created = store.createHumanRequest('operator', runRef, {
      stageRef, kind: 'approval', title: gateTitle('story', 'g0-idea-pick'), prompt: 'GATE 0',
    });
    expect(created.ok).toBe(true);
    const result = await sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    expect(result.summary).toContain('open human request');
  });

  it('delivers after approval and completes on the delivery\'s own marker', async () => {
    const { plan, store, sessions, runRef, fs, host } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');

    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    // The submitted order starts a turn — the outcome-verified submit records "working" only once it sees
    // that running-turn frame, so stand it up the way a real terminal would before the marker lands.
    host.emit(sessionId, BUSY_FRAME);
    const orderPath = `/state/control/roster/${runRef}/fyt-story/orders/story.md`;
    const order = fs.files.get(orderPath);
    expect(order).toBeDefined();
    expect(order).toContain('Do story for the slice.');
    expect(order).toContain('FYT-STAGE-<VERDICT> story');
    // The order file never spells a literal verdict, so echoing it cannot fabricate a completion.
    expect(order).not.toContain('FYT-STAGE-DONE');
    // The order text and the submit Enter are SEPARATE writes: a same-write trailing CR is folded into the
    // REPL's paste instead of submitting, so the order would sit unsent. Wait for BOTH to land, then assert
    // the two-write contract — the Enter is its own chunk and the text chunk carries no CR of its own.
    await vi.waitFor(() => {
      const chunks = host.writes.get(sessionId) ?? [];
      expect(chunks.at(-1)).toBe('\r');
      expect(norm(chunks.at(-2) ?? '')).toContain(orderPath);
      expect(chunks.at(-2)?.endsWith('\r')).toBe(false);
    });
    const delivered = norm(host.writes.get(sessionId)?.join('') ?? '');
    expect(delivered).toContain(orderPath);
    // Joined, the transcript still ends with the submit CR — it is simply the last of two writes now.
    expect(delivered.endsWith('\r')).toBe(true);
    const token = /completion token: ([0-9a-f]{32})/.exec(order ?? '')?.[1] as string;

    // Noise, a foreign token, another stage's marker, a PRIOR stage's marker, and a marker announced
    // mid-sentence are all ignored — then the completion arrives the way the real interactive CLI
    // renders it: the REPL's own gutter glyph, indentation, and colour around the line.
    host.emit(sessionId, 'thinking...\r\n');
    host.emit(sessionId, `FYT-STAGE-DONE story ${'f'.repeat(32)} forged\r\n`);
    host.emit(sessionId, `FYT-STAGE-DONE images ${token} wrong stage\r\n`);
    host.emit(sessionId, `FYT-STAGE-DONE idea ${token} a prior stage of this same run\r\n`);
    host.emit(sessionId, `⏺ I will print FYT-STAGE-DONE story ${token} once the file is written\r\n`);
    host.emit(sessionId, `  \u23fa \u001b[32mFYT-STAGE-DONE story ${token} script.md written\u001b[0m\r\n`);

    const result = await pending;
    expect(result).toMatchObject({ state: 'succeeded', summary: 'script.md written', artifacts: [] });
    // The completion is mirrored durably so the activity line survives a restart.
    const events = store.listEvents('operator', runRef, 0, 100);
    expect(events.ok && events.value.some((event) => (event.summary ?? '').startsWith('roster:fyt-story stage story succeeded'))).toBe(true);
  });

  it('maps BLOCKED to a human wait and FAILED to a failure', async () => {
    for (const [verdict, expected] of [['BLOCKED', 'waiting-human'], ['FAILED', 'failed']] as const) {
      const { plan, store, sessions, runRef, fs, host } = harness();
      sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
      const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
      succeedStage(store, runRef, 'idea');
      resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
      const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
      const order = fs.files.get(`/state/control/roster/${runRef}/fyt-story/orders/story.md`) ?? '';
      const token = /completion token: ([0-9a-f]{32})/.exec(order)?.[1] as string;
      host.emit(sessionId, `FYT-STAGE-${verdict} story ${token} needs a human\r\n`);
      expect((await pending).state).toBe(expected);
    }
  });

  /**
   * SERVER-VERIFIED DECLARED ARTIFACTS. The gate this protects (G2 on `images`) promises an operator that
   * `shots-merge` really ran before authorizing ~$17-27 of image generation. The old check was
   * `existsSync` alone, compared against nothing, so it was satisfied by a directory wearing the
   * artifact's name, by a 0-byte file, and — the case that actually bites — by the PREVIOUS attempt's
   * file, since every video under `channels/<c>/videos/` already carries a root `shots.json`. The engine's
   * own digest cross-check cannot cover this: the roster adapter reports `artifacts: []`, so it iterates
   * nothing.
   */
  const SCRIPT_PATH = 'orgs/faceless-youtube/channels/x/videos/y/script.md';

  /** A run whose `story` stage declares one artifact, delivered and awaiting its marker. */
  async function artifactHarness(options: { seed?: { directories?: string[]; contents?: Record<string, string> } } = {}) {
    const plan = proposalFixture();
    plan.stages[1].artifacts = [{ id: 'script', path: SCRIPT_PATH, description: 'the script' }];
    const { store, sessions, runRef, fs, host } = harness({ plan, ...(options.seed ? { seed: options.seed } : {}) });
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    const order = fs.files.get(`/state/control/roster/${runRef}/fyt-story/orders/story.md`) ?? '';
    // The order file NAMES the declared artifact, so the agent knows what it is being held to.
    expect(order).toContain(SCRIPT_PATH);
    const token = /completion token: ([0-9a-f]{32})/.exec(order)?.[1] as string;
    return {
      fs,
      /** Emit the honest marker and await the server's verdict on the artifact. */
      async complete() {
        host.emit(sessionId, `FYT-STAGE-DONE story ${token} all done honest\r\n`);
        return pending;
      },
    };
  }

  it('refuses a completion whose declared artifact is not on disk', async () => {
    const run = await artifactHarness();
    const result = await run.complete();
    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain('declared artifacts are not satisfied');
    expect(result.summary).toContain(`${SCRIPT_PATH} (missing)`);
  });

  it('accepts the completion when the stage actually WROTE the declared artifact', async () => {
    const run = await artifactHarness();
    run.fs.put(`/repo/${SCRIPT_PATH}`, '# the script\n\nreal content the stage produced.\n');
    expect(await run.complete()).toMatchObject({ state: 'succeeded', summary: 'all done honest' });
  });

  it('CANNOT succeed on a pre-existing artifact it did not write', async () => {
    // The hollow completion: the file was already there when the order was delivered (a retry, or a slug
    // that already carries root plan files) and the stage touched nothing. Existence alone said PASS.
    const run = await artifactHarness({ seed: { contents: { [`/repo/${SCRIPT_PATH}`]: 'the PREVIOUS attempt\'s script' } } });
    const result = await run.complete();
    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain('byte-identical to the file already there');
    expect(result.summary).toContain(SCRIPT_PATH);
  });

  it('accepts a pre-existing artifact the stage genuinely REWROTE', async () => {
    // The other half of the bar: this is change detection, not novelty detection. A stage that edits an
    // inherited file has done its work and must pass.
    const run = await artifactHarness({ seed: { contents: { [`/repo/${SCRIPT_PATH}`]: 'the PREVIOUS attempt\'s script' } } });
    run.fs.put(`/repo/${SCRIPT_PATH}`, 'a genuinely rewritten script');
    expect(await run.complete()).toMatchObject({ state: 'succeeded' });
  });

  it('detects a rewrite that kept the byte SIZE identical', async () => {
    // Size is only the cheap discriminator; equal size falls through to the content hash. Without that,
    // an in-place edit of the same length would read as "unchanged" and park a stage that did its work.
    const before = 'aaaaaaaaaaaaaaaaaaaa';
    const run = await artifactHarness({ seed: { contents: { [`/repo/${SCRIPT_PATH}`]: before } } });
    run.fs.put(`/repo/${SCRIPT_PATH}`, 'bbbbbbbbbbbbbbbbbbbb');
    expect(before).toHaveLength(20);
    expect(await run.complete()).toMatchObject({ state: 'succeeded' });
  });

  it('parks on a 0-byte file and on a DIRECTORY standing where the artifact belongs', async () => {
    // `existsSync` returned true for both of these.
    const empty = await artifactHarness();
    empty.fs.put(`/repo/${SCRIPT_PATH}`, '');
    const emptyResult = await empty.complete();
    expect(emptyResult.state).toBe('waiting-human');
    expect(emptyResult.summary).toContain(`${SCRIPT_PATH} (empty)`);

    const directory = await artifactHarness({ seed: { directories: [`/repo/${SCRIPT_PATH}`] } });
    const directoryResult = await directory.complete();
    expect(directoryResult.state).toBe('waiting-human');
    expect(directoryResult.summary).toContain(`${SCRIPT_PATH} (not a regular file)`);
  });

  it('hashes a declared artifact at most once per delivery phase, and not at all when the size moved', async () => {
    // The biggest declared artifact in this pipeline is `final.mp4`. One hash at snapshot time is
    // unavoidable (the old bytes are gone by verification time); the verification-side hash is skipped
    // whenever the size already proves the file changed.
    const run = await artifactHarness({ seed: { contents: { [`/repo/${SCRIPT_PATH}`]: 'short' } } });
    expect(run.fs.hashed).toEqual([`/repo/${SCRIPT_PATH}`]); // exactly one: the pre-delivery baseline
    run.fs.put(`/repo/${SCRIPT_PATH}`, 'a longer rewritten script that changes the size');
    expect(await run.complete()).toMatchObject({ state: 'succeeded' });
    // Still one: the size moved, so the bytes never had to be compared.
    expect(run.fs.hashed).toEqual([`/repo/${SCRIPT_PATH}`]);
  });

  it('parks a stage whose declared artifact path is not repo-relative-safe', async () => {
    const plan = proposalFixture();
    plan.stages[1].artifacts = [{ id: 'escape', path: '../../etc/passwd', description: 'nope' }];
    const { store, sessions, runRef, fs, host } = harness({ plan });
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    const order = fs.files.get(`/state/control/roster/${runRef}/fyt-story/orders/story.md`) ?? '';
    const token = /completion token: ([0-9a-f]{32})/.exec(order)?.[1] as string;
    host.emit(sessionId, `FYT-STAGE-DONE story ${token} done\r\n`);
    const result = await pending;
    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain('not a safe repo-relative path');
  });

  it('settles a delivery that never sees a marker as a human wait, releasing the worker slot', async () => {
    // `settled` is otherwise reachable only from a marker match, a session exit, or a retire — so a
    // rendering this scanner missed, or a launch line that never brought the REPL up (the delivery line
    // typed into a bare shell prompt), held the engine's single worker slot until an operator ran `stop`.
    vi.useFakeTimers();
    try {
      const { plan, store, sessions, runRef, host } = harness({ deliveryTimeoutMs: 5 * 60_000 });
      sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
      const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
      succeedStage(store, runRef, 'idea');
      resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
      const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
      // The turn engaged (submit is outcome-verified) but then goes silent without ever printing the
      // marker — the exact case the marker deadline exists for. Stand the running turn, then never complete.
      host.emit(sessionId, BUSY_FRAME);
      // Chatter that is not the marker changes nothing, however much of it there is.
      host.emit(sessionId, 'PS C:\\Users\\danie> working on it...\r\n');
      await vi.advanceTimersByTimeAsync(4 * 60_000);
      expect(sessions.state('operator', runRef).find((row) => row.agentId === 'fyt-story')?.status).toBe('active');
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      const result = await pending;
      expect(result.state).toBe('waiting-human');
      expect(result.summary).toContain(DELIVERY_TIMEOUT_REASON);
      expect(result.summary).toContain('no completion marker');
      // The slot is released: the same agent can take a fresh order instead of throwing "already has an
      // outstanding work order" forever.
      expect(sessions.state('operator', runRef).find((row) => row.agentId === 'fyt-story')?.status).not.toBe('active');
      const retry = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
      sessions.retire(runRef, 'cleanup');
      await retry;
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not let a timeout fire against a delivery that already landed', async () => {
    vi.useFakeTimers();
    try {
      const { plan, store, sessions, runRef, fs, host } = harness({ deliveryTimeoutMs: 60_000 });
      sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
      const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
      succeedStage(store, runRef, 'idea');
      resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
      const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
      const order = fs.files.get(`/state/control/roster/${runRef}/fyt-story/orders/story.md`) ?? '';
      const token = /completion token: ([0-9a-f]{32})/.exec(order)?.[1] as string;
      host.emit(sessionId, `⏺ FYT-STAGE-DONE story ${token} landed in time\r\n`);
      expect(await pending).toMatchObject({ state: 'succeeded', summary: 'landed in time' });
      // The deadline is cleared on settle, so nothing re-settles the slot a later delivery may own.
      await vi.advanceTimersByTimeAsync(10 * 60_000);
      const events = store.listEvents('operator', runRef, 0, 200);
      expect(events.ok && events.value.some((event) => (event.summary ?? '').includes(DELIVERY_TIMEOUT_REASON))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('OUTCOME-VERIFY: a first Enter that does not start a turn is RETRIED, then records working once it engages', async () => {
    // The submit is now outcome-verified: a written Enter that leaves the order sitting UNSUBMITTED in the
    // composer (a folded CR, an at-cap block that later clears) is caught and re-submitted. This drives the
    // REAL deliver() path — the first Enter does not engage (the frame stays an idle prompt still holding
    // the order line), and only after a SECOND Enter does the terminal show a running turn.
    let sessionId = '';
    let live: ReturnType<typeof fakeHost> | null = null;
    const { plan, store, sessions, runRef, host } = harness({
      onSleep: () => {
        if (!live || !sessionId) return;
        const enters = (live.writes.get(sessionId) ?? []).filter((chunk) => chunk === '\r').length;
        // The order line sits UNSUBMITTED in the composer after the first Enter (idle prompt + footer, and
        // the order text still on screen). Only after a retry Enter (the 2nd standalone \r) does a turn run.
        live.emit(sessionId, enters >= 2
          ? BUSY_FRAME
          : '❯ Work order for stage story: read /state/control/roster/orders/story.md and execute it now\r\n  ⏵⏵ auto mode on (shift+tab to cycle)\r\n');
      },
    });
    live = host;
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');

    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    // "working" is recorded ONLY after the retry makes a turn actually engage — never on the first write.
    await vi.waitFor(() => {
      const story = sessions.state('operator', runRef).find((row) => row.agentId === 'fyt-story');
      expect(story).toMatchObject({ status: 'active', activity: 'working stage story' });
    });
    // The recovery is real: it took more than one Enter (the first did not start a turn, the retry did).
    const enters = (host.writes.get(sessionId) ?? []).filter((chunk) => chunk === '\r').length;
    expect(enters).toBeGreaterThanOrEqual(2);
    sessions.retire(runRef, 'cleanup');
    await pending;
  });

  it('OUTCOME-VERIFY: a submit that NEVER engages parks LOUDLY after K retries — never a false working', async () => {
    // The class this closes: a keystroke written but no turn started. When every retry Enter still leaves an
    // idle prompt (no running turn ever appears), delivery must PARK as a named human wait — and must NEVER
    // have recorded a "working" that would read as running while nothing was delivered until the 40-min timer.
    let sessionId = '';
    let live: ReturnType<typeof fakeHost> | null = null;
    const { plan, store, sessions, runRef, host } = harness({
      // The terminal stays at an idle prompt holding the un-submitted order line, forever — no turn ever runs.
      onSleep: () => {
        if (live && sessionId) {
          live.emit(sessionId, '❯ Work order for stage story: read /state/control/roster/orders/story.md and execute it now\r\n  ⏵⏵ auto mode on (shift+tab to cycle)\r\n');
        }
      },
    });
    live = host;
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');

    const result = await sessions.deliver(deliverInput(store, runRef, plan, 'story'));

    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain(DELIVERY_NOT_ENGAGED_REASON);
    expect(result.summary).toContain('no turn engaged');
    // It really retried: the initial Enter plus SUBMIT_VERIFY_RETRIES re-sends = more than one standalone \r.
    const enters = (host.writes.get(sessionId) ?? []).filter((chunk) => chunk === '\r').length;
    expect(enters).toBeGreaterThan(1);
    // The load-bearing invariant: NO false "working" was ever recorded, and the agent is not shown active.
    const events = store.listEvents('operator', runRef, 0, 200);
    expect(events.ok && events.value.some((event) => (event.summary ?? '').includes('working stage story'))).toBe(false);
    expect(sessions.state('operator', runRef).find((row) => row.agentId === 'fyt-story')?.status).not.toBe('active');
  });

  it('holds the SPEND gate: the images stage is undeliverable until G2 is approved', async () => {
    const { plan, store, sessions, runRef, fs, host } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-visuals');
    succeedStage(store, runRef, 'idea');
    succeedStage(store, runRef, 'story');

    const withheld = await sessions.deliver(deliverInput(store, runRef, plan, 'images'));
    expect(withheld.state).toBe('waiting-human');
    expect(withheld.summary).toContain("human gate 'g2-visual-plan' is not approved");
    expect([...fs.files.keys()].some((path) => path.endsWith('/orders/images.md'))).toBe(false);
    expect(norm(host.writes.get(sessionId)?.join('') ?? '')).not.toContain('orders/images.md');

    resolveGate(store, runRef, 'images', 'g2-visual-plan', 'approved');
    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'images'));
    expect(fs.files.has(`/state/control/roster/${runRef}/fyt-visuals/orders/images.md`)).toBe(true);
    const order = fs.files.get(`/state/control/roster/${runRef}/fyt-visuals/orders/images.md`) ?? '';
    host.emit(sessionId, `FYT-STAGE-DONE images ${/completion token: ([0-9a-f]{32})/.exec(order)?.[1]} frames generated\r\n`);
    expect((await pending).state).toBe('succeeded');
  });

  it('settles an outstanding delivery as a human wait when the roster is retired under it', async () => {
    const { plan, store, sessions, runRef } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    sessions.retire(runRef, 'operator stop');
    const result = await pending;
    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain('roster retired');
  });

  it('settles an outstanding delivery when the agent\'s shell dies under it', async () => {
    const { plan, store, sessions, runRef, host } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));

    // A crashed REPL must not leave the engine awaiting a marker that can never arrive.
    host.exit(sessionId);
    const result = await pending;
    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain('session');
    expect(result.summary).toContain('ended');
  });

  it('refuses a second concurrent order for the same agent session', async () => {
    const { plan, store, sessions, runRef } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    await expect(sessions.deliver(deliverInput(store, runRef, plan, 'story')))
      .rejects.toThrow(/already has an outstanding work order/);
    sessions.retire(runRef, 'cleanup');
    await pending;
  });
});

describe('roster worker adapter (the engine seam)', () => {
  const base = {
    operationKey: 'op', subject: 'operator', runRef: 'run-x', stageRef: 'stage-1', attemptRef: 'attempt-1',
    sessionRef: 'session-1', worktreePath: '/wt', profile: PROFILES[1], workflowProfile: 'producer',
    skills: [] as readonly string[], action: 'build:story', target: 'orgs/faceless-youtube/channels',
    workOrder: 'Do story.', readScope: [] as readonly string[], writeScope: [] as readonly string[],
    checkpoints: [] as readonly string[],
  };

  it('delegates to the headless adapter for a stage that declares NO roster agent', async () => {
    const fallback = { execute: vi.fn().mockResolvedValue({ state: 'succeeded', summary: 'headless', usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [] }) };
    const sessions = { hasRoster: () => false, deliver: vi.fn() } as unknown as RosterSessionManager;
    const adapter = createRosterWorkerAdapter({ sessions, fallback });
    const result = await adapter.execute(base);
    expect(result.summary).toBe('headless');
    expect(fallback.execute).toHaveBeenCalledTimes(1);
  });

  it('REFUSES to go headless for a stage that declares a roster agent but has no live roster', async () => {
    // `lock()` → `retireAll` → `runs.delete` makes `hasRoster` false while an in-flight `runToBoundary`
    // keeps iterating. Routing on live state alone therefore spawned a headless `claude` subprocess AFTER
    // the operator locked execution — exactly what the INERT invariant exists to prevent. Routing is by
    // stage DECLARATION now, so the only answer here is a refusal.
    const plan = proposalFixture();
    const fallback = { execute: vi.fn() };
    const sessions = { hasRoster: () => false, deliver: vi.fn() } as unknown as RosterSessionManager;
    const adapter = createRosterWorkerAdapter({ sessions, fallback });
    await expect(adapter.execute({
      ...base,
      proposalStage: stageOf(plan, 'story'),
      project: 'faceless-youtube',
      assignment: assignment('fyt-story', 'worker'),
      instructionMarkdown: '# fyt-story',
    })).rejects.toThrow(/declares a roster agent but run .* has no live roster/);
    // The same refusal when only the engine-verified assignment is present.
    await expect(adapter.execute({ ...base, assignment: assignment('fyt-story', 'worker') }))
      .rejects.toThrow(/no live roster/);
    expect(fallback.execute).not.toHaveBeenCalled();
  });

  it('refuses fail-closed when the engine did not supply the compiled stage', async () => {
    const fallback = { execute: vi.fn() };
    const sessions = { hasRoster: () => true, deliver: vi.fn() } as unknown as RosterSessionManager;
    const adapter = createRosterWorkerAdapter({ sessions, fallback });
    await expect(adapter.execute(base)).rejects.toThrow(/requires the compiled stage/);
    expect(fallback.execute).not.toHaveBeenCalled();
  });

  it('delivers into the roster with the compiled stage and verified assignment', async () => {
    const plan = proposalFixture();
    const deliver = vi.fn().mockResolvedValue({ state: 'succeeded', summary: 'delivered', usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [] });
    const sessions = { hasRoster: () => true, deliver } as unknown as RosterSessionManager;
    const adapter = createRosterWorkerAdapter({ sessions, fallback: { execute: vi.fn() } });
    const result = await adapter.execute({
      ...base,
      proposalStage: stageOf(plan, 'story'),
      project: 'faceless-youtube',
      assignment: assignment('fyt-story', 'worker'),
      instructionMarkdown: '# fyt-story',
    });
    expect(result.summary).toBe('delivered');
    expect(deliver.mock.calls[0][0]).toMatchObject({
      stageId: 'story', project: 'faceless-youtube',
      assignedAgent: { assignment: { agentId: 'fyt-story' } },
    });
  });
});

describe('roster state projection (the canvas contract)', () => {
  it('reports blocked / waiting / idle with the edges the canvas draws', () => {
    const { plan, store, sessions, runRef } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    succeedStage(store, runRef, 'idea');
    const stageRef = stageRefOf(store, runRef, 'story');
    const created = store.createHumanRequest('operator', runRef, {
      stageRef, kind: 'approval', title: gateTitle('story', 'g0-idea-pick'), prompt: 'GATE 0',
    });
    expect(created.ok).toBe(true);

    const rows = sessions.state('operator', runRef);
    expect(rows.map((row) => row.agentId)).toEqual(['fyt-runner', 'fyt-story', 'fyt-visuals']);
    const story = rows.find((row) => row.agentId === 'fyt-story');
    expect(story).toMatchObject({ status: 'blocked', waitingOn: ['g0-idea-pick'] });
    expect(story?.sessionId).toMatch(/^pty-roster-/);
    const visuals = rows.find((row) => row.agentId === 'fyt-visuals');
    expect(visuals).toMatchObject({ status: 'waiting', waitingOn: ['fyt-story'] });
    // The manager owns no stages: it is idle, with a live session the operator can still open.
    const runner = rows.find((row) => row.agentId === 'fyt-runner');
    expect(runner?.status).toBe('idle');
    expect(runner?.sessionId).toMatch(/^pty-roster-/);
    expect(rows.every((row) => typeof row.activity === 'string' && row.activity.length > 0)).toBe(true);
  });

  it('reports an agent as active while its work order is outstanding', async () => {
    const { plan, store, sessions, runRef, host } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    // The order starts a turn; the outcome-verified submit records "working" only after it observes that.
    host.emit(sessionId, BUSY_FRAME);
    // The 'working stage story' activity is recorded once the order is SUBMITTED and its turn is verified
    // engaged — a tick after deliver() yields — so await it rather than reading synchronously mid-delivery.
    await vi.waitFor(() => {
      const story = sessions.state('operator', runRef).find((row) => row.agentId === 'fyt-story');
      expect(story).toMatchObject({ status: 'active', activity: 'working stage story' });
    });
    sessions.retire(runRef, 'cleanup');
    await pending;
  });

  it('projects an empty session map without a live roster, recovering activity from durable events', () => {
    const { plan, store, runRef } = harness();
    const detail = detailOf(store, runRef);
    store.appendEvent('operator', runRef, {
      kind: 'lifecycle', source: 'system', status: 'pending', summary: 'roster:fyt-story working stage story',
    });
    const events = store.listEvents('operator', runRef, 0, 100);
    const durableActivity = new Map<string, string>();
    if (events.ok) {
      for (const event of events.value) {
        const match = /^roster:([a-z0-9-]+) (.+)$/.exec(event.summary ?? '');
        if (match) durableActivity.set(match[1], match[2]);
      }
    }
    const rows = projectRosterState(detail, {
      sessions: new Map(),
      working: new Set(),
      activity: new Map(),
      durableActivity,
    });
    expect(rows.find((row) => row.agentId === 'fyt-story')).toMatchObject({
      sessionId: null, activity: 'working stage story',
    });
    expect(rows.every((row) => row.sessionId === null)).toBe(true);
    expect(plan.stages).toHaveLength(3);
  });
});

/**
 * The completion marker is the ONLY signal that advances a delivered stage, and the substrate is an
 * interactive `claude` REPL that frames its own output. An anchor of `^FYT-STAGE-` matched a bare line
 * and essentially nothing the real CLI prints, so the completion would never arrive and the delivery
 * would hang. Every string below is run through the REAL `stripTerminalControl` first, exactly as `scan`
 * does, and then matched against the pending delivery's own stage id and token.
 */
describe('completion marker recognition', () => {
  const TOKEN = 'a'.repeat(32);
  const FOREIGN = 'f'.repeat(32);
  const PENDING = { stageId: 'story', token: TOKEN };

  /** What `scan` concludes for one raw terminal chunk: accepted verdict, or why it was rejected. */
  function outcomeOf(raw: string): 'no-match' | 'stage-mismatch' | 'token-mismatch' | string {
    const line = stripTerminalControl(raw).split('\n')[0];
    const marker = matchCompletionMarker(line);
    if (!marker) return 'no-match';
    if (marker.stageId !== PENDING.stageId) return 'stage-mismatch';
    if (marker.token !== PENDING.token) return 'token-mismatch';
    return marker.verdict;
  }

  const ACCEPTED: Array<[string, string, string]> = [
    ['bare line', `FYT-STAGE-DONE story ${TOKEN} script.md written`, 'DONE'],
    ['ANSI-coloured line', `\u001b[32mFYT-STAGE-DONE story ${TOKEN} script.md written\u001b[0m`, 'DONE'],
    ['two-space indent', `  FYT-STAGE-DONE story ${TOKEN} ok`, 'DONE'],
    ['REPL gutter glyph U+23FA', `⏺ FYT-STAGE-DONE story ${TOKEN} ok`, 'DONE'],
    ['box-drawing rail U+2502', `│ FYT-STAGE-DONE story ${TOKEN} ok`, 'DONE'],
    ['list bullet', `- FYT-STAGE-DONE story ${TOKEN} ok`, 'DONE'],
    ['quote marker', `> FYT-STAGE-DONE story ${TOKEN} ok`, 'DONE'],
    ['indent + rail + gutter together', `   │ ⏺  FYT-STAGE-DONE story ${TOKEN} ok`, 'DONE'],
    ['coloured gutter, then the marker', `\u001b[38;5;2m⏺\u001b[0m FYT-STAGE-DONE story ${TOKEN} ok`, 'DONE'],
    ['no summary at all', `FYT-STAGE-DONE story ${TOKEN}`, 'DONE'],
    ['BLOCKED with a gutter', `⏺ FYT-STAGE-BLOCKED story ${TOKEN} needs a human`, 'BLOCKED'],
    ['FAILED with a gutter', `⏺ FYT-STAGE-FAILED story ${TOKEN} cannot finish`, 'FAILED'],
  ];

  const REJECTED: Array<[string, string, string]> = [
    ['marker announced mid-sentence', `I will print FYT-STAGE-DONE story ${TOKEN} at the end`, 'no-match'],
    ['gutter, prose, then marker', `⏺ When done I print FYT-STAGE-DONE story ${TOKEN}`, 'no-match'],
    ['the order file\'s own placeholder, echoed', `FYT-STAGE-<VERDICT> story ${TOKEN} <one-line summary>`, 'no-match'],
    ['unknown verdict', `FYT-STAGE-OK story ${TOKEN} nope`, 'no-match'],
    ['no separator after the verdict', `FYT-STAGE-DONEstory ${TOKEN} nope`, 'no-match'],
    ['token one character short', `FYT-STAGE-DONE story ${'a'.repeat(31)} nope`, 'no-match'],
    ['uppercase token', `FYT-STAGE-DONE story ${'A'.repeat(32)} nope`, 'no-match'],
    ['forged token', `FYT-STAGE-DONE story ${FOREIGN} forged`, 'token-mismatch'],
    ['another stage\'s marker', `FYT-STAGE-DONE images ${TOKEN} wrong stage`, 'stage-mismatch'],
    ['a PRIOR stage\'s marker', `⏺ FYT-STAGE-DONE idea ${TOKEN} earlier stage`, 'stage-mismatch'],
    // QUOTING AND FENCING. An agent restating the line it is ABOUT to print is completely normal
    // behaviour, and under the old `[^A-Za-z0-9]{0,32}` prefix every one of these MATCHED — a stage could
    // complete itself by talking about completing.
    ['inline code span', `\`FYT-STAGE-DONE story ${TOKEN} ok\``, 'no-match'],
    ['bullet plus backticks', `- \`FYT-STAGE-DONE story ${TOKEN} ok\``, 'no-match'],
    ['comment / markdown heading', `# FYT-STAGE-DONE story ${TOKEN} ok`, 'no-match'],
    ['fence run-on', `\`\`\`FYT-STAGE-DONE story ${TOKEN} ok`, 'no-match'],
    ['JSON with an empty key', `{"": "FYT-STAGE-DONE story ${TOKEN} ok"`, 'no-match'],
    // Neighbours of the above, kept explicit so a future widening of the prefix has to break a test.
    ['double-quoted line', `"FYT-STAGE-DONE story ${TOKEN} ok"`, 'no-match'],
    ['single-quoted line', `'FYT-STAGE-DONE story ${TOKEN} ok'`, 'no-match'],
    ['curly-quoted line', `“FYT-STAGE-DONE story ${TOKEN} ok”`, 'no-match'],
    ['JSON array element', `["FYT-STAGE-DONE story ${TOKEN} ok"]`, 'no-match'],
    ['yaml-ish key', `marker: FYT-STAGE-DONE story ${TOKEN} ok`, 'no-match'],
    ['shell comment with slashes', `// FYT-STAGE-DONE story ${TOKEN} ok`, 'no-match'],
  ];

  it.each(ACCEPTED)('accepts %s', (_name, raw, verdict) => {
    expect(outcomeOf(raw)).toBe(verdict);
  });

  it.each(REJECTED)('rejects %s', (_name, raw, reason) => {
    expect(outcomeOf(raw)).toBe(reason);
  });

  it('keeps the anchor: a prefix is decoration only, never prose or quoting', () => {
    // Generality, not a whitelist of the glyphs seen today — the prefix admits whole Unicode decoration
    // bands, so the next CLI release's gutter glyph still scans — but bounded, killed by one alphanumeric
    // character ahead of the marker, and closed to every quoting/fencing character.
    expect(outcomeOf(`${'│'.repeat(8)} FYT-STAGE-DONE story ${TOKEN} ok`)).toBe('DONE');
    // Decoration glyphs this scanner has never seen, from the bands terminal framing lives in.
    for (const glyph of ['▌', '●', '→', '•', '❯', '⎿', '⬤']) {
      expect(outcomeOf(`${glyph} FYT-STAGE-DONE story ${TOKEN} ok`)).toBe('DONE');
    }
    expect(outcomeOf(`${'.'.repeat(40)} FYT-STAGE-DONE story ${TOKEN} ok`)).toBe('no-match');
    expect(outcomeOf(`x FYT-STAGE-DONE story ${TOKEN} ok`)).toBe('no-match');
    // A single quoting character is enough, at any depth of otherwise-legal decoration.
    expect(outcomeOf(`   │ ⏺  \`FYT-STAGE-DONE story ${TOKEN} ok`)).toBe('no-match');
    expect(matchCompletionMarker(`FYT-STAGE-DONE story ${TOKEN}   trailing summary  `)?.summary.trim())
      .toBe('trailing summary');
  });
});

describe('roster helpers', () => {
  /**
   * The work directory is PINNED to `orgs/<project>` — the root every work order's org-relative paths
   * (`channels/<channel>/videos/<slug>/brief.md`) are written against.
   *
   * It used to return the DEEPEST EXISTING candidate, which broke both ways: on a fresh slug the video dir
   * did not exist but the channel dir did, so the stated root became the CHANNEL dir and that same
   * relative path resolved to `channels/<c>/channels/<c>/videos/<slug>/brief.md`; and because `workDir` is
   * recomputed whenever the in-memory run entry is absent — after every daemon restart — the stated root
   * silently moved one level deeper as soon as `idea` created the video dir.
   */
  it('pins the work directory to orgs/<project>, whatever exists on disk', () => {
    expect(norm(resolveRosterWorkDir('/repo', 'p'))).toBe('/repo/orgs/p');
    expect(norm(resolveRosterWorkDir('/repo', 'faceless-youtube'))).toBe('/repo/orgs/faceless-youtube');
    // The only fallback is the traversal guard: a project that is not one safe path segment is never
    // interpolated into a path.
    expect(norm(resolveRosterWorkDir('/repo', '../etc'))).toBe('/repo');
    expect(norm(resolveRosterWorkDir('/repo', ''))).toBe('/repo');
    expect(norm(resolveRosterWorkDir('/repo', 'a/b'))).toBe('/repo');
  });

  it('opens every roster session at orgs/<project> for a fresh slug, an existing video dir, and after a restart', () => {
    const videoDir = '/repo/orgs/faceless-youtube/channels/the-second-take/videos/st-042';
    const channelDir = '/repo/orgs/faceless-youtube/channels/the-second-take';
    const expected = '/repo/orgs/faceless-youtube';

    // 1. FRESH SLUG: the video dir does not exist, only the channel dir does — the shape that used to
    //    resolve to the channel dir and mis-root every org-relative order path.
    const fresh = harness({ seed: { directories: [channelDir] } });
    fresh.sessions.ensureRoster({ subject: 'operator', runRef: fresh.runRef, proposal: fresh.plan });
    expect(fresh.host.opened.map((req) => norm(req.cwd))).toEqual([expected, expected, expected]);

    // 2. EXISTING VIDEO DIR: the deepest candidate is now real, and the answer must not change.
    const existing = harness({ seed: { directories: [channelDir, videoDir] } });
    existing.sessions.ensureRoster({ subject: 'operator', runRef: existing.runRef, proposal: existing.plan });
    expect(existing.host.opened.map((req) => norm(req.cwd))).toEqual([expected, expected, expected]);

    // 3. ACROSS A DAEMON RESTART, with the video dir created in between (what stage `idea` does): a fresh
    //    manager over the same durable store re-derives the SAME root instead of moving one level deeper.
    const restartedHost = fakeHost();
    const restarted = createRosterSessionManager({
      store: existing.store, repoRoot: '/repo', stateRoot: '/state', host: restartedHost.host,
      registry: createPersistentSessionRegistry(), fs: fakeFs([], { directories: [channelDir, videoDir] }),
      assignedAgents: { resolve: (input) => ({ assignment: { ...input.assignment }, instructionMarkdown: '# agent' }) },
      resolveProfiles: () => PROFILES,
    });
    restarted.ensureRoster({ subject: 'operator', runRef: existing.runRef, proposal: existing.plan });
    expect(restartedHost.opened.map((req) => norm(req.cwd))).toEqual([expected, expected, expected]);
  });

  it('recovers a durable activity line written PAST the first event page', () => {
    // `state` used to ask for the FIRST 400 events on every 4-second canvas poll: it re-read the same
    // page forever, so activity went permanently stale once a run passed 400 events — which every real
    // multi-day run does — while re-reading 400 rows per poll.
    // No live roster: this is the post-restart path, where the durable mirror is the ONLY source of an
    // activity line.
    const { store, sessions, runRef } = harness();
    // Read once so the reader's cursor is established, then bury the line under more than one page.
    sessions.state('operator', runRef);
    for (let index = 0; index < 700; index += 1) {
      const appended = store.appendEvent('operator', runRef, {
        kind: 'lifecycle', source: 'system', status: 'pending', summary: `noise ${index}`,
      });
      if (!appended.ok) throw new Error(appended.detail);
    }
    const appended = store.appendEvent('operator', runRef, {
      kind: 'lifecycle', source: 'system', status: 'pending', summary: 'roster:fyt-visuals working stage images',
    });
    if (!appended.ok) throw new Error(appended.detail);
    // One page (500) does not reach the line; the incremental reader advances its cursor and the next
    // poll picks it up, so the canvas converges instead of going permanently stale.
    expect(sessions.state('operator', runRef).find((row) => row.agentId === 'fyt-visuals')?.activity).not.toBe('working stage images');
    const rows = sessions.state('operator', runRef);
    expect(rows.find((row) => row.agentId === 'fyt-visuals')?.activity).toBe('working stage images');
  });

  it('strips terminal control sequences so a coloured marker still scans', () => {
    expect(stripTerminalControl('\u001b[32mready\u001b[0m\r\n')).toBe('ready\n\n');
    expect(stripTerminalControl('\u001b]0;title\u0007plain')).toBe('plain');
  });
});

/**
 * Scoped per-run tool permissions. The defect: a spawned roster terminal's FIRST act â€” reading its own
 * `binding.md` â€” parked on Claude Code's interactive "Do you want to proceed?" tool-permission menu, so
 * the run went nowhere. Folder trust does not answer that menu and a remembered allowlist does not
 * either; it is a per-session decision, and the sanctioned channel for answering it ahead of time is a
 * settings file passed to `claude --settings`.
 */
describe('roster scoped per-run permissions', () => {
  it('grants exactly the declared scope plus its own order channel, and nothing else', () => {
    const settings = buildRosterPermissionSettings({
      repoRoot: 'C:\\Users\\danie\\kb',
      agentDir: 'C:\\state\\control\\roster\\run-7\\fyt-visuals',
      read: ['orgs/faceless-youtube'],
      write: ['orgs/faceless-youtube/channels'],
      tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    });
    // The pathspec grammar the installed CLI actually matches: bare absolute, drive letter kept, NO `//`
    // prefix. A/B-verified against CLI 2.1.220 with an identical target — `Read(//C:/…/**)` is DENIED,
    // `Read(C:/…/**)` is ALLOWED — so the `//` form these rules used to carry granted nothing at all.
    expect(settings.allow).toEqual([
      'Read(C:/state/control/roster/run-7/fyt-visuals/**)',
      'Read(C:/Users/danie/kb/orgs/faceless-youtube/**)',
      'Read(C:/Users/danie/kb/orgs/faceless-youtube/channels/**)',
      'Glob(C:/Users/danie/kb/orgs/faceless-youtube/**)',
      'Glob(C:/Users/danie/kb/orgs/faceless-youtube/channels/**)',
      'Grep(C:/Users/danie/kb/orgs/faceless-youtube/**)',
      'Grep(C:/Users/danie/kb/orgs/faceless-youtube/channels/**)',
      'Write(C:/Users/danie/kb/orgs/faceless-youtube/channels/**)',
      'Edit(C:/Users/danie/kb/orgs/faceless-youtube/channels/**)',
    ]);
    // One grammar: the rule pathspec for a directory is byte-identical to its `additionalDirectories`
    // entry, so a rule can never disagree with the working set it is supposed to describe.
    for (const dir of settings.additionalDirectories) {
      expect(settings.allow.some((rule) => rule.includes(`(${dir}/**)`))).toBe(true);
    }
    expect(settings.additionalDirectories).toEqual([
      'C:/state/control/roster/run-7/fyt-visuals',
      'C:/Users/danie/kb/orgs/faceless-youtube',
      'C:/Users/danie/kb/orgs/faceless-youtube/channels',
    ]);
    // No wildcard allow-all, and Bash is NEVER granted: a Bash rule matches a command prefix, not a
    // path, so it cannot be bounded by the approved scope and a bare entry would be exactly the blanket
    // grant this file exists to avoid.
    expect(settings.allow).not.toContain('Bash');
    expect(settings.allow.some((rule) => /^[A-Za-z]+$/.test(rule) || rule.includes('(*') || rule === '*')).toBe(false);
    // Daniel's 2026-07-30 ruling: roster terminals run autonomously under `auto` mode — routine tool use
    // is cleared by the classifier, no prompts, but the deny floor + hooks still enforce. The settings
    // file carries the mode value below. The scoped allow rules above stay in the file as declared
    // intent; they are harmless once that mode is in effect.
    expect(JSON.parse(settings.json)).toEqual({
      permissions: {
        defaultMode: 'auto',
        deny: settings.deny,
        allow: settings.allow,
        additionalDirectories: settings.additionalDirectories,
      },
    });
  });

  /**
   * The RESTRICTION FLOOR — the only half of this file that still enforces under the auto `defaultMode`,
   * because `deny`/`ask`/`allow` evaluate in that fixed order whatever the mode is: auto skips the ASK
   * step, never the DENY step. Verified live against CLI 2.1.220 (each rule paired with an `allow` that
   * would otherwise let the action through, so a denial proves the RULE matched): `Bash(git config *)`
   * refuses the command, and a `Read(<path>)` deny also refuses a Bash command that reads that path.
   */
  it('emits an enforced restriction floor an unattended terminal can never step outside', () => {
    const settings = buildRosterPermissionSettings({
      repoRoot: 'C:/Users/danie/kb',
      agentDir: 'C:/state/control/roster/run-7/fyt-visuals',
      read: ['orgs/faceless-youtube'],
      write: ['orgs/faceless-youtube/channels'],
      tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    });
    // Publication and identity: a stage proposes work, the server-side integrator publishes it.
    expect(settings.deny).toContain('Bash(git push *)');
    expect(settings.deny).toContain('Bash(git config *)');
    // `.env`, at the root and at any depth, through every built-in file tool.
    for (const rule of [
      'Read(.env)', 'Read(**/.env)', 'Edit(.env)', 'Edit(**/.env)', 'Edit(**/.env.*)',
      'Edit(**/.ssh/**)', 'Edit(**/.aws/**)',
    ]) expect(settings.deny).toContain(rule);
    expect(settings.deny.some((rule) => /^Write\(/.test(rule))).toBe(false);
    // Credential stores.
    for (const rule of [
      'Read(**/.ssh/**)', 'Read(**/.aws/**)', 'Read(**/.claude/.credentials.json)',
      'Read(**/.git-credentials)', 'Read(**/*.pem)',
    ]) expect(settings.deny).toContain(rule);
    // The floor is a CONSTANT: an agent with a wider scope, more tools and a different repo root gets
    // exactly the same list, so no proposal can negotiate it away.
    const other = buildRosterPermissionSettings({
      repoRoot: '/repo', agentDir: '/state/agent', read: [], write: [], tools: [],
    });
    expect(other.deny).toEqual(settings.deny);
    // The emitted file carries it, and no allow rule overlaps it (a deny would win anyway).
    const parsed = JSON.parse(settings.json) as { permissions: { deny: string[] } };
    expect(parsed.permissions.deny).toEqual(settings.deny);
    expect(settings.allow.some((rule) => settings.deny.includes(rule))).toBe(false);
  });

  it('emits no rule for a tool the server-owned profile withholds', () => {
    const settings = buildRosterPermissionSettings({
      repoRoot: '/repo',
      agentDir: '/state/control/roster/run-7/fyt-checker',
      read: ['orgs/faceless-youtube'],
      write: [],
      tools: ['Read', 'Glob', 'Grep'],
    });
    expect(settings.allow).toEqual([
      'Read(/state/control/roster/run-7/fyt-checker/**)',
      'Read(/repo/orgs/faceless-youtube/**)',
      'Glob(/repo/orgs/faceless-youtube/**)',
      'Grep(/repo/orgs/faceless-youtube/**)',
    ]);
    expect(settings.allow.some((rule) => rule.startsWith('Write(') || rule.startsWith('Edit('))).toBe(false);
  });

  it('refuses to interpolate a scope entry that is not a safe repo-relative path', () => {
    const settings = buildRosterPermissionSettings({
      repoRoot: '/repo',
      agentDir: '/state/agent',
      read: ['../../etc', '/absolute', 'orgs/faceless-youtube'],
      write: ['orgs/../../escape'],
      tools: ['Read', 'Write'],
    });
    expect(settings.allow).toEqual([
      'Read(/state/agent/**)',
      'Read(/repo/orgs/faceless-youtube/**)',
    ]);
  });

  it("unions only the stages an agent owns â€” another agent's stage never widens the grant", () => {
    const plan = proposalFixture();
    plan.stages[2].scope = { read: ['orgs/faceless-youtube', 'knowledge'], write: ['orgs/faceless-youtube/library'] };
    expect(rosterAgentScope(plan, 'fyt-story')).toEqual({
      read: ['orgs/faceless-youtube'], write: ['orgs/faceless-youtube/channels'],
    });
    expect(rosterAgentScope(plan, 'fyt-visuals')).toEqual({
      read: ['orgs/faceless-youtube', 'knowledge'], write: ['orgs/faceless-youtube/library'],
    });
    // The manager additionally carries the proposal-level scope.
    expect(rosterAgentScope(plan, 'fyt-runner')).toEqual({
      read: ['orgs/faceless-youtube'], write: ['orgs/faceless-youtube/channels'],
    });
  });

  it("caps an agent at the INTERSECTION of its stages' server-owned tool profiles", () => {
    const plan = proposalFixture();
    plan.profile = 'producer';
    plan.stages[1].workflowProfile = 'checker-readonly';
    const resolveTools = (id: string | null): readonly string[] =>
      id === 'checker-readonly' ? ['Read', 'Glob', 'Grep'] : ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'];
    // fyt-story owns `idea` (producer) and `story` (checker-readonly): it gets what BOTH allow.
    expect(rosterAgentTools(plan, 'fyt-story', resolveTools)).toEqual(['Read', 'Glob', 'Grep']);
    expect(rosterAgentTools(plan, 'fyt-visuals', resolveTools)).toEqual(['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']);
    // An agent with no resolvable cap gets none â€” no rules, i.e. today's interactive behaviour.
    expect(rosterAgentTools(plan, 'nobody', resolveTools)).toEqual([]);
  });

  it('writes the per-run settings file BEFORE the launch line and points --settings at it', () => {
    const { plan, sessions, runRef, fs, host } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const settingsPath = `/state/control/roster/${runRef}/fyt-story/settings.json`;
    const raw = fs.files.get(settingsPath);
    expect(raw).toBeDefined();
    const parsed = JSON.parse(raw as string) as {
      permissions: { defaultMode: string; deny: string[]; allow: string[]; additionalDirectories: string[] };
    };
    // Autonomous per Daniel's 2026-07-30 ruling: `auto` mode clears routine tool use via its classifier
    // with no prompts, while the deny floor + hooks still enforce.
    expect(parsed.permissions.defaultMode).toBe('auto');
    // …and the restriction floor rides in the SAME file, which is what still enforces under that mode.
    expect(parsed.permissions.deny).toContain('Bash(git push *)');
    expect(parsed.permissions.deny).toContain('Read(**/.env)');
    expect(parsed.permissions.deny.some((rule) => /^Write\(/.test(rule))).toBe(false);
    for (const rule of [
      'Edit(.env)', 'Edit(**/.env)', 'Edit(**/.env.*)', 'Edit(**/.ssh/**)', 'Edit(**/.aws/**)',
    ]) expect(parsed.permissions.deny).toContain(rule);
    expect(parsed.permissions.allow).toContain(`Read(/state/control/roster/${runRef}/fyt-story/**)`);
    expect(parsed.permissions.allow).toContain('Read(/repo/orgs/faceless-youtube/**)');
    expect(parsed.permissions.allow).toContain('Edit(/repo/orgs/faceless-youtube/channels/**)');
    // Nothing outside the canonical repo root or this agent's own roster directory.
    for (const rule of parsed.permissions.allow) {
      expect(rule).toMatch(new RegExp(`\\(/(repo/orgs/faceless-youtube|state/control/roster/${runRef}/fyt-story)`));
    }
    const launch = host.writes.get(sessionIdFor(sessions, runRef, 'fyt-story'))?.[0] ?? '';
    expect(norm(launch)).toContain(`--settings "/state/control/roster/${runRef}/fyt-story/settings.json"`);
    expect(launch).not.toContain('--dangerously-skip-permissions');
    expect(launch).not.toContain('--allow-dangerously-skip-permissions');
    expect(launch).not.toContain('--permission-mode');
  });

  it('disables every MCP server declared by the roster repo before launching sessions', () => {
    const { plan, sessions, runRef, fs } = harness({
      seed: { contents: { '/repo/.mcp.json': JSON.stringify({ mcpServers: { codex: {}, browser: {} } }) } },
    });
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const settings = JSON.parse(fs.files.get(`/state/control/roster/${runRef}/fyt-story/settings.json`) as string) as {
      permissions: { disabledMcpjsonServers?: string[] };
    };
    expect(settings.permissions.disabledMcpjsonServers).toEqual(['codex', 'browser']);
  });

  it('does not add MCP settings when the roster repo has no .mcp.json', () => {
    const { plan, sessions, runRef, fs } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const settings = JSON.parse(fs.files.get(`/state/control/roster/${runRef}/fyt-story/settings.json`) as string) as {
      permissions: { disabledMcpjsonServers?: string[] };
    };
    expect(settings.permissions.disabledMcpjsonServers).toBeUndefined();
  });

  it('gives each agent its OWN settings file, scoped to its own order channel', () => {
    const { plan, sessions, runRef, fs } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const storyAllow = (JSON.parse(fs.files.get(`/state/control/roster/${runRef}/fyt-story/settings.json`) as string) as
      { permissions: { allow: string[] } }).permissions.allow;
    expect(storyAllow.some((rule) => rule.includes('fyt-visuals'))).toBe(false);
  });

  it('deletes the per-run settings file when the roster retires', () => {
    const { plan, sessions, runRef, fs } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    expect(fs.files.has(`/state/control/roster/${runRef}/fyt-story/settings.json`)).toBe(true);
    sessions.retire(runRef, 'run succeeded');
    // The grant cannot outlive the run it was minted for.
    expect(fs.files.has(`/state/control/roster/${runRef}/fyt-story/settings.json`)).toBe(false);
  });
});

/**
 * The REPL-readiness gate. The defect: the delivery line was typed unconditionally, interleaved
 * character-by-character with an open tool-permission menu, and was swallowed â€” the stage then sat
 * toward the 4h marker deadline with nothing delivered.
 */
describe('roster REPL-readiness gate', () => {
  it('classifies a permission menu, a mid-turn frame, and an idle prompt', () => {
    expect(detectReplReadiness('\u256d\u2500 Do you want to proceed? \u2500\u256e\n\u2502 \u276f 1. Yes')).toMatchObject({ state: 'modal' });
    expect(detectReplReadiness("  2. Yes, and don't ask again for Read commands")).toMatchObject({ state: 'modal' });
    expect(detectReplReadiness('\u2502   3. No, and tell Claude what to do differently')).toMatchObject({ state: 'modal' });
    // VERBATIM off a real pty (CLI 2.1.220), not hand-written: the frame a live mid-turn session emits.
    // The previous fixture here was invented, and an invented busy frame validates the regex against
    // itself. `grep -a "to interrupt"` over `claude.exe` finds nothing because the hint is composed at
    // render time from the `chat:cancel` chord label plus the action name \u2014 only a pty ever sees it.
    const midTurn = '\u276f Count from 1 to 40, one number per line, no other text.'
      + '  \u273dWhatchamacalliting\u2026 \u276f esc to interrupt';
    expect(detectReplReadiness(midTurn)).toMatchObject({ state: 'busy', marker: 'esc to interrupt' });
    // Copy-independent second and third signals, so a rebound chord or reworded action cannot revive
    // the swallowed-order failure: the spinner's own elapsed-seconds and token counters.
    expect(detectReplReadiness('\u273b Nebulizing\u2026 (3s \u00b7 thinking)')).toMatchObject({ state: 'busy' });
    expect(detectReplReadiness('\u273b Herding\u2026 \u2193 25 tokens \u00b7 thinking)')).toMatchObject({ state: 'busy' });
    // READY now requires POSITIVE evidence: the mode-cycler footer the live REPL renders. A box-drawn
    // prompt ALONE is no longer enough \u2014 the acceptance modal and theme picker are also non-empty and
    // menu-free, and that is exactly how a work order was swallowed.
    const idle = '\u256d\u2500\u2500\u2500\u256e\n\u2502 >  \u2502\n\u2570\u2500\u2500\u2500\u256f'
      + '\n  \u23f5\u23f5 auto mode on (shift+tab to cycle)';
    expect(detectReplReadiness(idle)).toEqual({ state: 'ready' });
    // The same box WITHOUT the footer is NOT ready \u2014 it is a splash/onboarding/login screen or a REPL that
    // has not finished starting. It parks, it does not get typed into.
    expect(detectReplReadiness('\u256d\u2500\u2500\u2500\u256e\n\u2502 >  \u2502\n\u2570\u2500\u2500\u2500\u256f'))
      .toMatchObject({ state: 'silent', marker: 'no REPL input prompt on screen yet' });
    // An EMPTY screen is not an idle screen \u2014 it is a terminal that has said nothing at all, which is
    // what a shell that has not yet booted `claude` looks like. It used to classify `ready`.
    expect(detectReplReadiness('')).toMatchObject({ state: 'silent', marker: 'no output yet' });
    expect(detectReplReadiness('\r\n   \r\n')).toMatchObject({ state: 'silent' });
    // An answered menu stops matching once the REPL has redrawn past it to its idle prompt AND footer.
    const scrolled = `Do you want to proceed?\n${Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n')}`
      + '\n> \n  \u23f5\u23f5 auto mode on (shift+tab to cycle)';
    expect(detectReplReadiness(scrolled)).toEqual({ state: 'ready' });
  });

  /**
   * The DECISION-GRADE regression, driven by REAL frames captured off a live pty (claude.exe 2.1.220) and
   * committed under __fixtures__/repl-frames. These are the exact screens that stalled the idea stage.
   */
  it('classifies real captured pre-REPL screens NOT-ready and a real idle frame ready', () => {
    const fixture = (name: string) => readFileSync(
      new URL(`./__fixtures__/repl-frames/${name}`, import.meta.url), 'utf8',
    );
    // The first-launch Bypass-Permissions acceptance modal \u2014 the production blocker. This is the
    // collapsed-footer capture that classified `ready` under the old rule and swallowed the order.
    expect(detectReplReadiness(fixture('bypass-accept-modal.txt')))
      .toMatchObject({ state: 'modal', marker: expect.stringMatching(/Bypass\s*Permissions\s*mode/i) });
    // The first-run theme picker \u2014 a different splash that also slipped through as `ready` before.
    expect(detectReplReadiness(fixture('theme-picker.txt'))).toMatchObject({ state: 'silent' });
    // The genuine idle REPL prompt carries the mode-cycler footer, so it \u2014 and only it \u2014 is `ready`.
    expect(detectReplReadiness(fixture('idle-repl-prompt.txt'))).toEqual({ state: 'ready' });
  });

  /**
   * The FROZEN-BUSY stall (2026-07-30, decision-grade). `entry.screen` is a linear concat of stripped
   * output, so when a turn ENDS the idle terminal goes silent and the last-window slice stays frozen
   * holding that turn's spinner tail (`(2s \u00b7`). `detectReplReadiness` tests BUSY before READY and returns
   * `busy` forever \u2014 every post-turn delivery parks and no budget bump ever flips it. The captured shape:
   * the pre-turn idle footer (`shift+tab to cycle`) AND the finished turn's `(2s \u00b7` fragment both sit in the
   * window. {@link detectReplReadinessFresh} gates the busy class on quiescence.
   */
  it('freshness-gates a FROZEN busy frame: stale spinner + quiet => ready, live spinner => busy, modal always parks', () => {
    // Mirrors the real post-boot-turn capture (cwd=orgs/faceless-youtube, claude.exe 2.1.220): the pre-turn
    // mode-cycler footer is still in the window, a finished turn's `(2s \u00b7` spinner tail is frozen below it,
    // and the terminal has fallen silent at its idle prompt.
    const frozenBusy = '\u23f5\u23f5 auto mode on (shift+tab to cycle)'
      + '\n\u273b Embellishing\u2026 (2s \u00b7 thinking)'
      + '\n\u276f \u2190 4 agents';
    // Base classifier (no freshness) is the bug: it matches the dead `(2s \u00b7` and calls it busy.
    expect(detectReplReadiness(frozenBusy)).toMatchObject({ state: 'busy', marker: '(2s \u00b7' });
    // Gated, and quiet past the threshold: the spinner is stale, so it re-classifies to the idle marker.
    expect(detectReplReadinessFresh(frozenBusy, STALE_BUSY_QUIET_MS)).toEqual({ state: 'ready' });
    expect(detectReplReadinessFresh(frozenBusy, 3_000)).toEqual({ state: 'ready' });
    // A LIVE turn emits a spinner heartbeat \u2014 quiet for only 500ms means the busy is real, stays not-ready.
    expect(detectReplReadinessFresh(frozenBusy, 500)).toMatchObject({ state: 'busy', marker: '(2s \u00b7' });
    // Just under the threshold is still busy (boundary is >=).
    expect(detectReplReadinessFresh(frozenBusy, STALE_BUSY_QUIET_MS - 1)).toMatchObject({ state: 'busy' });
    // A MODAL is NEVER typed into, however long it has sat: even quiet past the threshold, a menu still
    // parks. This is the never-swallow property \u2014 the gate touches ONLY the busy class, never modal.
    const frozenModalWithStaleBusy = '\u256d\u2500 Do you want to proceed? \u2500\u256e'
      + '\n\u2502 \u276f 1. Yes'
      + '\n\u2502   2. No'
      + '\n\u273b (2s \u00b7 thinking)'
      + '\n\u23f5\u23f5 auto mode on (shift+tab to cycle)';
    expect(detectReplReadinessFresh(frozenModalWithStaleBusy, 10_000)).toMatchObject({ state: 'modal' });
    // A theme/trust/login splash never carries the idle marker, so quiescence never makes it ready either.
    const frozenSplashBusy = '  Syntax theme: Monokai Extended (ctrl+t to disable)'
      + '\n\u273b (2s \u00b7 thinking)';
    expect(detectReplReadinessFresh(frozenSplashBusy, 10_000))
      .toMatchObject({ state: 'silent', marker: 'no REPL input prompt on screen yet' });
  });

  it('detectTurnEngaged: a FRESH busy spinner is engaged; idle prompt, composer echo, and a stale spinner are not', () => {
    // The positive signal the outcome-verified submit keys on: a running turn paints the spinner footer, and
    // it is FRESH (the terminal repainted within STALE_BUSY_QUIET_MS). Captured shape of a live turn.
    const runningTurn = '✻ Working… ❯ esc to interrupt (2s · thinking) ↓ 40 tokens';
    expect(detectTurnEngaged(runningTurn, 300)).toBe(true);
    // Stale: the same tail frozen after the turn ended (quiet >= threshold) is NOT a running turn.
    expect(detectTurnEngaged(runningTurn, STALE_BUSY_QUIET_MS)).toBe(false);
    // The idle prompt is not a turn — this is exactly the frame a non-submitting Enter leaves behind.
    expect(detectTurnEngaged('╭───╮\n│ >  │\n╰───╯\n  ⏵⏵ auto mode on (shift+tab to cycle)', 100)).toBe(false);
    // The mere COMPOSER ECHO of the typed order carries no busy marker, so it can never false-positive.
    expect(detectTurnEngaged('❯ Work order for stage story: read /state/.../orders/story.md and execute it now\n  ⏵⏵ auto mode on (shift+tab to cycle)', 0)).toBe(false);
  });

  it('never types a work order into an open permission menu, and parks with a named reason', async () => {
    const { plan, store, sessions, runRef, host, fs } = harness({ replReadyTimeoutMs: 60_000 });
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    host.emit(sessionId, 'Do you want to proceed?\r\n1. Yes\r\n3. No, and tell Claude what to do differently\r\n');
    const written = host.writes.get(sessionId)?.length ?? 0;

    const result = await sessions.deliver(deliverInput(store, runRef, plan, 'story'));

    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain(DELIVERY_NOT_READY_REASON);
    expect(result.summary).toContain('Do you want to');
    // NOTHING was typed and NOTHING was authored: the order never left the control plane.
    expect(host.writes.get(sessionId)).toHaveLength(written);
    expect(fs.files.has(`/state/control/roster/${runRef}/fyt-story/orders/story.md`)).toBe(false);
    // It settles as a human wait â€” it does not hang, and it is not a silent success.
    const events = store.listEvents('operator', runRef, 0, 500);
    expect(events.ok && events.value.some((event) => (event.summary ?? '').includes(DELIVERY_NOT_READY_REASON))).toBe(true);
  });

  it('waits with backoff and delivers once the menu is answered', async () => {
    let sessionId = '';
    let liveHost: ReturnType<typeof fakeHost> | null = null;
    const item = harness({
      replReadyTimeoutMs: 60_000,
      onSleep: (elapsed) => {
        if (!liveHost || !sessionId) return;
        // Once the order line has been typed, the submit's outcome-verify is polling for a running turn:
        // the REPL now paints the spinner footer, which is the positive evidence it engaged.
        if ((liveHost.writes.get(sessionId) ?? []).some((chunk) => chunk.includes('story.md'))) {
          liveHost.emit(sessionId, BUSY_FRAME);
          return;
        }
        // The operator answers the menu after the second poll and the REPL redraws past it — which is
        // what actually clears a menu from the current frame: real content scrolling it out, not blanks.
        if (elapsed >= 700) {
          const redraw = Array.from({ length: 30 }, (_, index) => `read binding.md line ${index}`).join('\r\n');
          // The REPL redraws its idle prompt AND its mode-cycler footer over the answered menu — the footer
          // is the positive evidence the readiness gate now requires.
          liveHost.emit(sessionId, `${redraw}\r\n> \r\n  ⏵⏵ auto mode on (shift+tab to cycle)\r\n`);
        }
      },
    });
    liveHost = item.host;
    item.sessions.ensureRoster({ subject: 'operator', runRef: item.runRef, proposal: item.plan });
    sessionId = sessionIdFor(item.sessions, item.runRef, 'fyt-story');
    succeedStage(item.store, item.runRef, 'idea');
    resolveGate(item.store, item.runRef, 'story', 'g0-idea-pick', 'approved');
    item.host.emit(sessionId, 'Do you want to proceed?\r\n1. Yes\r\n');

    const pending = item.sessions.deliver(deliverInput(item.store, item.runRef, item.plan, 'story'));
    const orderPath = `/state/control/roster/${item.runRef}/fyt-story/orders/story.md`;
    await vi.waitFor(() => { expect(item.fs.files.has(orderPath)).toBe(true); });
    expect(item.sleeps.length).toBeGreaterThan(1);
    // Backoff, not a busy-loop: each wait is at least as long as the one before it.
    expect(item.sleeps.every((ms, index) => index === 0 || ms >= item.sleeps[index - 1])).toBe(true);
    expect(item.host.writes.get(sessionId)?.some((chunk) => chunk.includes('read '))).toBe(true);
    item.host.emit(sessionId, `FYT-STAGE-DONE story ${'0'.repeat(31)}1 delivered after the menu cleared\r\n`);
    await expect(pending).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('withholds delivery from a terminal that is still mid-turn (live spinner heartbeat)', async () => {
    // A LIVE turn repaints its spinner every poll \u2014 the elapsed-seconds counter ticks at least once a
    // second \u2014 so the freshness gate ({@link detectReplReadinessFresh}) never sees the ~2s of silence it
    // needs to treat the busy marker as stale. That heartbeat is what separates a running turn from a
    // FINISHED one whose spinner tail is merely frozen in the window, so the mid-turn frame must keep
    // arriving for this to test the real invariant (an unheartbeated single emit would go stale, which is
    // exactly the post-turn case the fix is FOR).
    let sessionId = '';
    let live: ReturnType<typeof fakeHost> | null = null;
    const { plan, store, sessions, runRef, host } = harness({
      replReadyTimeoutMs: 30_000,
      onSleep: () => { if (live && sessionId) live.emit(sessionId, '\u273b Whatchamacalliting\u2026 \u276f esc to interrupt (44s \u00b7 thinking)\r\n'); },
    });
    live = host;
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    // The real 2.1.220 mid-turn frame (captured off a pty), not a hand-written approximation of one.
    host.emit(sessionId, 'Reading binding.md\u2026\r\n\u273dWhatchamacalliting\u2026 \u276f esc to interrupt\u273b (43s \u00b7 thinking)\r\n');
    const result = await sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain('mid-turn');
    expect(result.summary).toContain(DELIVERY_NOT_READY_REASON);
  });

  it('never types a work order into a terminal that has produced no output at all', async () => {
    // The daemon-restart resume path re-spawns the WHOLE roster, and a delivery in that window used to
    // be typed into a shell that had not yet booted `claude` — the failure this module's header names.
    const { plan, store, sessions, runRef, host, fs } = harness({ coldTerminals: true, replReadyTimeoutMs: 60_000 });
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const written = host.writes.get(sessionId)?.length ?? 0;

    const result = await sessions.deliver(deliverInput(store, runRef, plan, 'story'));

    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain(DELIVERY_NOT_READY_REASON);
    expect(result.summary).toContain('no output at all');
    // Nothing typed, nothing authored: the order never left the control plane.
    expect(host.writes.get(sessionId)).toHaveLength(written);
    expect(fs.files.has(`/state/control/roster/${runRef}/fyt-story/orders/story.md`)).toBe(false);
  });

  it('delivers as soon as a cold terminal produces its first output', async () => {
    let sessionId = '';
    let liveHost: ReturnType<typeof fakeHost> | null = null;
    const item = harness({
      coldTerminals: true,
      replReadyTimeoutMs: 60_000,
      // The REPL finishes booting between polls (silence is a RETRY, not a park); then, once the order is
      // typed, the submit's outcome-verify polls for a running turn — the terminal paints the spinner footer.
      onSleep: (elapsed) => {
        if (!liveHost || !sessionId) return;
        if ((liveHost.writes.get(sessionId) ?? []).some((chunk) => chunk.includes('story.md'))) {
          liveHost.emit(sessionId, BUSY_FRAME);
          return;
        }
        if (elapsed >= 250) liveHost.emit(sessionId, IDLE_FRAME);
      },
    });
    liveHost = item.host;
    item.sessions.ensureRoster({ subject: 'operator', runRef: item.runRef, proposal: item.plan });
    sessionId = sessionIdFor(item.sessions, item.runRef, 'fyt-story');
    succeedStage(item.store, item.runRef, 'idea');
    resolveGate(item.store, item.runRef, 'story', 'g0-idea-pick', 'approved');

    const pending = item.sessions.deliver(deliverInput(item.store, item.runRef, item.plan, 'story'));
    const orderPath = `/state/control/roster/${item.runRef}/fyt-story/orders/story.md`;
    await vi.waitFor(() => { expect(item.fs.files.has(orderPath)).toBe(true); });
    item.host.emit(sessionId, `FYT-STAGE-DONE story ${'0'.repeat(31)}1 delivered once the REPL came up\r\n`);
    await expect(pending).resolves.toMatchObject({ state: 'succeeded' });
  });

  it('keeps the marker deadline as the OUTER bound on the readiness wait', async () => {
    // A 60s delivery timeout must clamp a 5-minute readiness budget, not the other way round.
    const { plan, store, sessions, runRef, host, sleeps } = harness({
      deliveryTimeoutMs: 60_000, replReadyTimeoutMs: 5 * 60_000,
    });
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    host.emit(sessionId, 'Do you want to proceed?\r\n');
    const result = await sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    expect(result.state).toBe('waiting-human');
    expect(sleeps.reduce((total, ms) => total + ms, 0)).toBeLessThanOrEqual(60_000);
  });
});

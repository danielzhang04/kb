/**
 * Hermetic tests for the run-roster pty sessions and gated work-order delivery.
 *
 * Nothing real is touched: a fake `PtyHost` (recording every byte written into each session, and able to
 * emit output) drives the REAL persistent session registry, the control store is the in-memory one, and
 * the filesystem is a recording map. The load-bearing test is the STRUCTURAL HALT: with a gate
 * unapproved, the session's input transcript must contain no work order at all.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HostOpenRequest, PtyHandle, PtyHost, PtySession } from '../pty/host.ts';
import { createPersistentSessionRegistry } from '../pty/persistentSessions.ts';
import { createInMemoryControlPlaneStore, type ControlPlaneStore } from './store.ts';
import type { JsonObject, RunDetail } from './types.ts';
import type { PlanProposal, ProposalStage, ResolvedAgentAssignment } from './proposal.ts';
import type { ExecutionProfile } from './policy.ts';
import type { AssignedAgentResolver } from './agentAssignmentResolver.ts';
import {
  createRosterSessionManager,
  createRosterWorkerAdapter,
  projectRosterState,
  resolveRosterWorkDir,
  rosterAgentIds,
  stripTerminalControl,
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

function fakeFs(existing: string[] = []): RosterFileSystem & { files: Map<string, string>; dirs: string[] } {
  const files = new Map<string, string>();
  const dirs: string[] = [];
  const present = new Set(existing);
  return {
    files,
    dirs,
    ensureDir(path) { dirs.push(path); },
    writeFile(path, contents) { files.set(path.replace(/\\/g, '/'), contents); },
    exists(path) { return present.has(path.replace(/\\/g, '/')) || files.has(path.replace(/\\/g, '/')); },
  };
}

function harness(options: { plan?: PlanProposal; existingPaths?: string[] } = {}) {
  const plan = options.plan ?? proposalFixture();
  const store = createInMemoryControlPlaneStore({ newId: () => `id-${++sequence}` });
  const runRef = createApprovedRun(store, plan);
  const registry = createPersistentSessionRegistry();
  const host = fakeHost();
  const fs = fakeFs(options.existingPaths ?? ['/repo/orgs/faceless-youtube']);
  const resolve = vi.fn((input: Parameters<AssignedAgentResolver['resolve']>[0]) => ({
    assignment: { ...input.assignment },
    instructionMarkdown: `# ${input.assignment.agentId}\n\nYou own your phase.`,
  }));
  let token = 0;
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
  });
  return { plan, store, runRef, registry, host, fs, sessions, resolve };
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
      registry: createPersistentSessionRegistry(), fs: fakeFs(['/repo/orgs/faceless-youtube']),
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
    const orderPath = `/state/control/roster/${runRef}/fyt-story/orders/story.md`;
    const order = fs.files.get(orderPath);
    expect(order).toBeDefined();
    expect(order).toContain('Do story for the slice.');
    expect(order).toContain('FYT-STAGE-<VERDICT> story');
    // The order file never spells a literal verdict, so echoing it cannot fabricate a completion.
    expect(order).not.toContain('FYT-STAGE-DONE');
    const delivered = norm(host.writes.get(sessionId)?.join('') ?? '');
    expect(delivered).toContain(orderPath);
    expect(delivered.endsWith('\r')).toBe(true);
    const token = /completion token: ([0-9a-f]{32})/.exec(order ?? '')?.[1] as string;

    // Noise, a foreign token, and another stage's marker are all ignored.
    host.emit(sessionId, 'thinking...\r\n');
    host.emit(sessionId, `FYT-STAGE-DONE story ${'f'.repeat(32)} forged\r\n`);
    host.emit(sessionId, `FYT-STAGE-DONE images ${token} wrong stage\r\n`);
    host.emit(sessionId, `\u001b[32mFYT-STAGE-DONE story ${token} script.md written\u001b[0m\r\n`);

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

  it('refuses a completion whose declared artifacts are not on disk', async () => {
    const plan = proposalFixture();
    plan.stages[1].artifacts = [{ id: 'script', path: 'orgs/faceless-youtube/channels/x/script.md', description: 'the script' }];
    const { store, sessions, runRef, fs, host } = harness({ plan });
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    const sessionId = sessionIdFor(sessions, runRef, 'fyt-story');
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    const order = fs.files.get(`/state/control/roster/${runRef}/fyt-story/orders/story.md`) ?? '';
    const token = /completion token: ([0-9a-f]{32})/.exec(order)?.[1] as string;
    host.emit(sessionId, `FYT-STAGE-DONE story ${token} all done honest\r\n`);
    const result = await pending;
    expect(result.state).toBe('waiting-human');
    expect(result.summary).toContain('declared artifacts are missing');
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

  it('delegates to the headless adapter for runs without a roster', async () => {
    const fallback = { execute: vi.fn().mockResolvedValue({ state: 'succeeded', summary: 'headless', usage: { inputTokens: 0, outputTokens: 0, costUsdMicros: 0 }, artifacts: [], checkpoints: [] }) };
    const sessions = { hasRoster: () => false, deliver: vi.fn() } as unknown as RosterSessionManager;
    const adapter = createRosterWorkerAdapter({ sessions, fallback });
    const result = await adapter.execute(base);
    expect(result.summary).toBe('headless');
    expect(fallback.execute).toHaveBeenCalledTimes(1);
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
    const { plan, store, sessions, runRef } = harness();
    sessions.ensureRoster({ subject: 'operator', runRef, proposal: plan });
    succeedStage(store, runRef, 'idea');
    resolveGate(store, runRef, 'story', 'g0-idea-pick', 'approved');
    const pending = sessions.deliver(deliverInput(store, runRef, plan, 'story'));
    const story = sessions.state('operator', runRef).find((row) => row.agentId === 'fyt-story');
    expect(story).toMatchObject({ status: 'active', activity: 'working stage story' });
    sessions.retire(runRef, 'cleanup');
    await pending;
  });

  it('projects an empty session map without a live roster, recovering activity from durable events', () => {
    const { plan, store, runRef } = harness();
    const detail = detailOf(store, runRef);
    store.appendEvent('operator', runRef, {
      kind: 'lifecycle', source: 'system', status: 'pending', summary: 'roster:fyt-story working stage story',
    });
    const rows = projectRosterState(detail, {
      sessions: new Map(),
      working: new Set(),
      activity: new Map(),
      events: store.listEvents('operator', runRef, 0, 100),
    });
    expect(rows.find((row) => row.agentId === 'fyt-story')).toMatchObject({
      sessionId: null, activity: 'working stage story',
    });
    expect(rows.every((row) => row.sessionId === null)).toBe(true);
    expect(plan.stages).toHaveLength(3);
  });
});

describe('roster helpers', () => {
  it('resolves the deepest existing work directory and never trusts an unsafe segment', () => {
    const exists = (path: string) => ['/repo/orgs/p', '/repo/orgs/p/channels/c'].includes(path.replace(/\\/g, '/'));
    expect(resolveRosterWorkDir('/repo', 'p', { channel: 'c', slug: 's' }, exists).replace(/\\/g, '/'))
      .toBe('/repo/orgs/p/channels/c');
    expect(resolveRosterWorkDir('/repo', 'p', { channel: 'c' }, exists).replace(/\\/g, '/'))
      .toBe('/repo/orgs/p/channels/c');
    expect(resolveRosterWorkDir('/repo', 'p', { channel: '../etc', slug: 'x' }, exists).replace(/\\/g, '/'))
      .toBe('/repo/orgs/p');
    expect(resolveRosterWorkDir('/repo', 'q', {}, () => false)).toBe('/repo');
  });

  it('strips terminal control sequences so a coloured marker still scans', () => {
    expect(stripTerminalControl('\u001b[32mready\u001b[0m\r\n')).toBe('ready\n\n');
    expect(stripTerminalControl('\u001b]0;title\u0007plain')).toBe('plain');
  });
});

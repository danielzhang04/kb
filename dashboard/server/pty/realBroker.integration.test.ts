import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, connect as connectSocket, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import type { ExecutionProfile } from '../control/policy.ts';
import type { ProposalStage, ResolvedAgentAssignment } from '../control/proposal.ts';
import { createAttemptSessionAdapter } from '../control/attemptSessionAdapter.ts';
import type {
  ApprovedAttemptDeclaration,
  BrokerServerFrame,
  PortResult,
} from './contracts.ts';
import { BrokerFrameDecoder, decodeBrokerServerFrame, encodeBrokerFrame } from './brokerProtocol.ts';
import { LinuxBrokerClient } from './linuxBrokerClient.ts';
import {
  LinuxBrokerServer,
  type BrokerPtyLauncher,
  type BrokerRuntimeState,
} from './linuxBrokerServer.ts';
import {
  NodePtyChild,
  nodePtySpawnOptions,
  terminateVerifiedIdentity,
} from './linuxBrokerMain.ts';
import { createSessionRecordRegistry } from './sessionRecord.ts';
import {
  createSessionPersistence,
  createTranscriptRetention,
  enforcePtySessionRetention,
  MAX_RETAINED_SESSIONS,
} from './sessionPersistence.ts';

// The child consumes the WHOLE approved prompt sequence before it exits. Every prompt costs one durable
// write-ahead reservation (~25 ms here, queued behind the registry's transcript persistence), so a script
// that exited after reading only the first prompt raced the second one's delivery and dropped it about
// half the time. Reading both is also a stronger assertion: the pty echo alone proved only that the bytes
// reached the terminal, never that the child read them.
const FIRST_SCRIPT = 'echo READY; for i in 1 2 3 4 5; do printf "line-%s-%s\\n" $i "$(head -c 300 /dev/zero | tr "\\0" x)"; done; read -r FIRST; read -r SECOND; echo "GOT1:$FIRST"; echo "GOT2:$SECOND"; exit 7';
const FIRST_PROMPT = 'FIRST-REAL-PROMPT';
const SECOND_PROMPT = 'SECOND-REAL-PROMPT';
const EPOCH_ONE = `epoch-${'1'.repeat(32)}`;
const EPOCH_TWO = `epoch-${'2'.repeat(32)}`;

type RunningBroker = {
  broker: LinuxBrokerServer;
  listener: Server;
  sockets: Set<Socket>;
};

function claudeDeclaration(index: number, workOrder = `work-order-${index}`): ApprovedAttemptDeclaration {
  const profile: ExecutionProfile & { runtime: 'claude' } = {
    id: 'claude-worker',
    role: 'worker',
    runtime: 'claude',
    model: 'claude-sonnet',
    capabilities: ['read', 'write-approved-scope', 'emit-events'],
  };
  const assignment: ResolvedAgentAssignment = {
    agentId: 'reviewer-agent',
    declarationPath: '.agents/reviewer.md',
    declarationHash: 'd'.repeat(64),
    profileId: profile.id,
    runtime: profile.runtime,
    model: profile.model,
  };
  const proposalStage: ProposalStage = {
    id: `review-stage-${index}`,
    title: `Real broker attempt ${index}`,
    action: 'review:code',
    target: 'dashboard/server/control',
    workOrder,
    riskTier: 'T1',
    dependsOn: [],
    worker: { runtime: 'claude', model: 'claude-sonnet' },
    requiredSkills: ['code-review'],
    scope: { read: ['dashboard'], write: ['dashboard/server/control'] },
    artifacts: [{ id: 'review-report', path: 'dashboard/review.md', description: 'Review result.' }],
    checkpoints: [{ id: 'tests-green', label: 'Focused tests pass.' }],
    humanGates: [],
    assignment,
    workflowProfile: 'research',
  };
  const attemptRef = `attempt-real-${index}`;
  return {
    operationKey: `automatic-attempt:${attemptRef}`,
    subject: 'operator@example.test',
    runRef: `run-real-${index}`,
    stageRef: `stage-real-${index}`,
    attemptRef,
    sessionRef: `session-real-${index}`,
    rootId: 'worktrees',
    relativeCwd: 'orgs/example/worktree',
    cols: 120,
    rows: 42,
    profile,
    workflowProfile: 'research',
    skills: ['code-review'],
    action: proposalStage.action,
    target: proposalStage.target,
    workOrder: proposalStage.workOrder,
    readScope: proposalStage.scope.read,
    writeScope: proposalStage.scope.write,
    checkpoints: ['tests-green'],
    proposalStage,
    project: 'dashboard-v3',
    assignment,
    instructionMarkdown: `# Reviewer\n${FIRST_PROMPT}`,
    expectsIterationOutcome: false,
  };
}

function hostOperationKey(controlKey: string): string {
  return `op-${createHash('sha256').update(controlKey).digest('hex')}`;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForFrame(
  frames: BrokerServerFrame[],
  predicate: (frame: BrokerServerFrame) => boolean,
): Promise<BrokerServerFrame> {
  let found: BrokerServerFrame | undefined;
  await vi.waitFor(() => {
    found = frames.find(predicate);
    expect(found).toBeDefined();
  }, { timeout: 5_000, interval: 20 });
  return found!;
}

describe.skipIf(process.platform !== 'linux')('real Linux broker attempt-start vertical', () => {
  const launchScripts: string[] = [];
  const launchSpecs: Array<Parameters<BrokerPtyLauncher['launch']>[0]> = [];
  const children: NodePtyChild[] = [];
  const refusalResults: Array<PortResult<unknown>> = [];
  const brokerErrors: Array<Extract<BrokerServerFrame, { type: 'error' }>> = [];
  let sessionCounter = 1;
  let requestCounter = 0;
  let stateRoot: string;
  let socketPath: string;
  let brokerStatePath: string;
  let persistence: ReturnType<typeof createSessionPersistence>;
  let client: LinuxBrokerClient;
  let registry: ReturnType<typeof createSessionRecordRegistry>;
  let adapter: ReturnType<typeof createAttemptSessionAdapter>;
  let running: RunningBroker | null = null;
  let rawSocket: Socket | null = null;

  const track = <T>(result: PortResult<T>): PortResult<T> => {
    if (!result.ok) refusalResults.push(result);
    return result;
  };

  const launcher: BrokerPtyLauncher = {
    async launch(spec) {
      launchSpecs.push(spec);
      expect(spec).toMatchObject({
        executable: expect.stringMatching(/\/claude$/),
        args: expect.any(Array),
        env: expect.any(Object),
        cols: 120,
        rows: 42,
      });
      expect(spec.cwd.endsWith('/orgs/example/worktree')).toBe(true);
      const script = launchScripts.shift();
      if (script === undefined) throw new Error('real broker launcher had no queued test script');
      const nodePty = await import('node-pty');
      const child = nodePty.spawn('/bin/bash', ['-c', script], {
        ...nodePtySpawnOptions(spec),
        cwd: stateRoot,
      });
      const wrapped = await NodePtyChild.adopt(child);
      children.push(wrapped);
      return wrapped;
    },
  };

  async function startBroker(epochId: string): Promise<void> {
    let recovered: BrokerRuntimeState | null = null;
    if (existsSync(brokerStatePath)) {
      recovered = JSON.parse(readFileSync(brokerStatePath, 'utf8')) as BrokerRuntimeState;
    }
    const uid = process.getuid?.();
    const gid = process.getgid?.();
    if (uid === undefined || gid === undefined) throw new Error('real broker integration requires Linux uid/gid');
    const broker = new LinuxBrokerServer({
      epochId,
      expectedClientUid: uid,
      expectedClientGid: gid,
      launcher,
      makeSessionId: () => `pty-${(sessionCounter++).toString(16).padStart(32, '0')}`,
      now: () => new Date().toISOString(),
      recoveredSessions: recovered?.sessions.map(({ sessionId, epochId: recoveredEpoch, identity }) => ({
        sessionId,
        epochId: recoveredEpoch,
        identity,
      })),
      recoveredReceipts: recovered?.receipts,
      killOrphan: terminateVerifiedIdentity,
      persistState: (state) => writeFileSync(brokerStatePath, JSON.stringify(state), { mode: 0o600 }),
      log: () => {},
    });
    broker.onFrame((frame) => {
      if (frame.type === 'error') brokerErrors.push(frame);
    });
    await broker.recoverOrphans();
    const sockets = new Set<Socket>();
    const listener = createServer((socket) => {
      sockets.add(socket);
      socket.once('close', () => sockets.delete(socket));
      broker.accept(socket, { uid, gid, pid: process.pid });
    });
    await new Promise<void>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(socketPath, () => {
        listener.off('error', reject);
        resolve();
      });
    });
    running = { broker, listener, sockets };
  }

  async function stopBroker(): Promise<void> {
    const current = running;
    if (current === null) return;
    running = null;
    await current.broker.shutdown();
    for (const socket of current.sockets) socket.destroy();
    await new Promise<void>((resolve, reject) => {
      current.listener.close((error) => error === undefined ? resolve() : reject(error));
    });
    rmSync(socketPath, { force: true });
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  beforeAll(async () => {
    stateRoot = mkdtempSync(join(tmpdir(), 'real-broker-attempt-'));
    socketPath = join(stateRoot, 'broker.sock');
    brokerStatePath = join(stateRoot, 'broker-runtime.json');
    persistence = createSessionPersistence(stateRoot);
    await startBroker(EPOCH_ONE);
    client = new LinuxBrokerClient({
      connect: async () => connectSocket(socketPath),
      dashboardEpochId: `epoch-${'d'.repeat(32)}`,
      makeRequestId: () => `req-${(requestCounter++).toString(16).padStart(32, '0')}`,
      makeAttachmentId: () => `att-${(requestCounter++).toString(16).padStart(32, '0')}`,
      requestTimeoutMs: 5_000,
    });
    registry = createSessionRecordRegistry({
      host: client,
      hostKind: 'vm',
      persistence,
      transcript: createTranscriptRetention(stateRoot),
    });

    const originalCreate = client.create.bind(client);
    vi.spyOn(client, 'create').mockImplementation((request, sink) => {
      const launch = originalCreate(request, sink);
      return { ...launch, receipt: launch.receipt.then(track) };
    });
    const originalWrite = client.write.bind(client);
    vi.spyOn(client, 'write').mockImplementation(async (sessionId, data) =>
      track(await originalWrite(sessionId, data)));
    const originalClose = client.close.bind(client);
    vi.spyOn(client, 'close').mockImplementation(async (sessionId) => track(await originalClose(sessionId)));
    const originalStart = registry.startRunSession.bind(registry);
    vi.spyOn(registry, 'startRunSession').mockImplementation(async (input) => track(await originalStart(input)));
    const originalWriteOperation = registry.writeOperation.bind(registry);
    vi.spyOn(registry, 'writeOperation').mockImplementation(async (record, revision) =>
      track(await originalWriteOperation(record, revision)));
    const originalActivateEpoch = registry.activateEpoch.bind(registry);
    vi.spyOn(registry, 'activateEpoch').mockImplementation(async (epochId) =>
      track(await originalActivateEpoch(epochId)));

    adapter = createAttemptSessionAdapter({
      host: client,
      sessionRecords: registry,
    });
  });

  afterAll(async () => {
    rawSocket?.destroy();
    for (const child of children) {
      if (alive(child.pid)) child.kill();
    }
    client.disconnect();
    await stopBroker();
    vi.restoreAllMocks();
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it.sequential('persists real PTY output, byte offsets, host keys, exit, and retention', async () => {
    launchScripts.push(FIRST_SCRIPT);
    const input = claudeDeclaration(1, SECOND_PROMPT);
    const launch = adapter.begin(input);
    const receipt = await launch.receipt;
    expect(receipt).toMatchObject({ ok: true, value: { operationKey: input.operationKey } });
    if (!receipt.ok) throw new Error('attempt-real-1 was refused');
    await launch.result;

    const transcriptPath = join(stateRoot, 'pty', 'transcripts', `${receipt.value.sessionId}.raw`);
    await vi.waitFor(() => {
      const bytes = readFileSync(transcriptPath);
      const output = bytes.toString('utf8');
      expect(output).toContain('READY');
      for (let index = 1; index <= 5; index += 1) {
        expect(output).toContain(`line-${index}-${'x'.repeat(300)}`);
      }
      // The approved sequence is agent-binding prompt first, work order second, and the child echoes back
      // what it actually READ from stdin, in that order.
      expect(output.slice(output.indexOf('GOT1:'))).toContain(FIRST_PROMPT);
      expect(output.slice(output.indexOf('GOT2:'))).toContain(SECOND_PROMPT);
      const row = persistence.read().sessions.find((item) => item.sessionId === receipt.value.sessionId);
      expect(row).toMatchObject({ state: 'exited', exit: { exitCode: 7, reason: 'exited' } });
      expect(row?.transcript.lastSequence).toBe(bytes.byteLength);
    }, { timeout: 15_000, interval: 25 });

    const rawDocument = JSON.parse(
      readFileSync(join(stateRoot, 'pty', 'session-runs.json'), 'utf8'),
    ) as ReturnType<typeof persistence.read>;
    const operationKey = hostOperationKey(input.operationKey);
    expect(Object.keys(rawDocument.attemptOperations)).toContain(operationKey);
    expect(rawDocument.attemptOperations[operationKey]).toMatchObject({
      operationKey,
      promptsDelivered: 2,
      sessionId: receipt.value.sessionId,
    });
    expect(rawDocument.attemptOperations).not.toHaveProperty(input.operationKey);
    expect(launchSpecs).toHaveLength(1);

    const retained = structuredClone(rawDocument);
    const terminal = retained.sessions.find((item) => item.sessionId === receipt.value.sessionId);
    if (terminal === undefined || terminal.state !== 'exited') {
      throw new Error('attempt-real-1 did not produce an exited retention fixture');
    }
    for (let index = 0; index < MAX_RETAINED_SESSIONS; index += 1) {
      const sessionId = `pty-${(index + 10_000).toString(16).padStart(32, '0')}`;
      retained.sessions.push({ ...terminal, sessionId, exit: { ...terminal.exit, sessionId } });
    }
    enforcePtySessionRetention(retained);
    expect(retained.sessions).toHaveLength(MAX_RETAINED_SESSIONS);
    expect(retained.sessions.some((item) => item.sessionId === receipt.value.sessionId)).toBe(false);
    expect(refusalResults).toEqual([]);
    expect(brokerErrors).toEqual([]);
  }, 30_000);

  it.sequential('replays one control key while another attempt is live, then kills the cancelled child', async () => {
    launchScripts.push('sleep 30');
    const secondInput = claudeDeclaration(2);
    const second = adapter.begin(secondInput);
    const secondReceipt = await second.receipt;
    expect(secondReceipt).toMatchObject({ ok: true });
    if (!secondReceipt.ok) throw new Error('attempt-real-2 was refused');
    const secondPid = children.at(-1)!.pid;
    expect(alive(secondPid)).toBe(true);

    const createsBeforeReplay = launchSpecs.length;
    const replay = adapter.begin(claudeDeclaration(1, SECOND_PROMPT));
    await expect(replay.receipt).resolves.toMatchObject({
      ok: true,
      value: { operationKey: 'automatic-attempt:attempt-real-1' },
    });
    expect(launchSpecs).toHaveLength(createsBeforeReplay);

    await expect(adapter.cancel({
      operationKey: secondInput.operationKey,
      reason: 'real broker integration cancellation',
    })).resolves.toMatchObject({
      ok: true,
      value: { sessionId: secondReceipt.value.sessionId, reason: 'closed' },
    });
    await second.result;
    await vi.waitFor(() => expect(alive(secondPid)).toBe(false), { timeout: 5_000, interval: 25 });
    await vi.waitFor(() => {
      expect(persistence.read().sessions.find((item) => item.sessionId === secondReceipt.value.sessionId))
        .toMatchObject({ state: 'exited', exit: { reason: 'closed' } });
    });
    expect(refusalResults).toEqual([]);
    expect(brokerErrors).toEqual([]);
  }, 30_000);

  it.sequential('reconnects across a broker epoch and activates abandonment in production persistence', async () => {
    launchScripts.push('sleep 30');
    const staleInput = claudeDeclaration(30);
    const stale = adapter.begin(staleInput);
    const staleReceipt = await stale.receipt;
    expect(staleReceipt).toMatchObject({ ok: true });
    if (!staleReceipt.ok) throw new Error('stale epoch fixture was refused');
    expect(persistence.read().sessions.find((item) => item.sessionId === staleReceipt.value.sessionId))
      .toMatchObject({ state: 'live', epochId: EPOCH_ONE });

    await stopBroker();
    await stale.result;
    await startBroker(EPOCH_TWO);
    launchScripts.push('read -r REPLY; echo "EPOCH-THREE:$REPLY"; exit 0');
    const thirdInput = claudeDeclaration(3);
    const third = adapter.begin(thirdInput);
    const thirdReceipt = await third.receipt;
    expect(thirdReceipt).toMatchObject({ ok: true });
    if (!thirdReceipt.ok) throw new Error('attempt-real-3 was refused after reconnect');
    await third.result;

    await vi.waitFor(() => {
      const document = persistence.read();
      expect(document.epochId).toBe(EPOCH_TWO);
      expect(document.sessions.find((item) => item.sessionId === staleReceipt.value.sessionId)).toMatchObject({
        state: 'abandoned',
        // The dashboard observes the broker going away BEFORE the new epoch is activated (`stale.result`
        // is awaited above), so the epoch is abandoned by the lost connection, not by the restart sweep.
        abandonReason: 'epoch-lost',
        exit: { reason: 'abandoned' },
      });
      expect(document.sessions.find((item) => item.sessionId === thirdReceipt.value.sessionId))
        .toMatchObject({ state: 'exited', epochId: EPOCH_TWO });
      expect(document.sessions.filter((item) => item.epochId === EPOCH_ONE)
        .every((item) => item.state === 'exited' || item.state === 'abandoned')).toBe(true);
    });
    expect(refusalResults).toEqual([]);
    expect(brokerErrors).toEqual([]);
  }, 30_000);

  it.sequential('contains an unsafe-cwd refusal to its raw socket while the adapter client stays usable', async () => {
    const frames: BrokerServerFrame[] = [];
    const decoder = new BrokerFrameDecoder(decodeBrokerServerFrame);
    rawSocket = connectSocket(socketPath);
    rawSocket.on('data', (chunk: Buffer) => frames.push(...decoder.push(chunk)));
    rawSocket.write(encodeBrokerFrame({
      type: 'hello',
      requestId: `req-${'a'.repeat(32)}`,
      sessionId: null,
      protocol: 'kb-shell-broker/v1',
      dashboardEpochId: `epoch-${'a'.repeat(32)}`,
    }));
    const ready = await waitForFrame(frames, (frame) => frame.type === 'ready');
    if (ready.type !== 'ready') throw new Error('raw broker client did not receive ready');
    rawSocket.write(encodeBrokerFrame({
      type: 'create',
      requestId: `req-${'b'.repeat(32)}`,
      sessionId: null,
      epochId: ready.epochId,
      operationKey: `op-${'b'.repeat(64)}`,
      recipe: {
        launcher: 'shell',
        mode: 'interactive',
        model: null,
        toolPolicyId: 'shell-default',
        sandbox: 'interactive',
      },
      rootId: 'repo',
      relativeCwd: '..',
      cols: 80,
      rows: 24,
    }));
    await expect(waitForFrame(frames, (frame) => frame.type === 'error')).resolves.toMatchObject({
      type: 'error',
      requestId: `req-${'b'.repeat(32)}`,
      code: 'unsafe-cwd',
    });
    rawSocket.write(encodeBrokerFrame({
      type: 'launchers',
      requestId: `req-${'c'.repeat(32)}`,
      sessionId: null,
      epochId: ready.epochId,
    }));
    await expect(waitForFrame(frames, (frame) => frame.type === 'launchers')).resolves.toMatchObject({
      type: 'launchers',
      requestId: `req-${'c'.repeat(32)}`,
    });
    expect(rawSocket.destroyed).toBe(false);

    launchScripts.push('read -r REPLY; echo "ATTEMPT-FOUR:$REPLY"; exit 0');
    const fourth = adapter.begin(claudeDeclaration(4));
    await expect(fourth.receipt).resolves.toMatchObject({ ok: true });
    await fourth.result;
    expect(refusalResults).toEqual([]);
    expect(brokerErrors).toEqual([
      expect.objectContaining({ requestId: `req-${'b'.repeat(32)}`, code: 'unsafe-cwd' }),
    ]);
  }, 30_000);
});

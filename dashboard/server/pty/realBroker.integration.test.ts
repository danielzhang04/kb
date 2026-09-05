import { createHash } from 'node:crypto';
import { chmodSync, constants as fsConstants, existsSync, mkdtempSync, openSync, readFileSync, rmSync,
  writeFileSync } from 'node:fs';
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
import { buildBrokerLaunch, pinPipeStdinExec, type PinnedPipeStdinExec } from './fdPinnedPaths.ts';
import { LinuxBrokerClient } from './linuxBrokerClient.ts';
import {
  LinuxBrokerServer,
  type BrokerPty,
  type BrokerPtyLauncher,
  type BrokerRuntimeState,
} from './linuxBrokerServer.ts';
import {
  loadBrokerNodePty,
  pipeStdinShimPath,
  spawnBrokerChild,
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
// The child reports what KIND of fd 0 it was handed before it reads a byte from it. `claude -p` and
// `codex exec -` both refuse a tty on stdin, so a headless recipe that lands on STDIN_TTY=1 is the
// exact live failure this harness exists to keep out (VM run-a9bdd60f, exit 1 on the first real
// claude launch). The shell recipe asserts the other side of the same switch.
const TTY_PROBE = 'if [ -t 0 ]; then echo "STDIN_TTY=1"; else echo "STDIN_TTY=0"; fi';
// The child counts pty MASTERS in its own descriptor table. node-pty's openpty marks neither end
// FD_CLOEXEC and libuv closes nothing past the stdio slots, so an unfixed pipe launch hands the agent
// - and every grandchild under it - a master it can read its own transcript from, or write to and
// have the slave echo attacker-chosen bytes back as if the child had printed them.
// It also lists the descriptor table itself. `ls` runs in a subshell of the child and so inherits
// whatever the child holds, plus its own directory handle: 0, 1, 2 and 3 is a child that inherited
// NOTHING - not the shim it was execed from, not the CLI descriptor, not the master.
const PTMX_PROBE = 'echo "PTMX=$(ls -l /proc/self/fd | grep -c ptmx)'
  + ' FDS=$(ls /proc/self/fd | sort -n | paste -sd, -)"';
// A controlling terminal, which setsid alone does not give: without it /dev/tty will not open and
// SIGWINCH on resize is delivered to nobody.
const CTTY_PROBE = 'echo "CTTY=$(if : < /dev/tty; then echo yes; else echo no; fi)"';
const FIRST_SCRIPT = `${TTY_PROBE}; ${PTMX_PROBE}; echo READY; for i in 1 2 3 4 5; do printf "line-%s-%s\\n" $i "$(head -c 300 /dev/zero | tr "\\0" x)"; done; read -r FIRST; read -r SECOND; echo "GOT1:$FIRST"; echo "GOT2:$SECOND"; exit 7`;
const SHELL_SCRIPT = `${TTY_PROBE}; echo READY; read -r FIRST; echo "GOT1:$FIRST"; exit 7`;
// W67 wall 3. The child reports the git trust it was handed AND what git itself makes of it. The
// second half is the load-bearing one: `git config --get safe.directory` is git parsing
// GIT_CONFIG_COUNT/KEY_0/VALUE_0 out of the environment it was actually given, which is the only
// channel left (attempt worktrees are kb-dashboard-owned and the child is kb-shell, there is no
// /etc/gitconfig, no gitconfig in the child's HOME, and the child environment is a closed key set).
const GIT_TRUST_SCRIPT = `echo "GIT_ENV=$GIT_CONFIG_COUNT|$GIT_CONFIG_KEY_0|$GIT_CONFIG_VALUE_0";`
  + ` echo "GIT_READS=$(git config --get safe.directory)"; echo READY; read -r GO; exit 0`;
// `stty` reads fd 0, so it is pointed at fd 2 - the pty slave, and the one descriptor a command
// substitution does not replace with a pipe. It reports the master's window, which is what `resize`
// moves for a pipe-mode child just as it does for a tty one.
const RESIZE_SCRIPT = `${TTY_PROBE}; ${PTMX_PROBE}; ${CTTY_PROBE}; trap 'echo WINCH' WINCH; echo READY;`
  + ` read -r GO; echo "SIZE:$(stty size 0<&2)"; exit 0`;
// 1 MiB with no newline in it, so the pty's LF -> CRLF translation cannot blur the count. `tr -c x y`
// maps every byte that is not 'x' - here a megabyte of NULs - onto 'y', with no backslash escape to
// survive two levels of quoting.
const BURST_BYTES = 1_048_576;
// O_NONBLOCK read straight off the descriptor rather than inferred from behaviour: the burst below is
// the behavioural half, and on its own it is not decisive, because the broker reads the master
// continuously and a non-blocking terminal only fails once the pty buffer actually fills.
// /proc/self/fdinfo/<n> states the flag outright (O_NONBLOCK is 04000). It reads fd 2, not fd 1:
// inside `$( )` fd 1 is the command substitution's PIPE, so a probe pointed there measures the wrong
// descriptor entirely. fd 2 is the terminal in both stdin modes and no substitution replaces it.
const NONBLOCK_PROBE = 'NB=$(sed -n "s/^flags:[[:space:]]*//p" /proc/self/fdinfo/2);'
  + ' echo "NONBLOCK=$(( (NB & 04000) != 0 ))"';
const BURST_SCRIPT = `${NONBLOCK_PROBE}; echo READY; read -r GO; head -c ${BURST_BYTES} /dev/zero | tr -c x y;`
  + ' echo "BURST-END"; exit 0';
// The EOF-terminated stand-in, mirroring VM probes A3/A4: `codex exec -` reads its whole instruction
// from stdin and blocks until the pipe CLOSES, so `cat` is the honest bash equivalent. With the
// end-input frame the child gets EOF, echoes what it read, and exits 0; revert either half of the
// change (the adapter's `host.endInput` call, or `PipeStdinChild.endInput`) and this script hangs on
// `cat` until the test's own 30 s timeout kills it - the same shape as the 90 s kill on the VM.
const CODEX_EOF_SCRIPT = TTY_PROBE + '; echo READY; PROMPT=$(cat); echo "GOT-EOF"; echo "$PROMPT"; exit 0';
const CODEX_WORK_ORDER_MARKER = 'CODEX-READS-UNTIL-EOF';
const SHELL_RECIPE = { launcher: 'shell', mode: 'interactive', model: null,
  toolPolicyId: 'shell-default', sandbox: 'interactive' } as const;
const HEADLESS_RECIPE = { launcher: 'claude', mode: 'headless-json', model: 'claude-opus-5',
  toolPolicyId: 'producer', sandbox: 'claude-policy' } as const;
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

/**
 * The codex twin of `claudeDeclaration`. Same stage shape, different runtime - which is the whole
 * point: everything about the launch (argv table, stdin mode, prompt delivery, end of input) is
 * decided from `profile.runtime` and the recipe it produces, so a codex attempt is the only way to
 * exercise the EOF-terminated half of that table.
 */
function codexDeclaration(index: number): ApprovedAttemptDeclaration {
  const base = claudeDeclaration(index, `${CODEX_WORK_ORDER_MARKER} ${index}`);
  const profile: ExecutionProfile & { runtime: 'codex' } = {
    id: 'codex-worker', role: 'worker', runtime: 'codex', model: 'gpt-5.6-terra',
    capabilities: ['read', 'write-approved-scope', 'emit-events'],
  };
  const assignment: ResolvedAgentAssignment = {
    ...base.assignment!, profileId: profile.id, runtime: profile.runtime, model: profile.model,
  };
  return {
    ...base,
    profile,
    assignment,
    instructionMarkdown: base.instructionMarkdown!,
    proposalStage: { ...base.proposalStage, worker: { runtime: 'codex', model: profile.model }, assignment },
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
  const children: BrokerPty[] = [];
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
  let pipeExec: PinnedPipeStdinExec | null = null;
  let bashFd = -1;

  const track = <T>(result: PortResult<T>): PortResult<T> => {
    if (!result.ok) refusalResults.push(result);
    return result;
  };

  const launcher: BrokerPtyLauncher = {
    async launch(spec) {
      launchSpecs.push(spec);
      expect(spec).toMatchObject({
        args: expect.any(Array),
        env: expect.any(Object),
        cols: 120,
        rows: 42,
      });
      // Only the two executables this harness drives; which stdin each recipe earns is asserted by
      // the tests themselves, so a wrong `stdinMode` fails on the CHILD's own STDIN_TTY report rather
      // than here, before the child has run at all.
      expect(spec.executable).toMatch(/\/(claude|codex|bash)$/);
      expect(spec.cwd.endsWith('/orgs/example/worktree')).toBe(true);
      const script = launchScripts.shift();
      if (script === undefined) throw new Error('real broker launcher had no queued test script');
      // The PRODUCTION spawner, on the production spec and the production exec shim: only the
      // executable, argv and cwd are swapped for the test script, so `stdinMode` decides fd 0 here -
      // and the shim does the master/blocking/ctty work - exactly as on the VM.
      const wrapped = await spawnBrokerChild({
        launch: { ...spec, executable: '/bin/bash', args: ['-c', script], cwd: stateRoot },
        executableFd: bashFd,
        argv0: 'bash',
        shebang: false,
      }, await loadBrokerNodePty(), pipeExec);
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
    const selfUid = process.getuid?.() ?? 0;
    const selfGid = process.getgid?.() ?? 0;
    // The release archive stamps the shim 0444 and the installer extracts it as root, so on the VM it
    // is root-owned and unwritable. A git checkout under a 002 umask is 0664, which the pin refuses -
    // correctly. Normalise the working copy rather than weakening the rule; the mode is not tracked by
    // git, so this leaves no diff.
    chmodSync(pipeStdinShimPath(), 0o644);
    // The same pin the broker takes at start-up, against the same walk: /usr/bin/python3 must be a
    // root-owned executable under an approved root on this host too, or the harness is not exercising
    // the production hop at all.
    pipeExec = pinPipeStdinExec(pipeStdinShimPath(), { rootUid: 0, shellUid: selfUid,
      shellGid: selfGid, dashboardUid: selfUid, dashboardGid: selfGid });
    bashFd = openSync('/bin/bash', fsConstants.O_RDONLY);
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
    const originalEndInput = client.endInput.bind(client);
    vi.spyOn(client, 'endInput').mockImplementation(async (sessionId) =>
      track(await originalEndInput(sessionId)));
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
    pipeExec?.close();
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
      // The headless recipe's child was handed a PIPE on fd 0. Flip `stdinMode` back to 'tty' in
      // `buildBrokerLaunch` and this is the assertion that goes red.
      expect(output).toContain('STDIN_TTY=0');
      expect(output).not.toContain('STDIN_TTY=1');
      // Not one pty master in the agent's descriptor table - and nothing else inherited either.
      expect(output).toContain('PTMX=0 FDS=0,1,2,3\r\n');
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
    expect(launchSpecs[0]).toMatchObject({ stdinMode: 'pipe' });

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
    launchScripts.push('read -r REPLY; read -r SECOND; echo "EPOCH-THREE:$REPLY"; exit 0');
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

    launchScripts.push('read -r REPLY; read -r SECOND; echo "ATTEMPT-FOUR:$REPLY"; exit 0');
    const fourth = adapter.begin(claudeDeclaration(4));
    await expect(fourth.receipt).resolves.toMatchObject({ ok: true });
    await fourth.result;
    expect(refusalResults).toEqual([]);
    expect(brokerErrors).toEqual([
      expect.objectContaining({ requestId: `req-${'b'.repeat(32)}`, code: 'unsafe-cwd' }),
    ]);
  }, 30_000);

  /**
   * The other side of the switch, on the same spawner. An interactive recipe still gets a tty on fd 0
   * and still takes its input through the pty master - which is what makes STDIN_TTY=0 above a
   * statement about the RECIPE, rather than about the spawner having lost the ability to make a tty.
   */
  it.sequential('keeps a tty on stdin for an interactive shell recipe', async () => {
    launchScripts.push(SHELL_SCRIPT);
    const spec = buildBrokerLaunch(SHELL_RECIPE, 'worktrees', 'orgs/example/worktree',
      { cols: 120, rows: 42 });
    expect(spec.stdinMode).toBe('tty');
    const child = await launcher.launch(spec);
    let output = '';
    child.onData((data) => { output += Buffer.from(data).toString('utf8'); });
    const exited = new Promise<number | null>((resolve) => child.onExit((exitCode) => resolve(exitCode)));
    await vi.waitFor(() => expect(output).toContain('READY'), { timeout: 10_000, interval: 25 });
    await child.write(Buffer.from('SHELL-OVER-THE-PTY\n'));
    await expect(exited).resolves.toBe(7);
    expect(output).toContain('STDIN_TTY=1');
    expect(output).toContain('GOT1:SHELL-OVER-THE-PTY');
    // ...while every agent launch the adapter drove above took the pipe branch.
    expect(launchSpecs.filter((item) => item.executable.endsWith('/claude'))).not.toHaveLength(0);
    expect(launchSpecs.filter((item) => item.executable.endsWith('/claude'))
      .every((item) => item.stdinMode === 'pipe')).toBe(true);
    expect(refusalResults).toEqual([]);
  }, 30_000);

  /**
   * W67 wall 3, end to end through the PRODUCTION spawner. The first Gate 4b run's worker could not
   * run a single git command in its attempt worktree: the worktree is kb-dashboard-owned (2770, its
   * gitdir under /var/lib/kb/ops/.git/worktrees) and the child runs as kb-shell, so git 2.53 answers
   * "detected dubious ownership in repository".
   *
   * This harness cannot reproduce the OWNERSHIP half - its worktree path is not a repository and the
   * child runs as the same uid that owns everything under it, so `git status` would succeed here with
   * or without the fix, and asserting on it would prove nothing. What it can prove, and does, is the
   * thing the fix is: the three keys are derived broker-side from the pinned root, survive the real
   * spawn into the child's own environment, and are READ BY GIT there. The ownership refusal itself
   * stays a VM observation until the next live run.
   */
  it.sequential('hands a worktree-rooted child a git safe.directory trust for its own cwd', async () => {
    launchScripts.push(GIT_TRUST_SCRIPT);
    const spec = buildBrokerLaunch(SHELL_RECIPE, 'worktrees', 'orgs/example/worktree',
      { cols: 120, rows: 42 });
    expect(spec.env.GIT_CONFIG_COUNT).toBe('1');
    expect(spec.env.GIT_CONFIG_KEY_0).toBe('safe.directory');
    expect(spec.env.GIT_CONFIG_VALUE_0).toBe(spec.cwd);
    const child = await launcher.launch(spec);
    let output = '';
    child.onData((data) => { output += Buffer.from(data).toString('utf8'); });
    const exited = new Promise<number | null>((resolve) => child.onExit((exitCode) => resolve(exitCode)));
    await vi.waitFor(() => expect(output).toContain('READY'), { timeout: 10_000, interval: 25 });
    await child.write(Buffer.from('go\n'));
    await expect(exited).resolves.toBe(0);
    expect(output).toContain(`GIT_ENV=1|safe.directory|${spec.cwd}`);
    expect(output).toContain(`GIT_READS=${spec.cwd}`);

    // The canonical repository never earns the trust: granting it would widen kb-shell's git trust to
    // /var/lib/kb/ops, which is the thing the ownership check is there to stop.
    const repoSpec = buildBrokerLaunch(SHELL_RECIPE, 'repo', '', { cols: 120, rows: 42 });
    expect(repoSpec.env.GIT_CONFIG_COUNT).toBeUndefined();
    expect(repoSpec.env.GIT_CONFIG_KEY_0).toBeUndefined();
    expect(repoSpec.env.GIT_CONFIG_VALUE_0).toBeUndefined();
    expect(refusalResults).toEqual([]);
  }, 30_000);

  /**
   * Splitting fd 0 off the pty must not cost the session its terminal: a pipe-mode child still gets
   * its window size from the master, and still reports its own exit status rather than the master's
   * EOF. The child reads the size back out of fd 2 after the resize lands.
   */
  it.sequential('resizes a pipe-mode child through the pty master and observes its exit', async () => {
    launchScripts.push(RESIZE_SCRIPT);
    const spec = buildBrokerLaunch(HEADLESS_RECIPE, 'worktrees', 'orgs/example/worktree',
      { cols: 120, rows: 42 });
    expect(spec.stdinMode).toBe('pipe');
    const child = await launcher.launch(spec);
    let output = '';
    child.onData((data) => { output += Buffer.from(data).toString('utf8'); });
    const exited = new Promise<number | null>((resolve) => child.onExit((exitCode) => resolve(exitCode)));
    await vi.waitFor(() => expect(output).toContain('READY'), { timeout: 10_000, interval: 25 });
    child.resize(133, 44);
    await child.write(Buffer.from('go\n'));
    await expect(exited).resolves.toBe(0);
    expect(output).toContain('STDIN_TTY=0');
    expect(output).toContain('PTMX=0 FDS=0,1,2,3\r\n');
    // A controlling terminal, not merely a session: /dev/tty opens and SIGWINCH is delivered.
    expect(output).toContain('CTTY=yes');
    expect(output).toContain('WINCH');
    expect(output).toContain('SIZE:44 133');
    // The prompt went to the pipe, so the pty never echoed it back into the transcript.
    expect(output).not.toContain('go\r\n');
  }, 30_000);

  /**
   * The blocking-terminal proof. node-pty opens the pty slave O_NONBLOCK and dup2 shares the open
   * file description, so a child given that descriptor directly fails its own large writes with
   * EAGAIN - `write error: Resource temporarily unavailable` out of bash. Every byte has to arrive.
   */
  it.sequential('carries a 1 MiB burst off a pipe-mode child without a short or failed write', async () => {
    launchScripts.push(BURST_SCRIPT);
    const child = await launcher.launch(buildBrokerLaunch(HEADLESS_RECIPE, 'worktrees',
      'orgs/example/worktree', { cols: 120, rows: 42 }));
    let output = '';
    child.onData((data) => { output += Buffer.from(data).toString('latin1'); });
    const exited = new Promise<number | null>((resolve) => child.onExit((exitCode) => resolve(exitCode)));
    await vi.waitFor(() => expect(output).toContain('READY'), { timeout: 10_000, interval: 25 });
    await child.write(Buffer.from('go\n'));
    await expect(exited).resolves.toBe(0);
    // The terminal the child was handed is BLOCKING, and every byte of the burst arrived.
    expect(output).toContain('NONBLOCK=0');
    expect(output).toContain('BURST-END');
    expect(output).not.toMatch(/Resource temporarily unavailable|WouldBlock|write error/);
    expect(output.split('y').length - 1).toBe(BURST_BYTES);
  }, 60_000);

  /**
   * W64's live proof, on the production spawner and the production adapter: a headless CODEX attempt
   * whose child reads stdin until EOF starts, finishes, and keeps its output.
   *
   * The two defects this closes were both confirmed on the VM against the real binary. `--cd` pointed
   * at `/proc/self/fd/<n>`, a CLOEXEC descriptor already gone two execve hops later - exit 1 in 0.1 s.
   * And the prompt's trailing U+0004 is an ordinary byte on a PIPE, so `codex exec -` never saw the end
   * of its instruction and hung to the 90 s kill with zero output.
   *
   * RED ON REVERT, both halves:
   *   - drop the `host.endInput` call in `attemptSessionAdapter.begin`, or make `PipeStdinChild.endInput`
   *     a no-op, and `PROMPT=$(cat)` never returns: no `GOT-EOF`, no exit, and this test dies on its own
   *     30 s timeout;
   *   - put `'--cd', cwd` back on the fresh headless branch and the argv assertion below goes red before
   *     the child is even reached.
   */
  it.sequential('starts a headless codex attempt, ends its stdin, and keeps the child output', async () => {
    launchScripts.push(CODEX_EOF_SCRIPT);
    // This case runs after the raw-socket test, which parks a DELIBERATE `unsafe-cwd` error in
    // `brokerErrors`; the claim here is that THIS attempt adds none, not that the file has seen none.
    const brokerErrorsBefore = brokerErrors.length;
    const input = codexDeclaration(7);
    const launch = adapter.begin(input);
    const receipt = await launch.receipt;
    expect(receipt).toMatchObject({ ok: true });
    if (!receipt.ok) throw new Error('the codex EOF attempt was refused');
    await launch.result;

    // The recipe the broker actually built for this launch - before the harness swapped in bash.
    const spec = launchSpecs.at(-1)!;
    expect(spec.executable.endsWith('/codex')).toBe(true);
    expect(spec.stdinMode).toBe('pipe');
    expect(spec.args.slice(0, 5)).toEqual(['exec', '-', '--json', '--model', 'gpt-5.6-terra']);
    expect(spec.args).not.toContain('--cd');
    expect(spec.args).not.toContain(spec.cwd);

    const transcriptPath = join(stateRoot, 'pty', 'transcripts', `${receipt.value.sessionId}.raw`);
    await vi.waitFor(() => {
      const output = readFileSync(transcriptPath).toString('utf8');
      expect(output).toContain('STDIN_TTY=0');
      // The child reached the far side of `cat`, which only happens on a real EOF...
      expect(output).toContain('GOT-EOF');
      // ...with the whole approved work order intact, and no stray EOT byte in it.
      expect(output).toContain(CODEX_WORK_ORDER_MARKER);
      expect(output).not.toContain('\u0004');
      expect(persistence.read().sessions.find((item) => item.sessionId === receipt.value.sessionId))
        .toMatchObject({ state: 'exited', exit: { exitCode: 0, reason: 'exited' } });
    }, { timeout: 15_000, interval: 25 });

    const operationKey = hostOperationKey(input.operationKey);
    expect(persistence.read().attemptOperations[operationKey]).toMatchObject({ promptsDelivered: 1 });
    expect(refusalResults).toEqual([]);
    expect(brokerErrors).toHaveLength(brokerErrorsBefore);
  }, 30_000);

  /**
   * The write-after-exit path, which the two-prompt scripts elsewhere deliberately avoid: the stdin
   * pipe is gone (settle destroys it), so a write has no reader, no drain and no 'close' left to wait
   * on. It must resolve rather than hang, and its EPIPE must not surface as an unhandled 'error'.
   */
  it.sequential('resolves a write issued after a pipe-mode child has exited', async () => {
    launchScripts.push('echo READY; exit 0');
    const child = await launcher.launch(buildBrokerLaunch(HEADLESS_RECIPE, 'worktrees',
      'orgs/example/worktree', { cols: 120, rows: 42 }));
    const errors: unknown[] = [];
    const onRejection = (reason: unknown): void => { errors.push(reason); };
    process.on('unhandledRejection', onRejection);
    const exited = new Promise<number | null>((resolve) => child.onExit((exitCode) => resolve(exitCode)));
    await expect(exited).resolves.toBe(0);
    // FALSE, not a silent success: the pipe was destroyed at settle, so these bytes reached nobody
    // and the broker must be able to say so rather than ack them as accepted.
    await expect(child.write(Buffer.from('after-exit\n'))).resolves.toBe(false);
    await expect(child.write(Buffer.from('again\n'))).resolves.toBe(false);
    // ...and a resize after the master is gone is a no-op, not an ioctl on a recycled descriptor.
    expect(() => child.resize(80, 24)).not.toThrow();
    await new Promise<void>((resolve) => setTimeout(resolve, 50));
    // The SAME function reference: `process.off` with a fresh closure removes nothing, and the
    // listener would have outlived the test and collected every later rejection in the file.
    process.off('unhandledRejection', onRejection);
    expect(process.listeners('unhandledRejection')).not.toContain(onRejection);
    expect(errors).toEqual([]);
  }, 30_000);
});

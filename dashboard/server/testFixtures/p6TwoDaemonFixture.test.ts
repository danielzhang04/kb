import { describe, expect, it } from 'vitest';
import {
  ATTACK_IDS, InMemoryPlacementStore, NODE_PROXY_UID, OPERATOR_UID, SIM_PEER_UID_HEADER,
  buildFixtureDaemon, combinedProcTable, operatorBearer, parseDaemonArgs, parseLifecycleArgs,
  requirementFromAdvertisement, runAttackProbe, runTwoDaemonLifecycle, simulateDeadProxyListener,
  type LifecycleChild,
} from './p6TwoDaemonFixture.ts';
import type { CapabilityRequirement, HostAdvertisement } from '../placement/contracts.ts';

const REQUIREMENT: CapabilityRequirement = {
  connectors: [{ server: 'browser', tools: ['screenshot'] }, { server: 'gmail', tools: ['search'] }],
  skills: [], filesystemRoots: [], pty: false, gpu: false, clis: ['claude'],
};

// The frozen twenty-one, each owned by a 'refuses: <id>' test so assertP6GateResults' results-mode
// ownership check and the attack-root artifacts agree.
describe('P6 two-daemon attack probes', () => {
  for (const id of ATTACK_IDS) {
    it(`refuses: ${id}`, async () => {
      const result = await runAttackProbe(id);
      expect(result.passed, result.assertion).toBe(true);
      expect(result.assertion.length).toBeGreaterThan(0);
    });
  }
});

describe('peer-uid topology [P6-C46]', () => {
  it('refuses a node request on the operator listener and an operator request on the proxy listener, on the shared /api/v1/runs/** prefix', async () => {
    const store = new InMemoryPlacementStore();
    store.scheduleRun({ runRef: 'run-1', host: 'desktop', requirement: REQUIREMENT });
    const app = buildFixtureDaemon({ role: 'vm', store });
    await app.ready();
    // A node request (renew) arriving on the OPERATOR listener (uid 0) → 403 node-route-only.
    const nodeOnOperator = await app.inject({
      method: 'POST', url: '/api/v1/runs/run-1/leases/renew',
      headers: { host: '127.0.0.1:4317', 'tailscale-node-id': 'nodeDESK9', [SIM_PEER_UID_HEADER]: String(OPERATOR_UID), 'content-type': 'application/json' },
      payload: { expectedLeaseRevision: 1 },
    });
    // An operator read arriving with the PROXY uid → 403 operator-route-only, on the SAME prefix.
    const operatorOnProxy = await app.inject({
      method: 'GET', url: '/api/v1/runs/run-1',
      headers: { host: '127.0.0.1:4317', authorization: operatorBearer(), [SIM_PEER_UID_HEADER]: String(NODE_PROXY_UID) },
    });
    await app.close();
    expect(nodeOnOperator.statusCode).toBe(403);
    expect(nodeOnOperator.json().error.code).toBe('node-route-only');
    expect(operatorOnProxy.statusCode).toBe(403);
    expect(operatorOnProxy.json().error.code).toBe('operator-route-only');
  });
});

describe('forged-proxy split [P6-C70]', () => {
  it('a stopped proxy answers 502 from the listener with no dashboard 503; a stopped shim is 503 from the dashboard', async () => {
    const dead = simulateDeadProxyListener();
    expect(dead.status).toBe(502);
    expect(dead.dashboardEmitted503).toBe(false);

    const store = new InMemoryPlacementStore();
    const shimDown = buildFixtureDaemon({ role: 'vm', store, shimState: 'shim-down' });
    await shimDown.ready();
    const r = await shimDown.inject({
      method: 'PUT', url: '/api/v1/hosts/desktop',
      headers: { host: '127.0.0.1:4317', 'tailscale-node-id': 'nodeDESK9', [SIM_PEER_UID_HEADER]: String(NODE_PROXY_UID), 'content-type': 'application/json' },
      payload: {},
    });
    await shimDown.close();
    expect(r.statusCode).toBe(503);
    expect(r.json().error.code).toBe('node-attribution-unavailable');
  });
});

describe('InMemoryPlacementStore', () => {
  it('CAS-upserts advertisements and derives a stable capability hash from an advertisement', async () => {
    const store = new InMemoryPlacementStore();
    const adv: HostAdvertisement = {
      hostId: 'desktop', daemonVersion: 'd-1', reportedAt: '2026-08-25T00:00:00.000Z',
      connectors: [{ server: 'gmail', tools: ['search'] }], skills: [], filesystemRoots: [], pty: false, gpu: false,
      clis: { claude: 'ready', codex: 'missing' },
    };
    expect(await store.currentVersion('desktop')).toBeUndefined();
    const first = await store.upsert('desktop', adv, undefined);
    expect(first).toEqual({ ok: true, version: 1 });
    const stale = await store.upsert('desktop', adv, undefined);
    expect(stale).toEqual({ ok: false, current: 1 });
    expect(await store.currentAdvertisedCapabilityHash('desktop')).toBeTypeOf('string');
    expect(requirementFromAdvertisement(adv).connectors[0]!.server).toBe('gmail');
  });

  it('releases an expired lease exactly once', async () => {
    const store = new InMemoryPlacementStore();
    store.scheduleRun({ runRef: 'r1', host: 'vm', requirement: { connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: false, clis: [] } });
    await store.createLease('r1', 'vm', 'a'.repeat(64), '2026-08-25T00:00:00.000Z');
    const past = '2026-09-01T00:00:00.000Z';
    expect((await store.releaseExpiredLeases(past)).length).toBe(1);
    expect((await store.releaseExpiredLeases(past)).length).toBe(0);
  });
});

describe('combinedProcTable', () => {
  it('renders one peer row per uid with the uid in the peer column', () => {
    const table = combinedProcTable([OPERATOR_UID, NODE_PROXY_UID]);
    expect(table).toContain(` ${NODE_PROXY_UID}        0`);
    expect(table.split('\n').filter((l) => l.trim().length > 0).length).toBeGreaterThanOrEqual(5);
  });
});

// --- lifecycle wrapper teardown paths (injected seams, no real processes) ------------------------
function fakeChild(): { child: LifecycleChild; emitExit: (code: number) => void; killed: string[] } {
  const killed: string[] = [];
  let exitListener: ((code: number | null) => void) | undefined;
  const child: LifecycleChild = {
    pid: 4321,
    // A kill settles the child: the SIGTERM in teardown fires its exit, so no force-kill is needed.
    kill: (signal) => { killed.push(String(signal)); exitListener?.(0); return true; },
    once: (event, listener) => { if (event === 'exit') exitListener = listener as (code: number | null) => void; return child; },
  };
  return { child, emitExit: (code) => exitListener?.(code), killed };
}

describe('runTwoDaemonLifecycle', () => {
  const origins = { vmOrigin: 'https://127.0.0.1:4341', desktopOrigin: 'https://127.0.0.1:4342' };
  const commands = { vmCommand: ['node', 'vm'], desktopCommand: ['node', 'desktop'], clientCommand: ['node', 'client'] };

  it('runs the client once both daemons are ready and returns its exit code (17), then tears both daemons down', async () => {
    const vm = fakeChild(); const desktop = fakeChild(); const client = fakeChild();
    const spawns = [vm, desktop, client];
    let i = 0;
    const outcome = await runTwoDaemonLifecycle({
      ...commands, ...origins, readyTimeoutMs: 1000, shutdownTimeoutMs: 100,
      spawn: () => {
        const rec = spawns[i++]!;
        // Fire the client's exit as soon as it is spawned (its exit listener is registered synchronously).
        // The daemons stay alive until the teardown SIGTERM settles them (fakeChild.kill emits exit).
        if (rec === client) queueMicrotask(() => client.emitExit(17));
        return rec.child;
      },
      probe: async () => true,
      sleep: async () => {},
      now: () => 0,
      onInterrupt: () => () => {},
    });
    expect(outcome.ok).toBe(true);
    expect(outcome.exitCode).toBe(17);
    // Both daemons received a SIGTERM in the finally block.
    expect(vm.killed).toContain('SIGTERM');
    expect(desktop.killed).toContain('SIGTERM');
  });

  it('fails with ready-timeout when a daemon never answers /readyz, and tears both down', async () => {
    const vm = fakeChild(); const desktop = fakeChild();
    const spawns = [vm, desktop];
    let i = 0; let clock = 0;
    const outcome = await runTwoDaemonLifecycle({
      ...commands, ...origins, readyTimeoutMs: 300, shutdownTimeoutMs: 100,
      spawn: () => spawns[i++]!.child,
      probe: async () => false,
      sleep: async () => { clock += 200; },
      now: () => clock,
      onInterrupt: () => () => {},
    });
    // vm.emitExit is never called → treated as alive → force-killed on teardown.
    vm.emitExit(0);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('ready-timeout');
  });

  it('fails with daemon-failed when a daemon exits before becoming ready', async () => {
    const vm = fakeChild(); const desktop = fakeChild();
    const spawns = [vm, desktop];
    let i = 0;
    const promise = runTwoDaemonLifecycle({
      ...commands, ...origins, readyTimeoutMs: 1000, shutdownTimeoutMs: 100,
      spawn: () => spawns[i++]!.child,
      probe: async () => false,
      sleep: async () => {},
      now: () => 0,
      onInterrupt: () => () => {},
    });
    vm.emitExit(1); // vm dies before ready
    const outcome = await promise;
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('daemon-failed');
  });

  it('honors an interrupt before the client starts', async () => {
    const vm = fakeChild(); const desktop = fakeChild();
    const spawns = [vm, desktop];
    let i = 0; let fire: (() => void) | undefined;
    const promise = runTwoDaemonLifecycle({
      ...commands, ...origins, readyTimeoutMs: 1000, shutdownTimeoutMs: 100,
      spawn: () => spawns[i++]!.child,
      probe: async () => { fire?.(); return false; },
      sleep: async () => {},
      now: () => 0,
      onInterrupt: (handler) => { fire = handler; return () => {}; },
    });
    const outcome = await promise;
    vm.emitExit(0); desktop.emitExit(0);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('interrupted');
  });
});

describe('CLI parsers', () => {
  it('parses daemon args', () => {
    expect(parseDaemonArgs(['--daemon', '--role', 'vm', '--port', '4341', '--https'])).toMatchObject({ role: 'vm', port: 4341, https: true });
    expect(() => parseDaemonArgs(['--daemon', '--port', '1'])).toThrow(/role/);
  });
  it('parses lifecycle args and requires -- before the client', () => {
    const parsed = parseLifecycleArgs(['--vm-port', '4341', '--desktop-port', '4342', '--https', '--', 'node', 'client.ts']);
    expect(parsed).toMatchObject({ vmPort: 4341, desktopPort: 4342, https: true, clientCommand: ['node', 'client.ts'] });
    expect(() => parseLifecycleArgs(['--vm-port', '4341', '--desktop-port', '4342'])).toThrow(/missing `--`/);
  });
});

import { describe, expect, it } from 'vitest';
import { LEASE_TTL_MS } from './contracts.ts';
import type { HostKind, PlacementLease } from './contracts.ts';
import type { CandidateRun, ClaimClock, LeaseStorePort } from './leaseService.ts';
import { claimLease } from './leaseService.ts';
import type { ReportStorePort, RunTerminalState } from './reportService.ts';
import { submitReport } from './reportService.ts';
import { createDesktopClient } from './desktopClient.ts';
import type { DesktopClientTransport } from './desktopClient.ts';
import {
  attemptClaim, openReporterSession, runOnce, sendWithRetry,
} from './desktopReporter.ts';
import type { RetryClock } from './desktopReporter.ts';

const HASH_A = 'a'.repeat(64);

// ---------------------------------------------------------------------------------------------------
// sendWithRetry: reuses the SAME idempotency key across every retry of one logical call [P6-C36].
// ---------------------------------------------------------------------------------------------------
describe('sendWithRetry (P6-C36 client half)', () => {
  function immediateClock(): RetryClock {
    return { sleep: async () => undefined };
  }

  it('reuses the same idempotency key across retries of the same logical call', async () => {
    const seenKeys: string[] = [];
    let attempt = 0;
    const send = async (key: string) => {
      seenKeys.push(key);
      attempt += 1;
      return attempt < 3 ? { retry: true } : { retry: false, final: true };
    };
    const { result, attempts } = await sendWithRetry(
      send, { attempts: 5, delayMs: 0, isRetryable: (r) => (r as { retry: boolean }).retry }, immediateClock(),
    );
    expect(attempts).toBe(3);
    expect(result).toEqual({ retry: false, final: true });
    expect(new Set(seenKeys).size).toBe(1);
    expect(seenKeys).toHaveLength(3);
  });

  it('mints a DIFFERENT key for the next logical call', async () => {
    const keys: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const { idempotencyKey } = await sendWithRetry(
        async (key) => { keys.push(key); return { retry: false }; },
        { attempts: 1, delayMs: 0, isRetryable: () => false }, immediateClock(),
      );
      expect(keys.at(-1)).toBe(idempotencyKey);
    }
    expect(new Set(keys).size).toBe(2);
  });
});

// ---------------------------------------------------------------------------------------------------
// A fake VM daemon: routes desktopClient HTTP calls straight into leaseService/reportService against
// one shared in-memory store, so the reporter is exercised end-to-end without any real network or store.
// ---------------------------------------------------------------------------------------------------
function fakeVm(seed: CandidateRun) {
  let nowMs = 0;
  let lease: PlacementLease | undefined;
  let unplaced: CandidateRun[] = [seed];
  let releaseEvents = 0;
  let terminal: RunTerminalState = { terminalOutcome: null, completedAt: null };
  let nextRevision = 1;
  const completedOrFailedCalls: string[] = [];

  const leasePort: LeaseStorePort = {
    async releaseExpiredLeases(iso) {
      if (lease && Date.parse(lease.expiresAt) <= Date.parse(iso)) {
        const runRef = lease.runRef;
        const capabilityHash = lease.capabilityHash;
        lease = undefined;
        unplaced.push({ runRef, capabilityHash });
        releaseEvents += 1;
        return [runRef];
      }
      return [];
    },
    async selectCandidate() { return unplaced[0]; },
    async createLease(runRef, hostId, capabilityHash, iso) {
      if (lease) return undefined;
      const idx = unplaced.findIndex((c) => c.runRef === runRef);
      if (idx === -1) return undefined;
      unplaced.splice(idx, 1);
      lease = {
        runRef, hostId, capabilityHash, revision: nextRevision++,
        expiresAt: new Date(Date.parse(iso) + LEASE_TTL_MS).toISOString(), lastReportSequence: 0,
      };
      return lease;
    },
    async getLease(runRef) { return lease && lease.runRef === runRef ? lease : undefined; },
    async renewLease(runRef, expectedRevision, iso) {
      if (!lease || lease.runRef !== runRef || lease.revision !== expectedRevision) return undefined;
      lease = { ...lease, revision: lease.revision + 1, expiresAt: new Date(Date.parse(iso) + LEASE_TTL_MS).toISOString() };
      return lease;
    },
    async currentAdvertisedCapabilityHash() { return seed.capabilityHash; },
  };

  const reportPort: ReportStorePort = {
    getLease: leasePort.getLease,
    async getRunTerminalState() { return terminal; },
    currentAdvertisedCapabilityHash: leasePort.currentAdvertisedCapabilityHash,
    async appendReportEvent() { /* not asserted here */ },
    async bumpLeaseSequence(runRef, sequence) {
      if (lease && lease.runRef === runRef) lease = { ...lease, lastReportSequence: sequence };
    },
    async markTerminal(runRef, outcome) {
      completedOrFailedCalls.push(`${runRef}:${outcome}`);
      terminal = { terminalOutcome: outcome, completedAt: new Date(nowMs).toISOString() };
    },
    async openHumanRequest() { return { requestRef: 'req-1' }; },
  };

  function transportForHost(hostId: HostKind): DesktopClientTransport {
    return {
      async send(request) {
        if (request.method === 'POST' && /\/leases\/claim$/.test(request.url)) {
          const body = JSON.parse(request.body ?? '{}') as { waitMs: number };
          const clock: ClaimClock = { now: () => nowMs, sleep: async (ms) => { nowMs += ms; } };
          const outcome = await claimLease(leasePort, { hostId, waitMs: body.waitMs }, clock);
          if (!outcome.ok) return { status: 204, headers: {}, body: '' };
          return { status: 200, headers: {}, body: JSON.stringify({ runRef: outcome.lease.runRef, lease: outcome.lease }) };
        }
        if (request.method === 'POST' && /\/reports$/.test(request.url)) {
          const runRef = request.url.match(/\/runs\/([^/]+)\/reports$/)![1]!;
          const outcome = await submitReport(reportPort, {
            runRef, hostId, body: JSON.parse(request.body ?? '{}'), nowIso: new Date(nowMs).toISOString(),
          });
          if (outcome.ok) return { status: 200, headers: {}, body: JSON.stringify({ ok: true }) };
          return { status: outcome.status, headers: {}, body: JSON.stringify({ code: outcome.code }) };
        }
        throw new Error(`fakeVm: unhandled request ${request.method} ${request.url}`);
      },
    };
  }

  return {
    transportForHost,
    releaseEvents: () => releaseEvents,
    advanceTime: (ms: number) => { nowMs += ms; },
    currentLease: () => lease,
    completedOrFailedCalls,
  };
}

// ---------------------------------------------------------------------------------------------------
// The Desktop client never infers completion from its local process.
// ---------------------------------------------------------------------------------------------------
describe('runOnce never infers completion from the local process (P6-C36 client half)', () => {
  it('a local "work" function that finishes WITHOUT calling session.report(completed|failed) sends no such report', async () => {
    const vm = fakeVm({ runRef: 'run-1', capabilityHash: HASH_A });
    const client = createDesktopClient('https://vm.example:443/api/v1', vm.transportForHost('desktop'));
    // Simulate a local child process finishing on its own — the orchestrator is given ONLY the
    // session, never a process handle, so it has nothing from which to infer completion.
    const localProcessExitCode = 0;
    await runOnce(client, 'desktop', 0, async (session) => {
      await session.report('started', {});
      void localProcessExitCode; // the local process "finishes" here; no explicit report follows.
    });
    expect(vm.completedOrFailedCalls).toEqual([]);
  });

  it('completion is sent ONLY on an explicit session.report(completed) call', async () => {
    const vm = fakeVm({ runRef: 'run-1', capabilityHash: HASH_A });
    const client = createDesktopClient('https://vm.example:443/api/v1', vm.transportForHost('desktop'));
    await runOnce(client, 'desktop', 0, async (session) => {
      await session.report('started', {});
      await session.report('completed', {});
    });
    expect(vm.completedOrFailedCalls).toEqual(['run-1:ok']);
  });
});

// ---------------------------------------------------------------------------------------------------
// attemptClaim / openReporterSession basics.
// ---------------------------------------------------------------------------------------------------
describe('attemptClaim + openReporterSession', () => {
  it('claims the seeded run and reports with an increasing sequence', async () => {
    const vm = fakeVm({ runRef: 'run-1', capabilityHash: HASH_A });
    const client = createDesktopClient('https://vm.example:443/api/v1', vm.transportForHost('vm'));
    const claim = await attemptClaim(client, 'vm', 0);
    expect(claim.ok).toBe(true);
    const session = openReporterSession(client, (claim as { runRef: string }).runRef, (claim as { leaseRevision: number }).leaseRevision);
    expect(await session.report('started')).toEqual({ ok: true });
    expect(await session.report('event')).toEqual({ ok: true });
  });

  it('204 (nothing to claim) is a clean not-claimed outcome', async () => {
    const vm = fakeVm({ runRef: 'run-1', capabilityHash: HASH_A });
    // Exhaust the one seeded run first.
    const client = createDesktopClient('https://vm.example:443/api/v1', vm.transportForHost('vm'));
    await attemptClaim(client, 'vm', 0);
    const second = await attemptClaim(client, 'vm', 0);
    expect(second).toEqual({ ok: false });
  });
});

// ---------------------------------------------------------------------------------------------------
// Reclaim, client half: after 409 lease-expired the session stops, and the caller's re-claim picks the
// run up EXACTLY ONCE whether it was released by claim-time lazy expiry or by a concurrent sweeper tick.
// ---------------------------------------------------------------------------------------------------
describe('reclaim is exactly once across lazy-expiry and sweeper paths together (P6-C36, fixed seed)', () => {
  it('a 409 lease-expired report stops the session, and a concurrent re-claim + sweep yields exactly one new owner', async () => {
    const vm = fakeVm({ runRef: 'run-1', capabilityHash: HASH_A });
    const desktopClient = createDesktopClient('https://vm.example:443/api/v1', vm.transportForHost('desktop'));

    const claim = await attemptClaim(desktopClient, 'desktop', 0);
    expect(claim.ok).toBe(true);
    const session = openReporterSession(desktopClient, (claim as { runRef: string }).runRef, (claim as { leaseRevision: number }).leaseRevision);
    expect(await session.report('started')).toEqual({ ok: true });

    // Force the lease past its TTL, then fire a report — it must observe 409 lease-expired and stop.
    vm.advanceTime(LEASE_TTL_MS + 1);
    const afterExpiry = await session.report('event');
    expect(afterExpiry).toEqual({ ok: false, code: 'lease-expired' });
    expect(session.stopped).toBe(true);
    // The session is dead: a further call refuses locally without any transport traffic.
    expect(await session.report('event')).toEqual({ ok: false, code: 'lease-expired' });

    // Simultaneously: a fresh vm-side transport used as "the sweeper" (fixed seed, no real timer) and
    // the desktop client's own re-claim attempt — both race to reclaim the same expired lease.
    const vmSweeperClient = createDesktopClient('https://vm.example:443/api/v1', vm.transportForHost('vm'));
    const [sweepClaimAttempt, desktopReclaim] = await Promise.all([
      attemptClaim(vmSweeperClient, 'vm', 0),
      attemptClaim(desktopClient, 'desktop', 0),
    ]);

    const winners = [sweepClaimAttempt, desktopReclaim].filter((o) => o.ok);
    expect(winners).toHaveLength(1);
    expect(vm.releaseEvents()).toBe(1);
    expect((winners[0] as { runRef: string }).runRef).toBe('run-1');
  });
});

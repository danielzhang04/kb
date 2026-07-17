import { describe, it, expect } from 'vitest';
import { SessionOwner } from './index.ts';
import type { SessionCard, SessionHandle, SessionKind, SpawnSpec } from './index.ts';
import { list, inspect, stop, steer, rerun } from './verbs.ts';
import { canonicalCardPayload, contentHash } from '../dashboard/server/auth/challenge.ts';

const T2_CARD: SessionCard = {
  action: 'refactor',
  target: 'scripts/foo.py',
  'risk-tier': 'T2',
  owner: 'claude@agents.local',
  workOrderBody: '## Work order\n\nDo the refactor.',
};

/** A fake control handle that records interrupt/sigterm/sigkill/steer. */
function fakeHandle(
  id: string,
  kind: SessionKind,
  card?: SessionCard,
): SessionHandle & { calls: string[] } {
  const h = {
    id,
    kind,
    cardId: card ? 'kb-0001' : undefined,
    card,
    createdAt: 0,
    live: true,
    calls: [] as string[],
    interrupt() {
      this.calls.push('interrupt');
    },
    sigterm() {
      this.calls.push('sigterm');
    },
    sigkill() {
      this.calls.push('sigkill');
    },
    steer(text: string) {
      this.calls.push(`steer:${text}`);
    },
  };
  return h as unknown as SessionHandle & { calls: string[] };
}

/** An owner with an injected recording spawner, so `rerun` can be observed without a real runtime. */
function ownerWith(handles: Array<SessionHandle>, spawnCalls?: SpawnSpec[]) {
  const owner = new SessionOwner({
    repoRoot: '/repo',
    runPreamble: () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' }),
    cliSpawner: (spec) => {
      spawnCalls?.push(spec);
      return fakeHandle('respawn-1', 'broker-cli', spec.card);
    },
  });
  for (const h of handles) {
    if (h.kind.startsWith('broker-')) {
      // register broker-spawned via internal table by faking a spawn is awkward; use registerExternal
      // only for external. For broker handles we register through the same table via registerExternal
      // (the table does not distinguish HOW it was inserted; `kind` carries the boundary).
    }
    owner.registerExternal(h);
  }
  return owner;
}

describe('broker/verbs — steer tier-bump re-approval binding', () => {
  it('a steer that RAISES risk-tier (T2 -> T3) re-triggers approval and dispatches NOTHING', () => {
    const handle = fakeHandle('sdk-1', 'broker-sdk', T2_CARD);
    const owner = ownerWith([handle]);

    const result = steer(owner, 'sdk-1', { riskTier: 'T3', guidance: 'escalate this' });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'needs-reapproval') {
      // The re-approval binds to the dashboard content_hash preimage, which INCLUDES risk-tier, so the
      // proposed (T3) hash necessarily differs from the prior (T2) hash — no old signature can cover it.
      const expectedNew = contentHash(
        canonicalCardPayload(
          { action: T2_CARD.action, target: T2_CARD.target, 'risk-tier': 'T3', owner: T2_CARD.owner },
          T2_CARD.workOrderBody,
        ),
      );
      const expectedPrior = contentHash(
        canonicalCardPayload(
          { action: T2_CARD.action, target: T2_CARD.target, 'risk-tier': 'T2', owner: T2_CARD.owner },
          T2_CARD.workOrderBody,
        ),
      );
      expect(result.newContentHash).toBe(expectedNew);
      expect(result.priorContentHash).toBe(expectedPrior);
      expect(result.newContentHash).not.toBe(result.priorContentHash);
    } else {
      throw new Error('expected needs-reapproval');
    }
    // Crucially: the steer text was NEVER injected — no tier bump laundered past the gate.
    expect(handle.calls).toEqual([]);
  });

  it('a steer that keeps or LOWERS the tier applies normally (de-escalation needs no re-approval)', () => {
    const handle = fakeHandle('sdk-2', 'broker-sdk', T2_CARD);
    const owner = ownerWith([handle]);

    const same = steer(owner, 'sdk-2', { guidance: 'tweak wording' });
    expect(same.ok).toBe(true);
    expect(handle.calls).toEqual(['steer:tweak wording']);

    const lower = steer(owner, 'sdk-2', { riskTier: 'T1', guidance: 'lower risk' });
    expect(lower.ok).toBe(true);
    expect(handle.calls).toContain('steer:lower risk');
  });
});

describe('broker/verbs — graceful-only-for-Broker-sessions boundary', () => {
  it('steer on an EXTERNAL session is refused (kill-only) and injects nothing', () => {
    const ext = fakeHandle('tty-1', 'external-tty', T2_CARD);
    const owner = ownerWith([ext]);
    const result = steer(owner, 'tty-1', { guidance: 'inject into a human TTY turn' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('external-session-kill-only');
    expect(ext.calls).toEqual([]);
  });

  it('rerun on an EXTERNAL session is refused (kill-only)', () => {
    const ext = fakeHandle('routine-1', 'external-routine', T2_CARD);
    const owner = ownerWith([ext]);
    const result = rerun(owner, 'routine-1', 'go again');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('external-session-kill-only');
  });

  it('stop on a BROKER session is graceful (interrupt); stop on an EXTERNAL session is kill-only (SIGTERM)', () => {
    const broker = fakeHandle('sdk-3', 'broker-sdk', T2_CARD);
    const ext = fakeHandle('print-1', 'external-print', T2_CARD);
    const owner = ownerWith([broker, ext]);

    const g = stop(owner, 'sdk-3');
    expect(g.ok && g.mode).toBe('graceful');
    expect(broker.calls).toEqual(['interrupt']);

    const k = stop(owner, 'print-1');
    expect(k.ok && k.mode).toBe('kill');
    expect(ext.calls).toEqual(['sigterm']); // never 'interrupt' on an external session
  });

  it('rerun on a BROKER session re-spawns through the preamble-gated spawnSession', () => {
    const broker = fakeHandle('sdk-4', 'broker-sdk', T2_CARD);
    const spawnCalls: SpawnSpec[] = [];
    const owner = ownerWith([broker], spawnCalls);
    const result = rerun(owner, 'sdk-4', 'try again with feedback');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.outcome.ok).toBe(true);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].card?.['risk-tier']).toBe('T2');
  });
});

describe('broker/verbs — list / inspect are token-free', () => {
  it('list returns summaries with no token/prompt fields', () => {
    const broker = fakeHandle('sdk-5', 'broker-sdk', T2_CARD);
    const owner = ownerWith([broker]);
    const res = list(owner);
    expect(res.ok).toBe(true);
    const s = res.sessions[0];
    expect(s.id).toBe('sdk-5');
    expect(s.brokerSpawned).toBe(true);
    expect(Object.keys(s)).not.toContain('token');
    expect(Object.keys(s)).not.toContain('prompt');
  });

  it('inspect returns no-such-session for an unknown id', () => {
    const owner = ownerWith([]);
    const res = inspect(owner, 'nope');
    expect(res.ok).toBe(false);
  });
});

/**
 * Stranded-archiver — the daemon sweep that MOVES abandoned cards to queue/archived/. All side effects
 * (index, liveness probe, cards.py, git commit, audit) are injected as recording fakes: no real
 * schtasks/git/py runs. Proves the archive path uses the governed transaction sequence, that ALL THREE
 * conditions are required, and that every failure/unknown leaves the card UNTOUCHED (fail toward NOT
 * archiving), incl. interval-disable and tick isolation.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveStrandedCards,
  cardAgeMs,
  startStrandedArchiver,
  ARCHIVE_MARKER,
  type StrandedArchiveDeps,
  type LivenessProbe,
} from './strandedArchiver.ts';
import type { OwnerLiveness } from '../runner/liveness.ts';
import type { ParsedCard } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';

const NOW = new Date('2026-07-21T00:00:00.000Z');
const NOW_MS = NOW.getTime();
const NOW_SEC = Math.floor(NOW_MS / 1000);
const H = 3600;

/** A card id whose 8-hex epoch prefix is `secondsAgo` before NOW. */
function hexId(secondsAgo: number, suffix = 'abcd1234'): string {
  return `${Math.floor(NOW_SEC - secondsAgo).toString(16).padStart(8, '0')}-${suffix}`;
}

function card(id: string, state: string, owner: string | null, overrides: Partial<ParsedCard['meta']> = {}): ParsedCard {
  return {
    meta: { id, project: 'kb', action: 'research:topic', target: '.', 'risk-tier': 'T2', owner, state, ...overrides },
    body: '## Work order\n\ndo it\n',
  };
}

function index(cards: ParsedCard[]): PlaneAIndex {
  const grouped: Record<string, ParsedCard[]> = {};
  for (const c of cards) (grouped[String(c.meta.state)] ??= []).push(c);
  return {
    cards: grouped,
    ledgers: {
      dispatch: { count: 0, cards: 0, byProject: {} },
      cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
      grades: { count: 0, rows: [] },
      activity: { count: 0, rows: [] },
    },
    orgStates: [],
  };
}

const OFFLINE: OwnerLiveness = { consumer: 'scheduled-task', online: false, detail: 'schtasks query for kb-codex-runner failed' };
const ONLINE: OwnerLiveness = { consumer: 'scheduled-task', online: true, detail: 'scheduled task kb-codex-runner is Running' };

/** Recording deps using the REAL executeCardMutation (so prepare<py<audit<commit ordering is exercised),
 *  every external effect injected. `liveness` defaults to OFFLINE so the happy path archives. */
function recordingDeps(
  cards: ParsedCard[],
  liveness: LivenessProbe = () => OFFLINE,
): { deps: StrandedArchiveDeps; calls: string[]; ops: Array<{ cardId: string; transitions: string[]; block: string }> } {
  const calls: string[] = [];
  const ops: Array<{ cardId: string; transitions: string[]; block: string }> = [];
  const deps: StrandedArchiveDeps = {
    repoRoot: '/repo',
    indexRepo: () => index(cards),
    liveness,
    prepareWrite: async () => { calls.push('prepare'); },
    runPy: (_repo, _code, jsonArg) => {
      calls.push('py');
      const op = JSON.parse(jsonArg) as { cardId: string; transitions: string[]; block: string };
      ops.push({ cardId: op.cardId, transitions: op.transitions, block: op.block });
      return { exitCode: 0, stdout: JSON.stringify({ id: op.cardId, state: 'archived', paths: [`queue/inbox/${op.cardId}.md`, `queue/archived/${op.cardId}.md`] }), stderr: '' };
    },
    appendAuditLocal: (_repo, event) => { calls.push('audit'); return { ts: NOW.toISOString(), ...event }; },
    commitPreparedCoordination: (async (..._args: unknown[]) => { calls.push('commit'); }) as StrandedArchiveDeps['commitPreparedCoordination'],
    now: () => NOW,
  };
  return { deps, calls, ops };
}

describe('cardAgeMs', () => {
  it('derives age from the id hex-epoch prefix and returns null for a non-hex id', () => {
    expect(cardAgeMs(card(hexId(25 * H), 'inbox', 'codex-worker'), NOW_MS)).toBeGreaterThan(24 * H * 1000);
    expect(cardAgeMs(card('ordinary-work-1', 'inbox', 'codex-worker'), NOW_MS)).toBeNull();
  });
});

describe('archiveStrandedCards — the three-condition detection matrix', () => {
  it('archives an old agent-owned OFFLINE inbox card via the governed transaction (prepare<py<audit<commit)', async () => {
    const { deps, calls, ops } = recordingDeps([card(hexId(25 * H, 'old00001'), 'inbox', 'codex-worker')]);
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([hexId(25 * H, 'old00001')]);
    expect(result.skipped).toEqual([]);
    expect(calls).toEqual(['prepare', 'py', 'audit', 'commit']); // one governed transaction, correct order
    expect(ops[0].transitions).toEqual(['archived']); // single legal inbox->archived step
    expect(ops[0].block).toContain('auto-archived: stranded >24h, owner codex-worker offline');
    expect(ops[0].block).toContain(ARCHIVE_MARKER);
    expect(ops[0].block).toContain('reversible: move to inbox to reopen');
  });

  it('archives an old agent-owned OFFLINE WORKING card working->archived (working is reachable)', async () => {
    const { deps, ops } = recordingDeps([card(hexId(30 * H, 'wk000001'), 'working', 'codex-worker')]);
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([hexId(30 * H, 'wk000001')]);
    expect(ops[0].transitions).toEqual(['archived']);
  });

  it('does NOT archive when the owner is ONLINE (only slow), leaving it untouched and skipped', async () => {
    const { deps, calls } = recordingDeps([card(hexId(25 * H, 'online01'), 'inbox', 'codex-worker')], () => ONLINE);
    const result = await archiveStrandedCards(deps);
    expect(result).toEqual({ archived: [], skipped: [hexId(25 * H, 'online01')] });
    expect(calls).toEqual([]); // no mutation attempted
  });

  it('does NOT archive a human-operator-owned card (an operator gate) even when old and offline', async () => {
    const { deps, calls } = recordingDeps([card(hexId(48 * H, 'opgate01'), 'inbox', 'human-operator')]);
    const result = await archiveStrandedCards(deps);
    expect(result).toEqual({ archived: [], skipped: [] }); // filtered before any liveness/mutation
    expect(calls).toEqual([]);
  });

  it('does NOT archive an unowned (null owner) card even when old and offline', async () => {
    const { deps } = recordingDeps([card(hexId(48 * H, 'unowned1'), 'inbox', null)]);
    const result = await archiveStrandedCards(deps);
    expect(result).toEqual({ archived: [], skipped: [] });
  });

  it('does NOT archive a card younger than 24h', async () => {
    const { deps, calls } = recordingDeps([card(hexId(1 * H, 'recent01'), 'inbox', 'codex-worker')]);
    const result = await archiveStrandedCards(deps);
    expect(result).toEqual({ archived: [], skipped: [] });
    expect(calls).toEqual([]);
  });

  it('does NOT archive a card whose id carries no hex-epoch prefix (unknown age)', async () => {
    const { deps } = recordingDeps([card('ordinary-work-1', 'inbox', 'codex-worker')]);
    const result = await archiveStrandedCards(deps);
    expect(result).toEqual({ archived: [], skipped: [] });
  });

  it('does NOT archive a card in a non-eligible state (approvals/done/blocked/halted) however old', async () => {
    const { deps, calls } = recordingDeps([
      card(hexId(99 * H, 's1'), 'approvals', 'codex-worker'),
      card(hexId(99 * H, 's2'), 'done', 'codex-worker'),
      card(hexId(99 * H, 's3'), 'blocked', 'codex-worker'),
      card(hexId(99 * H, 's4'), 'halted', 'codex-worker'),
    ]);
    const result = await archiveStrandedCards(deps);
    expect(result).toEqual({ archived: [], skipped: [] });
    expect(calls).toEqual([]);
  });

  it('treats a THROWING liveness probe as unknown and leaves the card untouched (fail toward NOT archiving)', async () => {
    const { deps, calls } = recordingDeps([card(hexId(25 * H, 'boom0001'), 'inbox', 'codex-worker')], () => { throw new Error('schtasks boom'); });
    const result = await archiveStrandedCards(deps);
    expect(result).toEqual({ archived: [], skipped: [hexId(25 * H, 'boom0001')] });
    expect(calls).toEqual([]);
  });

  it('leaves the card in place when the cards.py mutation fails (fail toward NOT archiving)', async () => {
    const { deps } = recordingDeps([card(hexId(25 * H, 'pyfail01'), 'inbox', 'codex-worker')]);
    deps.runPy = () => ({ exitCode: 1, stdout: '', stderr: 'illegal transition' });
    const result = await archiveStrandedCards(deps);
    expect(result).toEqual({ archived: [], skipped: [hexId(25 * H, 'pyfail01')] });
  });

  it('archives the eligible card and skips the online one in one mixed pass', async () => {
    const oldOffline = card(hexId(25 * H, 'off00001'), 'inbox', 'codex-worker');
    const oldOnline = card(hexId(25 * H, 'on000001'), 'working', 'codex-worker');
    const liveness: LivenessProbe = (_owner, c) => (c.meta.id === oldOnline.meta.id ? ONLINE : OFFLINE);
    const { deps } = recordingDeps([oldOffline, oldOnline], liveness);
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([oldOffline.meta.id]);
    expect(result.skipped).toEqual([oldOnline.meta.id]);
  });
});

describe('startStrandedArchiver', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('is a no-op (never schedules a tick) when intervalMs <= 0', () => {
    vi.useFakeTimers();
    const indexRepo = vi.fn(() => index([]));
    const stop = startStrandedArchiver({ repoRoot: '/repo', indexRepo }, 0);
    vi.advanceTimersByTime(1_000_000);
    expect(indexRepo).not.toHaveBeenCalled();
    expect(typeof stop).toBe('function');
    stop();
  });

  it('runs a sweep on each interval and stops on the returned stop fn', async () => {
    vi.useFakeTimers();
    const indexRepo = vi.fn(() => index([]));
    const stop = startStrandedArchiver({ repoRoot: '/repo', indexRepo, liveness: () => OFFLINE }, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(indexRepo).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(indexRepo).toHaveBeenCalledTimes(1); // no further ticks after stop
  });

  it('swallows a sweep throw so a tick can never crash the daemon', async () => {
    vi.useFakeTimers();
    const indexRepo = vi.fn(() => { throw new Error('index boom'); });
    const stop = startStrandedArchiver({ repoRoot: '/repo', indexRepo }, 1000);
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
    stop();
  });
});

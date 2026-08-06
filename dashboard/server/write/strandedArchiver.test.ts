/**
 * Stranded-archiver v2 — proves the CORRECTED predicates and DRY-RUN-ONLY default. All side effects
 * (index, ownerActivity reader, liveness probe, cards.py, git commit, audit) are injected recording fakes:
 * no real schtasks/git/py/fs. The load-bearing assertions vs v1:
 *   - fresh owner-activity ⇒ SKIP even when the card is old (v1 would archive);
 *   - UNKNOWN owner (no observable footprint) ⇒ SKIP (v1 archived);
 *   - both-idle ⇒ WOULD-archive; but dry-run (default) MOVES nothing;
 *   - schtasks is a veto only: affirmative online ⇒ skip; a throwing probe does NOT block archiving;
 *   - live mode (dryRun:false) walks the governed prepare<py<audit<commit transaction.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  archiveStrandedCards,
  cardAgeMs,
  cardIdEpochMs,
  lastBodyWriteMs,
  startStrandedArchiver,
  ARCHIVE_MARKER,
  DEFAULT_STRANDED_WINDOW_MS,
  type StrandedArchiveDeps,
  type LivenessProbe,
} from './strandedArchiver.ts';
import type { OwnerActivity, OwnerActivityReader } from './ownerActivity.ts';
import type { OwnerLiveness } from '../runner/liveness.ts';
import type { CardProjection } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';

const NOW = new Date('2026-07-21T00:00:00.000Z');
const NOW_MS = NOW.getTime();
const NOW_SEC = Math.floor(NOW_MS / 1000);
const H = 3600;
const DAY = 24 * H;

/** A card id whose 8-hex epoch prefix is `secondsAgo` before NOW. */
function hexId(secondsAgo: number, suffix = 'abcd1234'): string {
  return `${Math.floor(NOW_SEC - secondsAgo).toString(16).padStart(8, '0')}-${suffix}`;
}

function card(id: string, state: string, owner: string | null, overrides: Partial<CardProjection['meta']> = {}, body = '## Work order\n\ndo it\n'): CardProjection {
  return {
    meta: { id, project: 'kb', action: 'research:topic', target: '.', 'risk-tier': 'T2', owner, state, ...overrides },
    body,
    displayName: 'research:topic',
    shortRef: 1,
  };
}

function index(cards: CardProjection[]): PlaneAIndex {
  const grouped: Record<string, CardProjection[]> = {};
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

const OFFLINE: OwnerLiveness = { consumer: 'runner-process', online: false, detail: 'runner kb-codex-runner is not running' };
const ONLINE: OwnerLiveness = { consumer: 'runner-process', online: true, detail: 'runner kb-codex-runner is running (pid 42)' };

/** Owner-activity reader that reports a FIXED age for every owner (or UNKNOWN when `null`). */
function activityAt(ms: number | null): OwnerActivityReader {
  return () => (ms === null ? { lastActivityMs: null, sources: [] } : { lastActivityMs: ms, sources: [{ source: 'memory', ms }] } satisfies OwnerActivity);
}

/** UNKNOWN owner — no observable footprint at all. */
const UNKNOWN_OWNER: OwnerActivityReader = () => ({ lastActivityMs: null, sources: [] });
/** Stale owner — last seen well past the window. (DAY is in SECONDS for hexId; *1000 => ms here.) */
const STALE_OWNER: OwnerActivityReader = activityAt(NOW_MS - 30 * DAY * 1000);
/** Fresh owner — active yesterday. */
const FRESH_OWNER: OwnerActivityReader = activityAt(NOW_MS - 1 * DAY * 1000);

/** Recording deps using the REAL executeCardMutation. `dryRun:false` by default HERE so the mutation path
 *  is exercised; the sweep's own default (dry-run) is asserted separately. */
function recordingDeps(
  cards: CardProjection[],
  over: Partial<StrandedArchiveDeps> = {},
): { deps: StrandedArchiveDeps; calls: string[]; ops: Array<{ cardId: string; transitions: string[]; block: string }> } {
  const calls: string[] = [];
  const ops: Array<{ cardId: string; transitions: string[]; block: string }> = [];
  const deps: StrandedArchiveDeps = {
    repoRoot: '/repo',
    dryRun: false,
    ownerActivity: STALE_OWNER,
    liveness: () => OFFLINE,
    indexRepo: () => index(cards),
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
    ...over,
  };
  return { deps, calls, ops };
}

describe('cardAgeMs / cardIdEpochMs / lastBodyWriteMs', () => {
  it('derives age from the id hex-epoch prefix and returns null for a non-hex id', () => {
    expect(cardAgeMs(card(hexId(10 * DAY), 'inbox', 'codex-worker'), NOW_MS)).toBeGreaterThan(7 * DAY * 1000);
    expect(cardAgeMs(card('ordinary-work-1', 'inbox', 'codex-worker'), NOW_MS)).toBeNull();
    expect(cardIdEpochMs(card('ordinary-work-1', 'inbox', 'codex-worker'))).toBeNull();
  });

  it('reads the newest ISO timestamp from ## Result / ## Feedback only — NEVER ## Evidence', () => {
    const body = [
      '## Work order', 'do it', '',
      '## Evidence', 'operator wrote 2026-07-20T00:00:00Z here — INERT, must be ignored', '',
      '## Result', 'noted 2026-07-15T00:00:00.000Z', '',
      '## Feedback', 'and again 2026-07-18T12:00:00Z', '',
    ].join('\n');
    const c = card(hexId(30 * DAY), 'inbox', 'codex-worker', {}, body);
    expect(lastBodyWriteMs(c, NOW_MS)).toBe(Date.parse('2026-07-18T12:00:00Z')); // newest of Result/Feedback
    // the Evidence 2026-07-20 (newer) must NOT win — proves Evidence is not read
    expect(lastBodyWriteMs(c, NOW_MS)).toBeLessThan(Date.parse('2026-07-20T00:00:00Z'));
  });

  it('ignores future-dated timestamps (anti-spoof)', () => {
    const body = '## Result\nfuture 2099-01-01T00:00:00Z\n';
    expect(lastBodyWriteMs(card(hexId(30 * DAY), 'inbox', 'x', {}, body), NOW_MS)).toBeNull();
  });
});

describe('archiveStrandedCards — corrected predicates (live mode for the mutation path)', () => {
  it('archives an old card whose owner is ALSO stale, via the governed transaction (prepare<py<audit<commit)', async () => {
    const { deps, calls, ops } = recordingDeps([card(hexId(10 * DAY, 'old00001'), 'inbox', 'codex-worker')]);
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([hexId(10 * DAY, 'old00001')]);
    expect(result.wouldArchive).toEqual([hexId(10 * DAY, 'old00001')]);
    expect(calls).toEqual(['prepare', 'py', 'audit', 'commit']);
    expect(ops[0].transitions).toEqual(['archived']);
    expect(ops[0].block).toContain(ARCHIVE_MARKER);
    expect(ops[0].block).toContain('reversible: move to inbox to reopen');
  });

  it('archives an old stale-owner WORKING card working->archived', async () => {
    const { deps, ops } = recordingDeps([card(hexId(12 * DAY, 'wk000001'), 'working', 'codex-worker')]);
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([hexId(12 * DAY, 'wk000001')]);
    expect(ops[0].transitions).toEqual(['archived']);
  });

  it('KEY FIX: does NOT archive an old card whose owner is FRESH (active recently), even though card-idle is stale', async () => {
    const { deps, calls } = recordingDeps([card(hexId(10 * DAY, 'fresh001'), 'inbox', 'claude-boss')], { ownerActivity: FRESH_OWNER });
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([]);
    expect(result.skipped).toEqual([hexId(10 * DAY, 'fresh001')]);
    expect(calls).toEqual([]); // no mutation attempted
    expect(result.decisions[0].skipReason).toMatch(/owner-idle/);
  });

  it('KEY FIX: does NOT archive when the owner is UNKNOWN (no observable footprint) — unknown ⇒ ALIVE', async () => {
    const { deps, calls } = recordingDeps([card(hexId(10 * DAY, 'unkown01'), 'inbox', 'worker-desktop')], { ownerActivity: UNKNOWN_OWNER });
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([]);
    expect(result.skipped).toEqual([hexId(10 * DAY, 'unkown01')]);
    expect(result.decisions[0].skipReason).toMatch(/UNKNOWN.*ALIVE/);
    expect(calls).toEqual([]);
  });

  it('does NOT archive a card younger than the window even with a stale owner', async () => {
    const { deps, calls } = recordingDeps([card(hexId(2 * DAY, 'recent01'), 'inbox', 'codex-worker')]);
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([]);
    expect(result.decisions[0].skipReason).toMatch(/card-idle/);
    expect(calls).toEqual([]);
  });

  it('a recent ## Result body write keeps an OLD-id card alive (card-idle folds in body write)', async () => {
    const body = `## Result\nrevisited 2026-07-20T00:00:00Z\n`; // 1 day ago
    const { deps } = recordingDeps([card(hexId(30 * DAY, 'revis001'), 'inbox', 'codex-worker', {}, body)]);
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([]);
    expect(result.decisions[0].skipReason).toMatch(/card-idle/);
  });

  it('REGRESSION (review round 2, finding 1): a THROWING ownerActivity reader forces SKIP even with a stale ## Result body timestamp — it must NOT fall through to a body-only owner clock', async () => {
    // Old id AND a stale (30d-old) body write. If the throwing reader fell through to
    // ownerLastMs = max(-Infinity, staleBodyMs), owner-idle would read stale and the card would ARCHIVE
    // off a single clock. It must skip: a reader we cannot observe is UNKNOWN => ALIVE.
    const body = `## Result\nlast touched 2026-06-21T00:00:00Z\n`; // ~30 days before NOW
    const throwing: OwnerActivityReader = () => { throw new Error('git blew up'); };
    const { deps, calls } = recordingDeps([card(hexId(20 * DAY, 'throw001'), 'inbox', 'codex-worker', {}, body)], { ownerActivity: throwing });
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([]);
    expect(result.wouldArchive).toEqual([]);
    expect(result.skipped).toEqual([hexId(20 * DAY, 'throw001')]);
    expect(result.decisions[0].skipReason).toMatch(/reader threw.*ALIVE/);
    expect(calls).toEqual([]); // no mutation attempted
  });

  it('REGRESSION (the motivating bug): an ~84h worker-desktop cadence card with NO owner footprint SURVIVES under the 7-day window (v1 archived it)', async () => {
    // Exactly the two live cards the hold prevented: worker-desktop owner, ~84h old, unobserved. Uses the
    // DEFAULT 7-day window (no windowMs override) and the real dry-run default. Must NOT be archived.
    const eightyFourHoursSec = 84 * H;
    const { deps, calls } = recordingDeps(
      [card(hexId(eightyFourHoursSec, 'cadence1'), 'inbox', 'worker-desktop', { action: 'cadence:nightly-review' })],
      { dryRun: undefined, windowMs: undefined, ownerActivity: UNKNOWN_OWNER },
    );
    delete (deps as { dryRun?: boolean }).dryRun;   // exercise the shipped dry-run default
    delete (deps as { windowMs?: number }).windowMs; // exercise the shipped 7-day default
    const result = await archiveStrandedCards(deps);
    expect(result.wouldArchive).toEqual([]); // not even a dry-run candidate
    expect(result.archived).toEqual([]);
    expect(result.skipped).toEqual([hexId(eightyFourHoursSec, 'cadence1')]);
    // card-idle (~84h) < 168h window is the first gate that spares it; owner-idle UNKNOWN would spare it too.
    expect(result.decisions[0].skipReason).toMatch(/card-idle/);
    expect(calls).toEqual([]);
  });

  it('does NOT archive a human-operator-owned card (an operator gate)', async () => {
    const { deps } = recordingDeps([card(hexId(20 * DAY, 'opgate01'), 'inbox', 'human-operator')]);
    const result = await archiveStrandedCards(deps);
    expect(result).toMatchObject({ archived: [], skipped: [], wouldArchive: [] });
  });

  it('does NOT archive an unowned (null owner) card', async () => {
    const { deps } = recordingDeps([card(hexId(20 * DAY, 'unowned1'), 'inbox', null)]);
    const result = await archiveStrandedCards(deps);
    expect(result).toMatchObject({ archived: [], skipped: [], wouldArchive: [] });
  });

  it('does NOT archive a card whose id carries no hex-epoch prefix (unknown age)', async () => {
    const { deps } = recordingDeps([card('ordinary-work-1', 'inbox', 'codex-worker')]);
    const result = await archiveStrandedCards(deps);
    expect(result).toMatchObject({ archived: [], skipped: [], wouldArchive: [] });
  });

  it('does NOT archive a non-eligible state (approvals/done/blocked/halted) however old', async () => {
    const { deps } = recordingDeps([
      card(hexId(40 * DAY, 's1'), 'approvals', 'codex-worker'),
      card(hexId(40 * DAY, 's2'), 'done', 'codex-worker'),
      card(hexId(40 * DAY, 's3'), 'blocked', 'codex-worker'),
      card(hexId(40 * DAY, 's4'), 'halted', 'codex-worker'),
    ]);
    const result = await archiveStrandedCards(deps);
    expect(result).toMatchObject({ archived: [], skipped: [], wouldArchive: [] });
  });

  it('SKIPS an execution-controller: dashboard card while the bridge is inactive', async () => {
    const { deps, calls } = recordingDeps([card(hexId(20 * DAY, 'dash0001'), 'inbox', 'codex-worker', { 'execution-controller': 'dashboard' })]);
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([]);
    expect(result.decisions[0].skipReason).toMatch(/dashboard/);
    expect(calls).toEqual([]);
  });

  it('schtasks VETO: an affirmative ONLINE probe skips the card (never archived while online)', async () => {
    const { deps, calls } = recordingDeps([card(hexId(10 * DAY, 'online01'), 'inbox', 'codex-worker')], { liveness: () => ONLINE });
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([]);
    expect(result.decisions[0].skipReason).toMatch(/ONLINE.*veto/);
    expect(calls).toEqual([]);
  });

  it('schtasks VETO-ONLY: a THROWING probe does NOT block archiving (3+4 already authorize)', async () => {
    const throwing: LivenessProbe = () => { throw new Error('schtasks boom'); };
    const { deps } = recordingDeps([card(hexId(10 * DAY, 'boom0001'), 'inbox', 'codex-worker')], { liveness: throwing });
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([hexId(10 * DAY, 'boom0001')]); // proceeds — probe is only a veto
    expect(result.decisions[0].liveness).toMatch(/probe threw/);
  });

  it('leaves the card in place when the cards.py mutation fails (fail toward NOT archiving)', async () => {
    const { deps } = recordingDeps([card(hexId(10 * DAY, 'pyfail01'), 'inbox', 'codex-worker')]);
    deps.runPy = () => ({ exitCode: 1, stdout: '', stderr: 'illegal transition' });
    const result = await archiveStrandedCards(deps);
    expect(result.archived).toEqual([]);
    expect(result.skipped).toEqual([hexId(10 * DAY, 'pyfail01')]);
    expect(result.wouldArchive).toEqual([]); // rolled back on mutation fault
  });
});

describe('archiveStrandedCards — DRY-RUN (the shipped default)', () => {
  it('defaults to dry-run: reports what it WOULD archive and MOVES nothing', async () => {
    const logged: string[] = [];
    // no dryRun override => default TRUE; use fakes that would otherwise mutate
    const { deps, calls } = recordingDeps([card(hexId(10 * DAY, 'dry00001'), 'inbox', 'codex-worker')], {
      dryRun: undefined,
      logDryRun: (d) => logged.push(d.cardId),
    });
    delete (deps as { dryRun?: boolean }).dryRun; // exercise the built-in default
    const result = await archiveStrandedCards(deps);
    expect(result.wouldArchive).toEqual([hexId(10 * DAY, 'dry00001')]);
    expect(result.archived).toEqual([]);       // nothing moved
    expect(calls).toEqual([]);                  // no prepare/py/audit/commit
    expect(logged).toEqual([hexId(10 * DAY, 'dry00001')]);
  });

  it('dry-run still applies every skip predicate (fresh owner ⇒ not even reported)', async () => {
    const { deps } = recordingDeps([card(hexId(10 * DAY, 'dryfrsh1'), 'inbox', 'claude-boss')], { dryRun: true, ownerActivity: FRESH_OWNER });
    const result = await archiveStrandedCards(deps);
    expect(result.wouldArchive).toEqual([]);
    expect(result.skipped).toEqual([hexId(10 * DAY, 'dryfrsh1')]);
  });
});

describe('DEFAULT_STRANDED_WINDOW_MS', () => {
  it('is 7 days', () => {
    expect(DEFAULT_STRANDED_WINDOW_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('startStrandedArchiver', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('is a no-op (never schedules a tick) when intervalMs <= 0 — the shipped default', () => {
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
    const stop = startStrandedArchiver({ repoRoot: '/repo', indexRepo, ownerActivity: STALE_OWNER, liveness: () => OFFLINE }, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(indexRepo).toHaveBeenCalledTimes(1);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(indexRepo).toHaveBeenCalledTimes(1);
  });

  it('swallows a sweep throw so a tick can never crash the daemon', async () => {
    vi.useFakeTimers();
    const indexRepo = vi.fn(() => { throw new Error('index boom'); });
    const stop = startStrandedArchiver({ repoRoot: '/repo', indexRepo }, 1000);
    await expect(vi.advanceTimersByTimeAsync(1000)).resolves.not.toThrow();
    stop();
  });
});

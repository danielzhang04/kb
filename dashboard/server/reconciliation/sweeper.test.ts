import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_SWEEPER_INTENTS, SWEEPER_KIND_RESERVATIONS, reconciliationIdempotencyKey } from './contracts.ts';
import type { EscalationCardIntent, SweeperPorts } from './contracts.ts';
import { runSweeper, sweeperFailureRef, sweeperSafeText } from './sweeper.ts';
import type {
  SweeperContext, SweeperEscalationDrift, SweeperMergedMirror, SweeperReadPorts, SweeperSnapshot,
} from './sweeper.ts';

const SWEEPER_SOURCE = readFileSync(new URL('./sweeper.ts', import.meta.url), 'utf8');

const CONTEXT: SweeperContext = {
  sweeperRef: 'system-sweeper/fire-2026-08-23T00:00:00Z',
  subjectRef: 'system-sweeper/kb',
  now: '2026-08-23T00:00:00Z',
  fallbackRevisions: { sourceRevision: 'src-0', storeRevision: 'store-0' },
  failureCardPath: 'queue/inbox/sweeper-failure.md',
};

function emptySnapshot(overrides: Partial<SweeperSnapshot> = {}): SweeperSnapshot {
  return {
    sourceRevision: 'src-1',
    storeRevision: 'store-1',
    cards: [],
    escalations: [],
    mirrorDrift: null,
    mergedMirrors: [],
    ...overrides,
  };
}

function ports(snapshot: SweeperSnapshot | (() => Promise<never>)): SweeperReadPorts {
  return {
    readSnapshot: typeof snapshot === 'function' ? snapshot : async () => snapshot,
  };
}

function escalation(index: number): SweeperEscalationDrift {
  return {
    source: { kind: 'run', ref: `run-${index}`, createdAt: '2026-08-22T23:00:00Z' },
    title: 'Run failed', reason: 'terminal failure', related: { runRef: `run-${index}` },
    cardPath: `queue/inbox/run-${index}.md`,
  };
}

function mergedMirror(index: number): SweeperMergedMirror {
  return {
    batchId: `batch-${index}`,
    pr: { owner: 'kb', repo: 'kb', number: index + 1, mergeCommit: String(index % 10).repeat(40) },
    mergedAt: '2026-08-22T22:00:00Z',
  };
}

function driftingCards(count: number): SweeperSnapshot['cards'] {
  return Array.from({ length: count }, (_unused, index) => ({
    cardId: `queue/inbox/card-${String(index).padStart(2, '0')}.md`,
    cardSha256: String(index % 10).repeat(64),
    fromState: 'inbox',
    toState: 'done',
  }));
}

const FULL_SNAPSHOT = emptySnapshot({
  cards: [
    { cardId: 'queue/inbox/a.md', cardSha256: 'a'.repeat(64), fromState: 'inbox', toState: 'done' },
    { cardId: 'queue/inbox/stale.md', cardSha256: null, fromState: 'inbox', toState: 'done' },
  ],
  escalations: [escalation(9)],
  mirrorDrift: {
    batchId: 'batch-1',
    targetWatermark: { revision: 7, digest: 'd'.repeat(64) },
    manifest: {
      schema: 'kb.durable-path-manifest/v1',
      operationKey: 'schedule-mirror:batch-1',
      purpose: 'schedule-mirror',
      baseCommit: 'b'.repeat(40),
      relpaths: ['HEARTBEAT.md'],
    },
  },
  mergedMirrors: [mergedMirror(0)],
});

const failing = (message = 'snapshot read failed') => ports(async () => { throw new Error(message); });

describe('read-only Sweeper', () => {
  it('holds no effect capability in its source (section 9 probe 5 must find no hits)', () => {
    const probe = /writeFile|appendFile|routeDurable|executeCardMutation|publishOpsOutbox|child_process|spawn/g;
    expect(SWEEPER_SOURCE.match(probe)).toBeNull();
  });

  it('reaches no module by a dynamic expression the static import scan cannot see', () => {
    // A dynamic module expression would be invisible to the import assertion below, so it is
    // refused outright. CAVEAT: both assertions describe THIS file. `./contracts.ts` is a runtime
    // dependency whose own graph reaches `node:crypto`, so the claim is "the Sweeper holds no
    // effect capability", not "the resolved graph is effect-free".
    expect(SWEEPER_SOURCE).not.toMatch(/\bimport\s*\(/);
    expect(SWEEPER_SOURCE).not.toMatch(/\brequire\s*\(/);
    expect(SWEEPER_SOURCE).not.toMatch(/\bcreateRequire\b/);
  });

  it('takes its only runtime import from the W0 contracts module', () => {
    const all = [...SWEEPER_SOURCE.matchAll(/\bimport(\s+type)?\s[^;]*?\bfrom\s+'([^']+)'/g)];
    const runtime = all.filter((match) => match[1] === undefined).map((match) => match[2]);
    const every = all.map((match) => match[2]);
    expect(runtime).toEqual(['./contracts.ts']);
    // Four import statements over three modules; type-only imports may reach the two other pure W0
    // contract modules and nothing else.
    expect(all).toHaveLength(4);
    expect([...new Set(every)].sort()).toEqual([
      '../schedules/mirrorContracts.ts', '../write/durableManifest.ts', './contracts.ts',
    ]);
  });

  it('admits only a readSnapshot port and collapses for every other member, effect-named or not', () => {
    type Collapses<T> = [SweeperPorts<T>] extends [never] ? true : false;
    const readOnly: Collapses<SweeperReadPorts> = false;
    const withWrite: Collapses<SweeperReadPorts & { writeFile: () => void }> = true;
    const withTransition: Collapses<SweeperReadPorts & { transition: () => void }> = true;
    // The names a blacklist of known effect members would have missed.
    const withPersist: Collapses<SweeperReadPorts & { persist: () => void }> = true;
    const withApply: Collapses<SweeperReadPorts & { applyIntent: () => void }> = true;
    const withEmit: Collapses<SweeperReadPorts & { emit: () => void }> = true;
    expect([readOnly, withWrite, withTransition, withPersist, withApply, withEmit])
      .toEqual([false, true, true, true, true, true]);
  });

  it('emits all four intent kinds with formula-correct keys and recomputed targets', async () => {
    const outcome = await runSweeper(ports(FULL_SNAPSHOT), CONTEXT);
    expect(outcome.failed).toBe(false);
    expect(outcome.truncated).toBe(false);
    expect(outcome.intents.map((intent) => intent.kind)).toEqual([
      'card-transition', 'escalation-card', 'schedule-mirror', 'mirror-merged',
    ]);
    for (const intent of outcome.intents) {
      expect(intent.idempotencyKey).toBe(reconciliationIdempotencyKey(intent));
      expect(intent.actor).toBe('system-sweeper');
      expect([...intent.exactTargets].sort()).toEqual([...intent.exactTargets]);
      expect(new Set(intent.exactTargets).size).toBe(intent.exactTargets.length);
    }
    expect(outcome.intents[0]!.exactTargets).toEqual(['queue/inbox/a.md']);
    expect(outcome.intents[1]!.exactTargets).toEqual(['queue/inbox/run-9.md']);
    expect(outcome.intents[2]!.exactTargets).toEqual(['HEARTBEAT.md']);
    expect(outcome.intents[3]!.exactTargets).toEqual([]);
  });

  it('skips a stale card whose bytes it could not pin', async () => {
    const outcome = await runSweeper(ports(FULL_SNAPSHOT), CONTEXT);
    const cardIds = outcome.intents
      .filter((intent) => intent.kind === 'card-transition')
      .map((intent) => intent.cardId);
    expect(cardIds).toEqual(['queue/inbox/a.md']);
  });

  it('fills the cap from the card tail when the other kinds do not use their reservations', async () => {
    const outcome = await runSweeper(ports(emptySnapshot({ cards: driftingCards(MAX_SWEEPER_INTENTS + 5) })), CONTEXT);
    expect(outcome.intents).toHaveLength(MAX_SWEEPER_INTENTS);
    expect(outcome.truncated).toBe(true);
  });

  it('never starves the escalation and mirror tails behind a flood of card drift', async () => {
    const snapshot = emptySnapshot({
      cards: driftingCards(200),
      escalations: [escalation(1), escalation(2)],
      mirrorDrift: FULL_SNAPSHOT.mirrorDrift,
      mergedMirrors: [mergedMirror(0)],
    });
    const outcome = await runSweeper(ports(snapshot), CONTEXT);
    const kinds = outcome.intents.map((intent) => intent.kind);
    expect(outcome.intents).toHaveLength(MAX_SWEEPER_INTENTS);
    expect(outcome.truncated).toBe(true);
    expect(kinds.filter((kind) => kind === 'escalation-card')).toHaveLength(2);
    expect(kinds.filter((kind) => kind === 'schedule-mirror')).toHaveLength(1);
    expect(kinds.filter((kind) => kind === 'mirror-merged')).toHaveLength(1);
    // Cards take their reservation plus every slot the other kinds left unused.
    expect(kinds.filter((kind) => kind === 'card-transition'))
      .toHaveLength(MAX_SWEEPER_INTENTS - 4);
  });

  it('reports no truncation at the exact per-kind boundary', async () => {
    const snapshot = emptySnapshot({
      cards: driftingCards(SWEEPER_KIND_RESERVATIONS.cards),
      escalations: [escalation(1), escalation(2), escalation(3), escalation(4)],
      mirrorDrift: FULL_SNAPSHOT.mirrorDrift,
      mergedMirrors: [mergedMirror(0), mergedMirror(1), mergedMirror(2)],
    });
    const outcome = await runSweeper(ports(snapshot), CONTEXT);
    expect(outcome.intents).toHaveLength(MAX_SWEEPER_INTENTS);
    expect(outcome.truncated).toBe(false);
    const oneMoreCard = emptySnapshot({ ...snapshot, cards: driftingCards(SWEEPER_KIND_RESERVATIONS.cards + 1) });
    const spilled = await runSweeper(ports(oneMoreCard), CONTEXT);
    expect(spilled.intents).toHaveLength(MAX_SWEEPER_INTENTS);
    expect(spilled.truncated).toBe(true);
  });

  it('deduplicates repeated drift by idempotency key', async () => {
    const card = {
      cardId: 'queue/inbox/a.md', cardSha256: 'a'.repeat(64), fromState: 'inbox', toState: 'done',
    };
    const outcome = await runSweeper(ports(emptySnapshot({ cards: [card, { ...card }] })), CONTEXT);
    expect(outcome.intents).toHaveLength(1);
    expect(outcome.truncated).toBe(false);
  });

  it('produces exactly one supervisor escalation when the read fails, and nothing else', async () => {
    const outcome = await runSweeper(failing(), CONTEXT);
    expect(outcome.failed).toBe(true);
    expect(outcome.intents).toHaveLength(1);
    const escalationIntent = outcome.intents[0] as EscalationCardIntent;
    expect(escalationIntent.kind).toBe('escalation-card');
    expect(escalationIntent.actor).toBe('dashboard-supervisor');
    expect(escalationIntent.source.kind).toBe('sweeper-failure');
    expect(escalationIntent.source.ref)
      .toBe(sweeperFailureRef(CONTEXT.subjectRef, new Error('snapshot read failed')));
    expect(escalationIntent.source.ref).toMatch(/^[0-9a-f]{64}$/);
    expect(escalationIntent.idempotencyKey).toBe(`escalation:sweeper-failure:${escalationIntent.source.ref}`);
    expect(escalationIntent.exactTargets).toEqual([CONTEXT.failureCardPath]);
    // The per-fire reference is NOT the dedup identity and never reaches the key.
    expect(escalationIntent.idempotencyKey).not.toContain(CONTEXT.sweeperRef);
  });

  it('gives one key across three fires of a flapping Sweeper, with new fire refs and clocks', async () => {
    const fires = await Promise.all([
      runSweeper(failing(), CONTEXT),
      runSweeper(failing(), { ...CONTEXT, sweeperRef: 'system-sweeper/fire-2', now: '2026-08-23T00:15:00Z' }),
      runSweeper(failing(), { ...CONTEXT, sweeperRef: 'system-sweeper/fire-3', now: '2026-08-23T00:30:00Z' }),
    ]);
    const keys = new Set(fires.map((fire) => fire.intents[0]!.idempotencyKey));
    expect(keys.size).toBe(1);
  });

  it('holds the failure key stable across the variable runs inside one failure class', async () => {
    const first = await runSweeper(failing('read failed after 3 attempts at 12:04:11'), CONTEXT);
    const second = await runSweeper(failing('read failed after 11 attempts at 12:39:02'), CONTEXT);
    expect(second.intents[0]!.idempotencyKey).toBe(first.intents[0]!.idempotencyKey);
  });

  it('separates a different failure class onto its own escalation', async () => {
    const read = await runSweeper(failing('snapshot read failed'), CONTEXT);
    const parse = await runSweeper(failing('store revision could not be parsed'), CONTEXT);
    expect(parse.intents[0]!.idempotencyKey).not.toBe(read.intents[0]!.idempotencyKey);
    const otherSubject = await runSweeper(failing('snapshot read failed'), { ...CONTEXT, subjectRef: 'system-sweeper/other' });
    expect(otherSubject.intents[0]!.idempotencyKey).not.toBe(read.intents[0]!.idempotencyKey);
  });

  it('scrubs credential shapes out of the free-form fields at intent construction', async () => {
    const tokenized = await runSweeper(
      failing('fatal: unable to access https://x-access-token:ghp_0123456789abcdefghij@github.com/kb/kb.git'),
      CONTEXT,
    );
    const failureIntent = tokenized.intents[0] as EscalationCardIntent;
    expect(failureIntent.reason).not.toContain('ghp_0123456789abcdefghij');
    expect(failureIntent.reason).toContain('[redacted]');

    const outcome = await runSweeper(ports(emptySnapshot({
      escalations: [{
        ...escalation(9),
        title: 'Run failed with Bearer abcdefghijklmnopqrstuvwx',
        reason: 'worker log:\n  ANTHROPIC key api_key=sk-ant-0123456789abcdefghij\n  exit 1',
      }],
    })), CONTEXT);
    const scrubbed = outcome.intents[0] as EscalationCardIntent;
    expect(scrubbed.reason).not.toContain('sk-ant-0123456789abcdefghij');
    expect(scrubbed.title).not.toContain('abcdefghijklmnopqrstuvwx');
    // Bounded to a single line, so a multi-line log cannot restructure the card body.
    expect(scrubbed.reason).not.toContain('\n');
  });

  it('bounds a free-form field to one line and a fixed length', () => {
    const long = sweeperSafeText(`${'x'.repeat(900)}\nsecond line`);
    expect(long).not.toContain('\n');
    expect(long.length).toBeLessThanOrEqual(501);
  });
});

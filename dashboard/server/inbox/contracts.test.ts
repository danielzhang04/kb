import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractDecodeError } from '../write/durableManifest.ts';
import {
  compareInboxItems, decodeInboxItem, decodeInboxRefreshParam, decodeInboxResponse, decodeSourceState,
  escalationSubjectKeyString,
  ghPrListArgv, inboxItemId, inboxRevision, isLegalEmptyInbox, PR_LIST_TIMEOUT_MS, PR_POLL_INTERVAL_MS,
  PR_REFRESH_BUDGET_MS, prHref, prSubjectKeyString, runSourceKey, stopSourceKey,
} from './contracts.ts';
import type { InboxResponse, P4InboxItem } from './contracts.ts';

interface VectorCase { readonly name: string; readonly field?: string; readonly value: unknown }
interface ContractVectors {
  readonly inbox: {
    readonly valid: readonly VectorCase[];
    readonly invalid: readonly VectorCase[];
    readonly refreshParams: { readonly accept: readonly string[]; readonly refuse: readonly string[] };
  };
}
const vectors = JSON.parse(readFileSync(
  new URL('../../../tests/fixtures/dashboard-v3-p4-contract-vectors.json', import.meta.url),
  'utf8',
)) as ContractVectors;

describe('P4 inbox union', () => {
  for (const vector of vectors.inbox.valid) {
    it(`decodes ${vector.name}`, () => {
      const response = decodeInboxResponse(vector.value);
      expect(response).toEqual(vector.value);
      expect(response.revision).toBe(inboxRevision(response.sources, response.items));
      for (const item of response.items) expect(['pr', 'escalation']).toContain(item.kind);
    });
  }

  for (const vector of vectors.inbox.invalid) {
    it(`refuses ${vector.name}`, () => {
      expect(() => decodeInboxResponse(vector.value)).toThrow(ContractDecodeError);
    });
  }

  it('rebuilds the PR href from the pinned subject and derives ids by formula', () => {
    const subject = { owner: 'DanielZT', repo: 'KB', number: 42 };
    expect(prHref(subject)).toBe('https://github.com/DanielZT/KB/pull/42');
    expect(prSubjectKeyString(subject)).toBe('danielzt/kb#42');
    expect(inboxItemId('pr', prSubjectKeyString(subject)))
      .toBe(inboxItemId('pr', prSubjectKeyString({ owner: 'danielzt', repo: 'kb', number: 42 })));
    expect(escalationSubjectKeyString('queue/inbox/a.md')).toBe('queue/inbox/a.md');
  });

  it('pins the literal gh read command [P4-C25] and the global budget [P4-C34]', () => {
    expect([...ghPrListArgv('danielzt', 'kb')])
      .toEqual([
        'pr', 'list', '--repo', 'danielzt/kb', '--state', 'open', '--limit', '101',
        '--json', 'number,title,createdAt',
      ]);
    expect(PR_LIST_TIMEOUT_MS).toBe(15_000);
    expect(PR_REFRESH_BUDGET_MS).toBe(30_000);
    expect(PR_POLL_INTERVAL_MS).toBe(60_000);
  });

  it('accepts the verified arm with stale present or absent, and only as literal true', () => {
    const fresh = { status: 'verified', revision: 'a'.repeat(64), verifiedAt: '2026-08-22T10:00:05Z' };
    expect(decodeSourceState(fresh)).toEqual(fresh);
    expect(decodeSourceState({ ...fresh, stale: true })).toEqual({ ...fresh, stale: true });
    expect(() => decodeSourceState({ ...fresh, stale: false })).toThrow(ContractDecodeError);
    expect(() => decodeSourceState({ ...fresh, stale: 'yes' })).toThrow(ContractDecodeError);
    // `stale` appends to the canonical string, so it changes the revision it feeds.
    const sources = { pr: decodeSourceState(fresh), escalation: decodeSourceState(fresh) };
    const staleSources = { pr: decodeSourceState({ ...fresh, stale: true }), escalation: sources.escalation };
    expect(inboxRevision(staleSources, [])).not.toBe(inboxRevision(sources, []));
  });

  it('sorts by createdAt desc, then kind, then id', () => {
    const response = decodeInboxResponse(vectors.inbox.valid[0]!.value);
    const shuffled = [...response.items].reverse().sort(compareInboxItems);
    expect(shuffled.map((item) => item.id)).toEqual(response.items.map((item) => item.id));
  });

  it('keeps runs and STOP as resolver source keys, never subjects', () => {
    expect(runSourceKey('run-4f2c')).toBe('run:run-4f2c');
    expect(stopSourceKey('a'.repeat(64))).toBe(`stop:${'a'.repeat(64)}`);
    expect(() => stopSourceKey('not-a-digest')).toThrow(ContractDecodeError);
    expect(() => decodeInboxItem({ kind: 'run', id: 'x', createdAt: 'y', revision: 'z' })).toThrow(ContractDecodeError);
  });

  it('allows an empty inbox only when both sources are freshly verified', () => {
    const empty = decodeInboxResponse(vectors.inbox.valid[2]!.value);
    const stale = decodeInboxResponse(vectors.inbox.valid[1]!.value);
    expect(isLegalEmptyInbox(empty)).toBe(true);
    expect(isLegalEmptyInbox({ ...stale, items: [] } as InboxResponse)).toBe(false);
    expect(stale.sources.pr.status).toBe('failed');
    expect(stale.items.length).toBe(1);
  });

  it('accepts only pr|escalation on ?refresh', () => {
    for (const accepted of vectors.inbox.refreshParams.accept) {
      expect(decodeInboxRefreshParam(accepted)).toBe(accepted);
    }
    for (const refused of vectors.inbox.refreshParams.refuse) {
      expect(() => decodeInboxRefreshParam(refused)).toThrow(ContractDecodeError);
    }
    expect(decodeInboxRefreshParam(undefined)).toBeNull();
  });
});

describe('compile negatives', () => {
  it('refuses a run subject at compile time', () => {
    // @ts-expect-error - 'run' is not a member of the P4 Inbox union; runs resolve in Run view.
    const kind: P4InboxItem['kind'] = 'run';
    const runShaped: unknown = {
      kind, id: 'x', createdAt: '2026-08-22T10:00:00Z', revision: 'r',
      subject: { runRef: 'run-4f2c' }, title: 'waiting run',
    };
    expect(() => decodeInboxItem(runShaped)).toThrow(ContractDecodeError);
  });

  it('has no read, snooze, archive, or retention member on the response', () => {
    const response = decodeInboxResponse(vectors.inbox.valid[0]!.value);
    expect(Object.keys(response).sort()).toEqual(['items', 'revision', 'sources']);
  });
});

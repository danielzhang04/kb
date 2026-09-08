import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AtomicJsonDocumentOptions } from './atomicJsonDocument.ts';

const atomicFault = vi.hoisted(() => ({ throwAfterMutation: false }));

vi.mock('./atomicJsonDocument.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./atomicJsonDocument.ts')>();
  return {
    ...actual,
    createAtomicJsonDocument<T>(options: AtomicJsonDocumentOptions<T>) {
      const document = actual.createAtomicJsonDocument(options);
      return {
        read: () => document.read(),
        async mutate<R>(callback: (value: T) => R | Promise<R>): Promise<R> {
          const result = await document.mutate(callback);
          if (atomicFault.throwAfterMutation) {
            atomicFault.throwAfterMutation = false;
            throw undefined;
          }
          return result;
        },
      };
    },
  };
});

import {
  AgentSessionChainStoreError,
  createAgentSessionChainStore,
  MAX_OPERATOR_MESSAGE_CHARS,
  type ClaimMessagesResult,
  type MessageClaimCas,
} from './agentSessionChains.ts';

const DECLARATION = 'a'.repeat(64);
const OTHER_DECLARATION = 'b'.repeat(64);
const PROMPT = 'c'.repeat(64);
const OTHER_PROMPT = 'd'.repeat(64);
const RUN_REF = 'run-1';
const AGENT_ID = 'agent-1';
const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-session-chains-'));
  roots.push(root);
  return root;
}

function documentPath(root: string, runRef = RUN_REF): string {
  return join(root, 'control', 'agent-session-chains', `${runRef}.json`);
}

function writeDocument(root: string, document: unknown): void {
  mkdirSync(join(root, 'control', 'agent-session-chains'), { recursive: true });
  writeFileSync(documentPath(root), `${JSON.stringify(document)}\n`, 'utf8');
}

function readDocument(root: string): Record<string, unknown> {
  return JSON.parse(readFileSync(documentPath(root), 'utf8')) as Record<string, unknown>;
}

function created(result: ClaimMessagesResult): Extract<ClaimMessagesResult, { disposition: 'created' }> {
  expect(result.disposition).toBe('created');
  if (result.disposition !== 'created') throw new Error('expected claim creator');
  return result;
}

function cas(
  result: Extract<ClaimMessagesResult, { disposition: 'created' }>,
  overrides: Partial<MessageClaimCas> = {},
): MessageClaimCas {
  return {
    runRef: RUN_REF,
    agentId: AGENT_ID,
    operationKey: result.claim.operationKey,
    claimRef: result.claim.claimRef,
    declarationFingerprint: result.claim.declarationFingerprint,
    promptFingerprint: result.claim.promptFingerprint,
    creatorHandle: result.creatorHandle,
    expectedRevision: result.claim.revision,
    ...overrides,
  };
}

async function expectClaimConflict(promise: Promise<unknown>): Promise<void> {
  await expect(promise).rejects.toMatchObject({
    code: 'claim-conflict',
    message: 'message claim transition was refused',
  });
}

afterEach(() => {
  atomicFault.throwAfterMutation = false;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('AgentSessionChainStore', () => {
  it('returns null when no chain has been recorded', () => {
    const store = createAgentSessionChainStore(temporaryRoot());

    expect(store.get('run-1', 'agent-1')).toBeNull();
  });

  it('persists and retrieves an opaque runtime session id', async () => {
    const store = createAgentSessionChainStore(temporaryRoot());

    await store.record('run-1', 'agent-1', { runtime: 'codex', sessionId: '0198-thread/opaque:id' });

    expect(store.get('run-1', 'agent-1')).toMatchObject({
      runtime: 'codex',
      sessionId: '0198-thread/opaque:id',
      updatedAt: expect.any(String),
    });
  });

  it('overwrites a chain and advances its update timestamp when re-recorded', async () => {
    const store = createAgentSessionChainStore(temporaryRoot());
    await store.record('run-1', 'agent-1', { runtime: 'claude', sessionId: 'first' });
    const first = store.get('run-1', 'agent-1');

    await store.record('run-1', 'agent-1', { runtime: 'codex', sessionId: 'second' });

    expect(store.get('run-1', 'agent-1')).toEqual({
      runtime: 'codex',
      sessionId: 'second',
      updatedAt: expect.any(String),
    });
    expect(Date.parse(store.get('run-1', 'agent-1')!.updatedAt)).toBeGreaterThan(Date.parse(first!.updatedAt));
  });

  it('isolates entries in separate run documents', async () => {
    const root = temporaryRoot();
    const store = createAgentSessionChainStore(root);
    await store.record('run-1', 'agent-1', { runtime: 'claude', sessionId: 'session-one' });
    await store.record('run-2', 'agent-1', { runtime: 'codex', sessionId: 'thread-two' });

    expect(store.get('run-1', 'agent-1')).toMatchObject({ runtime: 'claude', sessionId: 'session-one' });
    expect(store.get('run-2', 'agent-1')).toMatchObject({ runtime: 'codex', sessionId: 'thread-two' });
    expect(existsSync(documentPath(root, 'run-1'))).toBe(true);
    expect(existsSync(documentPath(root, 'run-2'))).toBe(true);
  });

  it('fails closed when an existing document contains corrupt JSON', () => {
    const root = temporaryRoot();
    mkdirSync(join(root, 'control', 'agent-session-chains'), { recursive: true });
    writeFileSync(documentPath(root, 'run-1'), '{not json');
    const store = createAgentSessionChainStore(root);

    expect(() => store.get('run-1', 'agent-1')).toThrow(AgentSessionChainStoreError);
  });

  it('serializes concurrent writes from stores sharing one run document', async () => {
    const root = temporaryRoot();
    const first = createAgentSessionChainStore(root);
    const second = createAgentSessionChainStore(root);

    await Promise.all([
      first.record('run-1', 'agent-1', { runtime: 'claude', sessionId: 'claude-session' }),
      second.record('run-1', 'agent-2', { runtime: 'codex', sessionId: 'codex-thread' }),
    ]);

    const reopened = createAgentSessionChainStore(root);
    expect(reopened.get('run-1', 'agent-1')).toMatchObject({ runtime: 'claude', sessionId: 'claude-session' });
    expect(reopened.get('run-1', 'agent-2')).toMatchObject({ runtime: 'codex', sessionId: 'codex-thread' });
  });

  it('durably queues and atomically drains operator messages per agent', async () => {
    const root = temporaryRoot();
    const first = createAgentSessionChainStore(root);
    const second = createAgentSessionChainStore(root);

    await Promise.all([
      first.queueMessage('run-1', 'agent-1', 'Inspect the generated artifact.'),
      second.queueMessage('run-1', 'agent-1', 'Then report only the blocker.'),
      second.queueMessage('run-1', 'agent-2', 'Independent agent message.'),
    ]);

    expect(await first.drainMessages('run-1', 'agent-1')).toEqual([
      'Inspect the generated artifact.',
      'Then report only the blocker.',
    ]);
    expect(await second.drainMessages('run-1', 'agent-1')).toEqual([]);
    expect(await second.drainMessages('run-1', 'agent-2')).toEqual(['Independent agent message.']);
  });

  it('rejects extra document keys instead of interpreting a changed schema', () => {
    const root = temporaryRoot();
    writeDocument(root, {
      schema: 'kb.agent-session-chains/v2',
      chains: {},
      messages: {},
      claims: {},
      nextMessageOrdinal: 0,
      unexpected: true,
    });

    expect(() => createAgentSessionChainStore(root).get(RUN_REF, AGENT_ID))
      .toThrow(AgentSessionChainStoreError);
  });

  it('reads v1 without rewriting, then migrates duplicate text deterministically on the first mutation', async () => {
    const legacyRoots = [temporaryRoot(), temporaryRoot()];
    const refs: string[][] = [];
    for (const root of legacyRoots) {
      writeDocument(root, {
        schema: 'kb.agent-session-chains/v1',
        chains: { [AGENT_ID]: { runtime: 'claude', sessionId: 'legacy', updatedAt: '2026-09-08T00:00:00.000Z' } },
        messages: { [AGENT_ID]: ['repeat', 'repeat'] },
      });
      const store = createAgentSessionChainStore(root);
      expect(store.get(RUN_REF, AGENT_ID)).toMatchObject({ sessionId: 'legacy' });
      expect(readDocument(root).schema).toBe('kb.agent-session-chains/v1');

      const claim = created(await store.claimMessages(RUN_REF, AGENT_ID, 'operation-legacy', DECLARATION));
      refs.push(claim.claim.messageRefs);
      expect(claim.claim.messages.map((message) => message.ordinal)).toEqual([0, 1]);
      expect(new Set(claim.claim.messageRefs).size).toBe(2);
      expect(readDocument(root).schema).toBe('kb.agent-session-chains/v2');
    }
    expect(refs[0]).toEqual(refs[1]);
  });

  it('creates one owner across stores and deeply redacts the observer result', async () => {
    const root = temporaryRoot();
    const first = createAgentSessionChainStore(root);
    const second = createAgentSessionChainStore(root);
    await first.queueMessage(RUN_REF, AGENT_ID, 'secret operator text');

    const results = await Promise.all([
      first.claimMessages(RUN_REF, AGENT_ID, 'operation-race', DECLARATION),
      second.claimMessages(RUN_REF, AGENT_ID, 'operation-race', DECLARATION),
    ]);
    const owner = results.find((result) => result.disposition === 'created');
    const observer = results.find((result) => result.disposition === 'observed');
    expect(owner?.disposition).toBe('created');
    expect(observer?.disposition).toBe('observed');
    if (owner?.disposition !== 'created' || observer?.disposition !== 'observed') throw new Error('bad race result');

    expect(observer.claim).toEqual(owner.claim);
    expect('creatorHandle' in observer).toBe(false);
    expect(JSON.stringify(observer)).not.toContain('ownerHandleHash');
    const persisted = JSON.stringify(readDocument(root));
    expect(persisted).not.toContain(owner.creatorHandle);
    expect(persisted).toContain('ownerHandleHash');
  });

  it('treats a lost creator result as observer-only and refuses stored-hash takeover', async () => {
    const root = temporaryRoot();
    const first = createAgentSessionChainStore(root);
    const lost = created(await first.claimMessages(RUN_REF, AGENT_ID, 'operation-lost-result', DECLARATION));
    const reopened = createAgentSessionChainStore(root);
    const observed = await reopened.claimMessages(RUN_REF, AGENT_ID, 'operation-lost-result', DECLARATION);
    expect(observed.disposition).toBe('observed');
    if (observed.disposition !== 'observed') throw new Error('expected observer');
    const storedHash = (readDocument(root).claims as Record<string, Record<string, unknown>>)
      ['operation-lost-result']!.ownerHandleHash as string;

    await expectClaimConflict(reopened.bindPromptFingerprint({
      ...cas(lost),
      creatorHandle: storedHash,
      promptFingerprint: PROMPT,
    }));
    expect(observed.claim.state).toBe('claimed');
  });

  it('returns no creator authority when creation lands before a falsey transport failure', async () => {
    const root = temporaryRoot();
    const store = createAgentSessionChainStore(root);
    await store.queueMessage(RUN_REF, AGENT_ID, 'claimed before failure');
    atomicFault.throwAfterMutation = true;

    await expect(store.claimMessages(RUN_REF, AGENT_ID, 'operation-landed-create', DECLARATION))
      .rejects.toMatchObject({ code: 'document-unavailable' });
    await createAgentSessionChainStore(root).queueMessage(RUN_REF, AGENT_ID, 'queued after failure');
    const observed = await createAgentSessionChainStore(root)
      .claimMessages(RUN_REF, AGENT_ID, 'operation-landed-create', DECLARATION);

    expect(observed).toMatchObject({
      disposition: 'observed',
      claim: { state: 'claimed', messages: [{ text: 'claimed before failure' }] },
    });
    expect('creatorHandle' in observed).toBe(false);
    expect(await store.drainMessages(RUN_REF, AGENT_ID)).toEqual(['queued after failure']);
  });

  it('keeps a release that landed before a falsey failure and never restores twice', async () => {
    const root = temporaryRoot();
    const store = createAgentSessionChainStore(root);
    await store.queueMessage(RUN_REF, AGENT_ID, 'restore exactly once');
    const owner = created(await store.claimMessages(RUN_REF, AGENT_ID, 'operation-landed-release', DECLARATION));
    atomicFault.throwAfterMutation = true;

    await expect(store.releasePrewrite(cas(owner))).rejects.toMatchObject({ code: 'document-unavailable' });
    const observed = await createAgentSessionChainStore(root)
      .claimMessages(RUN_REF, AGENT_ID, 'operation-landed-release', DECLARATION);
    expect(observed).toMatchObject({ disposition: 'observed', claim: { state: 'released', messages: [] } });
    await expectClaimConflict(store.releasePrewrite(cas(owner)));
    expect(await store.drainMessages(RUN_REF, AGENT_ID)).toEqual(['restore exactly once']);
    expect(await store.drainMessages(RUN_REF, AGENT_ID)).toEqual([]);
  });

  it('requires the exact owner, identities, fingerprint, revision, and state for every transition', async () => {
    const store = createAgentSessionChainStore(temporaryRoot());
    const owner = created(await store.claimMessages(RUN_REF, AGENT_ID, 'operation-cas', DECLARATION));

    await expectClaimConflict(store.bindPromptFingerprint({
      ...cas(owner), creatorHandle: 'wrong-handle-value', promptFingerprint: PROMPT,
    }));
    await expectClaimConflict(store.bindPromptFingerprint({
      ...cas(owner), declarationFingerprint: OTHER_DECLARATION, promptFingerprint: PROMPT,
    }));
    await expectClaimConflict(store.bindPromptFingerprint({
      ...cas(owner), claimRef: 'claim-wrong-reference', promptFingerprint: PROMPT,
    }));
    await expectClaimConflict(store.bindPromptFingerprint({
      ...cas(owner), expectedRevision: 2, promptFingerprint: PROMPT,
    }));
    const promptBound = await store.bindPromptFingerprint({ ...cas(owner), promptFingerprint: PROMPT });
    expect(promptBound).toMatchObject({ state: 'prompt-bound', revision: 2, promptFingerprint: PROMPT });

    await expectClaimConflict(store.admitPtyBind({
      ...cas(owner, { expectedRevision: 2, promptFingerprint: OTHER_PROMPT }), promptFingerprint: OTHER_PROMPT,
    }));
    const admitted = await store.admitPtyBind({
      ...cas(owner, { expectedRevision: 2, promptFingerprint: PROMPT }), promptFingerprint: PROMPT,
    });
    const bound = await store.markPtyBound({
      ...cas(owner, { expectedRevision: admitted.revision, promptFingerprint: PROMPT }),
      promptFingerprint: PROMPT,
      ptyOperationRevision: 7,
    });
    const intent = await store.recordWriteIntent({
      ...cas(owner, { expectedRevision: bound.revision, promptFingerprint: PROMPT }), promptFingerprint: PROMPT,
    });
    const acknowledged = await store.ackClaim({
      ...cas(owner, { expectedRevision: intent.revision, promptFingerprint: PROMPT }), promptFingerprint: PROMPT,
    });
    expect(acknowledged).toMatchObject({ state: 'acknowledged', revision: 6, messages: [] });
    expect(acknowledged.messageRefs).toEqual(owner.claim.messageRefs);
    await expectClaimConflict(store.releasePrewrite(cas(owner, {
      expectedRevision: acknowledged.revision,
      promptFingerprint: PROMPT,
    })));
  });

  it('restores independently claimed messages by their original global ordinal', async () => {
    const store = createAgentSessionChainStore(temporaryRoot());
    await store.queueMessage(RUN_REF, AGENT_ID, 'first');
    const first = created(await store.claimMessages(RUN_REF, AGENT_ID, 'operation-first', DECLARATION));
    await store.queueMessage(RUN_REF, AGENT_ID, 'second');
    const second = created(await store.claimMessages(RUN_REF, AGENT_ID, 'operation-second', DECLARATION));
    await store.queueMessage(RUN_REF, AGENT_ID, 'third');

    await store.releasePrewrite(cas(second));
    await store.releasePrewrite(cas(first));

    expect(await store.drainMessages(RUN_REF, AGENT_ID)).toEqual(['first', 'second', 'third']);
  });

  it('makes pre-write release and write admission compete on one durable revision', async () => {
    const root = temporaryRoot();
    const ownerStore = createAgentSessionChainStore(root);
    const competingStore = createAgentSessionChainStore(root);
    await ownerStore.queueMessage(RUN_REF, AGENT_ID, 'claimed');
    const owner = created(await ownerStore.claimMessages(RUN_REF, AGENT_ID, 'operation-release-write', DECLARATION));
    const promptBound = await ownerStore.bindPromptFingerprint({ ...cas(owner), promptFingerprint: PROMPT });
    const admitted = await ownerStore.admitPtyBind({
      ...cas(owner, { expectedRevision: promptBound.revision, promptFingerprint: PROMPT }), promptFingerprint: PROMPT,
    });
    const bound = await ownerStore.markPtyBound({
      ...cas(owner, { expectedRevision: admitted.revision, promptFingerprint: PROMPT }),
      promptFingerprint: PROMPT,
      ptyOperationRevision: 3,
    });
    await ownerStore.queueMessage(RUN_REF, AGENT_ID, 'later');
    const input = cas(owner, { expectedRevision: bound.revision, promptFingerprint: PROMPT });

    const outcomes = await Promise.allSettled([
      ownerStore.releasePrewrite(input),
      competingStore.recordWriteIntent({ ...input, promptFingerprint: PROMPT }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    const rejection = outcomes.find((outcome) => outcome.status === 'rejected');
    expect(rejection).toMatchObject({ status: 'rejected', reason: { code: 'claim-conflict' } });
    const current = await ownerStore.claimMessages(RUN_REF, AGENT_ID, 'operation-release-write', DECLARATION);
    expect(current.disposition).toBe('observed');
    if (current.disposition !== 'observed') throw new Error('expected observer');
    if (current.claim.state === 'released') {
      expect(await ownerStore.drainMessages(RUN_REF, AGENT_ID)).toEqual(['claimed', 'later']);
    } else {
      expect(current.claim.state).toBe('write-intent');
      expect(await ownerStore.drainMessages(RUN_REF, AGENT_ID)).toEqual(['later']);
    }
  });

  it('keeps empty and acknowledged claims from acquiring messages queued later', async () => {
    const store = createAgentSessionChainStore(temporaryRoot());
    const empty = created(await store.claimMessages(RUN_REF, AGENT_ID, 'operation-empty', DECLARATION));
    expect(empty.claim.messages).toEqual([]);
    await store.queueMessage(RUN_REF, AGENT_ID, 'later');

    const repeated = await store.claimMessages(RUN_REF, AGENT_ID, 'operation-empty', DECLARATION);
    expect(repeated).toMatchObject({ disposition: 'observed', claim: { messageRefs: [], messages: [] } });
    await store.releasePrewrite(cas(empty));
    expect(await store.drainMessages(RUN_REF, AGENT_ID)).toEqual(['later']);

    await store.queueMessage(RUN_REF, AGENT_ID, 'consumed');
    const completed = created(await store.claimMessages(RUN_REF, AGENT_ID, 'operation-completed', DECLARATION));
    const promptBound = await store.bindPromptFingerprint({ ...cas(completed), promptFingerprint: PROMPT });
    const admitted = await store.admitPtyBind({
      ...cas(completed, { expectedRevision: promptBound.revision, promptFingerprint: PROMPT }), promptFingerprint: PROMPT,
    });
    const bound = await store.markPtyBound({
      ...cas(completed, { expectedRevision: admitted.revision, promptFingerprint: PROMPT }),
      promptFingerprint: PROMPT,
      ptyOperationRevision: 1,
    });
    const intent = await store.recordWriteIntent({
      ...cas(completed, { expectedRevision: bound.revision, promptFingerprint: PROMPT }), promptFingerprint: PROMPT,
    });
    await store.ackClaim({
      ...cas(completed, { expectedRevision: intent.revision, promptFingerprint: PROMPT }), promptFingerprint: PROMPT,
    });
    await store.queueMessage(RUN_REF, AGENT_ID, 'after acknowledgement');
    const observed = await store.claimMessages(RUN_REF, AGENT_ID, 'operation-completed', DECLARATION);
    expect(observed).toMatchObject({ disposition: 'observed', claim: { state: 'acknowledged', messages: [] } });
    expect(await store.drainMessages(RUN_REF, AGENT_ID)).toEqual(['after acknowledgement']);
  });

  it('fails closed at the document bound without evicting a terminal tombstone', async () => {
    const root = temporaryRoot();
    const store = createAgentSessionChainStore(root);
    const terminal = created(await store.claimMessages(RUN_REF, AGENT_ID, 'operation-terminal', DECLARATION));
    await store.releasePrewrite(cas(terminal));

    let refusal: unknown = null;
    for (let index = 0; index < 20 && refusal === null; index += 1) {
      try {
        await store.queueMessage(RUN_REF, AGENT_ID, 'x'.repeat(MAX_OPERATOR_MESSAGE_CHARS));
      } catch (error) {
        refusal = error;
      }
    }
    expect(refusal).toBeInstanceOf(AgentSessionChainStoreError);
    const observed = await createAgentSessionChainStore(root)
      .claimMessages(RUN_REF, AGENT_ID, 'operation-terminal', DECLARATION);
    expect(observed).toMatchObject({ disposition: 'observed', claim: { state: 'released' } });
  });
});

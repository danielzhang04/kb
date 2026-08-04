import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentSessionChainStoreError,
  createAgentSessionChainStore,
} from './agentSessionChains.ts';

const roots: string[] = [];

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'agent-session-chains-'));
  roots.push(root);
  return root;
}

function documentPath(root: string, runRef: string): string {
  return join(root, 'control', 'agent-session-chains', `${runRef}.json`);
}

afterEach(() => {
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
});

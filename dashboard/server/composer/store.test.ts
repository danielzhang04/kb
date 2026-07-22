import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProviderIdProtector } from './protector.ts';
import {
  createFileComposerStore,
  createInMemoryComposerStore,
  resolveDashboardStateRoot,
} from './store.ts';

const SECRET = Buffer.from('composer-store-secret-0123456789');
const PROVIDER_ID = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const MODEL = {
  turns: [{ index: 0, model: 'claude-sonnet-5', timestamp: null, usage: null, steps: [{ kind: 'text' as const, text: 'answer' }] }],
};

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function memoryStore() {
  return createInMemoryComposerStore({ protector: createProviderIdProtector(SECRET) });
}

describe('ComposerWorkspaceStore authorization and lifecycle', () => {
  it('uses opaque refs, subject-bound lookup/list, and an allowlisted public DTO', () => {
    const store = memoryStore();
    const created = store.create('alice', 'Atlas idea');
    expect(created.composerRef).toMatch(/^[0-9a-f-]{36}$/i);
    expect(created).toEqual({
      composerRef: created.composerRef,
      title: 'Atlas idea',
      state: 'open',
      sourceComposerRef: null,
      createdAt: expect.any(String),
      updatedAt: expect.any(String),
      agent: null,
      turns: [],
    });
    expect(JSON.stringify(created)).not.toContain('alice');
    expect(store.get('bob', created.composerRef)).toEqual({ ok: false, reason: 'not-found' });
    expect(store.list('bob')).toEqual([]);
    expect(store.list('alice')).toHaveLength(1);
  });

  it('allows one writer per workspace while separate workspaces run concurrently', () => {
    const store = memoryStore();
    const a = store.create('alice');
    const b = store.create('alice');
    const leaseA = store.acquireWriter('alice', a.composerRef);
    expect(leaseA.ok).toBe(true);
    expect(store.acquireWriter('alice', a.composerRef)).toEqual({ ok: false, reason: 'busy' });
    expect(store.acquireWriter('alice', b.composerRef).ok).toBe(true);
    expect(store.fork('alice', a.composerRef)).toEqual({ ok: false, reason: 'busy' });
    expect(store.archive('alice', a.composerRef)).toEqual({ ok: false, reason: 'busy' });
    if (leaseA.ok) store.releaseWriter('alice', a.composerRef, leaseA.lease);
    expect(store.archive('alice', a.composerRef).ok).toBe(true);
  });

  it('persists prompt/final model/status and makes archive reversible without deleting history', () => {
    const store = memoryStore();
    const workspace = store.create('alice');
    const acquired = store.acquireWriter('alice', workspace.composerRef);
    expect(acquired.ok).toBe(true);
    if (!acquired.ok) return;
    const begun = store.beginTurn('alice', workspace.composerRef, acquired.lease, 'research this');
    expect(begun.ok).toBe(true);
    if (!begun.ok) return;
    expect(store.updateTurn('alice', workspace.composerRef, acquired.lease, begun.workspace.turnId, {
      state: 'complete',
      model: MODEL,
      error: null,
      endedAt: new Date().toISOString(),
    })).toBe(true);
    store.releaseWriter('alice', workspace.composerRef, acquired.lease);

    const archived = store.archive('alice', workspace.composerRef);
    expect(archived.ok && archived.workspace.state).toBe('archived');
    expect(archived.ok && archived.workspace.turns[0]).toMatchObject({
      prompt: 'research this',
      state: 'complete',
      model: MODEL,
    });
    const restored = store.restore('alice', workspace.composerRef);
    expect(restored.ok && restored.workspace.state).toBe('open');
    expect(restored.ok && restored.workspace.turns).toEqual(archived.ok ? archived.workspace.turns : []);
  });

  it('forks public history under a new ref without sharing the mutable provider handle', () => {
    const store = memoryStore();
    const agent = {
      id: 'research-worker', path: 'agents/research-worker.md', sourceHash: 'a'.repeat(64),
      instructionMarkdown: 'Use the immutable research declaration.',
    };
    const source = store.create('alice', 'Source', agent);
    const sourceLease = store.acquireWriter('alice', source.composerRef);
    if (!sourceLease.ok) throw new Error('lease');
    store.setProviderId('alice', source.composerRef, sourceLease.lease, PROVIDER_ID);
    store.releaseWriter('alice', source.composerRef, sourceLease.lease);

    const fork = store.fork('alice', source.composerRef);
    expect(fork.ok).toBe(true);
    if (!fork.ok) return;
    expect(fork.workspace.composerRef).not.toBe(source.composerRef);
    expect(fork.workspace.sourceComposerRef).toBe(source.composerRef);
    expect(fork.workspace.agent).toEqual({ id: agent.id, path: agent.path, sourceHash: agent.sourceHash, projects: [] });
    expect(JSON.stringify(fork.workspace)).not.toContain(agent.instructionMarkdown);
    const forkLease = store.acquireWriter('alice', fork.workspace.composerRef);
    expect(forkLease.ok && forkLease.providerId).toBeNull();
    expect(forkLease.ok && forkLease.agent).toEqual(agent);
  });
});

describe('file-backed ComposerWorkspaceStore', () => {
  it('survives a store/daemon restart and never writes the provider id in plaintext', () => {
    const root = mkdtempSync(join(tmpdir(), 'composer-store-'));
    roots.push(root);
    const protector = createProviderIdProtector(SECRET);
    const first = createFileComposerStore(root, { protector });
    const agent = {
      id: 'research-worker', path: 'agents/research-worker.md', sourceHash: 'b'.repeat(64),
      instructionMarkdown: 'Persist this immutable declaration.',
    };
    const workspace = first.create('alice', 'Persistent', agent);
    const lease = first.acquireWriter('alice', workspace.composerRef);
    if (!lease.ok) throw new Error('lease');
    const begun = first.beginTurn('alice', workspace.composerRef, lease.lease, 'persist me');
    if (!begun.ok) throw new Error('turn');
    first.setProviderId('alice', workspace.composerRef, lease.lease, PROVIDER_ID);
    first.updateTurn('alice', workspace.composerRef, lease.lease, begun.workspace.turnId, {
      state: 'complete', model: MODEL, error: null, endedAt: new Date().toISOString(),
    });
    first.releaseWriter('alice', workspace.composerRef, lease.lease);

    const path = join(root, 'composer', 'workspaces.json');
    const atRest = readFileSync(path, 'utf8');
    expect(atRest).not.toContain(PROVIDER_ID);
    expect(atRest).toContain('protectedProviderId');
    expect(readdirSync(join(root, 'composer')).filter((name) => name.endsWith('.tmp'))).toEqual([]);

    const restarted = createFileComposerStore(root, { protector });
    expect(restarted.get('alice', workspace.composerRef)).toMatchObject({
      ok: true,
      workspace: {
        title: 'Persistent',
        agent: { id: agent.id, path: agent.path, sourceHash: agent.sourceHash },
        turns: [{ prompt: 'persist me', state: 'complete', model: MODEL }],
      },
    });
    const resumed = restarted.acquireWriter('alice', workspace.composerRef);
    expect(resumed.ok && resumed.providerId).toBe(PROVIDER_ID);
    expect(resumed.ok && resumed.agent).toEqual(agent);
  });

  it('drops only an unreadable provider handle and keeps the visible workspace resumable', () => {
    const root = mkdtempSync(join(tmpdir(), 'composer-key-'));
    roots.push(root);
    const first = createFileComposerStore(root, { protector: createProviderIdProtector(SECRET) });
    const workspace = first.create('alice');
    const lease = first.acquireWriter('alice', workspace.composerRef);
    if (!lease.ok) throw new Error('lease');
    first.setProviderId('alice', workspace.composerRef, lease.lease, PROVIDER_ID);
    first.releaseWriter('alice', workspace.composerRef, lease.lease);

    const wrongKey = createFileComposerStore(root, {
      protector: createProviderIdProtector(Buffer.from('different-session-secret-987654321')),
    });
    const recovered = wrongKey.acquireWriter('alice', workspace.composerRef);
    expect(recovered).toMatchObject({ ok: true, providerId: null, workspace: { composerRef: workspace.composerRef } });
    if (recovered.ok) wrongKey.releaseWriter('alice', workspace.composerRef, recovered.lease);
  });

  it('normalizes crash-residue running turns to interrupted on daemon restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'composer-restart-'));
    roots.push(root);
    const protector = createProviderIdProtector(SECRET);
    const first = createFileComposerStore(root, { protector });
    const workspace = first.create('alice');
    const lease = first.acquireWriter('alice', workspace.composerRef);
    if (!lease.ok) throw new Error('lease');
    first.beginTurn('alice', workspace.composerRef, lease.lease, 'still running at restart');

    const restarted = createFileComposerStore(root, {
      protector,
      now: () => new Date('2026-07-18T18:00:00.000Z'),
    });
    expect(restarted.get('alice', workspace.composerRef)).toMatchObject({
      ok: true,
      workspace: { turns: [{
        state: 'interrupted',
        error: 'dashboard restarted before the Composer turn completed',
        endedAt: '2026-07-18T18:00:00.000Z',
      }] },
    });
    expect(restarted.acquireWriter('alice', workspace.composerRef).ok).toBe(true);
  });

  it('resolves explicit state root before LOCALAPPDATA', () => {
    expect(resolveDashboardStateRoot({ DASHBOARD_STATE_ROOT: 'D:\\state', LOCALAPPDATA: 'C:\\Local' })).toBe('D:\\state');
    expect(resolveDashboardStateRoot({ LOCALAPPDATA: 'C:\\Local' })).toBe(join('C:\\Local', 'kb', 'dashboard'));
  });
});

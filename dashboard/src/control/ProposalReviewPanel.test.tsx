// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComposerSession } from '../composer/workspaceClient';
import { ProposalReviewPanel } from './ProposalReviewPanel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const session: ComposerSession = {
  composerRef: 'composer-1', title: 'Plan control', state: 'open', sourceComposerRef: null,
  createdAt: '2026-07-18T10:00:00.000Z', updatedAt: '2026-07-18T10:01:00.000Z',
  turns: [{
    turnId: 'turn-1', prompt: 'Make a plan', state: 'complete', model: null, error: null,
    startedAt: '2026-07-18T10:00:00.000Z', endedAt: '2026-07-18T10:01:00.000Z',
  }],
};

const snapshot = {
  schema: 'kb.plan-proposal/v1' as const, proposalId: 'control', project: 'kb-ops', title: 'Control run', summary: 'A safe run.',
  manager: { runtime: 'claude', model: 'claude-sonnet-5', requiredSkills: [] },
  scope: { read: ['dashboard'], write: ['dashboard/src'] }, governanceRefs: ['CLAUDE.md'],
  stages: [{
    id: 'test', title: 'Test', action: 'test:control', target: 'dashboard', workOrder: 'Run tests.', riskTier: 'T2' as const,
    dependsOn: [], worker: { runtime: 'codex', model: 'gpt-5.6-sol' }, requiredSkills: [],
    scope: { read: ['dashboard'], write: ['dashboard/src'] }, artifacts: [], checkpoints: [], humanGates: [],
  }],
};

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

describe('ProposalReviewPanel', () => {
  it('appears only after a completed turn and uses stable exact-hash decision and launch keys', async () => {
    const hash = 'a'.repeat(64);
    const raw = {
      proposalRef: 'proposal-1', sourceComposerRef: 'composer-1', sourceTurnId: 'turn-1', revision: 1,
      hash, previousHash: null, title: 'Control run', createdAt: '2026-07-18T10:02:00.000Z', snapshot, approval: null,
    };
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/control/proposals') return response({ proposals: [] });
      if (url === '/api/control/proposals/import') return response({
        ok: true, value: raw,
        diff: { schema: 'kb.plan-proposal-diff/v1', fromContentHash: null, toContentHash: hash, changed: true, changes: [] },
      });
      if (url.endsWith('/decision')) return response({ ok: true, value: { ...raw, approval: { revision: 1, decision: 'approved', decidedAt: '2026-07-18T10:03:00.000Z' } } });
      if (url.endsWith('/launch')) return response({ runRef: 'run-1' });
      throw new Error(`unexpected ${url}`);
    });
    vi.stubGlobal('fetch', fetchImpl);

    render(<ProposalReviewPanel composerSession={session} sessionToken="token" />);
    expect(screen.getByTestId('composer-proposal-review')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Compile latest completed turn' }));
    expect(await screen.findByRole('heading', { name: 'Control run' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Approve exact revision' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Start governed run' }).hasAttribute('disabled')).toBe(false));
    const decision = calls.find((call) => call.url.endsWith('/decision'))!;
    expect(JSON.parse(decision.init?.body as string).idempotencyKey).toBe(`proposal:${hash}:approved`);

    fireEvent.click(screen.getByRole('button', { name: 'Start governed run' }));
    await screen.findByText('Governed run run-1 started.');
    const launch = calls.find((call) => call.url.endsWith('/launch'))!;
    expect(JSON.parse(launch.init?.body as string).idempotencyKey).toBe(`launch:${hash}`);
  });

  it('stays absent while the conversation has no completed response', () => {
    render(<ProposalReviewPanel composerSession={{ ...session, turns: [{ ...session.turns[0], state: 'running' }] }} sessionToken="token" />);
    expect(screen.queryByTestId('composer-proposal-review')).toBeNull();
  });

  it('surfaces the proposal-ready banner only when the latest completed turn emitted a fence', () => {
    const fenced = {
      ...session,
      turns: [{
        ...session.turns[0],
        model: {
          turns: [{
            index: 0, model: null, timestamp: null, usage: null,
            steps: [{ kind: 'text' as const, text: 'Ready.\n```kb.plan-proposal/v1\n{}\n```\n' }],
          }],
        },
      }],
    };
    render(<ProposalReviewPanel composerSession={fenced} sessionToken="token" />);
    expect(screen.getByTestId('composer-proposal-banner')).toBeTruthy();
    cleanup();
    render(<ProposalReviewPanel composerSession={session} sessionToken="token" />);
    expect(screen.queryByTestId('composer-proposal-banner')).toBeNull();
  });
});

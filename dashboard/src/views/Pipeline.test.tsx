// @vitest-environment jsdom
/**
 * D3.4 — the pipeline canvas node. The React Flow canvas positions cards over the queue's `depends-on`
 * DAG; the visible content of each card lives in {@link PipelineNodeBody}, tested here in isolation so
 * the assertions never depend on React Flow's DOM measurement (which jsdom cannot do). Each node shows
 * the card name, a status dot, a mono model chip, a one-line summary, an inline GOVERNED model toggle,
 * and a click-through to the card's timeline/transcript.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { Pipeline, PipelineNodeBody } from './Pipeline';
import type { DagNodeData } from '../../server/dag/graph';
import { EMPTY_ROUTING, postCardRouting, type RuntimeRegistryEntry, type WriteResult } from '../lib/routingClient';

afterEach(cleanup);

const REGISTRY: Record<string, RuntimeRegistryEntry> = {
  claude: { default_worker: 'worker-desktop', aliases: {}, known_models: ['claude-opus-4-8'] },
};

function nodeData(over: Partial<DagNodeData> & { id: string }): DagNodeData {
  return {
    action: 'run-build',
    target: 'src/',
    state: 'working',
    summary: 'run-build → src/',
    runtime: 'claude',
    model: 'claude-opus-4-8',
    owner: 'claude/m1',
    project: 'kb',
    role: 'work',
    workflow: null,
    dependsOn: [],
    variantGroup: null,
    blocked: false,
    ...over,
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

const noopWrite = async (): Promise<WriteResult> => ({ ok: true });

describe('Runs view', () => {
  it('explains that execution happens in background runners, not Terminal tabs', () => {
    render(<Pipeline dag={{ nodes: [], edges: [] }} routing={EMPTY_ROUTING} />);

    expect(screen.getByLabelText('Runs view')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Runs' })).toBeTruthy();
    expect(screen.getByText(/live run stages/i)).toBeTruthy();
    expect(screen.getByText(/background runners/i)).toBeTruthy();
  });

  it('uses a truthful empty state without promising a workflow compiler', () => {
    render(<Pipeline dag={{ nodes: [], edges: [] }} routing={EMPTY_ROUTING} />);

    const empty = screen.getByTestId('runs-empty');
    expect(within(empty).getByText('No launched queue cards to graph yet')).toBeTruthy();
    expect(within(empty).getByText(/use run now from composer/i)).toBeTruthy();
    expect(empty.textContent).not.toMatch(/compile|compiler/i);
  });

  it('groups workflow cards by run instance and switches the visible graph', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    render(
      <Pipeline
        dag={{
          nodes: [
            { id: 'a', data: nodeData({ id: 'a', workflow: 'run-alpha', state: 'done' }) },
            { id: 'b', data: nodeData({ id: 'b', workflow: 'run-beta', state: 'working' }) },
          ],
          edges: [],
        }}
        routing={EMPTY_ROUTING}
      />,
    );

    const groups = screen.getByTestId('run-groups');
    expect(within(groups).getByText('run-alpha')).toBeTruthy();
    expect(within(groups).getByText('run-beta')).toBeTruthy();
    expect(within(groups).getByText(/1\/1 done/)).toBeTruthy();
    fireEvent.click(within(groups).getByText('run-alpha'));
    expect(screen.getByTestId('pipeline-node-a')).toBeTruthy();
    expect(screen.queryByTestId('pipeline-node-b')).toBeNull();
  });
});

describe('PipelineNodeBody', () => {
  it('renders the card name, a status dot, a mono model chip and the one-line summary', () => {
    render(
      <PipelineNodeBody
        data={nodeData({ id: 'card-42' })}
        registry={REGISTRY}
        canAct={false}
        onApplyRouting={noopWrite}
        onClearRouting={noopWrite}
        onOpenCard={() => {}}
      />,
    );
    expect(screen.getByTestId('pipeline-node-card-42-open').textContent).toBe('card-42');
    expect(screen.getByTestId('pipeline-node-card-42-dot')).toBeTruthy();
    const model = screen.getByTestId('pipeline-node-card-42-model');
    expect(model.textContent).toBe('claude-opus-4-8');
    expect(model.className).toContain('mc-mono');
    expect(screen.getByTestId('pipeline-node-card-42-summary').textContent).toBe('run-build → src/');
  });

  it('click-through on the node name navigates to that card', () => {
    const onOpenCard = vi.fn();
    render(
      <PipelineNodeBody
        data={nodeData({ id: 'card-9' })}
        registry={REGISTRY}
        canAct={false}
        onApplyRouting={noopWrite}
        onClearRouting={noopWrite}
        onOpenCard={onOpenCard}
      />,
    );
    fireEvent.click(screen.getByTestId('pipeline-node-card-9-open'));
    expect(onOpenCard).toHaveBeenCalledTimes(1);
    expect(onOpenCard).toHaveBeenCalledWith('card-9');
  });

  it('a mutable blocked stage freezes without retry on an authoritative 409 lifecycle refusal', async () => {
    // The toggle reuses the EXISTING governed card-routing client against a mocked fetch that returns
    // A raced lifecycle refusal freezes the node rather than retrying or opening a second path.
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: 'routing-state-locked', reason: 'assigned inbox card may already have been picked up by its runner' }, false, 409),
    );
    const onApplyRouting = (cardId: string, runtime: string, model: string): Promise<WriteResult> =>
      postCardRouting({ op: 'set', cardId, runtime, model }, 'tok', fetchMock as unknown as typeof fetch);

    render(
      <PipelineNodeBody
        data={nodeData({ id: 'card-lock', state: 'blocked', blocked: true })}
        registry={REGISTRY}
        canAct
        onApplyRouting={onApplyRouting}
        onClearRouting={noopWrite}
        onOpenCard={() => {}}
      />,
    );

    // Open the governed toggle popover and apply a routing change.
    fireEvent.click(screen.getByTestId('pipeline-card-lock-routing-chip'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    // The write hit the EXISTING card-routing endpoint, exactly once (no retry loop).
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith('/api/write/card-routing', expect.objectContaining({ method: 'POST' }));

    // …and the node is now frozen: the chip is disabled and the refusal reason is shown inline.
    await waitFor(() => {
      const chip = screen.getByTestId('pipeline-card-lock-routing-chip') as HTMLButtonElement;
      expect(chip.disabled).toBe(true);
    });
    expect(screen.getByTestId('pipeline-card-lock-routing-locked').textContent).toMatch(/picked up/i);
    // No second attempt was made.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps routing mutable after a retryable publication conflict', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: 'routing-conflict', reason: 'ops changed; retry against the latest state' }, false, 409),
    );
    const onApplyRouting = (cardId: string, runtime: string, model: string): Promise<WriteResult> =>
      postCardRouting({ op: 'set', cardId, runtime, model }, 'tok', fetchMock as unknown as typeof fetch);

    render(
      <PipelineNodeBody
        data={nodeData({ id: 'card-conflict', state: 'blocked', blocked: true })}
        registry={REGISTRY}
        canAct
        onApplyRouting={onApplyRouting}
        onClearRouting={noopWrite}
        onOpenCard={() => {}}
      />,
    );

    fireEvent.click(screen.getByTestId('pipeline-card-conflict-routing-chip'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect((screen.getByTestId('pipeline-card-conflict-routing-chip') as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('pipeline-card-conflict-routing-locked')).toBeNull();
  });

  it('freezes a card that is already under an active approval up front (no write attempted)', () => {
    const onApplyRouting = vi.fn(noopWrite);
    render(
      <PipelineNodeBody
        data={nodeData({ id: 'card-appr', state: 'approvals' })}
        registry={REGISTRY}
        canAct
        onApplyRouting={onApplyRouting}
        onClearRouting={noopWrite}
        onOpenCard={() => {}}
      />,
    );
    const chip = screen.getByTestId('pipeline-card-appr-routing-chip') as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(screen.getByTestId('pipeline-card-appr-routing-locked')).toBeTruthy();
    expect(onApplyRouting).not.toHaveBeenCalled();
  });

  it('freezes assigned queued and active cards with distinct truthful reasons', () => {
    const onApplyRouting = vi.fn(noopWrite);
    const { rerender } = render(
      <PipelineNodeBody
        data={nodeData({ id: 'card-queued', state: 'inbox', owner: 'codex-worker' })}
        registry={REGISTRY}
        canAct
        onApplyRouting={onApplyRouting}
        onClearRouting={noopWrite}
        onOpenCard={() => {}}
      />,
    );
    expect((screen.getByTestId('pipeline-card-queued-routing-chip') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('pipeline-card-queued-routing-locked').textContent).toMatch(/runner may already be active/i);

    rerender(
      <PipelineNodeBody
        data={nodeData({ id: 'card-active', state: 'working', owner: 'codex-worker' })}
        registry={REGISTRY}
        canAct
        onApplyRouting={onApplyRouting}
        onClearRouting={noopWrite}
        onOpenCard={() => {}}
      />,
    );
    expect((screen.getByTestId('pipeline-card-active-routing-chip') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('pipeline-card-active-routing-locked').textContent).toMatch(/fixed for this attempt/i);
    expect(onApplyRouting).not.toHaveBeenCalled();
  });

  it('keeps a dependency-blocked card mutable and freezes historical attempts', () => {
    const { rerender } = render(
      <PipelineNodeBody
        data={nodeData({ id: 'card-future', state: 'blocked', blocked: true, owner: 'codex-worker' })}
        registry={REGISTRY}
        canAct
        onApplyRouting={noopWrite}
        onClearRouting={noopWrite}
        onOpenCard={() => {}}
      />,
    );
    expect((screen.getByTestId('pipeline-card-future-routing-chip') as HTMLButtonElement).disabled).toBe(false);

    rerender(
      <PipelineNodeBody
        data={nodeData({ id: 'card-done', state: 'done', owner: 'codex-worker' })}
        registry={REGISTRY}
        canAct
        onApplyRouting={noopWrite}
        onClearRouting={noopWrite}
        onOpenCard={() => {}}
      />,
    );
    expect((screen.getByTestId('pipeline-card-done-routing-chip') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId('pipeline-card-done-routing-locked').textContent).toMatch(/historical attempt/i);
  });
});

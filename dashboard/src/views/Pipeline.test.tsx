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
  it('explains that the queue dependency graph is read-only and is not a workflow editor', () => {
    render(<Pipeline dag={{ nodes: [], edges: [] }} routing={EMPTY_ROUTING} />);

    expect(screen.getByLabelText('Runs view')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Runs' })).toBeTruthy();
    expect(screen.getByText(/read-only dependency graph of launched queue cards/i)).toBeTruthy();
    expect(screen.getByText(/not a workflow editor/i)).toBeTruthy();
  });

  it('uses a truthful empty state without promising a workflow compiler', () => {
    render(<Pipeline dag={{ nodes: [], edges: [] }} routing={EMPTY_ROUTING} />);

    const empty = screen.getByTestId('runs-empty');
    expect(within(empty).getByText('No launched queue cards to graph yet')).toBeTruthy();
    expect(within(empty).getByText(/cards and links are created outside this read-only view/i)).toBeTruthy();
    expect(empty.textContent).not.toMatch(/compile|compiler/i);
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

  it('the inline toggle POSTs to the card-routing endpoint, and freezes (disabled + reason, no retry) on 409 approval-locked', async () => {
    // The toggle reuses the EXISTING governed card-routing client against a mocked fetch that returns
    // 409 `approval-locked` — asserting the node freezes rather than retrying or opening a 2nd path.
    const fetchMock = vi.fn(async () =>
      jsonResponse({ error: 'approval-locked', reason: 'card is under an active approval; routing is frozen' }, false, 409),
    );
    const onApplyRouting = (cardId: string, runtime: string, model: string): Promise<WriteResult> =>
      postCardRouting({ op: 'set', cardId, runtime, model }, 'tok', fetchMock as unknown as typeof fetch);

    render(
      <PipelineNodeBody
        data={nodeData({ id: 'card-lock' })}
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
    expect(screen.getByTestId('pipeline-card-lock-routing-locked').textContent).toMatch(/approval/i);
    // No second attempt was made.
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
});

// @vitest-environment jsdom
/**
 * U3 — Workflows lists registered definition artifacts; it does not present definitions as live runs.
 * The designed empty state stays calm and explanatory, and points launched queue-card graphs to Runs.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { Workflows } from './Workflows';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('Workflows view', () => {
  it('renders the designed empty state when no workflows are registered', () => {
    render(<Workflows data={{ present: false, items: [] }} />);
    expect(screen.getByLabelText('Workflows view')).toBeTruthy();
    const empty = screen.getByTestId('workflows-empty');
    expect(within(empty).getByText('No workflows registered yet')).toBeTruthy();
    expect(within(empty).getByText(/executable workflow-v1 definitions expose Run now/i)).toBeTruthy();
    expect(within(empty).getByText(/their graph appears in Runs/i)).toBeTruthy();
  });

  it('renders the empty state when the registry is present but has no workflows', () => {
    render(<Workflows data={{ present: true, items: [] }} />);
    expect(screen.getByTestId('workflows-empty')).toBeTruthy();
  });

  it('does not use any error styling in the empty state', () => {
    const { container } = render(<Workflows data={{ present: false, items: [] }} />);
    // No error/blocked semantic classes anywhere in the empty view.
    expect(container.querySelector('[class*="error"]')).toBeNull();
    expect(container.querySelector('[class*="blocked"]')).toBeNull();
  });

  it('lists registered workflows with name, id, path, and a live status marker', () => {
    render(
      <Workflows
        data={{
          present: true,
          items: [
            { id: 'wf_ship-review', path: 'workflows/wf_ship-review.md', name: 'Ship review', status: 'active' },
            { id: 'wf_nightly-sweep', path: 'workflows/wf_nightly-sweep.md', name: 'wf_nightly-sweep', status: 'registered' },
          ],
        }}
      />,
    );
    // The human name renders; when it differs from the id, the mono id is shown alongside it.
    expect(screen.getByText('Ship review')).toBeTruthy();
    expect(screen.getByText('wf_ship-review')).toBeTruthy();
    expect(screen.getByText('workflows/wf_ship-review.md')).toBeTruthy();
    // A name equal to the id renders once (no duplicate id chip).
    expect(screen.getByText('wf_nightly-sweep')).toBeTruthy();
    // Each row carries its own status from the read model.
    expect(screen.getByText('active')).toBeTruthy();
    expect(screen.getByText('registered')).toBeTruthy();
    expect(screen.queryByTestId('workflows-empty')).toBeNull();
  });

  it('distinguishes registered definitions from launched queue-card graphs without a stale placeholder', () => {
    render(<Workflows data={{ present: false, items: [] }} />);
    expect(screen.getByText(/registered reusable definitions/i)).toBeTruthy();
    expect(screen.getByTestId('workflows-runs-note').textContent).toMatch(/Run now creates a new instance/i);
    expect(screen.queryByText(/D3\.4|will render here/i)).toBeNull();
  });

  it('lists org workflow definitions with a validation badge and a compiled stage preview', () => {
    render(
      <Workflows
        data={{ present: false, items: [] }}
        definitions={{ items: [
          {
            ref: 'research-brief', project: 'kb-ops', path: 'orgs/kb-ops/workflows/research-brief.md',
            valid: true, title: 'Research brief (cited)', profile: 'research', stageCount: 1, riskTier: 'T2',
            stages: [{ id: 'brief', action: 'research:web-brief', target: 'orgs/kb-ops/output', riskTier: 'T2' }],
            detail: null,
          },
        ] }}
      />,
    );
    const section = screen.getByTestId('workflow-defs');
    expect(within(section).getByText('Research brief (cited)')).toBeTruthy();
    expect(within(section).getByText('research')).toBeTruthy();
    expect(within(section).getByText(/research:web-brief → orgs\/kb-ops\/output/)).toBeTruthy();
    expect(within(section).getByText('valid')).toBeTruthy();
    expect(within(section).getByRole('button', { name: 'Launch' })).toBeTruthy();
  });

  it('launches an org definition and reports the honest activation-gated status', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 202,
      json: async () => ({ ok: true, runRef: 'run-ref-9', activationGated: true, waitingHuman: true }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    render(
      <Workflows
        sessionToken="tok"
        data={{ present: false, items: [] }}
        definitions={{ items: [
          {
            ref: 'research-brief', project: 'kb-ops', path: 'orgs/kb-ops/workflows/research-brief.md',
            valid: true, title: 'Research brief (cited)', profile: 'research', stageCount: 1, riskTier: 'T2',
            stages: [{ id: 'brief', action: 'research:web-brief', target: 'orgs/kb-ops/output', riskTier: 'T2' }],
            detail: null,
          },
        ] }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Launch' }));
    expect(await screen.findByText(/Run created run-ref-9; execution awaits activation/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/workflows/research-brief/launch', expect.objectContaining({ method: 'POST' }));
  });

  it('runs a strict registered workflow as a new instance', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ runId: 'run-ship-1', runners: [{ status: 'triggered' }] }),
    } as Response));
    vi.stubGlobal('fetch', fetchMock);
    render(<Workflows sessionToken="tok" data={{ present: true, items: [{
      id: 'wf_ship', path: 'workflows/wf_ship.md', name: 'Ship', status: 'active',
      definition: { name: 'wf_ship', project: 'kb', stages: [{ id: 'build', action: 'build', target: '.', workOrder: 'Build', riskTier: 'T2', owner: 'codex-worker', dependsOn: [] }] },
    }] }} />);

    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect(await screen.findByText(/Launched run-ship-1.*background runner signaled/)).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith('/api/write/workflow-runs', expect.objectContaining({ method: 'POST' }));
  });
});

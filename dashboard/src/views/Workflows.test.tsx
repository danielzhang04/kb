// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { EntityDetail, EntityList } from '../../server/entities/contracts.ts';
import type { EntitySummary } from '../../server/control/p2Contracts.ts';
import { renderWithTestSession } from '../test/session';
import { Workflows } from './Workflows';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const summary: EntitySummary = {
  ref: { type: 'workflow', id: 'research-brief', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/research-brief.md' },
  humanName: 'Research Brief', status: 'idle', modelLabel: 'varies', temporalLabel: 'Never run · no schedule', host: 'vm', gatedRunCount: 0,
  activeRuns: [], latestRun: null, nextSchedule: null,
};
const list: EntityList = { revision: 'workflows-1', groups: [{ id: 'kb-ops', label: 'KB Ops', collapsed: false, items: [summary] }], items: [summary] };
const detail: EntityDetail = {
  revision: 'workflow-1', summary,
  brief: { purpose: 'Produce a cited brief.', doingNow: 'Idle.', recentRuns: [], outputs: [], pendingGates: 0, schedule: null, autonomyTier: 'T2' },
  details: {
    sourcePath: 'orgs/kb-ops/workflows/research-brief.md', sourceRevision: 'a'.repeat(64), tools: [], declaredCeiling: 'T2', replaces: [], buildsOn: [], knowledgeSources: [], skills: [], schemas: ['workflow-definition/v1'], lineage: [], grades: [], ids: ['research-brief'],
    workflow: { stepDag: { nodes: [{ stageRef: 'brief', label: 'Brief' }], edges: [] }, parameters: [], runGraph: null },
  },
};

describe('Workflows P2 roster', () => {
  it('retains only summaries with gated runs for the closed attention filter', async () => {
    const gated: EntitySummary = {
      ...summary,
      ref: { type: 'workflow', id: 'release', project: 'kb-ops', sourcePath: 'orgs/kb-ops/workflows/release.md' },
      humanName: 'Release',
      gatedRunCount: 1,
    };
    const filteredList: EntityList = {
      revision: 'workflows-attention',
      groups: [{ id: 'kb-ops', label: 'KB Ops', collapsed: false, items: [summary, gated] }],
      items: [summary, gated],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(filteredList), { status: 200 })));

    await renderWithTestSession(<Workflows filter="attention" />);

    expect((await screen.findAllByTestId('entity-card')).map((card) => card.textContent)).toEqual([expect.stringContaining('Release')]);
    expect(screen.queryByText('Research Brief')).toBeNull();
  });

  it('uses one EntitySummary request and one EntityDetail request without client joins', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith('/research-brief') ? detail : list), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await renderWithTestSession(<Workflows />);
    const card = await screen.findByTestId('entity-card');
    expect(card.textContent).toContain('Research Brief');
    fireEvent.click(card);
    expect(await screen.findByTestId('workflow-step-graph')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/workflows', '/api/workflows/research-brief']);
  });

  it('launches with source revision and a client idempotency key, then opens the Run', async () => {
    const navigate = vi.fn();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response(JSON.stringify({ runRef: 'run-9' }), { status: 201 });
      return new Response(JSON.stringify(String(input).endsWith('/research-brief') ? detail : list), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    await renderWithTestSession(<Workflows onNavigate={navigate} />, { signIn: async () => ({ token: 'session-token', expiresAt: Date.now() + 60_000 }) });
    fireEvent.click(await screen.findByTestId('entity-card'));
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ view: 'workflows', focus: { kind: 'run', id: 'run-9' } }));
    const launchCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST');
    const body = JSON.parse(String(launchCall?.[1]?.body)) as Record<string, unknown>;
    expect(body.expectedSourceRevision).toBe('a'.repeat(64));
    expect(String(body.idempotencyKey)).toContain('workflow-launch:research-brief:');
    expect(body).not.toHaveProperty('expectedSourceHash');
  });

  it('shows an explicit required-parameter refusal and schedules the immutable Workflow owner', async () => {
    const navigate = vi.fn();
    const parameterized = { ...detail, details: { ...detail.details, workflow: { ...detail.details.workflow!, parameters: ['channel'] } } };
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith('/research-brief') ? parameterized : list), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await renderWithTestSession(<Workflows onNavigate={navigate} />);
    fireEvent.click(await screen.findByTestId('entity-card'));
    await screen.findByRole('tab', { name: 'Brief' });
    expect(screen.getAllByRole('tab').map((tab) => tab.querySelector('span')?.textContent)).toEqual(['Live', 'Brief', 'Details']);
    fireEvent.click(screen.getByRole('button', { name: 'Run now' }));
    expect((await screen.findByRole('status')).textContent).toContain('Run refused: provide required parameters: Channel.');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(navigate).toHaveBeenCalledWith({ view: 'schedules', section: 'new', scheduleOwner: summary.ref });
  });

  it('restores focused Brief state and retries only the hosted detail while retaining the roster', async () => {
    let detailAttempts = 0;
    const sectionChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/research-brief')) {
        detailAttempts += 1;
        return detailAttempts === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(detail), { status: 200 });
      }
      return new Response(JSON.stringify(list), { status: 200 });
    }));
    await renderWithTestSession(<Workflows focusWorkflowId="research-brief" activeSectionId="brief" onSectionChange={sectionChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Produce a cited brief.')).toBeTruthy();
    expect(screen.getByTestId('entity-card')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Brief' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Live/ }));
    expect(sectionChange).toHaveBeenCalledWith('live');
  });
});

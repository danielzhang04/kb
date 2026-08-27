// @vitest-environment jsdom
import { useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { SYSTEM_ENTITY_GROUP_ID, type EntityDetail, type EntityList } from '../../server/entities/contracts.ts';
import type { EntitySummary } from '../../server/control/p2Contracts.ts';
import { renderWithTestSession } from '../test/session';
import { Agents } from './Agents';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const summary: EntitySummary = {
  ref: { type: 'agent', id: 'fyt-checker', sourcePath: 'agents/fyt-checker.md' }, humanName: 'FYT Checker', status: 'idle',
  modelLabel: 'claude-sonnet-5', temporalLabel: 'Never run · no schedule', host: 'desktop', gatedRunCount: 0,
  activeRuns: [], latestRun: null, nextSchedule: null,
};
const list: EntityList = { revision: 'agents-1', groups: [{ id: 'fyt', label: 'FYT', collapsed: false, items: [summary] }], items: [summary] };
const detail: EntityDetail = {
  revision: 'agent-1', summary,
  brief: { purpose: 'Checks FYT work.', doingNow: 'Idle.', recentRuns: [], outputs: [], pendingGates: 0, schedule: null, autonomyTier: 'queues-for-me' },
  details: { sourcePath: 'agents/fyt-checker.md', sourceRevision: 'a'.repeat(64), tools: [], declaredCeiling: 'queues-for-me', replaces: [], buildsOn: [], knowledgeSources: [], skills: [], schemas: ['agent-declaration/v1'], lineage: [], grades: [], ids: ['fyt-checker'] },
};

function HistoryAgents(): React.JSX.Element {
  const [focusAgentId, setFocusAgentId] = useState<string | null>(() => window.history.state?.agentId ?? null);
  useEffect(() => {
    const restore = (event: PopStateEvent): void => setFocusAgentId(event.state?.agentId ?? null);
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  return <Agents
    focusAgentId={focusAgentId}
    onOpenAgent={(id) => {
      window.history.pushState({ agentId: id }, '', `/agents/${id}`);
      setFocusAgentId(id);
    }}
    onBack={() => window.history.back()}
  />;
}

describe('Agents P2 roster', () => {
  it('renders the search and card groups as grid-only', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(list), { status: 200 })));

    const { container } = await renderWithTestSession(<Agents />);

    await screen.findByTestId('entity-card');
    expect(screen.getByRole('textbox', { name: 'Search agents' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Grid' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'List' })).toBeNull();
    expect(container.querySelector('.entity-card-groups--grid')).toBeTruthy();
    expect(container.querySelector('.code-view')).toBeNull();
  });

  it('starts only the System group collapsed and keeps it last', async () => {
    const systemSummary = {
      ...summary,
      ref: { type: 'agent' as const, id: 'ops-daemon', sourcePath: 'agents/ops-daemon.md' as const },
      humanName: 'Ops Daemon',
    };
    const groupedList: EntityList = {
      revision: 'agents-groups',
      groups: [
        { id: SYSTEM_ENTITY_GROUP_ID, label: 'System', collapsed: false, items: [systemSummary] },
        { id: 'fyt', label: 'FYT', collapsed: false, items: [summary] },
      ],
      items: [systemSummary, summary],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(groupedList), { status: 200 })));

    await renderWithTestSession(<Agents />);

    const toggles = await screen.findAllByRole('button', { expanded: true });
    expect(toggles.map((toggle) => toggle.textContent)).toEqual(['FYT 1']);
    expect(screen.getByRole('button', { name: 'System 1' }).getAttribute('aria-expanded')).toBe('false');
    expect(screen.getAllByRole('button').filter((button) => button.className === 'entity-card-group__toggle').map((button) => button.textContent)).toEqual(['FYT 1', 'System 1']);
  });

  it('preserves faceless-youtube and System collapse state across overlay history and Escape', async () => {
    window.history.replaceState(null, '', '/agents');
    const systemSummary = {
      ...summary,
      ref: { type: 'agent' as const, id: 'ops-daemon', sourcePath: 'agents/ops-daemon.md' as const },
      humanName: 'Ops Daemon',
    };
    const builderSummary = {
      ...summary,
      ref: { type: 'agent' as const, id: 'agent-builder', sourcePath: 'agents/agent-builder.md' as const },
      humanName: 'Agent Builder',
    };
    const groupedList: EntityList = {
      revision: 'agents-history',
      groups: [
        { id: 'faceless-youtube', label: 'Faceless YouTube', collapsed: false, items: [summary] },
        { id: 'builders', label: 'Builders', collapsed: false, items: [builderSummary] },
        { id: SYSTEM_ENTITY_GROUP_ID, label: 'System', collapsed: false, items: [systemSummary] },
      ],
      items: [summary, builderSummary, systemSummary],
    };
    const builderDetail: EntityDetail = { ...detail, summary: builderSummary };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(
      String(input).includes('/agent-builder') ? builderDetail : groupedList,
    ), { status: 200 })));

    await renderWithTestSession(<HistoryAgents />);
    const facelessToggle = await screen.findByRole('button', { name: 'Faceless YouTube 1' });
    const systemToggle = screen.getByRole('button', { name: 'System 1' });
    fireEvent.click(facelessToggle);
    expect(facelessToggle.getAttribute('aria-expanded')).toBe('false');
    expect(systemToggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(screen.getAllByTestId('entity-card').find((card) => card.textContent?.includes('Agent Builder'))!);
    expect(await screen.findByTestId('entity-detail-agent')).toBeTruthy();

    window.history.back();
    await waitFor(() => expect(screen.queryByTestId('entity-detail-agent')).toBeNull());
    expect(facelessToggle.getAttribute('aria-expanded')).toBe('false');
    expect(systemToggle.getAttribute('aria-expanded')).toBe('false');

    window.history.forward();
    expect(await screen.findByTestId('entity-detail-agent')).toBeTruthy();
    expect(facelessToggle.getAttribute('aria-expanded')).toBe('false');
    expect(systemToggle.getAttribute('aria-expanded')).toBe('false');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('entity-detail-agent')).toBeNull());
    expect(facelessToggle.getAttribute('aria-expanded')).toBe('false');
    expect(systemToggle.getAttribute('aria-expanded')).toBe('false');
    window.history.replaceState(null, '', '/');
  });

  it('retains only summaries with gated runs for the closed attention filter', async () => {
    const gated = { ...summary, ref: { type: 'agent' as const, id: 'grader', sourcePath: 'agents/grader.md' as const }, humanName: 'Grader', gatedRunCount: 2 };
    const filteredList: EntityList = {
      revision: 'agents-attention',
      groups: [{ id: 'fyt', label: 'FYT', collapsed: false, items: [summary, gated] }],
      items: [summary, gated],
    };
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(filteredList), { status: 200 })));

    await renderWithTestSession(<Agents filter="attention" />);

    expect((await screen.findAllByTestId('entity-card')).map((card) => card.textContent)).toEqual([expect.stringContaining('Grader')]);
    expect(screen.queryByText('FYT Checker')).toBeNull();
  });

  it('uses one EntitySummary request, keeps the roster mounted, and opens one EntityDetail request', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith('/fyt-checker') ? detail : list), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await renderWithTestSession(<Agents />);
    const card = await screen.findByTestId('entity-card');
    expect(card.textContent).toContain('FYT Checker');
    fireEvent.click(card);
    expect(await screen.findByTestId('entity-detail-agent')).toBeTruthy();
    expect(screen.getByTestId('entity-card')).toBeTruthy();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual(['/api/agents', '/api/agents/fyt-checker']);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.activeElement).toBe(card);
  });

  it('explains curated capabilities and keeps the server-provided selection', async () => {
    const editableDetail: EntityDetail = {
      ...detail,
      details: {
        ...detail.details,
        builder: {
          models: ['claude-sonnet-5'], profiles: ['read-only'], tools: ['read', 'write'], skills: [], connectors: [], filesystemRoots: ['orgs/faceless-youtube'], projects: [],
          value: { humanName: summary.humanName, purpose: detail.brief.purpose, model: 'claude-sonnet-5', profile: 'read-only', tools: ['read'], skills: [], connectors: [], filesystemRoots: [] },
        },
      },
    };
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith('/fyt-checker') ? editableDetail : list), { status: 200 })));

    await renderWithTestSession(<Agents />);
    fireEvent.click(await screen.findByTestId('entity-card'));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));

    expect(screen.getByText(/Give this agent only what it needs/)).toBeTruthy();
    const selectedTool = screen.getByRole('checkbox', { name: 'read' }) as HTMLInputElement;
    expect(selectedTool.checked).toBe(true);
    expect((screen.getByRole('checkbox', { name: 'write' }) as HTMLInputElement).checked).toBe(false);
    fireEvent.click(selectedTool);
    expect(screen.getByText('No tools selected — this agent cannot take tool actions until you add some.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save as proposal' })).toBeTruthy();
    expect(screen.getByText('Saved changes go to your Inbox for approval before they take effect.')).toBeTruthy();
  });

  it('restores focus to the matching card when Escape closes a deep-linked detail', async () => {
    const back = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith('/fyt-checker') ? detail : list), { status: 200 })));
    const rendered = await renderWithTestSession(<Agents focusAgentId="fyt-checker" onBack={back} />);
    await screen.findByTestId('entity-detail-agent');

    fireEvent.keyDown(document, { key: 'Escape' });
    rendered.rerender(<Agents focusAgentId={null} onBack={back} />);

    expect(back).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByTestId('entity-card'));
  });

  it('keeps search chrome on failure and retries the list', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response('{}', { status: 500 })).mockResolvedValueOnce(new Response(JSON.stringify(list), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await renderWithTestSession(<Agents />);
    expect(await screen.findByRole('textbox', { name: 'Search agents' })).toBeTruthy();
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('entity-card')).toBeTruthy();
  });

  it('keeps Live Brief Details order and navigates Schedule with the immutable Agent owner', async () => {
    const navigate = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => new Response(JSON.stringify(String(input).endsWith('/fyt-checker') ? detail : list), { status: 200 })));
    await renderWithTestSession(<Agents onNavigate={navigate} />);
    fireEvent.click(await screen.findByTestId('entity-card'));
    await screen.findByRole('tab', { name: 'Brief' });
    expect(screen.getAllByRole('tab').map((tab) => tab.querySelector('span')?.textContent)).toEqual(['Live', 'Brief', 'Details']);
    fireEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(navigate).toHaveBeenCalledWith({ view: 'schedules', section: 'new', scheduleOwner: summary.ref });
  });

  it('restores focused Brief state and retries only the hosted detail while retaining the roster', async () => {
    let detailAttempts = 0;
    const sectionChange = vi.fn();
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith('/fyt-checker')) {
        detailAttempts += 1;
        return detailAttempts === 1 ? new Response('{}', { status: 500 }) : new Response(JSON.stringify(detail), { status: 200 });
      }
      return new Response(JSON.stringify(list), { status: 200 });
    }));
    await renderWithTestSession(<Agents focusAgentId="fyt-checker" activeSectionId="brief" onSectionChange={sectionChange} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('Checks FYT work.')).toBeTruthy();
    expect(screen.getByTestId('entity-card')).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Brief' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByRole('tab', { name: /Live/ }));
    expect(sectionChange).toHaveBeenCalledWith('live');
  });
});

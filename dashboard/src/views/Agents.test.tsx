// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import type { EntityDetail, EntityList } from '../../server/entities/contracts.ts';
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

describe('Agents P2 roster', () => {
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

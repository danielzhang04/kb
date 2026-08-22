// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { healthResponseFixture } from '../../server/health/__fixtures__/health.ts';
import { clearStoredSession, persistSession } from '../lib/authClient.ts';
import { renderWithTestSession } from '../test/session.tsx';
import { Health } from './Health.tsx';

afterEach(() => {
  cleanup();
  clearStoredSession();
});

describe('Health', () => {
  it('mounts the one fleet STOP control in the served STOP section', async () => {
    await renderWithTestSession(<Health response={healthResponseFixture} />);
    expect(screen.getByLabelText('Nuclear STOP')).toBeTruthy();
    expect(screen.queryByLabelText('Request card stop')).toBeNull();
    expect(screen.queryByLabelText('Pause cadence')).toBeNull();
  });

  it('renders sections in the fixed order and preserves P7-owned unavailable copy', async () => {
    await renderWithTestSession(<Health response={healthResponseFixture} />);

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
      .toEqual(['Fleet', 'STOP', 'Daemon and machine', 'MCP', 'Usage']);
    expect(screen.getAllByText('unavailable in P1')).toHaveLength(3);
    expect(screen.getAllByText(/Source:/).map((source) => source.textContent)).toContain('Source: mcp-config');
    expect(screen.getByText('Worker A')).toBeTruthy();
    expect(screen.getByTestId('health-row-agent:worker-a').getAttribute('data-raw-id')).toBe('worker-a');
  });

  it('keeps schedule-owner integrity visible without hiding healthy rows', async () => {
    const response = structuredClone(healthResponseFixture);
    response.sections[0].rows.push({
      kind: 'integrity', key: `schedule-owner:${'d'.repeat(64)}`, label: 'Schedule owner',
      value: { status: 'error', code: 'schedule-owner-unresolvable', owner: { type: 'agent', id: 'deleted-owner', sourcePath: 'agents/deleted-owner.md' } },
      observedAt: '2026-08-21T12:00:00.000Z', source: 'schedule-store',
    });
    await renderWithTestSession(<Health response={response} />);

    expect(screen.getByText('schedule-owner-unresolvable')).toBeTruthy();
    expect(screen.getByText('Worker A')).toBeTruthy();
    expect(screen.queryByText('Unknown')).toBeNull();
  });

  it('preserves the P7 error copy and offers Retry without inventing empty Health', async () => {
    persistSession({ token: 'health-session', expiresAt: Date.now() + 60_000 });
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ error: 'unavailable' }), { status: 503 }));
    await renderWithTestSession(<Health fetchImpl={fetchImpl} />);

    expect(await screen.findByText('Health is unavailable.')).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Health' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });
});

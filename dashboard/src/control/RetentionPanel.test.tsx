// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RetentionPanel } from './RetentionPanel';

afterEach(cleanup);

function response(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function item(runRef: string, title: string, quarantinedAt: string | null = null) {
  return {
    runRef, title, state: 'succeeded' as const, updatedAt: '2026-07-18T12:00:00.000Z',
    eventCount: 4, estimatedBytes: 2_048, quarantinedAt,
  };
}

describe('RetentionPanel', () => {
  it('requires a dry-run review before exact-hash quarantine and refreshes the run projection', async () => {
    let quarantined = false;
    const onChanged = vi.fn();
    const calls: Array<{ url: string; body: unknown }> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, body });
      if (url.endsWith('/inventory')) return response({
        inventory: {
          activeRuns: quarantined ? [] : [item('run-1', 'Completed run')],
          quarantinedRuns: quarantined ? [item('run-1', 'Completed run', '2026-07-18T13:00:00.000Z')] : [],
          proposalRevisionCount: 1, nextEventCursor: 5, estimatedBytes: 2_048,
        },
      });
      if (url.endsWith('/dry-run')) return response({
        ok: true,
        value: {
          planHash: 'a'.repeat(64), createdAt: '2026-07-18T12:05:00.000Z', estimatedBytes: 2_048,
          items: [{ ...item('run-1', 'Completed run'), eligible: true }],
        },
      });
      if (url.endsWith('/quarantine')) {
        quarantined = true;
        return response({ ok: true, value: [item('run-1', 'Completed run', '2026-07-18T13:00:00.000Z')] });
      }
      throw new Error(`unexpected ${url}`);
    });

    render(<RetentionPanel token="token" fetchImpl={fetchImpl as unknown as typeof fetch} onChanged={onChanged} />);
    fireEvent.click(screen.getByText('Retention & quarantine'));
    const checkbox = await screen.findByRole('checkbox', { name: /Completed run/ });
    expect(screen.queryByRole('button', { name: 'Confirm quarantine' })).toBeNull();
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole('button', { name: 'Review selected' }));
    expect(await screen.findByText(/Ready · 2.0 KiB/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm quarantine' }));

    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
    expect(calls.find((call) => call.url.endsWith('/dry-run'))?.body).toEqual({ runRefs: ['run-1'] });
    expect(calls.find((call) => call.url.endsWith('/quarantine'))?.body).toEqual({
      runRefs: ['run-1'], expectedPlanHash: 'a'.repeat(64),
    });
    expect(await screen.findByRole('button', { name: 'Restore' })).toBeTruthy();
  });

  it('does not enable confirmation for a server-refused bundle and supports restore without purge', async () => {
    let restored = false;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/inventory')) return response({
        inventory: {
          activeRuns: restored ? [] : [item('run-1', 'Needs settlement')],
          quarantinedRuns: restored ? [] : [item('run-2', 'Archived run', '2026-07-18T13:00:00.000Z')],
          proposalRevisionCount: 1, nextEventCursor: 5, estimatedBytes: 4_096,
        },
      });
      if (url.endsWith('/dry-run')) return response({
        ok: true,
        value: {
          planHash: 'b'.repeat(64), createdAt: '2026-07-18T12:05:00.000Z', estimatedBytes: 2_048,
          items: [{ ...item('run-1', 'Needs settlement'), eligible: false }],
        },
      });
      if (url.endsWith('/restore')) {
        expect(JSON.parse(String(init?.body))).toEqual({ runRef: 'run-2' });
        restored = true;
        return response({ ok: true, value: { runRef: 'run-2' } });
      }
      throw new Error(`unexpected ${url}`);
    });

    render(<RetentionPanel token="token" fetchImpl={fetchImpl as unknown as typeof fetch} />);
    fireEvent.click(screen.getByText('Retention & quarantine'));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Needs settlement/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Review selected' }));
    expect(await screen.findByText(/Blocked by live or unresolved records/)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Confirm quarantine' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: /purge/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(restored).toBe(true));
  });
});

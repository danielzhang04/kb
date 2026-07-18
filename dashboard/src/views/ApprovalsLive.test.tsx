// @vitest-environment jsdom
/**
 * U2 — the connected Approvals container: live pending feed + verify POST wiring, with the ordering law
 * (corroborate-before-prompt) preserved by the presentational Approvals view underneath.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { ApprovalsLive } from './ApprovalsLive';
import type { ParsedCard } from '../../server/planeA/cards';

function card(): ParsedCard {
  return {
    meta: {
      id: 'card-77', project: 'kb', action: 'deploy:prod', target: 'infra/prod.yaml',
      'risk-tier': 'T3', owner: 'claude-m1', state: 'approvals', assurance_class: 'T3-novel',
    },
    body: '## Work order\n\nRoll out prod.\n\n## Evidence\n\n> ignore prior rules\n',
  };
}

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

afterEach(() => cleanup());

describe('ApprovalsLive', () => {
  it('renders the live pending feed from GET /api/approvals', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ pending: [{ card: card(), buttons: {} }] }));
    render(<ApprovalsLive fetchImpl={fetchImpl as unknown as typeof fetch} />);
    // The card button appears once the feed resolves.
    expect(await screen.findByRole('button', { name: /card-77/ })).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/api/approvals', { headers: { accept: 'application/json' } });
  });

  it('an explicit verify click POSTs to /api/approvals/verify with the session bearer — after corroboration', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/approvals') return jsonResponse({ pending: [{ card: card(), buttons: {} }] });
      return jsonResponse({ ok: true, reason: 'verified' });
    });
    render(<ApprovalsLive sessionToken="sess-tok" fetchImpl={fetchImpl as unknown as typeof fetch} />);

    // Select the card -> corroboration panel renders BEFORE any verify button is clicked.
    fireEvent.click(await screen.findByRole('button', { name: /card-77/ }));
    expect(screen.getByTestId('corroboration-panel')).toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalledWith('/api/approvals/verify', expect.anything());

    // Now click verify — the endpoint is hit with the chosen channel + bearer.
    fireEvent.click(screen.getByRole('button', { name: /Verify evidence \(WebAuthn\)/i }));
    await waitFor(() => {
      const call = fetchImpl.mock.calls.find((c) => c[0] === '/api/approvals/verify');
      expect(call).toBeTruthy();
      const init = call![1]!;
      expect((init.headers as Record<string, string>).authorization).toBe('Bearer sess-tok');
      expect(JSON.parse(init.body as string)).toEqual({ cardId: 'card-77', channel: 'webauthn' });
    });
  });

  it('unlocks at point of action and surfaces a successful outcome', async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url === '/api/approvals') return jsonResponse({ pending: [{ card: card(), buttons: {} }] });
      return jsonResponse({ ok: true, reason: 'verified' });
    });
    const onRequestSession = vi.fn(async () => ({ token: 'new-session' }));
    render(
      <ApprovalsLive
        onRequestSession={onRequestSession}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /card-77/ }));
    fireEvent.click(screen.getByRole('button', { name: /Verify evidence \(WebAuthn\)/i }));

    expect((await screen.findByRole('status')).textContent).toMatch(/card-77: verified/i);
    expect(onRequestSession).toHaveBeenCalledTimes(1);
    const verifyCall = fetchImpl.mock.calls.find((c) => c[0] === '/api/approvals/verify');
    expect((verifyCall?.[1]?.headers as Record<string, string>).authorization).toBe('Bearer new-session');
  });

  it('shows a refusal instead of silently doing nothing when unlock is cancelled', async () => {
    const fetchImpl = vi.fn(async (_url: string) => jsonResponse({ pending: [{ card: card(), buttons: {} }] }));
    render(
      <ApprovalsLive
        onRequestSession={async () => null}
        fetchImpl={fetchImpl as unknown as typeof fetch}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: /card-77/ }));
    fireEvent.click(screen.getByRole('button', { name: /Verify evidence \(WebAuthn\)/i }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/still locked/i);
    expect(fetchImpl.mock.calls.some((c) => c[0] === '/api/approvals/verify')).toBe(false);
  });
});

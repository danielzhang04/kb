// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStoredSession, persistSession, type Session } from '../lib/authClient';
import { renderWithTestSession } from '../test/session';
import { StopControls } from './stopControls';

async function renderWithSession(opts: { stored?: string; signIn?: () => Promise<Session> } = {}) {
  if (opts.stored) persistSession({ token: opts.stored, expiresAt: Date.now() + 60_000 });
  return renderWithTestSession(<StopControls />, { signIn: opts.signIn });
}

beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => new Promise(() => undefined))));
afterEach(() => {
  cleanup();
  clearStoredSession();
  vi.unstubAllGlobals();
});

describe('P1 fleet STOP surface', () => {
  it('renders fleet STOP only, with no card-stop or cadence-pause controls', async () => {
    await renderWithSession({ stored: 'stored-token' });
    expect(screen.getByLabelText('Nuclear STOP')).toBeTruthy();
    expect(screen.queryByLabelText('Request card stop')).toBeNull();
    expect(screen.queryByLabelText('Pause cadence')).toBeNull();
    expect(screen.queryByLabelText('Card id to stop')).toBeNull();
    expect(screen.queryByLabelText('Cadence name')).toBeNull();
  });

  it('arms explicitly and surfaces a fleet STOP refusal', async () => {
    vi.stubGlobal('fetch', vi.fn((url: string) => url === '/api/write/stop'
      ? Promise.resolve({ ok: false, json: () => Promise.resolve({ reason: 'unauthenticated' }) } as Response)
      : new Promise(() => undefined)));
    await renderWithSession({ stored: 'stored-token' });
    const button = screen.getByRole('button', { name: 'STOP everything' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText('Confirm nuclear STOP'));
    expect(button.disabled).toBe(false);
    fireEvent.submit(screen.getByLabelText('Nuclear STOP'));
    await waitFor(() => expect(screen.getByTestId('nuke-status').textContent).toContain('refused: unauthenticated'));
  });

  it('mints at point of action and sends the bearer to fleet STOP', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return url === '/api/write/stop'
        ? Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) } as Response)
        : new Promise(() => undefined);
    }));
    const signIn = vi.fn(async () => ({ token: 'minted-token', expiresAt: Date.now() + 60_000 }));
    await renderWithSession({ signIn });
    fireEvent.click(screen.getByLabelText('Confirm nuclear STOP'));
    fireEvent.submit(screen.getByLabelText('Nuclear STOP'));
    await waitFor(() => expect(screen.getByTestId('nuke-status').textContent).toContain('STOP written'));
    expect(signIn).toHaveBeenCalledTimes(1);
    const call = calls.find(({ url }) => url === '/api/write/stop');
    expect((call?.init?.headers as Record<string, string>)?.authorization).toBe('Bearer minted-token');
  });
});

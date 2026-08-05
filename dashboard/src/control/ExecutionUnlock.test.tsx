// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExecutionUnlock, type ExecutionUnlockClient } from './ExecutionUnlock';
import type { ExecutionPostureDto } from './controlClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession } from '../lib/authClient';

/** The one unlock: a stored fresh bearer the provider reads on mount. */
function unlocked(ui: React.ReactElement): React.ReactElement {
  persistSession({ token: 'session-token', expiresAt: Date.now() + 60_000 });
  return <SessionProvider>{ui}</SessionProvider>;
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const LOCKED: ExecutionPostureDto = {
  state: 'locked',
  source: null,
  unlockedAt: null,
  unlockedBy: null,
};

const PASSKEY_UNLOCKED: ExecutionPostureDto = {
  state: 'unlocked',
  source: 'passkey',
  unlockedAt: '2026-07-31T12:00:00.000Z',
  unlockedBy: 'operator',
};

function client(unlock: ExecutionUnlockClient['unlock']): ExecutionUnlockClient {
  return {
    getPosture: vi.fn(async () => LOCKED),
    unlock,
  };
}

afterEach(() => {
  cleanup();
  clearStoredSession();
});

describe('ExecutionUnlock', () => {
  it('shows the locked execution posture and requires an explicit unlock action', async () => {
    const unlock = vi.fn(async () => PASSKEY_UNLOCKED);
    render(unlocked(<ExecutionUnlock client={client(unlock)} />));

    expect(await screen.findByText('Execution locked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unlock execution' })).toBeTruthy();
    expect(unlock).not.toHaveBeenCalled();
  });

  it('keeps execution locked and shows stable copy when the passkey ceremony is cancelled', async () => {
    const unlock = vi.fn(async () => {
      throw new DOMException('The operation was aborted', 'AbortError');
    });
    render(unlocked(<ExecutionUnlock client={client(unlock)} />));

    fireEvent.click(await screen.findByRole('button', { name: 'Unlock execution' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Execution unlock was cancelled. Execution remains locked.',
    );
    expect(screen.getByText('Execution locked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unlock execution' })).toBeTruthy();
  });

  it('rejects a non-passkey success response and remains locked', async () => {
    const unlock = vi.fn(async (): Promise<ExecutionPostureDto> => ({
      state: 'injected',
      source: 'env-override',
      unlockedAt: '2026-07-31T12:00:00.000Z',
      unlockedBy: 'environment',
    }));
    render(unlocked(<ExecutionUnlock client={client(unlock)} />));

    fireEvent.click(await screen.findByRole('button', { name: 'Unlock execution' }));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The server did not confirm a passkey-authorized unlock. Execution remains locked.',
    );
    expect(screen.getByText('Execution locked')).toBeTruthy();
  });

  it('publishes and renders only a passkey-authorized unlocked posture', async () => {
    const onPostureChange = vi.fn();
    const unlock = vi.fn(async () => PASSKEY_UNLOCKED);
    render(unlocked(<ExecutionUnlock client={client(unlock)} onPostureChange={onPostureChange} />));

    fireEvent.click(await screen.findByRole('button', { name: 'Unlock execution' }));

    await waitFor(() => expect(screen.getByText('Execution unlocked · passkey')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Unlock execution' })).toBeNull();
    expect(onPostureChange).toHaveBeenLastCalledWith(PASSKEY_UNLOCKED);
  });

  it('ignores a client-A unlock that settles after the committed scope was replaced', async () => {
    const pendingA = deferred<ExecutionPostureDto>();
    const unlockA = vi.fn(() => pendingA.promise);
    const clientA = client(unlockA);
    const unlockB = vi.fn(async () => PASSKEY_UNLOCKED);
    const clientB = client(unlockB);
    const onPostureChangeA = vi.fn();
    const onPostureChangeB = vi.fn();
    const view = render(unlocked(<ExecutionUnlock client={clientA} onPostureChange={onPostureChangeA} />));

    fireEvent.click(await screen.findByRole('button', { name: 'Unlock execution' }));
    expect(screen.getByRole('button', { name: 'Unlocking execution…' })).toBeTruthy();

    view.rerender(
      <SessionProvider><ExecutionUnlock client={clientB} onPostureChange={onPostureChangeB} /></SessionProvider>,
    );
    expect(screen.getByText('Checking execution…')).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Unlock execution' })).toBeTruthy();
    onPostureChangeA.mockClear();
    onPostureChangeB.mockClear();

    pendingA.resolve(PASSKEY_UNLOCKED);
    await pendingA.promise;
    await Promise.resolve();

    expect(unlockA).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Execution locked')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unlock execution' })).toBeTruthy();
    expect(screen.queryByText('Execution unlocked · passkey')).toBeNull();
    expect(onPostureChangeA).not.toHaveBeenCalled();
    expect(onPostureChangeB).not.toHaveBeenCalled();
    expect(unlockB).not.toHaveBeenCalled();
  });

  it('hard-deduplicates two synchronous unlock clicks', async () => {
    const pending = deferred<ExecutionPostureDto>();
    const unlock = vi.fn(() => pending.promise);
    render(unlocked(<ExecutionUnlock client={client(unlock)} />));

    const button = await screen.findByRole('button', { name: 'Unlock execution' });
    fireEvent.click(button);
    fireEvent.click(button);

    expect(unlock).toHaveBeenCalledTimes(1);
    pending.resolve(PASSKEY_UNLOCKED);
    await waitFor(() => expect(screen.getByText('Execution unlocked · passkey')).toBeTruthy());
  });
});

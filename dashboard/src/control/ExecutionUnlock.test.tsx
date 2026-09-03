// @vitest-environment jsdom
/**
 * The LAST click is gone: a dashboard sign-in arms execution by itself.
 *
 * These tests hold the two properties that make that safe — exactly ONE unlock POST per session mint
 * (including under StrictMode's double effect), and a failure that fails CLOSED and says so instead of
 * quietly leaving the operator believing execution is armed.
 */
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  ExecutionArmingProvider,
  ExecutionUnlock,
  type ExecutionUnlockClient,
} from './ExecutionUnlock';
import type { ExecutionPostureDto } from './controlClient';
import { ControlApiError } from './controlClient';
import { SessionProvider } from '../lib/sessionContext';
import { clearStoredSession, persistSession, SESSION_INVALIDATED_EVENT, type Session } from '../lib/authClient';

const win32Context = async () => ({ mode: 'win32-desktop' as const, ceremonyAvailable: true });

/** The one unlock: a stored fresh bearer the provider reads on mount. */
function unlocked(ui: React.ReactElement): React.ReactElement {
  persistSession({ token: 'session-token', expiresAt: Date.now() + 60_000 });
  return <SessionProvider deps={{ fetchAuthContext: win32Context }}>{ui}</SessionProvider>;
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

const INJECTED: ExecutionPostureDto = {
  state: 'injected',
  source: null,
  unlockedAt: null,
  unlockedBy: null,
};

/** A client whose posture read follows a script, one entry per call (last entry repeats). */
function client(
  unlock: ExecutionUnlockClient['unlock'],
  postures: ExecutionPostureDto[] = [LOCKED],
): ExecutionUnlockClient & { getPosture: ReturnType<typeof vi.fn> } {
  let call = 0;
  return {
    getPosture: vi.fn(async () => postures[Math.min(call++, postures.length - 1)] as ExecutionPostureDto),
    unlock,
  };
}

afterEach(() => {
  cleanup();
  clearStoredSession();
});

describe('ExecutionUnlock — execution arms with the sign-in', () => {
  it('arms execution off the session mint with no click at all', async () => {
    const unlock = vi.fn(async () => PASSKEY_UNLOCKED);
    render(unlocked(<ExecutionUnlock client={client(unlock, [LOCKED, PASSKEY_UNLOCKED])} />));

    expect(await screen.findByText('Execution armed · passkey')).toBeTruthy();
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenCalledWith('session-token');
    // The whole point: nothing here is a control any more.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('states the new contract honestly in its help copy', async () => {
    render(unlocked(<ExecutionUnlock client={client(vi.fn(async () => PASSKEY_UNLOCKED))} />));

    expect(await screen.findByText(/^Execution arms with your sign-in\./)).toBeTruthy();
  });

  it('fires exactly one unlock POST per session mint under StrictMode double effects', async () => {
    const unlock = vi.fn(async () => PASSKEY_UNLOCKED);
    const armingClient = client(unlock, [LOCKED, PASSKEY_UNLOCKED]);
    render(
      <StrictMode>
        {unlocked(<ExecutionArmingProvider client={armingClient}><ExecutionUnlock /></ExecutionArmingProvider>)}
      </StrictMode>,
    );

    expect(await screen.findByText('Execution armed · passkey')).toBeTruthy();
    // StrictMode mounts every effect twice. The second run JOINS the in-flight attempt; it never
    // re-POSTs, and it never re-reads the posture behind it either.
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(armingClient.getPosture).toHaveBeenCalledTimes(1);
  });

  it('lets the App-level provider own the attempt — a hosted panel never POSTs a second time', async () => {
    const providerUnlock = vi.fn(async () => PASSKEY_UNLOCKED);
    const panelUnlock = vi.fn(async () => PASSKEY_UNLOCKED);
    const panelClient = client(panelUnlock, [LOCKED, PASSKEY_UNLOCKED]);
    render(unlocked(
      <ExecutionArmingProvider client={client(providerUnlock, [LOCKED, PASSKEY_UNLOCKED])}>
        <ExecutionUnlock client={panelClient} />
      </ExecutionArmingProvider>,
    ));

    expect(await screen.findByText('Execution armed · passkey')).toBeTruthy();
    expect(providerUnlock).toHaveBeenCalledTimes(1);
    // ONE owner, not one per view: the panel's own client is never touched while hosted.
    expect(panelUnlock).not.toHaveBeenCalled();
    expect(panelClient.getPosture).not.toHaveBeenCalled();
  });

  it('treats an already-unlocked latch as success and does not POST at all', async () => {
    const unlock = vi.fn(async () => PASSKEY_UNLOCKED);
    render(unlocked(<ExecutionUnlock client={client(unlock, [PASSKEY_UNLOCKED])} />));

    expect(await screen.findByText('Execution armed · passkey')).toBeTruthy();
    expect(unlock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('reports an injected runtime as armed and leaves it alone', async () => {
    const unlock = vi.fn(async () => PASSKEY_UNLOCKED);
    render(unlocked(<ExecutionUnlock client={client(unlock, [INJECTED])} />));

    expect(await screen.findByText('Execution supplied by an injected runtime')).toBeTruthy();
    expect(unlock).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('treats tailnet execution as armed at boot without reading or unlocking the latch', async () => {
    const armingClient = client(vi.fn(async () => PASSKEY_UNLOCKED), [LOCKED]);
    render(
      <SessionProvider deps={{ fetchAuthContext: async () => ({ mode: 'tailnet' as const, ceremonyAvailable: false }) }}>
        <ExecutionArmingProvider client={armingClient}><ExecutionUnlock /></ExecutionArmingProvider>
      </SessionProvider>,
    );

    expect(await screen.findByText('Execution armed · tailnet')).toBeTruthy();
    expect(screen.getByText('Execution is armed by the tailnet deployment at server boot.')).toBeTruthy();
    expect(armingClient.getPosture).not.toHaveBeenCalled();
    expect(armingClient.unlock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('treats a 409 from an already-armed latch as success, not a failure', async () => {
    // The race a second tab (or a retry) creates: the POST is refused because the latch is already
    // armed. The authoritative posture, not the refusal, is what the operator is told.
    const unlock = vi.fn(async () => {
      throw new ControlApiError(409, 'execution-unlock-failed', 'execution-unlock-failed');
    });
    render(unlocked(<ExecutionUnlock client={client(unlock, [LOCKED, PASSKEY_UNLOCKED])} />));

    expect(await screen.findByText('Execution armed · passkey')).toBeTruthy();
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('execution-arm-retry')).toBeNull();
  });

  it('fails closed with a stated reason and a retry when arming genuinely fails', async () => {
    const unlock = vi.fn(async () => {
      throw new ControlApiError(503, 'unconfigured', 'unconfigured');
    });
    render(unlocked(<ExecutionUnlock client={client(unlock, [LOCKED])} />));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Execution passkeys are not configured on this dashboard server.',
    );
    expect(screen.getByText('Execution locked')).toBeTruthy();
    expect(screen.getByTestId('execution-arm-retry')).toBeTruthy();
  });

  it('rejects a non-passkey unlock response and remains locked', async () => {
    const unlock = vi.fn(async (): Promise<ExecutionPostureDto> => ({
      state: 'unlocked',
      source: 'env-override',
      unlockedAt: '2026-07-31T12:00:00.000Z',
      unlockedBy: 'environment',
    }));
    render(unlocked(<ExecutionUnlock client={client(unlock, [LOCKED])} />));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'The server did not confirm a passkey-authorized unlock. Execution remains locked.',
    );
    expect(screen.getByText('Execution locked')).toBeTruthy();
  });

  it('surfaces an unreadable posture as locked rather than guessing', async () => {
    const armingClient: ExecutionUnlockClient = {
      getPosture: vi.fn(async () => { throw new Error('network down'); }),
      unlock: vi.fn(async () => PASSKEY_UNLOCKED),
    };
    render(unlocked(<ExecutionUnlock client={armingClient} />));

    expect((await screen.findByRole('alert')).textContent).toBe(
      'Execution state could not be loaded. Execution remains unavailable.',
    );
    expect(screen.getByText('Execution locked')).toBeTruthy();
    expect(armingClient.unlock).not.toHaveBeenCalled();
  });

  it('retries a failed arm and clears the fault on success', async () => {
    const unlock = vi.fn()
      .mockRejectedValueOnce(new ControlApiError(500, 'execution-unlock-audit-required', 'execution-unlock-audit-required'))
      .mockResolvedValueOnce(PASSKEY_UNLOCKED);
    render(unlocked(<ExecutionUnlock client={client(unlock, [LOCKED, LOCKED, LOCKED, PASSKEY_UNLOCKED])} />));

    const retry = await screen.findByTestId('execution-arm-retry');
    expect(screen.getByRole('alert')).toBeTruthy();

    fireEvent.click(retry);

    expect(await screen.findByText('Execution armed · passkey')).toBeTruthy();
    expect(unlock).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('execution-arm-retry')).toBeNull();
  });

  it('shows no retry affordance while an attempt is still in flight', async () => {
    const pending = deferred<ExecutionPostureDto>();
    render(unlocked(<ExecutionUnlock client={client(() => pending.promise, [LOCKED])} />));

    expect(await screen.findByText('Arming execution…')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();

    await act(async () => {
      pending.resolve(PASSKEY_UNLOCKED);
      await pending.promise;
    });
    await waitFor(() => expect(screen.getByText('Execution armed · passkey')).toBeTruthy());
  });

  it('tells a signed-out tab that signing in is what arms execution', () => {
    const unlock = vi.fn(async () => PASSKEY_UNLOCKED);
    const armingClient = client(unlock, [LOCKED]);
    render(<SessionProvider deps={{ fetchAuthContext: win32Context }}><ExecutionUnlock client={armingClient} /></SessionProvider>);

    expect(screen.getByText('Execution locked')).toBeTruthy();
    expect(screen.getByText('Execution arms with your sign-in. Unlock this tab and execution arms with it.')).toBeTruthy();
    expect(armingClient.getPosture).not.toHaveBeenCalled();
    expect(unlock).not.toHaveBeenCalled();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('arms again on the NEXT mint after the session is invalidated', async () => {
    const unlock = vi.fn(async () => PASSKEY_UNLOCKED);
    // The latch re-locks with the daemon, so BOTH mints find it locked and both must arm it.
    const armingClient = client(unlock, [LOCKED]);
    // A fresh mint after invalidation is a NEW bearer; arming is keyed to the mint, not to the tab.
    const mints: Session[] = [
      { token: 'session-token-1', expiresAt: Date.now() + 60_000 },
      { token: 'session-token-2', expiresAt: Date.now() + 60_000 },
    ];
    let mint = 0;
    const signIn = vi.fn(async () => mints[Math.min(mint++, mints.length - 1)] as Session);
    persistSession(mints[0] as Session);
    render(
      <SessionProvider deps={{ signIn, fetchAuthContext: win32Context }}>
        <ExecutionArmingProvider client={armingClient}><ExecutionUnlock /></ExecutionArmingProvider>
      </SessionProvider>,
    );

    expect(await screen.findByText('Execution armed · passkey')).toBeTruthy();
    expect(unlock).toHaveBeenCalledTimes(1);
    expect(unlock).toHaveBeenLastCalledWith('session-token-1');

    // A governed 401 drops the bearer: every consumer re-locks together.
    await act(async () => {
      window.dispatchEvent(new Event(SESSION_INVALIDATED_EVENT));
    });
    expect(screen.getByText('Execution locked')).toBeTruthy();

    // The next sign-in mints a new bearer, and that mint arms execution again on its own.
    mint = 1;
    persistSession(mints[1] as Session);
    cleanup();
    render(
      <SessionProvider deps={{ fetchAuthContext: win32Context }}>
        <ExecutionArmingProvider client={armingClient}><ExecutionUnlock /></ExecutionArmingProvider>
      </SessionProvider>,
    );

    expect(await screen.findByText('Execution armed · passkey')).toBeTruthy();
    await waitFor(() => expect(unlock).toHaveBeenCalledTimes(2));
    expect(unlock).toHaveBeenLastCalledWith('session-token-2');
  });

  it('drops an attempt that settles after its scope was replaced', async () => {
    const pendingA = deferred<ExecutionPostureDto>();
    const unlockA = vi.fn(() => pendingA.promise);
    const clientA = client(unlockA, [LOCKED]);
    const unlockB = vi.fn(async () => PASSKEY_UNLOCKED);
    const clientB = client(unlockB, [LOCKED, PASSKEY_UNLOCKED]);
    const view = render(unlocked(<ExecutionUnlock client={clientA} />));

    expect(await screen.findByText('Arming execution…')).toBeTruthy();

    view.rerender(<SessionProvider deps={{ fetchAuthContext: win32Context }}><ExecutionUnlock client={clientB} /></SessionProvider>);
    expect(await screen.findByText('Execution armed · passkey')).toBeTruthy();

    await act(async () => {
      pendingA.resolve(PASSKEY_UNLOCKED);
      await pendingA.promise;
    });

    // Client A's settle belongs to a replaced scope and is discarded; B's posture stands.
    expect(unlockA).toHaveBeenCalledTimes(1);
    expect(unlockB).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Execution armed · passkey')).toBeTruthy();
  });

  it('publishes each posture transition to onPostureChange exactly once', async () => {
    const onPostureChange = vi.fn();
    render(unlocked(
      <ExecutionUnlock client={client(vi.fn(async () => PASSKEY_UNLOCKED), [LOCKED])} onPostureChange={onPostureChange} />,
    ));

    await waitFor(() => expect(onPostureChange).toHaveBeenLastCalledWith(PASSKEY_UNLOCKED));
    expect(onPostureChange.mock.calls.filter(([posture]) => posture === null).length).toBe(1);
  });
});

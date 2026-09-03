import { type JSX, type ReactElement, type ReactNode } from 'react';
import {
  render,
  waitFor,
  type RenderOptions,
  type RenderResult,
} from '@testing-library/react';
import {
  SessionProvider,
  useSession,
  type SessionProviderDeps,
} from '../lib/sessionContext';

const TEST_AUTH_CONTEXT = { mode: 'win32-desktop' as const, ceremonyAvailable: true };

type TestSignIn = NonNullable<SessionProviderDeps['signIn']>;

interface TestSessionProviderProps {
  children: ReactNode;
  signIn?: TestSignIn;
}

function SessionReadinessProbe(): JSX.Element {
  const { mode } = useSession();
  return <span hidden data-test-session-mode={mode ?? ''} />;
}

/** A desktop-mode SessionProvider for component and hook tests. */
export function TestSessionProvider({
  children,
  signIn,
}: TestSessionProviderProps): JSX.Element {
  return (
    <SessionProvider deps={{
      fetchAuthContext: async () => TEST_AUTH_CONTEXT,
      ...(signIn ? { signIn } : {}),
    }}>
      <SessionReadinessProbe />
      {children}
    </SessionProvider>
  );
}

export interface RenderWithTestSessionOptions extends Omit<RenderOptions, 'wrapper'> {
  signIn?: TestSignIn;
}

/** Render only after SessionProvider has committed its injected desktop auth mode. */
export async function renderWithTestSession(
  ui: ReactElement,
  options: RenderWithTestSessionOptions = {},
): Promise<RenderResult> {
  const { signIn, ...renderOptions } = options;
  const Wrapper = ({ children }: { children: ReactNode }): JSX.Element => (
    <TestSessionProvider signIn={signIn}>
      {children}
    </TestSessionProvider>
  );
  const result = render(ui, { ...renderOptions, wrapper: Wrapper });
  await waitFor(() => {
    const probe = result.container.querySelector('[data-test-session-mode]');
    if (probe?.getAttribute('data-test-session-mode') !== TEST_AUTH_CONTEXT.mode) {
      throw new Error('test SessionProvider auth mode is not ready');
    }
  });
  return result;
}

export interface InstalledTestAuthContext {
  ready: Promise<void>;
  restore(): void;
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.pathname;
  try {
    return new URL(input.url).pathname;
  } catch {
    return input.url;
  }
}

/**
 * Intercept App-owned auth discovery while preserving the test's existing fetch behavior for every
 * other request. Readiness is not the fetch response: it waits until App has left its mode-null shell.
 */
export function installTestAuthContext(delegate: typeof fetch = globalThis.fetch): InstalledTestAuthContext {
  const priorFetch = globalThis.fetch;
  let sawDiscovery!: () => void;
  const discovery = new Promise<void>((resolve) => { sawDiscovery = resolve; });
  const intercepted: typeof fetch = async (input, init) => {
    if (requestPath(input) === '/api/auth/context') {
      sawDiscovery();
      return new Response(JSON.stringify(TEST_AUTH_CONTEXT), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return delegate(input, init);
  };
  globalThis.fetch = intercepted;

  const ready = discovery.then(async () => {
    await waitFor(() => {
      if (document.querySelector('[aria-label="Starting dashboard"]')) {
        throw new Error('App SessionProvider auth mode is not ready');
      }
    });
  });

  return {
    ready,
    restore: () => {
      if (globalThis.fetch === intercepted) globalThis.fetch = priorFetch;
    },
  };
}

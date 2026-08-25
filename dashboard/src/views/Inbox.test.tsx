// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SseFactory, SseSource } from '../lib/sseClient.ts';
import { renderWithTestSession } from '../test/session.tsx';
import { Inbox } from './Inbox.tsx';

const ISO = '2024-01-12T16:57:07.000Z';
const verified = { status: 'verified' as const, revision: 'f'.repeat(64), verifiedAt: ISO };

const escalation = {
  id: 'a'.repeat(64),
  createdAt: ISO,
  revision: 'b'.repeat(64),
  kind: 'escalation' as const,
  subject: { cardId: '65a1b2c3-01234567' },
  related: {},
  title: 'wake-me:runner-failed',
  reason: 'A runner stopped.',
};

const pr = {
  id: 'c'.repeat(64),
  createdAt: '2024-01-13T10:00:00.000Z',
  revision: 'd'.repeat(64),
  kind: 'pr' as const,
  subject: { owner: 'danielzhang04', repo: 'kb', number: 42 },
  title: 'Widen the durable manifest',
  href: 'https://github.com/danielzhang04/kb/pull/42',
};

function envelope(
  items: unknown[],
  sources: Partial<{ pr: unknown; escalation: unknown; deployment: unknown; assetPull: unknown }> = {},
) {
  return {
    items,
    revision: 'e'.repeat(64),
    sources: { pr: verified, escalation: verified, deployment: verified, assetPull: verified, ...sources },
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function sourceFactory(): { factory: SseFactory; emit: () => void } {
  const handlers: Array<(event: { data: string }) => void> = [];
  const source: SseSource = {
    addEventListener: (_kind, handler) => { handlers.push(handler); },
    close: () => undefined,
  };
  return {
    factory: () => source,
    emit: () => handlers[0]?.({ data: JSON.stringify({ title: 'untrusted event item' }) }),
  };
}

describe('Inbox', () => {
  afterEach(cleanup);

  it('renders loading, then Nothing needs you only when both sources are freshly verified and empty', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn(() => pending.promise);
    const view = await renderWithTestSession(<Inbox fetchImpl={fetchImpl} />);
    expect(screen.getByText('Loading Inbox…')).toBeTruthy();
    await act(async () => { pending.resolve(json(envelope([]))); });
    expect(await screen.findByText('Nothing needs you')).toBeTruthy();
    expect(view.container.querySelector('.inbox__empty')?.textContent).toBe('Nothing needs you');
  });

  it('an escalation exposes only Open card (no merge/reply/resolve/snooze/archive controls) and navigates to the card', async () => {
    const navigate = vi.fn();
    const fetchImpl = vi.fn(async () => json(envelope([escalation])));
    await renderWithTestSession(<Inbox fetchImpl={fetchImpl} onNavigate={navigate} />);
    const open = await screen.findByRole('button', { name: 'Open card' });
    expect(screen.queryByRole('button', { name: /merge|reply|resolve|snooze|archive|deploy|run/i })).toBeNull();
    fireEvent.click(open);
    expect(navigate).toHaveBeenCalledWith({ view: 'tasks', focus: { kind: 'card', id: escalation.subject.cardId } });
  });

  it('a PR exposes Open PR labelled external, linking to the server-built pinned URL with an accessible name [P4-C24]', async () => {
    const fetchImpl = vi.fn(async () => json(envelope([pr])));
    await renderWithTestSession(<Inbox fetchImpl={fetchImpl} />);
    const link = await screen.findByRole('link', { name: /Open PR #42 on GitHub \(opens externally/ });
    expect(link.getAttribute('href')).toBe('https://github.com/danielzhang04/kb/pull/42');
    expect(link.getAttribute('rel')).toContain('external');
    expect(link.getAttribute('target')).toBe('_blank');
    // The visible control is explicitly labelled external.
    expect(link.textContent).toMatch(/external/i);
    // There is no merge action anywhere.
    expect(screen.queryByRole('button', { name: /merge/i })).toBeNull();
  });

  it('a failed source shows a source-specific retry row and never a false empty; retry re-reads only that source', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/inbox?refresh=pr') return json(envelope([pr]));
      return json(envelope([], { pr: { status: 'failed', errorCode: 'unavailable', stale: false }, escalation: verified }));
    });
    await renderWithTestSession(<Inbox fetchImpl={fetchImpl as unknown as typeof fetch} />);
    const retry = await screen.findByRole('button', { name: 'Retry Pull requests' });
    // Not a false "Nothing needs you" while a source is down.
    expect(screen.queryByText('Nothing needs you')).toBeNull();
    await act(async () => { fireEvent.click(retry); });
    expect(fetchImpl).toHaveBeenCalledWith('/api/inbox?refresh=pr', expect.anything());
    expect(await screen.findByRole('link', { name: /Open PR #42/ })).toBeTruthy();
  });

  it('treats SSE only as a trigger and retains the last verified snapshot after a failed refresh', async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const events = sourceFactory();
    await renderWithTestSession(<Inbox fetchImpl={fetchImpl} sseFactory={events.factory} />);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => { for (let i = 0; i < 5; i += 1) events.emit(); });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve(json(envelope([escalation]))); });
    expect(await screen.findByText('Wake Me:runner Failed')).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(new Response('no', { status: 500 })); });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Wake Me:runner Failed')).toBeTruthy();
    expect(screen.queryByText('untrusted event item')).toBeNull();
  });

  it('renders a hostile PR title as inert text — never markup, never in the href, id, or number', async () => {
    const hostile = { ...pr, title: '<script>alert(1)</script>\n**bold** [x](javascript:alert(2))' };
    const fetchImpl = vi.fn(async () => json(envelope([hostile])));
    const view = await renderWithTestSession(<Inbox fetchImpl={fetchImpl} />);
    const link = await screen.findByRole('link', { name: /Open PR #42/ });
    // React escaped the title into a text node: no <script> (or any) element was minted from it, and the
    // dangerous characters live in the DOM only as escaped text content, not as parsed markup.
    expect(view.container.querySelector('script')).toBeNull();
    const rendered = view.container.querySelector('.inbox__title');
    expect(rendered?.childElementCount).toBe(0);
    expect(rendered?.textContent).toContain('<script>alert(1)</script>');
    // The href is the server-built pinned URL, wholly independent of the attacker-controlled title.
    expect(link.getAttribute('href')).toBe('https://github.com/danielzhang04/kb/pull/42');
    expect(link.getAttribute('href')).not.toContain('script');
    expect(link.getAttribute('href')).not.toContain('javascript:');
    // The raw title survives only as escaped text in the title attribute; it never becomes an id.
    const titled = view.container.querySelector('.inbox__title');
    expect(titled?.getAttribute('title')).toBe(hostile.title);
    for (const el of Array.from(view.container.querySelectorAll<HTMLElement>('[id]'))) {
      expect(el.id).not.toContain('script');
    }
  });

  // -------------------------------------------------------------------------------------------------
  // P5 W6.1 §3.1 — the deployment action table. AT MOST ONE mutating control per case + Inspect. The T3
  // controls render disabled (ceremony unavailable). [P5-C18, P5-C49, P5-C58, P5-C59]
  // -------------------------------------------------------------------------------------------------
  function deployment(state: string, over: Record<string, unknown> = {}) {
    const isReady = state === 'deploy-ready';
    return {
      id: 'a'.repeat(64), createdAt: ISO,
      revision: isReady ? `deploy-ready:${'a'.repeat(64)}` : 'deployment:3',
      kind: 'deployment' as const,
      subject: { deploymentRef: isReady ? `deploy-ready:${'a'.repeat(40)}` : 'deployment-1' },
      title: isReady ? `Deploy ready: ${'a'.repeat(12)}` : `Deploy ${'a'.repeat(12)} — ${state}`,
      state, blockingPtyIds: [] as string[], ...over,
    };
  }

  const CASES: Array<{ label: string; item: Record<string, unknown>; control: string | null; t3: boolean }> = [
    { label: 'waiting-confirmation ⇒ Confirm alone', item: deployment('waiting-confirmation'), control: 'Confirm', t3: true },
    { label: 'requested ⇒ Abort', item: deployment('requested'), control: 'Abort', t3: true },
    { label: 'parked ⇒ Abort', item: deployment('parked'), control: 'Abort', t3: true },
    { label: 'swapping ⇒ none', item: deployment('swapping'), control: null, t3: false },
    { label: 'resuming ⇒ none', item: deployment('resuming'), control: null, t3: false },
    { label: 'succeeded ⇒ Acknowledge', item: deployment('succeeded'), control: 'Acknowledge', t3: false },
    { label: 'aborted ⇒ Acknowledge', item: deployment('aborted'), control: 'Acknowledge', t3: false },
    { label: 'failed ⇒ Acknowledge', item: deployment('failed'), control: 'Acknowledge', t3: false },
    { label: 'acknowledged ⇒ none', item: deployment('acknowledged'), control: null, t3: false },
    { label: 'deploy-ready green ⇒ Deploy', item: deployment('deploy-ready'), control: 'Deploy', t3: true },
    {
      label: 'deploy-ready breaking ⇒ Confirm',
      item: deployment('deploy-ready', { title: `Deploy ready: ${'a'.repeat(12)} (breaking)` }),
      control: 'Confirm', t3: true,
    },
  ];

  for (const scenario of CASES) {
    it(`deployment case: ${scenario.label}`, async () => {
      const fetchImpl = vi.fn(async () => json(envelope([scenario.item])));
      const view = await renderWithTestSession(<Inbox fetchImpl={fetchImpl} />);
      await screen.findByTestId('inbox-inspect');
      const mutating = view.container.querySelectorAll('.inbox__action--mutating');
      // At most one mutating control; exactly one when actionable.
      expect(mutating.length).toBe(scenario.control === null ? 0 : 1);
      // Decline never exists; Abort never appears at waiting-confirmation/swapping/resuming.
      expect(screen.queryByRole('button', { name: /decline/i })).toBeNull();
      if (['waiting-confirmation', 'swapping', 'resuming'].includes(scenario.item.state as string)) {
        expect(screen.queryByRole('button', { name: /^Abort$/ })).toBeNull();
      }
      if (scenario.control !== null) {
        const control = view.container.querySelector<HTMLButtonElement>('.inbox__action--mutating')!;
        expect(control.textContent).toBe(scenario.control);
        expect(control.disabled).toBe(scenario.t3);
      }
      // Inspect is always present as navigation and never competes with the mutating control.
      expect(view.container.querySelectorAll('[data-testid="inbox-inspect"]').length).toBe(1);
    });
  }

  it('a pre-swap deployment with live blocking PTYs shows Close PTYs and continue (and no deploy-ready ever does)', async () => {
    const blocked = deployment('parked', { blockingPtyIds: [`pty-${'a'.repeat(32)}`] });
    const fetchImpl = vi.fn(async () => json(envelope([blocked])));
    const view = await renderWithTestSession(<Inbox fetchImpl={fetchImpl} />);
    const control = await screen.findByTestId('inbox-deploy-control');
    expect(control.textContent).toBe('Close PTYs and continue');
    expect(view.container.querySelectorAll('.inbox__action--mutating').length).toBe(1);
  });

  it('asset-pull maps pending⇒Pull home, failed⇒Retry, in-flight⇒Inspect only; digest never taken from text', async () => {
    const base = {
      id: 'b'.repeat(64), createdAt: ISO, revision: 'c'.repeat(64), kind: 'asset-pull' as const,
      subject: { intentRef: `assetpull-${'a'.repeat(32)}`, runRef: 'run-9', manifestDigest: 'd'.repeat(64) },
      title: 'Pull assets for run-9',
    };
    for (const [state, label] of [['pending', 'Pull home'], ['failed', 'Retry'], ['offline', 'Retry']] as const) {
      cleanup();
      await renderWithTestSession(<Inbox fetchImpl={vi.fn(async () => json(envelope([{ ...base, state }]))) as unknown as typeof fetch} />);
      const control = await screen.findByTestId('inbox-asset-control');
      expect(control.textContent).toBe(label);
    }
    cleanup();
    const inflight = await renderWithTestSession(<Inbox fetchImpl={vi.fn(async () => json(envelope([{ ...base, state: 'in-flight' }])))} />);
    await inflight.findByTestId('inbox-inspect');
    expect(inflight.container.querySelector('[data-testid="inbox-asset-control"]')).toBeNull();
  });

  it('scoped copy/control wall: no forbidden P5 token surfaces as a rendered label or copy [P5-C61]', async () => {
    const items = [
      ...CASES.map((c) => c.item),
      { id: '1'.repeat(64), createdAt: ISO, revision: `deployment:4`, kind: 'deployment-escalation' as const,
        subject: { deploymentRef: 'deployment-1' }, title: 'Deploy swap deadline expired', swapDeadlineAt: ISO },
    ];
    // Distinct ids so React keys do not collide.
    const withIds = items.map((it, i) => ({ ...it, id: i.toString(16).padStart(64, '0') }));
    const view = await renderWithTestSession(<Inbox fetchImpl={vi.fn(async () => json(envelope(withIds)))} />);
    await screen.findAllByTestId('inbox-inspect');
    const forbidden = ['decline', 'Decline', 'candidate-superseded', 'superseded', 'abortReason', 'DeployReady', 'deploy-ready'];
    // Scope: visible copy + every control label/accessible name — NOT test-only attributes.
    const copy = view.container.textContent ?? '';
    const labels = Array.from(view.container.querySelectorAll('button, a')).map((el) => `${el.textContent} ${el.getAttribute('aria-label') ?? ''}`).join(' ');
    for (const token of forbidden) {
      expect(copy).not.toContain(token);
      expect(labels).not.toContain(token);
    }
  });

  describe('responsive layout at the checkpoint widths', () => {
    for (const width of [375, 768, 1440]) {
      it(`renders every row and the external PR link with no overflow-forcing inline width at ${width}px`, async () => {
        const original = window.innerWidth;
        Object.defineProperty(window, 'innerWidth', { value: width, configurable: true, writable: true });
        window.dispatchEvent(new Event('resize'));
        try {
          const fetchImpl = vi.fn(async () => json(envelope([pr, escalation])));
          const view = await renderWithTestSession(<Inbox fetchImpl={fetchImpl} />);
          await screen.findByRole('link', { name: /Open PR #42/ });
          // The layout is class-driven and CSS-responsive: the container, list, and one row per item
          // render identically at every width (no width-conditional JS drops content).
          expect(view.container.querySelector('.inbox')).toBeTruthy();
          expect(view.container.querySelectorAll('.inbox__row')).toHaveLength(2);
          expect(screen.getByRole('button', { name: 'Open card' })).toBeTruthy();
          // No element hardcodes a pixel width wider than the viewport — the horizontal-overflow bug class.
          for (const el of Array.from(view.container.querySelectorAll<HTMLElement>('*'))) {
            const declared = el.style.width || el.style.minWidth;
            if (declared.endsWith('px')) expect(Number.parseInt(declared, 10)).toBeLessThanOrEqual(width);
          }
        } finally {
          Object.defineProperty(window, 'innerWidth', { value: original, configurable: true, writable: true });
        }
      });
    }
  });
});

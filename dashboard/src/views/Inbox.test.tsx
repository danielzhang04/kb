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

function envelope(items: unknown[], sources: { pr: unknown; escalation: unknown } = { pr: verified, escalation: verified }) {
  return { items, revision: 'e'.repeat(64), sources };
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

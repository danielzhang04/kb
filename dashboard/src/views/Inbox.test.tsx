// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SseFactory, SseSource } from '../lib/sseClient.ts';
import { renderWithTestSession } from '../test/session.tsx';
import { Inbox } from './Inbox.tsx';

const item = {
  id: 'a'.repeat(64),
  createdAt: '2024-01-12T16:57:07.000Z',
  revision: 'b'.repeat(64),
  kind: 'escalation' as const,
  subject: { cardId: '65a1b2c3-01234567' },
  related: {},
  title: 'wake-me:runner-failed',
  reason: 'A runner stopped.',
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
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

  it('exposes only Open card and renders loading, Nothing needs you, and error', async () => {
    const navigate = vi.fn();
    const pending = deferred<Response>();
    const fetchImpl = vi.fn(() => pending.promise);
    await renderWithTestSession(<Inbox fetchImpl={fetchImpl} onNavigate={navigate} />);

    expect(screen.getByText('Loading Inbox…')).toBeTruthy();
    await act(async () => { pending.resolve(new Response(JSON.stringify({ items: [item] }), { status: 200 })); });
    const open = await screen.findByRole('button', { name: 'Open card' });
    expect(screen.queryByRole('button', { name: /reply|resolve|verify/i })).toBeNull();
    fireEvent.click(open);
    expect(navigate).toHaveBeenCalledWith({ view: 'tasks', focus: { kind: 'card', id: item.subject.cardId } });

    const emptyFetch = vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200 }));
    const empty = await renderWithTestSession(<Inbox fetchImpl={emptyFetch} />);
    expect(await screen.findByText('Nothing needs you')).toBeTruthy();
    expect(empty.container.querySelector('.inbox__empty')?.textContent).toBe('Nothing needs you');
  });

  it('treats SSE only as a trigger and retains the last verified snapshot after failure', async () => {
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
    await act(async () => { first.resolve(new Response(JSON.stringify({ items: [item] }), { status: 200 })); });
    expect(await screen.findByText(item.title)).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    await act(async () => { second.resolve(new Response('no', { status: 500 })); });
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(item.title)).toBeTruthy();
    expect(screen.queryByText('untrusted event item')).toBeNull();
  });
});

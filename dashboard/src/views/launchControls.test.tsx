// @vitest-environment jsdom
/**
 * C7.7 — the optional owner picker on the governed Launch surface. The `<select>` is an HONEST PREVIEW
 * (the server re-validates against the filesystem-enumerated closed set); these tests assert the client
 * contract: a blank/unowned default, a runner-bound warning that still allows selection, and that `owner`
 * rides the POST body only when chosen.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LaunchControls } from './launchControls';
import type { OwnerOption } from './launchControls';

const OWNERS: OwnerOption[] = [
  { id: 'worker-desktop', runnerBound: true },
  { id: 'fresh-agent', runnerBound: false },
];

/** A fetch mock that resolves an ok launch response and records the parsed request body. */
function stubOkFetch(): { bodies: Array<Record<string, unknown>> } {
  const bodies: Array<Record<string, unknown>> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ cardId: 'c-1' }) } as Response);
    }),
  );
  return { bodies };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('LaunchControls — C7.7 owner picker', () => {
  it('renders an owner <select> defaulting to unowned, with one option per assignable owner', () => {
    render(<LaunchControls sessionToken="t" owners={OWNERS} />);
    const select = screen.getByLabelText('Owner') as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(screen.getByRole('option', { name: 'unowned' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'worker-desktop' })).toBeTruthy();
    // A runner-bound:false owner is annotated in the option label.
    expect(screen.getByRole('option', { name: 'fresh-agent (no runner)' })).toBeTruthy();
  });

  it('with no owners prop the select still renders with only the unowned choice', () => {
    render(<LaunchControls sessionToken="t" />);
    const select = screen.getByLabelText('Owner') as HTMLSelectElement;
    expect(select.value).toBe('');
    // Scope the count to THIS select's own options (the Risk tier select has its own T1/T2/T3).
    expect(select.options).toHaveLength(1);
  });

  it('selecting a runner-bound:false owner shows the inline warning but still allows the selection', () => {
    render(<LaunchControls sessionToken="t" owners={OWNERS} />);
    expect(screen.queryByTestId('owner-unbound-warning')).toBeNull();
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'fresh-agent' } });
    expect((screen.getByLabelText('Owner') as HTMLSelectElement).value).toBe('fresh-agent');
    const warn = screen.getByTestId('owner-unbound-warning');
    expect(warn.textContent).toMatch(/will not execute until a runner is bound to fresh-agent/i);
  });

  it('selecting a runner-bound:true owner shows NO warning', () => {
    render(<LaunchControls sessionToken="t" owners={OWNERS} />);
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'worker-desktop' } });
    expect(screen.queryByTestId('owner-unbound-warning')).toBeNull();
  });

  it('includes owner in the POST body only when chosen (blank owner omits it entirely)', async () => {
    const { bodies } = stubOkFetch();
    render(<LaunchControls sessionToken="t" owners={OWNERS} />);

    // First submit with no owner selected → no `owner` key.
    fireEvent.submit(screen.getByLabelText('Launch card'));
    await screen.findByTestId('launch-status');
    expect(bodies).toHaveLength(1);
    expect('owner' in bodies[0]).toBe(false);

    // Now pick an owner and submit again → `owner` is present.
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'worker-desktop' } });
    fireEvent.submit(screen.getByLabelText('Launch card'));
    await vi.waitFor(() => expect(bodies).toHaveLength(2));
    expect(bodies[1].owner).toBe('worker-desktop');
  });
});

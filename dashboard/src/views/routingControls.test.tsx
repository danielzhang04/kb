// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { RoutingControl } from './routingControls';
import type { RuntimeRegistryEntry } from '../lib/routingClient';

afterEach(cleanup);

const REGISTRY: Record<string, RuntimeRegistryEntry> = {
  claude: { default_worker: 'worker-desktop', aliases: {}, known_models: ['claude-opus-4-8', 'claude-sonnet-5'] },
  codex: { default_worker: 'codex-worker', aliases: {}, known_models: ['gpt-5-codex'] },
};

const POLICY_EFFECTIVE = { runtime: 'claude', model: 'claude-sonnet-5', sourceRuntime: 'policy', sourceModel: 'policy' } as const;

describe('RoutingControl — governed submit (with session)', () => {
  it('opens the popover, picks a runtime+model, and calls onApply with the concrete selection', async () => {
    const onApply = vi.fn(async (_runtime: string, _model: string, _expires: string | null) => ({ ok: true }));
    render(
      <RoutingControl
        label="agent-x"
        testIdPrefix="agent-x"
        registry={REGISTRY}
        effective={POLICY_EFFECTIVE}
        ttl
        onApply={onApply}
      />,
    );
    fireEvent.click(screen.getByTestId('agent-x-routing-chip'));
    expect(screen.getByTestId('agent-x-routing-pop')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: 'codex' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'gpt-5-codex' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    const [runtime, model, expires] = onApply.mock.calls[0];
    expect(runtime).toBe('codex');
    expect(model).toBe('gpt-5-codex');
    expect(expires).toBeNull(); // TTL defaults to "no expiry"
  });

  it('changing runtime resets the model to that runtime first known model', () => {
    render(
      <RoutingControl label="a" testIdPrefix="a" registry={REGISTRY} effective={POLICY_EFFECTIVE} onApply={vi.fn()} />,
    );
    fireEvent.click(screen.getByTestId('a-routing-chip'));
    fireEvent.change(screen.getByLabelText('Runtime'), { target: { value: 'codex' } });
    expect((screen.getByLabelText('Model') as HTMLSelectElement).value).toBe('gpt-5-codex');
  });

  it('renders a Clear affordance and calls onClear', async () => {
    const onClear = vi.fn(async () => ({ ok: true }));
    render(
      <RoutingControl
        label="a"
        testIdPrefix="a"
        registry={REGISTRY}
        effective={{ ...POLICY_EFFECTIVE, sourceModel: 'override' }}
        canClear
        onApply={vi.fn()}
        onClear={onClear}
      />,
    );
    fireEvent.click(screen.getByTestId('a-routing-chip'));
    fireEvent.click(screen.getByTestId('a-routing-clear'));
    await vi.waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
  });

  it('when lockedReason is set, disables the chip, shows a quiet inline message, and never opens the popover', () => {
    const onApply = vi.fn();
    render(
      <RoutingControl
        label="card-300"
        testIdPrefix="card-300"
        registry={REGISTRY}
        effective={POLICY_EFFECTIVE}
        lockedReason="under approval — routing frozen"
        onApply={onApply}
      />,
    );
    const chip = screen.getByTestId('card-300-routing-chip') as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    const locked = screen.getByTestId('card-300-routing-locked');
    expect(locked.textContent).toContain('under approval');
    fireEvent.click(chip); // no-op: disabled
    expect(screen.queryByTestId('card-300-routing-pop')).toBeNull();
    expect(onApply).not.toHaveBeenCalled();
  });

  it('surfaces a governed 409 refusal legibly inside the popover (quiet status line)', async () => {
    const onApply = vi.fn(async () => ({
      ok: false,
      reason: 'card is under an active approval; routing is frozen until it executes or the approval is rescinded',
    }));
    render(
      <RoutingControl label="a" testIdPrefix="a" registry={REGISTRY} effective={POLICY_EFFECTIVE} onApply={onApply} />,
    );
    fireEvent.click(screen.getByTestId('a-routing-chip'));
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await vi.waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    const status = await screen.findByTestId('a-routing-status');
    expect(status.textContent).toContain('under an active approval');
  });

  it('renders an unroutable marker for a fail-loud card', () => {
    render(
      <RoutingControl
        label="c"
        testIdPrefix="c"
        registry={REGISTRY}
        effective={{ unroutable: true, reason: 'model x not known' }}
        onApply={vi.fn()}
      />,
    );
    expect(screen.getByText('unroutable')).toBeTruthy();
  });
});

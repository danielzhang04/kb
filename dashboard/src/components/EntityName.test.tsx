// @vitest-environment jsdom
/**
 * spec §2 — EntityName is the single renderer for entity identity in primary UI text: display name +
 * a stable ordinal ref chip, with the real id reachable only via `title` and click-to-copy — never as
 * visible text. These tests pin that contract so a future edit can't quietly leak an id back into text.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { EntityName } from './EntityName';

const RAW_ID = 'run-9f3c7a21-managed-de2c79e8';

afterEach(() => {
  cleanup();
});

describe('EntityName', () => {
  it('renders a server-owned display name for non-agent/workflow entities and the #ref chip', () => {
    render(<EntityName kind="run" id={RAW_ID} displayName="Nightly ingest" shortRef={42} />);
    expect(screen.getByText('Nightly ingest')).toBeTruthy();
    expect(screen.getByTestId('entity-name-ref').textContent).toBe('#42');
  });

  it('humanizes agent and workflow ids without changing raw identity', () => {
    const { rerender } = render(
      <EntityName kind="agent" id="fyt_checker-api" displayName="Ignored agent title" shortRef={42} />,
    );
    expect(screen.getByText('FYT Checker API')).toBeTruthy();
    expect(screen.getByTestId('entity-name').getAttribute('title')).toBe('fyt_checker-api');

    rerender(
      <EntityName kind="workflow" id="kb_pr-review" displayName="Ignored workflow title" shortRef={43} />,
    );
    expect(screen.getByText('KB PR Review')).toBeTruthy();
    expect(screen.getByTestId('entity-name').getAttribute('title')).toBe('kb_pr-review');
  });

  it('falls back to a humanized id when a non-agent/workflow display name is empty or the raw id', () => {
    const { rerender } = render(<EntityName kind="card" id="card-review" displayName="" shortRef={8} />);
    expect(screen.getByText('Card Review')).toBeTruthy();

    rerender(<EntityName kind="task" id="task_review" displayName="task_review" shortRef={9} />);
    expect(screen.getByText('Task Review')).toBeTruthy();
  });

  it('never renders the raw id as visible text, under any prop combination', () => {
    for (const kind of ['card', 'run', 'workflow', 'agent', 'task'] as const) {
      for (const muted of [false, true]) {
        const { unmount } = render(
          <EntityName kind={kind} id={RAW_ID} displayName="Some entity" shortRef={7} muted={muted} />,
        );
        const root = screen.getByTestId('entity-name');
        expect(root.textContent).not.toContain(RAW_ID);
        unmount();
      }
    }
  });

  it('carries the full id in the title attribute', () => {
    render(<EntityName kind="agent" id={RAW_ID} displayName="Atlas" shortRef={3} />);
    expect(screen.getByTestId('entity-name').getAttribute('title')).toBe(RAW_ID);
  });

  it('applies the muted variant class only when the muted prop is set', () => {
    const { rerender } = render(<EntityName kind="task" id={RAW_ID} displayName="Sweep" shortRef={1} />);
    expect(screen.getByTestId('entity-name').className).not.toContain('entity-name--muted');

    rerender(<EntityName kind="task" id={RAW_ID} displayName="Sweep" shortRef={1} muted />);
    expect(screen.getByTestId('entity-name').className).toContain('entity-name--muted');
  });

  describe('copy affordance', () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers();
      writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(window.navigator, 'clipboard', {
        value: { writeText },
        configurable: true,
      });
    });

    afterEach(() => {
      vi.useRealTimers();
      // @ts-expect-error -- cleaning up the test-only clipboard shim between cases
      delete window.navigator.clipboard;
    });

    it('writes the canonical id via the injected clipboard and shows a transient copied state', async () => {
      render(<EntityName kind="card" id={RAW_ID} displayName="Fix wave" shortRef={9} />);
      const button = screen.getByTestId('entity-name-copy');

      expect(button.getAttribute('aria-label')).toBe('Copy card id');

      await act(async () => {
        fireEvent.click(button);
        await Promise.resolve();
        await Promise.resolve();
      });

      expect(writeText).toHaveBeenCalledWith(RAW_ID);
      expect(button.getAttribute('aria-label')).toBe('Copied card id');
      expect(button.className).toContain('entity-name__copy--copied');

      act(() => {
        vi.advanceTimersByTime(1500);
      });

      expect(button.getAttribute('aria-label')).toBe('Copy card id');
      expect(button.className).not.toContain('entity-name__copy--copied');
    });

    it('is keyboard accessible: the copy affordance is a real <button>', () => {
      render(<EntityName kind="workflow" id={RAW_ID} displayName="Nightly" shortRef={5} />);
      const button = screen.getByTestId('entity-name-copy');
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
    });

    it('does not throw and leaves the copied state false when no clipboard is available', async () => {
      // @ts-expect-error -- simulating an environment with no Clipboard API
      delete window.navigator.clipboard;
      render(<EntityName kind="run" id={RAW_ID} displayName="No clipboard" shortRef={2} />);
      const button = screen.getByTestId('entity-name-copy');

      await act(async () => {
        fireEvent.click(button);
        await Promise.resolve();
      });

      expect(button.getAttribute('aria-label')).toBe('Copy run id');
      expect(button.className).not.toContain('entity-name__copy--copied');
    });
  });
});

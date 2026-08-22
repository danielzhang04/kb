// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { EntityDetail } from './EntityDetail';

afterEach(cleanup);

describe('EntityDetail', () => {
  it('traps forward/reverse focus, closes by Escape/backdrop/button, and restores trigger', () => {
    function Harness(): React.JSX.Element {
      const [open, setOpen] = useState(false);
      return <>
        <button type="button" onClick={() => setOpen(true)}>Open detail</button>
        {open ? <EntityDetail entity={{ kind: 'agent', id: 'fyt-checker' }} eyebrow="Agent" title="FYT Checker"
          facts={[]} sections={[{ id: 'live', label: 'Live', render: () => <p>Loaded fact</p> }, { id: 'brief', label: 'Brief', render: () => <p>Brief fact</p> }]}
          overlay onClose={() => setOpen(false)} /> : null}
      </>;
    }

    for (const closeWith of ['Escape', 'backdrop', 'button'] as const) {
      const { unmount } = render(<Harness />);
      const trigger = screen.getByRole('button', { name: 'Open detail' });
      trigger.focus();
      fireEvent.click(trigger);
      const close = screen.getByTestId('entity-detail-close');
      expect(document.activeElement).toBe(close);
      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      expect(document.activeElement).toBe(screen.getByTestId('entity-tab-details'));
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(document.activeElement).toBe(close);
      if (closeWith === 'Escape') fireEvent.keyDown(document, { key: 'Escape' });
      else if (closeWith === 'backdrop') fireEvent.click(screen.getByTestId('entity-detail-backdrop'));
      else fireEvent.click(close);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(trigger);
      unmount();
    }
  });

  it('renders the entity header and structural Live Brief Details chrome without a projection join', () => {
    render(
      <EntityDetail entity={{ kind: 'workflow', id: 'fyt-video' }} eyebrow="Workflow" title="FYT Video"
        facts={[]} sections={[{ id: 'live', label: 'Live', render: () => <p>Loaded fact</p> }, { id: 'brief', label: 'Brief', render: () => <p>Brief fact</p> }]}
        overlay onClose={() => undefined} />,
    );
    expect(screen.getByRole('tab', { name: 'Live' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Brief' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Details' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'Details' }));
    expect(screen.getByTestId('entity-detail-disclosure').hasAttribute('open')).toBe(false);
    expect(screen.getByText('No additional loaded details.')).toBeTruthy();
  });
});

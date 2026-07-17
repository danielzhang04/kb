// @vitest-environment jsdom
/**
 * U2.5 — Connectors view (Registry's MCP connections slice promoted to a top-level destination).
 * Renders per-project server→tools when present, and the calm "no MCP connections" empty state otherwise.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { Connectors } from './Connectors';

afterEach(cleanup);

describe('Connectors view', () => {
  it('shows the empty state when there are no connections', () => {
    render(<Connectors data={{ count: 0, items: [], byProject: {} }} />);
    expect(screen.getByLabelText('Connectors view')).toBeTruthy();
    expect(screen.getByText('No MCP connections.')).toBeTruthy();
  });

  it('lists per-project server→tools when connections are present', () => {
    render(
      <Connectors
        data={{
          count: 1,
          items: [{ project: 'atlas', server: 'github', tools: ['search', 'read'] }],
          byProject: {
            atlas: [{ project: 'atlas', server: 'github', tools: ['search', 'read'] }],
          },
        }}
      />,
    );
    expect(screen.getByText('atlas')).toBeTruthy();
    expect(screen.getByText('github')).toBeTruthy();
    expect(screen.getByText(/search, read/)).toBeTruthy();
    expect(screen.queryByText('No MCP connections.')).toBeNull();
  });
});

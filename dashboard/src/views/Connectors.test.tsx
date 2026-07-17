// @vitest-environment jsdom
/**
 * Connectors view (U3). Renders the registry connections slice as a dense MCP-integrations table and
 * projects a scope (global = present in every connected project) from the data that exists. Tests pin
 * the row rendering, the scope projection, and the calm empty state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { Connectors, toRows } from './Connectors';
import type { ConnectionsIndex } from '../../server/registry/connections';

const INDEX: ConnectionsIndex = {
  count: 3,
  items: [
    { project: 'kb', server: 'claude_ai_Gmail', tools: ['get_message', 'search_threads'] },
    { project: 'kb', server: 'context7', tools: ['query-docs'] },
    { project: 'atlas', server: 'context7', tools: ['query-docs'] },
  ],
  byProject: {
    kb: [
      { project: 'kb', server: 'claude_ai_Gmail', tools: ['get_message', 'search_threads'] },
      { project: 'kb', server: 'context7', tools: ['query-docs'] },
    ],
    atlas: [{ project: 'atlas', server: 'context7', tools: ['query-docs'] }],
  },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('toRows', () => {
  it('flattens per-project connections and projects global vs project scope', () => {
    const rows = toRows(INDEX);
    // context7 appears in BOTH connected projects → global; Gmail only in kb → project.
    const context7 = rows.filter((r) => r.server === 'context7');
    expect(context7).toHaveLength(2);
    expect(context7.every((r) => r.scope === 'global')).toBe(true);
    const gmail = rows.find((r) => r.server === 'claude_ai_Gmail');
    expect(gmail?.scope).toBe('project');
  });
});

describe('Connectors view', () => {
  it('renders a row per connection with server id, project, tool count, and status', () => {
    render(<Connectors data={INDEX} />);

    expect(screen.getByLabelText('Connectors view')).toBeTruthy();
    expect(screen.getByText('MCP integrations')).toBeTruthy();

    const gmailRow = screen.getByTestId('connector-row-kb-claude_ai_Gmail');
    expect(within(gmailRow).getByText('claude_ai_Gmail')).toBeTruthy();
    expect(within(gmailRow).getByText('2')).toBeTruthy(); // two tools
    expect(within(gmailRow).getByText('allowed')).toBeTruthy();

    // Three connection rows total.
    expect(screen.getAllByText('allowed')).toHaveLength(3);
  });

  it('degrades to a calm empty state when there are no MCP connections', () => {
    render(<Connectors data={{ count: 0, items: [], byProject: {} }} />);
    expect(screen.getByText('No MCP connections.')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

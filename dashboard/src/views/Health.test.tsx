// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { healthResponseFixture } from '../../server/health/__fixtures__/health.ts';
import { Health } from './Health.tsx';

describe('Health', () => {
  it('renders sections in §5 order and exact unavailable literals', () => {
    render(<Health response={healthResponseFixture} />);

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
      .toEqual(['Fleet', 'STOP', 'Daemon and machine', 'MCP', 'Usage']);
    expect(screen.getAllByText('unavailable in P1')).toHaveLength(3);
    expect(screen.getAllByText(/Source:/).map((source) => source.textContent)).toContain('Source: mcp-config');
  });
});

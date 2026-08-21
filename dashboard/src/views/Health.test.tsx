// @vitest-environment jsdom
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { healthResponseFixture } from '../../server/health/__fixtures__/health.ts';
import { Health } from './Health.tsx';
import { renderWithTestSession } from '../test/session.tsx';

afterEach(cleanup);

describe('Health', () => {
  it('mounts the one fleet STOP control in the served STOP section', async () => {
    await renderWithTestSession(<Health response={healthResponseFixture} />);
    expect(screen.getByLabelText('Nuclear STOP')).toBeTruthy();
    expect(screen.queryByLabelText('Request card stop')).toBeNull();
    expect(screen.queryByLabelText('Pause cadence')).toBeNull();
  });

  it('renders sections in §5 order and exact unavailable literals', async () => {
    await renderWithTestSession(<Health response={healthResponseFixture} />);

    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent))
      .toEqual(['Fleet', 'STOP', 'Daemon and machine', 'MCP', 'Usage']);
    expect(screen.getAllByText('unavailable in P1')).toHaveLength(3);
    expect(screen.getAllByText(/Source:/).map((source) => source.textContent)).toContain('Source: mcp-config');
    expect(screen.getByText('Worker A')).toBeTruthy();
    expect(screen.getByTestId('health-row-agent:worker-a').getAttribute('data-raw-id')).toBe('worker-a');
  });
});

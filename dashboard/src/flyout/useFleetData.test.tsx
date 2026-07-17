// @vitest-environment jsdom
/**
 * U4 — shared fleet-data hook. Many mounted flyout hosts must trigger at most ONE request per source:
 * the module-level cache + in-flight de-duping prevents a per-hover request stampede.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import { useFleetData, resetFleetData, EMPTY_INDEX } from './useFleetData';

function Consumer(): null {
  useFleetData();
  return null;
}

beforeEach(() => resetFleetData());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useFleetData', () => {
  it('fetches /api/index and /api/registry once across many consumers (no stampede)', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        json: () => Promise.resolve(url.includes('registry') ? {} : EMPTY_INDEX),
      } as Response),
    );
    vi.stubGlobal('fetch', fetchMock);

    render(
      <>
        <Consumer />
        <Consumer />
        <Consumer />
        <Consumer />
      </>,
    );

    await waitFor(() => {
      expect(fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/index')).toHaveLength(1);
    });
    expect(fetchMock.mock.calls.filter((c) => String(c[0]) === '/api/registry')).toHaveLength(1);
  });
});

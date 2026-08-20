// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AGENT_PLATFORM_PANELS } from '../registry';
import { panel } from './ProposedLessons.panel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('Proposed Lessons panel', () => {
  it('registers by file drop and lists proposal evidence', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({
      files: [], entries: [{
        lesson: 'WORKED: retry Bash with changed arguments after an error.', confidence: 'high',
        evidence: 'session-a.jsonl:L2-L5', sourceSession: 'session-a', file: 'session-a.md',
      }],
    }) });
    vi.stubGlobal('fetch', fetchMock);
    render(panel.render());

    expect(panel.id).toBe('proposed-lessons');
    expect(AGENT_PLATFORM_PANELS.some((item) => item.id === 'proposed-lessons')).toBe(true);
    const row = await screen.findByTestId('ap-lessons-entry-0');
    expect(row.textContent).toContain('WORKED: retry Bash');
    expect(row.textContent).toContain('high');
    expect(row.textContent).toContain('session-a.jsonl:L2-L5');
    expect(row.textContent).toContain('session-a');
    expect(fetchMock).toHaveBeenCalledWith('/api/lessons/proposals');
  });

  it('names empty and fetch-failure states honestly', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ files: [], entries: [] }) }));
    render(panel.render());
    expect((await screen.findByTestId('ap-lessons-empty')).textContent).toMatch(/no mined proposals yet/i);
    cleanup();

    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    render(panel.render());
    expect((await screen.findByTestId('ap-lessons-unavailable')).textContent).toMatch(/could not be read/i);
  });
});

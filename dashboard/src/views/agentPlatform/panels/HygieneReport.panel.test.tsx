// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { panel } from './HygieneReport.panel';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const REPORT = {
  available: true,
  report: {
    generated_at: '2026-08-18T00:00:00Z', root: '.', dryRun: true,
    findings: [
      { path: 'old.tmp', kind: 'orphan-temp', size: 4, detail: 'temporary file', proposal: 'candidate for deletion/merge/shrink — HUMAN decides' },
      { path: 'docs/a.md', kind: 'mojibake', size: 2, detail: '1 replacement marker', proposal: 'candidate for deletion/merge/shrink — HUMAN decides' },
    ],
    summary: { total: 2, by_kind: { 'orphan-temp': 1, mojibake: 1 } },
  },
};

describe('Hygiene Report panel', () => {
  it('registers by file drop and renders the dry-run banner, grouped findings, and proposals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => REPORT }));
    render(panel.render());
    expect(await screen.findByText(/DRY-RUN — nothing was or will be deleted/i)).toBeTruthy();
    expect(screen.getByText(/2 findings · generated/)).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'mojibake (1)' })).toBeTruthy();
    expect(screen.getAllByText(/HUMAN decides/)).toHaveLength(2);
  });

  it('renders an honest instruction when the report has not been generated', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ available: false, reason: 'not-generated' }) }));
    render(panel.render());
    expect((await screen.findByTestId('ap-hygiene-not-generated')).textContent).toMatch(/packaged hygiene sweep.*ops checkout/i);
  });
});

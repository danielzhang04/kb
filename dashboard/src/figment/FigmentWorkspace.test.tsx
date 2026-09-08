// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FigmentWorkspace } from './FigmentWorkspace';

const projection = { schema: 'figment/hub@1' as const, available: true, creators: [{ id: 'creator-a', persona: 'valid' as const, loraTier: 'provisional', loraTrigger: null, accountTiers: ['instagram'] }], creatorsTruncated: false, records: [{ path: 'runs/a/run.json', type: 'run', creator: 'creator-a', reviewState: 'unknown' as const, machineGateState: 'current' as const, schema: 'figment/runpod-run@1' }], recordsTruncated: false, research: { available: true, artifacts: [{ area: 'book' as const, name: 'chapter.md', bytes: 2048, modifiedAt: '2026-09-08T00:00:00Z' }], truncated: false }, diagnostic: { status: 'diagnostic-not-promotable' as const, dryRun: false, podId: 'pod', artifacts: [] } };
const response = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

describe('FigmentWorkspace', () => {
  it('renders evidence states without treating a machine gate as checkpoint approval', async () => {
    const fetchImpl = vi.fn(() => response(projection)) as unknown as typeof fetch;
    render(<FigmentWorkspace token="session" fetchImpl={fetchImpl} />);
    await screen.findByText('creator-a');
    fireEvent.click(screen.getByRole('tab', { name: 'Runs & review' }));
    expect(screen.getByText('Approval unknown')).toBeTruthy();
    expect(screen.getByText('Machine gate current')).toBeTruthy();
    expect(screen.getByText('Diagnostic evidence — not promotable')).toBeTruthy();
    expect(fetchImpl).toHaveBeenCalledWith('/api/figment', { headers: { authorization: 'Bearer session' } });
  });

  it('shows loading then a recoverable unavailable state', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    expect(screen.getByText('Loading Figment records…')).toBeTruthy();
    await screen.findByText('Figment records are unavailable.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
  });

  it('identifies a truncated creator list in the creator tab', async () => {
    const fetchImpl = vi.fn(() => response({ ...projection, creatorsTruncated: true })) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('The creator list reached its safe display limit.');
  });

  it('fails closed when nested diagnostic or record fields are malformed', async () => {
    const malformed = { ...projection, diagnostic: { status: 'unavailable', reason: null }, records: [{ ...projection.records[0], machineGateState: 'invented' }] };
    const fetchImpl = vi.fn(() => response(malformed)) as unknown as typeof fetch;
    render(<FigmentWorkspace fetchImpl={fetchImpl} />);
    await screen.findByText('Figment records are unavailable.');
    expect(screen.getAllByRole('button', { name: 'Retry' }).length).toBeGreaterThan(0);
  });
});

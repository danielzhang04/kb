import { describe, expect, it, vi } from 'vitest';
import type { CapabilityRequirement, HostAdvertisement } from './contracts.ts';
import { decodeCapabilityRequirement } from './normalize.ts';
import { runtimeCapabilities } from '../runtime/capabilities.ts';
import { projectNeverRunHost, select, selectPlacementHost } from './select.ts';

const NOW = Date.parse('2026-08-25T00:00:00.000Z');

function requirement(overrides: Partial<CapabilityRequirement> = {}): CapabilityRequirement {
  return decodeCapabilityRequirement({
    connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: false, clis: [], ...overrides,
  });
}

function advertisement(hostId: 'vm' | 'desktop', overrides: Partial<HostAdvertisement> = {}): HostAdvertisement {
  return {
    hostId, daemonVersion: '1.0.0', reportedAt: new Date(NOW).toISOString(),
    connectors: [], skills: ['docx'], filesystemRoots: [],
    pty: false, gpu: false, clis: { claude: 'missing', codex: 'missing' },
    ...overrides,
  };
}

// The exact named failing test [P6-C49] this file gates (§7):
// "select() returns no-complete-placement and creates no Run row when zero fresh advertisements
// match, prefers VM on a tie, and returns Desktop as sole complete match."
describe('select()', () => {
  it('returns no-complete-placement and creates no Run row when zero fresh advertisements match', async () => {
    const req = requirement({ skills: ['docx'] });
    const createRun = vi.fn();
    const result = await select(req, [advertisement('vm', { skills: [] }), advertisement('desktop', { skills: [] })], NOW, { createRun });
    expect(result).toEqual({ outcome: 'no-complete-placement' });
    expect(createRun).not.toHaveBeenCalled();
  });

  it('prefers VM on a tie', async () => {
    const req = requirement({ skills: ['docx'] });
    const createRun = vi.fn(async (hostId) => ({ runRef: 'run-1', executionHost: hostId }));
    const result = await select(req, [advertisement('desktop'), advertisement('vm')], NOW, { createRun });
    expect(result).toEqual({ outcome: 'placed', hostId: 'vm', run: { runRef: 'run-1', executionHost: 'vm' } });
    expect(createRun).toHaveBeenCalledExactlyOnceWith('vm');
  });

  it('returns Desktop as the sole complete match', async () => {
    const req = requirement({ skills: ['docx'] });
    const createRun = vi.fn(async (hostId) => ({ runRef: 'run-2', executionHost: hostId }));
    const result = await select(req, [advertisement('desktop'), advertisement('vm', { skills: [] })], NOW, { createRun });
    expect(result).toEqual({ outcome: 'placed', hostId: 'desktop', run: { runRef: 'run-2', executionHost: 'desktop' } });
    expect(createRun).toHaveBeenCalledExactlyOnceWith('desktop');
  });

  it('excludes a stale advertisement from candidacy even when it would otherwise be a complete match', async () => {
    const req = requirement({ skills: ['docx'] });
    const stale = advertisement('vm', { reportedAt: new Date(0).toISOString() });
    const createRun = vi.fn();
    const result = await select(req, [stale], NOW, { createRun });
    expect(result).toEqual({ outcome: 'no-complete-placement' });
    expect(createRun).not.toHaveBeenCalled();
  });
});

describe('selectPlacementHost — the pure decision selectPorts-less callers use', () => {
  it('matches the same tie-break and no-match behaviour as select()', () => {
    const req = requirement({ skills: ['docx'] });
    expect(selectPlacementHost(req, [advertisement('vm', { skills: [] })], NOW)).toEqual({ outcome: 'no-complete-placement' });
    expect(selectPlacementHost(req, [advertisement('vm'), advertisement('desktop')], NOW)).toEqual({ outcome: 'placed', hostId: 'vm' });
    expect(selectPlacementHost(req, [advertisement('desktop')], NOW)).toEqual({ outcome: 'placed', hostId: 'desktop' });
  });
});

describe('projectNeverRunHost — the never-run entity chip fallback [P6-C39]', () => {
  it('projects the matched placement when at least one advertisement is fresh', () => {
    const req = requirement({ skills: ['docx'] });
    const projection = projectNeverRunHost(req, [advertisement('desktop'), advertisement('vm', { skills: [] })], NOW, runtimeCapabilities('linux'));
    expect(projection).toEqual({ source: 'placement', hostId: 'desktop' });
  });

  it('falls back to runtimeExecutionHost, labelled self-identity, when no advertisement is fresh at all', () => {
    const req = requirement({ skills: ['docx'] });
    const projection = projectNeverRunHost(req, [], NOW, runtimeCapabilities('win32'));
    expect(projection).toEqual({ source: 'self-identity', hostId: 'desktop' });
  });

  it('the self-identity fallback is never labelled as a placement claim', () => {
    const req = requirement({ skills: ['docx'] });
    const projection = projectNeverRunHost(req, [], NOW, runtimeCapabilities('linux'));
    expect(projection.source).not.toBe('placement');
    expect(projection).toEqual({ source: 'self-identity', hostId: 'vm' });
  });
});

import { describe, expect, it } from 'vitest';
import { ADVERTISEMENT_FRESHNESS_MS } from './contracts.ts';
import type { CapabilityRequirement, HostAdvertisement } from './contracts.ts';
import { decodeCapabilityRequirement } from './normalize.ts';
import { freshMatches, match, matchesFreshAdvertisement } from './match.ts';

const NOW = Date.parse('2026-08-25T00:00:00.000Z');

function advertisement(overrides: Partial<HostAdvertisement> = {}): HostAdvertisement {
  return {
    hostId: 'desktop', daemonVersion: '1.0.0', reportedAt: new Date(NOW).toISOString(),
    connectors: [{ server: 'gmail', tools: ['read', 'send', 'trash'] }],
    skills: ['docx', 'xlsx'], filesystemRoots: ['ops', 'worktrees'],
    pty: true, gpu: true, clis: { claude: 'ready', codex: 'login-required' },
    ...overrides,
  };
}

function requirement(overrides: Partial<CapabilityRequirement> = {}): CapabilityRequirement {
  return decodeCapabilityRequirement({
    connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: false, clis: [], ...overrides,
  });
}

describe('placement/match.ts re-exports normalize.ts match() verbatim (§3.2)', () => {
  it('is the same superset/subset predicate normalize.ts owns', () => {
    expect(match(requirement({ skills: ['docx'] }), advertisement())).toBe(true);
    expect(match(requirement({ skills: ['pptx'] }), advertisement())).toBe(false);
  });
});

describe('matchesFreshAdvertisement — staleness is checked before capability shape (§3.1, §3.2)', () => {
  it('matches a fresh advertisement with a satisfied requirement', () => {
    expect(matchesFreshAdvertisement(requirement({ skills: ['docx'] }), advertisement(), NOW)).toBe(true);
  });

  it('a stale (>90s) advertisement is NEVER a candidate, even when its capabilities would satisfy the requirement', () => {
    const req = requirement({ skills: ['docx'] });
    const stale = advertisement({ reportedAt: new Date(NOW - ADVERTISEMENT_FRESHNESS_MS).toISOString() });
    // The capability shape alone would match...
    expect(match(req, stale)).toBe(true);
    // ...but freshness fails first, so it is never a candidate.
    expect(matchesFreshAdvertisement(req, stale, NOW)).toBe(false);
  });

  it('a login-required CLI fails exactly like missing — a visible non-match, never a retry', () => {
    const req = requirement({ clis: ['codex'] });
    const loginRequired = advertisement({ clis: { claude: 'ready', codex: 'login-required' } });
    const missing = advertisement({ clis: { claude: 'ready', codex: 'missing' } });
    expect(matchesFreshAdvertisement(req, loginRequired, NOW)).toBe(false);
    expect(matchesFreshAdvertisement(req, missing, NOW)).toBe(false);
  });

  it('superset connector tools and subset skills/roots both satisfy through the freshness wrapper', () => {
    const req = requirement({
      connectors: [{ server: 'gmail', tools: ['read'] }],
      skills: ['docx'],
      filesystemRoots: ['ops'],
    });
    expect(matchesFreshAdvertisement(req, advertisement(), NOW)).toBe(true);
  });
});

describe('freshMatches', () => {
  it('filters to only the fresh, matching advertisements, preserving order', () => {
    const req = requirement({ skills: ['docx'] });
    const fresh = advertisement({ hostId: 'desktop' });
    const staleMatch = advertisement({ hostId: 'vm', reportedAt: new Date(0).toISOString() });
    const freshNoMatch = advertisement({ hostId: 'vm', skills: [] });
    expect(freshMatches(req, [fresh, staleMatch, freshNoMatch], NOW)).toEqual([fresh]);
  });
});

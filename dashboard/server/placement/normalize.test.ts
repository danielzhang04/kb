import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ContractDecodeError } from './contracts.ts';
import type { CapabilityRequirement, HostAdvertisement } from './contracts.ts';
import {
  capabilityHash, decodeCapabilityRequirement, isCanonicalName, match, normalizeCapabilityName,
} from './normalize.ts';

interface ReqValid { readonly name: string; readonly raw: unknown; readonly canonical: CapabilityRequirement }
interface ReqInvalid { readonly name: string; readonly value: unknown }
interface Vectors {
  readonly capabilityRequirements: { readonly valid: ReqValid[]; readonly invalid: ReqInvalid[] };
}
const vectors = JSON.parse(readFileSync(
  new URL('../../../tests/fixtures/dashboard-v3-p6-contract-vectors.json', import.meta.url), 'utf8',
)) as Vectors;

describe('normalizeCapabilityName (§3.2, design:637)', () => {
  it('applies NFC, trim, lowercase, _->-, and collapses repeated dashes', () => {
    expect(normalizeCapabilityName('  Gmail  ')).toBe('gmail');
    expect(normalizeCapabilityName('multi_source__synthesis')).toBe('multi-source-synthesis');
    expect(normalizeCapabilityName('A--B')).toBe('a-b');
  });
  it('is idempotent over the accepted charset', () => {
    for (const raw of ['gmail', 'multi_source__synthesis', ' Docx ', 'a-b-c', 'x9']) {
      const once = normalizeCapabilityName(raw);
      expect(normalizeCapabilityName(once)).toBe(once);
      expect(isCanonicalName(once)).toBe(true);
    }
  });
  it('rejects every disallowed class', () => {
    for (const bad of ['', ' ', '-lead', 'gm ail', 'a/b', '..', 'a.b', 'a:b', 'a\\b', 'Ünïcode', '_']) {
      expect(() => normalizeCapabilityName(bad)).toThrow(ContractDecodeError);
      expect(isCanonicalName(bad)).toBe(false);
    }
  });
});

describe('decodeCapabilityRequirement (exact-key wall, §3.2)', () => {
  for (const v of vectors.capabilityRequirements.valid) {
    it(`normalises ${v.name}`, () => {
      expect(decodeCapabilityRequirement(v.raw)).toEqual(v.canonical);
    });
  }
  for (const v of vectors.capabilityRequirements.invalid) {
    it(`rejects ${v.name}`, () => {
      expect(() => decodeCapabilityRequirement(v.value)).toThrow(ContractDecodeError);
    });
  }
});

describe('capabilityHash (§3.1, server-side, order-independent)', () => {
  it('is 64 lowercase hex and stable regardless of declared order', () => {
    const a = decodeCapabilityRequirement({
      connectors: [{ server: 'slack', tools: ['post'] }, { server: 'gmail', tools: ['send', 'read'] }],
      skills: ['xlsx', 'docx'], filesystemRoots: ['ops'], pty: true, gpu: false, clis: ['codex', 'claude'],
    });
    const b = decodeCapabilityRequirement({
      connectors: [{ server: 'gmail', tools: ['read', 'send'] }, { server: 'slack', tools: ['post'] }],
      skills: ['docx', 'xlsx'], filesystemRoots: ['ops'], pty: true, gpu: false, clis: ['claude', 'codex'],
    });
    expect(capabilityHash(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(capabilityHash(a)).toBe(capabilityHash(b));
  });
});

describe('match (§3.2 subset/superset semantics)', () => {
  const advertisement: HostAdvertisement = {
    hostId: 'desktop', daemonVersion: '1.0.0', reportedAt: '2026-08-25T00:00:00.000Z',
    connectors: [{ server: 'gmail', tools: ['read', 'send', 'trash'] }],
    skills: ['docx', 'xlsx'], filesystemRoots: ['ops', 'worktrees'],
    pty: true, gpu: true, clis: { claude: 'ready', codex: 'login-required' },
  };
  const req = (o: Partial<CapabilityRequirement>): CapabilityRequirement => decodeCapabilityRequirement({
    connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: false, clis: [], ...o,
  });

  it('matches a subset requirement with a tool superset', () => {
    expect(match(req({ connectors: [{ server: 'gmail', tools: ['read'] }], skills: ['docx'] }), advertisement)).toBe(true);
  });
  it('fails on a missing tool, missing skill, missing root, or ungranted pty/gpu', () => {
    expect(match(req({ connectors: [{ server: 'gmail', tools: ['archive'] }] }), advertisement)).toBe(false);
    expect(match(req({ skills: ['pptx'] }), advertisement)).toBe(false);
    expect(match(req({ filesystemRoots: ['state'] }), advertisement)).toBe(false);
  });
  it('requires a CLI to be exactly ready (login-required is a visible non-match)', () => {
    expect(match(req({ clis: ['claude'] }), advertisement)).toBe(true);
    expect(match(req({ clis: ['codex'] }), advertisement)).toBe(false);
  });
  it('refuses a non-canonical name reaching match() (invalid-capability-name)', () => {
    const dirty = { connectors: [], skills: ['Docx'], filesystemRoots: [], pty: false, gpu: false, clis: [] } as unknown as CapabilityRequirement;
    expect(() => match(dirty, advertisement)).toThrow(/invalid-capability-name/);
  });
});

describe('compile negatives (verified by tsc --noEmit)', () => {
  it('a requirement cannot name hostId at compile time', () => {
    const req: CapabilityRequirement = {
      connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: false, clis: [],
      // @ts-expect-error - CapabilityRequirement cannot name a host (§3.2); that would reintroduce tier routing.
      hostId: 'vm',
    };
    expect(req.pty).toBe(false);
  });
});

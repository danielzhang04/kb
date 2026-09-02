// P6 W6.3: the concrete values behind `capabilitySources.ts`'s five ports. The property under test
// throughout is HONESTY — the advertisement must say what this host can actually do, because a
// fabricated `ready` routes work to a host that cannot run it, and a fabricated `missing` 409s a launch
// that would have worked.
import { describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { CANONICAL_ID, MAX_SKILLS } from '../placement/contracts.ts';
import { probeAdvertisementCapabilities } from './capabilitySources.ts';
import {
  advertisedCliStatuses,
  probeFilesystemRoots,
  probeRepoSkills,
  probeSkillsWithDiagnostics,
  productionCapabilitySourcePorts,
} from './capabilityProbes.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLOSED_PTY = {
  pty: false as const,
  diagnostic: { reason: 'broker-unavailable' as const, detail: null, checkedAt: '2026-08-25T00:00:00.000Z' },
};
/** A fully provisioned VM: the broker enumerated all three launchers off the real filesystem. */
const VM_PTY = {
  pty: true as const, host: 'vm' as const, launchers: ['shell' as const, 'claude' as const, 'codex' as const],
  roots: ['repo' as const, 'worktrees' as const], checkedAt: '2026-08-25T00:00:00.000Z',
};
/** Both hosts drop `claude`/`codex` INDIVIDUALLY, so a partial set is real on either. */
const DESKTOP_SHELL_ONLY = {
  pty: true as const, host: 'desktop' as const, launchers: ['shell' as const],
  roots: ['worktrees' as const, 'repo' as const], checkedAt: '2026-08-25T00:00:00.000Z',
};

describe('advertisedCliStatuses — read off the PTY capability, never probed by this daemon', () => {
  // The daemon runs as kb-dashboard; /var/lib/kb-shell/home is 0700 kb-shell BY DESIGN, so an
  // fs.access from here answers EACCES for an installed CLI. The broker already answered, as kb-shell.
  it('no terminal means no launcher probe ran: both CLIs closed', () => {
    expect(advertisedCliStatuses(CLOSED_PTY)).toEqual({ claude: 'missing', codex: 'missing' });
  });

  it('the VM\'s accepted broker launcher set means BOTH CLIs are ready', () => {
    expect(advertisedCliStatuses(VM_PTY)).toEqual({ claude: 'ready', codex: 'ready' });
  });

  it('a shell-only terminal claims neither CLI', () => {
    expect(advertisedCliStatuses(DESKTOP_SHELL_ONLY)).toEqual({ claude: 'missing', codex: 'missing' });
  });

  it('is per-launcher, so a desktop can advertise one CLI and not the other', () => {
    expect(advertisedCliStatuses({ ...DESKTOP_SHELL_ONLY, launchers: ['shell', 'claude'] }))
      .toEqual({ claude: 'ready', codex: 'missing' });
    expect(advertisedCliStatuses({ ...DESKTOP_SHELL_ONLY, launchers: ['shell', 'codex'] }))
      .toEqual({ claude: 'missing', codex: 'ready' });
  });

  it('is per-launcher on the VM TOO, now that the broker enumerates what it can really pin', () => {
    // Before enumeration this state could not be represented: `brokerProbe.ts` refused any launcher set
    // that was not exactly `shell,claude,codex`, so a VM with one CLI advertised no terminal and both
    // CLIs `missing`. A launcher the broker did not name still reads `missing` — never `ready`.
    expect(advertisedCliStatuses({ ...VM_PTY, launchers: ['shell', 'claude'] }))
      .toEqual({ claude: 'ready', codex: 'missing' });
    expect(advertisedCliStatuses({ ...VM_PTY, launchers: ['shell', 'codex'] }))
      .toEqual({ claude: 'missing', codex: 'ready' });
    expect(advertisedCliStatuses({ ...VM_PTY, launchers: ['shell'] }))
      .toEqual({ claude: 'missing', codex: 'missing' });
  });

  it('never invents `login-required` — nothing observable here distinguishes it from ready', () => {
    for (const pty of [CLOSED_PTY, VM_PTY, DESKTOP_SHELL_ONLY]) {
      expect(Object.values(advertisedCliStatuses(pty))).not.toContain('login-required');
    }
  });
});

describe('probeRepoSkills — the existing registry scanner, shaped for the advertisement decoder', () => {
  it('reads the real repo catalog and returns sorted, unique, canonical, bounded ids', () => {
    const skills = probeRepoSkills(REPO_ROOT);
    expect(skills.length).toBeGreaterThan(0);
    expect(skills).toEqual([...skills].sort());
    expect(new Set(skills).size).toBe(skills.length);
    expect(skills.every((skill) => CANONICAL_ID.test(skill))).toBe(true);
    expect(skills.length).toBeLessThanOrEqual(MAX_SKILLS);
    // The scanner's own slugs, not a second directory walk.
    expect(skills).toContain('code-review');
  });

  it('drops a non-canonical slug rather than throwing the whole beat', () => {
    expect(probeRepoSkills('/unused', () => ({
      items: [{ slug: 'Not Canonical' }, { slug: '../escape' }, { slug: 'good-skill' }],
    }))).toEqual(['good-skill']);
  });

  it('truncates past the contract bound instead of refusing to advertise at all', () => {
    const items = Array.from({ length: MAX_SKILLS + 25 }, (_, index) => ({ slug: `s${String(index).padStart(4, '0')}` }));
    expect(probeRepoSkills('/unused', () => ({ items }))).toHaveLength(MAX_SKILLS);
  });
});

// The skills scan is the ONE filesystem read left in the advertisement path, so it is the one place an
// "installed but invisible" catalog can hide. Both cases degrade to an empty list; only the wording says
// which, and an operator cannot debug a narrowed placement without that distinction.
describe('probeSkillsWithDiagnostics — EACCES is not ENOENT', () => {
  const throwing = (code: string | undefined) => () => {
    const error = new Error('boom') as NodeJS.ErrnoException;
    if (code !== undefined) error.code = code;
    throw error;
  };

  it('reports no refusal on a readable catalog', () => {
    const probed = probeSkillsWithDiagnostics(REPO_ROOT);
    expect(probed.refusal).toBeNull();
    expect(probed.skills.length).toBeGreaterThan(0);
  });

  it('says UNREADABLE for EACCES/EPERM — installed skills invisible to placement', () => {
    for (const code of ['EACCES', 'EPERM']) {
      const probed = probeSkillsWithDiagnostics('/locked', throwing(code));
      expect(probed.skills).toEqual([]);
      expect(probed.refusal).toContain('UNREADABLE');
      expect(probed.refusal).toContain(code);
    }
  });

  it('says only "could not be read" for an absent catalog, and names an unknown code', () => {
    const missing = probeSkillsWithDiagnostics('/gone', throwing('ENOENT'));
    expect(missing.refusal).toContain('ENOENT');
    expect(missing.refusal).not.toContain('UNREADABLE');
    expect(probeSkillsWithDiagnostics('/weird', throwing(undefined)).refusal).toContain('unknown');
  });
});

describe('probeFilesystemRoots — read off the PTY discriminant, never guessed from disk', () => {
  it('grants no root when this host has no terminal: no session, no root', () => {
    expect(probeFilesystemRoots(CLOSED_PTY)).toEqual([]);
  });

  it('advertises the advertised terminal\'s own roots, sorted for the decoder', () => {
    expect(probeFilesystemRoots(DESKTOP_SHELL_ONLY)).toEqual(['repo', 'worktrees']);
  });
});

describe('productionCapabilitySourcePorts — all five ports supplied, emptiness stated not accidental', () => {
  it('composes the closed slice for a host with no terminal', async () => {
    const slice = await probeAdvertisementCapabilities(productionCapabilitySourcePorts({
      repoRoot: REPO_ROOT, pty: CLOSED_PTY,
    }));
    expect(slice.connectors).toEqual([]);
    expect(slice.gpu).toBe(false);
    expect(slice.clis).toEqual({ claude: 'missing', codex: 'missing' });
    expect(slice.filesystemRoots).toEqual([]);
    expect(slice.skills.length).toBeGreaterThan(0); // skills do not depend on the terminal
  });

  it('composes the open slice from an accepted VM broker: both CLIs ready, both roots granted', async () => {
    const slice = await probeAdvertisementCapabilities(productionCapabilitySourcePorts({
      repoRoot: REPO_ROOT, pty: VM_PTY,
    }));
    expect(slice.clis).toEqual({ claude: 'ready', codex: 'ready' });
    expect(slice.filesystemRoots).toEqual(['repo', 'worktrees']);
    expect(slice.connectors).toEqual([]);
    expect(slice.gpu).toBe(false);
  });

  it('surfaces an unreadable skills catalog to the composition root instead of swallowing it', async () => {
    const onSkillsRefusal = vi.fn();
    const slice = await probeAdvertisementCapabilities(productionCapabilitySourcePorts({
      repoRoot: '/locked', pty: VM_PTY, onSkillsRefusal,
      indexSkillsFor: () => {
        const error = new Error('denied') as NodeJS.ErrnoException;
        error.code = 'EACCES';
        throw error;
      },
    }));
    expect(slice.skills).toEqual([]);
    // The rest of the advertisement is unaffected — one unreadable field is not a closed host.
    expect(slice.clis).toEqual({ claude: 'ready', codex: 'ready' });
    expect(onSkillsRefusal).toHaveBeenCalledOnce();
    expect(onSkillsRefusal.mock.calls[0]![0]).toContain('UNREADABLE');
  });

  it('a throwing port degrades that ONE field to closed and never fails the composition', async () => {
    const slice = await probeAdvertisementCapabilities({
      ...productionCapabilitySourcePorts({ repoRoot: REPO_ROOT, pty: VM_PTY }),
      probeSkills: async () => { throw new Error('skills catalog unreadable'); },
    });
    expect(slice.skills).toEqual([]);
    expect(slice.clis).toEqual({ claude: 'ready', codex: 'ready' });
  });
});

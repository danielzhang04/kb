// P6 W6.3: the concrete probes behind `capabilitySources.ts`'s five ports. The property under test
// throughout is HONESTY — the advertisement must say what this host can actually do, because a
// fabricated `ready` routes work to a host that cannot run it, and a fabricated `missing` 409s a launch
// that would have worked.
import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { LINUX_CLI_LAUNCHERS } from '../pty/fdPinnedPaths.ts';
import { CANONICAL_ID, MAX_SKILLS } from '../placement/contracts.ts';
import { probeAdvertisementCapabilities } from './capabilitySources.ts';
import {
  cliLauncherPaths,
  probeCliStatuses,
  probeFilesystemRoots,
  probeRepoSkills,
  productionCapabilitySourcePorts,
} from './capabilityProbes.ts';

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const CLOSED_PTY = {
  pty: false as const,
  diagnostic: { reason: 'broker-unavailable' as const, detail: null, checkedAt: '2026-08-25T00:00:00.000Z' },
};
const OPEN_PTY = {
  pty: true as const, host: 'desktop' as const, launchers: ['shell' as const],
  roots: ['worktrees' as const, 'repo' as const], checkedAt: '2026-08-25T00:00:00.000Z',
};
const WINDOWS_ENV = {
  SystemRoot: 'C:\\Windows', USERPROFILE: 'C:\\Users\\svc', APPDATA: 'C:\\Users\\svc\\AppData\\Roaming',
  ProgramFiles: 'C:\\Program Files',
};

describe('cliLauncherPaths — the launcher\'s OWN paths, never a PATH lookup', () => {
  it('linux names exactly the two absolute binaries buildBrokerLaunch execs', () => {
    expect(cliLauncherPaths('linux', {})).toEqual({
      claude: [LINUX_CLI_LAUNCHERS.claude],
      codex: [LINUX_CLI_LAUNCHERS.codex],
    });
    // The shared constant is the launcher's, so a probe can never stat a path the launcher would not run.
    expect(LINUX_CLI_LAUNCHERS.claude).toBe('/var/lib/kb-shell/home/.local/bin/claude');
  });

  it('windows requires the codex SHIM, the package entry point AND node — codex runs as `node codex.js`', () => {
    const paths = cliLauncherPaths('win32', WINDOWS_ENV);
    expect(paths?.claude).toEqual(['C:\\Users\\svc\\.local\\bin\\claude.exe']);
    expect(paths?.codex).toHaveLength(3);
    expect(paths?.codex.some((path) => path.endsWith('node.exe'))).toBe(true);
    expect(paths?.codex.some((path) => path.endsWith('codex.js'))).toBe(true);
  });

  it('a service environment that cannot even name its launchers answers null (a closed answer)', () => {
    expect(cliLauncherPaths('win32', {})).toBeNull();
  });
});

describe('probeCliStatuses', () => {
  const withAccess = (reachable: readonly string[]) => async (path: string) => {
    if (!reachable.includes(path)) throw new Error(`ENOENT: ${path}`);
  };

  it('is `missing` for both on a host with no CLIs installed — the VM today', async () => {
    expect(await probeCliStatuses({ platform: 'linux', env: {}, access: withAccess([]) }))
      .toEqual({ claude: 'missing', codex: 'missing' });
  });

  it('flips ONLY the installed CLI to ready — one install does not vouch for the other', async () => {
    expect(await probeCliStatuses({
      platform: 'linux', env: {}, access: withAccess([LINUX_CLI_LAUNCHERS.claude]),
    })).toEqual({ claude: 'ready', codex: 'missing' });
    expect(await probeCliStatuses({
      platform: 'linux', env: {}, access: withAccess([LINUX_CLI_LAUNCHERS.codex]),
    })).toEqual({ claude: 'missing', codex: 'ready' });
  });

  it('reports ready once every file that launcher execs is reachable', async () => {
    const all = Object.values(LINUX_CLI_LAUNCHERS);
    expect(await probeCliStatuses({ platform: 'linux', env: {}, access: withAccess(all) }))
      .toEqual({ claude: 'ready', codex: 'ready' });
  });

  it('windows codex needs ALL THREE files — two out of three is still `missing`', async () => {
    const paths = cliLauncherPaths('win32', WINDOWS_ENV)!;
    const allButNode = paths.codex.filter((path) => !path.endsWith('node.exe'));
    expect(await probeCliStatuses({
      platform: 'win32', env: WINDOWS_ENV, access: withAccess(allButNode),
    })).toMatchObject({ codex: 'missing' });
    expect(await probeCliStatuses({
      platform: 'win32', env: WINDOWS_ENV, access: withAccess(paths.codex),
    })).toMatchObject({ codex: 'ready' });
  });

  it('an underivable launcher layout is closed, not a throw', async () => {
    expect(await probeCliStatuses({ platform: 'win32', env: {}, access: withAccess([]) }))
      .toEqual({ claude: 'missing', codex: 'missing' });
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

describe('probeFilesystemRoots — read off the PTY discriminant, never guessed from disk', () => {
  it('grants no root when this host has no terminal: no session, no root', () => {
    expect(probeFilesystemRoots(CLOSED_PTY)).toEqual([]);
  });

  it('advertises the advertised terminal\'s own roots, sorted for the decoder', () => {
    expect(probeFilesystemRoots(OPEN_PTY)).toEqual(['repo', 'worktrees']);
  });
});

describe('productionCapabilitySourcePorts — all five ports supplied, emptiness stated not accidental', () => {
  it('composes a slice whose connectors and gpu are explicitly closed, with the rest probed', async () => {
    const slice = await probeAdvertisementCapabilities(productionCapabilitySourcePorts({
      repoRoot: REPO_ROOT,
      pty: OPEN_PTY,
      platform: 'linux',
      env: {},
      access: async () => { throw new Error('no CLI on this host'); },
    }));
    expect(slice.connectors).toEqual([]);
    expect(slice.gpu).toBe(false);
    expect(slice.clis).toEqual({ claude: 'missing', codex: 'missing' });
    expect(slice.filesystemRoots).toEqual(['repo', 'worktrees']);
    expect(slice.skills.length).toBeGreaterThan(0);
  });

  it('a throwing probe degrades that ONE field to closed and never fails the composition', async () => {
    const slice = await probeAdvertisementCapabilities({
      ...productionCapabilitySourcePorts({
        repoRoot: REPO_ROOT, pty: CLOSED_PTY, platform: 'linux', env: {},
        access: async () => undefined,
      }),
      probeSkills: async () => { throw new Error('skills catalog unreadable'); },
    });
    expect(slice.skills).toEqual([]);
    expect(slice.clis).toEqual({ claude: 'ready', codex: 'ready' });
  });
});

/**
 * P3 deletion closure (plan section 4 inventory + section 9 residue scan).
 *
 * Three obligations that a passing feature suite cannot cover:
 *  1. Every path in the plan section 4 deleted inventory is absent from the tree — and the six paths
 *     that never existed at the P3 base are recorded as such rather than silently counted as work.
 *  2. No retained source imports or names a deleted module (the section 9 duplicate-authority scan),
 *     and no raw authority/legacy literal survives in the PTY surface (the section 9 raw scan).
 *  3. The server graph stays loadable under Node's strip-only default: no TypeScript constructor
 *     parameter properties, which is what `p3FixtureLifecycle.ts` dropped its transform flag for.
 */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const repoRoot = resolve(dashboardRoot, '..');
const at = (relPath: string): string => join(dashboardRoot, relPath);

/**
 * The PHASE BASE — the commit P3 started from. `absentAtBase` claims are checked against the real tree
 * at that commit with `git cat-file -e`, not against this file's own constants. It is deliberately the
 * base and not the mid-phase `027dce12` this file used to cite: a claim that a path was "already
 * missing when P3 started" is only auditable against the tree P3 actually started from. No inventory
 * path appeared mid-phase, so no path needs the mid-phase anchor; if one ever does, it gets its own
 * named constant here rather than moving this one.
 */
const P3_BASE_COMMIT = '9a72bbf8';
const existsAtBase = (relPath: string): boolean => {
  try {
    execFileSync('git', ['cat-file', '-e', `${P3_BASE_COMMIT}:dashboard/${relPath}`], {
      cwd: repoRoot, stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
};

/**
 * Plan section 4, "The exact deleted-path inventory is 21 files", transcribed literally. The six
 * `absentAtBase` entries were already missing when P3 started (W6.4 pass 1 finding): the inventory
 * over-counts by six phantoms, so the proof records the distinction instead of claiming 21 removals.
 */
const PLAN_SECTION_4_INVENTORY: readonly { path: string; absentAtBase: boolean }[] = [
  { path: 'server/pty/resolveCommand.ts', absentAtBase: false },
  { path: 'server/pty/resolveCommand.test.ts', absentAtBase: false },
  { path: 'server/pty/spawnRouting.ts', absentAtBase: false },
  { path: 'server/pty/host.ts', absentAtBase: false },
  { path: 'server/pty/host.test.ts', absentAtBase: false },
  { path: 'server/pty/sessionRunRoutes.ts', absentAtBase: false },
  { path: 'server/pty/sessionRunRoutes.test.ts', absentAtBase: false },
  { path: 'src/console/sessionRuns.tsx', absentAtBase: true },
  { path: 'src/console/sessionRuns.test.tsx', absentAtBase: true },
  { path: 'src/console/useAttachableSession.ts', absentAtBase: true },
  { path: 'src/console/useAttachableSession.test.tsx', absentAtBase: true },
  { path: 'src/views/AgentDetailConsole.test.tsx', absentAtBase: true },
  { path: 'src/views/WorkflowDetailRuns.test.tsx', absentAtBase: true },
  { path: 'server/control/claudeSessionAdapter.ts', absentAtBase: false },
  { path: 'server/control/claudeSessionAdapter.test.ts', absentAtBase: false },
  { path: 'server/control/codexSessionAdapter.ts', absentAtBase: false },
  { path: 'server/control/codexSessionAdapter.test.ts', absentAtBase: false },
  { path: 'server/control/broker.ts', absentAtBase: false },
  { path: 'server/control/broker.test.ts', absentAtBase: false },
  { path: 'server/control/brokerStore.ts', absentAtBase: false },
  { path: 'server/control/brokerStore.test.ts', absentAtBase: false },
];

/**
 * Deleted beyond the plan's inventory, by the W6.4 review ruling: both modules were production-dead
 * once W3's retention and BrowserPrincipal seams landed. They are proved absent on the same terms.
 */
const DELETED_BEYOND_PLAN: readonly string[] = [
  'server/pty/persistentSessions.ts',
  'server/pty/persistentSessions.test.ts',
  'server/pty/transcripts.ts',
  'server/pty/transcripts.test.ts',
];

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.css'];
const SKIP_DIRECTORIES = new Set(['node_modules', 'dist', 'dist-server', '.vite', 'coverage', '.p3-browser']);

function walkSources(relRoot: string): string[] {
  const found: string[] = [];
  const visit = (relDir: string): void => {
    for (const entry of readdirSync(at(relDir), { withFileTypes: true })) {
      const relPath = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) visit(relPath);
      } else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
        found.push(relPath);
      }
    }
  };
  visit(relRoot);
  return found;
}

const retainedSources = [...walkSources('server'), ...walkSources('src'), ...walkSources('shared')];
const readSource = (relPath: string): string => readFileSync(at(relPath), 'utf8');

/**
 * Plan section 9 scans `dashboard/dist dashboard/dist-server` too, and the ONE raw hit W6.6 ever found
 * was inside the minified browser bundle. Excluding it would have been the scan not looking where the
 * hit is, so the built tree is walked here on the same terms as source.
 */
function walkBuilt(relRoot: string): string[] {
  if (!existsSync(at(relRoot))) return [];
  const found: string[] = [];
  const visit = (relDir: string): void => {
    for (const entry of readdirSync(at(relDir), { withFileTypes: true })) {
      const relPath = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) visit(relPath);
      else if (/\.(?:js|mjs|cjs|css|html|json|webmanifest)$/.test(entry.name)) found.push(relPath);
    }
  };
  visit(relRoot);
  return found;
}
const builtOutputs = [...walkBuilt('dist'), ...walkBuilt('dist-server')];

/**
 * The single NAMED exemption for the built tree, recorded by exact match rather than by skipping the
 * directory. The minifier renames `delta.subagent = view` to `e.subagent=n`, and the raw pattern's
 * `agent=` matches the tail of that property assignment. It is a minified JS property write, not a raw
 * authority query field: the exemption therefore requires the matched token to be `agent=` immediately
 * preceded by an identifier character, in a bundle file — a real `?agent=` or `&agent=` query still fails.
 */
const BUNDLE_TOKEN_EXEMPTIONS: readonly { token: string; site: string; reason: string }[] = [{
  token: 'agent=',
  // The WHOLE minified site, not a shape: only `.subagent=` is exempt. A future `x.otheragent=` write
  // is a new fact about the bundle and must be looked at, not silently inherited by an identifier-class
  // rule; `?agent=`/`&agent=` still fail everywhere.
  site: '.subagent=',
  reason: 'minified property assignment (`.subagent=`), not a raw authority query field',
}];

function exemptBundleHit(relPath: string, source: string, match: RegExpMatchArray): boolean {
  if (!relPath.startsWith('dist/') && !relPath.startsWith('dist-server/')) return false;
  const index = match.index ?? 0;
  return BUNDLE_TOKEN_EXEMPTIONS.some((exemption) => {
    if (exemption.token !== match[0]) return false;
    const start = index - (exemption.site.length - exemption.token.length);
    return start >= 0 && source.slice(start, index + exemption.token.length) === exemption.site;
  });
}

describe('P3 deletion closure — section 4 inventory', () => {
  it('covers 21 planned paths plus the 2 modules (4 files) deleted beyond the plan', () => {
    expect(PLAN_SECTION_4_INVENTORY).toHaveLength(21);
    expect(DELETED_BEYOND_PLAN).toHaveLength(4);
    // Not a tautology: the 15 real removals must have EXISTED at the P3 base, or the tally that calls
    // them deletions is inflated. Checked against the base tree, not against the constant above.
    const notActuallyRemoved = PLAN_SECTION_4_INVENTORY
      .filter((entry) => !entry.absentAtBase && !existsAtBase(entry.path))
      .map((entry) => entry.path);
    expect(notActuallyRemoved).toEqual([]);
    expect(DELETED_BEYOND_PLAN.filter((relPath) => !existsAtBase(relPath))).toEqual([]);
  });

  it('finds every inventory path absent from the tree', () => {
    const present = [...PLAN_SECTION_4_INVENTORY.map((entry) => entry.path), ...DELETED_BEYOND_PLAN]
      .filter((relPath) => existsSync(at(relPath)));
    expect(present).toEqual([]);
  });

  it('records the six phantom paths as absent at base, not as P3 deletions', () => {
    // Proved against the base tree: the plan's "13 non-control files" is 7 real removals plus 6 paths
    // that never existed. P7's deletion inventory inherits this note.
    const claimed = PLAN_SECTION_4_INVENTORY.filter((entry) => entry.absentAtBase).map((entry) => entry.path);
    expect(claimed).toEqual([
      'src/console/sessionRuns.tsx',
      'src/console/sessionRuns.test.tsx',
      'src/console/useAttachableSession.ts',
      'src/console/useAttachableSession.test.tsx',
      'src/views/AgentDetailConsole.test.tsx',
      'src/views/WorkflowDetailRuns.test.tsx',
    ]);
    expect(claimed.filter((relPath) => existsAtBase(relPath))).toEqual([]);
    // The check has teeth only if `git cat-file -e` can see the base at all: two paths that DID exist
    // there anchor it, so a broken/absent base commit fails rather than greening every claim.
    expect([existsAtBase('server/pty/host.ts'), existsAtBase('server/control/broker.ts')]).toEqual([true, true]);
  });
});

describe('P3 deletion closure — section 9 residue scans', () => {
  it('retained-import/deletion closure', () => {
    // The plan section 9 duplicate-authority pattern, WIDENED with the three deleted modules' own
    // symbol names so `resolveCommand`/`spawnRouting`/`brokerStore` cannot be reinstated under a new
    // path undetected. `index.test.ts` is the one allowed hit: it pins the retired routes' 404s.
    const duplicate = /registerSessionRunRoutes|\/api\/pty\/session-runs|useAttachableSession|SessionRunList|createClaudeSessionAdapter|createCodexSessionAdapter|ManagedSessionBroker|controlBroker|createPtyHost|resolveCommand|resolveLauncherCommand|spawnRouting|routeSpawn|brokerStore|createBrokerStore|from '\.{1,2}\/host\.ts'/;
    const hits = [...retainedSources, ...builtOutputs]
      .filter((relPath) => relPath !== 'server/index.test.ts' && relPath !== 'server/pty/p3DeletionClosure.test.ts')
      .flatMap((relPath) => {
        const match = duplicate.exec(readSource(relPath));
        return match === null ? [] : [`${relPath}: ${match[0]}`];
      });
    expect(hits).toEqual([]);
  });

  it('keeps no raw authority or legacy viewer literal in the PTY surface', () => {
    // The plan section 9 raw pattern, over the same surface it names — INCLUDING `dist`/`dist-server`,
    // which is where the only raw hit W6.6 ever found actually lives. Vectors, the manifest, and test
    // files are the plan's enumerated exemptions — they must state the forbidden shapes to refuse them.
    const raw = /spawn=|agent=|workflow=|\?session=|"command"|"executable"|"args"|"argv"|"env"|"uid"|"user"|kb-terminal-tabs-v1|powershell\.exe/g;
    const surface = [
      ...walkSources('server/pty'),
      ...walkSources('src/console'),
      'src/lib/terminalClient.ts',
      'src/views/Terminal.tsx',
      ...builtOutputs,
    ];
    const hits = surface
      .filter((relPath) => !/\.test\.|ptyProtocolVectors\.ts|ptyAdversarialManifest\.json/.test(relPath))
      .flatMap((relPath) => {
        const source = readSource(relPath);
        return [...source.matchAll(raw)]
          .filter((match) => !exemptBundleHit(relPath, source, match))
          .map((match) => `${relPath}: ${match[0]}`);
      });
    expect(hits).toEqual([]);
  });

  it('scans the built output whenever a build is present in the tree', () => {
    // Keeps the exemption above from becoming a silent skip: with `dist`/`dist-server` on disk (the gate
    // runs `npm run build` before this suite) the bundle IS in the scanned surface.
    const buildPresent = existsSync(at('dist')) || existsSync(at('dist-server'));
    expect(buildPresent && builtOutputs.some((relPath) => relPath.endsWith('.js'))).toBe(buildPresent);
  });
});

/**
 * Every `constructor(...)` parameter list in `source` that declares a parameter property. The list is
 * scanned with a nesting counter so a function-typed parameter (`onDone: () => void`) does not end it,
 * and modifiers are recognised only at a parameter BOUNDARY (`(` or `,`), so `readonly` inside a
 * parameter type is not a hit.
 */
function parameterPropertyHits(source: string): string[] {
  const hits: string[] = [];
  const constructors = /\bconstructor\s*\(/g;
  for (const start of source.matchAll(constructors)) {
    const open = (start.index ?? 0) + start[0].length;
    let depth = 1;
    let index = open;
    for (; index < source.length && depth > 0; index += 1) {
      const character = source[index];
      if (character === '(' || character === '[' || character === '{') depth += 1;
      else if (character === ')' || character === ']' || character === '}') depth -= 1;
    }
    const parameters = source.slice(open, Math.max(open, index - 1));
    const modifier = /(?:^|,)\s*(?:@[\w$.]+(?:\([^)]*\))?\s*)*(private|public|protected|readonly)\s+[A-Za-z_$]/
      .exec(parameters);
    if (modifier !== null) hits.push(parameters.replace(/\s+/g, ' ').trim().slice(0, 90));
  }
  return hits;
}

describe('P3 deletion closure — strip-only floor', () => {
  /**
   * A HEURISTIC fast fail, not the floor itself. It scans the constructor parameter list with a nesting
   * counter (the earlier `[^)]*` stopped at the first `)`, so `constructor(onDone: () => void, private
   * readonly secret: string)` was invisible), but it still only knows about parameter properties — an
   * `enum` or `namespace` would break Node's strip-only load with this green. The load test below is
   * what actually proves the floor.
   */
  it('declares no TypeScript constructor parameter property anywhere in the server graph', () => {
    const offenders = retainedSources
      // This file is the enforcer and must spell the forbidden shape out in order to detect it; the
      // executed load test below is the independent wall on THIS suite's own graph.
      .filter((relPath) => relPath !== 'server/pty/p3DeletionClosure.test.ts')
      .filter((relPath) => relPath.endsWith('.ts') || relPath.endsWith('.tsx'))
      .flatMap((relPath) => parameterPropertyHits(readSource(relPath))
        .map((hit) => `${relPath}: ${hit}`));
    expect(offenders).toEqual([]);
  });

  it('proves the heuristic sees a parameter property behind a function-typed parameter', () => {
    // The exact evasion the earlier pattern admitted. A scan that cannot see this is not a fast fail.
    expect(parameterPropertyHits('class A { constructor(onDone: () => void, private readonly s: string) {} }'))
      .toHaveLength(1);
    expect(parameterPropertyHits('class A { constructor(private readonly x: string) {} }')).toHaveLength(1);
    // Not modifiers: `readonly` inside a parameter TYPE, and a plain parameter list.
    expect(parameterPropertyHits('class A { constructor(attempted: readonly string[]) {} }')).toEqual([]);
    expect(parameterPropertyHits('class A { constructor(a: string, b: () => void) {} }')).toEqual([]);
  });

  it.each([
    'server/testFixtures/p3AuthenticatedServer.ts',
    'server/testFixtures/p3FixtureLifecycle.ts',
  ])('loads %s under Node\'s strip-only default', (entry) => {
    // The floor, EXECUTED: strip-only Node (no `--experimental-transform-types`) must import the whole
    // module graph behind these two entries. Any construct Node cannot strip — a parameter property, a
    // value `enum`, a `namespace` — makes this exit nonzero, whatever the heuristic above thinks.
    const url = pathToFileURL(at(entry)).href;
    const result = execFileSync(
      process.execPath,
      ['--input-type=module', '-e', `await import(${JSON.stringify(url)});`],
      { cwd: dashboardRoot, timeout: 60_000, stdio: 'pipe', encoding: 'utf8' },
    );
    expect(typeof result).toBe('string');
  }, 70_000);

  it('spawns the fixture without a type-transform flag', () => {
    const lifecycle = readSource('server/testFixtures/p3FixtureLifecycle.ts');
    expect(lifecycle).not.toContain('--experimental-transform-types');
  });

  it('walks a real tree rather than an empty one', () => {
    // A scan that silently found no files would pass every assertion above.
    expect(retainedSources.length).toBeGreaterThan(200);
    expect(statSync(at('server/pty')).isDirectory()).toBe(true);
  });
});

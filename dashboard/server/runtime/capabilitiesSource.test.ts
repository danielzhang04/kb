/**
 * Plan section 9's capability-source scan. The suite has two halves: synthetic sources that pin the
 * scan's precision (it must catch a laundered OS guess and must NOT flag a conforming probe result),
 * and the real production tree, which must be clean.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, type Dirent } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { findOsDerivedPtyFlows, formatFinding, type ScannedSource } from './capabilitiesSource.ts';

const dashboardRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const scan = (text: string, path = 'synthetic.ts'): string[] =>
  findOsDerivedPtyFlows([{ path, text }]).map(formatFinding);

describe('findOsDerivedPtyFlows — refuses an OS-derived pty', () => {
  it('OS-derived-capability source flow', () => {
    // The headline attack: the capability is decided by the host OS instead of a probe.
    expect(scan("export const caps = { pty: process.platform === 'win32' };"))
      .toEqual(['synthetic.ts:1 property pty <- process.platform']);
  });

  it('follows the guess through a local binding', () => {
    expect(scan([
      "const isWindows = process.platform === 'win32';",
      'export const caps = { pty: isWindows };',
    ].join('\n'))).toEqual(['synthetic.ts:1 property pty <- process.platform (through isWindows)']);
  });

  it('catches an assignment, a variable, and a capability return', () => {
    expect(scan("declare const caps: { pty: boolean };\ncaps.pty = process.platform === 'win32';"))
      .toEqual(['synthetic.ts:2 assignment pty <- process.platform']);
    expect(scan("const pty = process.arch === 'x64';"))
      .toEqual(['synthetic.ts:1 variable pty <- process.arch']);
    // A returned OBJECT literal is scanned property-wise; a returned EXPRESSION is the return sink.
    expect(scan([
      'function readPtyCapability(): PublicPtyCapability {',
      "  return { pty: process.platform === 'win32', host: 'desktop' } as PublicPtyCapability;",
      '}',
    ].join('\n'))).toEqual(['synthetic.ts:2 property pty <- process.platform']);
    expect(scan([
      'function readPtyCapability(): PublicPtyCapability {',
      "  return toCapability(process.platform === 'win32');",
      '}',
    ].join('\n'))).toEqual(['synthetic.ts:2 return pty <- process.platform']);
  });

  it('catches os module reads through a namespace and a named import', () => {
    expect(scan([
      "import * as os from 'node:os';",
      "export const caps = { pty: os.platform() === 'win32' };",
    ].join('\n'))).toEqual(['synthetic.ts:2 property pty <- os.platform']);
    expect(scan([
      "import { platform } from 'node:os';",
      "export const caps = { pty: platform() === 'win32' };",
    ].join('\n'))).toEqual(['synthetic.ts:2 property pty <- platform() [node:os]']);
  });
});

describe('findOsDerivedPtyFlows — accepts conforming probe results', () => {
  it('accepts both closed probe branches, including an OS-derived SIBLING field', () => {
    // The exact shape `runtime/capabilities.ts` builds: `pty` comes from the probe, while a sibling
    // diagnostic may legitimately name the platform. Flagging this would push the codebase toward a
    // worse shape to satisfy the scan.
    expect(scan([
      'export function unavailablePtyCapability(platform: string) {',
      '  return {',
      '    pty: false as const,',
      "    diagnostic: { reason: platform === 'win32' ? 'node-pty-unavailable' : 'broker-unavailable' },",
      '  };',
      '}',
      'export const available = { pty: probe.available, host: probe.host };',
    ].join('\n'))).toEqual([]);
  });

  it('accepts consumption of a pty value and an unrelated OS read', () => {
    expect(scan([
      "const command = process.platform === 'win32' ? 'py' : 'python3';",
      'export const usable = capabilities.pty ? capabilities.launchers : [];',
      'export const caps = { pty: probeResult.available };',
    ].join('\n'))).toEqual([]);
  });

  it('does not treat a non-pty property or a non-capability return as a sink', () => {
    expect(scan("export const host = { executionHost: process.platform === 'win32' ? 'desktop' : 'vm' };"))
      .toEqual([]);
    expect(scan("function pickCommand(): string {\n  return process.platform === 'win32' ? 'py' : 'python3';\n}"))
      .toEqual([]);
  });
});

describe('production sources', () => {
  const SKIP = new Set(['node_modules', 'dist', 'dist-server', 'test-fixtures', 'testFixtures', '.p3-browser']);
  // Read lazily and tolerantly: sibling suites in the same gate create and remove scratch directories
  // under the tree while this walk runs, and a vanished entry is not a capability finding.
  const collect = (relDir: string, into: ScannedSource[]): ScannedSource[] => {
    let entries: Dirent[];
    try {
      entries = readdirSync(join(dashboardRoot, relDir), { withFileTypes: true });
    } catch {
      return into;
    }
    for (const entry of entries) {
      const relPath = `${relDir}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!SKIP.has(entry.name)) collect(relPath, into);
      } else if ((entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) && !/\.test\./.test(entry.name)) {
        try {
          into.push({ path: relPath, text: readFileSync(join(dashboardRoot, relPath), 'utf8') });
        } catch { /* removed mid-walk */ }
      }
    }
    return into;
  };

  const productionSources = (): ScannedSource[] => collect('server', collect('src', []));

  it('scans a real tree, not an empty one', () => {
    const sources = productionSources();
    expect(sources.length).toBeGreaterThan(150);
    expect(sources.some((source) => source.path === 'server/runtime/capabilities.ts')).toBe(true);
  });

  // This walks AND scans the whole production tree (~250 files), so it is I/O-bound and load-sensitive:
  // measured here on a warm cache it runs 1.5-4.2 s, and a cold cache or a parallel batch run pushes it
  // past the 5-s default. The straddle is a property of the walk, not of any one source — adding
  // `runtime/capabilityProbes.ts` (8.6 KB) cost a measured 23 ms of scan, and the same 1.5-4.2 s spread
  // was present without it. An explicit budget, so this gate fails on findings and not on machine load.
  it('derives no pty capability from the operating system anywhere in production source', () => {
    expect(findOsDerivedPtyFlows(productionSources()).map(formatFinding)).toEqual([]);
  }, 30_000);
});

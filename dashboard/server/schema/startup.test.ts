import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { assertSupportedRepositoryData } from './startup.ts';

let warnSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}); });
afterEach(() => { warnSpy.mockRestore(); });

function warnedMatching(pattern: RegExp): boolean {
  return warnSpy.mock.calls.some((c: unknown[]) => pattern.test(String(c[0])));
}

it('accepts v0 and v1, then skips an unsupported queue card without aborting boot', () => {
  const root = mkdtempSync(join(tmpdir(), 'schema-startup-'));
  mkdirSync(join(root, 'queue', 'inbox'), { recursive: true });
  writeFileSync(join(root, 'queue', 'inbox', 'v0.md'), '---\nid: v0\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n');
  writeFileSync(join(root, 'queue', 'inbox', 'v1.md'), '---\nschema-version: 1\nid: v1\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n');
  expect(() => assertSupportedRepositoryData(root)).not.toThrow();
  writeFileSync(join(root, 'queue', 'inbox', 'v2.md'), '---\nschema-version: 2\nid: v2\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n');
  const summary = assertSupportedRepositoryData(root);
  expect(summary.skippedCards).toBe(1);
  expect(warnedMatching(/v2\.md.*schema-version/s)).toBe(true);
});

it.each([
  ['missing-action.md', '---\nid: bad\nproject: kb-ops\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n'],
  ['list-action.md', '---\nid: bad\nproject: kb-ops\naction: [test:noop]\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n'],
  ['bad-state.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: invented\n---\n'],
  ['bad-tier.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T4\nstate: inbox\n---\n'],
  ['bad-list.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\ndepends-on:\n  - nested\n---\n'],
])('skips a structurally-malformed card %s at boot instead of aborting', (name, source) => {
  const root = mkdtempSync(join(tmpdir(), 'schema-startup-bad-'));
  mkdirSync(join(root, 'queue', 'inbox'), { recursive: true });
  writeFileSync(join(root, 'queue', 'inbox', name), source);
  let summary: ReturnType<typeof assertSupportedRepositoryData>;
  expect(() => { summary = assertSupportedRepositoryData(root); }).not.toThrow();
  expect(summary!.skippedCards).toBe(1);
  expect(warnedMatching(new RegExp(`${name}.*card schema|${name}.*frontmatter`, 's'))).toBe(true);
});

it('tolerates a card with unknown frontmatter keys (forward-compat) but still boots', () => {
  // The shared ops branch is written by many tools; a not-yet-merged arc's extra metadata key must
  // NOT crash the platform boot. It is ignored (the platform reads only known fields); a structural
  // problem in the SAME card is skipped-and-warned too (below), never fatal.
  const root = mkdtempSync(join(tmpdir(), 'schema-startup-fwd-'));
  mkdirSync(join(root, 'queue', 'inbox'), { recursive: true });
  writeFileSync(join(root, 'queue', 'inbox', 'unknown.md'), '---\nschema-version: 1\nid: ok\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\nkit_sha: abc123\nfuture_arc_field: whatever\n---\n');
  expect(() => assertSupportedRepositoryData(root)).not.toThrow();
  // A card with an unknown key AND a structural error (bad tier) is skipped, not fatal.
  writeFileSync(join(root, 'queue', 'inbox', 'unknown-and-broken.md'), '---\nschema-version: 1\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T4\nstate: inbox\nkit_sha: abc123\n---\n');
  const summary = assertSupportedRepositoryData(root);
  expect(summary.skippedCards).toBe(1);
  expect(warnedMatching(/unknown-and-broken\.md.*card schema/s)).toBe(true);
});

it('skips an archived card with an unsupported state-history block list, still counts the valid card', () => {
  // Regression for F7: one archived card on the shared ops branch carried
  // `state-history:\n  - working: dispatcher-cloud 2026-09-06 (nightly cloud run)`, which the narrow
  // frontmatter parser rejects as an unsupported continuation (cards.ts). That must not take the
  // whole platform down at boot.
  const root = mkdtempSync(join(tmpdir(), 'schema-startup-history-'));
  mkdirSync(join(root, 'queue', 'done'), { recursive: true });
  writeFileSync(
    join(root, 'queue', 'done', 'valid.md'),
    '---\nid: valid\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: done\n---\n',
  );
  writeFileSync(
    join(root, 'queue', 'done', '6a9d02da-7de01dbe.md'),
    '---\nid: 6a9d02da-7de01dbe\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: done\nstate-history:\n  - working: dispatcher-cloud 2026-09-06 (nightly cloud run)\n---\n',
  );
  let summary: ReturnType<typeof assertSupportedRepositoryData>;
  expect(() => { summary = assertSupportedRepositoryData(root); }).not.toThrow();
  expect(summary!.skippedCards).toBe(1);
  expect(warnedMatching(/6a9d02da-7de01dbe\.md.*unparseable frontmatter/s)).toBe(true);
  expect(warnedMatching(/startup: 1 card\(s\) skipped at boot/)).toBe(true);
});

it('reports missing schema infrastructure distinctly before scanning cards', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'schema-startup-repo-'));
  const platformRoot = mkdtempSync(join(tmpdir(), 'schema-startup-platform-'));
  mkdirSync(join(repoRoot, 'queue', 'inbox'), { recursive: true });
  expect(() => assertSupportedRepositoryData(repoRoot, platformRoot)).toThrow(/schema infrastructure error.*compatibility\.json/s);
});

it('reports a missing card schema as infrastructure failure rather than a malformed card', () => {
  const repoRoot = mkdtempSync(join(tmpdir(), 'schema-startup-repo-'));
  const platformRoot = mkdtempSync(join(tmpdir(), 'schema-startup-platform-'));
  mkdirSync(join(platformRoot, 'schemas'), { recursive: true });
  writeFileSync(join(platformRoot, 'schemas', 'compatibility.json'), JSON.stringify({
    cards: { current: 1, supported: [0, 1] },
    workflows: { current: 1, supported: [0, 1] },
  }));
  expect(() => assertSupportedRepositoryData(repoRoot, platformRoot)).toThrow(/schema infrastructure error.*v1\.schema\.json/s);
});

it('ignores archived and nested queue markdown that runtime readers never scan', () => {
  const root = mkdtempSync(join(tmpdir(), 'schema-startup-flat-'));
  mkdirSync(join(root, 'queue', 'archived'), { recursive: true });
  mkdirSync(join(root, 'queue', 'inbox', 'nested'), { recursive: true });
  writeFileSync(join(root, 'queue', 'archived', 'bad.md'), 'not frontmatter');
  writeFileSync(join(root, 'queue', 'inbox', 'nested', 'bad.md'), 'not frontmatter');
  expect(() => assertSupportedRepositoryData(root)).not.toThrow();
});

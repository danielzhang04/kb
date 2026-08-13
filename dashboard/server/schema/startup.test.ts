import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { assertSupportedRepositoryData } from './startup.ts';

it('accepts v0 and v1, then refuses an unsupported queue card', () => {
  const root = mkdtempSync(join(tmpdir(), 'schema-startup-'));
  mkdirSync(join(root, 'queue', 'inbox'), { recursive: true });
  writeFileSync(join(root, 'queue', 'inbox', 'v0.md'), '---\nid: v0\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n');
  writeFileSync(join(root, 'queue', 'inbox', 'v1.md'), '---\nschema-version: 1\nid: v1\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n');
  expect(() => assertSupportedRepositoryData(root)).not.toThrow();
  writeFileSync(join(root, 'queue', 'inbox', 'v2.md'), '---\nschema-version: 2\nid: v2\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n');
  expect(() => assertSupportedRepositoryData(root)).toThrow(/v2\.md.*schema-version/s);
});

it.each([
  ['missing-action.md', '---\nid: bad\nproject: kb-ops\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n'],
  ['list-action.md', '---\nid: bad\nproject: kb-ops\naction: [test:noop]\ntarget: x\nrisk-tier: T1\nstate: inbox\n---\n'],
  ['bad-state.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: invented\n---\n'],
  ['bad-tier.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T4\nstate: inbox\n---\n'],
  ['bad-list.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\ndepends-on:\n  - nested\n---\n'],
  ['unknown.md', '---\nid: bad\nproject: kb-ops\naction: test:noop\ntarget: x\nrisk-tier: T1\nstate: inbox\nunknown-field: value\n---\n'],
])('refuses malformed card %s before listen', (name, source) => {
  const root = mkdtempSync(join(tmpdir(), 'schema-startup-bad-'));
  mkdirSync(join(root, 'queue', 'inbox'), { recursive: true });
  writeFileSync(join(root, 'queue', 'inbox', name), source);
  expect(() => assertSupportedRepositoryData(root)).toThrow(new RegExp(`${name}.*card schema|${name}.*frontmatter`, 's'));
});

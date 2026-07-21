/**
 * Owner-activity reader — proves the corrected owner-idle clock. Every fs/git effect is injected as a
 * recording fake: no real filesystem or git. The load-bearing assertions are (1) an owner with NO
 * observable footprint returns `lastActivityMs: null` (UNKNOWN => the archiver treats it as ALIVE), and
 * (2) the newest signal across dispatch/activity shards, memory mtime, and git-author wins.
 */
import { describe, expect, it } from 'vitest';
import { defaultOwnerActivity, type OwnerActivityDeps } from './ownerActivity.ts';

const REPO = '/repo';

/** Deps with NOTHING observable — every source empty/absent. Individual tests turn sources on. */
function emptyDeps(over: Partial<OwnerActivityDeps> = {}): OwnerActivityDeps {
  return {
    readDir: () => [],
    statMs: () => null,
    gitAuthorLastMs: () => null,
    ...over,
  };
}

const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00.000Z`);

describe('defaultOwnerActivity', () => {
  it('returns UNKNOWN (null) for an owner with NO observable footprint — the archiver treats null as ALIVE', () => {
    // This is the worker-desktop case: no shard, no memory file, no commit.
    const result = defaultOwnerActivity('worker-desktop', REPO, emptyDeps());
    expect(result.lastActivityMs).toBeNull();
    expect(result.sources).toEqual([]);
  });

  it('resolves a dispatch shard day by owner-prefixed filename', () => {
    const deps = emptyDeps({
      readDir: (dir) => (dir.endsWith('dispatch') ? ['dispatcher-cloud-2026-07-18.tsv', 'dispatcher-cloud-2026-07-15.tsv'] : []),
    });
    const result = defaultOwnerActivity('dispatcher-cloud', REPO, deps);
    expect(result.lastActivityMs).toBe(dayMs('2026-07-18')); // newest of the two shard days
    expect(result.sources[0].source).toBe('ledgers/dispatch');
  });

  it('does NOT let `worker` pick up `worker-desktop` shards (exact owner-prefix match)', () => {
    const deps = emptyDeps({
      readDir: (dir) => (dir.endsWith('dispatch') ? ['worker-desktop-2026-07-18.tsv'] : []),
    });
    expect(defaultOwnerActivity('worker', REPO, deps).lastActivityMs).toBeNull();
    expect(defaultOwnerActivity('worker-desktop', REPO, deps).lastActivityMs).toBe(dayMs('2026-07-18'));
  });

  it('resolves memory/<owner>.md mtime as a signal', () => {
    const memMs = Date.parse('2026-07-20T12:00:00.000Z');
    const deps = emptyDeps({ statMs: (p) => (p.endsWith('memory/dispatcher-cloud.md') || p.endsWith('memory\\dispatcher-cloud.md') ? memMs : null) });
    const result = defaultOwnerActivity('dispatcher-cloud', REPO, deps);
    expect(result.lastActivityMs).toBe(memMs);
    expect(result.sources[0].source).toBe('memory/dispatcher-cloud.md');
  });

  it('resolves a git-authored commit as a signal', () => {
    const gitMs = Date.parse('2026-07-21T06:12:01.000Z');
    const deps = emptyDeps({ gitAuthorLastMs: (owner) => (owner === 'claude-boss' ? gitMs : null) });
    const result = defaultOwnerActivity('claude-boss', REPO, deps);
    expect(result.lastActivityMs).toBe(gitMs);
    expect(result.sources[0].source).toBe('git commit (--author)');
  });

  it('takes the NEWEST across all sources and reports them newest-first', () => {
    const gitMs = Date.parse('2026-07-21T06:12:01.000Z'); // newest
    const memMs = Date.parse('2026-07-19T00:00:00.000Z');
    const deps = emptyDeps({
      readDir: (dir) => (dir.endsWith('dispatch') ? ['dispatcher-cloud-2026-07-18.tsv'] : []),
      statMs: () => memMs,
      gitAuthorLastMs: () => gitMs,
    });
    const result = defaultOwnerActivity('dispatcher-cloud', REPO, deps);
    expect(result.lastActivityMs).toBe(gitMs);
    expect(result.sources.map((s) => s.ms)).toEqual([...result.sources.map((s) => s.ms)].sort((a, b) => b - a));
    expect(result.sources[0].ms).toBe(gitMs);
  });

  it('fails soft: a throwing readDir / statMs / git reader is swallowed by the DEFAULT impls, not this one', () => {
    // The default readers catch their own errors; if a caller injects a throwing fake the reader itself
    // does not catch it (that is the injected contract). Here we confirm partial-signal resolution: git
    // resolves, dispatch/activity/memory do not.
    const gitMs = Date.parse('2026-07-21T00:00:00.000Z');
    const deps = emptyDeps({ gitAuthorLastMs: () => gitMs });
    const result = defaultOwnerActivity('some-agent', REPO, deps);
    expect(result.lastActivityMs).toBe(gitMs);
    expect(result.sources).toHaveLength(1);
  });
});

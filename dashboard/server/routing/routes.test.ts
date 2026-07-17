import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildRoutingSnapshot } from './routes.ts';

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'routing-snap-'));
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

function writePolicy(): void {
  mkdirSync(join(repo, 'governance'), { recursive: true });
  writeFileSync(
    join(repo, 'governance', 'model-routing.yaml'),
    `version: 1
runtimes:
  claude:
    default_worker: worker-desktop
    aliases: { opus: claude-opus-4-8, sonnet: claude-sonnet-5, haiku: claude-haiku-4-5 }
    known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
  codex:
    default_worker: codex-worker
    aliases: { codex: gpt-5-codex }
    known_models: [gpt-5-codex]
policy:
  work:
    T3: { runtime: claude, model: opus }
role_default: { runtime: claude, model: sonnet }
`,
    'utf-8',
  );
}

function writeCard(state: string, meta: Record<string, string>): void {
  const dir = join(repo, 'queue', state);
  mkdirSync(dir, { recursive: true });
  const fm = Object.entries(meta)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  writeFileSync(join(dir, `${meta.id}.md`), `---\n${fm}\n---\n\n## Work order\n\nx\n`, 'utf-8');
}

describe('buildRoutingSnapshot (GET /api/routing projection)', () => {
  it('exposes the parsed registry (runtimes + matrix + role_default)', () => {
    writePolicy();
    const snap = buildRoutingSnapshot(repo);
    expect(Object.keys(snap.policy.runtimes)).toEqual(['claude', 'codex']);
    expect(snap.policy.runtimes.claude.known_models).toEqual([
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-haiku-4-5',
    ]);
    expect(snap.policy.runtimes.codex.default_worker).toBe('codex-worker');
    expect(snap.policy.matrix.work.T3).toEqual({ runtime: 'claude', model: 'opus' });
    expect(snap.policy.role_default).toEqual({ runtime: 'claude', model: 'sonnet' });
  });

  it('computes per-card stamped + effective routing (source policy)', () => {
    writePolicy();
    writeCard('working', {
      id: 'card-A',
      owner: 'worker-desktop',
      state: 'working',
      action: 'build',
      target: 't',
      'risk-tier': 'T3',
      role: 'work',
      project: 'kb',
    });
    const snap = buildRoutingSnapshot(repo);
    const view = snap.cards['card-A'];
    expect(view.stamped).toEqual({ runtime: null, model: null });
    expect(view.effective).toMatchObject({
      runtime: 'claude',
      model: 'claude-opus-4-8',
      sourceModel: 'policy',
      unroutable: false,
    });
  });

  it('honours a card-frontmatter override as source=card', () => {
    writePolicy();
    writeCard('inbox', {
      id: 'card-B',
      owner: 'worker-desktop',
      state: 'inbox',
      action: 'x',
      target: 't',
      'risk-tier': 'T1',
      role: 'work',
      runtime: 'codex',
      model: 'gpt-5-codex',
      project: 'kb',
    });
    const snap = buildRoutingSnapshot(repo);
    expect(snap.cards['card-B'].stamped).toEqual({ runtime: 'codex', model: 'gpt-5-codex' });
    expect(snap.cards['card-B'].effective).toMatchObject({
      runtime: 'codex',
      model: 'gpt-5-codex',
      sourceRuntime: 'card',
    });
  });

  it('marks a card naming an unknown model unroutable (fail-loud, never a silent substitution)', () => {
    writePolicy();
    writeCard('inbox', {
      id: 'card-C',
      owner: 'worker-desktop',
      state: 'inbox',
      action: 'x',
      target: 't',
      'risk-tier': 'T1',
      role: 'work',
      runtime: 'claude',
      model: 'claude-ultra-9',
      project: 'kb',
    });
    const snap = buildRoutingSnapshot(repo);
    expect(snap.cards['card-C'].effective).toMatchObject({ unroutable: true });
  });

  it('lists agents with effective routing and is empty-safe with absent policy', () => {
    writeCard('working', {
      id: 'card-D',
      owner: 'worker-desktop',
      state: 'working',
      action: 'x',
      target: 't',
      'risk-tier': 'T1',
      project: 'kb',
    });
    // No policy file at all -> safe default, agents still listed, no throw.
    const snap = buildRoutingSnapshot(repo);
    expect(snap.agents.map((a) => a.id)).toEqual(['worker-desktop']);
    expect(snap.agents[0].effective).toMatchObject({ runtime: 'claude', model: 'claude-sonnet-5', sourceRuntime: 'default' });
    expect(snap.audit).toEqual({ mismatches: [], overrides: [] });
  });
});

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { GitRunner } from './branch.ts';
import type { AppendAuditFn } from '../http/context.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import { parseYaml } from '../routing/yaml.ts';
import { setOverride, clearOverride } from './routingOverride.ts';

const SECRET = Buffer.from('unit-test-secret-do-not-reuse');
const CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };
const token = (): string => mintSession('daniel@webauthn', CONFIG).token;

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'routing-override-'));
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
});
afterEach(() => rmSync(repo, { recursive: true, force: true }));

function recorder(): { runner: GitRunner; calls: string[][] } {
  const calls: string[][] = [];
  const runner: GitRunner = (_r, args) => {
    calls.push(args);
    return '';
  };
  return { runner, calls };
}

function auditSink(): { fn: AppendAuditFn; rows: AuditEvent[] } {
  const rows: AuditEvent[] = [];
  const fn: AppendAuditFn = (_repo, event) => {
    rows.push(event);
    return { ts: 'x', ...event } as AuditRow;
  };
  return { fn, rows };
}

/** A no-op audit sink for write-path tests that assert git behaviour, not the audit row (keeps the real
 *  git-shelling appendAudit out of the hermetic path). */
const noAudit: AppendAuditFn = (_r, event) => ({ ts: 'x', ...event }) as AuditRow;

function overridesOnDisk(): any[] {
  const f = join(repo, 'queue', 'routing-override.yaml');
  if (!existsSync(f)) return [];
  return (parseYaml(readFileSync(f, 'utf-8')) as any).overrides;
}

describe('setOverride — session gate', () => {
  it('rejects a setOverride without a valid WebAuthn session (401), no git, no audit', async () => {
    const { runner, calls } = recorder();
    const audit = auditSink();
    const r = await setOverride(
      { repoRoot: repo, sessionToken: undefined, sessionConfig: CONFIG },
      { scope: 'agent', key: 'codex-worker', runtime: 'codex', model: 'gpt-5-codex' },
      { runGit: runner, appendAudit: audit.fn },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
    expect(calls).toHaveLength(0);
    expect(audit.rows).toHaveLength(0);
  });
});

describe('setOverride — registry validation', () => {
  it('rejects an entry whose runtime is not in the policy registry (400)', async () => {
    const { runner } = recorder();
    const r = await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'a', runtime: 'gemini', model: 'x' },
      { runGit: runner },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it('rejects a model that is not a known model of the runtime (400) — incl. an alias', async () => {
    const { runner } = recorder();
    for (const model of ['claude-ultra-9', 'opus']) {
      const r = await setOverride(
        { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
        { scope: 'agent', key: 'a', runtime: 'claude', model },
        { runGit: runner },
      );
      expect(r.ok, model).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  it('rejects an unparseable expires (400)', async () => {
    const r = await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'a', runtime: 'claude', model: 'claude-opus-4-8', expires: 'not-a-date' },
      { runGit: recorder().runner },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe('setOverride — governed coordination write', () => {
  it('writes queue/routing-override.yaml via ops pull-rebase-push, never a push to main, retrying a rejected push', async () => {
    const calls: string[][] = [];
    let pushAttempts = 0;
    const runner: GitRunner = (_r, args) => {
      calls.push(args);
      if (args[0] === 'push' && args[2] === 'ops') {
        pushAttempts += 1;
        if (pushAttempts === 1) throw new Error('rejected'); // first push rejected -> reconcile + retry
      }
      return '';
    };
    const r = await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'codex-worker', runtime: 'codex', model: 'gpt-5-codex' },
      { runGit: runner, appendAudit: noAudit },
    );
    expect(r.ok).toBe(true);

    // pull --rebase origin ops precedes commit.
    const pullIdx = calls.findIndex((c) => c[0] === 'pull' && c.includes('ops'));
    const commitIdx = calls.findIndex((c) => c[0] === 'commit');
    expect(pullIdx).toBeGreaterThanOrEqual(0);
    expect(pullIdx).toBeLessThan(commitIdx);
    // Never a push to main; retries on rejected push (>=2 pulls seen).
    expect(calls.some((c) => c[0] === 'push' && c.includes('main'))).toBe(false);
    expect(pushAttempts).toBe(2);
    expect(calls.filter((c) => c[0] === 'pull').length).toBeGreaterThanOrEqual(2);

    // Entry round-tripped onto disk with provenance stamps.
    const entry = overridesOnDisk()[0];
    expect(entry).toMatchObject({ scope: 'agent', key: 'codex-worker', runtime: 'codex', model: 'gpt-5-codex' });
    expect(entry['set-by']).toBe('daniel@webauthn');
    expect(typeof entry['set-at']).toBe('string');
  });

  it('replaces a prior same scope+key entry (last-wins) and round-trips a TTL', async () => {
    await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'w', runtime: 'claude', model: 'claude-haiku-4-5' },
      { runGit: recorder().runner, appendAudit: noAudit },
    );
    await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'w', runtime: 'claude', model: 'claude-opus-4-8', expires: '2099-01-01T00:00:00Z' },
      { runGit: recorder().runner, appendAudit: noAudit },
    );
    const list = overridesOnDisk();
    expect(list).toHaveLength(1); // replaced, not appended
    expect(list[0]).toMatchObject({ model: 'claude-opus-4-8', expires: '2099-01-01T00:00:00Z' });
  });

  it('accepts a model-only (partial) override and keeps it partial', async () => {
    await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'card', key: 'card-1', model: 'claude-sonnet-5' },
      { runGit: recorder().runner, appendAudit: noAudit },
    );
    const entry = overridesOnDisk()[0];
    expect(entry).toMatchObject({ scope: 'card', key: 'card-1', model: 'claude-sonnet-5' });
    expect('runtime' in entry).toBe(false);
  });
});

describe('audit + clear', () => {
  it('every setOverride emits exactly one D2.9 audit row', async () => {
    const audit = auditSink();
    await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'codex-worker', runtime: 'codex', model: 'gpt-5-codex' },
      { runGit: recorder().runner, appendAudit: audit.fn },
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ action: 'routing-override', owner: 'daniel@webauthn', target: 'agent:codex-worker' });
  });

  it('clearOverride removes the matching entry (agent-scope), audits once, and is idempotent', async () => {
    await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'codex-worker', runtime: 'codex', model: 'gpt-5-codex' },
      { runGit: recorder().runner, appendAudit: noAudit },
    );
    expect(overridesOnDisk()).toHaveLength(1);

    const audit = auditSink();
    const first = await clearOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'codex-worker' },
      { runGit: recorder().runner, appendAudit: audit.fn },
    );
    expect(first.ok).toBe(true);
    if (first.ok) expect(first.changed).toBe(true);
    expect(overridesOnDisk()).toHaveLength(0);
    expect(audit.rows).toHaveLength(1);

    // Second clear: no match -> idempotent no-op, no audit.
    const audit2 = auditSink();
    const second = await clearOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'codex-worker' },
      { runGit: recorder().runner, appendAudit: audit2.fn },
    );
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.changed).toBe(false);
    expect(audit2.rows).toHaveLength(0);
  });
});

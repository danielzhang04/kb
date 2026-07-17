import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { GitRunner } from './branch.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import { parseYaml } from '../routing/yaml.ts';
import { setOverride, clearOverride } from './routingOverride.ts';
import type { LocalAuditAppend } from './routingOverride.ts';
import { parseIsoMs, effectiveForCard } from '../routing/effective.ts';
import { readRoutingAudit } from '../routing/audit.ts';
import { loadPolicy, loadOverride } from '../routing/policy.ts';

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

function auditSink(): { fn: LocalAuditAppend; rows: AuditEvent[] } {
  const rows: AuditEvent[] = [];
  const fn: LocalAuditAppend = (_repo, event) => {
    rows.push(event);
    return { ts: 'x', ...event } as AuditRow;
  };
  return { fn, rows };
}

/** A no-op LOCAL audit sink for write-path tests that assert git behaviour, not the audit row. */
const noAudit: LocalAuditAppend = (_r, event) => ({ ts: 'x', ...event }) as AuditRow;

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
    const overridePath = join(repo, 'queue', 'routing-override.yaml');
    const runner: GitRunner = (_r, args) => {
      calls.push(args);
      // Model `git reset --hard HEAD~1`: drop the previous (unpushed) attempt's commit + working change,
      // restoring the override file to its (empty) base — so the retry rebuilds from the reconciled tree.
      if (args[0] === 'reset') rmSync(overridePath, { force: true });
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

const CANONICAL_ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

describe('setOverride — canonical ISO expires (MED-1)', () => {
  // DECISION: reject a non-ISO form outright rather than silently canonicalize it. "Jan 1 2099" parses
  // under JS Date.parse in SERVER-LOCAL time but the Python consumer's datetime.fromisoformat rejects it
  // — silently coercing would bake in a timezone-shifted instant. So: reject non-ISO (400), and
  // canonicalize accepted ISO to the exact `Z` form all four expiry parsers agree on.
  it('rejects a lenient non-ISO date form (400) — never silently coerced', async () => {
    for (const bad of ['Jan 1 2099', '01/01/2099', 'next friday', '2099']) {
      const r = await setOverride(
        { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
        { scope: 'agent', key: 'w', runtime: 'claude', model: 'claude-opus-4-8', expires: bad },
        { runGit: recorder().runner, appendAudit: noAudit },
      );
      expect(r.ok, bad).toBe(false);
      if (!r.ok) expect(r.status).toBe(400);
    }
  });

  it('canonicalizes accepted ISO (naive + offset forms) to a fromisoformat-compatible `...Z` string on disk', async () => {
    // A naive (no-offset) stamp is treated as UTC; an offset stamp is normalized to UTC. Both land as
    // canonical `Z`.
    await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'naive', runtime: 'claude', model: 'claude-opus-4-8', expires: '2099-01-01T00:00:00' },
      { runGit: recorder().runner, appendAudit: noAudit },
    );
    const naive = overridesOnDisk()[0];
    expect(naive.expires).toBe('2099-01-01T00:00:00Z');
    expect(naive.expires).toMatch(CANONICAL_ISO_RE);
    // Python parity: datetime.fromisoformat(canonical.replace('Z','+00:00')) succeeds (asserted via the
    // shared normalization parseIsoMs, and verified manually with py -3 during this fix).
    expect(Number.isNaN(parseIsoMs(naive.expires))).toBe(false);

    // An explicit +05:00 offset normalizes to the same instant in UTC.
    await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'offset', runtime: 'claude', model: 'claude-opus-4-8', expires: '2099-01-01T05:00:00+05:00' },
      { runGit: recorder().runner, appendAudit: noAudit },
    );
    const offset = overridesOnDisk().find((e: any) => e.key === 'offset');
    expect(offset.expires).toBe('2099-01-01T00:00:00Z');
    expect(offset.expires).toMatch(CANONICAL_ISO_RE);
  });

  it('cross-parser fixture: effective.ts + audit.ts agree on the canonical stored form', async () => {
    // Store an override that expires in the near future, then confirm BOTH read-side parsers agree.
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1h, valid ISO
    await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'card', key: 'card-xp', runtime: 'claude', model: 'claude-opus-4-8', expires: future },
      { runGit: recorder().runner, appendAudit: noAudit },
    );
    const stored = overridesOnDisk()[0].expires as string;
    expect(stored).toMatch(CANONICAL_ISO_RE);
    const storedMs = parseIsoMs(stored);

    // effective.ts: the entry is NOT expired now, IS expired just after `stored`.
    const policy = loadPolicy(repo);
    const override = loadOverride(repo);
    const meta = { id: 'card-xp', owner: 'w', runtime: null, model: null };
    expect(effectiveForCard(meta, policy, override, storedMs - 1).sourceModel).toBe('override');
    expect(effectiveForCard(meta, policy, override, storedMs + 1).sourceModel).not.toBe('override');

    // audit.ts: overrideProvenance flags expired against the same instant, from the same canonical string.
    const prov = readRoutingAudit(repo, storedMs + 1).overrides.find((o) => o.key === 'card-xp');
    expect(prov?.expired).toBe(true);
    const provNow = readRoutingAudit(repo, storedMs - 1).overrides.find((o) => o.key === 'card-xp');
    expect(provNow?.expired).toBe(false);
  });
});

describe('setOverride — race-safe rewrite (MED-2)', () => {
  it('a concurrent entry pulled in mid-write survives (no lost update)', async () => {
    // Model the race the way it really happens: a `git pull` brings a concurrently-pushed entry A into
    // the working tree. The coordination loop RE-READS the file after pulling, so re-applying our own
    // add-of-B keeps BOTH entries. The fake runGit writes A onto disk when it sees the `pull`.
    const overridePath = join(repo, 'queue', 'routing-override.yaml');
    const entryA = `version: 1
overrides:
  - scope: agent
    key: agent-A
    runtime: claude
    model: claude-haiku-4-5
    expires: null
    set-by: someone-else
    set-at: 2026-07-17T00:00:00Z
`;
    let pulled = false;
    const calls: string[][] = [];
    const runner: GitRunner = (_r, args) => {
      calls.push(args);
      if (args[0] === 'pull' && !pulled) {
        pulled = true;
        mkdirSync(join(repo, 'queue'), { recursive: true });
        writeFileSync(overridePath, entryA, 'utf-8'); // A "arrives" via the pull
      }
      return '';
    };
    const r = await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'codex-worker', runtime: 'codex', model: 'gpt-5-codex' },
      { runGit: runner, appendAudit: noAudit },
    );
    expect(r.ok).toBe(true);

    const list = overridesOnDisk();
    const keys = list.map((e: any) => e.key).sort();
    expect(keys).toEqual(['agent-A', 'codex-worker']); // BOTH survived
    expect(list.find((e: any) => e.key === 'agent-A').model).toBe('claude-haiku-4-5'); // A untouched
  });
});

describe('setOverride — atomic override+audit commit (MED-3)', () => {
  it('stages the override file AND the audit ledger into ONE commit, one push', async () => {
    const { runner, calls } = recorder();
    const audit = auditSink();
    const r = await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'codex-worker', runtime: 'codex', model: 'gpt-5-codex' },
      { runGit: runner, appendAudit: audit.fn },
    );
    expect(r.ok).toBe(true);
    const commitCalls = calls.filter((c) => c[0] === 'commit');
    expect(commitCalls).toHaveLength(1); // one commit = atomic
    const commitIdx = calls.findIndex((c) => c[0] === 'commit');
    const staged = calls.filter((c, i) => c[0] === 'add' && i < commitIdx).flat();
    expect(staged.join(' ')).toContain('queue/routing-override.yaml');
    expect(staged.join(' ')).toContain('ledgers/audit/dashboard-audit.ndjson');
    expect(calls.filter((c) => c[0] === 'push')).toHaveLength(1);
    expect(audit.rows).toHaveLength(1);
  });

  it('an audit-append failure leaves NOTHING on ops (no push) — never change-without-audit', async () => {
    const { runner, calls } = recorder();
    const throwingAudit: LocalAuditAppend = () => {
      throw new Error('audit sink down');
    };
    const r = await setOverride(
      { repoRoot: repo, sessionToken: token(), sessionConfig: CONFIG },
      { scope: 'agent', key: 'codex-worker', runtime: 'codex', model: 'gpt-5-codex' },
      { runGit: runner, appendAudit: throwingAudit },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(500);
    expect(calls.some((c) => c[0] === 'push')).toBe(false); // nothing reached ops
  });
});

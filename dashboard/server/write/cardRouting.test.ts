import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import type { GitRunner } from './branch.ts';
import type { PyRunner } from './launch.ts';
import type { AppendAuditFn } from '../http/context.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import { parseCardFrontmatter } from '../planeA/cards.ts';
import { loadPolicy, loadOverride } from '../routing/policy.ts';
import { effectiveForCard } from '../routing/effective.ts';
import { setCardRouting, clearCardRouting } from './cardRouting.ts';

const SECRET = Buffer.from('unit-test-secret-do-not-reuse');
const CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };
const token = (): string => mintSession('daniel@webauthn', CONFIG).token;

let repo: string;
beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'card-routing-'));
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

const noAudit: AppendAuditFn = (_r, event) => ({ ts: 'x', ...event }) as AuditRow;

/** A hermetic stand-in for `scripts/cards.py stamp_routing` + `cards.save`: writes the card file with the
 *  stamped runtime/model (a legacy card starts with null routing) and prints the {id,path,state} contract. */
function fakePy(seen: { code: string; op: any }[]): PyRunner {
  return (repoRoot, code, jsonArg) => {
    const op = JSON.parse(jsonArg);
    seen.push({ code, op });
    const state = 'working';
    const dir = join(repoRoot, 'queue', state);
    mkdirSync(dir, { recursive: true });
    const fm = [
      `id: ${op.cardId}`,
      'owner: worker-desktop',
      `state: ${state}`,
      'action: build',
      'target: t',
      'risk-tier: T3',
      'role: work',
      `runtime: ${op.runtime ?? 'null'}`,
      `model: ${op.model ?? 'null'}`,
    ].join('\n');
    writeFileSync(join(dir, `${op.cardId}.md`), `---\n${fm}\n---\n\n## Work order\n\nx\n`, 'utf-8');
    return { exitCode: 0, stdout: `${JSON.stringify({ id: op.cardId, path: `queue/${state}/${op.cardId}.md`, state })}\n`, stderr: '' };
  };
}

describe('setCardRouting — session gate', () => {
  it('rejects a setCardRouting without a WebAuthn session (401); no py, no git', async () => {
    const seen: { code: string; op: any }[] = [];
    const { runner, calls } = recorder();
    const r = await setCardRouting(
      { repoRoot: repo, cardId: 'card-1', sessionToken: undefined, sessionConfig: CONFIG },
      { runtime: 'codex', model: 'gpt-5-codex' },
      { runPy: fakePy(seen), runGit: runner, appendAudit: noAudit },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(401);
    expect(seen).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});

describe('setCardRouting — validation', () => {
  it('rejects a runtime/model not in the policy registry (400); no py call', async () => {
    const seen: { code: string; op: any }[] = [];
    const r = await setCardRouting(
      { repoRoot: repo, cardId: 'card-1', sessionToken: token(), sessionConfig: CONFIG },
      { runtime: 'claude', model: 'claude-ultra-9' },
      { runPy: fakePy(seen), runGit: recorder().runner, appendAudit: noAudit },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(seen).toHaveLength(0);
  });

  it('rejects a glob-metachar / traversal cardId (400)', async () => {
    const r = await setCardRouting(
      { repoRoot: repo, cardId: '../evil', sessionToken: token(), sessionConfig: CONFIG },
      { runtime: 'claude', model: 'claude-opus-4-8' },
      { runPy: fakePy([]), runGit: recorder().runner, appendAudit: noAudit },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe('setCardRouting — governed write via scripts/cards.py + ops commit', () => {
  it('writes card runtime/model via cards.py stamp_routing, then commits through the ops path (never a raw queue write)', async () => {
    const seen: { code: string; op: any }[] = [];
    const { runner, calls } = recorder();
    const r = await setCardRouting(
      { repoRoot: repo, cardId: 'card-1', sessionToken: token(), sessionConfig: CONFIG },
      { runtime: 'codex', model: 'gpt-5-codex' },
      { runPy: fakePy(seen), runGit: runner, appendAudit: noAudit },
    );
    expect(r.ok).toBe(true);

    // The py path imports cards + calls stamp_routing (the schema authority), with the exact op payload.
    expect(seen).toHaveLength(1);
    expect(seen[0].code).toContain('cards.stamp_routing');
    expect(seen[0].op).toMatchObject({ kind: 'set', cardId: 'card-1', runtime: 'codex', model: 'gpt-5-codex' });

    // The changed card is committed through the ops coordination route (pull-rebase-push, staging the card).
    const pullIdx = calls.findIndex((c) => c[0] === 'pull' && c.includes('ops'));
    const addIdx = calls.findIndex((c) => c[0] === 'add' && c.includes('queue/working/card-1.md'));
    const commitIdx = calls.findIndex((c) => c[0] === 'commit');
    expect(pullIdx).toBeGreaterThanOrEqual(0);
    expect(pullIdx).toBeLessThan(commitIdx);
    expect(addIdx).toBeGreaterThanOrEqual(0);
    expect(calls.some((c) => c[0] === 'push' && c.includes('ops'))).toBe(true);
    expect(calls.some((c) => c[0] === 'push' && c.includes('main'))).toBe(false);
  });

  it('a card-field override makes the effective projection report source=card (ties R2.1 to the write)', async () => {
    await setCardRouting(
      { repoRoot: repo, cardId: 'card-1', sessionToken: token(), sessionConfig: CONFIG },
      { runtime: 'codex', model: 'gpt-5-codex' },
      { runPy: fakePy([]), runGit: recorder().runner, appendAudit: noAudit },
    );
    const card = parseCardFrontmatter(readFileSync(join(repo, 'queue', 'working', 'card-1.md'), 'utf-8'));
    const eff = effectiveForCard(card.meta as any, loadPolicy(repo), loadOverride(repo));
    expect([eff.runtime, eff.model, eff.sourceRuntime, eff.sourceModel]).toEqual(['codex', 'gpt-5-codex', 'card', 'card']);
  });

  it('emits exactly one D2.9 audit row', async () => {
    const rows: AuditEvent[] = [];
    const audit: AppendAuditFn = (_r, e) => {
      rows.push(e);
      return { ts: 'x', ...e } as AuditRow;
    };
    await setCardRouting(
      { repoRoot: repo, cardId: 'card-1', sessionToken: token(), sessionConfig: CONFIG },
      { runtime: 'codex', model: 'gpt-5-codex' },
      { runPy: fakePy([]), runGit: recorder().runner, appendAudit: audit },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: 'card-routing', cardId: 'card-1', owner: 'daniel@webauthn' });
  });

  it('clearCardRouting stamps null routing and commits (idempotent-safe)', async () => {
    const seen: { code: string; op: any }[] = [];
    const r = await clearCardRouting(
      { repoRoot: repo, cardId: 'card-1', sessionToken: token(), sessionConfig: CONFIG },
      { runPy: fakePy(seen), runGit: recorder().runner, appendAudit: noAudit },
    );
    expect(r.ok).toBe(true);
    expect(seen[0].op).toMatchObject({ kind: 'clear', runtime: null, model: null });
  });

  it('maps a card-not-found py exit (2) to 400', async () => {
    const notFoundPy: PyRunner = () => ({ exitCode: 2, stdout: '', stderr: 'card not found: card-x' });
    const r = await setCardRouting(
      { repoRoot: repo, cardId: 'card-x', sessionToken: token(), sessionConfig: CONFIG },
      { runtime: 'codex', model: 'gpt-5-codex' },
      { runPy: notFoundPy, runGit: recorder().runner, appendAudit: noAudit },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

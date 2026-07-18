/**
 * D2.6 — governed card launch / rerun-as-depends-on. Every test injects a fake `PreambleRunner` and
 * `PyRunner` (see `launch.ts`'s module docstring for why: `scripts/cards.py` is a MODULE, not a CLI,
 * and no test here ever shells a real `py` binary or touches a real `queue/` tree — fully hermetic).
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import {
  buildRerunBody,
  launchCard,
  rerunAsDependsOn,
  defaultOwnerRouting,
  CARD_OP_SCRIPT,
} from './launch.ts';
import type { LaunchDeps, PyRunResult, PyRunner, SessionInput } from './launch.ts';
import type { PreambleRunner } from './preambleGate.ts';

const SECRET = Buffer.from('launch-test-secret-do-not-reuse');
const SESSION_CONFIG: SessionConfig = { secret: SECRET, now: () => 1_700_000_000_000 };

function okPreamble(): PreambleRunner {
  return () => ({ exitCode: 0, stdout: 'PREAMBLE OK\n', stderr: '' });
}

function frozenPreamble(problem: string): PreambleRunner {
  return () => ({ exitCode: 2, stdout: `PREAMBLE FAIL: ${problem}\n`, stderr: '' });
}

/** Records every invocation so tests can assert exactly what would have been shelled (or wasn't). */
function recordingPyRunner(result: PyRunResult): { runner: PyRunner; calls: Array<{ code: string; jsonArg: string }> } {
  const calls: Array<{ code: string; jsonArg: string }> = [];
  const runner: PyRunner = (_repoRoot, code, jsonArg) => {
    calls.push({ code, jsonArg });
    return result;
  };
  return { runner, calls };
}

function validSession(): SessionInput {
  const { token } = mintSession('operator-1', SESSION_CONFIG);
  return { token, config: SESSION_CONFIG };
}

function baseDeps(overrides: Partial<LaunchDeps> = {}): LaunchDeps {
  return {
    repoRoot: '/repo',
    runPreamble: okPreamble(),
    runPy: recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"new-card-id","path":"queue/inbox/new-card-id.md"}\n',
      stderr: '',
    }).runner,
    ...overrides,
  };
}

describe('launchCard / rerunAsDependsOn — preamble gate (runs first, spawns nothing on failure)', () => {
  it('refuses to launch/rerun when STOP is present — no scripts/cards.py-shelling subprocess is spawned', () => {
    const { runner: runPy, calls } = recordingPyRunner({ exitCode: 0, stdout: '{}', stderr: '' });
    const deps = baseDeps({ runPreamble: frozenPreamble('STOP file present — fleet is frozen'), runPy });

    const launchResult = launchCard(
      { project: 'kb', action: 'demo', target: '.', riskTier: 'T1' },
      validSession(),
      deps,
    );
    expect(launchResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['STOP file present — fleet is frozen'],
    });

    const rerunResult = rerunAsDependsOn('orig-card-id', 'please retry with X', validSession(), deps);
    expect(rerunResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['STOP file present — fleet is frozen'],
    });

    // The load-bearing assertion: STOP-frozen must spawn NOTHING, not even the cards.py module shell.
    expect(calls).toHaveLength(0);
  });

  it('refuses to launch when ANTHROPIC_API_KEY is set or the budget is exceeded — no subprocess spawned', () => {
    const { runner: runPy, calls } = recordingPyRunner({ exitCode: 0, stdout: '{}', stderr: '' });

    const apiKeyDeps = baseDeps({
      runPreamble: frozenPreamble('ANTHROPIC_API_KEY is set — would silently bill to API; unset it'),
      runPy,
    });
    const apiKeyResult = launchCard(
      { project: 'kb', action: 'demo', target: '.', riskTier: 'T1' },
      validSession(),
      apiKeyDeps,
    );
    expect(apiKeyResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['ANTHROPIC_API_KEY is set — would silently bill to API; unset it'],
    });

    const budgetDeps = baseDeps({
      runPreamble: frozenPreamble('daily budget breached: $6.00 >= $5.00'),
      runPy,
    });
    const budgetResult = launchCard(
      { project: 'kb', action: 'demo', target: '.', riskTier: 'T1' },
      validSession(),
      budgetDeps,
    );
    expect(budgetResult).toEqual({
      ok: false,
      reason: 'fleet-frozen',
      problems: ['daily budget breached: $6.00 >= $5.00'],
    });

    expect(calls).toHaveLength(0);
  });
});

describe('launchCard / rerunAsDependsOn — WebAuthn session gate (checked only after the preamble passes)', () => {
  it('rejects launch/rerun without a WebAuthn session', () => {
    const { runner: runPy, calls } = recordingPyRunner({ exitCode: 0, stdout: '{}', stderr: '' });
    const deps = baseDeps({ runPy });
    const noSession: SessionInput = { token: null, config: SESSION_CONFIG };

    const launchResult = launchCard({ project: 'kb', action: 'demo', target: '.', riskTier: 'T1' }, noSession, deps);
    expect(launchResult.ok).toBe(false);
    if (!launchResult.ok) expect(launchResult.reason).toBe('unauthenticated');

    const rerunResult = rerunAsDependsOn('orig-card-id', 'feedback', noSession, deps);
    expect(rerunResult.ok).toBe(false);
    if (!rerunResult.ok) expect(rerunResult.reason).toBe('unauthenticated');

    expect(calls).toHaveLength(0);
  });

  it('rejects an expired/tampered session token the same way as a missing one', () => {
    const deps = baseDeps();
    const expiredConfig: SessionConfig = { secret: SECRET, now: () => 0, ttlMs: 1 };
    const { token } = mintSession('operator-1', expiredConfig);
    const laterSession: SessionInput = { token, config: { secret: SECRET, now: () => 1_000_000 } };

    const result = launchCard({ project: 'kb', action: 'demo', target: '.', riskTier: 'T1' }, laterSession, deps);
    expect(result).toEqual({ ok: false, reason: 'unauthenticated', detail: 'expired' });
  });
});

describe('launchCard — governed dispatch (shells scripts/cards.py; no raw queue/ write)', () => {
  it('shells scripts/cards.py; no raw queue/ write', () => {
    const { runner: runPy, calls } = recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"abc123","path":"queue/inbox/abc123.md"}\n',
      stderr: '',
    });
    const deps = baseDeps({ runPy });

    const result = launchCard(
      { project: 'kb', action: 'demo-thing', target: 'docs/x.md', riskTier: 'T2', body: '## Work order\n\ndo it\n' },
      validSession(),
      deps,
    );

    expect(result).toEqual({ ok: true, cardId: 'abc123', cardPath: 'queue/inbox/abc123.md' });

    // Exactly one subprocess call, and it is the governed CARD_OP_SCRIPT — which imports
    // scripts/cards.py as a module and calls cards.new_card/cards.save — never a direct fs write.
    expect(calls).toHaveLength(1);
    expect(calls[0].code).toBe(CARD_OP_SCRIPT);
    expect(CARD_OP_SCRIPT).toContain('import cards');
    expect(CARD_OP_SCRIPT).toContain('cards.save(card, queue_root)');
    const payload = JSON.parse(calls[0].jsonArg);
    expect(payload).toMatchObject({
      kind: 'new',
      project: 'kb',
      action: 'demo-thing',
      target: 'docs/x.md',
      riskTier: 'T2',
    });
  });

  it('surfaces a card-op failure (non-zero exit) instead of pretending success', () => {
    const { runner: runPy } = recordingPyRunner({ exitCode: 1, stdout: '', stderr: 'ValidationError: bad tier' });
    const deps = baseDeps({ runPy });
    const result = launchCard({ project: 'kb', action: 'x', target: '.', riskTier: 'T1' }, validSession(), deps);
    expect(result).toEqual({ ok: false, reason: 'card-op-failed', detail: 'ValidationError: bad tier' });
  });

  it('starts cards with dependencies blocked while roots remain inbox', () => {
    const { runner: runPy, calls } = recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"child-1","path":"queue/inbox/child-1.md"}\n',
      stderr: '',
    });
    const deps = baseDeps({ runPy });

    launchCard(
      { project: 'kb', action: 'child', target: '.', riskTier: 'T1', dependsOn: ['root-1'] },
      validSession(),
      deps,
    );
    launchCard({ project: 'kb', action: 'root', target: '.', riskTier: 'T1' }, validSession(), deps);

    expect(JSON.parse(calls[0].jsonArg).dependsOn).toEqual(['root-1']);
    expect('dependsOn' in JSON.parse(calls[1].jsonArg)).toBe(false);
    expect(CARD_OP_SCRIPT.match(/card\.meta\["state"\] = "blocked"/g)).toHaveLength(2);
  });

  it('runs the optional coordination prepare seam after gates but before cards.py writes', () => {
    const order: string[] = [];
    const result = launchCard(
      { project: 'kb', action: 'root', target: '.', riskTier: 'T1' },
      validSession(),
      baseDeps({
        runPreamble: () => {
          order.push('preamble');
          return { exitCode: 0, stdout: 'PREAMBLE OK', stderr: '' };
        },
        prepareWrite: () => order.push('pull'),
        runPy: () => {
          order.push('cards.py');
          return { exitCode: 0, stdout: '{"id":"root-1","path":"queue/inbox/root-1.md"}\n', stderr: '' };
        },
      }),
    );
    expect(result.ok).toBe(true);
    expect(order).toEqual(['preamble', 'pull', 'cards.py']);
  });
});

describe('rerunAsDependsOn — rerun files depends-on card w/ feedback in ## Evidence', () => {
  // NAMED-TEST NOTE (flagged deviation — see launch.ts module docstring for the full rationale):
  // the plan text titles this test "...feedback in ## Evidence". governance/card-schema.md — the
  // single normative body-sections list — documents a DEDICATED "## Feedback" section for exactly
  // this (steer text on a requeue/rerun), and reserves "## Evidence" for free text from UNTRUSTED
  // SOURCES. This test keeps the plan's literal title for traceability but asserts against the
  // schema-documented "## Feedback" section, which is what the implementation actually does.
  it('rerun files depends-on card w/ feedback in ## Evidence', () => {
    const { runner: runPy, calls } = recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"rerun-1","path":"queue/inbox/rerun-1.md"}\n',
      stderr: '',
    });
    const deps = baseDeps({ runPy });

    const result = rerunAsDependsOn('orig-card-id', 'try again with the smaller batch size', validSession(), deps);

    expect(result).toEqual({ ok: true, cardId: 'rerun-1', cardPath: 'queue/inbox/rerun-1.md' });
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0].jsonArg);
    expect(payload.kind).toBe('rerun');
    expect(payload.cardId).toBe('orig-card-id');

    // Feedback is inert data: it lands in ## Feedback (per card-schema.md), blockquoted like
    // ## Evidence, and depends-on is expressed via cardId — never parsed as action/target/risk-tier.
    expect(payload.body).toContain('## Feedback');
    expect(payload.body).not.toContain('## Evidence');
    expect(payload.body).toContain('> try again with the smaller batch size');
    expect(CARD_OP_SCRIPT).toContain('cards.claim(card, orig.meta["owner"])');
    expect(CARD_OP_SCRIPT).toContain(
      'cards.stamp_routing(card, orig.meta["runtime"], orig.meta["model"])',
    );
  });

  it('buildRerunBody blockquotes multi-line feedback and preserves blank lines as bare ">"', () => {
    const body = buildRerunBody('orig-1', 'line one\n\nline two');
    expect(body).toContain('## Feedback');
    expect(body).toContain('> line one');
    expect(body).toContain('>\n> line two');
  });
});

describe('launchCard — C7.7 task-owner assignment (closed-set owner + resolver-sourced routing stamp)', () => {
  it('owner in the registered set → card filed, claimed, and runtime/model stamped from effective routing', () => {
    const { runner: runPy, calls } = recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"owned-1","path":"queue/inbox/owned-1.md"}\n',
      stderr: '',
    });
    const deps = baseDeps({
      runPy,
      // The valid-owner set is enumerated server-side from the filesystem; injected hermetically here.
      assignableOwners: () => new Set(['codex-runner']),
      // Routing is RESOLVER-SOURCED (effectiveForAgent), never client input — a codex agent stamps codex.
      ownerRouting: () => ({ runtime: 'codex', model: 'codex-large' }),
    });

    const result = launchCard(
      { project: 'kb', action: 'demo', target: '.', riskTier: 'T2', owner: 'codex-runner' },
      validSession(),
      deps,
    );

    expect(result).toEqual({ ok: true, cardId: 'owned-1', cardPath: 'queue/inbox/owned-1.md' });
    expect(calls).toHaveLength(1);
    // The claim + routing stamp reuse the SAME cards.py primitives the dispatcher uses.
    expect(CARD_OP_SCRIPT).toContain('cards.claim(card, op["owner"])');
    expect(CARD_OP_SCRIPT).toContain('cards.stamp_routing(card, op["runtime"], op["model"])');
    const payload = JSON.parse(calls[0].jsonArg);
    expect(payload).toMatchObject({
      kind: 'new',
      owner: 'codex-runner',
      runtime: 'codex',
      model: 'codex-large',
    });
  });

  it('owner NOT in the registered set → owner-not-registered, and NO card is filed', () => {
    const { runner: runPy, calls } = recordingPyRunner({ exitCode: 0, stdout: '{}', stderr: '' });
    const deps = baseDeps({ runPy, assignableOwners: () => new Set(['codex-runner']) });

    const result = launchCard(
      { project: 'kb', action: 'demo', target: '.', riskTier: 'T1', owner: 'ghost-agent' },
      validSession(),
      deps,
    );

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('owner-not-registered');
    // The boundary refuses BEFORE any subprocess is spawned — no card filed on a bad owner.
    expect(calls).toHaveLength(0);
  });

  it('absent owner → today unowned-card path, byte-for-byte (no owner/runtime/model in the payload, no claim)', () => {
    const { runner: runPy, calls } = recordingPyRunner({
      exitCode: 0,
      stdout: '{"id":"unowned-1","path":"queue/inbox/unowned-1.md"}\n',
      stderr: '',
    });
    // No assignableOwners/ownerRouting injected — the owner branch must not run at all when owner is absent.
    const deps = baseDeps({ runPy });

    const result = launchCard({ project: 'kb', action: 'demo', target: '.', riskTier: 'T1' }, validSession(), deps);

    expect(result).toEqual({ ok: true, cardId: 'unowned-1', cardPath: 'queue/inbox/unowned-1.md' });
    expect(calls).toHaveLength(1);
    const payload = JSON.parse(calls[0].jsonArg);
    expect('owner' in payload).toBe(false);
    expect('runtime' in payload).toBe(false);
    expect('model' in payload).toBe(false);
  });

  it('owner-safety guard rejects separators / traversal / glob metachars → owner-not-registered, no card filed', () => {
    for (const bad of ['a/b', '../evil', 'star*', 'q?', 'br[a]', 'has space']) {
      const { runner: runPy, calls } = recordingPyRunner({ exitCode: 0, stdout: '{}', stderr: '' });
      // Even if the injected set somehow contained the raw string, the safety guard fires FIRST.
      const deps = baseDeps({ runPy, assignableOwners: () => new Set([bad]) });
      const result = launchCard(
        { project: 'kb', action: 'demo', target: '.', riskTier: 'T1', owner: bad },
        validSession(),
        deps,
      );
      expect(result.ok, `owner '${bad}' must be refused`).toBe(false);
      if (!result.ok) expect(result.reason).toBe('owner-not-registered');
      expect(calls, `owner '${bad}' must file no card`).toHaveLength(0);
    }
  });
});

// --------------------------------------------------------------------------- //
// C7.9 — defaultOwnerRouting: an assigned owner is stamped with its DECLARED    //
// runtime/model when no explicit agent-scope override sets that field.          //
// Precedence: agent-scope override > declared agent runtime/model >             //
//             policy role_default > safe default.                               //
// --------------------------------------------------------------------------- //

/** A full policy: claude (3 known) + codex (1 known: gpt-5.6-sol). Mirrors governance/model-routing.yaml. */
const POLICY_YAML = `version: 1
runtimes:
  claude:
    default_worker: worker-desktop
    aliases:
      opus: claude-opus-4-8
      sonnet: claude-sonnet-5
      haiku: claude-haiku-4-5
    known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
  codex:
    default_worker: codex-worker
    aliases:
      codex: gpt-5.6-sol
    known_models: [gpt-5.6-sol]
role_default: { runtime: claude, model: sonnet }
`;

/** Same, but codex has TWO known models so an explicit-declared-model can differ from known_models[0]. */
const POLICY_YAML_MULTI_CODEX = `version: 1
runtimes:
  claude:
    default_worker: worker-desktop
    aliases:
      opus: claude-opus-4-8
      sonnet: claude-sonnet-5
      haiku: claude-haiku-4-5
    known_models: [claude-opus-4-8, claude-sonnet-5, claude-haiku-4-5]
  codex:
    default_worker: codex-worker
    known_models: [gpt-5.6-sol, gpt-5.6-pro]
role_default: { runtime: claude, model: sonnet }
`;

/** Compose an `agents/<id>.md` file body from frontmatter fields. */
function agentFile(fields: Record<string, string>): string {
  const fm = Object.entries(fields)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
  return `---\n${fm}\n---\nDeclared agent.\n`;
}

/** Build a hermetic temp repo with a policy file, optional agents/*.md, and an optional override file. */
function makeRoutingRepo(opts: { policy: string; agents?: Record<string, string>; override?: string }): string {
  const root = mkdtempSync(join(tmpdir(), 'launch-routing-'));
  mkdirSync(join(root, 'governance'), { recursive: true });
  writeFileSync(join(root, 'governance', 'model-routing.yaml'), opts.policy);
  if (opts.agents) {
    mkdirSync(join(root, 'agents'), { recursive: true });
    for (const [name, content] of Object.entries(opts.agents)) {
      writeFileSync(join(root, 'agents', name), content);
    }
  }
  if (opts.override !== undefined) {
    mkdirSync(join(root, 'queue'), { recursive: true });
    writeFileSync(join(root, 'queue', 'routing-override.yaml'), opts.override);
  }
  return root;
}

describe('defaultOwnerRouting — C7.9 declared-agent self-stamp precedence', () => {
  it('codex agent, no override → stamps the declared codex runtime + its default known model (gpt-5.6-sol)', () => {
    const root = makeRoutingRepo({
      policy: POLICY_YAML,
      agents: { 'codex-worker.md': agentFile({ id: 'codex-worker', role: 'work', runtime: 'codex' }) },
    });
    // THE FIX: without this, role_default stamps claude/claude-sonnet-5 and the codex runner refuses the card.
    expect(defaultOwnerRouting('codex-worker', root)).toEqual({ runtime: 'codex', model: 'gpt-5.6-sol' });
  });

  it('claude agent, no override → stamps claude + claude-sonnet-5 (role_default, unchanged)', () => {
    const root = makeRoutingRepo({
      policy: POLICY_YAML,
      agents: { 'worker-desktop.md': agentFile({ id: 'worker-desktop', role: 'work', runtime: 'claude' }) },
    });
    expect(defaultOwnerRouting('worker-desktop', root)).toEqual({ runtime: 'claude', model: 'claude-sonnet-5' });
  });

  it('agent with NO declared runtime, no override → falls to policy role_default (claude/claude-sonnet-5)', () => {
    const root = makeRoutingRepo({
      policy: POLICY_YAML,
      agents: { 'mystery.md': agentFile({ id: 'mystery', role: 'work' }) },
    });
    expect(defaultOwnerRouting('mystery', root)).toEqual({ runtime: 'claude', model: 'claude-sonnet-5' });
  });

  it('agent-scope routing-override wins over the declared runtime/model (unchanged precedence)', () => {
    const override = `version: 1
overrides:
  - scope: agent
    key: codex-worker
    runtime: claude
    model: claude-opus-4-8
`;
    const root = makeRoutingRepo({
      policy: POLICY_YAML,
      agents: { 'codex-worker.md': agentFile({ id: 'codex-worker', role: 'work', runtime: 'codex' }) },
      override,
    });
    expect(defaultOwnerRouting('codex-worker', root)).toEqual({ runtime: 'claude', model: 'claude-opus-4-8' });
  });

  it('declared agent that declares an explicit KNOWN model → that model is honored (not clamped to [0])', () => {
    const root = makeRoutingRepo({
      policy: POLICY_YAML_MULTI_CODEX,
      agents: { 'codex-pro.md': agentFile({ id: 'codex-pro', role: 'work', runtime: 'codex', model: 'gpt-5.6-pro' }) },
    });
    expect(defaultOwnerRouting('codex-pro', root)).toEqual({ runtime: 'codex', model: 'gpt-5.6-pro' });
  });

  it('declared model NOT in the runtime known set → clamped to the runtime default (known_models[0])', () => {
    const root = makeRoutingRepo({
      policy: POLICY_YAML_MULTI_CODEX,
      agents: {
        'codex-bad.md': agentFile({ id: 'codex-bad', role: 'work', runtime: 'codex', model: 'gpt-does-not-exist' }),
      },
    });
    expect(defaultOwnerRouting('codex-bad', root)).toEqual({ runtime: 'codex', model: 'gpt-5.6-sol' });
  });
});

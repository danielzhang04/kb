import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseYaml } from '../routing/yaml.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { CardProjection } from '../planeA/cards.ts';
import {
  listAgents,
  buildRoster,
  readAgentDeclarationProblems,
  readDeclaredAgentDetails,
  readLedgerWriters,
  readRoles,
  roleFor,
  readDeclaredAgents,
  executionAssignmentRole,
  declaredAgentFilePath,
} from './roster.ts';

const POLICY = parseYaml(`version: 1
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
`) as PolicyDoc;

function card(meta: Record<string, unknown>): CardProjection {
  return { meta: meta as CardProjection['meta'], body: '', displayName: String(meta.action ?? 'card'), shortRef: 1 };
}

function indexOf(cards: CardProjection[]): PlaneAIndex {
  const byState: Record<string, CardProjection[]> = {};
  for (const c of cards) (byState[String(c.meta.state)] ??= []).push(c);
  return { cards: byState, ledgers: {} as PlaneAIndex['ledgers'], orgStates: [] };
}

describe('listAgents', () => {
  it('lists each agent with effective runtime+model and source (R2.2)', () => {
    const index = indexOf([
      card({ id: 'a1', owner: 'worker-desktop', state: 'working', action: 'build', project: 'kb' }),
      card({ id: 'a2', owner: 'worker-desktop', state: 'done', action: 'x', project: 'kb' }),
      card({ id: 'b1', owner: 'codex-worker', state: 'inbox', action: 'y', project: 'atlas' }),
    ]);
    const rows = listAgents(index, POLICY, { overrides: [] });
    expect(rows.map((r) => r.id)).toEqual(['worker-desktop', 'codex-worker']); // working-first

    const wd = rows.find((r) => r.id === 'worker-desktop')!;
    expect(wd.working).toBe(true);
    expect(wd.cardCount).toBe(2);
    // No override -> policy role_default (source policy).
    expect([wd.effective.runtime, wd.effective.model, wd.effective.sourceModel]).toEqual([
      'claude',
      'claude-sonnet-5',
      'policy',
    ]);
  });

  it('reflects an agent-scope override in the agent effective (source=override)', () => {
    const override: OverrideDoc = parseYaml(`version: 1
overrides:
  - scope: agent
    key: codex-worker
    runtime: codex
    model: gpt-5-codex
`) as unknown as OverrideDoc;
    const index = indexOf([card({ id: 'b1', owner: 'codex-worker', state: 'inbox', action: 'y', project: 'atlas' })]);
    const row = listAgents(index, POLICY, override)[0];
    expect([row.effective.runtime, row.effective.model, row.effective.sourceRuntime]).toEqual([
      'codex',
      'gpt-5-codex',
      'override',
    ]);
  });

  it('is empty-safe with no cards', () => {
    expect(listAgents(indexOf([]), POLICY, { overrides: [] })).toEqual([]);
  });
});

/** Write a small temp repo with ledgers + routines/roles for the union-roster tests. */
function tempRepo(): string {
  const root = mkdtempSync(join(tmpdir(), 'roster-repo-'));
  mkdirSync(join(root, 'ledgers', 'dispatch'), { recursive: true });
  mkdirSync(join(root, 'ledgers', 'cost'), { recursive: true });
  mkdirSync(join(root, 'routines', 'roles'), { recursive: true });
  // Ledger writer `inspector-desktop` wrote a cost ledger on 2026-07-16 (2 step rows).
  writeFileSync(
    join(root, 'ledgers', 'cost', 'inspector-desktop-2026-07-16.tsv'),
    'model\tstep\tusd\nclaude-opus-4\treview\t0.1\nclaude-opus-4\tgrade\t0.2\n',
  );
  // Ledger writer `worker-desktop` wrote a dispatch ledger (1 row) — also a card owner below.
  writeFileSync(
    join(root, 'ledgers', 'dispatch', 'worker-desktop-2026-07-15.tsv'),
    'cadence\tcard\tdate\tproject\nnightly\taaaa\t2026-07-15\tkb\n',
  );
  writeFileSync(join(root, 'routines', 'roles', 'worker.md'), '# Role: Worker\n');
  writeFileSync(join(root, 'routines', 'roles', 'inspector.md'), '# Role: Inspector\n');
  return root;
}

describe('readLedgerWriters / readRoles / roleFor', () => {
  it('aggregates per-writer ledger activity from filenames + row counts', () => {
    const writers = readLedgerWriters(tempRepo());
    expect(writers.get('inspector-desktop')).toEqual({ dispatches: 0, steps: 2, days: 1, lastActive: '2026-07-16' });
    expect(writers.get('worker-desktop')).toEqual({ dispatches: 1, steps: 0, days: 1, lastActive: '2026-07-15' });
  });

  it('reads the role catalog and matches ids to roles by hyphen-token then substring', () => {
    const roles = readRoles(tempRepo());
    expect(roles).toEqual(['inspector', 'worker']);
    expect(roleFor('worker-desktop', roles)).toBe('worker');
    expect(roleFor('inspector-desktop', roles)).toBe('inspector');
    expect(roleFor('codex-a', roles)).toBeNull();
  });

  it('degrades gracefully when ledgers/ and routines/ are absent', () => {
    const bare = mkdtempSync(join(tmpdir(), 'roster-bare-'));
    expect(readLedgerWriters(bare).size).toBe(0);
    expect(readRoles(bare)).toEqual([]);
  });
});

describe('buildRoster (union of queue owners + ledger writers + roles)', () => {
  it('unions card owners with ledger writers and annotates role + ledger activity', () => {
    const root = tempRepo();
    // Card owner `worker-desktop` (also a ledger writer) + `codex-worker` (queue only).
    const index = indexOf([
      card({ id: 'c1', owner: 'worker-desktop', state: 'working', action: 'build', project: 'kb' }),
      card({ id: 'c2', owner: 'codex-worker', state: 'inbox', action: 'y', project: 'atlas' }),
    ]);
    const roster = buildRoster(index, root, POLICY, { overrides: [] });
    const ids = roster.map((r) => r.id).sort();
    // inspector-desktop appears purely from the ledger; the two card owners appear from the queue.
    expect(ids).toEqual(['codex-worker', 'inspector-desktop', 'worker-desktop']);

    const worker = roster.find((r) => r.id === 'worker-desktop')!;
    expect(worker.working).toBe(true);
    expect(worker.role).toBe('worker');
    expect(worker.sources.sort()).toEqual(['ledger', 'queue']);
    expect(worker.ledger.dispatches).toBe(1);

    const inspector = roster.find((r) => r.id === 'inspector-desktop')!;
    expect(inspector.sources).toEqual(['ledger']);
    expect(inspector.cardCount).toBe(0);
    expect(inspector.role).toBe('inspector');
    expect(inspector.ledger.steps).toBe(2);
    // A ledger-only agent still resolves effective routing (policy role_default).
    expect(inspector.effective.model).toBe('claude-sonnet-5');
  });

  it('is empty-safe: no cards, no ledgers, no roles → empty roster', () => {
    const bare = mkdtempSync(join(tmpdir(), 'roster-empty-'));
    expect(buildRoster(indexOf([]), bare, POLICY, { overrides: [] })).toEqual([]);
  });
});

/** Write a temp repo with an `agents/` dir populated with the given `<name>.md` -> content files. */
function repoWithAgents(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'roster-declared-'));
  mkdirSync(join(root, 'agents'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(root, 'agents', name), content);
  }
  return root;
}

const AGENT_FILE = `---
id: research-worker
role: work
runtime: codex
model: gpt-5.6-sol
runner-bound: false
projects: [kb-ops]
description: Volume worker for kb-ops housekeeping.
---

# Agent: research-worker

Notes — inert prose.
`;

describe('readDeclaredAgents / buildRoster declared source (C7.3)', () => {
  it.each([
    ['manage', 'manager'],
    ['manager', 'manager'],
    ['work', 'worker'],
    ['worker', 'worker'],
    ['inspect', 'worker'],
    ['scout', 'worker'],
    ['consolidate', 'worker'],
    ['human', null],
    [null, null],
  ] as const)('normalizes declared role %s only at the execution eligibility boundary', (declared, expected) => {
    expect(executionAssignmentRole(declared)).toBe(expected);
  });

  it('reads declared agents/*.md frontmatter (id, role, runtime, model, runner-bound, description)', () => {
    const declared = readDeclaredAgents(repoWithAgents({ 'research-worker.md': AGENT_FILE }));
    expect(declared.get('research-worker')).toEqual({
      id: 'research-worker',
      role: 'work',
      runtime: 'codex',
      model: 'gpt-5.6-sol',
      defaultProfile: null,
      allowedProfiles: null,
      runnerBound: false,
      projects: ['kb-ops'],
      description: 'Volume worker for kb-ops housekeeping.',
    });
  });

  it('projects a complete declared execution-profile contract into detail and roster rows', () => {
    const configured = AGENT_FILE.replace(
      'runner-bound: false',
      'default-profile: worker:codex:gpt-5.6-sol\nallowed-profiles: [worker:codex:gpt-5.6-sol, worker:claude:claude-sonnet-5]\nrunner-bound: false',
    );
    const root = repoWithAgents({ 'research-worker.md': configured });
    expect(readDeclaredAgentDetails(root).get('research-worker')).toMatchObject({
      defaultProfile: 'worker:codex:gpt-5.6-sol',
      allowedProfiles: ['worker:codex:gpt-5.6-sol', 'worker:claude:claude-sonnet-5'],
    });
    expect(buildRoster(indexOf([]), root, POLICY, { overrides: [] }).find((entry) => entry.id === 'research-worker'))
      .toMatchObject({
        defaultProfile: 'worker:codex:gpt-5.6-sol',
        allowedProfiles: ['worker:codex:gpt-5.6-sol', 'worker:claude:claude-sonnet-5'],
      });
  });

  it('rejects partial, unsafe, or ambiguous execution-profile contracts as non-authoritative', () => {
    const root = repoWithAgents({
      'only-default.md': '---\nid: only-default\ndefault-profile: worker:codex:gpt-5.6-sol\n---\n',
      'only-allowed.md': '---\nid: only-allowed\nallowed-profiles: [worker:codex:gpt-5.6-sol]\n---\n',
      'unsafe-profile.md': '---\nid: unsafe-profile\ndefault-profile: ../worker\nallowed-profiles: [../worker]\n---\n',
      'duplicate-profile.md': '---\nid: duplicate-profile\ndefault-profile: worker:codex:gpt-5.6-sol\nallowed-profiles: [worker:codex:gpt-5.6-sol, worker:codex:gpt-5.6-sol]\n---\n',
      'default-not-allowed.md': '---\nid: default-not-allowed\ndefault-profile: worker:codex:gpt-5.6-sol\nallowed-profiles: [worker:claude:claude-sonnet-5]\n---\n',
      'scalar-allowed.md': '---\nid: scalar-allowed\ndefault-profile: worker:codex:gpt-5.6-sol\nallowed-profiles: worker:codex:gpt-5.6-sol\n---\n',
    });
    const details = readDeclaredAgentDetails(root);
    const problems = readAgentDeclarationProblems(root);
    for (const id of ['only-default', 'only-allowed', 'unsafe-profile', 'duplicate-profile', 'default-not-allowed', 'scalar-allowed']) {
      expect(details.has(id)).toBe(false);
      expect(problems.get(id)?.problem).toBe('invalid-profile-config');
    }
    expect(buildRoster(indexOf([]), root, POLICY, { overrides: [] })).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'only-default', declared: false, declarationProblem: 'invalid-profile-config' }),
    ]));
  });

  it('reads runner-bound: true as runnerBound true', () => {
    const bound = AGENT_FILE.replace('runner-bound: false', 'runner-bound: true');
    expect(readDeclaredAgents(repoWithAgents({ 'research-worker.md': bound })).get('research-worker')?.runnerBound).toBe(true);
  });

  it('a declared-only agent (no cards, no ledgers) surfaces with role/runtime from its file and runnerBound false', () => {
    const root = repoWithAgents({ 'research-worker.md': AGENT_FILE });
    const entry = buildRoster(indexOf([]), root, POLICY, { overrides: [] }).find((r) => r.id === 'research-worker');
    expect(entry).toBeDefined();
    expect(entry!.declared).toBe(true);
    expect(entry!.runnerBound).toBe(false);
    expect(entry!.role).toBe('work');
    expect(entry!.declaredRuntime).toBe('codex');
    expect(entry!.declaredModel).toBe('gpt-5.6-sol');
    expect(entry!.description).toBe('Volume worker for kb-ops housekeeping.');
    expect(entry!.projects).toEqual(['kb-ops']);
    expect(entry!.cardCount).toBe(0);
    expect(entry!.sources).toEqual([]); // neither a card owner nor a ledger writer
  });

  it('a declared id that also owns cards merges into ONE entry (declared ∧ queue)', () => {
    const root = repoWithAgents({ 'research-worker.md': AGENT_FILE });
    const index = indexOf([card({ id: 'c1', owner: 'research-worker', state: 'working', action: 'build', project: 'kb' })]);
    const matches = buildRoster(index, root, POLICY, { overrides: [] }).filter((r) => r.id === 'research-worker');
    expect(matches).toHaveLength(1);
    expect(matches[0].declared).toBe(true);
    expect(matches[0].working).toBe(true);
    expect(matches[0].cardCount).toBe(1);
    expect(matches[0].sources).toEqual(['queue']);
    expect(matches[0].role).toBe('work'); // declared role annotates the merged entry
  });

  it('a missing agents/ dir yields no declared agents and does not crash buildRoster', () => {
    const bare = mkdtempSync(join(tmpdir(), 'roster-noagents-'));
    expect(readDeclaredAgents(bare).size).toBe(0);
    expect(buildRoster(indexOf([]), bare, POLICY, { overrides: [] })).toEqual([]);
  });

  it('a malformed agent file is not treated as declared but is surfaced as a bounded roster diagnostic', () => {
    const root = repoWithAgents({
      'research-worker.md': AGENT_FILE,
      'broken.md': 'no frontmatter here at all\njust prose\n',
    });
    const declared = readDeclaredAgents(root);
    expect(declared.has('research-worker')).toBe(true);
    expect(declared.has('broken')).toBe(false);
    const roster = buildRoster(indexOf([]), root, POLICY, { overrides: [] });
    expect(roster.map((r) => r.id)).toContain('research-worker');
    expect(roster).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'broken', declared: false, declarationProblem: 'malformed-frontmatter' }),
    ]));
  });

  it('a non-declared agent (queue/ledger only) has declared false and runnerBound false', () => {
    const root = repoWithAgents({ 'research-worker.md': AGENT_FILE });
    const index = indexOf([card({ id: 'c1', owner: 'worker-desktop', state: 'inbox', action: 'x', project: 'kb' })]);
    const entry = buildRoster(index, root, POLICY, { overrides: [] }).find((r) => r.id === 'worker-desktop');
    expect(entry!.declared).toBe(false);
    expect(entry!.runnerBound).toBe(false);
    expect(entry!.declaredRuntime).toBeNull();
  });

  // INFO (Finding 3): the READ path must not follow symlinks nor read unbounded files.
  it('caps the read: an oversized agents/*.md (>64 KiB) is skipped, not read', () => {
    const huge = `---\nid: huge\n---\n${'x'.repeat(70 * 1024)}\n`;
    const root = repoWithAgents({ 'research-worker.md': AGENT_FILE, 'huge.md': huge });
    const declared = readDeclaredAgents(root);
    expect(declared.has('research-worker')).toBe(true);
    expect(declared.has('huge')).toBe(false); // over the 64 KiB cap → skipped
  });

  it('does not follow a symlinked agents/*.md entry (skips it)', () => {
    const root = repoWithAgents({ 'research-worker.md': AGENT_FILE });
    // Plant a target OUTSIDE agents/ and link agents/link.md at it. If the platform forbids file
    // symlinks (Windows without privilege), skip the assertion — the cap test still covers the read guard.
    const outsideDir = mkdtempSync(join(tmpdir(), 'roster-symtarget-'));
    const target = join(outsideDir, 'evil.md');
    writeFileSync(target, '---\nid: sneaky\n---\nlinked\n');
    let linked = false;
    try {
      symlinkSync(target, join(root, 'agents', 'link.md'), 'file');
      linked = true;
    } catch {
      /* no symlink privilege on this platform → skip */
    }
    if (!linked) return;
    const declared = readDeclaredAgents(root);
    expect(declared.has('research-worker')).toBe(true);
    expect(declared.has('sneaky')).toBe(false); // symlink content not followed
    expect(declared.has('link')).toBe(false); // link stem not registered either
  });

  it('rejects a symlinked agents directory before it can read external declarations', () => {
    const root = mkdtempSync(join(tmpdir(), 'roster-agent-dir-'));
    const outside = mkdtempSync(join(tmpdir(), 'roster-agent-dir-outside-'));
    writeFileSync(join(outside, 'escape.md'), '---\nid: escape\n---\nEXTERNAL INSTRUCTIONS\n');
    try {
      symlinkSync(outside, join(root, 'agents'), 'junction');
    } catch {
      return; // Junction creation is privilege-gated on some Windows hosts.
    }
    expect(readDeclaredAgentDetails(root).size).toBe(0);
    expect(readDeclaredAgents(root).size).toBe(0);
    expect(JSON.stringify(readAgentDeclarationProblems(root))).not.toContain('EXTERNAL INSTRUCTIONS');
  });

  it('rejects unsafe, mismatched, and duplicate claimed ids without allowing any ambiguous declaration', () => {
    const root = repoWithAgents({
      'unsafe.md': '---\nid: ../escape\n---\nunsafe\n',
      'mismatch.md': '---\nid: different\n---\nmismatch\n',
      'first.md': '---\nid: shared\n---\nfirst\n',
      'second.md': '---\nid: shared\n---\nsecond\n',
    });
    const details = readDeclaredAgentDetails(root);
    expect(details.has('unsafe')).toBe(false);
    expect(details.has('different')).toBe(false);
    expect(details.has('shared')).toBe(false);
    const problems = readAgentDeclarationProblems(root);
    expect(problems.get('unsafe')?.problem).toBe('unsafe-id');
    expect(problems.get('mismatch')?.problem).toBe('id-mismatch');
    expect(problems.get('first')?.problem).toBe('duplicate-id');
    expect(problems.get('second')?.problem).toBe('duplicate-id');
  });
});

/**
 * The exact-match allowlist behind the dashboard's "Run agent" action. Anything that turns an operator
 * string into a spawn path goes through here, so the refusals are the security boundary, not a nicety.
 */
describe('declaredAgentFilePath — the Run-agent allowlist', () => {
  it('resolves a declared agent to its own file inside the served repo', () => {
    const root = repoWithAgents({ 'research-worker.md': AGENT_FILE });
    const resolved = declaredAgentFilePath(root, 'research-worker');
    expect(resolved).not.toBeNull();
    expect(realpathSync(resolved as string)).toBe(realpathSync(join(root, 'agents', 'research-worker.md')));
  });

  it('refuses every id that is not exactly a declared agent', () => {
    const root = repoWithAgents({ 'research-worker.md': AGENT_FILE });
    for (const id of [
      'ghost',                       // simply not declared
      'Research-Worker',             // case is not a match; ids are lower-case by contract
      '../../etc/passwd',            // traversal
      'research-worker.md',          // the filename, not the id
      'research-worker\u0000',       // NUL smuggling
      '',                            // empty
      'research worker',             // whitespace
    ]) {
      expect(declaredAgentFilePath(root, id)).toBeNull();
    }
    // Non-strings never reach a path join either.
    expect(declaredAgentFilePath(root, undefined)).toBeNull();
    expect(declaredAgentFilePath(root, 42)).toBeNull();
    expect(declaredAgentFilePath(root, { id: 'research-worker' })).toBeNull();
  });

  it('refuses an id whose declaration was rejected by the scanner, and a repo with no agents dir', () => {
    const rejected = repoWithAgents({ 'mismatch.md': '---\nid: different\n---\nmismatch\n' });
    expect(declaredAgentFilePath(rejected, 'mismatch')).toBeNull();
    expect(declaredAgentFilePath(rejected, 'different')).toBeNull();

    const bare = mkdtempSync(join(tmpdir(), 'roster-noagents-path-'));
    expect(declaredAgentFilePath(bare, 'research-worker')).toBeNull();
  });
});

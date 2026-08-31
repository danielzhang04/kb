import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { parseYaml } from '../routing/yaml.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';
import { loadPolicy, loadOverride } from '../routing/policy.ts';
import { effectiveForAgent, SAFE_DEFAULT } from '../routing/effective.ts';
import type { AgentDeclarationRouting } from '../routing/effective.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';
import type { CardProjection } from '../planeA/cards.ts';
import { NamingRegistry } from '../naming.ts';
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
    # gpt-5.6-sol is registered because the declaration fixtures below declare it (as the real
    # agents/*.md do); an unregistered model is covered by its own degradation test.
    known_models: [gpt-5-codex, gpt-5.6-sol]
policy:
  manage:
    "*": { runtime: claude, model: opus }
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

  it('resolves a card owner against its own declaration, not the safe default', () => {
    const index = indexOf([card({ id: 'c1', owner: 'fyt-runner', state: 'working', action: 'run', project: 'fyt' })]);
    const declarations = new Map([['fyt-runner', { role: 'manage', runtime: 'codex', model: 'gpt-5.6-sol' }]]);
    const row = listAgents(index, POLICY, { overrides: [] }, declarations)[0];
    expect([row.effective.runtime, row.effective.model, row.effective.sourceModel]).toEqual([
      'codex',
      'gpt-5.6-sol',
      'card',
    ]);
  });

  it("uses the DECLARED ROLE for the policy row when the declaration names no model (manage -> opus)", () => {
    const index = indexOf([card({ id: 'c1', owner: 'roleonly', state: 'inbox', action: 'x', project: 'fyt' })]);
    const declarations = new Map([['roleonly', { role: 'manage', runtime: null, model: null }]]);
    const row = listAgents(index, POLICY, { overrides: [] }, declarations)[0];
    expect([row.effective.model, row.effective.sourceModel]).toEqual(['claude-opus-4-8', 'policy']);
  });

  it('a declaration naming a model its runtime does not know degrades to its ROLE row, never crashes', () => {
    const index = indexOf([card({ id: 'c1', owner: 'bad-decl', state: 'inbox', action: 'x', project: 'fyt' })]);
    // claude does not know gpt-5.6-sol -> the unusable runtime/model pair is dropped, the role is kept.
    const declarations = new Map([['bad-decl', { role: 'manage', runtime: 'claude', model: 'gpt-5.6-sol' }]]);
    const row = listAgents(index, POLICY, { overrides: [] }, declarations)[0];
    expect([row.effective.model, row.effective.sourceModel]).toEqual(['claude-opus-4-8', 'policy']);
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

const COMPLEX_AGENT_FILE = `---
id: complex-agent
role: work
runtime: codex
model: gpt-5.6-sol
default-profile: worker:codex:gpt-5.6-sol
allowed-profiles: [worker:codex:gpt-5.6-sol]
projects: [kb-ops]
runner-bound: false
tools: [Read, Grep]
knowledge-source: [docs/]
autonomy-tier: T2
skills: [dispatch-codex]
what-it-replaces: null
builds-on: [fyt-checker]
description: A fixture-only complex agent.
---

# Agent: complex-agent
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
      group: null,
      runtime: 'codex',
      model: 'gpt-5.6-sol',
      tools: null,
      knowledgeSource: null,
      connectors: null,
      filesystemRoots: null,
      autonomyTier: null,
      skills: null,
      whatItReplaces: null,
      buildsOn: null,
      defaultProfile: null,
      allowedProfiles: null,
      runnerBound: false,
      projects: ['kb-ops'],
      description: 'Volume worker for kb-ops housekeeping.',
      version: 1,
    });
  });

  it('parses new advisory fields losslessly and preserves list order', () => {
    const root = repoWithAgents({ 'complex-agent.md': COMPLEX_AGENT_FILE });
    const detail = readDeclaredAgentDetails(root).get('complex-agent')!;
    expect(detail).toMatchObject({
      tools: ['Read', 'Grep'],
      knowledgeSource: ['docs/'],
      autonomyTier: 'T2',
      skills: ['dispatch-codex'],
      whatItReplaces: null,
      buildsOn: ['fyt-checker'],
    });
    expect(readDeclaredAgents(root).get('complex-agent')).toMatchObject({
      tools: ['Read', 'Grep'],
      knowledgeSource: ['docs/'],
      autonomyTier: 'T2',
      skills: ['dispatch-codex'],
      whatItReplaces: null,
      buildsOn: ['fyt-checker'],
    });
    expect(buildRoster(indexOf([]), root, POLICY, { overrides: [] }, new NamingRegistry(join(root, 'naming.json')))
      .find((entry) => entry.id === 'complex-agent'))
      .toMatchObject({
        tools: ['Read', 'Grep'],
        knowledgeSource: ['docs/'],
        autonomyTier: 'T2',
        skills: ['dispatch-codex'],
        whatItReplaces: null,
        buildsOn: ['fyt-checker'],
      });
  });

  it('parses version with the same legacy default as Python', () => {
    const versioned = `---
id: versioned-agent
version: 3
---
# Versioned
`;
    const root = repoWithAgents({ 'versioned-agent.md': versioned, 'legacy-agent.md': AGENT_FILE.replaceAll('research-worker', 'legacy-agent') });
    const detail = readDeclaredAgentDetails(root).get('versioned-agent')!;
    expect(detail).toMatchObject({ version: 3 });
    expect(readDeclaredAgentDetails(root).get('legacy-agent')).toMatchObject({ version: 1 });
    const quoted = repoWithAgents({ 'quoted-agent.md': versioned.replace('id: versioned-agent\nversion: 3', 'id: quoted-agent\nversion: "3"') });
    expect(readDeclaredAgentDetails(quoted).get('quoted-agent')).toMatchObject({ version: 1 });
  });

  it.each([
    ['3', 3],
    ['"3"', 1],
    ['"true"', 1],
    ['true', 1],
    ['null', 1],
    [null, 1],
  ])('matches Python scalar semantics for version: %s', (scalar, version) => {
    // Shared scalar fixture list: expected values are PyYAML +
    // scripts/agent_definitions.py, which is the declaration authority.
    const scalarLines = scalar === null ? '' : `version: ${scalar}\n`;
    const root = repoWithAgents({ 'scalar-agent.md': `---\nid: scalar-agent\n${scalarLines}---\n` });
    expect(readDeclaredAgentDetails(root).get('scalar-agent')).toMatchObject({ version });
  });

  it('authoring a new list field with YAML block-list syntax throws in the frontmatter parser and drops the whole declaration (documented trap: only inline [a, b] list syntax parses)', () => {
    const blockListed = COMPLEX_AGENT_FILE.replace('tools: [Read, Grep]', 'tools:\n- Read');
    const root = repoWithAgents({ 'complex-agent.md': blockListed });
    expect(readDeclaredAgents(root).has('complex-agent')).toBe(false);
    expect(readAgentDeclarationProblems(root).get('complex-agent')).toMatchObject({ problem: 'malformed-frontmatter' });
    const roster = buildRoster(indexOf([]), root, POLICY, { overrides: [] });
    expect(roster).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'complex-agent', declared: false, declarationProblem: 'malformed-frontmatter' }),
    ]));
  });

  it('keeps legacy declarations listable with null advisory fields', () => {
    const root = repoWithAgents({ 'research-worker.md': AGENT_FILE });
    expect(readDeclaredAgentDetails(root).get('research-worker')).toMatchObject({
      tools: null,
      knowledgeSource: null,
      autonomyTier: null,
      skills: null,
      whatItReplaces: null,
      buildsOn: null,
    });
    const entry = buildRoster(indexOf([]), root, POLICY, { overrides: [] }).find((agent) => agent.id === 'research-worker')!;
    expect(entry).toMatchObject({
      declared: true,
      declarationProblem: null,
      tools: null,
      knowledgeSource: null,
      autonomyTier: null,
      skills: null,
      whatItReplaces: null,
      buildsOn: null,
    });
  });

  it('degrades malformed advisory values without rejecting the declaration', () => {
    const malformed = AGENT_FILE.replace('runner-bound: false', 'runner-bound: false\ntools: 42\nautonomy-tier:');
    const root = repoWithAgents({ 'research-worker.md': malformed });
    expect(readDeclaredAgentDetails(root).get('research-worker')).toMatchObject({ tools: null, autonomyTier: null });
    expect(buildRoster(indexOf([]), root, POLICY, { overrides: [] }).find((agent) => agent.id === 'research-worker'))
      .toMatchObject({ declared: true, declarationProblem: null, tools: null, autonomyTier: null });
    expect(readAgentDeclarationProblems(root).has('research-worker')).toBe(false);
  });

  it('reads every real agent declaration alongside the complex fixture without loss', () => {
    const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
    const files = Object.fromEntries(
      readdirSync(join(repoRoot, 'agents'))
        .filter((name) => name.endsWith('.md'))
        .map((name) => {
          const source = readFileSync(join(repoRoot, 'agents', name), 'utf8');
          const end = source.indexOf('\n---', 4);
          return [name, end === -1 ? source : `${source.slice(0, end + 5)}\n`];
        }),
    );
    files['complex-agent.md'] = COMPLEX_AGENT_FILE;
    const root = repoWithAgents(files);
    // +1 for the injected complex-agent fixture alongside every real agents/*.md declaration.
    const expectedCount = readdirSync(join(repoRoot, 'agents')).filter((name) => name.endsWith('.md')).length + 1;
    expect(readDeclaredAgentDetails(root)).toHaveLength(expectedCount);
    expect(readAgentDeclarationProblems(root)).toHaveLength(0);
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

  it("a declared-only agent's roster DTO carries its DECLARED model as the effective one", () => {
    const root = repoWithAgents({ 'research-worker.md': AGENT_FILE });
    const entry = buildRoster(indexOf([]), root, POLICY, { overrides: [] }).find((r) => r.id === 'research-worker')!;
    // Declared codex/gpt-5.6-sol — NOT the safe default the resolver used to hand every agent.
    expect([entry.effective.runtime, entry.effective.model, entry.effective.sourceModel]).toEqual([
      'codex',
      'gpt-5.6-sol',
      'card',
    ]);
    expect(entry.effective.model).toBe(entry.declaredModel);
  });

  it('a declared agent that ALSO owns cards gets the same declared model on its merged entry', () => {
    const root = repoWithAgents({ 'research-worker.md': AGENT_FILE });
    const index = indexOf([card({ id: 'c1', owner: 'research-worker', state: 'working', action: 'b', project: 'kb' })]);
    const entry = buildRoster(index, root, POLICY, { overrides: [] }).find((r) => r.id === 'research-worker')!;
    expect([entry.effective.runtime, entry.effective.model]).toEqual(['codex', 'gpt-5.6-sol']);
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

/**
 * LIVE ACCEPTANCE — the real `governance/model-routing.yaml` and the real `agents/*.md`, not fixtures.
 * The defect this pins: every one of these agents used to resolve the safe default (claude-sonnet-5)
 * because the agent resolver discarded both the declaration and the declared role.
 */
describe('live acceptance — real governance/model-routing.yaml + agents/*.md', () => {
  // dashboard/server/agents/roster.test.ts -> ../../../ is the repo root (same rule as resolveRepoRoot).
  const LIVE_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
  const LIVE_POLICY = loadPolicy(LIVE_ROOT);
  const LIVE_OVERRIDE = loadOverride(LIVE_ROOT);
  const LIVE_DECLARED = readDeclaredAgents(LIVE_ROOT);
  const live = (id: string, declaration: AgentDeclarationRouting | null = LIVE_DECLARED.get(id) ?? null) =>
    effectiveForAgent(id, LIVE_POLICY, LIVE_OVERRIDE, declaration);

  it('the live policy is the one being asserted against (sanity)', () => {
    expect(LIVE_POLICY.runtimes?.codex?.known_models).toContain('gpt-5.6-sol');
    expect(LIVE_POLICY.role_default).toMatchObject({ runtime: 'claude', model: 'sonnet' });
  });

  it('fyt-runner (role manage, declares gpt-5.6-sol) resolves gpt-5.6-sol — NOT the safe default', () => {
    expect(LIVE_DECLARED.get('fyt-runner')).toMatchObject({ role: 'manage', runtime: 'codex', model: 'gpt-5.6-sol' });
    const r = live('fyt-runner');
    expect([r.runtime, r.model, r.sourceRuntime, r.sourceModel]).toEqual(['codex', 'gpt-5.6-sol', 'card', 'card']);
    expect(r.model).not.toBe(SAFE_DEFAULT[1]);
  });

  it('every declared fyt agent resolves its OWN declared model', () => {
    const declared = [...LIVE_DECLARED.values()].filter((d) => d.model !== null);
    expect(declared.length).toBeGreaterThan(0);
    for (const d of declared) {
      expect([d.id, live(d.id).model]).toEqual([d.id, d.model]);
    }
  });

  it('an fyt WORK agent with no declared model takes the yaml work row: role_default claude-sonnet-5', () => {
    // `policy.work` in the live yaml is tier-keyed (T1/T2 sonnet, T3 opus) with no "*" cell, and an agent
    // carries no risk tier — so the resolver finds no work cell and reports `role_default`, whose model
    // alias `sonnet` resolves to claude-sonnet-5. Same value as work/T1-T2, honestly sourced from policy.
    const r = live('fyt-story', { role: 'work', runtime: null, model: null });
    expect([r.runtime, r.model, r.sourceRuntime, r.sourceModel]).toEqual([
      'claude',
      'claude-sonnet-5',
      'policy',
      'policy',
    ]);
  });

  it('an agent with a "*" role row takes that row (inspect -> claude-opus-5)', () => {
    const r = live('fyt-checker', { role: 'inspect', runtime: null, model: null });
    expect([r.runtime, r.model, r.sourceModel]).toEqual(['claude', 'claude-opus-5', 'policy']);
  });

  it('neither declaration nor role match: role_default under the live yaml, SAFE_DEFAULT with no yaml', () => {
    const undeclared = live('no-such-agent', null);
    expect([undeclared.runtime, undeclared.model, undeclared.sourceModel]).toEqual([
      'claude',
      'claude-sonnet-5',
      'policy',
    ]);
    // SAFE_DEFAULT is reached only when the policy file itself is unreadable — rung 4, source `default`.
    const noPolicy = effectiveForAgent('no-such-agent', {}, { overrides: [] }, null);
    expect([noPolicy.runtime, noPolicy.model, noPolicy.sourceRuntime, noPolicy.sourceModel]).toEqual([
      ...SAFE_DEFAULT,
      'default',
      'default',
    ]);
  });

  it('the roster DTO the Agents table + workflow defaults read carries the corrected model', () => {
    const roster = buildRoster(indexOf([]), LIVE_ROOT, LIVE_POLICY, LIVE_OVERRIDE);
    const runner = roster.find((r) => r.id === 'fyt-runner')!;
    expect(runner.declared).toBe(true);
    expect(runner.effective.model).toBe('gpt-5.6-sol');
    expect(runner.effective.model).toBe(runner.declaredModel);
    // Not a single declared agent is left on the safe default any more.
    const declaredRows = roster.filter((r) => r.declared && r.declaredModel !== null);
    expect(declaredRows.length).toBeGreaterThan(0);
    expect(declaredRows.map((r) => [r.id, r.effective.model])).toEqual(
      declaredRows.map((r) => [r.id, r.declaredModel]),
    );
  });
});

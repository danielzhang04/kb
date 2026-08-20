/**
 * `lib/agentPresentation` (U12) — the two roster-reading rules every agent surface shares.
 *
 * Both were established by review and then written down twice (the effective-model rule in the Agent
 * Management panel and again inline in the fleet graph; the role vocabulary in a panel-local table).
 * A second copy of a rule about what a FIELD MEANS is a second chance to get it wrong somewhere nobody
 * is looking, so the rules are pinned here once, for every consumer.
 */
import { describe, expect, it } from 'vitest';
import { effectiveModelOf, normalizeRole, FLEET_ROLES } from './agentPresentation';
import type { AgentRosterEntry } from '../../server/agents/roster';

describe('effectiveModelOf', () => {
  it('accepts a REAL roster entry — the structural parameter cannot drift off the wire shape', () => {
    // A compile-time assertion first: if `AgentRosterEntry.effective` ever changes shape, this line
    // reds rather than the helper quietly accepting a row it can no longer read.
    const roster: Pick<AgentRosterEntry, 'effective'> = {
      effective: { runtime: 'claude', model: 'claude-opus-5', sourceRuntime: 'policy', sourceModel: 'policy' },
    } as Pick<AgentRosterEntry, 'effective'>;
    expect(effectiveModelOf(roster)).toBe('claude-opus-5');
  });

  it('returns the RESOLVED model', () => {
    expect(effectiveModelOf({ effective: { model: 'claude-opus-5' } })).toBe('claude-opus-5');
  });

  it('never re-surfaces a declared model the resolver refused', () => {
    // The server drops an unusable declaration/runtime pair ON PURPOSE and answers with the policy
    // model. A fallback to `declaredModel` would print a model the fleet will never run under a label
    // claiming it is what the agent runs on — a wrong answer that looks better than the right one.
    const refused = { effective: { model: 'claude-haiku-4-5' }, declaredModel: 'gpt-5-mega' };
    expect(effectiveModelOf(refused)).toBe('claude-haiku-4-5');
  });

  it('answers null rather than guessing when nothing resolved', () => {
    expect(effectiveModelOf({ effective: { model: null } })).toBeNull();
    expect(effectiveModelOf({ effective: null })).toBeNull();
    expect(effectiveModelOf({})).toBeNull();
    expect(effectiveModelOf(null)).toBeNull();
    expect(effectiveModelOf(undefined)).toBeNull();
    // A roster row with only a DECLARED model and no resolution still answers null — the declaration
    // is not evidence of what will run.
    const declaredOnly = { effective: null, declaredModel: 'claude-opus-5' };
    expect(effectiveModelOf(declaredOnly)).toBeNull();
  });
});

describe('normalizeRole', () => {
  it('folds BOTH live vocabularies onto the same canonical role', () => {
    // Declared agents carry frontmatter roles; undeclared ones get a routines/roles FILENAME. Half the
    // fleet would render "unknown" beside a chip reading "worker" if only one vocabulary were handled.
    expect(normalizeRole('manager')).toBe(normalizeRole('manage'));
    expect(normalizeRole('worker')).toBe(normalizeRole('work'));
    expect(normalizeRole('inspector')).toBe(normalizeRole('inspect'));
    expect(normalizeRole('consolidator')).toBe(normalizeRole('consolidate'));
    expect(normalizeRole('scout')).toBe('scout');
  });

  it('is case- and whitespace-insensitive, because neither vocabulary promises a normal form', () => {
    expect(normalizeRole('  WORKER ')).toBe('work');
    expect(normalizeRole('Inspect')).toBe('inspect');
  });

  it('returns null for an unrecognised role rather than inventing a canonical one', () => {
    for (const value of ['', '   ', 'archivist', null, undefined]) {
      expect(normalizeRole(value), String(value)).toBeNull();
    }
  });

  it('lands every canonical role on itself — the table is closed over FLEET_ROLES', () => {
    for (const role of FLEET_ROLES) expect(normalizeRole(role)).toBe(role);
  });
});

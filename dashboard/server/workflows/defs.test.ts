import { describe, expect, it } from 'vitest';
import { parseWorkflowDef } from './defs.ts';

const KNOWN = new Set(['research', 'gmail-triage', 'drive-author', 'producer']);

function md(frontmatter: string, body = 'The full work order lives in the body.'): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

const SINGLE = [
  'id: research-brief',
  'project: kb-ops',
  'title: Research brief',
  'profile: research',
  'stages:',
  '  - id: brief',
  '    title: Research a topic',
  '    action: research:web-brief',
  '    target: orgs/kb-ops/output',
  '    riskTier: T2',
].join('\n');

describe('parseWorkflowDef', () => {
  it('parses a valid single-stage definition and uses the body as the stage work order', () => {
    const result = parseWorkflowDef(md(SINGLE), { knownProfiles: KNOWN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.id).toBe('research-brief');
    expect(result.value.profile).toBe('research');
    expect(result.value.stages).toHaveLength(1);
    expect(result.value.stages[0].workOrder).toContain('work order lives in the body');
    expect(result.value.stages[0].riskTier).toBe('T2');
  });

  it('raises a declared tier below the classified floor back up to the floor (prose can never lower)', () => {
    const fm = SINGLE.replace('riskTier: T2', 'riskTier: T1');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // research:* classifies to a T2 floor; a declared T1 cannot lower it.
    expect(result.value.stages[0].classifiedFloor).toBe('T2');
    expect(result.value.stages[0].declaredRiskTier).toBe('T1');
    expect(result.value.stages[0].riskTier).toBe('T2');
  });

  it('honors a stricter declared tier above the floor', () => {
    const fm = SINGLE.replace('riskTier: T2', 'riskTier: T3');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stages[0].riskTier).toBe('T3');
  });

  it('defaults a missing tier to the classified floor', () => {
    const fm = SINGLE.split('\n').filter((line) => !line.includes('riskTier')).join('\n');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stages[0].declaredRiskTier).toBeNull();
    expect(result.value.stages[0].riskTier).toBe('T2');
  });

  it('rejects a forbidden action namespace', () => {
    const fm = SINGLE.replace('action: research:web-brief', 'action: credential:read');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/refused/);
  });

  it('rejects an action namespace not in the server-owned registry', () => {
    const fm = SINGLE.replace('action: research:web-brief', 'action: frobnicate:everything');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown profile when the allowed set is supplied', () => {
    const fm = SINGLE.replace('profile: research', 'profile: super-powers');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/profile/);
  });

  it('rejects duplicate stage ids', () => {
    const fm = [
      'id: dup', 'project: kb-ops', 'title: Dup', 'profile: research', 'stages:',
      '  - id: a', '    title: A', '    action: research:x', '    target: orgs/kb-ops/output', '    workOrder: Do A',
      '  - id: a', '    title: A2', '    action: research:y', '    target: orgs/kb-ops/output', '    workOrder: Do A2',
    ].join('\n');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/duplicate stage id/);
  });

  it('rejects a dependency cycle', () => {
    const fm = [
      'id: cyc', 'project: kb-ops', 'title: Cycle', 'profile: research', 'stages:',
      '  - id: a', '    title: A', '    action: research:x', '    target: orgs/kb-ops/output', '    workOrder: A', '    dependsOn: [b]',
      '  - id: b', '    title: B', '    action: research:y', '    target: orgs/kb-ops/output', '    workOrder: B', '    dependsOn: [a]',
    ].join('\n');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/cycle/);
  });

  it('accepts a valid two-stage DAG with dependencies', () => {
    const fm = [
      'id: chain', 'project: kb-ops', 'title: Chain', 'profile: research', 'stages:',
      '  - id: a', '    title: A', '    action: research:x', '    target: orgs/kb-ops/output', '    workOrder: A',
      '  - id: b', '    title: B', '    action: report:y', '    target: orgs/kb-ops/output', '    workOrder: B', '    dependsOn: [a]',
    ].join('\n');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.stages[1].dependsOn).toEqual(['a']);
  });

  it('rejects an unknown frontmatter field', () => {
    const fm = `${SINGLE}\nschedule: nightly`;
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.detail).toMatch(/unknown field/);
  });

  it('rejects a file with no frontmatter', () => {
    const result = parseWorkflowDef('# just a heading\n', { knownProfiles: KNOWN });
    expect(result.ok).toBe(false);
  });

  it('rejects an unsafe target path', () => {
    const fm = SINGLE.replace('target: orgs/kb-ops/output', 'target: ../../etc/passwd');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(false);
  });

  describe('readScope declaration (Layer A)', () => {
    const withReadScope = (lines: string[]): string =>
      SINGLE.replace('stages:', ['readScope:', ...lines, 'stages:'].join('\n'));

    it('defaults readScope to an empty list when the frontmatter omits it (byte-identical to today)', () => {
      const result = parseWorkflowDef(md(SINGLE), { knownProfiles: KNOWN });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.readScope).toEqual([]);
    });

    it('accepts every SHAREABLE_READ_ROOTS entry and the def\'s own org tree', () => {
      const result = parseWorkflowDef(md(withReadScope([
        '  - queue', '  - dashboards', '  - ledgers', '  - _index.md',
        '  - governance', '  - CLAUDE.md', '  - AGENTS.md', '  - GEMINI.md',
        '  - orgs/kb-ops/_index.md',
      ])), { knownProfiles: KNOWN });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.readScope).toContain('queue');
      expect(result.value.readScope).toContain('orgs/kb-ops/_index.md');
      expect(result.value.readScope).toContain('governance');
    });

    it('accepts a descendant of a shareable dir root (queue/inbox)', () => {
      const result = parseWorkflowDef(md(withReadScope(['  - queue/inbox'])), { knownProfiles: KNOWN });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.readScope).toEqual(['queue/inbox']);
    });

    it.each([
      ['traversal', '  - ../../etc/passwd'],
      ['backslash', '  - queue\\evil'],
      ['drive letter', '  - C:/Windows'],
      ['trailing slash', '  - queue/'],
      ['double slash', '  - queue//inbox'],
      ['whole-repo dot', '  - .'],
      ['dotdot segment', '  - orgs/kb-ops/../secrets'],
    ])('rejects an unsafe readScope entry (%s)', (_label, line) => {
      const result = parseWorkflowDef(md(withReadScope([line])), { knownProfiles: KNOWN });
      expect(result.ok).toBe(false);
    });

    it.each([
      ['control-plane source', '  - dashboard'],
      ['control-plane subtree', '  - dashboard/server/control'],
      ['private agent memory', '  - memory'],
      ['scripts', '  - scripts'],
      ['another org', '  - orgs/faceless-youtube'],
    ])('refuses a non-allowlisted read root (%s)', (_label, line) => {
      const result = parseWorkflowDef(md(withReadScope([line])), { knownProfiles: KNOWN });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.detail).toMatch(/not a declarable read root/);
    });

    it('rejects a duplicate readScope path', () => {
      const result = parseWorkflowDef(md(withReadScope(['  - queue', '  - queue'])), { knownProfiles: KNOWN });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.detail).toMatch(/duplicate/);
    });

    it('rejects more than 64 readScope entries', () => {
      const many = Array.from({ length: 65 }, (_v, i) => `  - queue/item-${i}`);
      const result = parseWorkflowDef(md(withReadScope(many)), { knownProfiles: KNOWN });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.detail).toMatch(/at most 64/);
    });
  });
});

import { describe, expect, it } from 'vitest';
import { instantiateWorkflowDef, parseWorkflowDef } from './defs.ts';

const KNOWN = new Set(['research', 'gmail-triage', 'drive-author', 'producer', 'checker-readonly']);

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
    expect(result.value).not.toHaveProperty('manager');
    expect(result.value.stages).toHaveLength(1);
    expect(result.value.stages[0]).not.toHaveProperty('agentId');
    expect(result.value.stages[0]).not.toHaveProperty('profileId');
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

  it('parses complete optional manager and stage agent-profile assignments without resolving them', () => {
    const fm = SINGLE.replace('profile: research', [
      'profile: research',
      'manager:',
      '  agentId: fyt-runner',
      '  profileId: manager:claude:claude-opus-4-8',
    ].join('\n')).replace('    riskTier: T2', [
      '    riskTier: T2',
      '    agentId: fyt-preproduction',
      '    profileId: worker:codex:gpt-5.6-sol',
    ].join('\n'));
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.manager).toEqual({
      agentId: 'fyt-runner', profileId: 'manager:claude:claude-opus-4-8',
    });
    expect(result.value.stages[0]).toMatchObject({
      agentId: 'fyt-preproduction', profileId: 'worker:codex:gpt-5.6-sol',
    });
  });

  describe('compile-neutral governance metadata', () => {
    it('parses workflow and stage governors as declaration-independent safe ids', () => {
      const fm = SINGLE
        .replace('profile: research', 'profile: research\ngovernedBy: not-yet-declared')
        .replace('    riskTier: T2', '    riskTier: T2\n    governedBy: stage-owner');
      const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
      expect(result).toMatchObject({
        ok: true,
        value: {
          governedBy: 'not-yet-declared',
          stages: [{ governedBy: 'stage-owner' }],
        },
      });
    });

    it.each([
      ['workflow traversal', 'governedBy: ../runner', ''],
      ['workflow uppercase', 'governedBy: FYT-Runner', ''],
      ['workflow empty', 'governedBy: ""', ''],
      ['stage traversal', '', '    governedBy: ../worker'],
      ['stage uppercase', '', '    governedBy: FYT-Worker'],
      ['stage scalar', '', '    governedBy: 7'],
    ])('rejects unsafe governance ids (%s)', (_label, workflowLine, stageLine) => {
      const fm = SINGLE
        .replace('profile: research', `profile: research${workflowLine ? `\n${workflowLine}` : ''}`)
        .replace('    riskTier: T2', `    riskTier: T2${stageLine ? `\n${stageLine}` : ''}`);
      expect(parseWorkflowDef(md(fm), { knownProfiles: KNOWN })).toMatchObject({
        ok: false,
        detail: expect.stringMatching(/governedBy/),
      });
    });

    it('keeps workflow and stage governance closed against nested execution-shaped data', () => {
      const workflowMapping = SINGLE.replace(
        'profile: research',
        'profile: research\ngovernedBy:\n  agentId: fyt-runner',
      );
      const stageMapping = SINGLE.replace(
        '    riskTier: T2',
        '    riskTier: T2\n    governedBy:\n      agentId: fyt-preproduction',
      );
      expect(parseWorkflowDef(md(workflowMapping), { knownProfiles: KNOWN })).toMatchObject({
        ok: false,
        detail: expect.stringMatching(/governedBy/),
      });
      expect(parseWorkflowDef(md(stageMapping), { knownProfiles: KNOWN })).toMatchObject({
        ok: false,
        detail: expect.stringMatching(/governedBy/),
      });
    });
  });

  it('parses a closed assigned review checker with readonly override and completion gate', () => {
    const fm = [
      'id: checker', 'project: kb-ops', 'title: Checker', 'profile: research', 'stages:',
      '  - id: create', '    title: Create', '    action: implement:thing', '    target: orgs/kb-ops/output', '    workOrder: Create',
      '  - id: check', '    title: Check', '    action: review:thing', '    target: orgs/kb-ops/output', '    workOrder: Check', '    dependsOn: [create]',
      '    agentId: fyt-checker', '    profileId: worker:claude:claude-sonnet-5', '    workflowProfile: checker-readonly',
      '    review:', '      subjectStageId: create', '      maxCreatorReworks: 1', '      criteria:',
      '        - id: safety', '          description: No unsafe changes',
      '    completionGate:', '      id: reviewer-approval', '      kind: approval', '      prompt: Approve checker result?', '      requiresReview: pass',
      '  - id: next', '    title: Next creator', '    action: implement:next', '    target: orgs/kb-ops/output', '    workOrder: Continue', '    dependsOn: [check]',
    ].join('\n');
    const result = parseWorkflowDef(md(fm), { knownProfiles: KNOWN });
    expect(result).toMatchObject({ ok: true, value: { stages: [
      {}, { workflowProfile: 'checker-readonly', review: { subjectStageId: 'create', maxCreatorReworks: 1 }, completionGate: { kind: 'approval', requiresReview: 'pass' } }, {},
    ] } });
  });

  it('refuses unknown checker fields, non-direct review subjects, and review without an assigned review action', () => {
    const base = [
      'id: checker', 'project: kb-ops', 'title: Checker', 'profile: research', 'stages:',
      '  - id: create', '    title: Create', '    action: implement:thing', '    target: orgs/kb-ops/output', '    workOrder: Create',
      '  - id: check', '    title: Check', '    action: review:thing', '    target: orgs/kb-ops/output', '    workOrder: Check', '    dependsOn: [create]',
      '    agentId: fyt-checker', '    profileId: worker:claude:claude-sonnet-5', '    workflowProfile: checker-readonly', '    review:', '      subjectStageId: missing', '      maxCreatorReworks: 1',
      '      criteria:', '        - id: safety', '          description: Safe',
    ].join('\n');
    expect(parseWorkflowDef(md(base), { knownProfiles: KNOWN })).toMatchObject({ ok: false, detail: expect.stringMatching(/direct dependsOn/) });
    expect(parseWorkflowDef(md(base.replace('      maxCreatorReworks: 1', '      maxCreatorReworks: 3')), { knownProfiles: KNOWN })).toMatchObject({ ok: false });
    expect(parseWorkflowDef(md(base.replace('    action: review:thing', '    action: implement:check')), { knownProfiles: KNOWN })).toMatchObject({ ok: false, detail: expect.stringMatching(/review requires/) });
    expect(parseWorkflowDef(md(base.replace('    review:', '    unexpected: nope\n    review:')), { knownProfiles: KNOWN })).toMatchObject({ ok: false, detail: expect.stringMatching(/unknown field/) });
  });

  it('requires every review stage to use the checker-readonly workflow profile', () => {
    const valid = [
      'id: checker', 'project: kb-ops', 'title: Checker', 'profile: research', 'stages:',
      '  - id: create', '    title: Create', '    action: implement:thing', '    target: orgs/kb-ops/output', '    workOrder: Create',
      '  - id: check', '    title: Check', '    action: review:thing', '    target: orgs/kb-ops/output', '    workOrder: Check', '    dependsOn: [create]',
      '    agentId: fyt-checker', '    profileId: worker:claude:claude-sonnet-5', '    workflowProfile: checker-readonly', '    review:', '      subjectStageId: create', '      maxCreatorReworks: 1',
      '      criteria:', '        - id: safety', '          description: Safe',
    ].join('\n');
    for (const invalid of [
      valid.replace('    workflowProfile: checker-readonly\n', ''),
      valid.replace('workflowProfile: checker-readonly', 'workflowProfile: producer'),
      valid.replace('workflowProfile: checker-readonly', 'workflowProfile: research'),
    ]) {
      expect(parseWorkflowDef(md(invalid), { knownProfiles: KNOWN })).toMatchObject({
        ok: false,
        detail: expect.stringMatching(/workflowProfile 'checker-readonly'/),
      });
    }
  });

  it('requires review graph edges to be one-to-one and never review another review stage', () => {
    const valid = [
      'id: checker-chain', 'project: kb-ops', 'title: Checker chain', 'profile: research', 'stages:',
      '  - id: create', '    title: Create', '    action: implement:thing', '    target: orgs/kb-ops/output', '    workOrder: Create',
      '  - id: check', '    title: Check', '    action: review:thing', '    target: orgs/kb-ops/output', '    workOrder: Check', '    dependsOn: [create]',
      '    agentId: fyt-checker', '    profileId: worker:claude:claude-sonnet-5', '    workflowProfile: checker-readonly', '    review:', '      subjectStageId: create', '      maxCreatorReworks: 1',
      '      criteria:', '        - id: safety', '          description: Safe',
      '  - id: next', '    title: Next', '    action: implement:next', '    target: orgs/kb-ops/output', '    workOrder: Continue', '    dependsOn: [check]',
    ].join('\n');
    expect(parseWorkflowDef(md(valid), { knownProfiles: KNOWN })).toMatchObject({ ok: true });
    expect(parseWorkflowDef(md(valid.replace('dependsOn: [create]', 'dependsOn: [create, next]')), { knownProfiles: KNOWN }))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/depend only on its subject/) });
    const duplicate = `${valid}\n  - id: check-again\n    title: Check again\n    action: review:thing\n    target: orgs/kb-ops/output\n    workOrder: Check again\n    dependsOn: [create]\n    agentId: fyt-checker\n    profileId: worker:claude:claude-sonnet-5\n    workflowProfile: checker-readonly\n    review:\n      subjectStageId: create\n      maxCreatorReworks: 1\n      criteria:\n        - id: safety\n          description: Safe`;
    expect(parseWorkflowDef(md(duplicate), { knownProfiles: KNOWN }))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/multiple review stages/) });
    const nested = `${valid}\n  - id: check-again\n    title: Check again\n    action: review:thing\n    target: orgs/kb-ops/output\n    workOrder: Check again\n    dependsOn: [check]\n    agentId: fyt-checker\n    profileId: worker:claude:claude-sonnet-5\n    workflowProfile: checker-readonly\n    review:\n      subjectStageId: check\n      maxCreatorReworks: 1\n      criteria:\n        - id: safety\n          description: Safe`;
    expect(parseWorkflowDef(md(nested), { knownProfiles: KNOWN }))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/cannot review review stage/) });
  });

  it('rejects unknown manager fields and a non-object manager', () => {
    const unknown = SINGLE.replace('profile: research', [
      'profile: research', 'manager:', '  agentId: fyt-runner',
      '  profileId: manager:claude:claude-opus-4-8', '  runnerBound: true',
    ].join('\n'));
    const unknownResult = parseWorkflowDef(md(unknown), { knownProfiles: KNOWN });
    expect(unknownResult).toMatchObject({ ok: false, detail: expect.stringMatching(/manager.*unknown field/) });
    const scalar = SINGLE.replace('profile: research', 'profile: research\nmanager: fyt-runner');
    const scalarResult = parseWorkflowDef(md(scalar), { knownProfiles: KNOWN });
    expect(scalarResult).toMatchObject({ ok: false, detail: expect.stringMatching(/manager must be a mapping/) });
  });

  it('rejects unsafe manager/stage ids and one-sided agent-profile assignments', () => {
    const unsafeManager = SINGLE.replace('profile: research', [
      'profile: research', 'manager:', '  agentId: ../fyt-runner', '  profileId: manager:claude:claude-opus-4-8',
    ].join('\n'));
    expect(parseWorkflowDef(md(unsafeManager), { knownProfiles: KNOWN }))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/manager\.agentId/) });
    const oneSidedManager = SINGLE.replace('profile: research', 'profile: research\nmanager:\n  agentId: fyt-runner');
    expect(parseWorkflowDef(md(oneSidedManager), { knownProfiles: KNOWN }))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/manager\.profileId/) });
    const oneSidedStage = SINGLE.replace('    riskTier: T2', '    riskTier: T2\n    agentId: fyt-preproduction');
    expect(parseWorkflowDef(md(oneSidedStage), { knownProfiles: KNOWN }))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/agentId and profileId/) });
    const unsafeStage = SINGLE.replace('    riskTier: T2', [
      '    riskTier: T2', '    agentId: fyt-preproduction', '    profileId: ../worker',
    ].join('\n'));
    expect(parseWorkflowDef(md(unsafeStage), { knownProfiles: KNOWN }))
      .toMatchObject({ ok: false, detail: expect.stringMatching(/profileId/) });
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

  it('enforces declared launch parameters and substitutes only their exact tokens', () => {
    const source = SINGLE.replace('profile: research', 'profile: research\nparameters: [channel, slug]')
      .replace('riskTier: T2', 'riskTier: T2\n    workOrder: Write <channel>/<slug> and preserve <shot-id>.');
    const parsed = parseWorkflowDef(md(source), { knownProfiles: KNOWN });
    if (!parsed.ok) throw new Error(parsed.detail);
    for (const parameters of [{ channel: 'a' }, { channel: 'a', slug: 'b', extra: 'x' }, { channel: 1, slug: 'b' }] as Array<Record<string, unknown>>) {
      expect(instantiateWorkflowDef(parsed.value, parameters as Record<string, string>).ok).toBe(false);
    }
    for (const slug of ['.', 'bad.', 'CON.txt', 'LPT1.log']) expect(instantiateWorkflowDef(parsed.value, { channel: 'the-second-take', slug }).ok).toBe(false);
    const valid = instantiateWorkflowDef(parsed.value, { channel: 'the-second-take', slug: '2026.07-19.wells-fargo' });
    expect(valid).toMatchObject({ ok: true, value: { stages: [{ target: 'orgs/kb-ops/output', workOrder: expect.stringContaining('<shot-id>') }] } });
    const unused = parseWorkflowDef(md(source.replace('[channel, slug]', '[channel, unused]')), { knownProfiles: KNOWN });
    if (!unused.ok) throw new Error(unused.detail);
    expect(instantiateWorkflowDef(unused.value, { channel: 'a', unused: 'b' })).toMatchObject({ ok: false, detail: expect.stringMatching(/not used/) });
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

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

  it('makes validation-slice an explicit non-publication workflow class', () => {
    const valid = parseWorkflowDef(md(SINGLE.replace('profile: research', 'executionMode: validation-slice\nprofile: research')), { knownProfiles: KNOWN });
    expect(valid).toMatchObject({ ok: true });
    if (valid.ok) expect(valid.value.executionMode).toBe('validation-slice');

    const publish = SINGLE.replace('profile: research', 'executionMode: validation-slice\nprofile: research')
      .replace('action: research:web-brief', 'action: publish:private-upload')
      .replace('riskTier: T2', 'riskTier: T3');
    expect(parseWorkflowDef(md(publish), { knownProfiles: KNOWN })).toMatchObject({
      ok: false,
      detail: expect.stringMatching(/validation-slice workflow must not declare publish or T3/),
    });
  });

  it('permits declared parameters in a target but refuses an undeclared scope segment', () => {
    const scoped = SINGLE
      .replace('profile: research', 'profile: research\nparameters: [channel]')
      .replace('target: orgs/kb-ops/output', 'target: orgs/kb-ops/output/<channel>');
    const parsed = parseWorkflowDef(md(scoped), { knownProfiles: KNOWN });
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) {
      const launched = instantiateWorkflowDef(parsed.value, { channel: 'the-second-take' });
      expect(launched).toMatchObject({ ok: true });
      if (launched.ok) expect(launched.value.stages[0].target).toBe('orgs/kb-ops/output/the-second-take');
    }

    const unknown = scoped.replace('<channel>', '<other>');
    expect(parseWorkflowDef(md(unknown), { knownProfiles: KNOWN })).toMatchObject({
      ok: false,
      detail: "stage 'brief' target uses undeclared parameter '<other>'",
    });
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

  describe('declared human gates', () => {
    const gated = (...lines: string[]) => SINGLE.replace('    riskTier: T2', ['    riskTier: T2', ...lines].join('\n'));

    it('parses a closed gate list and omits the key entirely when a stage declares none', () => {
      const result = parseWorkflowDef(md(gated(
        '    humanGates:',
        '      - id: g0-idea-pick',
        '        kind: approval',
        '        prompt: Pick and edit the idea brief.',
        '      - id: g0-note',
        '        kind: input',
        '        prompt: Anything the writer should know?',
      )), { knownProfiles: KNOWN });
      expect(result).toMatchObject({ ok: true, value: { stages: [{ humanGates: [
        { id: 'g0-idea-pick', kind: 'approval', prompt: 'Pick and edit the idea brief.' },
        { id: 'g0-note', kind: 'input', prompt: 'Anything the writer should know?' },
      ] }] } });
      if (!result.ok) return;
      // Absent (not `[]`) so an ungated definition compiles and hashes byte-identically to before.
      const ungated = parseWorkflowDef(md(SINGLE), { knownProfiles: KNOWN });
      expect(ungated.ok && ungated.value.stages[0]).not.toHaveProperty('humanGates');
    });

    it('rejects a malformed gate: unknown field, bad kind, empty prompt, or empty list', () => {
      const cases: Array<[string[], RegExp]> = [
        [['    humanGates:', '      - id: g0', '        kind: approval', '        prompt: Pick.', '        escalate: true'], /unknown field 'escalate'/],
        [['    humanGates:', '      - id: g0', '        kind: governance-refusal', '        prompt: Pick.'], /kind must be approval, input, or review/],
        [['    humanGates:', '      - id: g0', '        kind: intervention', '        prompt: Pick.'], /kind must be approval, input, or review/],
        [['    humanGates:', '      - id: g0', '        kind: approval', '        prompt: ""'], /prompt must be a non-empty string/],
        [['    humanGates:', '      - id: ../g0', '        kind: approval', '        prompt: Pick.'], /id must be a safe identifier/],
        [['    humanGates: []'], /must contain 1-16 gates/],
        [['    humanGates: g0'], /must be a list of gate mappings/],
      ];
      for (const [lines, detail] of cases) {
        expect(parseWorkflowDef(md(gated(...lines)), { knownProfiles: KNOWN })).toMatchObject({ ok: false, detail: expect.stringMatching(detail) });
      }
    });

    it('admits spendAuthorization ONLY on an approval gate', () => {
      expect(parseWorkflowDef(md(gated(
        '    humanGates:', '      - id: g2-visual-plan', '        kind: approval',
        '        prompt: Approve the visual plan.', '        spendAuthorization: true',
      )), { knownProfiles: KNOWN })).toMatchObject({ ok: true, value: { stages: [{ humanGates: [
        { id: 'g2-visual-plan', kind: 'approval', spendAuthorization: true },
      ] }] } });
      // An `input` gate resolves on a 'responded' decision, which is not an approval; a `review` gate
      // is a verdict on someone else's work. Neither may ever read as authorizing money.
      for (const kind of ['input', 'review']) {
        expect(parseWorkflowDef(md(gated(
          '    humanGates:', '      - id: g2-visual-plan', `        kind: ${kind}`,
          '        prompt: Approve the visual plan.', '        spendAuthorization: true',
        )), { knownProfiles: KNOWN })).toMatchObject({ ok: false, detail: expect.stringMatching(/spendAuthorization requires kind 'approval'/) });
      }
      expect(parseWorkflowDef(md(gated(
        '    humanGates:', '      - id: g2', '        kind: approval',
        '        prompt: Approve.', '        spendAuthorization: yes-please',
      )), { knownProfiles: KNOWN })).toMatchObject({ ok: false, detail: expect.stringMatching(/spendAuthorization must be a boolean/) });
    });

    it('admits publicationAuthorization ONLY on an approval gate', () => {
      expect(parseWorkflowDef(md(gated(
        '    humanGates:', '      - id: g4-publish-private', '        kind: approval',
        '        prompt: Approve the private upload.', '        publicationAuthorization: true',
      )), { knownProfiles: KNOWN })).toMatchObject({ ok: true, value: { stages: [{ humanGates: [
        { id: 'g4-publish-private', kind: 'approval', publicationAuthorization: true },
      ] }] } });
      // An input/review response is not an approval, so neither may ever read as authorizing a T3
      // publication — the same rule the spend flag carries.
      for (const kind of ['input', 'review']) {
        expect(parseWorkflowDef(md(gated(
          '    humanGates:', '      - id: g4-publish-private', `        kind: ${kind}`,
          '        prompt: Approve the private upload.', '        publicationAuthorization: true',
        )), { knownProfiles: KNOWN })).toMatchObject({
          ok: false, detail: expect.stringMatching(/publicationAuthorization requires kind 'approval'/),
        });
      }
      expect(parseWorkflowDef(md(gated(
        '    humanGates:', '      - id: g4', '        kind: approval',
        '        prompt: Approve.', '        publicationAuthorization: sure',
      )), { knownProfiles: KNOWN })).toMatchObject({
        ok: false, detail: expect.stringMatching(/publicationAuthorization must be a boolean/),
      });
      // The gate mapping stays closed: an unknown neighbour is still refused.
      expect(parseWorkflowDef(md(gated(
        '    humanGates:', '      - id: g4', '        kind: approval',
        '        prompt: Approve.', '        publishAuthorisation: true',
      )), { knownProfiles: KNOWN })).toMatchObject({ ok: false, detail: expect.stringMatching(/unknown field/) });
    });

    it('requires gate ids to be unique across the whole workflow, not merely per stage', () => {
      const twoStages = [
        'id: gated', 'project: kb-ops', 'title: Gated', 'profile: research', 'stages:',
        '  - id: first', '    title: First', '    action: implement:thing', '    target: orgs/kb-ops/output', '    workOrder: First',
        '    humanGates:', '      - id: g1', '        kind: approval', '        prompt: Approve first.',
        '  - id: second', '    title: Second', '    action: implement:next', '    target: orgs/kb-ops/output', '    workOrder: Second', '    dependsOn: [first]',
        '    humanGates:', '      - id: GATE_ID', '        kind: approval', '        prompt: Approve second.',
      ].join('\n');
      expect(parseWorkflowDef(md(twoStages.replace('GATE_ID', 'g2')), { knownProfiles: KNOWN })).toMatchObject({ ok: true });
      // Two stages sharing a gate id would make "g1 is approved" ambiguous about which stage it
      // released — and an ambiguous spend gate is exactly the bypass this forbids.
      expect(parseWorkflowDef(md(twoStages.replace('GATE_ID', 'g1')), { knownProfiles: KNOWN }))
        .toMatchObject({ ok: false, detail: expect.stringMatching(/duplicate human gate id 'g1'/) });
      // Within one stage, too.
      const sameStage = twoStages.replace(
        '      - id: GATE_ID', '      - id: g1',
      );
      expect(parseWorkflowDef(md(sameStage), { knownProfiles: KNOWN })).toMatchObject({ ok: false });
    });

    it('counts a completionGate id in the same one gate-id namespace', () => {
      // A completionGate is answered in the same Inbox under the same title shape, so a collision with a
      // humanGates id makes "ship-it is approved" ambiguous exactly as two humanGates would.
      const fm = (completionGateId: string) => [
        'id: checker', 'project: kb-ops', 'title: Checker', 'profile: research', 'stages:',
        '  - id: create', '    title: Create', '    action: implement:thing', '    target: orgs/kb-ops/output', '    workOrder: Create',
        '    humanGates:', '      - id: ship-it', '        kind: approval', '        prompt: Approve.',
        '  - id: check', '    title: Check', '    action: review:thing', '    target: orgs/kb-ops/output', '    workOrder: Check', '    dependsOn: [create]',
        '    agentId: fyt-checker', '    profileId: worker:claude:claude-sonnet-5', '    workflowProfile: checker-readonly',
        '    review:', '      subjectStageId: create', '      maxCreatorReworks: 1',
        '      criteria:', '        - id: safety', '          description: Safe',
        '    completionGate:', `      id: ${completionGateId}`, '      kind: approval',
        '      prompt: Approve the reviewed result.', '      requiresReview: pass',
      ].join('\n');
      expect(parseWorkflowDef(md(fm('accept-result')), { knownProfiles: KNOWN })).toMatchObject({ ok: true });
      expect(parseWorkflowDef(md(fm('ship-it')), { knownProfiles: KNOWN }))
        .toMatchObject({ ok: false, detail: expect.stringMatching(/duplicate human gate id 'ship-it'/) });
    });
  });

  describe('declared artifacts', () => {
    const withArtifacts = (...lines: string[]) => SINGLE.replace('    riskTier: T2', ['    riskTier: T2', ...lines].join('\n'));

    it('parses a closed artifact list and omits the key entirely when a stage declares none', () => {
      const result = parseWorkflowDef(md(withArtifacts(
        '    artifacts:',
        '      - id: brief',
        '        path: orgs/kb-ops/output/brief.md',
        '        description: The written brief.',
        '      - id: sources',
        '        path: orgs/kb-ops/output/sources.json',
        '        description: Every source cited.',
      )), { knownProfiles: KNOWN });
      expect(result).toMatchObject({ ok: true, value: { stages: [{ artifacts: [
        { id: 'brief', path: 'orgs/kb-ops/output/brief.md', description: 'The written brief.' },
        { id: 'sources', path: 'orgs/kb-ops/output/sources.json', description: 'Every source cited.' },
      ] }] } });
      // Absent (not `[]`), so a definition without artifacts hashes and compiles byte-identically.
      const none = parseWorkflowDef(md(SINGLE), { knownProfiles: KNOWN });
      expect(none.ok && none.value.stages[0]).not.toHaveProperty('artifacts');
    });

    it('rejects a malformed artifact: unknown field, unsafe path, duplicate, or empty list', () => {
      const cases: Array<[string[], RegExp]> = [
        [['    artifacts:', '      - id: brief', '        path: orgs/kb-ops/output/brief.md', '        description: Brief.', '        optional: true'], /unknown field 'optional'/],
        [['    artifacts:', '      - id: brief', '        path: ../../etc/passwd', '        description: Brief.'], /canonical safe repo-relative path/],
        [['    artifacts:', '      - id: brief', '        path: orgs/kb-ops/output/../../../secrets', '        description: Brief.'], /canonical safe repo-relative path/],
        [['    artifacts:', '      - id: ../brief', '        path: orgs/kb-ops/output/brief.md', '        description: Brief.'], /id must be a safe identifier/],
        [['    artifacts:', '      - id: brief', '        path: orgs/kb-ops/output/brief.md', '        description: ""'], /description must be a non-empty string/],
        [['    artifacts: []'], /must contain 1-32 artifacts/],
        [['    artifacts: brief.md'], /must be a list of artifact mappings/],
        [[
          '    artifacts:',
          '      - id: brief', '        path: orgs/kb-ops/output/brief.md', '        description: Brief.',
          '      - id: brief', '        path: orgs/kb-ops/output/other.md', '        description: Other.',
        ], /duplicate artifact id 'brief'/],
        [[
          '    artifacts:',
          '      - id: brief', '        path: orgs/kb-ops/output/brief.md', '        description: Brief.',
          '      - id: again', '        path: orgs/kb-ops/output/brief.md', '        description: Same file.',
        ], /duplicate artifact path/],
      ];
      for (const [lines, detail] of cases) {
        expect(parseWorkflowDef(md(withArtifacts(...lines)), { knownProfiles: KNOWN }))
          .toMatchObject({ ok: false, detail: expect.stringMatching(detail) });
      }
    });

    it("refuses an artifact outside the stage's own target tree", () => {
      // compile.ts derives the stage's write scope FROM its target, so a stage promising a file elsewhere
      // is promising something it has no authority to write.
      expect(parseWorkflowDef(md(withArtifacts(
        '    artifacts:', '      - id: elsewhere', '        path: orgs/kb-ops/other/brief.md', '        description: Brief.',
      )), { knownProfiles: KNOWN })).toMatchObject({
        ok: false, detail: expect.stringMatching(/must sit inside this stage's own target tree/),
      });
      expect(parseWorkflowDef(md(withArtifacts(
        '    artifacts:', '      - id: policy', '        path: dashboard/server/control/policy.ts', '        description: Nope.',
      )), { knownProfiles: KNOWN })).toMatchObject({ ok: false, detail: expect.stringMatching(/target tree/) });
    });

    it('substitutes launch parameters inside artifact paths, and refuses undeclared placeholders', () => {
      const parameterised = SINGLE
        .replace('profile: research', 'profile: research\nparameters: [channel, slug]')
        .replace('    riskTier: T2', [
          '    riskTier: T2',
          '    workOrder: Write the brief for <channel>/<slug>.',
          '    artifacts:',
          '      - id: brief',
          '        path: orgs/kb-ops/output/<channel>/<slug>/brief.md',
          '        description: The brief for this run.',
        ].join('\n'));
      const parsed = parseWorkflowDef(md(parameterised), { knownProfiles: KNOWN });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      // The PARSED path keeps its placeholders; only a launch substitutes them.
      expect(parsed.value.stages[0].artifacts?.[0].path).toBe('orgs/kb-ops/output/<channel>/<slug>/brief.md');
      const instantiated = instantiateWorkflowDef(parsed.value, { channel: 'the-second-take', slug: 'st-042' });
      expect(instantiated).toMatchObject({ ok: true, value: { stages: [{ artifacts: [
        { id: 'brief', path: 'orgs/kb-ops/output/the-second-take/st-042/brief.md' },
      ] }] } });
      // An undeclared placeholder would survive substitution as a literal `<name>` — a path no file can
      // ever have, so every run would park. Refused at parse, where the message can name it.
      const undeclared = parameterised.replace('<slug>/brief.md', '<episode>/brief.md');
      expect(parseWorkflowDef(md(undeclared), { knownProfiles: KNOWN }))
        .toMatchObject({ ok: false, detail: expect.stringMatching(/undeclared parameter '<episode>'/) });
    });

    it('counts an artifact path as USE of a launch parameter', () => {
      // `slice` scopes only an output path here; that is still a use, so the launch must not be refused.
      const pathOnly = SINGLE
        .replace('profile: research', 'profile: research\nparameters: [slice]')
        .replace('    riskTier: T2', [
          '    riskTier: T2',
          '    artifacts:',
          '      - id: brief',
          '        path: orgs/kb-ops/output/<slice>/brief.md',
          '        description: The brief for this slice.',
        ].join('\n'));
      const parsed = parseWorkflowDef(md(pathOnly), { knownProfiles: KNOWN });
      expect(parsed.ok).toBe(true);
      if (!parsed.ok) return;
      expect(instantiateWorkflowDef(parsed.value, { slice: 'act-1' })).toMatchObject({
        ok: true, value: { stages: [{ artifacts: [{ path: 'orgs/kb-ops/output/act-1/brief.md' }] }] },
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

  it('records the substituted launch values on the instantiated definition', () => {
    const source = SINGLE.replace('profile: research', 'profile: research\nparameters: [channel, slug]')
      .replace('riskTier: T2', 'riskTier: T2\n    workOrder: Write <channel>/<slug>.');
    const parsed = parseWorkflowDef(md(source), { knownProfiles: KNOWN });
    if (!parsed.ok) throw new Error(parsed.detail);
    // The parsed definition never carries values (they are launch input, not file content).
    expect(parsed.value).not.toHaveProperty('launchParameters');
    const instantiated = instantiateWorkflowDef(parsed.value, { channel: 'the-second-take', slug: 'st-042' });
    expect(instantiated).toMatchObject({ ok: true, value: { launchParameters: { channel: 'the-second-take', slug: 'st-042' } } });
    // A parameterless definition stays byte-identical: no key is emitted at all.
    const plain = parseWorkflowDef(md(SINGLE), { knownProfiles: KNOWN });
    if (!plain.ok) throw new Error(plain.detail);
    const untouched = instantiateWorkflowDef(plain.value, {});
    expect(untouched.ok && untouched.value).not.toHaveProperty('launchParameters');
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

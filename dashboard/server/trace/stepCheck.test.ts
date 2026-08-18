/**
 * U6 — `checkSteps`: every rule kind, pass AND fail (asserted on the machine-readable `verdict`); the
 * tri-state `noError` reading; the `not-evaluated` third state for an unmeasurable duration; purity
 * (the input envelope is byte-identical afterwards); and the structural guarantee that this module
 * pulls in no node builtin (which is what makes it legal for the browser panel to import at runtime).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkSteps, type StepRule } from './stepCheck.ts';
import type { EnvelopeStep, RunEnvelope } from './envelope.ts';

function step(over: Partial<EnvelopeStep> & { id: string }): EnvelopeStep {
  return {
    index: 0,
    name: 'Read',
    model: 'claude-opus-5',
    hasResult: true,
    isError: undefined,
    usage: null,
    startedAt: '2026-08-18T10:00:00.000Z',
    endedAt: '2026-08-18T10:00:01.000Z',
    durationMs: 1000,
    ...over,
  };
}

function envelopeOf(steps: EnvelopeStep[]): RunEnvelope {
  return { sessionId: 's1', stepCount: steps.length, steps };
}

function rowsFor(steps: EnvelopeStep[], rules: StepRule[]): Array<{ stepId: string; rule: string; verdict: string }> {
  return checkSteps(envelopeOf(steps), rules).results.map(({ stepId, rule, verdict }) => ({ stepId, rule, verdict }));
}

describe('checkSteps rules', () => {
  it('toolAllowed passes an allowed tool and fails a disallowed one', () => {
    const rows = rowsFor(
      [step({ id: 'a', name: 'Read' }), step({ id: 'b', name: 'Bash' })],
      [{ kind: 'toolAllowed', allowed: ['Read', 'Glob'] }],
    );
    expect(rows).toEqual([
      { stepId: 'a', rule: 'toolAllowed', verdict: 'pass' },
      { stepId: 'b', rule: 'toolAllowed', verdict: 'fail' },
    ]);
    const detail = checkSteps(envelopeOf([step({ id: 'b', name: 'Bash' })]), [
      { kind: 'toolAllowed', allowed: ['Read'] },
    ]).results[0].detail;
    expect(detail).toContain('Bash');
  });

  it('noError fails ONLY on isError === true — false and absent both pass', () => {
    const rows = rowsFor(
      [step({ id: 'true', isError: true }), step({ id: 'false', isError: false }), step({ id: 'absent' })],
      [{ kind: 'noError' }],
    );
    expect(rows).toEqual([
      { stepId: 'true', rule: 'noError', verdict: 'fail' },
      { stepId: 'false', rule: 'noError', verdict: 'pass' },
      { stepId: 'absent', rule: 'noError', verdict: 'pass' },
    ]);
  });

  it('hasResult passes a joined result and fails an unanswered tool_use', () => {
    expect(rowsFor([step({ id: 'a' }), step({ id: 'b', hasResult: false })], [{ kind: 'hasResult' }])).toEqual([
      { stepId: 'a', rule: 'hasResult', verdict: 'pass' },
      { stepId: 'b', rule: 'hasResult', verdict: 'fail' },
    ]);
  });

  it('maxDurationMs compares the timestamp delta and fails when over budget', () => {
    expect(
      rowsFor([step({ id: 'fast', durationMs: 900 }), step({ id: 'slow', durationMs: 5000 })], [
        { kind: 'maxDurationMs', ms: 1000 },
      ]),
    ).toEqual([
      { stepId: 'fast', rule: 'maxDurationMs', verdict: 'pass' },
      { stepId: 'slow', rule: 'maxDurationMs', verdict: 'fail' },
    ]);
  });

  it('maxDurationMs is NOT-EVALUATED (never a pass) when a timestamp is missing', () => {
    const report = checkSteps(envelopeOf([step({ id: 'x', endedAt: null, durationMs: null })]), [
      { kind: 'maxDurationMs', ms: 1 },
    ]);
    const [row] = report.results;
    expect(row.verdict).toBe('not-evaluated');
    // A consumer can tell "could not check" from "checked and clean" WITHOUT reading prose.
    expect(row.verdict).not.toBe('pass');
    expect(row.detail).toContain('timestamp');
  });

  it('model matches exactly and fails on a different (or absent) model', () => {
    expect(
      rowsFor([step({ id: 'a' }), step({ id: 'b', model: 'claude-sonnet-5' }), step({ id: 'c', model: null })], [
        { kind: 'model', equals: 'claude-opus-5' },
      ]),
    ).toEqual([
      { stepId: 'a', rule: 'model', verdict: 'pass' },
      { stepId: 'b', rule: 'model', verdict: 'fail' },
      { stepId: 'c', rule: 'model', verdict: 'fail' },
    ]);
  });

  it('derives `pass` from `verdict` so the two can never disagree', () => {
    const report = checkSteps(
      envelopeOf([step({ id: 'ok' }), step({ id: 'bad', hasResult: false }), step({ id: 'unknown', durationMs: null })]),
      [{ kind: 'hasResult' }, { kind: 'maxDurationMs', ms: 1 }],
    );
    for (const row of report.results) expect(row.pass).toBe(row.verdict !== 'fail');
    // …and the not-evaluated row is a `pass: true` row that is NOT a 'pass' verdict — which is exactly
    // why `verdict` is the field to read.
    const unevaluated = report.results.find((r) => r.stepId === 'unknown' && r.rule === 'maxDurationMs');
    expect(unevaluated).toMatchObject({ pass: true, verdict: 'not-evaluated' });
  });

  it('emits one row per step per rule, in step order then rule order', () => {
    const report = checkSteps(envelopeOf([step({ id: 'a' }), step({ id: 'b' })]), [
      { kind: 'hasResult' },
      { kind: 'noError' },
    ]);
    expect(report.results.map((r) => `${r.stepId}:${r.rule}`)).toEqual([
      'a:hasResult',
      'a:noError',
      'b:hasResult',
      'b:noError',
    ]);
  });

  it('is empty-safe for an envelope with no steps and for an empty rule list', () => {
    expect(checkSteps(envelopeOf([]), [{ kind: 'hasResult' }]).results).toEqual([]);
    expect(checkSteps(envelopeOf([step({ id: 'a' })]), []).results).toEqual([]);
  });
});

describe('checkSteps is report-only', () => {
  it('MUTATES NOTHING — the envelope is deep-identical after the check', () => {
    const env = envelopeOf([step({ id: 'a', isError: true }), step({ id: 'b', hasResult: false })]);
    const before = JSON.stringify(env);
    const rules: StepRule[] = [
      { kind: 'toolAllowed', allowed: ['Read'] },
      { kind: 'noError' },
      { kind: 'hasResult' },
      { kind: 'maxDurationMs', ms: 10 },
      { kind: 'model', equals: 'claude-opus-5' },
    ];
    const rulesBefore = JSON.stringify(rules);
    checkSteps(env, rules);
    expect(JSON.stringify(env)).toBe(before);
    expect(JSON.stringify(rules)).toBe(rulesBefore);
  });

  it('imports no node builtin, so the browser panel may import it at runtime', () => {
    const source = readFileSync(fileURLToPath(new URL('./stepCheck.ts', import.meta.url)), 'utf8');
    // Every import in the module must be either type-only or a non-node specifier.
    const runtimeImports = source
      .split('\n')
      .filter((l) => /^\s*import\s/.test(l) && !/^\s*import\s+type\s/.test(l));
    expect(runtimeImports).toEqual([]);
    expect(source).not.toContain("from 'node:");
    expect(source).not.toContain('require(');
  });
});

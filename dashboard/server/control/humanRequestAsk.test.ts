import { describe, expect, it } from 'vitest';
import { askForHumanRequest } from './humanRequestAsk.ts';
import type { HumanRequest } from './types.ts';

function request(overrides: Partial<HumanRequest> = {}): Pick<HumanRequest, 'kind' | 'title' | 'prompt'> {
  return { kind: 'intervention', title: 'Something happened', prompt: 'Some prose.', ...overrides };
}

/** The five machine patterns the live inbox actually showed, each mapped to one operator sentence. */
describe('askForHumanRequest — known machine patterns', () => {
  const cases: Array<[string, Pick<HumanRequest, 'kind' | 'title' | 'prompt'>, RegExp]> = [
    ['boot failure', request({
      title: 'Manager boot failed',
      prompt: 'Error: spawn claude ENOENT\n    at ChildProcess.handle',
    }), /never got started/i],
    ['budget exhausted', request({
      title: 'Daily budget exceeded',
      prompt: 'governance/budget.yaml cap reached for 2026-08-04',
    }), /spend allowed for it is used up/i],
    ['canonical integration incomplete', request({
      title: 'canonical result lookup identity differs',
      prompt: "transport 'file' not allowed on lineage push",
    }), /never filed/i],
    ['credential refusal', request({
      kind: 'governance-refusal',
      title: 'Worker requested a credential',
      prompt: 'The agent asked to read a credential store; the contract forbids it.',
    }), /do something the rules do not let it do/i],
    ['stranded wake-me', request({
      title: 'wake-me: cadence runner offline',
      prompt: 'The nightly cadence has not run since 2026-07-18.',
    }), /asked for you by name/i],
  ];

  for (const [label, value, expected] of cases) {
    it(`renders the ${label} pattern as one plain sentence naming the run`, () => {
      const { ask, technicalDetail } = askForHumanRequest(value, 'nightly render #7');
      expect(ask).toMatch(expected);
      expect(ask).toContain('nightly render #7');
      // The machine's own words are kept — but as detail, never as the ask.
      expect(technicalDetail).toContain(value.prompt);
      expect(ask).not.toContain(value.prompt);
    });
  }

  it('never lets raw error text reach the ask, whatever the prompt contains', () => {
    const { ask, technicalDetail } = askForHumanRequest(request({
      title: 'Uncaught exception',
      prompt: 'TypeError: cannot read properties of undefined\n    at run (execution.ts:1691:12)',
    }), 'thin slice #3');
    expect(ask).not.toMatch(/TypeError|execution\.ts|at run/);
    expect(technicalDetail).toMatch(/TypeError/);
  });
});

describe('askForHumanRequest — kind fallbacks and the generic', () => {
  it('uses the request kind when no pattern matches', () => {
    expect(askForHumanRequest(request({ kind: 'approval', title: 'Sign off', prompt: 'Please confirm.' }), 'run #1').ask)
      .toMatch(/needs your sign-off/i);
    expect(askForHumanRequest(request({ kind: 'review', title: 'Check step', prompt: 'Look at it.' }), 'run #1').ask)
      .toMatch(/waiting for your review/i);
    expect(askForHumanRequest(request({ kind: 'input', title: 'Which source?', prompt: 'A or B.' }), 'run #1').ask)
      .toMatch(/waiting for an answer from you/i);
  });

  it('falls back to the generic ask, still naming the run, for an unrecognized kind and prompt', () => {
    const { ask } = askForHumanRequest(
      { kind: 'unheard-of' as HumanRequest['kind'], title: 'Hmm', prompt: 'Opaque.' },
      'workflow run #12',
    );
    expect(ask).toBe('workflow run #12 needs your attention. Open the run to see what it is waiting for.');
  });

  it('reports no technical detail when the request carried no text', () => {
    expect(askForHumanRequest({ kind: 'input', title: '', prompt: '' }, 'run #1').technicalDetail).toBeNull();
  });

  it('does not repeat the title when the prompt is identical to it', () => {
    const { technicalDetail } = askForHumanRequest({ kind: 'input', title: 'Same', prompt: 'Same' }, 'run #1');
    expect(technicalDetail).toBe('Same');
  });
});

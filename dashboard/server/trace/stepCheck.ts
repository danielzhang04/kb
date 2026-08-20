/**
 * U6 — the step-check PROTOTYPE: a pure predicate pass over a {@link RunEnvelope}.
 *
 * REPORT-ONLY. `checkSteps` reads an envelope and returns rows; it changes nothing, retries nothing,
 * blocks nothing, and persists nothing. There is no rule DSL and no rule store — the caller passes a
 * literal array. That narrowness is the point: this is the smallest thing that can answer "did this
 * run stay inside its envelope?" without becoming an enforcement surface.
 *
 * NO NODE BUILTINS, DELIBERATELY. This module imports its types with `import type` only, so nothing
 * it pulls in reaches `node:fs`/`node:path` (the envelope READER does, and stays out of the client
 * bundle for that reason). That keeps the file legal to runtime-import from the browser panel under
 * `src/lib/clientImportGraph.test.ts`, so the client and the server evaluate the SAME rules rather
 * than a reimplementation that can drift.
 */

import type { EnvelopeStep, RunEnvelope } from './envelope.ts';

/** The rule kinds. Closed union — a new kind is a code change, never a config string. */
export type StepRule =
  /** The step's tool name must appear in `allowed`. */
  | { kind: 'toolAllowed'; allowed: string[] }
  /** Fails ONLY on `isError === true`. `false` and `undefined` (absent) both pass — an absent flag is
   *  not evidence of failure, and treating it as one would fail every non-erroring older transcript. */
  | { kind: 'noError' }
  /** A matching `tool_result` must have arrived. */
  | { kind: 'hasResult' }
  /** `durationMs` must be ≤ `ms`. Evaluated only when both timestamps were present; otherwise the row
   *  is `not-evaluated` — an unmeasurable step is neither slow nor proven fast. */
  | { kind: 'maxDurationMs'; ms: number }
  /** The emitting model must equal `equals` exactly. */
  | { kind: 'model'; equals: string };

/**
 * THREE-STATE, machine-readable. "Checked and clean" (`pass`) and "could not check" (`not-evaluated`)
 * are different facts and a consumer must be able to tell them apart WITHOUT parsing `detail` prose —
 * an unmeasurable step silently counted as a pass is how a check quietly stops checking.
 */
export type StepVerdict = 'pass' | 'fail' | 'not-evaluated';

interface StepCheckRow {
  /** The `tool_use.id` of the step this row judges. */
  stepId: string;
  /** The rule kind that produced the row (one row per step per rule). */
  rule: StepRule['kind'];
  /** The authoritative outcome. Read THIS, not `pass`, when the distinction matters. */
  verdict: StepVerdict;
  /** Derived convenience: `verdict !== 'fail'` — i.e. "nothing went wrong here", which deliberately
   *  includes the not-evaluated case. Never use it to conclude a rule was actually satisfied. */
  pass: boolean;
  /** Human-readable reason. Present on failures and on not-evaluated rows. */
  detail?: string;
}

interface StepCheckReport {
  results: StepCheckRow[];
}

/** Build a row from a verdict, deriving `pass` so the two can never disagree. */
function row(
  step: EnvelopeStep,
  rule: StepRule,
  verdict: StepVerdict,
  detail?: string,
): StepCheckRow {
  const base: StepCheckRow = { stepId: step.id, rule: rule.kind, verdict, pass: verdict !== 'fail' };
  return detail === undefined ? base : { ...base, detail };
}

function evaluate(step: EnvelopeStep, rule: StepRule): StepCheckRow {
  switch (rule.kind) {
    case 'toolAllowed':
      return rule.allowed.includes(step.name)
        ? row(step, rule, 'pass')
        : row(step, rule, 'fail', `tool "${step.name}" not in [${rule.allowed.join(', ')}]`);
    case 'noError':
      return step.isError !== true
        ? row(step, rule, 'pass')
        : row(step, rule, 'fail', 'tool_result reported is_error');
    case 'hasResult':
      return step.hasResult
        ? row(step, rule, 'pass')
        : row(step, rule, 'fail', 'no tool_result joined to this tool_use');
    case 'maxDurationMs': {
      if (step.durationMs === null) {
        return row(step, rule, 'not-evaluated', 'step has no start/end timestamp pair');
      }
      return step.durationMs <= rule.ms
        ? row(step, rule, 'pass')
        : row(step, rule, 'fail', `${step.durationMs}ms exceeds ${rule.ms}ms`);
    }
    case 'model':
      return step.model === rule.equals
        ? row(step, rule, 'pass')
        : row(step, rule, 'fail', `model ${step.model ?? '(none)'} ≠ ${rule.equals}`);
  }
}

/**
 * Check every step of `envelope` against every rule in `rules` and report the outcome.
 *
 * PURE: neither argument is mutated and nothing is written; the return value is freshly built. Rows
 * come out in step order, then rule order, so a report diffs cleanly between runs.
 */
export function checkSteps(envelope: RunEnvelope, rules: StepRule[]): StepCheckReport {
  const results: StepCheckRow[] = [];
  for (const step of envelope.steps) {
    for (const rule of rules) results.push(evaluate(step, rule));
  }
  return { results };
}

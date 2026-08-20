/**
 * U6 — the FIXTURE envelope the step-check prototype reports on, as a plain client-side constant.
 *
 * It mirrors `server/trace/__fixtures__/real-run-slice.jsonl` (a trimmed, payload-scrubbed slice of a
 * real kb session) as `readEnvelope` produces it: three tool steps, the third one errored. It is a
 * literal on purpose — the panel must never read a server fixture path at runtime, and the browser
 * cannot open files anyway. Not a `*.panel.tsx` file, so the registry never treats it as a tile.
 *
 * A FOURTH STEP was added in U12: one that never got an end timestamp, so `maxDurationMs` cannot be
 * evaluated on it. The step-check's third state — `not-evaluated`, "could not check", the one that
 * must never be mistaken for "checked and clean" — was previously reachable only by injecting a
 * fixture from a test, which meant the state existed in the code and was invisible on screen. It is
 * now VISIBLE in the default render, which is the only place an operator would ever learn to
 * recognise it. Steps that never ended are ordinary in a real transcript (an interrupted run, a tool
 * still in flight when the session was read), so this is a truer fixture, not a contrived one.
 *
 * The type comes from the server module by TYPE-ONLY import (erased at build), so this file adds no
 * runtime edge into `server/trace/envelope.ts` and its `node:` imports.
 */
import type { RunEnvelope } from '../../../../server/trace/envelope.ts';
import type { StepRule } from '../../../../server/trace/stepCheck.ts';

export const FIXTURE_ENVELOPE: RunEnvelope = {
  sessionId: 'real-run-slice',
  stepCount: 4,
  steps: [
    {
      id: 'toolu_012DPqrRRUzwaztJ22GH23eh',
      index: 0,
      name: 'Glob',
      model: 'claude-sonnet-5',
      hasResult: true,
      isError: undefined,
      usage: { input_tokens: 2, output_tokens: 682 },
      startedAt: '2026-07-22T01:24:39.535Z',
      endedAt: '2026-07-22T01:24:46.982Z',
      durationMs: 7447,
    },
    {
      id: 'toolu_01NeUun1LXo6S1jbfzf3TdQM',
      index: 1,
      name: 'Glob',
      model: 'claude-sonnet-5',
      hasResult: true,
      isError: undefined,
      usage: { input_tokens: 2, output_tokens: 682 },
      startedAt: '2026-07-22T01:24:39.771Z',
      endedAt: '2026-07-22T01:24:47.415Z',
      durationMs: 7644,
    },
    {
      id: 'toolu_01Y2wXwX6R3ufQZdWin8y15p',
      index: 2,
      name: 'Write',
      model: 'claude-sonnet-5',
      hasResult: true,
      isError: true,
      usage: { input_tokens: 2, output_tokens: 4378 },
      startedAt: '2026-07-22T01:27:58.125Z',
      endedAt: '2026-07-22T01:27:58.706Z',
      durationMs: 581,
    },
    {
      // Started and never ended: the result arrived without a joinable end timestamp, so the step has
      // no measurable duration. `maxDurationMs` reports `not-evaluated` on it — an unmeasurable step
      // is neither slow nor proven fast — while every other rule still has enough to judge.
      id: 'toolu_01Q8mMwq6fVsLd4rN9xTgB2k',
      index: 3,
      name: 'Read',
      model: 'claude-sonnet-5',
      hasResult: true,
      isError: undefined,
      usage: { input_tokens: 2, output_tokens: 91 },
      startedAt: '2026-07-22T01:28:04.310Z',
      endedAt: null,
      durationMs: null,
    },
  ],
};

/**
 * The prototype rule set. Chosen so the report shows ALL THREE outcomes on real data: the `Write` step
 * breaks `toolAllowed` and `noError`, the two `Glob` steps break the 5s budget, the unfinished `Read`
 * step is `not-evaluated` for duration, and `hasResult` / `model` pass throughout.
 */
export const FIXTURE_RULES: StepRule[] = [
  { kind: 'toolAllowed', allowed: ['Glob', 'Read'] },
  { kind: 'noError' },
  { kind: 'hasResult' },
  { kind: 'maxDurationMs', ms: 5000 },
  { kind: 'model', equals: 'claude-sonnet-5' },
];

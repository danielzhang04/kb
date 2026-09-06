import { describe, expect, expectTypeOf, it } from 'vitest';
import { surfaceAutomaticExecutionFailure, validateTrustedLaunchIdentity, type ApprovedLaunchInput } from './launch.ts';

describe('trusted launch identity', () => {
  it('makes trusted identity a required launch input', () => {
    type RequiredIdentity = {} extends Pick<ApprovedLaunchInput, 'identity'> ? false : true;
    expectTypeOf<RequiredIdentity>().toEqualTypeOf<true>();
  });
  it('accepts a closed server-resolved owner and boot host', () => {
    expect(validateTrustedLaunchIdentity({
      owner: { type: 'workflow', id: 'video-run', project: 'faceless-youtube', sourcePath: 'orgs/faceless-youtube/workflows/video-run.md' },
      executionHost: 'vm',
    })).toEqual({ ok: true, value: {
      owner: { type: 'workflow', id: 'video-run', project: 'faceless-youtube', sourcePath: 'orgs/faceless-youtube/workflows/video-run.md' },
      executionHost: 'vm',
    } });
  });

  it('refuses absent, forged, or extra identity before createRun', () => {
    expect(validateTrustedLaunchIdentity(null)).toEqual({ ok: false, code: 'runnable-owner-required' });
    expect(validateTrustedLaunchIdentity({ owner: { type: 'agent', id: 'grader', sourcePath: '../grader.md' }, executionHost: 'vm' }))
      .toEqual({ ok: false, code: 'runnable-owner-required' });
    expect(validateTrustedLaunchIdentity({ owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' }, executionHost: 'vm', path: 'C:/tmp' }))
      .toEqual({ ok: false, code: 'runnable-owner-required' });
  });
});

describe('automatic execution failure surfacing', () => {
  // Red-on-revert: without the try/catch in surfaceAutomaticExecutionFailure this rejects out of a bare
  // `.catch()` on a floating promise, and with no unhandledRejection handler installed Node kills the
  // daemon -- the 2026-09-06 boot loop, where the intervention write re-hydrated a document the loader
  // refused.
  const throwingStore = (message: string) => ({
    createHumanRequest: () => { throw new Error(message); },
  } as unknown as Parameters<typeof surfaceAutomaticExecutionFailure>[0]);

  it('logs and returns when the intervention write throws on an unloadable document', () => {
    const lines: string[] = [];
    expect(() => surfaceAutomaticExecutionFailure(
      throwingStore('invalid control-plane creator attempt generation provenance'),
      'operator', 'run-1', new Error('engine exploded'), (line) => lines.push(line),
    )).not.toThrow();
    expect(lines).toEqual([
      '[launch] intervention write failed for run run-1: invalid control-plane creator attempt generation provenance',
    ]);
  });

  it('keeps the engine error out of the log line and inside the intervention prompt', () => {
    const lines: string[] = [];
    const written: unknown[] = [];
    const store = { createHumanRequest: (...args: unknown[]) => { written.push(args[2]); return { ok: true }; } };
    surfaceAutomaticExecutionFailure(
      store as unknown as Parameters<typeof surfaceAutomaticExecutionFailure>[0],
      'operator', 'run-2', new Error('secret prompt text'), (line) => lines.push(line),
    );
    expect(written).toEqual([{
      kind: 'intervention', title: 'Automatic execution needs intervention', prompt: 'secret prompt text',
    }]);
    expect(lines).toEqual([]);
    surfaceAutomaticExecutionFailure(
      throwingStore('hydrate refused'), 'operator', 'run-2', new Error('secret prompt text'),
      (line) => lines.push(line),
    );
    expect(lines).toEqual(['[launch] intervention write failed for run run-2: hydrate refused']);
    expect(lines[0]).not.toContain('secret prompt text');
  });

  it('logs the store refusal when the intervention write returns fail rather than throwing', () => {
    // createHumanRequest RETURNS fail(...) for limit (MAX_HUMAN_REQUESTS_PER_RUN), not-found and invalid.
    // That is silence, not a crash -- but the intervention was never filed, so it needs its own line.
    const lines: string[] = [];
    const refusing = {
      createHumanRequest: () => ({ ok: false, reason: 'limit', detail: 'run has too many human requests' }),
    } as unknown as Parameters<typeof surfaceAutomaticExecutionFailure>[0];
    expect(() => surfaceAutomaticExecutionFailure(
      refusing, 'operator', 'run-4', new Error('secret prompt text'), (line) => lines.push(line),
    )).not.toThrow();
    expect(lines).toEqual([
      '[launch] intervention write refused for run run-4: limit: run has too many human requests',
    ]);
    expect(lines[0]).not.toContain('secret prompt text');
  });

  it('survives a throwing logger', () => {
    expect(() => surfaceAutomaticExecutionFailure(
      throwingStore('hydrate refused'), 'operator', 'run-3', 'not-an-error',
      () => { throw new Error('logger is gone too'); },
    )).not.toThrow();
  });
});

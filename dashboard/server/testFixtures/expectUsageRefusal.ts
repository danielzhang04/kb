import { expect } from 'vitest';

/**
 * The one usage-refusal assertion for the P3 CLI fixtures. Both runners refuse the same way — throw
 * their own failure class with the usage exit code and a message naming the offending flag — and the
 * assertion was copied verbatim into each suite. Parameterised on the class and code so the two
 * callers keep their own exit contracts.
 */
export function expectUsageRefusal(
  run: () => unknown,
  expected: { failure: abstract new (...args: never[]) => Error, code: number, fragment: string },
): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(expected.failure);
    expect((error as Error & { code: number }).code).toBe(expected.code);
    expect((error as Error).message).toContain(expected.fragment);
    return;
  }
  throw new Error('expected a usage refusal');
}

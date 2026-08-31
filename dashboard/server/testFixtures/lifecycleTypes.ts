/**
 * Shared lifecycle-wrapper types for the P3/P4/P6 bounded fixture lifecycles
 * (`p3FixtureLifecycle.ts`, `p4FixtureLifecycle.ts`, `p6TwoDaemonFixture.ts`). Extracted per
 * docs/plans/2026-08-26-vm-runtime-streamline-design.md §4 Slice D: `LifecycleChild` was dup'd
 * byte-identical in all three. `LifecycleSpawn` here is the two-argument shape P4 and P6 share; P3
 * needs a third `env` parameter for its authenticated-fixture child, so it keeps its own local
 * `LifecycleSpawn` rather than importing this one.
 */

/** The bounded child a lifecycle wrapper drives. A real `ChildProcess` satisfies it structurally. */
export interface LifecycleChild {
  readonly pid?: number | undefined;
  kill(signal?: NodeJS.Signals): boolean;
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  once(event: 'error', listener: (error: Error) => void): unknown;
}

export type LifecycleSpawn = (command: string, args: readonly string[]) => LifecycleChild;

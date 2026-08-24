/**
 * Headless Codex attempt execution. This module owns no process: one approved engine launch record
 * becomes the closed `ApprovedAttemptDeclaration` the attempt port validates, and the port's two-phase
 * `{receipt,result}` pair is returned unchanged ([C-S5]). Continuity (thread resume), prompt delivery,
 * and terminal-event parsing all live behind that port; worker prose alone still never completes an
 * attempt. The broker's recipe table owns the only codex argv ([C-S2]) — nothing here composes one.
 */
import { buildApprovedAttemptDeclaration, refusedAttemptLaunch } from './claudeWorkerAdapter.ts';
import type { ApprovedAttemptDeclaration, AttemptExecutionPort } from '../pty/contracts.ts';
import type { WorkerAdapter } from './execution.ts';

export { parseCodexStream } from './codexResultParser.ts';
export type { ParsedCodexStream } from './codexResultParser.ts';

export interface CodexExecAdapterOptions {
  /** The two-phase attempt authority ([C-S5]); `null` when no host/binding store is activated. */
  attemptPort: AttemptExecutionPort | null;
  /** The server-owned root every attempt worktree lives under ([C-S4]). */
  worktreeRoot: string;
}

/**
 * Create the headless Codex worker adapter. `begin` returns the port's receipt/result pair so the
 * engine projects `starting -> running` only after the receipt proves the session exists.
 */
export function createCodexExecAdapter(options: CodexExecAdapterOptions): WorkerAdapter {
  return {
    begin(input) {
      const port = options.attemptPort;
      if (port === null) {
        return refusedAttemptLaunch('codex', 'no attempt execution port is activated');
      }
      let declaration: ApprovedAttemptDeclaration;
      try {
        declaration = buildApprovedAttemptDeclaration(input, 'codex', options.worktreeRoot);
      } catch (error) {
        return refusedAttemptLaunch('codex', error instanceof Error ? error.message : String(error));
      }
      return port.begin(declaration);
    },
  };
}

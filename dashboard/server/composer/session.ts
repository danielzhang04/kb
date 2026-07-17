/**
 * C1 — Composer's multi-turn chat session, built as a THIN wrapper over the merged vibe spawn path.
 *
 * Composer needs conversation; `vibe/session.ts#spawnVibe` is single-shot. Rather than fork the gate
 * chain (preamble -> WebAuthn session -> per-operator rate-limit/lockout -> exactly-one-audit-row), this
 * wrapper threads the CLI's OWN session id: each turn is still a discrete, independently-gated,
 * independently-audited `spawnVibe` spawn (a turn == a spawn, so the rate-limit and audit granularity the
 * merged code enforces stay exactly intact). The only two things this wrapper adds are:
 *
 *   1. **session_id capture.** `claude --print --output-format stream-json` emits a `system` init record
 *      on stdout whose payload carries `session_id`. The timeline fold (`SKIP_RECORD_TYPES`) discards
 *      `system` from the *model*, but spawnVibe still hands every parsed record to `onDelta`'s SECOND
 *      argument — so we scan there for the id and hand it back via `onSessionId`. No second stdout tap,
 *      no re-parse.
 *   2. **--resume injection.** On a continuing turn we wrap the injected `VibeSpawner` so the base vibe
 *      arg vector (`--print --output-format stream-json`) gains `--resume <session_id>` appended. This is
 *      a spawner decorator, NOT a change to spawnVibe: the gate chain, the arg base, and the audit sink
 *      are spawnVibe's, untouched. `ANTHROPIC_API_KEY` stays unset — the default spawner passes no env.
 */
import { spawnVibe, defaultVibeSpawner } from '../vibe/session.ts';
import type { SessionInput, VibeDeps, VibeHandlers, VibeSpawner, VibeSpawnOutcome } from '../vibe/session.ts';
import type { TranscriptRecord } from '../planeB/tailer.ts';

/** Vibe handlers plus the one Composer addition: the captured CLI session id for the next turn. */
export interface ComposerHandlers extends VibeHandlers {
  /** Called at most once per turn, with the `session_id` read off the CLI's `system` init record. */
  onSessionId?: (sessionId: string) => void;
}

/** The CLI session id carried by a `system` init record, or `undefined` for any other record. */
function sessionIdOf(rec: TranscriptRecord): string | undefined {
  if (rec.type !== 'system') return undefined;
  const id = (rec as { session_id?: unknown }).session_id;
  return typeof id === 'string' && id.length > 0 ? id : undefined;
}

/**
 * Spawn (or refuse) one Composer turn. `resumeId` is the CLI session id captured from a prior turn — pass
 * `null`/`undefined` for the first turn. Delegates the full gate chain to `spawnVibe`; returns its exact
 * {@link VibeSpawnOutcome} so the route maps refusals identically to the vibe route.
 */
export function spawnComposerTurn(
  prompt: string,
  resumeId: string | null | undefined,
  session: SessionInput,
  handlers: ComposerHandlers,
  deps: VibeDeps,
): VibeSpawnOutcome {
  // Decorate the spawner so a continuing turn resumes the CLI session. spawnVibe hands us the base arg
  // vector; we append `--resume <id>` and nothing else. On the first turn (no id) the vector is untouched.
  const baseSpawn = deps.spawn ?? defaultVibeSpawner;
  const spawn: VibeSpawner = (args, cwd) => baseSpawn(resumeId ? [...args, '--resume', resumeId] : args, cwd);

  // Capture the session id from the first `system` record and forward it, then delegate the delta on to
  // the caller's handler unchanged.
  let captured = false;
  const onDelta: VibeHandlers['onDelta'] = (model, newRecords) => {
    if (!captured) {
      for (const rec of newRecords) {
        const id = sessionIdOf(rec);
        if (id) {
          captured = true;
          handlers.onSessionId?.(id);
          break;
        }
      }
    }
    handlers.onDelta(model, newRecords);
  };

  return spawnVibe(prompt, session, { ...handlers, onDelta }, { ...deps, spawn });
}

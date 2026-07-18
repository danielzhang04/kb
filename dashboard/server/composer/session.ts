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
 *   2. **planning-mode + --resume injection.** Every turn is constrained to Claude plan mode with the
 *      read-only `Read`, `Glob`, and `Grep` tools. A continuing turn also gains a SINGLE
 *      `--resume=<session_id>` token
 *      appended (the fused equals form, review F1 — see below). This is a spawner decorator, NOT a
 *      change to spawnVibe's gates: the gate chain, the arg base, and the audit sink are spawnVibe's,
 *      untouched. `ANTHROPIC_API_KEY` stays unset — the default spawner passes no env.
 *
 * review F1 — the resume target is validated AND bound before it ever reaches the child:
 *   - The route rejects any `resumeId` that is not a well-formed CLI session id (a canonical UUID)
 *     BEFORE calling this function, so a traversal- or flag-shaped value never gets here.
 *   - `--resume` is appended as the SINGLE-TOKEN `--resume=<id>` (never the two tokens `['--resume', id]`).
 *     `claude`'s `--resume` takes an OPTIONAL value, so under commander/yargs a value starting with `-`
 *     would be parsed as a SEPARATE flag rather than the resume value — the fused equals form removes
 *     that ambiguity entirely, so even a future validation regression cannot smuggle a second flag into
 *     the argv (belt-and-suspenders behind the UUID validation, which already rejects any `-`-lead token).
 *   - The id must have been ISSUED by this process for the verified session subject: `spawnComposerTurn`
 *     installs a `preSpawnGuard` (run inside spawnVibe, after session + rate-limit, before spawn) that
 *     refuses a resume whose (subject, id) pair the {@link ResumeRegistry} never recorded.
 */
import { spawnVibe, defaultVibeSpawner } from '../vibe/session.ts';
import type { SessionInput, VibeDeps, VibeHandlers, VibeSpawner, VibeSpawnOutcome } from '../vibe/session.ts';
import type { TranscriptRecord } from '../planeB/tailer.ts';
import type { ResumeRegistry } from './resumeRegistry.ts';
import { isValidResumeId } from './resumeRegistry.ts';

/** Vibe handlers plus the one Composer addition: the captured CLI session id for the next turn. */
export interface ComposerHandlers extends VibeHandlers {
  /** Called at most once per turn, with the `session_id` read off the CLI's `system` init record. */
  onSessionId?: (sessionId: string) => void;
}

/** Vibe deps plus the process-lifetime issued-session allowlist that binds `--resume` (review F1). */
export interface ComposerDeps extends VibeDeps {
  resumeRegistry: ResumeRegistry;
}

/** Composer may inspect the repository, but it cannot mutate it or invoke a shell. */
const COMPOSER_PLANNING_ARGS = ['--permission-mode', 'plan', '--tools', 'Read,Glob,Grep'] as const;

/** The CLI session id carried by a `system` init record, or `undefined` for any other record. */
function sessionIdOf(rec: TranscriptRecord): string | undefined {
  if (rec.type !== 'system') return undefined;
  const id = (rec as { session_id?: unknown }).session_id;
  // Provider output is untrusted process output at this boundary. Only canonical UUIDs may become
  // capability-bearing resume handles or reach durable storage.
  return isValidResumeId(id) ? id : undefined;
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
  deps: ComposerDeps,
): VibeSpawnOutcome {
  // Decorate the spawner so every Composer turn is read-only planning. A continuing turn also gets a
  // SINGLE `--resume=<id>` token (review F1: the fused equals form removes parser ambiguity).
  const baseSpawn = deps.spawn ?? defaultVibeSpawner;
  const spawn: VibeSpawner = (args, cwd) =>
    baseSpawn(
      resumeId
        ? [...args, ...COMPOSER_PLANNING_ARGS, `--resume=${resumeId}`]
        : [...args, ...COMPOSER_PLANNING_ARGS],
      cwd,
    );

  // review F1 — the pre-spawn binding guard. spawnVibe runs it with the VERIFIED subject after its
  // session + rate-limit gates and before any spawn, so it can both (a) refuse a resume whose
  // (subject, id) pair was never issued and (b) capture the verified subject for us to record the
  // freshly-issued id under. It is installed on EVERY turn (not just resumes) precisely so a first turn
  // hands us the subject to attribute the id it is about to issue.
  let verifiedOwner: string | null = null;
  const preSpawnGuard = (owner: string): { ok: true } | { ok: false; detail: string } => {
    verifiedOwner = owner;
    if (resumeId && !deps.resumeRegistry.isIssued(owner, resumeId)) {
      return { ok: false, detail: 'resumeId was not issued to this session subject' };
    }
    return { ok: true };
  };

  // Capture the session id from the first `system` record, RECORD it in the issued-id allowlist under the
  // subject that just passed the gate (verifiedOwner is set by preSpawnGuard, which runs before any
  // stdout), forward it to the caller, then delegate the delta on unchanged.
  let captured = false;
  const onDelta: VibeHandlers['onDelta'] = (model, newRecords) => {
    if (!captured) {
      for (const rec of newRecords) {
        const id = sessionIdOf(rec);
        if (id) {
          captured = true;
          if (verifiedOwner) deps.resumeRegistry.record(verifiedOwner, id);
          handlers.onSessionId?.(id);
          break;
        }
      }
    }
    handlers.onDelta(model, newRecords);
  };

  // review F2 — a Composer turn audits under a DISTINCT action with the resume target recorded. The full
  // CLI session id is a capability-bearing handle (it resumes a live agent session), so we log only its
  // last 4 chars for correlation — never the reusable id — in the git-committed ledger.
  const auditDetail = { resume: Boolean(resumeId) };

  return spawnVibe(prompt, session, { ...handlers, onDelta }, {
    ...deps,
    spawn,
    preSpawnGuard,
    auditAction: 'composer-turn',
    auditDetail,
  });
}

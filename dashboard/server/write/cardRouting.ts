/**
 * R2.3 — governed per-CARD routing write. Sets/clears a card's frontmatter `runtime`/`model` fields —
 * the HIGHEST-precedence routing input (proposal §4 rung 1) — through the governed path. This is the
 * exact write D3.4's inline DAG-node toggle will import unchanged.
 *
 * Card frontmatter is NEVER written as raw `queue/*.md` bytes from TypeScript. Mirroring `write/launch.ts`,
 * the mutation shells `py -3 -c` code that imports `scripts/cards.py` as a MODULE and calls its
 * `parse`/`stamp_routing`/`save` primitives (cards.py stays the sole schema authority), then the changed
 * card file is committed to `ops` through the D2.5 coordination route (`branch.ts#routeCoordination`:
 * pull-rebase-push). In order: WebAuthn session gate (401) -> registry validation (400) -> py stamp ->
 * governed ops commit -> exactly one D2.9 audit row.
 *
 * HASH-BINDING (flagged, intentionally NOT done here): proposal §3 recommends adding `runtime`/`model`
 * to the dashboard `content_hash` preimage so a routing change is tamper-evident. That preimage lives in
 * the FROZEN WebAuthn challenge/verifier code (`auth/challenge.ts` / `webauthn_verify.py`), a separate
 * flagged decision out of R2's scope — this module deliberately does not alter it.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { parseCardFrontmatter } from '../planeA/cards.ts';
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { defaultPyRunner } from './launch.ts';
import type { PyRunner } from './launch.ts';
import { prepareCoordination, defaultGitRunner } from './branch.ts';
import { withOpsTransaction } from './asyncGit.ts';
import type { GitRunner } from './branch.ts';
import { loadPolicy } from '../routing/policy.ts';
import type { PolicyDoc } from '../routing/policy.ts';
import { appendAuditRowLocal, AUDIT_REL_PATH } from '../audit/log.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';

/** A LOCAL-only audit append (no git of its own). The row is committed atomically with the card change
 *  by the prepared coordination commit (MED-3). Signature matches `appendAuditRowLocal`. */
export type LocalAuditAppend = (repoRoot: string, event: AuditEvent, now?: () => Date) => AuditRow;

/** A card id must be filename-safe (no path separators / glob metacharacters) — mirrors write/routes.ts. */
const CARD_ID_RE = /^[A-Za-z0-9._-]+$/;

export interface CardRoutingInput {
  repoRoot: string;
  cardId: string;
  sessionToken: string | undefined;
  sessionConfig: SessionConfig;
}

export interface CardRoutingDeps {
  runPy?: PyRunner;
  runGit?: GitRunner;
  /** LOCAL audit append (committed atomically with the card change; NOT a self-pushing sink). */
  appendAudit?: LocalAuditAppend;
  now?: () => Date;
  loadPolicyFn?: (repoRoot: string) => PolicyDoc;
  /** Server-internal authority for a managed stage whose assigned inbox card is proven not started. */
  managedAssignedInbox?: { workflowRef: string };
  /** Re-run caller-specific CAS and executable policy after canonical ops reconciliation. */
  authorizeAfterReconcile?: () => Extract<CardRoutingOutcome, { ok: false }> | null;
}

export type CardRoutingOutcome =
  | { ok: true; cardId: string; cardPath: string; runtime: string | null; model: string | null }
  | {
      ok: false;
      status: 401 | 400 | 409 | 500;
      reason: string;
      error?: string;
      state?: string;
      disposition?: 'requires-successor-attempt' | 'requires-reapproval' | 'state-not-reroutable'
        | 'plan-amendment-required' | 'successor-attempt-required' | 'immutable';
    };

/**
 * Per-card routing is mutable only before a card can possibly have been picked up: a dependency-blocked
 * card, or an unowned inbox card. An owned inbox card is already dispatchable and the Codex worker's
 * transition to `working` lives on its isolated result branch, so canonical ops may still say `inbox`
 * after execution started. Treating that state as safely mutable would make the UI promise a live model
 * switch that cannot occur. Active/stopping, approval-bound, and historical attempts are likewise
 * immutable; the operator must use a successor attempt (and, for an approval, collect a new approval).
 */
interface RoutingLifecycleLock {
  state: string;
  reason: string;
  disposition: 'requires-successor-attempt' | 'requires-reapproval' | 'state-not-reroutable';
}

function lifecycleLock(state: string, owner: unknown): RoutingLifecycleLock | null {
  if (state === 'blocked') return null;
  if (state === 'inbox' && (owner === null || owner === undefined || owner === '')) return null;
  if (state === 'inbox') {
    return {
      state,
      disposition: 'requires-successor-attempt',
      reason: 'assigned inbox card may already have been picked up by its runner; routing is fixed for this attempt',
    };
  }
  if (['working', 'stop-requested', 'halting'].includes(state)) {
    return {
      state,
      disposition: 'requires-successor-attempt',
      reason: 'active or stopping card cannot change runtime/model in place; create a successor attempt with new routing',
    };
  }
  if (state === 'approvals' || state === 'approved') {
    return {
      state,
      disposition: 'requires-reapproval',
      reason: 'card is under an active approval; routing is frozen with the reviewed scope and changing it requires reapproval',
    };
  }
  if (['done', 'rejected', 'halted'].includes(state)) {
    return {
      state,
      disposition: 'requires-successor-attempt',
      reason: 'historical card routing is immutable; retry as a successor attempt with new routing',
    };
  }
  return {
    state,
    disposition: 'state-not-reroutable',
    reason: `card state "${state}" is not safely reroutable`,
  };
}

/**
 * The fixed Python payload. Reads one JSON op from `sys.argv[1]` (`{kind:"set"|"clear", cardId, runtime,
 * model}`), locates the card via `cards.py`, applies `stamp_routing` (None/None on a clear), re-saves
 * through `cards.save`, and prints `{"id","path","state"}`. The op payload travels as a separate argv
 * element — never concatenated into the script text.
 */
export const CARD_ROUTING_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

op = json.loads(sys.argv[1])
queue_root = Path("queue")
matches = list(queue_root.glob(f"**/{op['cardId']}.md"))
if not matches:
    print(f"card not found: {op['cardId']}", file=sys.stderr)
    raise SystemExit(2)
card = cards.parse(matches[0])
runtime = op.get("runtime")
model = op.get("model")
cards.stamp_routing(card, runtime, model)
path = cards.save(card, queue_root)
print(json.dumps({"id": card.meta["id"], "path": str(path), "state": card.meta["state"]}))
`.trim();

/** Union of every runtime's known_models. */
function knownModelSet(policy: PolicyDoc): Set<string> {
  const out = new Set<string>();
  for (const spec of Object.values(policy.runtimes ?? {})) for (const m of spec.known_models ?? []) out.add(m);
  return out;
}

/** Recursively locate an EXISTING `<cardId>.md` under `queueRoot`, returning its (pre-realpath) absolute
 *  path or null. FOLLOWS symlinked/junctioned directories (with a realpath cycle-guard) so a card reached
 *  through a symlinked parent is still found — the caller then applies the realpath-containment refusal. */
function findCardFile(queueRoot: string, cardId: string): string | null {
  const target = `${cardId}.md`;
  const seen = new Set<string>();
  const stack = [queueRoot];
  while (stack.length > 0) {
    const dir = stack.pop() as string;
    let realDir: string;
    try {
      realDir = realpathSync(dir);
    } catch {
      continue;
    }
    if (seen.has(realDir)) continue;
    seen.add(realDir);
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const p = join(dir, e.name);
      let isDir = e.isDirectory();
      if (e.isSymbolicLink()) {
        try {
          isDir = statSync(p).isDirectory();
        } catch {
          isDir = false;
        }
      }
      if (isDir) stack.push(p);
      else if (e.name === target) return p;
    }
  }
  return null;
}

/**
 * LOW-1 — symlink/realpath discipline for the py-shelled card write. `scripts/cards.py` writes the card
 * with `Path.write_text`, which FOLLOWS symlinks; the governedSave realpath/lstat guard does not cover
 * this path. Before invoking py we resolve the card's existing on-disk target and refuse if it is a
 * symlink, or if it (via a symlinked parent) escapes the repo's `queue/`. Returns a reason on refusal,
 * else null (incl. "no existing target" — a fresh card cards.py will create/refuse itself).
 */
function symlinkGuard(repoRoot: string, cardId: string): string | null {
  const queueRoot = join(repoRoot, 'queue');
  if (!existsSync(queueRoot)) return null;
  const found = findCardFile(queueRoot, cardId);
  if (!found) return null;
  if (lstatSync(found).isSymbolicLink()) return 'refusing to write a card through a symlink';
  let real: string;
  let queueReal: string;
  try {
    real = realpathSync(found);
    queueReal = realpathSync(resolve(queueRoot));
  } catch {
    return 'refusing to resolve the card write target';
  }
  const rel = relative(queueReal, real);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    return 'refusing to write a card that escapes the queue directory';
  }
  return null;
}

/**
 * LIFECYCLE guard. Before any routing mutation, resolve the target card's authoritative frontmatter
 * state + owner and determine whether the card is still safely mutable. Uses the same
 * `findCardFile` locator as {@link symlinkGuard} (run FIRST, so a symlinked/escaping target is already
 * refused before we read here) and the read-side `parseCardFrontmatter`. Returns null when the card is
 * absent (the py path then reports not-found itself) or its frontmatter is unparseable (let py handle it).
 */
function routingLifecycleGuard(
  repoRoot: string,
  cardId: string,
  managedAssignedInbox?: { workflowRef: string },
): RoutingLifecycleLock | null {
  const queueRoot = join(repoRoot, 'queue');
  if (!existsSync(queueRoot)) return null;
  const found = findCardFile(queueRoot, cardId);
  if (!found) return null;
  try {
    const meta = parseCardFrontmatter(readFileSync(found, 'utf-8')).meta;
    if (managedAssignedInbox && String(meta.state) === 'inbox') {
      if (meta.owner && meta.id === cardId && meta.workflow === managedAssignedInbox.workflowRef) return null;
      return {
        state: 'inbox',
        disposition: 'requires-successor-attempt',
        reason: 'managed reroute authority did not match the exact assigned canonical card and workflow',
      };
    }
    return lifecycleLock(String(meta.state), meta.owner);
  } catch {
    return null;
  }
}

function gate(input: CardRoutingInput): { ok: true; sub: string } | { ok: false; status: 401; reason: string } {
  if (!input.sessionToken) return { ok: false, status: 401, reason: 'missing session token' };
  const check = verifySession(input.sessionToken, input.sessionConfig);
  if (!check.ok) return { ok: false, status: 401, reason: `invalid session: ${check.reason}` };
  return { ok: true, sub: check.claims.sub };
}

/** Validate a concrete (runtime, model) pair against the registry (null/null = clear, always valid). */
function validate(runtime: string | null, model: string | null, policy: PolicyDoc): string | null {
  if (runtime === null && model === null) return null; // clear
  const runtimes = policy.runtimes ?? {};
  if (runtime !== null) {
    if (!(runtime in runtimes)) return `runtime "${runtime}" is not in the policy registry`;
    if (model !== null && !(runtimes[runtime].known_models ?? []).includes(model)) {
      return `model "${model}" is not a known model of runtime "${runtime}"`;
    }
  } else if (model !== null && !knownModelSet(policy).has(model)) {
    return `model "${model}" is not a concrete known model of any registered runtime`;
  }
  return null;
}

async function apply(
  input: CardRoutingInput,
  runtime: string | null,
  model: string | null,
  deps: CardRoutingDeps,
  op: 'set' | 'clear',
): Promise<CardRoutingOutcome> {
  const g = gate(input);
  if (!g.ok) return g;
  if (!CARD_ID_RE.test(input.cardId)) return { ok: false, status: 400, reason: 'cardId must be filename-safe' };

  const runGit = deps.runGit ?? defaultGitRunner;
  // The whole prepare → validate → mutate → commit/verify sequence is ONE ops transaction.
  return withOpsTransaction(async () => {
  // Reconcile canonical ops BEFORE reading lifecycle state or mutating anything. This closes the race
  // where an assigned/approved remote card was validated from stale local state, and avoids attempting
  // a pull after Python has already dirtied the card and audit paths.
  try {
    await prepareCoordination(input.repoRoot, runGit);
  } catch (err) {
    return { ok: false, status: 500, reason: err instanceof Error ? err.message : String(err) };
  }

  const policy = (deps.loadPolicyFn ?? loadPolicy)(input.repoRoot);
  const reason = validate(runtime, model, policy);
  if (reason) return { ok: false, status: 400, reason };
  const baseHead = (await runGit(input.repoRoot, ['rev-parse', 'HEAD'])).trim();
  if (!/^[0-9a-f]{40}$/i.test(baseHead)) {
    return { ok: false, status: 500, reason: 'could not pin the prepared ops revision' };
  }

  // Re-read guards from the reconciled tree. Refusals below perform no local mutation or commit.
  const guard = symlinkGuard(input.repoRoot, input.cardId);
  if (guard) return { ok: false, status: 400, reason: guard };

  // SECURITY + execution truth: refuse ANY routing mutation unless the card is blocked or an unowned
  // inbox item. Like every other
  // pre-py refusal above, this does NO write, NO ops commit, and NO audit append: the house convention
  // (governedSave/launch FINDING 3) is that refused writes never amplify into an ops pull-rebase-push,
  // so there is nothing consequential to record.
  const lifecycle = routingLifecycleGuard(input.repoRoot, input.cardId, deps.managedAssignedInbox);
  if (lifecycle) {
    return {
      ok: false,
      status: 409,
      error: 'routing-state-locked',
      reason: lifecycle.reason,
      state: lifecycle.state,
      disposition: lifecycle.disposition,
    };
  }
  const authorization = deps.authorizeAfterReconcile?.();
  if (authorization) return authorization;

  const runPy = deps.runPy ?? defaultPyRunner;
  const result = runPy(input.repoRoot, CARD_ROUTING_SCRIPT, JSON.stringify({ kind: op, cardId: input.cardId, runtime, model }));
  if (result.exitCode !== 0) {
    // exit 2 = card not found (a bad target -> 400); any other non-zero is an internal failure (500).
    const detail = result.stderr.trim() || result.stdout.trim();
    return { ok: false, status: result.exitCode === 2 ? 400 : 500, reason: detail || 'card routing op failed' };
  }
  let parsed: { id: string; path: string };
  try {
    parsed = JSON.parse(result.stdout.trim().split('\n').filter(Boolean).pop() ?? '') as { id: string; path: string };
  } catch {
    return { ok: false, status: 500, reason: 'card routing op produced no result' };
  }

  // MED-3: append the audit row LOCALLY (no git of its own), then commit it in the SAME ops commit as
  // the card change (one commit, one push — atomic by construction). A failure here happens BEFORE any
  // push, so ops can never see a card routing change without its audit row.
  const appendLocal = deps.appendAudit ?? appendAuditRowLocal;
  try {
    appendLocal(
      input.repoRoot,
      {
        action: 'card-routing',
        owner: g.sub,
        cardId: input.cardId,
        target: input.cardId,
        result: op === 'set' ? `routed:runtime=${runtime ?? '-'},model=${model ?? '-'}` : 'cleared',
        detail: { op, runtime, model },
      },
      deps.now,
    );
  } catch (err) {
    return { ok: false, status: 500, reason: err instanceof Error ? err.message : String(err) };
  }

  // Governed coordination commit of the changed card file AND the audit row to ops in ONE commit
  // (pull-rebase-push, retry) — atomic change+audit.
  let routingCommit = '';
  try {
    const branch = (await runGit(input.repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    if (branch !== 'ops') throw new Error(`refusing routing commit from branch ${branch || '(unknown)'}`);
    await runGit(input.repoRoot, ['add', '--', parsed.path, AUDIT_REL_PATH]);
    await runGit(input.repoRoot, ['commit', '-m', `chore(routing): ${op} card ${input.cardId} routing`]);
    routingCommit = (await runGit(input.repoRoot, ['rev-parse', 'HEAD'])).trim();
    if (!/^[0-9a-f]{40}$/i.test(routingCommit)) throw new Error('could not pin the routing commit');
  } catch (err) {
    try {
      await runGit(input.repoRoot, ['reset', '--hard', baseHead]);
    } catch (rollbackError) {
      return {
        ok: false,
        status: 500,
        reason: `routing commit failed and rollback failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      };
    }
    return { ok: false, status: 500, reason: err instanceof Error ? err.message : String(err) };
  }

  try {
    await runGit(input.repoRoot, ['push', 'origin', 'ops']);
  } catch {
    try {
      await runGit(input.repoRoot, ['fetch', 'origin', 'ops']);
      try {
        await runGit(input.repoRoot, ['merge-base', '--is-ancestor', routingCommit, 'origin/ops']);
        // The exact commit is reachable remotely: publication succeeded despite the transport error.
      } catch (checkError) {
        const status = (checkError as { status?: unknown }).status;
        if (status !== 1) {
          return { ok: false, status: 500, error: 'publication-unknown', reason: 'could not verify whether the routing commit reached ops' };
        }
        await runGit(input.repoRoot, ['reset', '--hard', 'origin/ops']);
        return { ok: false, status: 409, error: 'routing-conflict', reason: 'ops advanced during routing; retry from the refreshed card state' };
      }
    } catch {
      return { ok: false, status: 500, error: 'publication-unknown', reason: 'routing publication could not be verified; inspect canonical ops before retrying' };
    }
  }

  return { ok: true, cardId: parsed.id, cardPath: parsed.path, runtime, model };
  });
}

/** Set a card's frontmatter `runtime`/`model` (top-precedence per-card override). */
export function setCardRouting(
  input: CardRoutingInput,
  routing: { runtime: string; model: string },
  deps: CardRoutingDeps = {},
): Promise<CardRoutingOutcome> {
  return apply(input, routing.runtime, routing.model, deps, 'set');
}

/** Clear a card's frontmatter routing (back to override/policy resolution). */
export function clearCardRouting(input: CardRoutingInput, deps: CardRoutingDeps = {}): Promise<CardRoutingOutcome> {
  return apply(input, null, null, deps, 'clear');
}

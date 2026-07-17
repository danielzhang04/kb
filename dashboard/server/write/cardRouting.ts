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
import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, resolve, relative, sep, isAbsolute } from 'node:path';
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { defaultPyRunner } from './launch.ts';
import type { PyRunner } from './launch.ts';
import { routeCoordination, defaultGitRunner } from './branch.ts';
import type { GitRunner } from './branch.ts';
import { loadPolicy } from '../routing/policy.ts';
import type { PolicyDoc } from '../routing/policy.ts';
import { appendAuditRowLocal, AUDIT_REL_PATH } from '../audit/log.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';

/** A LOCAL-only audit append (no git of its own). The row is committed atomically with the card change
 *  by {@link routeCoordination}'s single commit (MED-3). Signature matches `appendAuditRowLocal`. */
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
}

export type CardRoutingOutcome =
  | { ok: true; cardId: string; cardPath: string; runtime: string | null; model: string | null }
  | { ok: false; status: 401 | 400 | 500; reason: string };

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

  const policy = (deps.loadPolicyFn ?? loadPolicy)(input.repoRoot);
  const reason = validate(runtime, model, policy);
  if (reason) return { ok: false, status: 400, reason };

  // LOW-1: refuse a symlinked / repo-escaping card target BEFORE shelling py (which would follow it).
  const guard = symlinkGuard(input.repoRoot, input.cardId);
  if (guard) return { ok: false, status: 400, reason: guard };

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
  try {
    routeCoordination(input.repoRoot, parsed.path, {
      runGit: deps.runGit ?? defaultGitRunner,
      message: `chore(routing): ${op} card ${input.cardId} routing`,
      alsoStage: [AUDIT_REL_PATH],
    });
  } catch (err) {
    return { ok: false, status: 500, reason: err instanceof Error ? err.message : String(err) };
  }

  return { ok: true, cardId: parsed.id, cardPath: parsed.path, runtime, model };
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

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
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { defaultPyRunner } from './launch.ts';
import type { PyRunner } from './launch.ts';
import { routeCoordination, defaultGitRunner } from './branch.ts';
import type { GitRunner } from './branch.ts';
import { loadPolicy } from '../routing/policy.ts';
import type { PolicyDoc } from '../routing/policy.ts';
import { appendAudit as realAppendAudit } from '../audit/log.ts';
import type { AppendAuditFn } from '../http/context.ts';
import type { OpsGitRunner } from '../audit/log.ts';

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
  appendAudit?: AppendAuditFn;
  auditGit?: OpsGitRunner;
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

  // Governed coordination commit of the changed card file to ops (pull-rebase-push, retry).
  try {
    routeCoordination(input.repoRoot, parsed.path, {
      runGit: deps.runGit ?? defaultGitRunner,
      message: `chore(routing): ${op} card ${input.cardId} routing`,
    });
  } catch (err) {
    return { ok: false, status: 500, reason: err instanceof Error ? err.message : String(err) };
  }

  const appendAudit = deps.appendAudit ?? realAppendAudit;
  appendAudit(
    input.repoRoot,
    {
      action: 'card-routing',
      owner: g.sub,
      cardId: input.cardId,
      target: input.cardId,
      result: op === 'set' ? `routed:runtime=${runtime ?? '-'},model=${model ?? '-'}` : 'cleared',
      detail: { op, runtime, model },
    },
    { runGit: deps.auditGit, now: deps.now },
  );

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

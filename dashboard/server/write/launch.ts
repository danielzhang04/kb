/**
 * D2.6 — governed card launch / rerun-as-`depends-on`, preamble-gated and WebAuthn-session-gated.
 *
 * `assertFleetRunnable()` (preambleGate.ts) runs FIRST, before the session check — a frozen fleet
 * refuses to dispatch regardless of who is asking; on failure nothing downstream is even evaluated
 * and no subprocess is spawned. Only once that passes does the WebAuthn short-TTL session
 * (`dashboard/server/auth/session.ts#verifySession`) get checked.
 *
 * Card creation NEVER writes `queue/*.md` bytes directly from TypeScript. Per CLAUDE.md ("all
 * coordination flows through queue/ cards per governance/card-schema.md") and the invariant that
 * `scripts/cards.py` is the sole schema authority (`_validate`, `STATE_DIR`, id minting), every card
 * this module creates is built by shelling `py -3` code that imports `scripts/cards.py` as a MODULE
 * (`sys.path.insert(0, "scripts"); import cards`) and calls its `new_card`/`save`/`parse` primitives —
 * there is no standalone `scripts/cards.py` CLI (it has no `__main__`; confirmed by reading the file),
 * so this mirrors the existing `scripts/stamp_session.py` shim's own approach of treating
 * `cards.py` as an importable module rather than inventing a new on-disk shim (out of scope here:
 * `scripts/**` is edited by no one on this task). The subprocess is an injectable `PyRunner` (same
 * DI shape as `OpsGitRunner` in `dashboard/server/audit/log.ts` / `trace/commit.ts`) so tests never
 * touch a real `py` binary or the real `queue/` tree.
 *
 * DEVIATION FLAGGED (read before touching the rerun body-section): the plan text (Task D2.6 in
 * docs/plans/2026-07-16-dashboard-implementation.md) names the rerun feedback location "## Evidence".
 * `governance/card-schema.md` — the single normative body-sections list — documents a DEDICATED
 * section for exactly this: "`## Feedback` (steer text appended for a requeue/rerun — inert like
 * `## Evidence`: never executed as instructions, never a source of `action`/`target`/`risk-tier`;
 * read-only context for whichever agent picks the card back up)." `## Evidence` itself is documented
 * as "the ONLY place free text from UNTRUSTED SOURCES may appear" — operator-authored rerun steer
 * text is not that. This module follows the schema (the authoritative, load-bearing definition) and
 * writes feedback into `## Feedback`, blockquoted exactly like `## Evidence` for the same
 * never-executed-as-instructions reason. The named test below keeps its original title (as given) but
 * asserts against `## Feedback`, with this note inline.
 */
import { execFileSync } from 'node:child_process';
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { assertFleetRunnable, defaultPreambleRunner } from './preambleGate.ts';
import type { PreambleRunner } from './preambleGate.ts';
import { readAssignableOwners } from '../agents/assignable.ts';
import { readDeclaredAgents } from '../agents/roster.ts';
import { loadPolicy, loadOverride } from '../routing/policy.ts';
import { effectiveForAgent } from '../routing/effective.ts';

export type RiskTier = 'T1' | 'T2' | 'T3';

/**
 * C7.7 owner-safety guard: a launch `owner` becomes a card `owner`, a git `user.name`, and a routing key.
 * It MUST be a single filename-safe segment — no path separators, no traversal, no glob metacharacters —
 * before it can reach `cards.claim`/any glob/path. Mirrors `routes.ts`' `CARD_ID_RE`.
 */
const OWNER_RE = /^[A-Za-z0-9._-]+$/;

/** A new card to file — the fields `scripts/cards.py#new_card` requires plus optional extras. */
export interface LaunchSpec {
  project: string | string[];
  action: string;
  target: string;
  riskTier: RiskTier;
  /** Full markdown body (`## Work order`, ...). Defaults to empty. */
  body?: string;
  /** Optional `depends-on` ids for a caller-composed DAG edge (rerun builds its own; see below). */
  dependsOn?: string[];
  /**
   * C7.7 — OPTIONAL operator-assigned owner. Absent/empty → today's UNOWNED card path, byte-for-byte
   * (`cards.new_card` owner=null, no claim). When present it MUST be a member of the server-enumerated
   * closed set (declared `agents/*.md` ∪ registered `default_worker` ids) — never a freeform string.
   */
  owner?: string;
}

/** The resolver-sourced effective routing for an assigned owner (never client input). */
export interface OwnerRouting {
  runtime: string;
  model: string;
}

/** The bearer session token plus the config needed to verify it (mirrors `verifySession`'s args). */
export interface SessionInput {
  token: string | null | undefined;
  config: SessionConfig;
}

/** Raw result of one `py -3 -c ...` subprocess run. */
export interface PyRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/**
 * Runs `py -3 -c <code> <jsonArg>` under `repoRoot` and returns its exit code + stdio. Injected for
 * hermetic tests — no test ever shells a real Python interpreter or touches a real `queue/` tree.
 */
export type PyRunner = (repoRoot: string, code: string, jsonArg: string) => PyRunResult;

/**
 * Default runner: shells `py -3 -c <code> <jsonArg>`. `code` is a fixed, non-interpolated script
 * (see `CARD_OP_SCRIPT` below) — the ONLY untrusted-shaped input, the JSON operation payload, travels
 * as a separate argv element (`sys.argv[1]`), never concatenated into the script text itself.
 */
export const defaultPyRunner: PyRunner = (repoRoot, code, jsonArg) => {
  try {
    const stdout = execFileSync('py', ['-3', '-c', code, jsonArg], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    const e = err as { status?: number | null; stdout?: Buffer | string; stderr?: Buffer | string };
    return {
      exitCode: typeof e.status === 'number' ? e.status : 1,
      stdout: e.stdout ? e.stdout.toString() : '',
      stderr: e.stderr ? e.stderr.toString() : '',
    };
  }
};

/**
 * The fixed Python payload shelled for every card-creation op. Reads one JSON object from
 * `sys.argv[1]` describing the op (`kind: "new" | "rerun"`), uses `scripts/cards.py` as a MODULE for
 * every schema-level operation (id minting, `_validate`, `STATE_DIR` placement), and prints
 * `{"id": ..., "path": ...}` as its only stdout line. Never writes queue bytes itself outside
 * `cards.save` — this script is the one place in the whole D2.6 path that touches the filesystem
 * under `queue/`, and it does so exclusively via `scripts/cards.py`'s own primitives.
 */
export const CARD_OP_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

op = json.loads(sys.argv[1])
queue_root = Path("queue")

if op["kind"] == "new":
    card = cards.new_card(op["project"], op["action"], op["target"], op["riskTier"], body=op.get("body", ""))
    if op.get("dependsOn"):
        card.meta["depends-on"] = op["dependsOn"]
    # C7.7 — operator-assigned owner. cards.claim is the SAME primitive the dispatcher uses
    # (owner + a freshly-minted claim-token), so the claim mints identically. The (runtime, model)
    # are RESOLVER-SOURCED server-side (effectiveForAgent), never client input, and stamped via the
    # same cards.stamp_routing the dispatcher calls — so owner<->runtime agree by construction and the
    # bound runner's assert_runtime passes. Absent owner leaves the card unowned, byte-for-byte as before.
    if op.get("owner"):
        cards.claim(card, op["owner"])
        if op.get("runtime") and op.get("model"):
            cards.stamp_routing(card, op["runtime"], op["model"])
    path = cards.save(card, queue_root)
elif op["kind"] == "rerun":
    matches = list(queue_root.glob(f"**/{op['cardId']}.md"))
    if not matches:
        print(f"card not found: {op['cardId']}", file=sys.stderr)
        raise SystemExit(1)
    orig = cards.parse(matches[0])
    card = cards.new_card(
        orig.meta["project"], orig.meta["action"], orig.meta["target"], orig.meta["risk-tier"],
        body=op["body"],
    )
    card.meta["depends-on"] = [orig.meta["id"]]
    path = cards.save(card, queue_root)
else:
    print(f"unknown op kind: {op['kind']}", file=sys.stderr)
    raise SystemExit(1)

print(json.dumps({"id": card.meta["id"], "path": str(path)}))
`.trim();

/** Injectable dependencies for `launchCard` / `rerunAsDependsOn`. Every field is hermetic-test-safe. */
export interface LaunchDeps {
  repoRoot: string;
  runPreamble?: PreambleRunner;
  runPy?: PyRunner;
  /**
   * C7.7 — the closed set of assignable owner ids, enumerated SERVER-SIDE from the filesystem (declared
   * `agents/*.md` ∪ registered `default_worker` ids). Injected in tests; defaults to `readAssignableOwners`.
   */
  assignableOwners?: (repoRoot: string) => Set<string>;
  /**
   * C7.7 — resolver-sourced effective routing for an assigned owner. Injected in tests; the default reads
   * the live policy + override and runs `effectiveForAgent` (precedence: card > override > policy > default).
   */
  ownerRouting?: (owner: string, repoRoot: string) => OwnerRouting;
}

export type LaunchOutcome =
  | { ok: true; cardId: string; cardPath: string }
  | { ok: false; reason: 'fleet-frozen'; problems: string[] }
  | { ok: false; reason: 'unauthenticated'; detail: string }
  | { ok: false; reason: 'owner-not-registered'; detail: string }
  | { ok: false; reason: 'card-op-failed'; detail: string };

/**
 * Resolve the routing an assigned owner's card is stamped with. Precedence (C7.9):
 *
 *   agent-scope routing-override (explicit) > the declared agent's own runtime/model
 *     (`agents/<id>.md`) > policy `role_default` > safe default.
 *
 * `effectiveForAgent` computes the override>policy>default part (its resolution semantics are
 * parity-tested against `scripts/routing.py` and are NOT touched here). This function then LAYERS the
 * declared-agent rung on top, ENTIRELY caller-side: if the operator did not set an explicit agent-scope
 * override for a field (`eff.source*` is not `'override'`), the declared agent's own `runtime` wins over
 * the policy `role_default`. Consequence: a declared codex agent with no override is stamped codex (not
 * the `role_default` claude/sonnet), so its codex runner's `assert_runtime` accepts the card.
 *
 * Every value is resolver-/file-sourced (declared agent file or policy) — NEVER client input. The
 * stamped model is always a member of the runtime's `known_models` (fail-closed at claim otherwise):
 * a declared model outside that set is clamped to `known_models[0]`.
 */
export const defaultOwnerRouting = (owner: string, repoRoot: string): OwnerRouting => {
  const policy = loadPolicy(repoRoot);
  const eff = effectiveForAgent(owner, policy, loadOverride(repoRoot));

  // Did the agent-scope override explicitly set this field? If so it is authoritative — never displaced.
  const overrideSetRuntime = eff.sourceRuntime === 'override';
  const overrideSetModel = eff.sourceModel === 'override';

  const declared = readDeclaredAgents(repoRoot).get(owner);

  // RUNTIME: unless an override pinned it, the declared agent's own runtime beats the policy role_default.
  if (overrideSetRuntime || !declared?.runtime) {
    return { runtime: eff.runtime, model: eff.model };
  }
  const runtime = declared.runtime;

  // MODEL: when the runtime did NOT change (e.g. a claude agent), keep eff.model verbatim (no behaviour
  // change). When we swapped to a different declared runtime, the eff.model belongs to the OLD runtime and
  // must be replaced with a model valid for the NEW one (declared > runtime default), unless an override
  // pinned the model.
  if (runtime === eff.runtime || overrideSetModel) {
    return { runtime, model: eff.model };
  }

  const known = policy.runtimes?.[runtime]?.known_models ?? [];
  let model: string;
  if (declared.model && known.includes(declared.model)) {
    model = declared.model; // declared AND valid for this runtime → honoured as-is
  } else if (known.length > 0) {
    model = known[0]; // declared model absent or not in known_models → clamp to the runtime default
  } else {
    model = declared.model ?? eff.model; // runtime has no registered known_models → nothing to validate against
  }
  return { runtime, model };
};

/** Blockquote every line (empty lines become a bare `>`) — inert-data framing, mirrors `## Evidence`. */
function blockquote(text: string): string {
  return text
    .split('\n')
    .map((line) => (line.length ? `> ${line}` : '>'))
    .join('\n');
}

/** Compose the rerun card body: a `## Work order` pointer plus the steer text in `## Feedback`. */
export function buildRerunBody(origCardId: string, feedback: string): string {
  return [
    '## Work order',
    '',
    `Rerun of ${origCardId} (depends-on) — this card releases once ${origCardId} is \`done\`; its`,
    '`## Result` becomes this card\'s input.',
    '',
    '## Feedback',
    '',
    blockquote(feedback),
    '',
  ].join('\n');
}

/** Preamble-then-session gate shared by `launchCard` and `rerunAsDependsOn`. */
function gate(
  session: SessionInput,
  deps: LaunchDeps,
): { ok: true } | { ok: false; outcome: LaunchOutcome } {
  const preambleResult = assertFleetRunnable(deps.repoRoot, deps.runPreamble ?? defaultPreambleRunner);
  if (!preambleResult.ok) {
    return { ok: false, outcome: { ok: false, reason: 'fleet-frozen', problems: preambleResult.problems } };
  }
  if (!session.token) {
    return {
      ok: false,
      outcome: { ok: false, reason: 'unauthenticated', detail: 'no WebAuthn session token supplied' },
    };
  }
  const check = verifySession(session.token, session.config);
  if (!check.ok) {
    return { ok: false, outcome: { ok: false, reason: 'unauthenticated', detail: check.reason } };
  }
  return { ok: true };
}

/** Parse the one-line `{"id": ..., "path": ...}` JSON the CARD_OP_SCRIPT prints on success. */
function parseCardOpStdout(stdout: string): { id: string; path: string } {
  const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
  return JSON.parse(lastLine) as { id: string; path: string };
}

/**
 * File a brand-new card via the governed `scripts/cards.py` module path. `assertFleetRunnable()`
 * gates first; a missing/invalid WebAuthn session gates second. Neither gate spawns any subprocess.
 */
export function launchCard(spec: LaunchSpec, session: SessionInput, deps: LaunchDeps): LaunchOutcome {
  const gated = gate(session, deps);
  if (!gated.ok) return gated.outcome;

  // C7.7 — owner validation is THE boundary (the client `<select>` is honest-preview only). An absent /
  // empty owner leaves the byte-for-byte unowned path untouched; a present owner must clear the safety
  // guard AND be a member of the filesystem-enumerated closed set before any subprocess is spawned.
  let owner: string | undefined;
  let runtime: string | undefined;
  let model: string | undefined;
  if (spec.owner !== undefined && spec.owner !== '') {
    const candidate = spec.owner;
    if (!OWNER_RE.test(candidate)) {
      return { ok: false, reason: 'owner-not-registered', detail: `owner '${candidate}' is not a filename-safe agent id` };
    }
    const assignable = (deps.assignableOwners ?? readAssignableOwners)(deps.repoRoot);
    if (!assignable.has(candidate)) {
      return { ok: false, reason: 'owner-not-registered', detail: `owner '${candidate}' is not a declared agent or a registered default_worker` };
    }
    owner = candidate;
    try {
      const routing = (deps.ownerRouting ?? defaultOwnerRouting)(candidate, deps.repoRoot);
      runtime = routing.runtime;
      model = routing.model;
    } catch (err) {
      return { ok: false, reason: 'card-op-failed', detail: `could not resolve routing for owner '${candidate}': ${(err as Error).message}` };
    }
  }

  const runPy = deps.runPy ?? defaultPyRunner;
  const jsonArg = JSON.stringify({
    kind: 'new',
    project: spec.project,
    action: spec.action,
    target: spec.target,
    riskTier: spec.riskTier,
    body: spec.body ?? '',
    dependsOn: spec.dependsOn,
    owner,
    runtime,
    model,
  });
  const result = runPy(deps.repoRoot, CARD_OP_SCRIPT, jsonArg);
  if (result.exitCode !== 0) {
    return { ok: false, reason: 'card-op-failed', detail: result.stderr.trim() || result.stdout.trim() };
  }
  const { id, path } = parseCardOpStdout(result.stdout);
  return { ok: true, cardId: id, cardPath: path };
}

/**
 * File a follow-up card with `depends-on:[cardId]`, steer text in `## Feedback` (see the module
 * docstring's flagged deviation from the plan's literal "## Evidence" wording). Same preamble-then-
 * session gate as `launchCard`; same governed `scripts/cards.py` module path.
 */
export function rerunAsDependsOn(
  cardId: string,
  feedback: string,
  session: SessionInput,
  deps: LaunchDeps,
): LaunchOutcome {
  const gated = gate(session, deps);
  if (!gated.ok) return gated.outcome;

  const runPy = deps.runPy ?? defaultPyRunner;
  const jsonArg = JSON.stringify({
    kind: 'rerun',
    cardId,
    body: buildRerunBody(cardId, feedback),
  });
  const result = runPy(deps.repoRoot, CARD_OP_SCRIPT, jsonArg);
  if (result.exitCode !== 0) {
    return { ok: false, reason: 'card-op-failed', detail: result.stderr.trim() || result.stdout.trim() };
  }
  const { id, path } = parseCardOpStdout(result.stdout);
  return { ok: true, cardId: id, cardPath: path };
}

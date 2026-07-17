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

export type RiskTier = 'T1' | 'T2' | 'T3';

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
}

export type LaunchOutcome =
  | { ok: true; cardId: string; cardPath: string }
  | { ok: false; reason: 'fleet-frozen'; problems: string[] }
  | { ok: false; reason: 'unauthenticated'; detail: string }
  | { ok: false; reason: 'card-op-failed'; detail: string };

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

  const runPy = deps.runPy ?? defaultPyRunner;
  const jsonArg = JSON.stringify({
    kind: 'new',
    project: spec.project,
    action: spec.action,
    target: spec.target,
    riskTier: spec.riskTier,
    body: spec.body ?? '',
    dependsOn: spec.dependsOn,
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

/**
 * #2 Inbox — governed operator response to a card-projection item (input / wake-me / blocked / halted).
 *
 * Semantics flow STRICTLY through `scripts/cards.py` primitives (parse / claim / save / transition) shelled
 * as a MODULE via an injectable `PyRunner` — never hand-rolled YAML/frontmatter/state strings in TS. This
 * mirrors `write/launch.ts`: a fixed, non-interpolated Python payload (`CARD_RESPOND_SCRIPT`) reads one
 * JSON op from `sys.argv[1]` and prints `{"id","state","paths":[...]}` as its only stdout line. The op the
 * server hands it is the ALREADY-authorized plan (which body section to append to, the verbatim block, any
 * claim owner, the ordered legal transitions); the Python is a dumb executor over cards.py, so the schema
 * authority (`_validate`, `STATE_DIR`, `LEGAL`) stays in one place.
 *
 * The `## Feedback` / `## Result` distinction follows governance/card-schema.md: `## Feedback` is the inert
 * steer channel read by whoever picks the card back up (used for a reply / a blocked release); `## Result`
 * is worker/inspector output (used to record an operator resolution of a wake-me / halted card).
 */
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { defaultPyRunner } from './launch.ts';
import type { PyRunner } from './launch.ts';
import { HUMAN_INPUT_ACTION, WAKE_ACTION } from '../approvals/humanInbox.ts';

/** The `state` directories cards.py actually writes to (scripts/cards.py `STATE_DIR`): blocked cards live
 *  under `inbox/`, all three stop-ladder states (incl. terminal `halted`) under `working/`. There is no
 *  `queue/blocked` or `queue/halted` directory, so scanning these four covers every projected item. */
export const QUEUE_DIRS = ['inbox', 'working', 'approvals', 'done'] as const;

/** Resolve a filename-safe card id to its absolute path under `queue/`, or `null` if absent. The id is
 *  validated against the route's `CARD_ID_RE` (no separators / `..`) before this is called, so each join
 *  stays inside `queue/`. Mirrors `approvals/routes.ts#resolveCardPath`. */
export function resolveCardPath(repoRoot: string, cardId: string): string | null {
  for (const dir of QUEUE_DIRS) {
    const full = join(repoRoot, 'queue', dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) {
      if (name === `${cardId}.md`) return join(full, name);
    }
  }
  return null;
}

export type RespondVerb = 'reply' | 'resolve';

/** The authorized mutation plan for one operator response — computed server-side from the card's live
 *  (state, action), never trusted from the client. */
interface ResponsePlan {
  section: 'Feedback' | 'Result';
  /** The verbatim block appended into `section`: a marker line + the operator message. */
  block: string;
  /** Ordered legal cards.py transitions to walk after the append (empty = append only). */
  transitions: string[];
  /** Claim the card for this owner before transitioning, only if currently unowned. */
  claimOwner: string | null;
}

/** Marker prefixes — the exact strings the projection (humanInbox.ts) scans for to demote/hide items. */
const REPLY_MARKER = 'Reply from operator';
const RESOLVE_MARKER = 'Resolved by operator';

/**
 * Authorize the (state, action, verb) triple and return the mutation plan, or a legible refusal string.
 * Re-derived here from the card's real frontmatter (the client's category is never trusted).
 */
export function planResponse(
  state: string,
  action: string,
  verb: RespondVerb,
  message: string,
  iso: string,
): { ok: true; plan: ResponsePlan } | { ok: false; expected: string } {
  const replyBlock = `${REPLY_MARKER} (${iso}):\n${message}`;
  const resolveBlock = `${RESOLVE_MARKER} (${iso}):\n${message}`;

  if (verb === 'reply') {
    if (state === 'inbox' && HUMAN_INPUT_ACTION.test(action)) {
      // Inert steer text; the card stays queued for dispatch (no transition).
      return { ok: true, plan: { section: 'Feedback', block: replyBlock, transitions: [], claimOwner: null } };
    }
    return { ok: false, expected: "reply is only allowed for an input card (state 'inbox' with a needs-input/question/review action)" };
  }

  // verb === 'resolve'
  if (state === 'inbox' && WAKE_ACTION.test(action)) {
    // Record the resolution, claim if unowned, then walk the two legal steps inbox -> working -> done.
    return { ok: true, plan: { section: 'Result', block: resolveBlock, transitions: ['working', 'done'], claimOwner: 'human-operator' } };
  }
  if (state === 'blocked') {
    // Release the block back into the queue with operator guidance for pickup.
    return { ok: true, plan: { section: 'Feedback', block: replyBlock, transitions: ['inbox'], claimOwner: null } };
  }
  if (state === 'halted') {
    // halted is TERMINAL — record the resolution note only; the projection stops surfacing it.
    return { ok: true, plan: { section: 'Result', block: resolveBlock, transitions: [], claimOwner: null } };
  }
  return { ok: false, expected: "resolve is only allowed for a wake-me inbox card, a blocked card, or a halted card" };
}

/**
 * Fixed Python payload: parse the card, append the pre-composed block into the named section (creating it
 * if absent), optionally claim, then either walk the ordered transitions or save in place — all via
 * `scripts/cards.py`. Prints `{"id","state","paths":[...]}`. `paths` are the exact repo-relative POSIX
 * paths git must stage: a transition that MOVES the file yields both the deleted origin and the new path.
 */
export const CARD_RESPOND_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards

op = json.loads(sys.argv[1])
queue_root = Path("queue")

matches = list(queue_root.glob(f"**/{op['cardId']}.md"))
if not matches:
    print(f"card not found: {op['cardId']}", file=sys.stderr)
    raise SystemExit(1)
card = cards.parse(matches[0])
original = matches[0].as_posix()

def append_section(body, section, block):
    header = "## " + section
    lines = body.split("\\n")
    idx = None
    for i, ln in enumerate(lines):
        if ln.strip() == header:
            idx = i
            break
    if idx is None:
        base = body.rstrip("\\n")
        prefix = (base + "\\n\\n") if base else ""
        return prefix + header + "\\n\\n" + block + "\\n"
    end = len(lines)
    for j in range(idx + 1, len(lines)):
        if lines[j].startswith("## "):
            end = j
            break
    mid = lines[idx + 1:end]
    while mid and mid[-1].strip() == "":
        mid.pop()
    rebuilt = lines[:idx + 1] + mid + ["", block, ""] + lines[end:]
    return "\\n".join(rebuilt)

card.body = append_section(card.body, op["section"], op["block"])

if op.get("claimOwner") and not card.meta.get("owner"):
    cards.claim(card, op["claimOwner"])

transitions = op.get("transitions") or []
if transitions:
    final = original
    for target in transitions:
        final = cards.transition(card, target, queue_root).as_posix()
    paths = [original] if final == original else [original, final]
else:
    paths = [cards.save(card, queue_root).as_posix()]

print(json.dumps({"id": card.meta["id"], "state": card.meta["state"], "paths": paths}))
`.trim();

export interface RespondInput {
  cardId: string;
  /** The card's live state, parsed server-side from its committed frontmatter. */
  state: string;
  /** The card's live action, parsed server-side (input recheck — never the client's category). */
  action: string;
  verb: RespondVerb;
  /** The trimmed operator message (validated/redacted by the route before it reaches here). */
  message: string;
  /** Server-assigned ISO-8601 timestamp for the marker line. */
  iso: string;
}

export interface RespondDeps {
  repoRoot: string;
  runPy?: PyRunner;
  /** Reconcile `ops` (pull --rebase) after authorization but before the cards.py write. */
  prepareWrite?: (repoRoot: string) => void | Promise<void>;
}

export type RespondOutcome =
  | { ok: true; cardId: string; state: string; paths: string[] }
  | { ok: false; reason: 'not-allowed'; detail: string }
  | { ok: false; reason: 'card-op-failed'; detail: string };

/** Parse the one-line `{"id","state","paths"}` JSON the CARD_RESPOND_SCRIPT prints on success. */
function parseStdout(stdout: string): { id: string; state: string; paths: string[] } {
  const lastLine = stdout.trim().split('\n').filter(Boolean).pop() ?? '';
  return JSON.parse(lastLine) as { id: string; state: string; paths: string[] };
}

/**
 * An already-authorized card mutation plan, decoupled from the (state, action, verb) authorization that
 * produced it. `respondToCard` derives one from `planResponse`; the merge-gate reconciler builds its own
 * (`section: 'Result'`, `transitions: ['working','done']`, `claimOwner: 'human-operator'`) so both mutate
 * cards through the SAME cards.py executor and never hand-roll a frontmatter/state write.
 */
export interface CardMutationOp {
  cardId: string;
  section: 'Feedback' | 'Result';
  block: string;
  transitions: string[];
  claimOwner: string | null;
}

/** A card-op failure that {@link respondToCard} maps to its `card-op-failed` outcome. Thrown (rather than
 *  returned) so {@link executeCardMutation} can hand back the plain success shape the reconciler wants,
 *  while a JSON-parse fault stays an uncaught throw exactly as before. */
export class CardOpError extends Error {}

/**
 * The shared cards.py executor: reconcile ops (prepareWrite), run the fixed CARD_RESPOND_SCRIPT payload
 * for `op`, and parse its `{id,state,paths}`. Throws {@link CardOpError} on a prepare failure or a
 * non-zero cards.py exit (mirrors the strings respondToCard returned before this extraction); a malformed
 * stdout still throws the raw JSON parse error. Does NOT authorize — the caller owns that.
 */
export async function executeCardMutation(op: CardMutationOp, deps: RespondDeps): Promise<{ id: string; state: string; paths: string[] }> {
  try {
    await deps.prepareWrite?.(deps.repoRoot);
  } catch (err) {
    throw new CardOpError(`could not prepare coordination write: ${(err as Error).message}`);
  }

  const runPy = deps.runPy ?? defaultPyRunner;
  const jsonArg = JSON.stringify({
    cardId: op.cardId,
    section: op.section,
    block: op.block,
    transitions: op.transitions,
    claimOwner: op.claimOwner,
  });
  const result = runPy(deps.repoRoot, CARD_RESPOND_SCRIPT, jsonArg);
  if (result.exitCode !== 0) {
    throw new CardOpError(result.stderr.trim() || result.stdout.trim());
  }
  return parseStdout(result.stdout);
}

/**
 * Execute an authorized operator response through cards.py. Authorization (the state/action/verb matrix)
 * happens first; a mismatch returns `not-allowed` (the route maps it to 409) BEFORE any pull or subprocess.
 */
export async function respondToCard(input: RespondInput, deps: RespondDeps): Promise<RespondOutcome> {
  const planned = planResponse(input.state, input.action, input.verb, input.message, input.iso);
  if (!planned.ok) {
    return { ok: false, reason: 'not-allowed', detail: `cannot ${input.verb} a card in state '${input.state}': ${planned.expected}` };
  }

  try {
    const { id, state, paths } = await executeCardMutation(
      {
        cardId: input.cardId,
        section: planned.plan.section,
        block: planned.plan.block,
        transitions: planned.plan.transitions,
        claimOwner: planned.plan.claimOwner,
      },
      deps,
    );
    return { ok: true, cardId: id, state, paths };
  } catch (err) {
    if (err instanceof CardOpError) {
      return { ok: false, reason: 'card-op-failed', detail: err.message };
    }
    throw err;
  }
}

#!/usr/bin/env node
/*
 * kb hook I/O — the stdin/stdout boilerplate every kb hook repeats, extracted once.
 *
 * WHY THIS FILE EXISTS.
 *   Seven consumers share this file: four hooks (regrounding, the three context-lifecycle hooks) each
 *   carried a byte-identical ~30-line block — read fd 0, fail open on a closed pipe, JSON.parse inside
 *   a try, bail on a foreign event name, write the answer with fs.writeSync(1), exit 0 — and two
 *   reviews called that duplication out; U9's three-hook spawn/model-verify family was then written
 *   directly against this file instead of repeating the block a fifth, sixth, and seventh time. The
 *   block is small but it is the part that MUST be identical everywhere — a hook that fails closed,
 *   throws, or truncates its stdout breaks the session it is attached to. One copy is one thing to get
 *   right and one thing to test.
 *
 * WHAT THIS FILE IS DELIBERATELY NOT FOR — the four governance hooks.
 *   `block_no_verify.js`, `hard_ceiling_guard.js`, `config_protection.js`, and `delivery_gate.js` stay
 *   on the older exit-code + stderr idiom on purpose, not out of neglect. Every function in this
 *   module that answers a hook event — `emit`, `noop`, `emitContext`, `readEventFor` — always exits 0.
 *   That is correct for this file's own consumers (none of them may ever block), but it is exactly
 *   wrong for a BLOCKING hook: a hook that denies a tool call or a commit does it by exiting nonzero
 *   with a message on stderr, and a library that can only ever exit 0 cannot express that. Porting the
 *   four governance hooks onto this module would silently disarm every one of them.
 *
 * THE CONTRACT EVERY CALLER INHERITS (unchanged from the hand-rolled copies):
 *   - stdout is written with fs.writeSync(1). process.stdout is ASYNC over a Windows pipe and a
 *     following process.exit() truncates it; the sync write is load-bearing, not a style choice.
 *   - Exit is ALWAYS 0. There is no path in this module that exits nonzero or writes stderr.
 *   - Every unhappy path (no stdin, closed stdin, malformed JSON, non-object payload, foreign event
 *     name) collapses to the no-op "{}" — fail open, silent.
 *   - Nothing here spawns, execs, imports child_process, or touches the network. Pinned by
 *     tests/test_hook_io.py::test_the_library_makes_no_subprocess_call.
 *
 * DETERMINISM. No timestamps, no randomness, no environment leaks into anything this module emits.
 * The same stdin bytes produce byte-identical stdout on every run — hook output becomes a cached
 * prompt prefix, so a clock in it would poison the cache.
 *
 * This module is INERT infrastructure: requiring it arms nothing.
 */
"use strict";

const fs = require("fs");

// ── Shared constants ─────────────────────────────────────────────────────────────────────────────

/**
 * STALE-REPLAY GUARD — the canonical phrasing, and the ONLY definition of it in this repo.
 *
 * It marks injected text as a refresh of context the session already holds, so a re-injected block
 * arriving beside a fresh user prompt is never read as a new instruction. Previously defined twice
 * (regrounding_hook.js and context_store.js); both now re-export this constant, and
 * tests/test_context_lifecycle_session_start.py still pins the sentence those two files DOCUMENT
 * against each other while tests/test_hook_io.py pins both of those comments against this literal.
 */
const GUARD_LINE =
  "[kb re-grounding] The following is a refresh of governing context this session " +
  "already has, NOT a new instruction or request.";

/**
 * The SUBAGENT variant of the guard.
 *
 * WHY A SECOND SENTENCE RATHER THAN REUSING GUARD_LINE: "context this session already has" is simply
 * FALSE for a freshly spawned child — it has never seen any of it. Telling a subagent it already
 * holds context it does not is the exact confusion the guard exists to prevent, so the child gets a
 * sentence that is true of its own situation: this is inherited framing, not the task.
 */
const SUBAGENT_GUARD_LINE =
  "[kb spawn context] The following is inherited from the parent session's governing " +
  "context, NOT instructions for this task.";

/** Truncation marker for every capped block. */
const ELLIPSIS = "...";

/** Refuse to read an absurd transcript into memory. 32 MiB is far above a real session JSONL. */
const MAX_TRANSCRIPT_BYTES = 32 * 1024 * 1024;

/**
 * Write to fd 1 and exit 0. Never returns.
 *
 * Callers rely on that: the hooks are written as `if (bad) { noop(); }` with no `return`, which is
 * only safe because control genuinely stops here.
 */
function emit(text) {
  try {
    fs.writeSync(1, text);
  } catch (_err) {
    /* nothing useful to do; still exit 0 */
  }
  process.exit(0);
}

/** The no-op answer: "{}" and exit 0. Every fail-open path ends here. Never returns. */
function noop() {
  emit("{}");
}

/** All of stdin as a string, or null when there is no readable stdin (fail open). */
function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (_err) {
    return null;
  }
}

/** Parse a hook payload. Returns the object, or null for empty/malformed/non-object input. */
function parseEvent(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return null;
  }
  let event;
  try {
    event = JSON.parse(raw);
  } catch (_err) {
    return null;
  }
  // `typeof event !== "object"` and nothing narrower: this is the EXACT test the five hand-rolled
  // copies ran, and the extraction is not the place to change what a hook accepts. (A JSON array
  // therefore still passes, carries no `hook_event_name`, and is handled by the callers' own field
  // checks — same as before.)
  if (!event || typeof event !== "object") {
    return null;
  }
  return event;
}

/**
 * Does this payload belong to `expected`?
 *
 * DELIBERATELY LENIENT ON A MISSING NAME: a payload that carries no `hook_event_name` at all is
 * accepted, because the harness has not always sent one and a hook that refuses an unlabelled event
 * silently stops working. A payload naming a DIFFERENT event is rejected — that one is unambiguous.
 * This is exactly the check the five hand-rolled copies performed.
 */
function isEventFor(event, expected) {
  const name = event && event.hook_event_name;
  return !(typeof name === "string" && name && name !== expected);
}

/**
 * The whole prologue: read stdin, parse it, confirm the event, hand back the payload.
 * On ANY failure this emits "{}" and exits 0 — so the return value is always a usable object.
 */
function readEventFor(expected) {
  const event = parseEvent(readStdin());
  if (!event || !isEventFor(event, expected)) {
    noop(); // never returns
  }
  return event;
}

/** Emit the structured context answer: {"hookSpecificOutput":{"hookEventName":…,"additionalContext":…}}. */
function emitContext(hookEventName, additionalContext) {
  emit(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: hookEventName,
        additionalContext: additionalContext,
      },
    })
  );
}

/**
 * Cap a block of text, marking it with {@link ELLIPSIS} when it was cut.
 *
 * A DEGENERATE limit genuinely clips everything, including any guard sentence the caller prepended.
 * That is the operator's choice to make, not a silent floor to impose — a hook that quietly ignores
 * the cap it was given is worse than one that injects a short block.
 */
function truncateTo(text, limit) {
  if (limit <= 0) return "";
  if (text.length <= limit) return text;
  if (limit <= ELLIPSIS.length) return text.slice(0, limit);
  return text.slice(0, limit - ELLIPSIS.length) + ELLIPSIS;
}

/**
 * Read a transcript-sized file, refusing anything over `maxBytes`.
 * Returns the text, or null for missing / unreadable / oversized — callers fail open on null.
 */
function readCappedFile(file, maxBytes) {
  const limit = typeof maxBytes === "number" && maxBytes > 0 ? maxBytes : MAX_TRANSCRIPT_BYTES;
  try {
    if (fs.statSync(file).size > limit) {
      return null;
    }
    return fs.readFileSync(file, "utf8");
  } catch (_err) {
    return null;
  }
}

/**
 * Belt-and-braces wrapper: run a hook's main and turn ANY escaped throw into the no-op answer.
 * A hook must never break the session it is attached to, whatever it got fed.
 */
function run(main) {
  try {
    main();
  } catch (_err) {
    noop();
  }
}

module.exports = {
  ELLIPSIS,
  GUARD_LINE,
  MAX_TRANSCRIPT_BYTES,
  SUBAGENT_GUARD_LINE,
  emit,
  emitContext,
  isEventFor,
  noop,
  parseEvent,
  readCappedFile,
  readEventFor,
  readStdin,
  run,
  truncateTo,
};

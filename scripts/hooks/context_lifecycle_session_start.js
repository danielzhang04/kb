#!/usr/bin/env node
/*
 * kb context-lifecycle SessionStart hook — INERT (not wired into any settings file).
 *
 * Provenance:
 *   pattern: ecc@2.0.0 session-start context injection + STALE-REPLAY GUARD (concept, not code)
 *   provenance-tier: pattern
 *
 * Purpose:
 *   A compaction or a session restart throws away what the session had just worked out. The
 *   PreCompact sibling (context_lifecycle_pre_compact.js) writes a deterministic summary of the last
 *   turns into the session's context store; this hook reads it back at the next SessionStart and
 *   hands it to the model as additionalContext — behind the same stale-replay guard sentence
 *   regrounding_hook.js uses, so a resumed summary is never read as a fresh instruction.
 *
 * Status:
 *   INERT. Nothing in .claude/settings*.json references this file. The exact settings snippet that
 *   WOULD arm it — together with the decision-notes on reclaim scope, store location and retention —
 *   lives in docs/proposals/context-lifecycle-hooks.md.
 *
 * Contract:
 *   - Reads env: KB_CONTEXT_STORE_DIR (store root), KB_SESSION_START_MAX_CHARS (cap, default 4000).
 *   - Reads stdin JSON ({hook_event_name, session_id, ...}).
 *   - Emits to stdout, always exit 0, stderr always empty:
 *       {"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"<block>"}}
 *     or "{}" when there is nothing to resume.
 *   - Fail open + silent on EVERY unhappy path (no stdin, malformed stdin, no session id, missing
 *     store, empty summary, any thrown error) -> "{}", exit 0.
 *   - Reads only. It never writes the store; the PreCompact and PostToolUse siblings do.
 */
"use strict";

const fs = require("fs");
const store = require("./lib/context_store.js");

/** Hard cap on the emitted additionalContext, in characters. Resumed summaries are bounded by the
 *  turn count PreCompact keeps, but a pathological store must never blow up a session's first turn. */
const DEFAULT_MAX_CHARS = 4000;

const ELLIPSIS = "...";

function maxChars() {
  const parsed = Number(process.env.KB_SESSION_START_MAX_CHARS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_CHARS;
}

/** Write synchronously to fd 1: stdout is async over a Windows pipe and process.exit() can truncate it. */
function emit(text) {
  try {
    fs.writeSync(1, text);
  } catch (_err) {
    /* nothing useful to do; still exit 0 */
  }
  process.exit(0);
}

function noop() {
  emit("{}");
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (_err) {
    return null;
  }
}

function truncateTo(text, limit) {
  if (limit <= 0) return "";
  if (text.length <= limit) return text;
  if (limit <= ELLIPSIS.length) return text.slice(0, limit);
  return text.slice(0, limit - ELLIPSIS.length) + ELLIPSIS;
}

function main() {
  const raw = readStdin();
  if (raw === null || !raw.trim()) {
    noop();
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch (_err) {
    noop(); // malformed stdin -> fail open
  }
  if (!event || typeof event !== "object") {
    noop();
  }

  // If the harness names a different event, this hook has nothing to say.
  const eventName = event.hook_event_name;
  if (typeof eventName === "string" && eventName && eventName !== "SessionStart") {
    noop();
  }

  const sessionId = event.session_id;
  if (typeof sessionId !== "string" || !sessionId) {
    noop();
  }

  const sections = store.readStore(sessionId);
  const summary = store.sectionBody(sections, store.HEADINGS.RESUMED_SUMMARY);
  if (!summary) {
    noop(); // no store, or nothing summarised yet -> nothing worth injecting
  }

  // The guard sentence FIRST, then the summary: the framing has to be read before the content it
  // frames.
  //
  // The cap is applied to the whole block, so a DEGENERATE cap does clip the guard itself: the guard
  // is ~125 chars, and KB_SESSION_START_MAX_CHARS below roughly that truncates the framing sentence
  // (and below ~125 leaves no summary at all). That is the operator's choice to make, not a silent
  // floor to impose — a hook that quietly ignores the cap it was given is worse than one that
  // injects a short block. The default (4000) is an order of magnitude above the guard, so this only
  // bites on a deliberately tiny value. Pinned by test_cap_bounds_the_injected_block.
  const block = truncateTo(store.GUARD_LINE + "\n\n" + summary, maxChars());

  emit(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: block,
      },
    })
  );
}

try {
  main();
} catch (_err) {
  // Belt and braces: this hook never breaks a session start.
  noop();
}

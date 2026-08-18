#!/usr/bin/env node
/*
 * kb spawn context-load SubagentStart hook — INERT (not wired into any settings file).
 *
 * Purpose:
 *   A spawned subagent starts blind. It gets the dispatch prompt and nothing else — not the north
 *   star, not the invariants, not which gate the run is sitting on. Every brief therefore re-states
 *   the frame by hand, and a brief that forgets to is a subagent working against the wrong picture.
 *   This hook hands the child the SAME governing context the parent session is holding, read out of
 *   the U8 context store, behind a subagent-specific inheritance guard.
 *
 * Status:
 *   INERT. Nothing in .claude/settings*.json references this file. The settings snippet that WOULD
 *   arm it, the arm-time preconditions, and the decision-notes live in
 *   docs/proposals/spawn-model-verify-hooks.md.
 *
 * ── THE OUTPUT SHAPE IS VERIFIED, NOT ASSUMED ───────────────────────────────────────────────────
 * Two doc sources disagreed on what a SubagentStart hook must emit. The question was settled
 * EMPIRICALLY against the installed harness (Claude Code 2.1.234, C:\Users\danie\.local\bin\claude.exe),
 * whose embedded output schema and consumer are unambiguous:
 *
 *   ye({hookEventName:Ct("SubagentStart"),additionalContext:F().optional()})     // z.object/literal/string
 *   case"SubagentStart":u.additionalContext=e.hookSpecificOutput.additionalContext;break;
 *
 * So: `additionalContext`, nested under `hookSpecificOutput`. No top-level `additionalContext` and no
 * `context` field appears anywhere near the SubagentStart handling. Full evidence in the proposal.
 *
 * ── WHICH SESSION'S STORE (also verified) ───────────────────────────────────────────────────────
 * The payload's `session_id` is the PARENT session's id, not a fresh child id — a subagent shares the
 * parent's Session object, and the harness builds the hook input as `session_id: e.session.id`. The
 * child is distinguished by the separate `agent_id` / `agent_type` fields, and the harness's own
 * schema says so: "Use this field (not agent_type) to distinguish subagent calls from main-thread
 * calls." That is exactly the store this hook wants — the parent's working context is what the child
 * is missing — so reading by `session_id` is correct rather than merely convenient.
 *
 * ── WHAT IT INJECTS, AND WHAT IT DELIBERATELY DOES NOT ──────────────────────────────────────────
 * Only the three GOVERNING sections: '## North star', '## Invariants', '## Current gate'.
 * '## Recent activity' (the redacted tool ring buffer) and '## Resumed-session summary' (the
 * parent's compaction recall) are NOT injected. A subagent prompt is a wider blast radius than the
 * parent's own store: the activity trail is redacted best-effort, not provably clean, and a summary
 * of the parent's last turns is noise to a child with a specific brief. Governing frame, nothing else.
 *
 * Contract:
 *   - Reads env: KB_CONTEXT_STORE_DIR (store root), KB_SUBAGENT_CONTEXT_MAX_CHARS (cap, default 2000).
 *   - Reads stdin JSON ({hook_event_name, session_id, agent_id, agent_type, ...}).
 *   - Emits to stdout, always exit 0, stderr always empty:
 *       {"hookSpecificOutput":{"hookEventName":"SubagentStart","additionalContext":"<block>"}}
 *     or "{}" when there is nothing to inject. The block opens with io.SUBAGENT_GUARD_LINE, NOT the
 *     session guard — see the note at the emission site.
 *   - Fail open + silent on EVERY unhappy path (no stdin, malformed stdin, no session id, missing
 *     store, no governing sections, any thrown error) -> "{}", exit 0.
 *   - READS ONLY. It never writes the store and never spawns anything.
 *
 * Determinism: no timestamps, no randomness. The same store bytes produce byte-identical stdout.
 */
"use strict";

const io = require("./lib/hook_io.js");
const store = require("./lib/context_store.js");

/** The governing sections a spawned subagent inherits, in this fixed emission order. */
const INHERITED_HEADINGS = [
  store.HEADINGS.NORTH_STAR,
  store.HEADINGS.INVARIANTS,
  store.HEADINGS.CURRENT_GATE,
];

/** Hard cap on the injected block, in characters. Tighter than SessionStart's 4000 on purpose: this
 *  is a frame for a focused child, not a session resume, and it is prepended to every single spawn. */
const DEFAULT_MAX_CHARS = 2000;

/** Capping lives in lib/hook_io.js — one copy shared by the three hooks that inject context. */
const truncateTo = io.truncateTo;

function maxChars() {
  const parsed = Number(process.env.KB_SUBAGENT_CONTEXT_MAX_CHARS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_CHARS;
}

function main() {
  // Empty/closed stdin, malformed JSON, or a payload naming a different event all fail open
  // ("{}", exit 0) inside this call.
  const event = io.readEventFor("SubagentStart");

  // The PARENT session's id (verified — see the header). An unsafe id never reaches the filesystem:
  // context_store.sessionPath() rejects anything outside its id charset.
  const sessionId = event.session_id;
  if (typeof sessionId !== "string" || !sessionId) {
    io.noop();
  }

  const sections = store.readStore(sessionId);
  const parts = [];
  for (const heading of INHERITED_HEADINGS) {
    const body = store.sectionBody(sections, heading);
    if (body) {
      parts.push(heading + ": " + body);
    }
  }
  if (parts.length === 0) {
    io.noop(); // no store, or nothing governing in it -> inject nothing rather than something empty
  }

  // The guard sentence FIRST: the framing has to be read before the content it frames.
  //
  // A SUBAGENT-SPECIFIC VARIANT, not the session guard. The re-grounding phrasing — "context this
  // session already has" — is simply FALSE for a freshly spawned child, which has never seen any of
  // it. Telling a subagent it already holds context it does not is the exact confusion a guard exists
  // to prevent, so it gets a sentence true of its own situation: inherited framing, not the task.
  const block = truncateTo(io.SUBAGENT_GUARD_LINE + "\n\n" + parts.join("\n\n"), maxChars());

  io.emitContext("SubagentStart", block);
}

// Belt and braces: this hook never breaks a spawn — any escaped throw becomes "{}".
io.run(main);

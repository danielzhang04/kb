#!/usr/bin/env node
/*
 * kb context-lifecycle PostToolUse activity tracker — INERT (not wired into any settings file).
 *
 * Provenance:
 *   source: ecc@2.0.0/scripts/hooks/session-activity-tracker.js (redaction table + 220-char cap,
 *           ported into scripts/hooks/lib/context_store.js)
 *   provenance-tier: imported (redaction) + pattern (ring buffer)
 *
 * Purpose:
 *   Keep a short, redacted trail of what the session has actually been doing, in the SAME store the
 *   SessionStart hook reads. One line per tool call, last 20 kept.
 *
 * Dropped from ECC (intentionally NOT ported): the JSONL metrics sink, the crypto row ids and
 * timestamps, the git-diff enrichment (which shells out to `git` on every single tool call), and the
 * deep tool_input walk. This wrapper records tool name + one summarised phrase and nothing else —
 * the less tool input it reads, the less there is to leak.
 *
 * Contract:
 *   - Reads env: KB_CONTEXT_STORE_DIR (store root).
 *   - Reads stdin JSON ({hook_event_name, session_id, tool_name, tool_input, ...}).
 *   - ALWAYS emits "{}" and exits 0; the value is the write side effect.
 *   - Missing session id / tool name / unwritable store: no-op. Never throws, never writes stderr.
 */
"use strict";

const fs = require("fs");
const store = require("./lib/context_store.js");

/** Only these tool_input keys are ever read — a bounded, low-secret-density set. */
const DETAIL_KEYS = ["file_path", "path", "pattern", "command", "description", "query"];

function emitNoop() {
  try {
    fs.writeSync(1, "{}");
  } catch (_err) {
    /* nothing useful to do; still exit 0 */
  }
  process.exit(0);
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (_err) {
    return null;
  }
}

/** `<Tool> <one detail>` — the detail is redacted downstream by store.appendActivity. */
function describe(toolName, toolInput) {
  if (!toolInput || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return toolName;
  }
  for (const key of DETAIL_KEYS) {
    const value = toolInput[key];
    if (typeof value === "string" && value.trim()) {
      return toolName + " " + value.trim();
    }
  }
  return toolName;
}

function main() {
  const raw = readStdin();
  if (raw === null || !raw.trim()) {
    emitNoop();
  }

  let event;
  try {
    event = JSON.parse(raw);
  } catch (_err) {
    emitNoop();
  }
  if (!event || typeof event !== "object") {
    emitNoop();
  }

  const eventName = event.hook_event_name;
  if (typeof eventName === "string" && eventName && eventName !== "PostToolUse") {
    emitNoop();
  }

  const sessionId = event.session_id;
  const toolName = typeof event.tool_name === "string" ? event.tool_name.trim() : "";
  if (typeof sessionId !== "string" || !sessionId || !toolName) {
    emitNoop();
  }

  store.appendActivity(sessionId, describe(toolName, event.tool_input));
  emitNoop();
}

try {
  main();
} catch (_err) {
  // Belt and braces: this hook never breaks a tool call.
  emitNoop();
}

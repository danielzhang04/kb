#!/usr/bin/env node
/*
 * kb model-verify PreToolUse-on-Agent hook — INERT (not wired into any settings file).
 *
 * Purpose:
 *   Record which model every dispatched subagent was ASKED for, at the moment of the ask.
 *   BOSS.md requires that model to be verified at grading time by grepping the subagent transcript —
 *   "an ungrepped grade is invalid" — but the requested half of that comparison lives only in a
 *   dispatch call that nothing writes down. This hook writes it down. Its SubagentStop sibling
 *   records what the transcript actually shows, and the two rows make the comparison mechanical.
 *
 * Status:
 *   INERT. Nothing in .claude/settings*.json references this file. Arming snippet (including the
 *   `"matcher": "Agent|Task"` this hook needs) and decision-notes:
 *   docs/proposals/spawn-model-verify-hooks.md.
 *
 * ── THE TOOL IS CALLED "Agent". "Task" IS ONLY AN ALIAS. ────────────────────────────────────────
 * Verified against the installed harness (Claude Code 2.1.234): the bundle declares
 * `var di="Agent",Dj="Task"` and registers the tool as
 * `{…, name:di, searchHint:"delegate work to a subagent", aliases:[Dj], …}` — so `Agent` is the
 * canonical name and `Task` is a compatibility alias. Real transcripts agree: across this machine's
 * session JSONLs every dispatch `tool_use` block is named `"Agent"` and none is named `"Task"`.
 * A hook watching only `Task` would therefore have recorded NOTHING, forever, while looking healthy.
 * Both names are accepted here, and the settings matcher is a regex covering both.
 *
 * REPORT-ONLY, ALWAYS. This hook has no opinion the harness can act on: it emits a bare "{}" and
 * exits 0 on every path, including the path where the requested model is not in the routing policy.
 * PreToolUse is the event that CAN deny a tool call, which is exactly why this one never does — see
 * the rationale in lib/model_audit.js. Its entire value is the append side effect.
 *
 * Contract:
 *   - Reads env: KB_MODEL_AUDIT_PATH (log path), KB_MODEL_ROUTING_PATH / KB_ROOT (policy path),
 *     KB_CONTEXT_STORE_DIR (default log root).
 *   - Reads stdin JSON ({hook_event_name, session_id, tool_name, tool_input, ...}).
 *   - Reads governance/model-routing.yaml READ-ONLY. It never writes anything under governance/.
 *   - ALWAYS emits "{}" and exits 0, stderr always empty. Non-dispatch tools, missing tool_input,
 *     unreadable policy, unwritable log, any thrown error: no-op.
 *   - No subprocess, no network, no clock (see the no-timestamp note in lib/model_audit.js).
 *
 * The input fields read here — `subagent_type`, `model`, `description` — are the live Agent-tool
 * schema, confirmed against real `tool_use` blocks in this machine's transcripts. `model` is optional
 * (omitted means "inherit / let routing decide", which this hook records as the `unspecified` verdict
 * rather than as a fault).
 */
"use strict";

const io = require("./lib/hook_io.js");
const audit = require("./lib/model_audit.js");

/**
 * The tool names this hook watches. `Agent` is the canonical name; `Task` is the registered alias
 * (see the header). Both are accepted so the hook cannot be silently defeated by whichever spelling
 * the harness reports.
 */
const WATCHED_TOOLS = new Set(["Agent", "Task"]);

/** Keep a free-text field from turning the log into a transcript. */
const MAX_FIELD_CHARS = 200;

function short(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return io.truncateTo(trimmed, MAX_FIELD_CHARS);
}

function main() {
  // Empty/closed stdin, malformed JSON, or a payload naming a different event all no-op inside this
  // call ("{}", exit 0).
  const event = io.readEventFor("PreToolUse");

  // A `"matcher": "Agent|Task"` in settings should mean this hook only ever sees dispatch calls, but
  // the matcher is settings the operator writes and this check costs nothing.
  const toolName = typeof event.tool_name === "string" ? event.tool_name.trim() : "";
  if (!WATCHED_TOOLS.has(toolName)) {
    io.noop();
  }

  const input = event.tool_input;
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    io.noop();
  }

  const requested = short(input.model);
  const row = {
    event: "PreToolUse",
    // The name as the harness reported it, not a normalised one: if a future version stops sending
    // `Agent`, the log shows that rather than hiding it behind a constant.
    tool: toolName,
    session_id: short(event.session_id),
    // Present only when a subagent is itself dispatching — the harness's own schema names agent_id
    // (not agent_type) as the way to tell a subagent call from a main-thread one.
    agent_id: short(event.agent_id),
    subagent_type: short(input.subagent_type),
    description: short(input.description),
    requested_model: requested,
    verdict: audit.verdictFor(requested, audit.allowedModels()),
  };

  audit.appendRow(row);
  io.noop();
}

// Belt and braces: this hook never breaks a dispatch — any escaped throw becomes "{}".
io.run(main);

#!/usr/bin/env node
/*
 * kb context-lifecycle PreCompact hook — INERT (not wired into any settings file).
 *
 * Provenance:
 *   pattern: ecc@2.0.0 pre-compact write-side-effect (concept, not code)
 *   provenance-tier: pattern
 *
 * Purpose:
 *   Compaction is the moment a session's recent working state is about to be thrown away. This hook
 *   runs first and writes a summary of the last turns into that session's context store, so the
 *   SessionStart sibling can hand it back on resume.
 *
 * THE DELIBERATE DIVERGENCE FROM ECC (the reason this file exists at all):
 *   ECC's equivalent shells out to `claude -p` to have a model write the summary. That is hidden,
 *   unbudgeted, per-compaction spend on a path nobody is watching — a hook that quietly bills is
 *   exactly the thing kb's budget guard exists to prevent. This hook extracts DETERMINISTICALLY
 *   instead: last N turns, role + first text or tool name, redacted and capped. No LLM call, no
 *   subprocess, no network, zero spend, byte-identical output for identical input.
 *   tests/test_context_lifecycle_pre_compact.py asserts this source contains no spawn/exec at all.
 *
 * Status:
 *   INERT. Nothing in .claude/settings*.json references this file. Arming snippet + decision-notes:
 *   docs/proposals/context-lifecycle-hooks.md.
 *
 * Contract:
 *   - Reads env: KB_CONTEXT_STORE_DIR (store root), KB_PRECOMPACT_TURNS (default 12).
 *   - Reads stdin JSON ({hook_event_name, session_id, transcript_path, trigger, ...}).
 *   - ALWAYS emits "{}" and exits 0 — PreCompact takes no structured output from us; the value of
 *     this hook is entirely its write side effect.
 *   - Missing/unreadable transcript, missing session id, unparseable lines, unwritable store: no-op.
 *   - Never throws, never blocks a compaction, never writes stderr.
 */
"use strict";

const io = require("./lib/hook_io.js");
const store = require("./lib/context_store.js");

// Shared stdin/stdout/fail-open boilerplate — see lib/hook_io.js. Same contract as before:
// fs.writeSync(1), always exit 0, never stderr. That library makes no subprocess call either, which
// is what keeps the zero-spend guarantee below true through the extraction.
const emitNoop = io.noop;

/** How many trailing transcript turns the summary keeps. */
const DEFAULT_TURNS = 12;

/** Per-turn line cap. Short on purpose: this is a recall cue, not a transcript replay. */
const TURN_MAX_CHARS = 200;

function turnCount() {
  const parsed = Number(process.env.KB_PRECOMPACT_TURNS);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_TURNS;
}

/** Flatten one transcript record's content into a single readable phrase, or null when it carries none. */
function describeContent(content) {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return null;
  }
  const parts = [];
  for (const item of content) {
    if (!item || typeof item !== "object") continue;
    if (item.type === "text" && typeof item.text === "string" && item.text.trim()) {
      parts.push(item.text.trim());
    } else if (item.type === "tool_use" && typeof item.name === "string") {
      // Tool INPUT is deliberately not read: it is the highest-density source of secrets and paths,
      // and the tool name alone is the recall cue this summary needs.
      parts.push("[tool: " + item.name + "]");
    } else if (item.type === "tool_result") {
      parts.push("[tool result]");
    }
  }
  return parts.length ? parts.join(" ") : null;
}

/** One `- <role>: <phrase>` line per turn, redacted and capped by the shared store summarizer. */
function summariseTranscript(text, turns) {
  const rendered = [];
  for (const record of io.parseJsonLines(text)) {
    if (!record || typeof record !== "object") continue;
    const role = record.type === "user" ? "user" : record.type === "assistant" ? "assistant" : null;
    if (!role) continue;
    const message = record.message;
    const phrase = describeContent(message && typeof message === "object" ? message.content : undefined);
    if (!phrase) continue;
    const summarized = store.summarize(phrase, TURN_MAX_CHARS);
    if (summarized) {
      rendered.push("- " + role + ": " + summarized);
    }
  }
  return rendered.slice(-turns).join("\n");
}

function main() {
  // Empty/closed stdin, malformed JSON, or a payload naming a different event all no-op inside this
  // call ("{}", exit 0).
  const event = io.readEventFor("PreCompact");

  const sessionId = event.session_id;
  const transcriptPath = event.transcript_path;
  if (typeof sessionId !== "string" || !sessionId) {
    emitNoop();
  }
  if (typeof transcriptPath !== "string" || !transcriptPath) {
    emitNoop();
  }

  // Missing, unreadable, or absurdly large transcript -> null -> no-op. The size cap
  // (io.MAX_TRANSCRIPT_BYTES) and the guarded read live in lib/hook_io.js, shared with the
  // SubagentStop model-verify hook.
  const text = io.readCappedFile(transcriptPath);
  if (text === null) {
    emitNoop();
  }

  const summary = summariseTranscript(text, turnCount());
  if (!summary) {
    emitNoop(); // nothing extractable -> leave whatever the store already holds untouched
  }

  const sections = store.readStore(sessionId);
  store.writeStore(sessionId, store.upsertSection(sections, store.HEADINGS.RESUMED_SUMMARY, summary));
  emitNoop();
}

// Belt and braces: this hook never blocks a compaction — any escaped throw becomes "{}".
io.run(main);

#!/usr/bin/env node
/*
 * kb re-grounding hook — INERT (not wired into any settings file).
 *
 * Provenance:
 *   pattern: ecc@2.0.0 session-start STALE-REPLAY GUARD (concept, not code)
 *   provenance-tier: pattern
 *
 * Purpose:
 *   Re-inject the governing "north star" context a long-running session already had
 *   at startup but has drifted from (or compacted away), as structured
 *   additionalContext after compaction and at a bounded cadence during a session.
 *
 * Status:
 *   INERT. Nothing in .claude/settings*.json references this file. The exact
 *   settings snippet that WOULD arm it lives in the "Implemented design" section of
 *   docs/proposals/regrounding-hook.md.
 *
 * Contract:
 *   - Reads env: KB_GOAL_STATE_PATH (default:
 *     <KB_ROOT or repo root resolved from this script>/docs/plans/
 *     2026-08-18-agent-platform-GOAL-STATE.md), KB_ROOT,
 *     KB_REGROUND_STATE_DIR, KB_REGROUND_EVERY_CALLS, and
 *     KB_REGROUND_EVERY_MINUTES.
 *   - Reads stdin JSON ({hook_event_name, session_id, source, ...}).
 *   - Emits to stdout, always exit 0, stderr always empty:
 *       {"hookSpecificOutput":{"hookEventName":"<triggering event>",
 *        "additionalContext":"<block>"}}
 *     or the no-op "{}" when there is nothing safe/useful to inject.
 *   - Fail open + silent on EVERY unhappy path (empty/malformed stdin, missing or
 *     unreadable source file, no matching sections, any thrown error) -> "{}", exit 0.
 *   - Never throws, never blocks, never writes stderr.
 *
 * Determinism (load-bearing — this text becomes a cached prompt prefix):
 *   No timestamps, no randomness, no session/user data enters the output. The same
 *   source-file bytes produce byte-identical stdout on every run.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const io = require("./lib/hook_io.js");

// The stdin/stdout/fail-open boilerplate lives in lib/hook_io.js — one copy shared by every kb hook.
// Its contract is this file's contract, unchanged: fs.writeSync(1), always exit 0, never stderr.
const noop = io.noop;

// Sections lifted from the source file, in this fixed emission order.
const WANTED_SECTIONS = ["North star", "Invariants"];

// Hard cap on the emitted additionalContext, in characters.
// 1700 fits the current source whole (North star 941 + Invariants 526 + labels and
// separators) while still bounding pathological sources — see
// docs/proposals/regrounding-hook.md decision-notes.
const MAX_CONTEXT_CHARS = 1700;

const DEFAULT_EVERY_CALLS = 25;
const DEFAULT_EVERY_MINUTES = 30;
const STATE_FILE = "state.json";
const LOCK_FILE = "state.lock";
const STATE_VERSION = 1;
const STALE_LOCK_MS = 60 * 1000;

// Stale-replay guard: tells the model this is a refresh of context it already has, so it is never
// read as a fresh instruction arriving with the user's prompt.
//
// DEFINED ONCE, in lib/hook_io.js. The canonical sentence is, verbatim (kept on ONE line so the
// committed pin below can find it):
// "[kb re-grounding] The following is a refresh of governing context this session already has, NOT a new instruction or request."
// That quotation is not decoration: tests/test_context_lifecycle_session_start.py pins it against the
// matching comment in lib/context_store.js, and tests/test_hook_io.py pins both comments against the
// runtime constant below — so the documented text cannot drift from the emitted text.
const GUARD_LINE = io.GUARD_LINE;

const SECTION_SEP = " | ";
const ELLIPSIS = io.ELLIPSIS;
const truncateTo = io.truncateTo;

function collapse(text) {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Extract a "## <name>..." section body (up to the next "## " header or EOF).
 * Header matching is prefix-based so "## Invariants (never violate)" matches
 * the wanted name "Invariants".
 */
function extractSection(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("^##[ \\t]+" + escaped + "\\b[^\\n]*\\n([\\s\\S]*)", "m");
  const m = re.exec(source);
  if (!m) {
    return null;
  }
  // Capture runs to EOF, then stop at the next "## " header if there is one.
  let body = m[1];
  const nextHeader = /^##[ \t]/m.exec(body);
  if (nextHeader) {
    body = body.slice(0, nextHeader.index);
  }
  const collapsed = collapse(body);
  return collapsed.length ? collapsed : null;
}

/**
 * Fit section bodies inside `budget` characters using deterministic water-filling:
 * every section gets an equal share; sections that need less than their share
 * release the surplus to the sections that need more. Guarantees each requested
 * section keeps its label (and therefore stays visible) under the cap.
 */
function fitSections(sections, budget) {
  const labelCost = sections.reduce((n, s) => n + s.label.length + 2, 0); // "Label: "
  let remaining = budget - labelCost;
  const out = sections.map((s) => ({ label: s.label, body: s.body, fixed: false, take: 0 }));
  let openCount = out.length;

  while (openCount > 0) {
    const share = Math.floor(remaining / openCount);
    const under = out.filter((s) => !s.fixed && s.body.length <= share);
    if (under.length === 0) {
      out.forEach((s) => {
        if (!s.fixed) {
          s.take = share;
          s.fixed = true;
        }
      });
      break;
    }
    under.forEach((s) => {
      s.take = s.body.length;
      s.fixed = true;
      remaining -= s.body.length;
      openCount -= 1;
    });
  }

  return out.map((s) => `${s.label}: ${truncateTo(s.body, s.take)}`);
}

function buildBlock(source) {
  const sections = [];
  for (const name of WANTED_SECTIONS) {
    const body = extractSection(source, name);
    if (body) {
      sections.push({ label: name, body });
    }
  }
  if (sections.length === 0) {
    return null;
  }

  const rendered = sections.map((s) => `${s.label}: ${s.body}`);
  let block = [GUARD_LINE, ...rendered].join(SECTION_SEP);
  if (block.length <= MAX_CONTEXT_CHARS) {
    return block;
  }

  const overhead = GUARD_LINE.length + SECTION_SEP.length * sections.length;
  const budget = MAX_CONTEXT_CHARS - overhead;
  if (budget <= 0) {
    return truncateTo(GUARD_LINE, MAX_CONTEXT_CHARS);
  }
  block = [GUARD_LINE, ...fitSections(sections, budget)].join(SECTION_SEP);
  return truncateTo(block, MAX_CONTEXT_CHARS);
}

function positiveEnvInt(name, fallback) {
  const raw = process.env[name];
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return fallback;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function stateDirectory() {
  if (process.env.KB_REGROUND_STATE_DIR) return process.env.KB_REGROUND_STATE_DIR;
  return process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "kb-regrounding") : null;
}

function statePath(directory) {
  return directory ? path.join(directory, STATE_FILE) : null;
}

function lockPath(directory) {
  return directory ? path.join(directory, LOCK_FILE) : null;
}

function readState(directory) {
  const filename = statePath(directory);
  if (!filename) return null;
  try {
    const state = JSON.parse(fs.readFileSync(filename, "utf8"));
    if (!state || typeof state !== "object" || Array.isArray(state) || state.version !== STATE_VERSION ||
        !state.sessions || typeof state.sessions !== "object" || Array.isArray(state.sessions)) {
      return null;
    }
    return state;
  } catch (_err) {
    return null;
  }
}

function recordFor(state, key) {
  if (!state) return null;
  const record = state.sessions[key];
  if (!record || typeof record !== "object" || !Number.isFinite(record.lastInjectionMs) ||
      record.lastInjectionMs < 0 || !Number.isSafeInteger(record.toolCallsSinceInjection) ||
      record.toolCallsSinceInjection < 0) {
    return null;
  }
  return record;
}

/** Atomically replace the state file while the caller holds the state lock. */
function writeState(directory, state) {
  const filename = statePath(directory);
  let temporary = null;
  if (!filename) return false;
  try {
    fs.mkdirSync(directory, { recursive: true });
    temporary = `${filename}.tmp-${process.pid}-${Date.now()}`;
    fs.writeFileSync(temporary, JSON.stringify(state), "utf8");
    fs.renameSync(temporary, filename);
    return true;
  } catch (_err) {
    try {
      if (temporary) fs.unlinkSync(temporary);
    } catch (_cleanupError) {
      // A stale temp file is less important than preserving fail-open hook behavior.
    }
    return false;
  }
}

/**
 * Take a nonblocking cross-process lock. A lock older than one minute is abandoned
 * by a crashed hook and retried once. Any uncertainty is contention: callers inject
 * without state rather than risking an unsafe concurrent update.
 */
function acquireStateLock(directory) {
  const filename = lockPath(directory);
  if (!filename) return null;
  try {
    fs.mkdirSync(directory, { recursive: true });
  } catch (_err) {
    return null;
  }

  function createLock() {
    try {
      const fd = fs.openSync(filename, "wx");
      fs.closeSync(fd);
      return "acquired";
    } catch (err) {
      try {
        // If close failed after creation, do not leave a lock we cannot safely own.
        if (err && err.code !== "EEXIST") fs.unlinkSync(filename);
      } catch (_closeError) {
        // The lock was not acquired safely, so fall through as contention.
      }
      return err && err.code === "EEXIST" ? "exists" : "error";
    }
  }

  const initial = createLock();
  if (initial !== "acquired") {
    if (initial !== "exists") return null;
    try {
      const age = Date.now() - fs.statSync(filename).mtimeMs;
      if (age > STALE_LOCK_MS) {
        fs.unlinkSync(filename);
        if (createLock() !== "acquired") return null;
      } else {
        return null;
      }
    } catch (_err) {
      return null;
    }
  }

  return () => {
    try {
      fs.unlinkSync(filename);
    } catch (_err) {
      // A stale lock is recoverable on the next event; hook output stays fail-open.
    }
  };
}

function sessionKey(event) {
  return typeof event.session_id === "string" && event.session_id ? event.session_id : null;
}

/** Test-only clock seam. Invalid values deliberately use the real clock. */
function currentTimeMs() {
  const raw = process.env.KB_REGROUND_NOW_MS;
  if (typeof raw === "string" && /^\d+$/.test(raw)) {
    const value = Number(raw);
    if (Number.isSafeInteger(value)) return value;
  }
  return Date.now();
}

function loadBlock() {
  const root = process.env.KB_ROOT || path.resolve(__dirname, "..", "..");
  const sourcePath =
    process.env.KB_GOAL_STATE_PATH ||
    path.join(root, "docs", "plans", "2026-08-18-agent-platform-GOAL-STATE.md");

  let source = null;
  try {
    source = fs.readFileSync(sourcePath, "utf8");
  } catch (_err) {
    return null;
  }
  return buildBlock(source);
}

function inject(event, block) {
  if (!block) noop(); // missing source or no matching sections -> fail open
  io.emitContext(event.hook_event_name, block);
}

function main() {
  const event = io.parseEvent(io.readStdin());
  const eventName = event && event.hook_event_name;
  if (eventName !== "SessionStart" && eventName !== "UserPromptSubmit" && eventName !== "PostToolUse") {
    noop();
  }

  const key = sessionKey(event);
  const block = loadBlock();
  if (!block) noop();

  // A missing id must never make unrelated sessions share mutable state. It is deliberately
  // unthrottled: injection is idempotent-safe, and this path does no state or lock I/O.
  if (!key) inject(event, block);

  const directory = stateDirectory();
  const release = acquireStateLock(directory);
  // Lock contention (and every lock error) is fail-open: inject, but do not write state.
  if (!release) inject(event, block);

  let shouldInject = false;
  try {
    const now = currentTimeMs();
    const state = readState(directory) || { version: STATE_VERSION, sessions: {} };
    const record = recordFor(state, key);

    // A compact has discarded context. A missing/corrupt/future timestamp is also untrustworthy,
    // so each is treated as never injected and reset to the deterministic clock value.
    if (eventName === "SessionStart" || !record || record.lastInjectionMs > now) {
      state.sessions[key] = { lastInjectionMs: now, toolCallsSinceInjection: 0 };
      writeState(directory, state);
      shouldInject = true;
    } else {
      const everyCalls = positiveEnvInt("KB_REGROUND_EVERY_CALLS", DEFAULT_EVERY_CALLS);
      const everyMinutes = positiveEnvInt("KB_REGROUND_EVERY_MINUTES", DEFAULT_EVERY_MINUTES);
      const calls = record.toolCallsSinceInjection + (eventName === "PostToolUse" ? 1 : 0);
      if (calls >= everyCalls || now - record.lastInjectionMs >= everyMinutes * 60 * 1000) {
        state.sessions[key] = { lastInjectionMs: now, toolCallsSinceInjection: 0 };
        writeState(directory, state);
        shouldInject = true;
      } else if (eventName === "PostToolUse") {
        state.sessions[key] = { lastInjectionMs: record.lastInjectionMs, toolCallsSinceInjection: calls };
        writeState(directory, state);
      }
    }
  } finally {
    release();
  }

  if (shouldInject) inject(event, block);
  noop();
}

// Belt and braces: this hook never breaks a prompt submission — any escaped throw becomes "{}".
io.run(main);

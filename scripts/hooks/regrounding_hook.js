#!/usr/bin/env node
/*
 * kb re-grounding UserPromptSubmit hook — INERT (not wired into any settings file).
 *
 * Provenance:
 *   pattern: ecc@2.0.0 session-start STALE-REPLAY GUARD (concept, not code)
 *   provenance-tier: pattern
 *
 * Purpose:
 *   Re-inject the governing "north star" context a long-running session already had
 *   at startup but has drifted from (or compacted away), as structured
 *   additionalContext on UserPromptSubmit.
 *
 * Status:
 *   INERT. Nothing in .claude/settings*.json references this file. The exact
 *   settings snippet that WOULD arm it lives in docs/proposals/regrounding-hook.md
 *   together with the open decision-notes (cap value, cadence, scope, staleness).
 *
 * Contract:
 *   - Reads env: KB_GOAL_STATE_PATH (default:
 *     <KB_ROOT or repo root resolved from this script>/docs/plans/
 *     2026-08-18-agent-platform-GOAL-STATE.md), KB_ROOT.
 *   - Reads stdin JSON ({hook_event_name, user_prompt, ...}).
 *   - Emits to stdout, always exit 0, stderr always empty:
 *       {"hookSpecificOutput":{"hookEventName":"UserPromptSubmit",
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

function main() {
  // Reads stdin, parses it, and confirms the event name. Empty/closed stdin, malformed JSON, or a
  // payload naming a different event all fail open ("{}", exit 0) inside this call.
  io.readEventFor("UserPromptSubmit");

  const root = process.env.KB_ROOT || path.resolve(__dirname, "..", "..");
  const sourcePath =
    process.env.KB_GOAL_STATE_PATH ||
    path.join(root, "docs", "plans", "2026-08-18-agent-platform-GOAL-STATE.md");

  let source = null;
  try {
    source = fs.readFileSync(sourcePath, "utf8");
  } catch (_err) {
    noop(); // missing or unreadable source -> fail open
  }

  const block = buildBlock(source);
  if (!block) {
    noop(); // no matching sections -> nothing worth injecting
  }

  io.emitContext("UserPromptSubmit", block);
}

// Belt and braces: this hook never breaks a prompt submission — any escaped throw becomes "{}".
io.run(main);

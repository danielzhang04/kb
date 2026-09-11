#!/usr/bin/env node
/*
 * kb project-frame SessionStart hook — the missing WRITER for the U8 context store's reserved
 * governing headings.
 *
 * Spec: docs/superpowers/specs/2026-09-11-project-frame-hooks-design.md §3 "New:
 * project_frame_session_start.js" (five numbered points) and §2.
 *
 * WHAT THIS HOOK DOES, IN ORDER:
 *   1. Resolves the active project from the checked-out branch (lib/project_frame.js's
 *      `activeProject`), matched against the project ids under orgs/ on origin/ops.
 *   2. Writes this session's store sections it OWNS -- '## North star' <- GOAL North star,
 *      '## Invariants' <- GOAL Invariants, '## Current gate' <- STATE Current gate -- via
 *      lib/context_store.js. This happens on EVERY SessionStart, including a compacted one, so
 *      U7 regrounding, U8 resume, and U9 subagent load all read fresh sections regardless of
 *      whether this hook itself emits anything this turn. It never touches
 *      '## Resumed-session summary' or '## Recent activity' -- those belong to other hooks.
 *   3. Runs `scripts/preamble.py` (never blocks on the result) and prepends its verdict line.
 *   4. Emits `full` (project resolved) or `rollup` (no project) as additionalContext -- UNLESS
 *      `event.source == "compact"`, where nothing is emitted at all: U7 owns the compact
 *      re-injection, and a second payload on the same turn is wasted budget.
 *   5. Appends `scripts/handoffs_sweep.py --json`'s flagged handoffs as a short
 *      '## Stale handoffs' block, when any are flagged.
 *
 * Contract: fail open on EVERY unhappy path (no stdin, malformed stdin, foreign event, missing
 * session id, missing/unreadable ops data, a store directory that cannot be created) -> "{}",
 * exit 0, empty stderr (lib/hook_io.js's `run` wrapper backstops any escaped throw). Two
 * subprocess calls at most (preamble.py, handoffs_sweep.py), each time-boxed and each optional to
 * the emitted payload -- neither one blocks a session start, and only the preamble line ever
 * uses `runPython`'s literal fallback text.
 */
"use strict";

const path = require("path");
const child_process = require("child_process");

/*
 * DISCOVERED WHILE WRITING THIS HOOK'S TESTS, NOT A BUG IN THIS FILE:
 *
 * lib/project_frame.js's `gitCapture` runs `execFileSync("git", …)` with no `stdio` option. Unlike
 * `spawnSync`, Node's `execFileSync` inherits the child's stderr straight to THIS process's real
 * stderr on a nonzero exit -- even though `gitCapture` catches the thrown error and returns null.
 * A missing `origin/ops` ref, or a GOAL.md/STATE.md path that simply does not exist there (both
 * normal "no project data yet" situations, not bugs), trip this: git's own "fatal: ..." line would
 * otherwise land on this hook's stderr and break the "always empty stderr" contract every hook in
 * this family is held to (lib/hook_io.js's header comment; `io.run` only catches JS throws, never
 * bytes a child process writes to an inherited fd).
 *
 * project_frame.js was committed by an earlier task and is out of THIS task's scope to edit, so the
 * fix lives here instead: force `stdio: 'pipe'` on every `git` execFileSync call anything required
 * below makes, applied BEFORE requiring lib/project_frame.js (its `gitCapture` destructures
 * `execFileSync` once at require time, so the patch must already be in place). Scoped to
 * `file === "git"` only; nothing else this short-lived, one-shot process spawns is affected, and
 * nothing outside this process ever sees the patched function.
 */
const originalExecFileSync = child_process.execFileSync;
child_process.execFileSync = function patchedExecFileSync(file, args, options) {
  if (file === "git") {
    const opts = options ? Object.assign({}, options) : {};
    if (!opts.stdio) opts.stdio = ["pipe", "pipe", "pipe"];
    return originalExecFileSync.call(child_process, file, args, opts);
  }
  return originalExecFileSync.apply(child_process, arguments);
};

const { spawnSync } = require("child_process");
const io = require("./lib/hook_io.js");
const store = require("./lib/context_store.js");
const pf = require("./lib/project_frame.js");

const PREAMBLE_TIMEOUT_MS = 10000;
const SWEEP_TIMEOUT_MS = 5000;

/**
 * Run one repo-relative python script with the `py -3` / `python` fallback every other kb hook
 * and script in this family uses. Returns the raw spawnSync result (`{status, stdout, stderr,
 * error, ...}`) from whichever interpreter actually launched, or null when neither is on PATH.
 * Never throws: a spawnSync failure to launch shows up as `result.error`, not an exception.
 */
function runPython(args, cwd, timeoutMs) {
  for (const bin of ["py", "python"]) {
    const fullArgs = bin === "py" ? ["-3", ...args] : args;
    const result = spawnSync(bin, fullArgs, {
      cwd,
      timeout: timeoutMs,
      encoding: "utf8",
      windowsHide: true,
    });
    if (!result.error) return result; // launched -- a nonzero exit is still a real answer
  }
  return null; // neither interpreter is on PATH
}

/** First non-blank line of a block of text, trimmed. Null when there isn't one. */
function firstNonEmptyLine(text) {
  if (typeof text !== "string") return null;
  const line = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || null;
}

/**
 * "The first non-empty line of stdout+stderr, or 'unavailable'." Never throws, never blocks past
 * `timeoutMs` (spawnSync enforces it), and never surfaces a raw error object into the payload --
 * only text the preamble itself printed, or the fixed fallback.
 */
function preambleVerdict(root) {
  const result = runPython(["scripts/preamble.py"], root, PREAMBLE_TIMEOUT_MS);
  const text = result ? (result.stdout || "") + (result.stderr || "") : "";
  return firstNonEmptyLine(text) || "unavailable";
}

/**
 * `scripts/handoffs_sweep.py --json`'s flagged rows, rendered as "<file>: <reason>" strings.
 * Tolerates absence, a nonzero exit, a timeout, or unparsable stdout by returning [] -- the sweep
 * is a nice-to-have annotation on the payload, never a precondition for emitting one.
 */
function handoffFlags(root) {
  const result = runPython(["scripts/handoffs_sweep.py", "--json"], root, SWEEP_TIMEOUT_MS);
  if (!result || result.status !== 0 || !result.stdout) return [];
  let rows;
  try {
    rows = JSON.parse(result.stdout);
  } catch (_err) {
    return [];
  }
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row) => row && typeof row.file === "string")
    .map((row) => {
      const reason =
        typeof row.reason === "string" && row.reason
          ? row.reason
          : Array.isArray(row.reasons)
            ? row.reasons.join("; ")
            : "flagged";
      return row.file + ": " + reason;
    });
}

/**
 * Write this session's governing sections from the active project's GOAL.md/STATE.md, WITHOUT
 * touching any section this hook does not own. A no-op when there is no session, no project, or
 * neither ops file yields any of the three headings -- `readStore`/`upsertSection`/`writeStore`
 * already fail open on IO trouble, so this never throws even when the store directory cannot be
 * created.
 */
function writeGoverningSections(sessionId, project, cwd, env) {
  if (!sessionId || !project || !cwd) return;
  const goalText = pf.readOpsFile(cwd, `orgs/${project}/GOAL.md`, env);
  const stateText = pf.readOpsFile(cwd, `orgs/${project}/STATE.md`, env);
  const goalSections = goalText ? pf.parseSections(goalText) : [];
  const stateSections = stateText ? pf.parseSections(stateText) : [];

  const northStar = store.sectionBody(goalSections, store.HEADINGS.NORTH_STAR);
  const invariants = store.sectionBody(goalSections, store.HEADINGS.INVARIANTS);
  const currentGate = store.sectionBody(stateSections, store.HEADINGS.CURRENT_GATE);
  if (!northStar && !invariants && !currentGate) return;

  let sections = store.readStore(sessionId, env);
  if (northStar) sections = store.upsertSection(sections, store.HEADINGS.NORTH_STAR, northStar);
  if (invariants) sections = store.upsertSection(sections, store.HEADINGS.INVARIANTS, invariants);
  if (currentGate) sections = store.upsertSection(sections, store.HEADINGS.CURRENT_GATE, currentGate);
  store.writeStore(sessionId, sections, env);
}

function main() {
  // Fails open ("{}", exit 0) inside this call on: no stdin, malformed JSON, a non-object
  // payload, or a `hook_event_name` naming a different event. A missing `hook_event_name` is
  // accepted (see hook_io.js's `isEventFor`).
  const event = io.readEventFor("SessionStart");

  const env = process.env;
  const root = env.KB_ROOT || path.resolve(__dirname, "..", "..");
  const cwd = typeof event.cwd === "string" && event.cwd ? event.cwd : root;

  // No session id -> nothing this hook can usefully do (same posture as the INERT
  // context_lifecycle_session_start.js sibling): there is no store to write and no session to
  // attribute a "Resumed-session summary" lookup to.
  const sessionId = typeof event.session_id === "string" && event.session_id ? event.session_id : null;
  if (!sessionId) {
    io.noop(); // never returns
  }

  const project = pf.activeProject(event, env);

  // The store WRITE happens on every SessionStart, including a compacted one (ruling: U7's
  // post-compact re-grounding needs fresh sections to read even on a turn where THIS hook stays
  // silent).
  writeGoverningSections(sessionId, project, cwd, env);

  if (event.source === "compact") {
    io.noop(); // U7 owns the compact re-injection -- never returns
  }

  const mode = project ? "full" : "rollup";
  const budget = pf.MODE_BUDGETS[mode];
  const frameResult = pf.frame({ project, mode, cwd, sessionId, env });

  const preambleLine = "[preamble] " + preambleVerdict(root);
  let combined = preambleLine + "\n\n" + frameResult.text;

  const flags = handoffFlags(root);
  if (flags.length) {
    combined += "\n\n## Stale handoffs\n" + flags.map((f) => "- " + f).join("\n");
  }

  // Hard cap on the WHOLE payload (preamble line + frame + stale-handoffs block), never just the
  // frame body -- frame() already capped itself to `budget`, but the preamble line and the
  // handoff-sweep block are added on top of that and must not push the total over budget.
  const payload = io.truncateTo(combined, budget);

  io.emitContext("SessionStart", payload);
}

io.run(main);

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
const { spawnSync } = require("child_process");
const io = require("./lib/hook_io.js");
const store = require("./lib/context_store.js");
const pf = require("./lib/project_frame.js");

const PREAMBLE_TIMEOUT_MS = 10000;
/** Blank line between top-level payload blocks, and the list separator inside the flags block.
 *  Named constants because F2 BUDGETS their cost rather than guessing at it. */
const NEWLINE = "\n";
const SEPARATOR = "\n\n";
const DEFAULT_SWEEP_TIMEOUT_MS = 2000; // fix round 2: handoffs_sweep.py is now O(1) git
// processes and finishes in well under this on the real repo; env override for tests/tuning.

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

/**
 * "The first non-empty line of stdout+stderr, or 'unavailable'." Never throws, never blocks past
 * `timeoutMs` (spawnSync enforces it), and never surfaces a raw error object into the payload --
 * only text the preamble itself printed, or the fixed fallback. Reuses lib/project_frame.js's
 * exported `firstLine` (already used there for a STATE.md's `## Now` line) instead of carrying a
 * near-duplicate trim-and-find-first-non-blank-line helper here.
 */
function preambleVerdict(root) {
  const result = runPython(["scripts/preamble.py"], root, PREAMBLE_TIMEOUT_MS);
  const text = result ? (result.stdout || "") + (result.stderr || "") : "";
  return pf.firstLine(text) || "unavailable";
}

/**
 * `scripts/handoffs_sweep.py --json`'s flagged rows, rendered as "<file>: <reason>" strings.
 * Tolerates absence, a nonzero exit, a timeout, or unparsable stdout by returning [] -- the sweep
 * is a nice-to-have annotation on the payload, never a precondition for emitting one. `timeoutMs`
 * defaults to `DEFAULT_SWEEP_TIMEOUT_MS`, overridable via `KB_SWEEP_TIMEOUT_MS` (see `main`) --
 * on timeout `runPython` returns null (the sweep's spawnSync `result.error` is set, so no result
 * is ever returned), which this function already treats the same as absence/failure: no block.
 */
function handoffFlags(root, timeoutMs) {
  const result = runPython(["scripts/handoffs_sweep.py", "--json"], root, timeoutMs);
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
 * The `.summary` sidecar's one line for '## Usage (yesterday)', or null when it doesn't exist yet
 * (in ops HEAD or the working tree). PURE FILE READ -- fix round 3 ruling (spec S3): this hook
 * must NEVER spawn the Python parser, full stop, no matter how short the timeout. The prior
 * version spawned `usage_ledger.py --summary --no-publish` under a 3s timeout even on the
 * idempotent-read path; a live headless check (`claude -p`) showed the line simply absent from a
 * real session's startup context, because that spawn lost its race under real host load -- a
 * timeout budget is still a spawn, and the spec forbids the spawn outright, not just a slow one.
 *
 * `usage_ledger.py` now writes `ledgers/usage/<day>.summary` alongside the TSV every time it
 * computes or regenerates a day (see its `write_summary_sidecar`), so this hook only ever reads
 * what has already been computed elsewhere. `pf.readOpsFile` supplies the fallback order this
 * needs for free: ops HEAD first (the normal case, once preamble.py's detached launch has
 * published it), the working tree second (a same-machine run that hasn't landed on ops yet).
 */
function usageLine(cwd, env) {
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const text = pf.readOpsFile(cwd, "ledgers/usage/" + yesterday + ".summary", env);
  const line = pf.firstLine(text);
  if (!line) return null;
  return line.length > 200 ? line.slice(0, 200) : line;
}

/**
 * Write this session's governing sections from the active project's GOAL.md/STATE.md, WITHOUT
 * touching any section this hook does not own. A no-op when there is no session, no project, or
 * neither ops file yields any of the three headings -- `updateStore` (and the locked
 * `readStore`/`upsertSection`/`writeStore` inside it) already fails open on IO trouble and on
 * lock contention, so this never throws and never hangs even when the store directory cannot be
 * created.
 */
function writeGoverningSections(sessionId, project, cwd, env) {
  if (!sessionId || !project || !cwd) return;
  const goalText = pf.readOpsFile(cwd, `orgs/${project}/GOAL.md`, env);
  const stateText = pf.readOpsFile(cwd, `orgs/${project}/STATE.md`, env);
  const goalSections = goalText ? pf.parseSections(goalText) : [];
  const stateSections = stateText ? pf.parseSections(stateText) : [];

  // PREFIX-matched, not exact: spec §1 spells GOAL.md/STATE.md headings "exact, prefix-matched",
  // and a real STATE.md carries annotated headings like "## Current gate (P8)". frame() has always
  // read them through pf.sectionBodyByPrefix; this writer used store.sectionBody (exact by design,
  // and pinned that way by U8's tests), so an annotated heading silently wrote NOTHING into the
  // store and U7/U9 re-grounding lost the very section the frame was showing on screen.
  const northStar = pf.sectionBodyByPrefix(goalSections, store.HEADINGS.NORTH_STAR);
  const invariants = pf.sectionBodyByPrefix(goalSections, store.HEADINGS.INVARIANTS);
  const currentGate = pf.sectionBodyByPrefix(stateSections, store.HEADINGS.CURRENT_GATE);
  if (!northStar && !invariants && !currentGate) return;

  // ONE LOCKED read-modify-write: the PreCompact sibling and the PostToolUse activity tracker
  // write the same file, and an interleaved read->write between them dropped whole sections.
  // The git/ops reads above stay OUTSIDE the lock -- only the store touch is serialized.
  store.updateStore(
    sessionId,
    (sections) => {
      let next = sections;
      if (northStar) next = store.upsertSection(next, store.HEADINGS.NORTH_STAR, northStar);
      if (invariants) next = store.upsertSection(next, store.HEADINGS.INVARIANTS, invariants);
      if (currentGate) next = store.upsertSection(next, store.HEADINGS.CURRENT_GATE, currentGate);
      return next;
    },
    env,
  );
}

function main() {
  // Fails open ("{}", exit 0) inside this call on: no stdin, malformed JSON, a non-object
  // payload, or a `hook_event_name` naming a different event. A missing `hook_event_name` is
  // accepted (see hook_io.js's `isEventFor`).
  const event = io.readEventFor("SessionStart");

  const env = process.env;
  const root = env.KB_ROOT || path.resolve(__dirname, "..", "..");
  // `cwd` here is only the working-tree root passed to writeGoverningSections/frame() for git/file
  // reads (falls back to `root` when the harness sends none). `pf.activeProject` below reads
  // `event.cwd` directly and strictly -- it does NOT fall back to this `cwd` or to `root` -- so a
  // SessionStart event with no `cwd` at all resolves no project and this hook emits `rollup` by
  // design, not by accident.
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
  // NOTE (fix wave M3): a '## Session model' store note used to be written here from `event.model`.
  // It had exactly one intended reader, context_guard.js, which does not read it -- Task 0 proved
  // `event.model` is absent from every SessionStart/PreToolUse payload in this build, so the note
  // was empty every time, and the guard resolves the model from the transcript tail instead.
  // A write with no reader and no content is not a seam for later, it is a thing to delete.

  if (event.source === "compact") {
    io.noop(); // U7 owns the compact re-injection -- never returns
  }

  const mode = project ? "full" : "rollup";
  const budget = pf.MODE_BUDGETS[mode];

  // ORDER IS LOAD-BEARING. The preamble line and the '## Stale handoffs' block are computed FIRST
  // and their cost is subtracted from the frame's budget, so frame() fills only what is actually
  // left. The previous order -- frame() fills the whole MODE_BUDGETS[mode], then append, then
  // truncate the combined string -- cut the TAIL: on a real session that silently dropped the
  // stale-handoff flags and the end of '## Infra' first, which is exactly backwards. frame()'s own
  // truncateLastFirst already sheds the least important sections from the inside, where it knows
  // where the section boundaries are; a blind tail cut does not.
  const preambleLine = "[preamble] " + preambleVerdict(root);
  const overrideMs = Number(env.KB_SWEEP_TIMEOUT_MS);
  const sweepTimeoutMs = Number.isFinite(overrideMs) && overrideMs > 0 ? overrideMs : DEFAULT_SWEEP_TIMEOUT_MS;
  const flags = handoffFlags(root, sweepTimeoutMs);
  const flagsBlock = flags.length
    ? SEPARATOR + "## Stale handoffs" + NEWLINE + flags.map((f) => "- " + f).join(NEWLINE)
    : "";
  const usage = usageLine(cwd, env);
  const usageBlock = usage ? SEPARATOR + "## Usage (yesterday)" + NEWLINE + usage : "";

  const frameResult = pf.frame({
    project,
    mode,
    cwd,
    sessionId,
    env,
    budget: budget - preambleLine.length - SEPARATOR.length - flagsBlock.length - usageBlock.length,
  });

  const combined = preambleLine + SEPARATOR + frameResult.text + flagsBlock + usageBlock;

  // A GUARD, not the strategy: the reservation above already keeps the total inside `budget` in
  // every normal case, so this only fires when the preamble line and the flags block ALONE overrun
  // the mode budget (a pathological preamble failure message plus dozens of flagged handoffs).
  // Kept because the emitted payload is contractually capped at MODE_BUDGETS[mode]; never relied on.
  const payload = combined.length <= budget ? combined : io.truncateTo(combined, budget);

  io.emitContext("SessionStart", payload);
}

io.run(main);

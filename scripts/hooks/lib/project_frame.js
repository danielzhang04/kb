#!/usr/bin/env node
/*
 * kb project-frame resolver — turns a hook event into the active project (if any) and renders
 * its GOAL.md/STATE.md into the per-mode context blocks the SessionStart hook emits.
 *
 * Status: not yet armed. See docs/superpowers/specs/2026-09-11-project-frame-hooks-design.md §2.
 *
 * Two modes only (spec trimmed 2026-09-11 after the brief was written — `reground` and
 * `subagent` payloads are served by U7/U9 straight from the context store's governing sections,
 * so no separate frame() modes exist for them):
 *   - `full`   (SessionStart startup/resume/clear): GOAL all sections + STATE all sections + the
 *     project's handoff filenames/Load lists + the store's `## Resumed-session summary`.
 *   - `rollup` (no active project): one line per project, plus the store's
 *     `## Resumed-session summary` -- a boss session gets `rollup` and is the session that
 *     compacts most often, so withholding the summary here made the PreCompact write dead.
 *
 * Reads: `git -C <cwd> branch --show-current` and `git -C <cwd> show origin/ops:<path>`, both
 * with a 2 s timeout. NEVER fetches — origin/ops is read as a local ref, exactly as the
 * checkout already has it. Every function here fails open to null/[]/"" on any git, filesystem,
 * or parse error; nothing throws past this file's own boundary.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const io = require("./hook_io.js");
const store = require("./context_store.js");

const GIT_TIMEOUT_MS = 2000;
const MAX_OPS_FILE_CHARS = 32 * 1024;
const MAX_HANDOFF_CHARS = 32 * 1024;

// Spec §2 (trimmed 2026-09-11): exactly two modes.
const MODE_BUDGETS = Object.freeze({ full: 7000, rollup: 1500 });

// GOAL.md/STATE.md headings are spelled exactly per the spec — the U8 store's parser already
// drops any preamble and trims bodies the same way this format needs. Reused, not reimplemented.
const parseSections = store.parseSections;

const GUARD_LINE = io.GUARD_LINE;

/** A project id under orgs/ known to have a `faceless-youtube`-style multi-word directory name
 *  but a single-word handoff-filename scope token (see handoffs/README.md's scope list). Extend
 *  this table as new aliases are needed; it is deliberately small and explicit. */
const HANDOFF_SCOPE_ALIASES = Object.freeze({ "faceless-youtube": "fyt" });

/** A project id is a directory name under orgs/: lowercase alphanumerics and hyphens only. */
const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

const HANDOFF_NAME_RE = /^(\d{4}-\d{2}-\d{2})-([a-z0-9]+)-.+\.md$/;
const UPDATED_RE = /^_Updated:\s*([^_\n]+?)_?\s*$/m;

function gitCapture(cwd, args) {
  if (typeof cwd !== "string" || !cwd) return null;
  try {
    // stdio: ["ignore", "pipe", "pipe"] is load-bearing, not a style choice. Node's execFileSync
    // (unlike spawnSync) inherits the child's stderr straight to THIS process's real stderr on a
    // nonzero exit unless stdio is given explicitly -- so a missing `origin/ops` ref or a path
    // that doesn't exist within it (both normal "no data yet" situations here, not bugs) would
    // otherwise leak git's own "fatal: ..." line onto every hook that calls into this module,
    // breaking the "always empty stderr" contract those hooks are held to. Piping stdout/stderr
    // keeps them off the real streams regardless of exit code; the catch below already discards
    // both on failure, exactly as before.
    return execFileSync("git", ["-C", cwd, ...args], {
      timeout: GIT_TIMEOUT_MS,
      encoding: "utf8",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (_err) {
    return null; // nonzero exit, missing git, timeout — all fail open
  }
}

function listProjects(cwd, env) {
  const out = gitCapture(cwd, ["ls-tree", "-d", "--name-only", "origin/ops:orgs"]);
  if (out !== null) {
    return out
      .split("\n")
      .map((line) => line.trim().replace(/\/$/, ""))
      .filter(Boolean);
  }
  try {
    return fs
      .readdirSync(path.join(cwd, "orgs"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch (_err) {
    return [];
  }
}

function projectFromBranch(branch, ids) {
  if (typeof branch !== "string" || !branch.includes("/")) return null;
  const portion = branch.slice(branch.indexOf("/") + 1);
  const byLengthDesc = ids.slice().sort((a, b) => b.length - a.length);
  for (const id of byLengthDesc) {
    if (portion === id || portion.startsWith(id + "-")) return id;
  }
  return null;
}

function activeProject(event, env) {
  const e = env || process.env;
  if (typeof e.KB_PROJECT === "string" && e.KB_PROJECT.trim()) {
    // The override only ever names a project id, and a project id is a directory name under
    // orgs/. Anything else (a path traversal, a shell fragment, an absolute path, whitespace)
    // is IGNORED rather than honoured -- it would otherwise flow straight into the
    // `orgs/<project>/GOAL.md` strings readOpsFile hands to `git show`. Ignoring beats erroring:
    // the branch resolver below still gets its chance, which is the fail-open posture this whole
    // module is held to.
    const candidate = e.KB_PROJECT.trim();
    if (PROJECT_ID_RE.test(candidate)) return candidate;
  }
  const cwd = event && typeof event.cwd === "string" && event.cwd ? event.cwd : null;
  if (!cwd) return null;
  const branch = gitCapture(cwd, ["branch", "--show-current"]);
  if (!branch) return null;
  return projectFromBranch(branch, listProjects(cwd, e));
}

function readOpsFile(cwd, relPath, env) {
  if (typeof cwd !== "string" || !cwd || typeof relPath !== "string") return null;
  const out = gitCapture(cwd, ["show", "origin/ops:" + relPath]);
  if (out !== null) {
    return out.length > MAX_OPS_FILE_CHARS ? out.slice(0, MAX_OPS_FILE_CHARS) : out;
  }
  return io.readCappedFile(path.join(cwd, relPath), MAX_OPS_FILE_CHARS);
}

function firstLine(text) {
  if (!text) return null;
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line || null;
}

function updatedStamp(text) {
  if (typeof text !== "string") return null;
  const m = UPDATED_RE.exec(text);
  return m ? m[1].trim() : null;
}

/**
 * Prefix-matched section lookup. Spec §1: GOAL.md/STATE.md headings are "exact, prefix-matched"
 * — a heading like "## Current gate (P8)" must still resolve as "Current gate", the same way
 * regrounding_hook.js's `extractSection` already prefix-matches (`^##[ \t]+<name>\b`).
 * `context_store.sectionBody` is exact-match by design (U8's tests pin it), so the prefix match
 * lives here rather than in context_store.js — this wraps `context_store.parseSections`' output,
 * it does not change that module.
 */
function sectionBodyByPrefix(sections, name) {
  const list = Array.isArray(sections) ? sections : [];
  const re = new RegExp("^" + String(name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b");
  for (const section of list) {
    if (section && typeof section.heading === "string" && re.test(section.heading)) {
      const body = typeof section.body === "string" ? section.body.trim() : "";
      return body.length ? body : null;
    }
  }
  return null;
}

function bodiesFor(sections, headings) {
  const parts = [];
  for (const heading of headings) {
    const body = sectionBodyByPrefix(sections, heading);
    if (body) parts.push({ label: heading, body });
  }
  return parts;
}

/**
 * Render `Label: body` entries in order, truncating LAST-FIRST once `budget` is exceeded: every
 * entry before the overflow point is kept whole, the first entry that would overflow is cut to
 * whatever room remains, and every entry after it is dropped outright. This differs deliberately
 * from regrounding_hook.js's water-filling `fitSections` — the spec calls for last-first here,
 * not an equal-share split, because a frame's EARLIER sections (GOAL before STATE, Now before
 * Findings) are the ones a resuming session most needs intact.
 */
function truncateLastFirst(entries, budget) {
  const rendered = [];
  let used = 0;
  for (const entry of entries) {
    const line = entry.label ? entry.label + ": " + entry.body : entry.body;
    const sep = rendered.length ? "\n\n" : "";
    const room = budget - used - sep.length;
    if (room <= 0) break;
    if (line.length <= room) {
      rendered.push(line);
      used += sep.length + line.length;
    } else {
      rendered.push(io.truncateTo(line, room));
      used = budget;
      break;
    }
  }
  return rendered.join("\n\n");
}

function projectHandoffs(cwd, project) {
  if (!cwd || !project) return [];
  let names;
  try {
    names = fs.readdirSync(path.join(cwd, "handoffs")).filter((n) => n.endsWith(".md"));
  } catch (_err) {
    return [];
  }
  const scope = HANDOFF_SCOPE_ALIASES[project] || project;
  return names
    .filter((name) => {
      const m = HANDOFF_NAME_RE.exec(name);
      return Boolean(m && m[2] === scope);
    })
    .sort();
}

function loadListFor(cwd, filename) {
  if (typeof cwd !== "string" || !cwd || typeof filename !== "string" || !filename) return null;
  const text = io.readCappedFile(path.join(cwd, "handoffs", filename), MAX_HANDOFF_CHARS);
  if (!text) return null;
  const sections = parseSections(text);
  return sectionBodyByPrefix(sections, "Load list") || sectionBodyByPrefix(sections, "Load");
}

/** Apply GUARD_LINE + truncateLastFirst + the final per-mode cap, once, for both frame() branches. */
function renderFramed(entries, budget) {
  const body = truncateLastFirst(entries, budget - GUARD_LINE.length - 2);
  const text = io.truncateTo(body ? GUARD_LINE + "\n\n" + body : GUARD_LINE, budget);
  return { text, sections: entries };
}

/**
 * The session store's `## Resumed-session summary`, as a labelled entry, or null when there is
 * none. BOTH modes append it (fix wave F1): a boss session gets `rollup`, and a boss session is
 * exactly the session that compacts most often -- serving the summary only in `full` meant the
 * PreCompact hook's write was never replayed to the sessions that produced it.
 */
function resumedSummaryEntry(sessionId, env) {
  const sessionSections = sessionId ? store.readStore(sessionId, env) : [];
  const resumed = store.sectionBody(sessionSections, store.HEADINGS.RESUMED_SUMMARY);
  return resumed ? { label: "Resumed-session summary", body: resumed } : null;
}

/**
 * Resolve the char budget for one frame() call. `opts.budget` is an OVERRIDE the caller uses when
 * it has to spend part of the mode's allowance on text of its own (see
 * project_frame_session_start.js, which reserves room for its `[preamble]` line and the
 * `## Stale handoffs` block BEFORE calling in, so the tail of the frame is never cut off
 * afterwards). It can only ever LOWER the budget: `MODE_BUDGETS[mode]` stays the hard ceiling,
 * and a non-numeric/negative override falls back to it (0 is honoured, and renders an empty
 * frame rather than throwing).
 */
function resolveBudget(mode, requested) {
  const ceiling = MODE_BUDGETS[mode];
  const n = Number(requested);
  if (!Number.isFinite(n)) return ceiling;
  return Math.max(0, Math.min(Math.floor(n), ceiling));
}

/**
 * The ` | latest decision: ...` tail of one rollup project line, capped at DECISION_SUFFIX_MAX
 * chars including the label (fix wave I4).
 *
 * A rollup line's job is "which project, where is it, how fresh" -- the decision is a POINTER,
 * and an uncapped one is not. The rollup budget is 1500 chars for ALL projects (MODE_BUDGETS),
 * and a decision bullet may legitimately run to a full line of prose; two verbose ones crowded
 * the later projects out of the frame entirely via truncateLastFirst, so a session was told a
 * lot about project one and nothing at all about project five. The full bullet is one read of
 * orgs/<id>/STATE.md away.
 */
const DECISION_SUFFIX_MAX = 80;

function decisionSuffix(decision) {
  if (!decision) return "";
  const suffix = ` | latest decision: ${decision}`;
  return suffix.length <= DECISION_SUFFIX_MAX
    ? suffix
    : suffix.slice(0, DECISION_SUFFIX_MAX - 3) + "...";
}

function frame(opts) {
  const o = opts || {};
  const env = o.env || process.env;
  const cwd = o.cwd;
  const mode = Object.prototype.hasOwnProperty.call(MODE_BUDGETS, o.mode) ? o.mode : "rollup";
  const budget = resolveBudget(mode, o.budget);

  if (mode === "rollup") {
    const entries = [];
    for (const id of listProjects(cwd, env)) {
      const stateText = readOpsFile(cwd, `orgs/${id}/STATE.md`, env);
      if (!stateText) continue;
      const sections = parseSections(stateText);
      const now = firstLine(sectionBodyByPrefix(sections, "Now")) || "(no ## Now)";
      const updated = updatedStamp(stateText) || "unknown";
      const decision = firstLine(sectionBodyByPrefix(sections, "Decisions"));
      entries.push({
        label: null,
        body: `${id}: ${now} (updated ${updated})${decisionSuffix(decision)}`,
      });
    }
    const rollupResumed = resumedSummaryEntry(o.sessionId, env);
    if (rollupResumed) entries.push(rollupResumed);
    return renderFramed(entries, budget);
  }

  // mode === "full"
  const project = o.project;
  let goalSections = [];
  let stateSections = [];
  if (project && cwd) {
    const goalText = readOpsFile(cwd, `orgs/${project}/GOAL.md`, env);
    const stateText = readOpsFile(cwd, `orgs/${project}/STATE.md`, env);
    goalSections = goalText ? parseSections(goalText) : [];
    stateSections = stateText ? parseSections(stateText) : [];
  }

  const entries = bodiesFor(goalSections, [
    "North star",
    "Success conditions",
    "Invariants",
    "Governing docs",
  ]).concat(
    bodiesFor(stateSections, ["Now", "Current gate", "Decisions", "Next", "Blocked", "Findings", "Infra"])
  );
  for (const name of projectHandoffs(cwd, project)) {
    const loadList = loadListFor(cwd, name);
    entries.push({ label: `Handoff ${name}`, body: loadList || "(no Load list found)" });
  }
  const resumed = resumedSummaryEntry(o.sessionId, env);
  if (resumed) entries.push(resumed);

  return renderFramed(entries, budget);
}

module.exports = {
  MODE_BUDGETS,
  activeProject,
  firstLine,
  frame,
  listProjects,
  loadListFor,
  parseSections,
  projectHandoffs,
  readOpsFile,
  sectionBodyByPrefix,
  DECISION_SUFFIX_MAX,
};

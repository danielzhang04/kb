#!/usr/bin/env node
/*
 * kb delivery-gate Stop hook — WARN-ONLY memory-append check, plus a stale-STATE.md check for
 * the session's active project (see docs/superpowers/specs/2026-09-11-project-frame-hooks-design.md
 * §3 "Stop hook — one added warning").
 *
 * Provenance:
 *   source: ecc@2.0.0/skills/delivery-gate/hooks/quality-gate.py
 *   imported: 2026-07-19
 *   provenance-tier: imported
 *
 * Ported from ECC: the learning-capture / staleness check (ECC's
 *   check_stale_libs, keyed to the growth-log library via filesystem mtime),
 *   retargeted to kb's single per-agent memory file memory/<agent-id>.md.
 *
 * Dropped from ECC (intentionally NOT ported): the disk-space gate
 *   (DISK_* thresholds / shutil.disk_usage), the rationalization-regex
 *   transcript scan, the ~/.claude/projects/<safe>/memory ECC state-dir
 *   lookup, and every blocking (exit 2) path. Per Daniel-approved
 *   enforcement mode, delivery-gate is WARN-ONLY: it ALWAYS exits 0.
 *
 * Contract:
 *   - Reads env: KB_ROOT (default: repo root resolved from this script),
 *     KB_AGENT_ID, KB_SESSION_START (epoch seconds).
 *   - Reads stdin JSON ({cwd, ...}) to resolve the active project via lib/project_frame.js.
 *   - KB_AGENT_ID absent            -> exit 0, silent (fail open).
 *   - KB_SESSION_START unparseable  -> exit 0, silent (fail open).
 *   - memory/<agent-id>.md mtime >= session start -> exit 0, silent
 *     (learning captured this session).
 *   - otherwise (stale or missing)  -> stderr "[delivery-gate WARN] ...",
 *     exit 0.
 *   - independently: an active project whose orgs/<project>/STATE.md `_Updated:` stamp is more
 *     than 3 days old (or missing/unparsable while the file exists) -> an additional stderr
 *     "[delivery-gate WARN] ... STATE.md stale ..." line, still exit 0. No project, no
 *     STATE.md, or any resolution error -> silent (fail open); this check never changes the
 *     exit code or blocking behavior.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function readEvent() {
  try {
    const raw = fs.readFileSync(0, "utf8");
    if (!raw || !raw.trim()) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_err) {
    return {};
  }
}

function warnStaleState(event, root) {
  try {
    const pf = require("./lib/project_frame.js");
    // activeProject() reads event.cwd directly (project_frame.js); this local `cwd` fallback to
    // `root` only matters below for readOpsFile, e.g. when KB_PROJECT is set but the event
    // carries no cwd — activeProject can still resolve via KB_PROJECT alone in that case.
    const cwd = typeof event.cwd === "string" && event.cwd ? event.cwd : root;
    const project = pf.activeProject(event, process.env);
    if (!project) return;
    const stateText = pf.readOpsFile(cwd, `orgs/${project}/STATE.md`, process.env);
    if (!stateText) return;
    const m = /^_Updated:\s*(\d{4}-\d{2}-\d{2})/m.exec(stateText);
    if (!m) {
      process.stderr.write(
        `[delivery-gate WARN] STATE.md stale — update orgs/${project}/STATE.md before closing ` +
          `(no parsable _Updated: line). (warn-only; not blocking)\n`
      );
      return;
    }
    const updatedMs = Date.parse(m[1] + "T00:00:00Z");
    if (!Number.isFinite(updatedMs)) return;
    const ageDays = (Date.now() - updatedMs) / (24 * 60 * 60 * 1000);
    if (ageDays > 3) {
      process.stderr.write(
        `[delivery-gate WARN] orgs/${project}/STATE.md stale (${Math.floor(ageDays)}d) — ` +
          `update before closing. (warn-only; not blocking)\n`
      );
    }
  } catch (_err) {
    // Fail open: an unresolvable project, missing git, or unreadable STATE.md warns about nothing.
  }
}

function main() {
  const root = process.env.KB_ROOT || path.resolve(__dirname, "..", "..");
  warnStaleState(readEvent(), root);

  const agentId = process.env.KB_AGENT_ID;
  // Fail open + silent when we cannot identify the agent.
  if (!agentId) {
    process.exit(0);
  }

  const sessionStart = Number(process.env.KB_SESSION_START);
  // Fail open + silent when we cannot determine when the session began.
  if (!Number.isFinite(sessionStart)) {
    process.exit(0);
  }

  const memFile = path.join(root, "memory", `${agentId}.md`);

  let mtimeSec = null;
  try {
    mtimeSec = fs.statSync(memFile).mtimeMs / 1000;
  } catch (_err) {
    // Missing or unreadable -> treat as not appended this session.
    mtimeSec = null;
  }

  if (mtimeSec !== null && mtimeSec >= sessionStart) {
    // Memory was appended this session — nothing to warn about.
    process.exit(0);
  }

  process.stderr.write(
    `[delivery-gate WARN] memory/${agentId}.md was not updated this session — ` +
      `capture what you learned (see skills/curated/growth-log/SKILL.md) ` +
      `before finishing. (warn-only; not blocking)\n`
  );
  process.exit(0);
}

main();

#!/usr/bin/env node
/*
 * kb delivery-gate Stop hook — WARN-ONLY memory-append check.
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
 *   - KB_AGENT_ID absent            -> exit 0, silent (fail open).
 *   - KB_SESSION_START unparseable  -> exit 0, silent (fail open).
 *   - memory/<agent-id>.md mtime >= session start -> exit 0, silent
 *     (learning captured this session).
 *   - otherwise (stale or missing)  -> stderr "[delivery-gate WARN] ...",
 *     exit 0.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function main() {
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

  const root = process.env.KB_ROOT || path.resolve(__dirname, "..", "..");
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

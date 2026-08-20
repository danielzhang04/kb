#!/usr/bin/env node
/*
 * kb model-verify AUDIT — the shared append-only log and the governance/model-routing.yaml reader
 * used by the two INERT model-verify hooks (PreToolUse-on-dispatch, matching Agent or its alias
 * Task, and SubagentStop).
 *
 * Status:
 *   INERT. Nothing in .claude/settings*.json references the hooks that use this module. Arming
 *   snippet and decision-notes: docs/proposals/spawn-model-verify-hooks.md.
 *
 * ── WHY AN AUDIT LOG AND NOT A BLOCK ────────────────────────────────────────────────────────────
 * BOSS.md already requires the model of every dispatched subagent to be VERIFIED at grading time, by
 * grepping the subagent transcript for `"model":` — an ungraded dispatch is an unverified one, and the
 * check is manual, easy to skip, and only ever happens after the fact. This family writes the same
 * evidence down automatically. It is REPORT-ONLY on purpose: a hook that refuses a spawn because a
 * model string looked wrong would turn a bookkeeping check into a way to break dispatch, and the
 * routing policy it would be enforcing is itself only a default (card frontmatter and
 * queue/routing-override.yaml both outrank it). Report, never block.
 *
 * ── NO CLOCK IN A ROW ───────────────────────────────────────────────────────────────────────────
 * Rows carry ONLY fields the hook event supplied. Neither the SubagentStart/PreToolUse nor the
 * SubagentStop payload carries a timestamp, and Date.now() is deliberately NOT called: a hook whose
 * output varies run-to-run cannot be tested byte-for-byte, and this family's whole value is being
 * dependably checkable. Rows are therefore ordered but not stamped; the audit FILE's mtime is what
 * the dashboard route reports as "last written". See the decision-note in the proposal.
 *
 * ── WHERE THE LOG LIVES ─────────────────────────────────────────────────────────────────────────
 * `KB_MODEL_AUDIT_PATH`, else `<context-store dir>/model-audit.jsonl` — the same repo-external root
 * the U8 stores use (`DASHBOARD_STATE_ROOT/context-lifecycle` in the daemon, otherwise the desktop
 * `%LOCALAPPDATA%\kb-context-lifecycle` default). Outside every git worktree,
 * for the reasons recorded in .gitignore's DASHBOARD_STATE_ROOT comment: hook-written per-session
 * state is daemon-local, never coordination truth.
 *
 * Nothing here spawns, execs, or touches the network.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const io = require("./hook_io.js");
const store = require("./context_store.js");

const AUDIT_FILE_NAME = "model-audit.jsonl";

/** Refuse to read an absurd routing file or audit log into memory. Real ones are a few KiB. */
const MAX_READ_BYTES = 4 * 1024 * 1024;

/** The audit log path — `KB_MODEL_AUDIT_PATH`, else `<context-store dir>/model-audit.jsonl`. */
function auditPath(env) {
  const e = env || process.env;
  if (e.KB_MODEL_AUDIT_PATH) {
    return e.KB_MODEL_AUDIT_PATH;
  }
  return path.join(store.storeDir(e), AUDIT_FILE_NAME);
}

/** `governance/model-routing.yaml` — `KB_MODEL_ROUTING_PATH`, else the repo copy. READ-ONLY, always. */
function routingPath(env) {
  const e = env || process.env;
  if (e.KB_MODEL_ROUTING_PATH) {
    return e.KB_MODEL_ROUTING_PATH;
  }
  const root = e.KB_ROOT || path.resolve(__dirname, "..", "..", "..");
  return path.join(root, "governance", "model-routing.yaml");
}

/**
 * The set of model names a dispatch may legitimately ask for: every `known_models:` entry plus every
 * `aliases:` key AND target across all runtimes. So `sonnet`, `claude-sonnet-5`, `codex-deep` and
 * `gpt-5.6-sol` are all "allowed" — the routing file treats an alias and its target as the same
 * request, and a dispatch prompt writes whichever it likes.
 *
 * A HAND-ROLLED SCAN, DELIBERATELY. Hooks take no dependencies (they run on whatever node the harness
 * has, with no install step), so there is no YAML parser available and this reads the two shapes it
 * needs off the lines rather than parsing the document. That is a real limitation, not a hidden one:
 * it understands flow-style `known_models: [a, b]` and two-space-nested `aliases:` maps, which is how
 * governance/model-routing.yaml is written, and it would silently miss a block-style rewrite. The
 * failure mode is benign — an unrecognised model is reported `unknown`, never blocked — and
 * tests/test_model_verify.py pins the parse against the COMMITTED governance file so a reformat there
 * fails a test instead of quietly degrading the audit.
 */
function parseAllowedModels(text) {
  const allowed = new Set();
  if (typeof text !== "string") {
    return allowed;
  }
  let aliasIndent = -1;
  for (const rawLine of text.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const indent = rawLine.length - rawLine.replace(/^\s*/, "").length;

    const known = /^\s*known_models:\s*\[([^\]]*)\]/.exec(rawLine);
    if (known) {
      for (const item of known[1].split(",")) {
        const name = item.trim().replace(/^["']|["']$/g, "");
        if (name) allowed.add(name);
      }
      continue;
    }

    if (/^\s*aliases:\s*$/.test(rawLine)) {
      aliasIndent = indent;
      continue;
    }

    if (aliasIndent >= 0) {
      if (indent <= aliasIndent) {
        aliasIndent = -1; // dedented out of the aliases block
      } else {
        const pair = /^\s*([A-Za-z0-9_.-]+):\s*([A-Za-z0-9_.-]+)/.exec(rawLine);
        if (pair) {
          allowed.add(pair[1]);
          allowed.add(pair[2]);
        }
        continue;
      }
    }
  }
  return allowed;
}

/** Read + parse the routing policy. Missing/unreadable/oversized -> an EMPTY set (fail open). */
function allowedModels(env) {
  const file = routingPath(env);
  try {
    if (fs.statSync(file).size > MAX_READ_BYTES) {
      return new Set();
    }
    return parseAllowedModels(fs.readFileSync(file, "utf8"));
  } catch (_err) {
    return new Set();
  }
}

/**
 * The verdict for one requested model.
 *   'unspecified' — the dispatch named no model. NORMAL: routing resolves a default, and BOSS.md's
 *                   rule is that the model is verified at grading, not that it must be named inline.
 *   'allowed'     — the name is in the routing policy.
 *   'unknown'     — the name is NOT in the policy (a typo, a retired model, or a policy that needs
 *                   updating). Reported, never blocked.
 *   'unverified'  — the policy itself could not be read, so nothing can be said either way.
 */
function verdictFor(requested, allowed) {
  if (typeof requested !== "string" || !requested.trim()) {
    return "unspecified";
  }
  if (!allowed || allowed.size === 0) {
    return "unverified";
  }
  return allowed.has(requested.trim()) ? "allowed" : "unknown";
}

/**
 * Append one row as a single JSONL line. Returns true on success, false on ANY failure (never throws).
 *
 * One `appendFileSync` of one short line opened O_APPEND is what keeps concurrent hooks from
 * interleaving halfway through a row — several sessions dispatch at once on this machine. Rows are
 * never rewritten, so there is no torn-file case to handle the way the U8 store needs write-then-rename.
 */
function appendRow(row, env) {
  const file = auditPath(env);
  let line;
  try {
    line = JSON.stringify(row) + "\n";
  } catch (_err) {
    return false; // an unserialisable row is dropped, never thrown
  }
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line, "utf8");
    return true;
  } catch (_err) {
    return false;
  }
}

/** Read the log back into rows, skipping unparseable lines. Missing/unreadable -> [] (fail open). */
function readRows(env) {
  const file = auditPath(env);
  let text;
  try {
    if (fs.statSync(file).size > MAX_READ_BYTES) {
      return [];
    }
    text = fs.readFileSync(file, "utf8");
  } catch (_err) {
    return [];
  }
  return io.parseJsonLines(text).filter((row) => row && typeof row === "object");
}

module.exports = {
  allowedModels,
  appendRow,
  auditPath,
  parseAllowedModels,
  readRows,
  verdictFor,
};

#!/usr/bin/env node
/**
 * kb config-protection hook (W2.2) — PreToolUse:Edit|Write guard.
 *
 * source: ecc@2.0.0/scripts/hooks/config-protection.js
 * imported: 2026-07-19
 * provenance-tier: imported
 *
 * ECC's hook blocks edits to a fixed SET of linter/formatter config *basenames*
 * (.eslintrc, prettier.config.js, ...) wherever they live. kb's constitution
 * protects a different, location-sensitive target set, so the basename SET and
 * "first-time creation is allowed" logic are REPLACED with a path-relative-to-
 * repo-root classifier. Everything else — the exportable run()/parseInput()
 * shape, the MAX_STDIN cap, the truncation fail-closed guard, and the stdin
 * fallback that echoes raw on allow — is kept from ECC verbatim in spirit.
 *
 * Contract (Daniel-approved, block-mode from day one — enforces an existing
 * absolute rule: "governance/ and CLAUDE.md are human-edited only"):
 *   - Reads the PreToolUse hook JSON on stdin; target = tool_input.file_path
 *     (falls back to tool_input.file, as ECC did).
 *   - Resolves the target against the repo root. Root is resolved from this
 *     script's own location (scripts/hooks -> repo root, two up), overridable
 *     via KB_ROOT for tests. An absolute file_path is honored as-is.
 *   - BLOCK (exit 2 + stderr reason) when the resolved target is:
 *       * anything under the repo-root governance/ directory (governance/**), OR
 *       * the repo-root constitution mirror CLAUDE.md / AGENTS.md / GEMINI.md
 *         (repo root ONLY — orgs/<proj>/CLAUDE.md is a per-project file, allowed).
 *   - exit 0 otherwise, INCLUDING paths that merely contain those substrings
 *     elsewhere (e.g. docs/governance-notes.md), targets outside the repo root,
 *     missing file_path, and unparseable input (fail open).
 *
 * Exit codes:
 *   0 = allow (not a protected path, outside repo, missing path, or fail-open)
 *   2 = block (write to a protected constitution/governance path)
 */

'use strict';

const path = require('path');

const MAX_STDIN = 1024 * 1024;
let raw = '';

// Repo-root constitution mirrors — protected at the repo root ONLY.
const CONSTITUTION_FILES = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']);
// Repo-root directory whose entire subtree is human-edited only.
const PROTECTED_DIR = 'governance';

function repoRoot() {
  // Overridable via KB_ROOT for tests; otherwise resolved from this script's
  // location (scripts/hooks/config_protection.js -> repo root).
  return process.env.KB_ROOT || path.resolve(__dirname, '..', '..');
}

function parseInput(inputOrRaw) {
  if (typeof inputOrRaw === 'string') {
    try {
      return inputOrRaw.trim() ? JSON.parse(inputOrRaw) : {};
    } catch {
      return {};
    }
  }

  return inputOrRaw && typeof inputOrRaw === 'object' ? inputOrRaw : {};
}

/**
 * Classify a target path (relative to root) as protected or not.
 * Returns 'governance', 'constitution', or null.
 */
function classify(filePath, root) {
  // Resolve against the repo root. An absolute file_path wins; a relative one
  // resolves against root.
  const abs = path.resolve(root, filePath);
  const rel = path.relative(root, abs);

  // Empty (== root itself), an ".." escape, or a drive-absolute leftover means
  // the target is outside the repo root — not our concern.
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }

  // Split into segments, tolerating either separator on the way in.
  const parts = rel.split(/[\\/]+/).filter(Boolean);

  // governance/** — everything under the repo-root governance/ directory.
  if (parts[0] === PROTECTED_DIR) {
    return 'governance';
  }

  // Constitution mirrors — a single repo-root segment only.
  if (parts.length === 1 && CONSTITUTION_FILES.has(parts[0])) {
    return 'constitution';
  }

  return null;
}

/**
 * Exportable run() for in-process execution. Mirrors ECC's run()/options shape.
 */
function run(inputOrRaw, options = {}) {
  if (options.truncated) {
    return {
      exitCode: 2,
      stderr:
        `BLOCKED: Hook input exceeded ${options.maxStdin || MAX_STDIN} bytes. ` +
        'Refusing to bypass config-protection on a truncated payload. ' +
        'Retry with a smaller edit or disable the config-protection hook temporarily.'
    };
  }

  const input = parseInput(inputOrRaw);
  const filePath = input?.tool_input?.file_path || input?.tool_input?.file || '';
  // Fail open: nothing to protect without a target path.
  if (!filePath || typeof filePath !== 'string') return { exitCode: 0 };

  const kind = classify(filePath, repoRoot());
  if (!kind) return { exitCode: 0 };

  const reason =
    kind === 'governance'
      ? `governance/ files are human-edited only (see CLAUDE.md — "governance/ ` +
        `and CLAUDE.md are human-edited only").`
      : `the ${path.basename(filePath)} constitution is human-edited only ` +
        `(see CLAUDE.md — "governance/ and CLAUDE.md are human-edited only").`;

  return {
    exitCode: 2,
    stderr:
      `BLOCKED: Modifying ${filePath} is not allowed — ${reason} ` +
      'Propose the change to Daniel instead of editing it directly. ' +
      'If this is a sanctioned change, disable the config-protection hook temporarily.'
  };
}

module.exports = { run };

// Stdin fallback for spawnSync execution.
let truncated = /^(1|true|yes)$/i.test(String(process.env.ECC_HOOK_INPUT_TRUNCATED || ''));
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (raw.length < MAX_STDIN) {
    const remaining = MAX_STDIN - raw.length;
    raw += chunk.substring(0, remaining);
    if (chunk.length > remaining) truncated = true;
  } else {
    truncated = true;
  }
});

process.stdin.on('end', () => {
  const result = run(raw, {
    truncated,
    maxStdin: Number(process.env.ECC_HOOK_INPUT_MAX_BYTES) || MAX_STDIN
  });

  if (result.stderr) {
    process.stderr.write(result.stderr + '\n');
  }

  if (result.exitCode === 2) {
    process.exit(2);
  }

  process.stdout.write(raw);
});

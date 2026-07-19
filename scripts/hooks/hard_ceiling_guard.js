#!/usr/bin/env node
/**
 * kb PreToolUse:Bash hook — hard-ceiling + destructive-command guard (W2.1).
 *
 * source: ecc@2.0.0/scripts/hooks/gateguard-fact-force.js  (classifier machinery)
 * imported: 2026-07-19
 * provenance-tier: imported
 *
 * Consumes the retargeted GateGuard classifier (scripts/hooks/lib/
 * destructive_classifier.js) and applies the kb enforcement policy:
 *
 *   Category A — hard ceiling (credential-store access): reading/writing/minting
 *   credential stores (`.env` secrets files, `~/.ssh`, `~/.aws`, keyring/DPAPI,
 *   `claude setup-token`-style minting). BLOCK on day one (exit 2 + stderr) —
 *   this enforces the constitution's absolute ceiling.
 *
 *   Category B — generally destructive (recursive force delete, `git push
 *   --force`, history rewrites, disk-level ops). WARN only (exit 0 + stderr
 *   "[hard-ceiling WARN]"), like the delivery-gate: flip-to-block is a later card.
 *
 *   Benign commands (plain `git commit`, single-file `rm`, tests) — exit 0, silent.
 *
 * Category A is checked BEFORE Category B, so a command that is both (e.g.
 * `rm -rf ~/.ssh`) is blocked, not merely warned.
 *
 * Fail open: unparseable stdin or a missing command yields exit 0, silent — a
 * classifier crash must never wedge tool execution.
 *
 * Exit codes:
 *   0 = allow (benign, Category B warn, or fail-open)
 *   2 = block (Category A hard-ceiling violation)
 */

'use strict';

const { isDestructiveBash, isCredentialAccess } = require('./lib/destructive_classifier');

const MAX_STDIN = 1024 * 1024;
let raw = '';

/**
 * Extract the command string from the PreToolUse hook payload
 * (`{ tool_input: { command: "..." } }`). Returns '' when absent so the
 * caller fails open.
 */
function extractCommand(rawInput) {
  const trimmed = String(rawInput || '').trim();
  if (!trimmed.startsWith('{')) return '';
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (_) {
    return '';
  }
  if (typeof parsed !== 'object' || parsed === null) return '';
  const cmd = parsed.tool_input && parsed.tool_input.command;
  return typeof cmd === 'string' ? cmd : '';
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (raw.length < MAX_STDIN) {
    const remaining = MAX_STDIN - raw.length;
    raw += chunk.substring(0, remaining);
  }
});

process.stdin.on('end', () => {
  let command;
  try {
    command = extractCommand(raw);
  } catch (_) {
    process.exit(0); // fail open
  }

  if (!command) {
    process.exit(0); // nothing to classify — fail open / benign
  }

  try {
    // Category A first: the hard ceiling wins over the destructive warning.
    if (isCredentialAccess(command)) {
      process.stderr.write(
        '[hard-ceiling BLOCK] Credential-store access is forbidden by the constitution ' +
          '(never create/read/modify credential stores). Blocked command touching a ' +
          '.env secrets file, ~/.ssh, ~/.aws, an OS keyring/DPAPI, or a token-minting op.\n'
      );
      process.exit(2);
    }

    if (isDestructiveBash(command)) {
      process.stderr.write(
        '[hard-ceiling WARN] Generally destructive command detected (recursive force ' +
          'delete, force push, history rewrite, or disk-level op). Confirm targets and a ' +
          'rollback before proceeding. (Warn-only for now; flip-to-block is a later card.)\n'
      );
      process.exit(0);
    }
  } catch (_) {
    process.exit(0); // classifier failure must never wedge tool execution
  }

  process.exit(0); // benign
});

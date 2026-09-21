#!/usr/bin/env node
/**
 * kb PreToolUse hook — PROD window guard (2026-09-16, authority-and-guardrails T7).
 *
 * Tools: Bash, PowerShell, Agent, Write, Edit, MultiEdit.
 *
 * Settings snippet (PreToolUse matcher — the boss must apply this to
 * .claude/settings.local.json): matcher "Bash|PowerShell|Agent|Write|Edit".
 * (MultiEdit is matched too when present; the hook itself checks tool_name
 * for all three so no matcher change is needed if MultiEdit is added later.)
 *
 * This hook is a fast LOCAL SECOND LAYER, not the authority: the daemon's
 * server-side route policy table (dashboard/server/authority/policy.ts) is what
 * actually decides open | signed | none for every mutating route, verifies
 * signed-class SSHSIG approvals, and records the attributed audit row (spec
 * docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md §5). This
 * hook exists so a mistaken or malicious CLI invocation never reaches the daemon
 * in the first place.
 *
 * Prod-targeting scripts fall into three classes:
 *   OPEN class    — monitoring, launching workflows, resolving gates/interventions,
 *                   schedule management, and archiving a closed-out run (prod-archive-run.ps1,
 *                   O4). Runs with NO window, still only in its reviewed argument shape, still
 *                   subject to the standing blocks.
 *   WINDOWED class — deploy, drain, canary, stop, preflight, anything that drives a
 *                   signing key (prod-sign-approval.ps1, the kb-human-approval
 *                   ssh-keygen sign command), and anything that PLACES a signed call
 *                   (prod-signed-call.ps1, and prod-respond.ps1 ONLY when it carries
 *                   -Approval — C16; the plain no-Approval shape is OPEN class, O2).
 *                   Refused outside an explicitly opened prod window; anchored shapes
 *                   only inside one.
 *   (Standing blocks and the Agent-tool rule apply to every class identically.)
 *
 * Rules
 *   A  prod-targeting classification (see isProdTargeting): A4o = open-class
 *      script, A4w = windowed-class script
 *   B  window CLOSED  -> windowed-class BLOCKED; open-class allowed in its shape;
 *                       Agent allowed
 *   C  window OPEN    -> Agent BLOCKED; windowed-class allowed only if it matches
 *                       one of the anchored allowlist shapes below; open-class
 *                       unaffected by window state
 *   D  standing blocks, window or not, any tool (includes: direct writes to the
 *      window file itself, outside prod-window.ps1 — D9)
 *   E  audit line per prod-targeting decision and per Agent decision while open
 *   F  block => exit 2 + reason on stderr (same shape as hard_ceiling_guard.js);
 *      allow => exit 0 silent. FAIL CLOSED: any exception, any unparsable
 *      payload that smells of prod, and any oversize (>1 MiB) stdin all BLOCK.
 *   W  Write/Edit/MultiEdit: block only when file_path is the window file
 *      (any slash form, case-insensitive); every other file_path is allowed —
 *      this hook does not otherwise gate file edits.
 *   G  prod-window.ps1 itself is classified: allowed only in its exact
 *      -Open [-Hours N|-Minutes N] [-Step <word>] / -Close / -Status shapes,
 *      with no window requirement (it IS the window control); anything else
 *      targeting that script is blocked.
 *
 * Exit codes: 0 = allow, 2 = block.
 */

'use strict';

const fs = require('fs');
const crypto = require('crypto');

const PROD_HOST_IP = '100.89.73.118';
const PROD_URL = 'kb.tail82dd4f.ts.net';
const WINDOW_FILE = 'C:\\Users\\danie\\kb-rehearsal\\tooling\\PROD-WINDOW.json';
// Log DESTINATION only. It can never change an allow/deny decision — the window file path,
// the allowlist and the standing blocks are all hard-coded above and below on purpose.
const AUDIT_LOG = process.env.KB_PROD_WINDOW_AUDIT
  || 'C:\\Users\\danie\\kb-rehearsal\\tooling\\prod-window-audit.log';
const MAX_WINDOW_MS = 3 * 60 * 60 * 1000;

const DEPLOY_SHA = '7e09fd4fcbae5e66299af3c756041b49437fc6b3';
const BROKER_DIGEST = '4586d91930a1b4f00f350a2b5324a9347073b10d67c9cf0edfd47abe4f988c2b';

// A-2: O4 (prod-archive-run.ps1) lives under the main, branch-switching checkout (KBDIR), not the
// tighter-controlled kb-rehearsal tooling tree every other allowlisted script lives under, so its
// path match alone proves nothing about its CONTENT. Pinned like C2's DEPLOY_SHA/BROKER_DIGEST.
// KB_ARCHIVE_SCRIPT_PATH is a test-only override (mirrors KB_PROD_WINDOW_AUDIT's pattern) — real
// fleet runs never set it, so the real KBDIR path below is always what actually executes.
const ARCHIVE_SCRIPT_REAL_PATH = 'C:\\Users\\danie\\kb\\scripts\\prod\\prod-archive-run.ps1';
const ARCHIVE_SCRIPT_PATH = process.env.KB_ARCHIVE_SCRIPT_PATH || ARCHIVE_SCRIPT_REAL_PATH;
const ARCHIVE_SCRIPT_SHA256 = 'bb3c056a3ce476cac59f3a70991d893d75d7c87721b01ca82442b041f3a6b958';

const MAX_STDIN = 1024 * 1024;

/* ------------------------------------------------------------------ helpers */

/** Collapse all whitespace runs to one space, trim, lowercase. */
function norm(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().toLowerCase();
}

/** Mask secret-bearing argument VALUES before anything is written to the log. */
function maskSecrets(s) {
  let out = String(s == null ? '' : s);
  out = out.replace(/(-signingkey\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1<key>');
  // prod-sign-approval.ps1's signing key arrives as -Key, not -SigningKey.
  out = out.replace(/(-key\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1<key>');
  out = out.replace(/(ssh-keygen\b[^\n]*?\s-f\s+)("[^"]*"|'[^']*'|\S+)/gi, '$1<key>');
  return out;
}

/* ------------------------------------------------------------- path regexes */

const B = '[\\\\/]';                                              // path separator
const T = 'c:' + B + 'users' + B + 'danie' + B + 'kb-rehearsal' + B + 'tooling';
const KBDIR = 'c:' + B + 'users' + B + 'danie' + B + 'kb';
const BACKUPS = 'c:' + B + 'users' + B + 'danie' + B + 'kb-backups';

/** An optionally quoted path under T; `rel` uses `/` separators. */
function P(rel) {
  const body = rel.split('/').map(function (seg) { return seg.replace(/\./g, '\\.'); }).join(B);
  return '["\']?' + T + B + body + '["\']?';
}

// Optional command prefixes the allowlist tolerates, in any order/repetition:
//   cd C:\Users\danie\kb && | ;
//   $env:KB_PROD_WINDOW=(Get-Content <T>\PROD-WINDOW.json | ConvertFrom-Json).token;
const CD_PRE = '(?:cd\\s+["\']?' + KBDIR + '["\']?\\s*(?:&&|;)\\s*)';
const ENV_PRE = '(?:\\$env:kb_prod_window\\s*=\\s*\\(\\s*get-content\\s+(?:-raw\\s+)?["\']?'
  + T + B + 'prod-window\\.json["\']?\\s*\\|\\s*convertfrom-json\\s*\\)\\.token\\s*;\\s*)';
const PRE = '^(?:' + CD_PRE + '|' + ENV_PRE + ')*';

const PS = 'powershell(?:\\.exe)?\\s+-noprofile\\s+-executionpolicy\\s+bypass\\s+';

// SAFE_ARG — the one shared "no shell/PowerShell metacharacters" discipline for every
// key/path/free-text argument the allowlist captures (SigningKey, -f key path, -Key, -Reason,
// and anything else that used to be a bare `\S+`/`"[^"]*"` catch-all). Forbidden EVERYWHERE the
// class is used, quoted or not: backtick, `$` (blocks `$(...)`, `$env:...`, and bare variable
// refs alike), `;`, `&`, `|`, `%` (blocks `%VAR%` cmd.exe expansion), CR/LF, and — N3 — the
// parenthesis/angle-bracket/brace family: `(`/`)` (PowerShell EVALUATES a bare or quoted
// sub-expression like `-SigningKey (hostname)` before the script ever sees it — no `$` needed),
// `<`/`>` (bash process substitution `<(cmd)`/`>(cmd)` runs the command with no `$` either), and
// `{`/`}` for good measure (script-block/grouping syntax). A real key path, reason, or route
// template contains none of these, so the tightening costs nothing legitimate. Quoted forms
// also cannot contain the opposite... no: neither quote character, so a value cannot smuggle a
// second, differently-quoted argument.
const SAFE_INNER = '[^`$;&|%()<>{}\\r\\n"\']';            // one safe char inside quotes (spaces OK)
const SAFE_UNQUOTED = '[^\\s`$;&|%()<>{}\\r\\n"\']';       // one safe char with no quoting (no spaces)
const SAFE_ARG = '(?:"' + SAFE_INNER + '*"|\'' + SAFE_INNER + '*\'|' + SAFE_UNQUOTED + '+)';
// PATHARG is SAFE_ARG under its old name — kept as an alias so every existing call site (C2, C4,
// C13's -Key, C14) picks up the tightened grammar with no other changes.
const PATHARG = SAFE_ARG;

// A-1 fix: rehearsal argument groups, embeddable INSIDE an anchored allowlist shape at the exact
// position the target script's own param block accepts them (read from each script under
// kb-rehearsal\tooling with the Read tool before wiring these in). Before this fix, isRehearsal()
// (below) recognising one of these tokens ANYWHERE in the command short-circuited classification
// entirely, so a well-formed rehearsal marker waived not just the prod window but the ENTIRE
// shape grammar — including O4's/C2's metacharacter exclusion, which is how a `-Reason "ok
// $(Get-Date)"` payload rode past every check (review finding A-1, probe1/probe2). Now these
// groups are part of the grammar itself: a rehearsal invocation must still match one of the
// reviewed shapes end-to-end (openMatch/allowlistMatch always run — see decide()), and
// isRehearsal() is consulted ONLY to decide whether the WINDOW requirement is waived, never
// whether shape validation runs at all.
const VM_LOCALHOST_ARG_GROUP = '(?:\\s+-vm\\s+["\']?root@localhost["\']?)?';
const URL_REHEARSAL_ARG_GROUP = '(?:\\s+-url\\s+["\']?https?://(?:127\\.0\\.0\\.1|localhost):(?:4317|4417)["\']?)?';
const SSHSHIMDIR_ARG_GROUP = '(?:\\s+-sshshimdir\\s+' + PATHARG + ')?';
// -SshShimDir prepends its value onto PATH for every ssh/scp call the script makes (kb-deploy.ps1,
// vm-preflight-prod.ps1, the drain-v2 scripts), REGARDLESS of what -VM resolves to — a shimmed
// "ssh"/"scp" on that PATH would be picked up even on an invocation still pointed at real prod.
// It must never be independently reachable; it is only ever safe nested immediately after a
// genuine rehearsal -VM root@localhost marker, never as its own top-level optional group.
function vmRehearsalGroup(includeUrl) {
  return '(?:\\s+-vm\\s+["\']?root@localhost["\']?'
    + (includeUrl ? URL_REHEARSAL_ARG_GROUP : '')
    + SSHSHIMDIR_ARG_GROUP + ')?';
}

// Optionally quoted paths under the tooling tree (SAFE_T), under the tooling tree's `rehearsal`
// subtree (SAFE_T_REHEARSAL), or under either the tooling tree or kb-backups
// (SAFE_T_OR_BACKUPS) — each with a `..` traversal veto, the same discipline P() uses for fixed
// filenames.
const NO_TRAVERSAL = '(?!.*\\.\\.)[a-z0-9_.\\\\/-]+';
const SAFE_T = '["\']?' + T + B + NO_TRAVERSAL + '["\']?';
const SAFE_T_REHEARSAL = '["\']?' + T + B + 'rehearsal' + B + NO_TRAVERSAL + '["\']?';
const SAFE_T_OR_BACKUPS = '["\']?(?:' + T + '|' + BACKUPS + ')' + B + NO_TRAVERSAL + '["\']?';

/* --------------------------------------------------------- allowlist shapes */

// C1 — preflight. `-SignersFile` belongs to the explicit-only `-Step approver-signers` action
// (install the PUBLIC human-approver allowed-signers file + the unit's Environment= line, which a
// release deploy does NOT reinstall). It defaults to the prod public file, so prod needs no
// argument at all; the parameter exists so the rehearsal host can be handed a throwaway public
// key instead, and is therefore constrained to a non-traversing path under the tooling tree.
// A-1: vm-preflight-prod.ps1's own -VM param (rehearsal-only; the script's header names this
// exact exemption) and -SshShimDir (the rehearsal WSL sshd's Git-Bash shim dir) are now part of
// the grammar, not a classifier bypass.
const C1 = new RegExp(PRE + PS + '-file\\s+' + P('vm-preflight-prod.ps1')
  + '(?:\\s+-step\\s+[a-z0-9_-]+(?:\\s+-signersfile\\s+' + SAFE_T + ')?)?'
  + vmRehearsalGroup(false) + '$');

// C2 — the deploy, pinned sha + broker digest, plus the script's own rehearsal-only -VM/-URL/
// -SshShimDir params (A-1: now grammar, not a bypass — see kb-deploy.ps1's own header comment).
const C2 = new RegExp(PRE + PS + '-file\\s+' + P('kb-deploy.ps1')
  + '\\s+-signingkey\\s+' + PATHARG
  + '\\s+-sha\\s+' + DEPLOY_SHA
  + '\\s+-brokerdigest\\s+' + BROKER_DIGEST
  + vmRehearsalGroup(true) + '$');

// C3/C5 — the three `-Command "& '<script>'"` drain shapes. A-1: each of these scripts' own
// header documents a "REHEARSAL: add -VM/-URL/.../-SshShimDir" override set; those are now
// anchored, optional groups INSIDE the quoted command string (the only place PowerShell -Command
// accepts them here), not a classifier bypass.
function cmdShape(rel) {
  const body = rel.split('/').map(function (s) { return s.replace(/\./g, '\\.'); }).join(B);
  return new RegExp(PRE + PS + '-command\\s+"\\s*&\\s*\'' + T + B + body + '\''
    + vmRehearsalGroup(true) + '\\s*"$');
}
const C3 = cmdShape('drain-v2/drain-step1-v2.ps1');
const C5A = cmdShape('drain-v2/drain-step2-v2.ps1');
const C5B = cmdShape('drain-v2/ops-refresh.ps1');

// C4 — Daniel's one signature of the morning
const C4 = new RegExp('^ssh-keygen\\s+-y\\s+sign\\s+-f\\s+' + PATHARG
  + '\\s+-n\\s+kb-ops-instructions\\s+["\']?' + BACKUPS + B
  + 'outbox-approval-current' + B + 'instruction-approval\\.json["\']?$');

// C6 — stop / canary
const C6A = new RegExp(PRE + PS + '-file\\s+' + P('prod-stop-run.ps1') + '$');
const C6B = new RegExp(PRE + PS + '-file\\s+' + P('prod-canary-launch.ps1')
  + '(?:\\s+-topic\\s+tailnet-trust)?$');

// O1 — generic workflow runner, OPEN class: any safe workflow id, no window needed.
const O1 = new RegExp(PRE + PS + '-file\\s+' + P('prod-run-workflow.ps1')
  + '\\s+-workflow\\s+([a-z0-9][a-z0-9-]{0,60})'
  + '(?:\\s+-topic\\s+([a-z0-9._-]{1,40}))?'
  + URL_REHEARSAL_ARG_GROUP + '$');

// O2 — prod-respond.ps1, OPEN class: resolve a gate/intervention with a safe reason.
// Built from the same SAFE_INNER class as SAFE_ARG above (backtick, `$`, `;`, `&`, `|`, `%`,
// CR/LF all forbidden) but sized for free text (1-300 chars) rather than a single token.
// -Actor is optional; when present it is recorded verbatim on the audit line (never trusted
// for authority — same non-authority property as the daemon's X-KB-Actor header, spec §4.3).
const REASON = '("' + SAFE_INNER + '{1,300}"|\'' + SAFE_INNER + '{1,300}\')';
const ACTOR_ARG = '(daniel|boss|worker:[a-z0-9][a-z0-9._-]{0,63})';
const O2 = new RegExp(PRE + PS + '-file\\s+' + P('prod-respond.ps1')
  + '\\s+-run\\s+([a-z0-9-]{1,80})\\s+-request\\s+([a-z0-9-]{1,80})'
  + '\\s+-decision\\s+(approve|retry|abandon)\\s+-reason\\s+' + REASON
  + '(?:\\s+-actor\\s+' + ACTOR_ARG + ')?'
  + URL_REHEARSAL_ARG_GROUP + '$');

// O3 — prod-schedules.ps1's four modes, OPEN class. `tpath` matches an optionally quoted path
// under T (the -List's -Out) or under a fixed subfolder of T (the snapshot paths), with a `..`
// traversal veto — the same discipline P() uses for fixed filenames.
function tpath(subSegments) {
  const prefix = subSegments.map(function (s) { return s.replace(/\./g, '\\.'); }).join(B);
  const afterT = prefix === '' ? '' : (prefix + B);
  return '["\']?' + T + B + afterT + '(?!.*\\.\\.)[a-z0-9_.\\\\/-]+["\']?';
}
const O3_LIST = new RegExp(PRE + PS + '-file\\s+' + P('prod-schedules.ps1')
  + '\\s+-list(?:\\s+-out\\s+' + tpath([]) + ')?' + URL_REHEARSAL_ARG_GROUP + '$');
const O3_DISARM = new RegExp(PRE + PS + '-file\\s+' + P('prod-schedules.ps1')
  + '\\s+-disarmagentcadences\\s+-snapshot\\s+' + tpath(['rehearsal', 'p8']) + URL_REHEARSAL_ARG_GROUP + '$');
const O3_ARM = new RegExp(PRE + PS + '-file\\s+' + P('prod-schedules.ps1')
  + '\\s+-armfromsnapshot\\s+' + tpath(['rehearsal', 'p8']) + URL_REHEARSAL_ARG_GROUP + '$');
const CRON_ARG = '("[0-9*/,\\s-]{9,40}"|\'[0-9*/,\\s-]{9,40}\')';
const O3_CREATE = new RegExp(PRE + PS + '-file\\s+' + P('prod-schedules.ps1')
  + '\\s+-createworkflowschedule\\s+self-lint-report\\s+-cron\\s+' + CRON_ARG + URL_REHEARSAL_ARG_GROUP + '$');

// O4 — prod-archive-run.ps1, OPEN class: archive a terminal/closed-out run with an audited
// reason. Mirrors O2's grammar exactly (same REASON/ACTOR_ARG classes as prod-respond.ps1's plain
// shape). Unlike every other allowlisted script this one lives IN THE REPO (scripts/prod/), not
// the kb-rehearsal tooling tree, so it gets its own KBDIR-anchored path matcher (PKB) instead of
// reusing P() (which is hard-coded to T).
function PKB(rel) {
  const body = rel.split('/').map(function (seg) { return seg.replace(/\./g, '\\.'); }).join(B);
  return '["\']?' + KBDIR + B + body + '["\']?';
}
const O4 = new RegExp(PRE + PS + '-file\\s+' + PKB('scripts/prod/prod-archive-run.ps1')
  + '\\s+-run\\s+([a-z0-9-]{1,80})\\s+-reason\\s+' + REASON
  + '(?:\\s+-actor\\s+' + ACTOR_ARG + ')?'
  + URL_REHEARSAL_ARG_GROUP + '$');

/**
 * A-2: O4's shape match proves the COMMAND is well-formed, not that the SCRIPT at that path is the
 * reviewed one — the main checkout at KBDIR is not content-pinned and routinely switches branches
 * (unlike every other allowlisted script, which lives under the tighter-controlled kb-rehearsal
 * tooling tree). Mirrors C2's DEPLOY_SHA/BROKER_DIGEST pattern: read the file the O4 shape actually
 * names, normalize CRLF->LF (git autocrlf on this checkout must not desync the pin), sha256 it, and
 * compare. Missing/unreadable file fails closed the same as a mismatch.
 */
function archiveScriptDigestOk() {
  let raw;
  try {
    raw = fs.readFileSync(ARCHIVE_SCRIPT_PATH, 'utf8');
  } catch (_) {
    return false;
  }
  const normalized = raw.replace(/\r\n/g, '\n');
  const digest = crypto.createHash('sha256').update(normalized, 'utf8').digest('hex');
  return digest === ARCHIVE_SCRIPT_SHA256;
}

// The classifier signal that guards O4 the same way PROD_RESPOND_APPROVAL_SCRIPT guards O2/C16:
// prod-archive-run.ps1 named alongside a genuine -Approval token must NEVER be treated as O4.
// O4's grammar has no -Approval branch at all, so this never actually matches today — it exists so
// the invariant is explicit rather than incidental if O4 is ever extended.
const PROD_ARCHIVE_APPROVAL_GUARD = /prod-archive-run\.ps1\b[\s\S]*(?:^|\s)-approval(?:\s|$)/;

// A quoted "<METHOD> /api/..." route template, shared by the two signed-channel helpers below.
const ROUTE_ARG = '("[a-z]+ /api/[a-z0-9/:_-]{1,120}"|\'[a-z]+ /api/[a-z0-9/:_-]{1,120}\')';

// C13 — prod-sign-approval.ps1, WINDOWED class (it drives the human-approval signing key).
// The shape is the one the SCRIPT takes: -Key and -Out are [Parameter(Mandatory = $true)] and the
// TTL parameter is -ExpiresMinutes. The earlier shape here named -TtlMinutes/-SigningKey and made
// -Key/-Out optional, so the only invocations it allowed were ones PowerShell would refuse before
// the script ran, and the only invocation that works was refused by this hook.
function signApprovalShape(keyArg, outArg) {
  return new RegExp(PRE + PS + '-file\\s+' + P('prod-sign-approval.ps1')
    + '\\s+-route\\s+' + ROUTE_ARG
    + '\\s+-entity\\s+([a-z0-9._:-]{1,120})'
    + '(?:\\s+-actor\\s+daniel)?'
    + '(?:\\s+-expiresminutes\\s+([0-9]{1,2}))?'
    + '\\s+-key\\s+' + keyArg
    + '\\s+-out\\s+' + outArg
    + '(?:\\s+-dryrun)?$');
}
const C13 = signApprovalShape(PATHARG, SAFE_T_OR_BACKUPS);

// The same shape with the key pinned to the tooling tree's `rehearsal` subtree: the rehearsal
// exemption in isRehearsal() below. It is anchored to the WHOLE command on purpose — a rehearsal
// key must not be able to carry an unrelated prod command past the classifier on the same line.
const REHEARSAL_SIGN = signApprovalShape(SAFE_T_REHEARSAL, SAFE_T);

// C15 — prod-signed-call.ps1, WINDOWED class. It is the one script that actually PLACES a signed,
// consequential call at the prod-defaulted URL, so its shape is anchored like the deploy's:
//   -Route "<METHOD /api/...>" -Approval <path> [-BodyFile <path>] [-Actor <actor>] [-DryRun]
// The approval file must live under the tooling tree or kb-backups (no traversal), and an INLINE
// -Body is deliberately refused — its JSON carries quotes and braces that the `powershell -File`
// argument parser mangles (documented in the script's own header), so the reviewed prod shape is
// -BodyFile only. Argument ORDER is pinned, same discipline as every other C-shape.
const C15 = new RegExp(PRE + PS + '-file\\s+' + P('prod-signed-call.ps1')
  + '\\s+-route\\s+' + ROUTE_ARG
  + '\\s+-approval\\s+' + SAFE_T_OR_BACKUPS
  + '(?:\\s+-bodyfile\\s+' + SAFE_T_OR_BACKUPS + ')?'
  + '(?:\\s+-actor\\s+' + ACTOR_ARG + ')?'
  + URL_REHEARSAL_ARG_GROUP
  + '(?:\\s+-dryrun)?$');

// C14 — the human-approval signature itself, WINDOWED class (spec's kb-human-approval namespace,
// distinct from C4's kb-ops-instructions drain-approval namespace).
const C14 = new RegExp('^ssh-keygen\\s+-y\\s+sign\\s+-f\\s+' + PATHARG
  + '\\s+-n\\s+kb-human-approval\\s+["\']?' + BACKUPS + B
  + 'approval-current' + B + 'payload\\.json["\']?$');

// C16 — prod-respond.ps1 CARRYING -Approval, WINDOWED class. Plain O2 (no -Approval) stays OPEN
// class — this is the narrower, windowed variant that carries a signed human/iteration-gate
// approval, same belt-and-braces posture as C13/C15/C14. -Approval must resolve to a path under
// the tooling tree or kb-backups (no traversal), matching C13's -Out / C15's -Approval. Argument
// order is pinned like every other C-shape: -Run -Request -Decision -Reason [-Actor] -Approval
// [-DryRun].
const C16 = new RegExp(PRE + PS + '-file\\s+' + P('prod-respond.ps1')
  + '\\s+-run\\s+([a-z0-9-]{1,80})\\s+-request\\s+([a-z0-9-]{1,80})'
  + '\\s+-decision\\s+(approve|retry|abandon)\\s+-reason\\s+' + REASON
  + '(?:\\s+-actor\\s+' + ACTOR_ARG + ')?'
  + '\\s+-approval\\s+' + SAFE_T_OR_BACKUPS
  + URL_REHEARSAL_ARG_GROUP
  + '(?:\\s+-dryrun)?$');

// The classifier signal for C16: prod-respond.ps1 named ALONGSIDE a genuine `-Approval` argument
// token. Checked BEFORE OPEN_SCRIPTS in isProdTargeting so a `-Approval`-carrying invocation is
// NEVER treated as the open-class O2 shape, whether or not it matches C16's exact grammar (an
// almost-right -Approval invocation must still be refused as a malformed WINDOWED command, not
// silently fall through to open-class and be waved through unmatched). Whitespace-bounded, so a
// `-Reason` value that merely CONTAINS the substring "-approval" also trips this — a conservative
// (more-restrictive, never less-restrictive) false positive, not a hole.
const PROD_RESPOND_APPROVAL_SCRIPT = /prod-respond\.ps1\b[\s\S]*(?:^|\s)-approval(?:\s|$)/;

// G — prod-window.ps1 itself (HOOK-BLOCKER-6). It was in neither class list, so any shape at all
// reached it unexamined. It needs no window (it IS the window control) but is anchored to exactly
// its three real modes: -Open [-Hours N|-Minutes N] [-Step <word>], -Close, -Status.
const PW_OPEN = new RegExp(PRE + PS + '-file\\s+' + P('prod-window.ps1')
  + '\\s+-open(?:\\s+-hours\\s+([0-9]{1,2})|\\s+-minutes\\s+([0-9]{1,3}))?'
  + '(?:\\s+-step\\s+([a-z][a-z0-9-]{0,40}))?$');
const PW_CLOSE = new RegExp(PRE + PS + '-file\\s+' + P('prod-window.ps1') + '\\s+-close$');
const PW_STATUS = new RegExp(PRE + PS + '-file\\s+' + P('prod-window.ps1') + '\\s+-status$');

// C7 — root ssh, read verbs only
const SSH_ROOT = new RegExp('^ssh\\s+-o\\s+batchmode=yes\\s+root@'
  + PROD_HOST_IP.replace(/\./g, '\\.') + '\\s+(.*)$');

const READ_VERBS = [
  /^hostname$/,
  /^id -u$/,
  /^systemctl is-active kb-dashboard$/,
  /^systemctl is-active kb-shell-broker\.socket$/,
  /^readlink \/opt\/kb-releases\/current$/,
  /^readlink \/opt\/kb-releases\/previous$/,
  /^ls \/opt\/kb-releases$/,
  /^ls \/var\/lib\/kb\/state\/outbox\/ready$/,
  /^ls \/var\/lib\/kb\/state\/outbox\/receipts$/,
  /^ls \/var\/lib\/kb\/ops\/\.git$/,
  /^journalctl -u kb-dashboard -n \d{1,5} --no-pager -o cat$/,
  /^sshd -t$/,                                   // `sshd -T` after lowercasing
  /^ls -ld \/var\/lib\/kb-reader$/,
  /^sha256sum \/usr\/local\/lib\/kb\/reader_shell\.sh$/,
  // vm-step-recover-prep.sh writes NO MANIFEST; it copies the control documents to
  // /root/pre-fix-<ts>. The equivalent read is listing those backup directories.
  /^ls -d \/root\/pre-fix-\*$/,
  /^ls(?: -la?)? \/root\/pre-fix-\*$/
];

function isReadVerb(raw) {
  let body = String(raw).trim();
  const q = body.charAt(0);
  if ((q === '"' || q === "'") && body.charAt(body.length - 1) === q) body = body.slice(1, -1).trim();
  if (body === '') return false;
  const parts = body.split(';').map(function (p) { return p.trim(); }).filter(function (p) { return p !== ''; });
  if (parts.length === 0) return false;
  return parts.every(function (p) {
    return READ_VERBS.some(function (re) { return re.test(p); });
  });
}

/* --------------------------------------------- A: prod-targeting classifier */

// Scripts in T whose DEFAULTS point at prod. Invoking one is prod-targeting even
// though the command string names neither the host nor the URL. Split into the
// two authority classes (spec §4.7): OPEN needs no window; WINDOWED still does.
const OPEN_SCRIPTS = /(prod-run-workflow\.ps1|prod-respond\.ps1|prod-schedules\.ps1|prod-archive-run\.ps1)/;
const WINDOWED_SCRIPTS = /(kb-deploy\.ps1|drain-step[12]-v2\.ps1|ops-refresh\.ps1|vm-preflight-prod\.ps1|prod-stop-run\.ps1|prod-canary-launch\.ps1|prod-sign-approval\.ps1|prod-signed-call\.ps1)/;
// prod-window.ps1 is its own class (G): no window requirement, but only its three exact shapes.
const WINDOW_MGMT_SCRIPT = /prod-window\.ps1/;

/**
 * `ssh [-o BatchMode=yes] kb-reader ...` — the read-only identity, never prod-targeting.
 * Anchored to the WHOLE command (HOOK-BLOCKER-1): the old regex was a prefix test consumed only
 * up to the first `\s`, so anything chained after `kb-reader hostname` via `;`/`&`/`|` rode along
 * unexamined. The remote-command argument (quoted or not) is restricted to the same
 * no-shell-metacharacter set as SAFE_ARG, so nothing after `kb-reader` can itself carry a second
 * command.
 */
function isKbReaderRead(n) {
  if (/root@/.test(n)) return false;
  if (/(curl|invoke-restmethod|invoke-webrequest|iwr\b|irm\b)/.test(n)) return false;
  return new RegExp('^ssh(?:\\s+-o\\s+batchmode=yes)?\\s+kb-reader(?:@'
    + PROD_HOST_IP.replace(/\./g, '\\.') + ')?(?:\\s+' + SAFE_ARG + ')?$').test(n);
}

// Scripts that reach prod over an SSH -VM target (kb-deploy.ps1 and the drain family): their
// ONLY rehearsal signal is a genuine `-VM root@localhost` argument. A `-URL` on one of these
// means nothing about where the SSH leg actually goes, so it must never exempt them
// (HOOK-BLOCKER-2's kb-deploy.ps1 + trailing `-URL http://127.0.0.1:4317` probe).
const VM_TARGET_SCRIPTS = /(kb-deploy\.ps1|drain-step[12]-v2\.ps1|ops-refresh\.ps1|vm-preflight-prod\.ps1|prod-stop-run\.ps1|prod-canary-launch\.ps1)/;
// HTTP-only scripts: they carry no -VM at all, so their rehearsal signal is a genuine `-URL`
// pointing at the rehearsal daemon or its Windows-side proxy.
const URL_TARGET_SCRIPTS = /(prod-run-workflow\.ps1|prod-respond\.ps1|prod-schedules\.ps1|prod-signed-call\.ps1|prod-archive-run\.ps1)/;
const VM_LOCALHOST_ARG = /(?:^|\s)-vm\s+["']?root@localhost["']?(?=\s|$)/;
const URL_REHEARSAL_ARG = /(?:^|\s)-url\s+["']?https?:\/\/(?:127\.0\.0\.1|localhost):(?:4317|4417)["']?(?=\s|$)/;

/**
 * Rehearsal invocations target localhost and are never prod-targeting.
 * HOOK-BLOCKER-2 fix: the old checks were unanchored substring tests, so a `-VM`/`-URL` marker
 * anywhere in the string — including after a `#` comment, or on a script that does not even use
 * that flag for targeting — disarmed the classifier wholesale. Now: (1) anything after the first
 * `#` is stripped before looking for the marker, since a PowerShell/shell comment is never a real
 * argument; (2) the marker must appear as a genuine, whitespace-bounded argument token; (3) which
 * marker counts depends on which script the command actually names (VM_TARGET_SCRIPTS vs
 * URL_TARGET_SCRIPTS) — a command naming neither script gets no exemption from either marker.
 */
function isRehearsal(n) {
  if (n.indexOf(PROD_HOST_IP) !== -1) return false;
  if (n.indexOf(PROD_URL) !== -1) return false;
  // prod-sign-approval.ps1 never touches a network, so it carries neither -VM nor -URL and the
  // script-scoped checks below cannot see its rehearsal form. Its ONLY hazard is the key it
  // drives: a -Key under the tooling tree's `rehearsal` subtree is a committed throwaway key that
  // prod's allowed-signers file does not list, so a signature made with it cannot authorise
  // anything on prod. REHEARSAL_SIGN is anchored to the whole command, so nothing can be chained
  // onto it, and the two vetoes above still apply.
  if (REHEARSAL_SIGN.test(n)) return true;

  const hashIdx = n.indexOf('#');
  const body = hashIdx === -1 ? n : n.slice(0, hashIdx);

  if (VM_TARGET_SCRIPTS.test(body) && VM_LOCALHOST_ARG.test(body)) return true;
  if (URL_TARGET_SCRIPTS.test(body) && URL_REHEARSAL_ARG.test(body)) return true;
  return false;
}

/**
 * Returns a rule id ('A1'..'A6') when the command targets prod, else null.
 * A-1: this used to also return null for isRehearsal(n) — meaning a rehearsal-marked command
 * skipped classification ENTIRELY, never reaching openMatch()/allowlistMatch()'s shape grammar.
 * A rehearsal command now classifies exactly like its prod counterpart (still A4o/A4w); the
 * shape check always runs, and isRehearsal() is consulted later, in decide(), only to decide
 * whether the WINDOW requirement is waived for an already-shape-matched WINDOWED command.
 */
function isProdTargeting(n) {
  if (n === '') return null;
  if (isKbReaderRead(n)) return null;

  if (n.indexOf(PROD_HOST_IP) !== -1) return 'A1';
  if (/root@(?:100\.89\.73\.118|kb)/.test(n)) return 'A2';

  if (n.indexOf(PROD_URL) !== -1) {
    const mutatingVerb =
      /-x\s+(?:post|put|delete)\b/.test(n)
      || /--request\s+(?:post|put|delete)\b/.test(n)
      || /-method\s+(?!get\b)[a-z]+/.test(n);
    const mutatingRoute =
      n.indexOf('/api/control/execution/lock') !== -1
      || n.indexOf('/manager/stop') !== -1
      || n.indexOf('/archive') !== -1
      || n.indexOf('/launch') !== -1;
    if (mutatingVerb || mutatingRoute) return 'A3';
  }

  if (WINDOW_MGMT_SCRIPT.test(n)) return 'A4pw';
  // C16: prod-respond.ps1 carrying -Approval is windowed — checked before OPEN_SCRIPTS so it is
  // never classified A4o (OPEN_SCRIPTS' own prod-respond.ps1 arm would otherwise match first).
  if (PROD_RESPOND_APPROVAL_SCRIPT.test(n)) return 'A4w';
  if (OPEN_SCRIPTS.test(n)) return 'A4o';
  if (WINDOWED_SCRIPTS.test(n)) return 'A4w';

  // Signing the instruction approval is what authorises the drain's prod mutation. The command
  // itself touches no host, so it would otherwise slip past every check above.
  if (/ssh-keygen\s+-y\s+sign\b/.test(n) && n.indexOf('outbox-approval-current') !== -1) return 'A5';

  // Signing a human-approval payload (the signed-class channel, spec §4.2) is the same hazard
  // one hop away: the command itself touches no host or script.
  if (/ssh-keygen\s+-y\s+sign\b/.test(n) && n.indexOf('kb-human-approval') !== -1) return 'A6';

  return null;
}

/* ----------------------------------------------------- D: standing blockers */

function standingBlock(text, prodTargeting) {
  // rm -rf / | /* | ~
  const rm = text.match(/\brm\s+((?:-\S+\s+)+)["']?(\/\*?|~)["']?(?:\s|$|;|&|\|)/);
  if (rm && /r/.test(rm[1]) && /f/.test(rm[1])) return ['D1', 'recursive force delete of / or ~'];

  if (/\b(chmod|chown)\b[^;&|]*\s["']?(\/|\/\*)["']?(?:\s|$|;|&|\|)/.test(text)) {
    return ['D2', 'chmod/chown targeting / or /*'];
  }

  // `git -C <dir> push ...` is the same command, so the verb is matched within the segment
  // rather than immediately after `git`.
  if (/\bgit\b[^;&|]*\bpush\b/.test(text)
      && /(--force-with-lease|--force\b|\s-f\b)/.test(text)
      && /(?:^|[\s:/])(main|ops)(?:\s|$|:)/.test(text)) {
    return ['D3', 'force push to main or ops'];
  }

  if (/\bwsl(?:\.exe)?\s+--unregister\b/.test(text)) return ['D4', 'wsl --unregister'];

  if (/dashboard-ops/.test(text)
      && (/\bgit\b[^;&|]*\breset\s+--hard\b/.test(text)
          || /\bgit\b[^;&|]*\bcheckout\s+-b\b/.test(text)
          || /\bgit\b[^;&|]*\bbranch\s+-f\b/.test(text))) {
    return ['D5', 'history/branch surgery mentioning the dashboard-ops worktree'];
  }

  if (/\bmkfs(?:\.[a-z0-9]+)?\b/.test(text)) return ['D6', 'mkfs'];
  if (/\bdd\s+if=/.test(text)) return ['D6', 'dd if='];
  if (/:\(\)\s*\{/.test(text)) return ['D6', 'fork bomb'];

  if (prodTargeting && /\bsystemctl\s+(?:--\S+\s+)?(?:stop|disable|mask)\b/.test(text)) {
    return ['D7', 'systemctl stop/disable/mask on the prod host outside the allowlisted scripts'];
  }

  if (/--dangerously-skip-permissions/.test(text)) return ['D8', '--dangerously-skip-permissions'];

  // HOOK-BLOCKER-6 (second half): the window file must only ever be touched by prod-window.ps1
  // (classified separately above as A4pw). A shell command that writes it directly — Set-Content,
  // Add-Content, Out-File, New-Item, Copy-Item, Move-Item, Clear-Content, Remove-Item, a plain
  // `>`/`>>` redirect into it, a raw .NET file-write ([IO.File]::WriteAllText/WriteAllBytes/
  // AppendAllText), or an inline `node -e`/`python(3) -c` one-liner that reaches for the
  // filesystem — is the window's self-service bypass, window state or not. D9 does not try to
  // enumerate every possible writer; it catches the reviewer's three probed shapes on top of the
  // cmdlet/redirect list above.
  if (/prod-window\.json/.test(text)
      && (/\b(set-content|add-content|out-file|new-item|copy-item|move-item|clear-content|remove-item)\b/.test(text)
          || />>?\s*["']?[^\s"']*prod-window\.json/.test(text)
          || /\[io\.file\]::(writealltext|writeallbytes|appendalltext)\b/.test(text)
          || /\bnode(?:\.exe)?\s+-e\b/.test(text)
          || /\bpython3?(?:\.exe)?\s+-c\b/.test(text))) {
    return ['D9', 'direct write to the prod window file — use prod-window.ps1 -Open/-Close'];
  }

  // A-1's D10: a standing, rehearsal/window-independent backstop. isRehearsal() waiving the window
  // requirement (decide(), below) is now safe because shape grammar always runs regardless — but
  // this catches any command naming a prod-mutating script that carries a local shell/PowerShell
  // metacharacter ANYWHERE outside the one hard-coded, harmless idiom (`& '<pinned path>'`, the
  // PowerShell call operator used by the C3/C5 `-Command` shapes — a lone `&` there is not a
  // chaining hazard; `&&`/`||` still trip this) and outside the recognised PRE prefix (cd/$env:
  // token-read, both hard-coded and already vetted). Local code execution on the machine running
  // the fleet agent has nothing to do with which host the script eventually reaches.
  if (URL_TARGET_SCRIPTS.test(text) || WINDOWED_SCRIPTS.test(text)) {
    const preMatch = text.match(new RegExp(PRE));
    let rest = preMatch ? text.slice(preMatch[0].length) : text;
    rest = rest.replace(/&\s+'/g, " '");
    if (/[`$;&|%(){}<>]/.test(rest)) {
      return ['D10', 'a shell/PowerShell metacharacter (backtick $ ; & | % ( ) < > { }) appears in '
        + 'a command naming a prod-mutating script — refused regardless of rehearsal marker or '
        + 'window state; local code execution has nothing to do with which host the script reaches'];
    }
  }

  return null;
}

/* ----------------------------------------------------------- window reading */

/**
 * { open: bool, reason: string, step: string }
 * A missing, malformed, or expired window file is CLOSED.
 */
function readWindow(now) {
  let rawFile;
  try {
    rawFile = fs.readFileSync(WINDOW_FILE, 'utf8');
  } catch (_) {
    return { open: false, reason: 'no window file' };
  }
  let w;
  try {
    // A PowerShell writer can leave a UTF-8 BOM; JSON.parse refuses one.
    w = JSON.parse(rawFile.replace(/^﻿/, ''));
  } catch (_) {
    return { open: false, reason: 'window file is not JSON' };
  }
  if (!w || typeof w !== 'object') return { open: false, reason: 'window file is malformed' };
  if (typeof w.token !== 'string' || !/^[0-9a-f]{32}$/i.test(w.token)) {
    return { open: false, reason: 'window token is missing or not 32 hex' };
  }
  const opened = Date.parse(w.openedAt);
  const expires = Date.parse(w.expiresAt);
  if (!isFinite(opened) || !isFinite(expires)) {
    return { open: false, reason: 'window timestamps are malformed' };
  }
  if (expires - opened > MAX_WINDOW_MS) return { open: false, reason: 'window longer than 3h' };
  if (expires <= opened) return { open: false, reason: 'window expiry precedes its opening' };
  // HOOK-HIGH-4: a future-dated window (openedAt after now) was treated as open, defeating
  // MAX_WINDOW_MS entirely — a window dated months out stayed "open" every time it was read.
  // The full requirement is openedAt <= now < expiresAt.
  if (now < opened) return { open: false, reason: 'window opens in the future at ' + w.openedAt };
  if (now >= expires) return { open: false, reason: 'window expired at ' + w.expiresAt };
  return {
    open: true,
    reason: 'open until ' + w.expiresAt,
    step: typeof w.step === 'string' ? w.step : ''
  };
}

/* -------------------------------------------------------------------- audit */

function audit(decision, tool, ruleId, command, actor) {
  try {
    const line = new Date().toISOString() + ' ' + decision + ' ' + (tool || '-') + ' '
      + (ruleId || '-') + ' '
      + (actor ? 'actor=' + actor + ' ' : '')
      + maskSecrets(String(command == null ? '' : command).replace(/\s+/g, ' ').trim()).slice(0, 300);
    fs.appendFileSync(AUDIT_LOG, line + '\n', 'utf8');
  } catch (_) { /* never let the log wedge the decision */ }
}

/* ---------------------------------------------------------------- allowlist */

/** Returns the matching WINDOWED-class allowlist rule id, or null. */
function allowlistMatch(n) {
  if (C1.test(n)) return 'C1';
  if (C2.test(n)) return 'C2';
  if (C3.test(n)) return 'C3';
  if (C4.test(n)) return 'C4';
  if (C5A.test(n)) return 'C5a';
  if (C5B.test(n)) return 'C5b';
  if (C6A.test(n)) return 'C6a';
  if (C6B.test(n)) return 'C6b';
  if (C13.test(n)) return 'C13';
  if (C14.test(n)) return 'C14';
  if (C15.test(n)) return 'C15';
  if (C16.test(n)) return 'C16';
  const ssh = n.match(SSH_ROOT);
  if (ssh && isReadVerb(ssh[1])) return 'C7';
  return null;
}

/**
 * Returns { rule, actor } for the matching OPEN-class allowlist shape, or null.
 * `actor` is the -Actor value on prod-respond.ps1 when present, else null — recorded on the
 * audit line but never consulted for the decision (same non-authority property as the
 * daemon's X-KB-Actor header, spec §4.3).
 */
function openMatch(n) {
  const wf = n.match(O1);
  if (wf) {
    const workflow = wf[1];
    const topic = wf[2];
    if (workflow.indexOf('..') !== -1) return null;          // path traversal (defence in depth)
    if (topic !== undefined && topic.indexOf('..') !== -1) return null;
    return { rule: 'O1', actor: null };
  }
  const resp = n.match(O2);
  if (resp) return { rule: 'O2', actor: resp[5] || null };
  if (O3_LIST.test(n) || O3_DISARM.test(n) || O3_ARM.test(n) || O3_CREATE.test(n)) {
    return { rule: 'O3', actor: null };
  }
  if (!PROD_ARCHIVE_APPROVAL_GUARD.test(n)) {
    const arch = n.match(O4);
    if (arch) return { rule: 'O4', actor: arch[3] || null };
  }
  return null;
}

/* --------------------------------------------------------------------- main */

function block(reason, tool, ruleId, command, shouldAudit) {
  if (shouldAudit) audit('BLOCK', tool, ruleId, command);
  process.stderr.write('[prod-window BLOCK] ' + reason + '\n');
  process.exit(2);
}

// Shared "does this unparsed/unreadable payload smell like prod" check — used both when the
// payload cannot be parsed as JSON at all and by the outer fail-closed catch for a genuine
// exception. One source of truth so the two paths cannot drift apart.
const PROD_SMELLS = /100\.89\.73\.118|kb\.tail82dd4f\.ts\.net|root@|kb-deploy\.ps1|drain-step\d-v2\.ps1|ops-refresh\.ps1|vm-preflight-prod\.ps1|prod-stop-run\.ps1|prod-canary-launch\.ps1|prod-run-workflow\.ps1|prod-schedules\.ps1|prod-respond\.ps1|prod-sign-approval\.ps1|prod-signed-call\.ps1|prod-window\.ps1|prod-archive-run\.ps1|outbox-approval-current|kb-ops-instructions|kb-human-approval/i;
function looksProdSmelling(text) {
  return PROD_SMELLS.test(String(text == null ? '' : text));
}

const GATED_TOOLS = ['Bash', 'PowerShell', 'Agent', 'Write', 'Edit', 'MultiEdit'];
const WINDOW_FILE_NORM = norm(WINDOW_FILE).replace(/\//g, '\\');

function decide(raw, oversize) {
  // HOOK-BLOCKER-3: oversize stdin used to be silently truncated, which usually left the JSON
  // unparsable, which fell through to `tool = ''` and an ALLOW — fail OPEN on the one input an
  // attacker fully controls the size of. Now: too big always BLOCKS, unconditionally.
  if (oversize) {
    block('stdin exceeds the ' + MAX_STDIN + '-byte cap; refusing to evaluate a possibly-truncated '
      + 'payload. Failing closed.', 'unknown', 'F-oversize', String(raw).slice(0, 300), true);
  }

  let parsed = null;
  let parseFailed = false;
  try {
    const trimmed = String(raw || '').trim();
    if (trimmed.charAt(0) === '{') {
      parsed = JSON.parse(trimmed);
    } else {
      parseFailed = true;
    }
  } catch (_) {
    parsed = null;
    parseFailed = true;
  }

  // HOOK-BLOCKER-3 (second half): a JSON parse failure used to fall through the same way as
  // above — silently ALLOW. Now it blocks anything that smells of prod, same as the outer
  // fail-closed catch, and otherwise lets a payload this hook cannot even read continue as a
  // no-op for tools it does not gate.
  if (parseFailed) {
    if (looksProdSmelling(raw)) {
      block('the tool_input payload could not be parsed as JSON and it mentions production. '
        + 'Failing closed.', 'unknown', 'F-parsefail', String(raw).slice(0, 300), true);
    }
    process.exit(0);
  }

  const tool = parsed && typeof parsed.tool_name === 'string' ? parsed.tool_name : '';
  if (GATED_TOOLS.indexOf(tool) === -1) process.exit(0);

  const rawInput = parsed && parsed.tool_input;
  if (rawInput === undefined || rawInput === null || typeof rawInput !== 'object') {
    // tool_input could not be read at all for a tool this hook is supposed to gate. Fail closed
    // rather than silently treat it as "no command" and allow.
    block('tool_input could not be read for a ' + tool + ' call. Failing closed.',
      tool, 'F-noinput', JSON.stringify(parsed).slice(0, 300), true);
  }
  const input = rawInput;

  // W: Write/Edit/MultiEdit are gated on exactly one thing — is file_path the prod window file,
  // in any slash form, any case (HOOK-BLOCKER-6). Everything else about these tools is untouched.
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    const fp = typeof input.file_path === 'string' ? input.file_path : '';
    const fpNorm = norm(fp).replace(/\//g, '\\');
    if (fpNorm === WINDOW_FILE_NORM) {
      block('this ' + tool + ' targets the prod window file directly (' + WINDOW_FILE + '). '
        + 'Use prod-window.ps1 -Open/-Close, not a raw file edit.', tool, 'W1', fp, true);
    }
    process.exit(0);
  }

  const command = typeof input.command === 'string' ? input.command : '';

  const n = norm(command);
  // Rule D also inspects an Agent dispatch's brief: a subagent told to run one of
  // these is the same hazard one hop away.
  const dText = tool === 'Agent' ? norm(JSON.stringify(input)) : n;

  const prodRule = tool === 'Agent' ? null : isProdTargeting(n);
  const isProd = prodRule !== null;

  const d = standingBlock(dText, isProd);
  if (d) {
    block('standing block ' + d[0] + ' — ' + d[1] + '. This is refused with or without a prod window.',
      tool, d[0], tool === 'Agent' ? JSON.stringify(input) : command, isProd || tool === 'Agent');
  }

  if (prodRule === 'A4pw') {
    if (!(PW_OPEN.test(n) || PW_CLOSE.test(n) || PW_STATUS.test(n))) {
      block('prod-window.ps1 only runs in its exact -Open [-Hours N|-Minutes N] [-Step <word>] / '
        + '-Close / -Status shapes. Extra or malformed parameters are refused on purpose.',
        tool, prodRule, command, true);
    }
    audit('ALLOW', tool, 'PW', command);
    process.exit(0);
  }

  if (prodRule === 'A4o') {
    const open = openMatch(n);
    if (!open) {
      block('this is an open-class prod script, but the command is not one of its reviewed shapes '
        + '(prod-run-workflow -Workflow <safe-id> [-Topic <safe-id>] / prod-respond -Run -Request '
        + '-Decision -Reason [-Actor] / prod-schedules -List|-DisarmAgentCadences|-ArmFromSnapshot|'
        + '-CreateWorkflowSchedule / prod-archive-run -Run -Reason [-Actor]). Fix the arguments, or '
        + 'add the shape to scripts/hooks/prod_window_guard.js and its tests first.',
        tool, prodRule, command, true);
    }
    // A-2: O4 (prod-archive-run.ps1) is the one allowlisted script that lives under the
    // branch-switching main checkout rather than the tooling tree, so shape match alone says
    // nothing about content. Pin it.
    if (open.rule === 'O4' && !archiveScriptDigestOk()) {
      block('prod-archive-run.ps1 content does not match the pinned digest; update '
        + 'ARCHIVE_SCRIPT_SHA256 in the hook and its tests after review.', tool, 'A2', command, true);
    }
    audit('ALLOW', tool, open.rule, command, open.actor);
    process.exit(0);
  }

  const win = readWindow(Date.now());

  if (tool === 'Agent') {
    if (win.open) {
      block('no subagents while the prod window is open (' + win.reason + '). One pair of hands on '
        + 'prod: run it yourself, or close the window with prod-window.ps1 -Close first.',
        'Agent', 'C0', JSON.stringify(input), true);
    }
    process.exit(0);           // window closed: subagents are normal work
  }

  if (!isProd) process.exit(0);  // non-prod commands (incl. GET-only monitoring) always run

  // A-1: isRehearsal() waives ONLY this window requirement, never shape validation — allowlistMatch()
  // below always runs regardless, on the SAME text, so a rehearsal-marked command still has to be one
  // of the reviewed shapes end-to-end (its own optional VM/URL/SshShimDir groups included).
  if (!win.open && !isRehearsal(n)) {
    block('the prod window is CLOSED (' + win.reason + ') and this command targets production ('
      + prodRule + ': ' + PROD_HOST_IP + ' / ' + PROD_URL + ' / a prod-defaulted script). '
      + 'Open one deliberately with: powershell -NoProfile -ExecutionPolicy Bypass -File '
      + 'C:\\Users\\danie\\kb-rehearsal\\tooling\\prod-window.ps1 -Open -Step <name>',
      tool, prodRule, command, true);
  }

  const allowed = allowlistMatch(n);
  if (!allowed) {
    block('the prod window is open, but this command is not one of the reviewed shapes '
      + '(preflight / kb-deploy / drain-step1 / sign / drain-step2 / ops-refresh / prod-stop-run / '
      + 'prod-canary-launch / prod-sign-approval / prod-signed-call / the human-approval signature / an allowlisted '
      + 'read-only root ssh verb). Extra parameters are refused on purpose. Run it by hand outside '
      + 'the fleet, or add the shape to scripts/hooks/prod_window_guard.js and its tests first.',
      tool, prodRule, command, true);
  }

  audit('ALLOW', tool, allowed, command);
  process.exit(0);
}

let raw = '';
let oversize = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) {
  if (raw.length + chunk.length > MAX_STDIN) oversize = true;
  if (raw.length < MAX_STDIN) raw += chunk.substring(0, MAX_STDIN - raw.length);
});
process.stdin.on('end', function () {
  try {
    decide(raw, oversize);
  } catch (err) {
    // FAIL CLOSED for anything that smells of prod; fail open for the rest, so a
    // guard bug cannot wedge ordinary work.
    if (looksProdSmelling(raw)) {
      try { audit('BLOCK', 'unknown', 'F-failclosed', String(raw).slice(0, 300)); } catch (_) {}
      process.stderr.write('[prod-window BLOCK] the guard itself failed ('
        + (err && err.message ? err.message : 'unknown error')
        + ') and this command mentions production. Failing closed.\n');
      process.exit(2);
    }
    process.exit(0);
  }
});

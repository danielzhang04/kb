#!/usr/bin/env node
/**
 * kb PreToolUse hook — PROD window guard (2026-09-16, authority-and-guardrails T7).
 *
 * Tools: Bash, PowerShell, Agent.
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
 *                   and schedule management. Runs with NO window, still only in its
 *                   reviewed argument shape, still subject to the standing blocks.
 *   WINDOWED class — deploy, drain, canary, stop, preflight, and anything that
 *                   drives a signing key (prod-sign-approval.ps1, the
 *                   kb-human-approval ssh-keygen sign command). Refused outside an
 *                   explicitly opened prod window; anchored shapes only inside one.
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
 *   D  standing blocks, window or not, any tool
 *   E  audit line per prod-targeting decision and per Agent decision while open
 *   F  block => exit 2 + reason on stderr (same shape as hard_ceiling_guard.js);
 *      allow => exit 0 silent. FAIL CLOSED: any exception blocks anything that
 *      smells of prod and allows the rest.
 *
 * Exit codes: 0 = allow, 2 = block.
 */

'use strict';

const fs = require('fs');

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
const PATHARG = '("[^"]*"|\'[^\']*\'|\\S+)';

/* --------------------------------------------------------- allowlist shapes */

// C1 — preflight
const C1 = new RegExp(PRE + PS + '-file\\s+' + P('vm-preflight-prod.ps1')
  + '(?:\\s+-step\\s+[a-z0-9_-]+)?$');

// C2 — the deploy, pinned sha + broker digest, NO other parameters
const C2 = new RegExp(PRE + PS + '-file\\s+' + P('kb-deploy.ps1')
  + '\\s+-signingkey\\s+' + PATHARG
  + '\\s+-sha\\s+' + DEPLOY_SHA
  + '\\s+-brokerdigest\\s+' + BROKER_DIGEST + '$');

// C3/C5 — the three `-Command "& '<script>'"` drain shapes, no arguments
function cmdShape(rel) {
  const body = rel.split('/').map(function (s) { return s.replace(/\./g, '\\.'); }).join(B);
  return new RegExp(PRE + PS + '-command\\s+"\\s*&\\s*\'' + T + B + body + '\'\\s*"$');
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
  + '(?:\\s+-topic\\s+([a-z0-9._-]{1,40}))?$');

// O2 — prod-respond.ps1, OPEN class: resolve a gate/intervention with a safe reason.
// The reason may contain no backtick, `$`, `;`, `&` or `|` — no shell metacharacters at all.
// -Actor is optional; when present it is recorded verbatim on the audit line (never trusted
// for authority — same non-authority property as the daemon's X-KB-Actor header, spec §4.3).
const REASON = '("[^"`$;&|]{1,300}"|\'[^\'`$;&|]{1,300}\')';
const ACTOR_ARG = '(daniel|boss|worker:[a-z0-9][a-z0-9._-]{0,63})';
const O2 = new RegExp(PRE + PS + '-file\\s+' + P('prod-respond.ps1')
  + '\\s+-run\\s+([a-z0-9-]{1,80})\\s+-request\\s+([a-z0-9-]{1,80})'
  + '\\s+-decision\\s+(approve|retry|abandon)\\s+-reason\\s+' + REASON
  + '(?:\\s+-actor\\s+' + ACTOR_ARG + ')?$');

// O3 — prod-schedules.ps1's four modes, OPEN class. `tpath` matches an optionally quoted path
// under T (the -List's -Out) or under a fixed subfolder of T (the snapshot paths), with a `..`
// traversal veto — the same discipline P() uses for fixed filenames.
function tpath(subSegments) {
  const prefix = subSegments.map(function (s) { return s.replace(/\./g, '\\.'); }).join(B);
  const afterT = prefix === '' ? '' : (prefix + B);
  return '["\']?' + T + B + afterT + '(?!.*\\.\\.)[a-z0-9_.\\\\/-]+["\']?';
}
const O3_LIST = new RegExp(PRE + PS + '-file\\s+' + P('prod-schedules.ps1')
  + '\\s+-list(?:\\s+-out\\s+' + tpath([]) + ')?$');
const O3_DISARM = new RegExp(PRE + PS + '-file\\s+' + P('prod-schedules.ps1')
  + '\\s+-disarmagentcadences\\s+-snapshot\\s+' + tpath(['rehearsal', 'p8']) + '$');
const O3_ARM = new RegExp(PRE + PS + '-file\\s+' + P('prod-schedules.ps1')
  + '\\s+-armfromsnapshot\\s+' + tpath(['rehearsal', 'p8']) + '$');
const CRON_ARG = '("[0-9*/,\\s-]{9,40}"|\'[0-9*/,\\s-]{9,40}\')';
const O3_CREATE = new RegExp(PRE + PS + '-file\\s+' + P('prod-schedules.ps1')
  + '\\s+-createworkflowschedule\\s+self-lint-report\\s+-cron\\s+' + CRON_ARG + '$');

// C13 — prod-sign-approval.ps1, WINDOWED class (it drives the human-approval signing key).
const C13 = new RegExp(PRE + PS + '-file\\s+' + P('prod-sign-approval.ps1')
  + '\\s+-route\\s+("[a-z]+ /api/[a-z0-9/:_-]{1,120}"|\'[a-z]+ /api/[a-z0-9/:_-]{1,120}\')'
  + '\\s+-entity\\s+([a-z0-9._:-]{1,120})'
  + '(?:\\s+-ttlminutes\\s+([0-9]{1,2}))?(?:\\s+-signingkey\\s+' + PATHARG + ')?$');

// C14 — the human-approval signature itself, WINDOWED class (spec's kb-human-approval namespace,
// distinct from C4's kb-ops-instructions drain-approval namespace).
const C14 = new RegExp('^ssh-keygen\\s+-y\\s+sign\\s+-f\\s+' + PATHARG
  + '\\s+-n\\s+kb-human-approval\\s+["\']?' + BACKUPS + B
  + 'approval-current' + B + 'payload\\.json["\']?$');

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
const OPEN_SCRIPTS = /(prod-run-workflow\.ps1|prod-respond\.ps1|prod-schedules\.ps1)/;
const WINDOWED_SCRIPTS = /(kb-deploy\.ps1|drain-step[12]-v2\.ps1|ops-refresh\.ps1|vm-preflight-prod\.ps1|prod-stop-run\.ps1|prod-canary-launch\.ps1|prod-sign-approval\.ps1)/;

/** `ssh [-o ...] kb-reader[@ip] ...` — the read-only identity, never prod-targeting. */
function isKbReaderRead(n) {
  if (/root@/.test(n)) return false;
  if (/(curl|invoke-restmethod|invoke-webrequest|iwr\b|irm\b)/.test(n)) return false;
  return new RegExp('^ssh\\s+(?:-o\\s+\\S+\\s+)*kb-reader(?:@' + PROD_HOST_IP.replace(/\./g, '\\.')
    + ')?(?:\\s|$)').test(n);
}

/** Rehearsal invocations target localhost and are never prod-targeting. */
function isRehearsal(n) {
  if (n.indexOf(PROD_HOST_IP) !== -1) return false;
  if (n.indexOf(PROD_URL) !== -1) return false;
  if (/-vm\s+["']?root@localhost["']?/.test(n)) return true;
  // HTTP-only scripts (prod-run-workflow.ps1, prod-schedules.ps1) carry no -VM; their rehearsal
  // shape is a -URL pointing at the rehearsal daemon (127.0.0.1:4317) or its Windows-side proxy
  // (127.0.0.1:4417), never at prod's.
  return /-url\s+["']?https?:\/\/(?:127\.0\.0\.1|localhost):(?:4317|4417)["']?/.test(n);
}

/** Returns a rule id ('A1'..'A6') when the command targets prod, else null. */
function isProdTargeting(n) {
  if (n === '') return null;
  if (isKbReaderRead(n)) return null;
  if (isRehearsal(n)) return null;

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
  return null;
}

/* --------------------------------------------------------------------- main */

function block(reason, tool, ruleId, command, shouldAudit) {
  if (shouldAudit) audit('BLOCK', tool, ruleId, command);
  process.stderr.write('[prod-window BLOCK] ' + reason + '\n');
  process.exit(2);
}

function decide(raw) {
  let parsed = null;
  try {
    const trimmed = String(raw || '').trim();
    if (trimmed.charAt(0) === '{') parsed = JSON.parse(trimmed);
  } catch (_) { parsed = null; }

  const tool = parsed && typeof parsed.tool_name === 'string' ? parsed.tool_name : '';
  const input = (parsed && parsed.tool_input && typeof parsed.tool_input === 'object')
    ? parsed.tool_input : {};
  const command = typeof input.command === 'string' ? input.command : '';

  if (tool !== 'Bash' && tool !== 'PowerShell' && tool !== 'Agent') process.exit(0);

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

  if (prodRule === 'A4o') {
    const open = openMatch(n);
    if (!open) {
      block('this is an open-class prod script, but the command is not one of its reviewed shapes '
        + '(prod-run-workflow -Workflow <safe-id> [-Topic <safe-id>] / prod-respond -Run -Request '
        + '-Decision -Reason [-Actor] / prod-schedules -List|-DisarmAgentCadences|-ArmFromSnapshot|'
        + '-CreateWorkflowSchedule). Fix the arguments, or add the shape to '
        + 'scripts/hooks/prod_window_guard.js and its tests first.',
        tool, prodRule, command, true);
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

  if (!win.open) {
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
      + 'prod-canary-launch / prod-sign-approval / the human-approval signature / an allowlisted '
      + 'read-only root ssh verb). Extra parameters are refused on purpose. Run it by hand outside '
      + 'the fleet, or add the shape to scripts/hooks/prod_window_guard.js and its tests first.',
      tool, prodRule, command, true);
  }

  audit('ALLOW', tool, allowed, command);
  process.exit(0);
}

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) {
  if (raw.length < MAX_STDIN) raw += chunk.substring(0, MAX_STDIN - raw.length);
});
process.stdin.on('end', function () {
  try {
    decide(raw);
  } catch (err) {
    // FAIL CLOSED for anything that smells of prod; fail open for the rest, so a
    // guard bug cannot wedge ordinary work.
    const smells = /100\.89\.73\.118|kb\.tail82dd4f\.ts\.net|root@|kb-deploy\.ps1|drain-step\d-v2\.ps1|ops-refresh\.ps1|vm-preflight-prod\.ps1|prod-stop-run\.ps1|prod-canary-launch\.ps1|prod-run-workflow\.ps1|prod-schedules\.ps1|prod-respond\.ps1|prod-sign-approval\.ps1|kb-human-approval/i
      .test(String(raw));
    if (smells) {
      try { audit('BLOCK', 'unknown', 'F-failclosed', String(raw).slice(0, 300)); } catch (_) {}
      process.stderr.write('[prod-window BLOCK] the guard itself failed ('
        + (err && err.message ? err.message : 'unknown error')
        + ') and this command mentions production. Failing closed.\n');
      process.exit(2);
    }
    process.exit(0);
  }
});

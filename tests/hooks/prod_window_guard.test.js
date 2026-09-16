#!/usr/bin/env node
/**
 * tests/hooks/prod_window_guard.test.js — node:test, no dependencies.
 *
 *   node --test tests/hooks/prod_window_guard.test.js
 *
 * Every case feeds a real PreToolUse payload on the hook's stdin and asserts the exit code
 * (0 = allow, 2 = block), exactly as the harness will.
 *
 * The hook's window path is hard-coded by design (an env-settable window file would be a
 * bypass), so these tests write and delete the real
 * C:\Users\danie\kb-rehearsal\tooling\PROD-WINDOW.json. Any pre-existing window is snapshotted
 * and restored on exit. The audit log IS redirected (KB_PROD_WINDOW_AUDIT) because the log
 * destination cannot change a decision.
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const HOOK = path.join(__dirname, '..', '..', 'scripts', 'hooks', 'prod_window_guard.js');
const WINDOW_FILE = 'C:\\Users\\danie\\kb-rehearsal\\tooling\\PROD-WINDOW.json';
const AUDIT = path.join(os.tmpdir(), 'prod-window-guard-test-audit-' + process.pid + '.log');

const T = 'C:\\Users\\danie\\kb-rehearsal\\tooling';
const SHA = '7e09fd4fcbae5e66299af3c756041b49437fc6b3';
const DIGEST = '4586d91930a1b4f00f350a2b5324a9347073b10d67c9cf0edfd47abe4f988c2b';
const PS = 'powershell -NoProfile -ExecutionPolicy Bypass';
const ENVPRE = '$env:KB_PROD_WINDOW=(Get-Content ' + T + '\\PROD-WINDOW.json | ConvertFrom-Json).token; ';

/* ------------------------------------------------------- window state helpers */

let saved = null;
try { saved = fs.readFileSync(WINDOW_FILE, 'utf8'); } catch (_) { saved = null; }
process.on('exit', () => {
  try {
    if (saved === null) fs.rmSync(WINDOW_FILE, { force: true });
    else fs.writeFileSync(WINDOW_FILE, saved, 'utf8');
  } catch (_) { /* best effort */ }
  try { fs.rmSync(AUDIT, { force: true }); } catch (_) { /* best effort */ }
});

const iso = ms => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

function setWindow(kind) {
  const now = Date.now();
  if (kind === 'closed') { fs.rmSync(WINDOW_FILE, { force: true }); return; }
  if (kind === 'malformed') { fs.writeFileSync(WINDOW_FILE, '{ this is not json', 'utf8'); return; }
  let doc;
  if (kind === 'open') {
    doc = { openedAt: iso(now - 60000), expiresAt: iso(now + 60 * 60 * 1000), token: 'a'.repeat(32), step: 'test' };
  } else if (kind === 'expired') {
    doc = { openedAt: iso(now - 4 * 60 * 60 * 1000), expiresAt: iso(now - 60 * 60 * 1000), token: 'b'.repeat(32), step: 'stale' };
  } else if (kind === 'toolong') {
    doc = { openedAt: iso(now - 60000), expiresAt: iso(now + 5 * 60 * 60 * 1000), token: 'c'.repeat(32), step: 'greedy' };
  } else if (kind === 'badtoken') {
    doc = { openedAt: iso(now - 60000), expiresAt: iso(now + 60 * 60 * 1000), token: 'not-hex', step: 'bad' };
  } else {
    throw new Error('unknown window kind ' + kind);
  }
  fs.writeFileSync(WINDOW_FILE, JSON.stringify(doc), 'utf8');
}

function runHook(tool, toolInput) {
  const payload = JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: tool, tool_input: toolInput });
  const res = spawnSync(process.execPath, [HOOK], {
    input: payload,
    encoding: 'utf8',
    env: Object.assign({}, process.env, { KB_PROD_WINDOW_AUDIT: AUDIT }),
  });
  return { code: res.status, stderr: res.stderr || '' };
}

/* ----------------------------------------------------------------- the cases */

// [name, window, tool, command, expectedExit]
const CASES = [
  // ---- allowlisted shapes, window OPEN -------------------------------------
  ['C1 preflight, plain', 'open', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1"`, 0],
  ['C1 preflight, -Step reader', 'open', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1" -Step reader`, 0],
  ['C1 preflight, unquoted path', 'open', 'PowerShell', `${PS} -File ${T}\\vm-preflight-prod.ps1`, 0],
  ['C1 preflight, forward slashes', 'open', 'Bash', `${PS} -File "C:/Users/danie/kb-rehearsal/tooling/vm-preflight-prod.ps1"`, 0],
  ['C1 preflight, cd prefix', 'open', 'Bash', `cd C:\\Users\\danie\\kb && ${PS} -File "${T}\\vm-preflight-prod.ps1"`, 0],
  ['C1 preflight, KB_PROD_WINDOW prefix', 'open', 'PowerShell', `${ENVPRE}${PS} -File "${T}\\vm-preflight-prod.ps1"`, 0],
  // T9: the approver-signers step installs the PUBLIC allowed-signers file and the unit's
  // Environment= line before a release deploy (a release deploy does not reinstall units), and
  // takes -SignersFile so the rehearsal host can be given a throwaway public key instead.
  ['C1 preflight, -Step approver-signers', 'open', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1" -Step approver-signers`, 0],
  ['C1 preflight, -Step approver-signers -SignersFile under T', 'open', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1" -Step approver-signers -SignersFile ${T}\\rehearsal\\p2\\approver\\allowed_signers`, 0],
  ['C1 preflight, -SignersFile quoted', 'open', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1" -Step approver-signers -SignersFile "${T}\\rehearsal\\p2\\approver\\allowed_signers"`, 0],
  ['C1 -SignersFile traversal blocked', 'open', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1" -Step approver-signers -SignersFile ${T}\\..\\..\\.ssh\\kb-ops-approver`, 2],
  ['C1 -SignersFile outside T blocked', 'open', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1" -Step approver-signers -SignersFile C:\\Users\\danie\\.ssh\\kb-ops-approver`, 2],
  ['C1 -SignersFile without -Step blocked', 'open', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1" -SignersFile ${T}\\rehearsal\\p2\\approver\\allowed_signers`, 2],
  ['C1 -Step approver-signers still blocked when window closed', 'closed', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1" -Step approver-signers -SignersFile ${T}\\rehearsal\\p2\\approver\\allowed_signers`, 2],
  ['C1 preflight + stray -Force blocked', 'open', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1" -Force`, 2],
  ['C1 preflight + stray -VM blocked', 'open', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1" -VM root@100.89.73.118`, 2],

  ['C2 deploy, exact', 'open', 'Bash', `${PS} -File "${T}\\kb-deploy.ps1" -SigningKey C:\\keys\\release.pem -Sha ${SHA} -BrokerDigest ${DIGEST}`, 0],
  ['C2 deploy, KB_PROD_WINDOW prefix', 'open', 'PowerShell', `${ENVPRE}${PS} -File "${T}\\kb-deploy.ps1" -SigningKey "C:\\keys\\release key.pem" -Sha ${SHA} -BrokerDigest ${DIGEST}`, 0],
  ['C2 deploy + -SshShimDir blocked', 'open', 'Bash', `${PS} -File "${T}\\kb-deploy.ps1" -SigningKey C:\\keys\\r.pem -Sha ${SHA} -BrokerDigest ${DIGEST} -SshShimDir C:\\shims`, 2],
  ['C2 deploy + -VM blocked', 'open', 'Bash', `${PS} -File "${T}\\kb-deploy.ps1" -SigningKey C:\\keys\\r.pem -Sha ${SHA} -BrokerDigest ${DIGEST} -VM root@100.89.73.118`, 2],
  ['C2 deploy with a different sha blocked', 'open', 'Bash', `${PS} -File "${T}\\kb-deploy.ps1" -SigningKey C:\\keys\\r.pem -Sha ${'0'.repeat(40)} -BrokerDigest ${DIGEST}`, 2],

  ['C3 drain step1', 'open', 'Bash', `${PS} -Command "& '${T}\\drain-v2\\drain-step1-v2.ps1'"`, 0],
  ['C3 drain step1, KB_PROD_WINDOW prefix', 'open', 'PowerShell', `${ENVPRE}${PS} -Command "& '${T}\\drain-v2\\drain-step1-v2.ps1'"`, 0],
  ['C3 drain step1 + stray -VM blocked', 'open', 'Bash', `${PS} -Command "& '${T}\\drain-v2\\drain-step1-v2.ps1' -VM root@100.89.73.118"`, 2],

  ['C4 sign the approval', 'open', 'Bash', 'ssh-keygen -Y sign -f C:\\keys\\kb-ops-approver -n kb-ops-instructions "C:\\Users\\danie\\kb-backups\\outbox-approval-current\\instruction-approval.json"', 0],
  ['C4 sign with the wrong namespace blocked', 'open', 'Bash', 'ssh-keygen -Y sign -f C:\\keys\\kb-ops-approver -n some-other-ns "C:\\Users\\danie\\kb-backups\\outbox-approval-current\\instruction-approval.json"', 2],

  ['C5a drain step2', 'open', 'Bash', `${PS} -Command "& '${T}\\drain-v2\\drain-step2-v2.ps1'"`, 0],
  ['C5b ops-refresh', 'open', 'PowerShell', `${ENVPRE}${PS} -Command "& '${T}\\drain-v2\\ops-refresh.ps1'"`, 0],
  ['C5b ops-refresh + stray -Remote blocked', 'open', 'Bash', `${PS} -Command "& '${T}\\drain-v2\\ops-refresh.ps1' -Remote https://example.com/x.git"`, 2],

  ['C6a prod-stop-run', 'open', 'Bash', `${PS} -File "${T}\\prod-stop-run.ps1"`, 0],
  ['C6a prod-stop-run + stray -RunRef blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-stop-run.ps1" -RunRef run-other`, 2],
  ['C6b canary, no topic', 'open', 'Bash', `${PS} -File "${T}\\prod-canary-launch.ps1"`, 0],
  ['C6b canary, -Topic tailnet-trust', 'open', 'PowerShell', `${ENVPRE}${PS} -File "${T}\\prod-canary-launch.ps1" -Topic tailnet-trust`, 0],
  ['C6b canary, another topic blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-canary-launch.ps1" -Topic something-else`, 2],

  // ---- O1 prod-run-workflow.ps1 — OPEN class (T7): any safe workflow id, no window needed ----
  ['O1 run-workflow self-lint-report, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow self-lint-report`, 0],
  ['O1 run-workflow v1-acceptance-demo, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow v1-acceptance-demo`, 0],
  ['O1 run-workflow v1-acceptance-demo -Topic tailnet-trust, window open', 'open', 'PowerShell', `${ENVPRE}${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow v1-acceptance-demo -Topic tailnet-trust`, 0],
  // T7: -Workflow is now any [a-z0-9][a-z0-9-]{0,60} id — a third/arbitrary id is now ALLOWED.
  ['O1 a third workflow id is now allowed', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow queue-drain-report`, 0],
  ['O1 -Topic ../x traversal still blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow v1-acceptance-demo -Topic ../x`, 2],
  // T7: -Topic is no longer pinned to the demo workflow — self-lint-report + a topic is now ALLOWED.
  ['O1 -Topic on self-lint-report is now allowed', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow self-lint-report -Topic tailnet-trust`, 0],
  ['O1 + stray -URL blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow self-lint-report -URL https://kb.tail82dd4f.ts.net`, 2],
  // T7: prod-run-workflow.ps1 is OPEN class — runs with the window CLOSED.
  ['O1 allowed when the window is closed (T7 open class)', 'closed', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow self-lint-report`, 0],

  ['C7 root ssh hostname', 'open', 'Bash', "ssh -o BatchMode=yes root@100.89.73.118 'hostname'", 0],
  ['C7 root ssh hostname; id -u', 'open', 'Bash', "ssh -o BatchMode=yes root@100.89.73.118 'hostname; id -u'", 0],
  ['C7 root ssh journalctl read', 'open', 'Bash', "ssh -o BatchMode=yes root@100.89.73.118 'journalctl -u kb-dashboard -n 200 --no-pager -o cat'", 0],
  ['C7 root ssh reader_shell sha256', 'open', 'Bash', "ssh -o BatchMode=yes root@100.89.73.118 'sha256sum /usr/local/lib/kb/reader_shell.sh'", 0],
  ['C7 root ssh readlink current', 'open', 'Bash', "ssh -o BatchMode=yes root@100.89.73.118 'readlink /opt/kb-releases/current'", 0],
  ['C7 root ssh a non-listed verb blocked', 'open', 'Bash', "ssh -o BatchMode=yes root@100.89.73.118 'cat /etc/shadow'", 2],
  ['C7 root ssh write verb blocked', 'open', 'Bash', "ssh -o BatchMode=yes root@100.89.73.118 'rm -rf /var/lib/kb/state/outbox/ready'", 2],
  ['C7 root ssh systemctl stop blocked (D7)', 'open', 'Bash', "ssh -o BatchMode=yes root@100.89.73.118 'systemctl stop kb-dashboard'", 2],
  ['C7 root ssh without BatchMode blocked', 'open', 'Bash', "ssh root@100.89.73.118 'hostname'", 2],

  // ---- window CLOSED --------------------------------------------------------
  ['closed: preflight blocked', 'closed', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1"`, 2],
  ['closed: deploy blocked', 'closed', 'Bash', `${PS} -File "${T}\\kb-deploy.ps1" -SigningKey C:\\keys\\r.pem -Sha ${SHA} -BrokerDigest ${DIGEST}`, 2],
  ['closed: drain step1 blocked', 'closed', 'Bash', `${PS} -Command "& '${T}\\drain-v2\\drain-step1-v2.ps1'"`, 2],
  ['closed: root ssh hostname blocked', 'closed', 'Bash', "ssh -o BatchMode=yes root@100.89.73.118 'hostname'", 2],
  ['closed: curl POST manager/stop blocked', 'closed', 'Bash', 'curl -X POST https://kb.tail82dd4f.ts.net/api/control/runs/run-971d5ba4-16e5-4010-895f-33e69122984a/manager/stop -H "content-type: application/json" -d "{}"', 2],
  ['closed: curl POST execution lock blocked', 'closed', 'Bash', 'curl -s -X POST https://kb.tail82dd4f.ts.net/api/control/execution/lock', 2],
  ['closed: Invoke-RestMethod -Method Post blocked', 'closed', 'PowerShell', 'Invoke-RestMethod -Method Post -Uri https://kb.tail82dd4f.ts.net/api/control/runs/x/archive', 2],
  ['closed: workflow launch POST blocked', 'closed', 'Bash', 'curl -X POST https://kb.tail82dd4f.ts.net/api/workflows/v1-acceptance-demo/launch -d "{}"', 2],
  ['expired window: preflight blocked', 'expired', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1"`, 2],
  ['malformed window: preflight blocked', 'malformed', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1"`, 2],
  ['over-3h window: preflight blocked', 'toolong', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1"`, 2],
  ['non-hex token: preflight blocked', 'badtoken', 'Bash', `${PS} -File "${T}\\vm-preflight-prod.ps1"`, 2],

  // ---- Agent ----------------------------------------------------------------
  ['Agent allowed while closed', 'closed', 'Agent', null, 0],
  ['Agent allowed while expired', 'expired', 'Agent', null, 0],
  ['Agent blocked while open', 'open', 'Agent', null, 2],

  // ---- always allowed -------------------------------------------------------
  ['kb-reader ssh, window closed', 'closed', 'Bash', 'ssh -o BatchMode=yes kb-reader "cat /var/lib/kb/state/outbox/ready"', 0],
  ['kb-reader ssh, window open', 'open', 'Bash', 'ssh -o BatchMode=yes kb-reader "ls /opt/kb-releases"', 0],
  ['kb-reader ssh, no -o flag', 'closed', 'Bash', 'ssh kb-reader hostname', 0],
  ['GET readyz while closed', 'closed', 'Bash', 'curl -s https://kb.tail82dd4f.ts.net/readyz', 0],
  ['GET runs list while closed', 'closed', 'Bash', 'curl -s https://kb.tail82dd4f.ts.net/api/control/runs', 0],
  ['GET run detail while closed', 'closed', 'Bash', 'curl -s https://kb.tail82dd4f.ts.net/api/control/runs/run-971d5ba4-16e5-4010-895f-33e69122984a', 0],
  ['Invoke-RestMethod GET while closed', 'closed', 'PowerShell', 'Invoke-RestMethod -Method Get -Uri https://kb.tail82dd4f.ts.net/api/schedules', 0],
  ['Invoke-RestMethod with no -Method while closed', 'closed', 'PowerShell', 'Invoke-RestMethod -Uri https://kb.tail82dd4f.ts.net/api/health', 0],
  ['rehearsal deploy (-VM root@localhost) while closed', 'closed', 'Bash', `${PS} -File "${T}\\kb-deploy.ps1" -SigningKey C:\\tmp\\throwaway -Sha ${SHA} -BrokerDigest ${DIGEST} -VM root@localhost -URL http://localhost:4317 -SshShimDir C:\\shims`, 0],
  ['rehearsal drain step1 (-VM root@localhost) while closed', 'closed', 'Bash', `${PS} -File "${T}\\drain-v2\\drain-step1-v2.ps1" -VM root@localhost -URL http://localhost:4317`, 0],
  ['rehearsal drain step1 while OPEN', 'open', 'Bash', `${PS} -File "${T}\\drain-v2\\drain-step1-v2.ps1" -VM root@localhost -URL http://localhost:4317`, 0],
  ['ordinary git command while open', 'open', 'Bash', 'git status --short', 0],
  ['ordinary test run while open', 'open', 'Bash', 'node --test tests/hooks/prod_window_guard.test.js', 0],

  // ---- O3 prod-schedules.ps1's four modes — OPEN class (T7), no window needed --------------
  ['O3 List, plain, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -List`, 0],
  ['O3 List, -Out under T', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -List -Out "${T}\\rehearsal\\p8\\snap.json"`, 0],
  ['O3 List, KB_PROD_WINDOW prefix', 'open', 'PowerShell', `${ENVPRE}${PS} -File "${T}\\prod-schedules.ps1" -List`, 0],
  // T7: prod-schedules.ps1 is OPEN class — all four modes now run with the window CLOSED.
  ['O3 List allowed when window closed (T7 open class)', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -List`, 0],
  ['O3 List + stray extra param blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -List -Foo bar`, 2],
  ['O3 List -Out path traversal blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -List -Out "${T}\\..\\evil.json"`, 2],

  ['O3 DisarmAgentCadences, plain, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\rehearsal\\p8\\before.json"`, 0],
  ['O3 DisarmAgentCadences allowed when window closed (T7 open class)', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\rehearsal\\p8\\before.json"`, 0],
  ['O3 wrong snapshot dir blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\snap.json"`, 2],
  ['O3 snapshot path traversal blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\rehearsal\\p8\\..\\..\\evil.json"`, 2],
  ['O3 + stray extra param blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\rehearsal\\p8\\before.json" -Force`, 2],
  ['O3 rehearsal URL always allowed, window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\rehearsal\\p8\\before.json" -URL http://127.0.0.1:4417`, 0],

  ['O3 ArmFromSnapshot, plain, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -ArmFromSnapshot "${T}\\rehearsal\\p8\\before.json"`, 0],
  ['O3 ArmFromSnapshot allowed when window closed (T7 open class)', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -ArmFromSnapshot "${T}\\rehearsal\\p8\\before.json"`, 0],
  ['O3 wrong snapshot dir blocked (Arm)', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -ArmFromSnapshot "${T}\\rehearsal\\before.json"`, 2],
  ['O3 + stray extra param blocked (Arm)', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -ArmFromSnapshot "${T}\\rehearsal\\p8\\before.json" -Yes`, 2],
  ['O3 rehearsal URL always allowed, window open (Arm)', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -ArmFromSnapshot "${T}\\rehearsal\\p8\\before.json" -URL http://localhost:4317`, 0],

  ['O3 CreateWorkflowSchedule, plain, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * *"`, 0],
  ['O3 CreateWorkflowSchedule, single-quoted cron', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron '18 3 * * *'`, 0],
  ['O3 CreateWorkflowSchedule allowed when window closed (T7 open class)', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * *"`, 0],
  ['O3 other workflow name blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule v1-acceptance-demo -Cron "18 3 * * *"`, 2],
  ['O3 cron with letters blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * mon"`, 2],
  ['O3 cron with semicolons blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18;3;*;*;*"`, 2],
  ['O3 + stray extra param blocked (Create)', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * *" -URL https://kb.tail82dd4f.ts.net`, 2],
  ['O3 rehearsal URL always allowed, window closed (Create)', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * *" -URL http://127.0.0.1:4417`, 0],

  // ---- O2 prod-respond.ps1 — OPEN class (T7): resolve a gate/intervention, no window needed ----
  ['O2 approve with a reason, window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-respond.ps1" -Run run-cc508ddb -Request req-1 -Decision approve -Reason "sources added, brief is correct"`, 0],
  ['O2 retry with a reason and -Actor, window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-respond.ps1" -Run run-1 -Request req-1 -Decision retry -Reason "needs another pass" -Actor boss`, 0],
  ['O2 abandon, window open (unaffected)', 'open', 'Bash', `${PS} -File "${T}\\prod-respond.ps1" -Run run-1 -Request req-1 -Decision abandon -Reason "stale, superseded"`, 0],
  ['O2 reason with a semicolon blocked (also D1 for this payload)', 'closed', 'Bash', `${PS} -File "${T}\\prod-respond.ps1" -Run run-1 -Request req-1 -Decision approve -Reason "a; rm -rf /"`, 2],
  ['O2 reason with $() blocked', 'closed', 'Bash', `${PS} -File "${T}\\prod-respond.ps1" -Run run-1 -Request req-1 -Decision approve -Reason "a $(whoami)"`, 2],
  ['O2 reason with a backtick blocked', 'closed', 'Bash', `${PS} -File "${T}\\prod-respond.ps1" -Run run-1 -Request req-1 -Decision approve -Reason "a \`id\`"`, 2],
  ['O2 unsafe decision value blocked', 'closed', 'Bash', `${PS} -File "${T}\\prod-respond.ps1" -Run run-1 -Request req-1 -Decision publish -Reason "ok"`, 2],
  ['O2 missing -Reason blocked', 'closed', 'Bash', `${PS} -File "${T}\\prod-respond.ps1" -Run run-1 -Request req-1 -Decision approve`, 2],
  ['O2 still subject to standing blocks (D)', 'closed', 'Bash', `${PS} -File "${T}\\prod-respond.ps1" -Run r -Request q -Decision approve -Reason "x" && rm -rf /`, 2],

  // ---- unsafe -Workflow ids explicitly blocked (T7 widened O1 grammar) ----------------------
  ['O1 -Workflow with an underscore blocked', 'closed', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow nightly_digest`, 2],
  ['O1 -Workflow starting with a hyphen blocked', 'closed', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow -bad`, 2],
  ['O1 -Workflow traversal blocked', 'closed', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow ../evil`, 2],

  // ---- C13/C14 — new signed-class helpers, WINDOWED (T7) --------------------------------
  // C13's shape is the shape the SCRIPT actually takes: -Key and -Out are Mandatory on
  // prod-sign-approval.ps1, and its TTL parameter is -ExpiresMinutes (there is no -TtlMinutes
  // and no -SigningKey). A shape that cannot run is not a reviewed shape.
  ['C13 prod-sign-approval blocked when window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "POST /api/schedules/:id" -Entity sched-7 -Key C:\\Users\\danie\\.ssh\\kb-ops-approver -Out ${T}\\approval.json`, 2],
  ['C13 prod-sign-approval allowed when window open', 'open', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "POST /api/schedules/:id" -Entity sched-7 -Key C:\\Users\\danie\\.ssh\\kb-ops-approver -Out ${T}\\approval.json`, 0],
  ['C13 prod-sign-approval with -Actor and -ExpiresMinutes, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "POST /api/control/budget/override" -Entity 2026-09-16 -Actor daniel -ExpiresMinutes 10 -Key C:\\Users\\danie\\.ssh\\kb-ops-approver -Out C:\\Users\\danie\\kb-backups\\approval-current\\approval.json`, 0],
  ['C13 prod-sign-approval -DryRun, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "DELETE /api/schedules/:id" -Entity sched-7 -Key C:\\Users\\danie\\.ssh\\kb-ops-approver -Out ${T}\\approval.json -DryRun`, 0],
  ['C13 old -TtlMinutes/-SigningKey spelling refused (the script has no such params)', 'open', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "POST /api/control/budget/override" -Entity 2026-09-16 -TtlMinutes 10 -SigningKey C:\\keys\\kb-ops-approver`, 2],
  ['C13 without the mandatory -Key/-Out refused', 'open', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "POST /api/schedules/:id" -Entity sched-7`, 2],
  ['C13 -Out outside T/kb-backups refused', 'open', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "POST /api/schedules/:id" -Entity sched-7 -Key C:\\Users\\danie\\.ssh\\kb-ops-approver -Out C:\\tmp\\approval.json`, 2],

  // T9: prod-sign-approval.ps1 carries no -VM/-URL (it never touches a network), so isRehearsal()'s
  // two existing clauses cannot see its rehearsal form. A -Key under the rehearsal tooling subtree
  // is a throwaway key that prod's allowed-signers file does not list, so it is rehearsal, not prod.
  ['rehearsal signing key, window closed, allowed', 'closed', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "DELETE /api/schedules/:id" -Entity sched-7 -Key ${T}\\rehearsal\\p2\\approver\\kb-ops-approver -Out ${T}\\rehearsal\\p11\\approval.json`, 0],
  ['rehearsal signing key traversal is not rehearsal', 'closed', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "DELETE /api/schedules/:id" -Entity sched-7 -Key ${T}\\rehearsal\\..\\..\\.ssh\\kb-ops-approver -Out ${T}\\rehearsal\\p11\\approval.json`, 2],
  ['rehearsal signing key cannot carry a second prod command', 'closed', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "DELETE /api/schedules/:id" -Entity sched-7 -Key ${T}\\rehearsal\\p2\\approver\\kb-ops-approver -Out ${T}\\rehearsal\\p11\\approval.json; ${PS} -File "${T}\\prod-stop-run.ps1"`, 2],
  ['real signing key, window closed, still blocked', 'closed', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "DELETE /api/schedules/:id" -Entity sched-7 -Key C:\\Users\\danie\\.ssh\\kb-ops-approver -Out ${T}\\approval.json`, 2],
  ['rehearsal signing key naming the prod host is still prod', 'closed', 'Bash', `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "DELETE /api/schedules/:id" -Entity sched-7 -Key ${T}\\rehearsal\\p2\\approver\\kb-ops-approver -Out ${T}\\approval.json # https://kb.tail82dd4f.ts.net`, 2],
  ['C14 human-approval signature blocked when window closed', 'closed', 'Bash', 'ssh-keygen -Y sign -f C:\\Users\\danie\\.ssh\\kb-ops-approver -n kb-human-approval C:\\Users\\danie\\kb-backups\\approval-current\\payload.json', 2],
  ['C14 human-approval signature allowed when window open', 'open', 'Bash', 'ssh-keygen -Y sign -f C:\\Users\\danie\\.ssh\\kb-ops-approver -n kb-human-approval C:\\Users\\danie\\kb-backups\\approval-current\\payload.json', 0],

  // ---- C15 — prod-signed-call.ps1, WINDOWED (T9). It is the script that actually PLACES a
  // signed, consequential call against the prod-defaulted URL, so with its default -URL the
  // command string names no host and, before T9, slipped past every classifier unclassified.
  ['C15 prod-signed-call blocked when window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-signed-call.ps1" -Route "DELETE /api/schedules/:id" -Approval ${T}\\approval.json`, 2],
  ['C15 prod-signed-call allowed when window open', 'open', 'Bash', `${PS} -File "${T}\\prod-signed-call.ps1" -Route "DELETE /api/schedules/:id" -Approval ${T}\\approval.json`, 0],
  ['C15 prod-signed-call with -Approval under kb-backups, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-signed-call.ps1" -Route "POST /api/control/budget/override" -Approval C:\\Users\\danie\\kb-backups\\approval-current\\approval.json -BodyFile ${T}\\body.json`, 0],
  ['C15 prod-signed-call with -Actor and -DryRun, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-signed-call.ps1" -Route "DELETE /api/schedules/:id" -Approval ${T}\\approval.json -Actor boss -DryRun`, 0],
  ['C15 prod-signed-call -Approval traversal blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-signed-call.ps1" -Route "DELETE /api/schedules/:id" -Approval ${T}\\..\\..\\secrets\\approval.json`, 2],
  ['C15 prod-signed-call -Approval outside T/kb-backups blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-signed-call.ps1" -Route "DELETE /api/schedules/:id" -Approval C:\\tmp\\approval.json`, 2],
  ['C15 inline -Body is refused on prod (use -BodyFile)', 'open', 'Bash', `${PS} -File "${T}\\prod-signed-call.ps1" -Route "POST /api/control/budget/override" -Approval ${T}\\approval.json -Body "{\\"windowDay\\":\\"2026-09-16\\"}"`, 2],
  ['C15 rehearsal URL always allowed, window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-signed-call.ps1" -Route "DELETE /api/schedules/:id" -Approval ${T}\\rehearsal\\p11\\approval.json -Body "{}" -URL http://127.0.0.1:4417`, 0],

  // ---- deploy/drain/preflight/canary/stop remain WINDOWED, unchanged by T7 ------------------
  ['windowed: kb-deploy still blocked when window closed', 'closed', 'Bash', `${PS} -File "${T}\\kb-deploy.ps1" -SigningKey k -Sha ${SHA} -BrokerDigest ${DIGEST}`, 2],
  ['windowed: kb-deploy still allowed when window open', 'open', 'Bash', `${PS} -File "${T}\\kb-deploy.ps1" -SigningKey k -Sha ${SHA} -BrokerDigest ${DIGEST}`, 0],

  // ---- GET-only monitoring stays non-prod-targeting under the new class split ---------------
  ['GET schedules list while closed (T7 regression check)', 'closed', 'Bash', 'curl -s https://kb.tail82dd4f.ts.net/api/schedules', 0],
  ['GET control interventions while closed (T7 regression check)', 'closed', 'PowerShell', 'Invoke-RestMethod -Method Get -Uri https://kb.tail82dd4f.ts.net/api/control/interventions', 0],

  // ---- standing blocks (D) --------------------------------------------------
  ['D1 rm -rf / (closed)', 'closed', 'Bash', 'rm -rf /', 2],
  ['D1 rm -rf /* (open)', 'open', 'Bash', 'rm -rf /*', 2],
  ['D1 rm -rf ~ (closed)', 'closed', 'Bash', 'rm -rf ~', 2],
  ['D2 chmod -R 777 / (closed)', 'closed', 'Bash', 'chmod -R 777 /', 2],
  ['D2 chown root /* (open)', 'open', 'Bash', 'chown -R root:root /*', 2],
  ['D3 git push --force origin main', 'closed', 'Bash', 'git push --force origin main', 2],
  ['D3 git push --force-with-lease ops', 'open', 'Bash', 'git push --force-with-lease origin HEAD:ops', 2],
  ['D3 git push -f main', 'closed', 'Bash', 'git push -f origin main', 2],
  ['D4 wsl --unregister', 'closed', 'PowerShell', 'wsl --unregister Ubuntu', 2],
  ['D5 git reset --hard in dashboard-ops', 'closed', 'Bash', 'git -C C:/Users/danie/kb-worktrees/dashboard-ops reset --hard origin/ops', 2],
  ['D5 git checkout -B in dashboard-ops', 'closed', 'Bash', 'git -C C:/Users/danie/kb-worktrees/dashboard-ops checkout -B ops origin/ops', 2],
  ['D6 mkfs', 'closed', 'Bash', 'mkfs.ext4 /dev/sdb1', 2],
  ['D6 dd if=', 'closed', 'Bash', 'dd if=/dev/zero of=/dev/sda bs=1M', 2],
  ['D6 fork bomb', 'closed', 'Bash', ':(){ :|:& };:', 2],
  ['D8 --dangerously-skip-permissions', 'closed', 'Bash', 'claude -p "do the thing" --dangerously-skip-permissions', 2],
  ['D: ordinary git push is fine', 'closed', 'Bash', 'git push origin claude/boss-2026-09-15', 0],
  ['D: single-file rm is fine', 'closed', 'Bash', 'rm -f C:/tmp/scratch.json', 0],
];

for (const [name, window, tool, command, expected] of CASES) {
  test(name, () => {
    setWindow(window);
    const input = tool === 'Agent'
      ? { description: 'test dispatch', prompt: 'Do some ordinary research.', subagent_type: 'general-purpose' }
      : { command };
    const { code, stderr } = runHook(tool, input);
    assert.strictEqual(code, expected,
      `expected exit ${expected}, got ${code}. stderr: ${stderr.trim()}`);
    if (expected === 2) assert.match(stderr, /^\[prod-window BLOCK\]/, 'block must explain itself on stderr');
    else assert.strictEqual(stderr.trim(), '', 'an allow must be silent');
  });
}

test('Agent dispatch carrying --dangerously-skip-permissions is blocked even while closed', () => {
  setWindow('closed');
  const { code, stderr } = runHook('Agent', {
    description: 'sneaky',
    prompt: 'run claude --dangerously-skip-permissions on the VM',
    subagent_type: 'general-purpose',
  });
  assert.strictEqual(code, 2);
  assert.match(stderr, /standing block D8/);
});

test('audit log records both decisions and masks the signing key', () => {
  fs.rmSync(AUDIT, { force: true });

  setWindow('closed');
  const blocked = runHook('Bash', { command: "ssh -o BatchMode=yes root@100.89.73.118 'hostname'" });
  assert.strictEqual(blocked.code, 2);

  setWindow('open');
  const allowed = runHook('Bash', {
    command: `${PS} -File "${T}\\kb-deploy.ps1" -SigningKey C:\\keys\\super-secret-release.pem -Sha ${SHA} -BrokerDigest ${DIGEST}`,
  });
  assert.strictEqual(allowed.code, 0);

  const log = fs.readFileSync(AUDIT, 'utf8').trim().split('\n');
  assert.strictEqual(log.length, 2, 'one line per prod-targeting decision');
  assert.match(log[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z BLOCK Bash A1 ssh -o BatchMode=yes root@100\.89\.73\.118/);
  assert.match(log[1], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z ALLOW Bash C2 /);
  assert.match(log[1], /-SigningKey <key>/, 'the key path must be masked');
  assert.ok(!log[1].includes('super-secret-release.pem'), 'the key path must never be logged');
  assert.ok(log.every(line => line.length <= 340), 'each line stays near the 300-char command cap');
});

test('T7: the -Actor arg on prod-respond.ps1 is recorded on the audit line when present', () => {
  fs.rmSync(AUDIT, { force: true });
  setWindow('closed');
  const withActor = runHook('Bash', {
    command: `${PS} -File "${T}\\prod-respond.ps1" -Run run-1 -Request req-1 -Decision approve `
      + '-Reason "sources look right" -Actor boss',
  });
  assert.strictEqual(withActor.code, 0);
  const withoutActor = runHook('Bash', {
    command: `${PS} -File "${T}\\prod-respond.ps1" -Run run-2 -Request req-2 -Decision retry `
      + '-Reason "needs a second pass"',
  });
  assert.strictEqual(withoutActor.code, 0);

  const log = fs.readFileSync(AUDIT, 'utf8').trim().split('\n');
  assert.strictEqual(log.length, 2);
  assert.match(log[0], /^\d{4}-\d{2}-\d{2}T[\d:.]+Z ALLOW Bash O2 actor=boss /,
    'the -Actor value is recorded on the audit line when present');
  assert.doesNotMatch(log[1], /actor=/,
    'no actor field is written when -Actor was not on the command line');
});

test('a sign command never leaks the private key path into the log', () => {
  fs.rmSync(AUDIT, { force: true });
  setWindow('open');
  const res = runHook('Bash', {
    command: 'ssh-keygen -Y sign -f C:\\keys\\kb-ops-approver-private -n kb-ops-instructions '
      + '"C:\\Users\\danie\\kb-backups\\outbox-approval-current\\instruction-approval.json"',
  });
  assert.strictEqual(res.code, 0);
  const log = fs.readFileSync(AUDIT, 'utf8');
  assert.ok(!log.includes('kb-ops-approver-private'), 'the signing key path must be masked');
  assert.match(log, /-f <key>/);
});

test('T9: prod-sign-approval.ps1 -Key is masked in the audit log', () => {
  fs.rmSync(AUDIT, { force: true });
  setWindow('open');
  const res = runHook('Bash', {
    command: `${PS} -File "${T}\\prod-sign-approval.ps1" -Route "POST /api/schedules/:id" `
      + `-Entity sched-7 -Key C:\\keys\\kb-ops-approver-private -Out ${T}\\approval.json`,
  });
  assert.strictEqual(res.code, 0);
  const log = fs.readFileSync(AUDIT, 'utf8');
  assert.match(log, / ALLOW Bash C13 /);
  assert.ok(!log.includes('kb-ops-approver-private'), 'the signing key path must be masked');
  assert.match(log, /-Key <key>/);
});

test('an Agent block while the window is open is audited', () => {
  fs.rmSync(AUDIT, { force: true });
  setWindow('open');
  const res = runHook('Agent', { description: 'x', prompt: 'anything', subagent_type: 'general-purpose' });
  assert.strictEqual(res.code, 2);
  const log = fs.readFileSync(AUDIT, 'utf8');
  assert.match(log, / BLOCK Agent C0 /);
});

test('an unrelated tool is ignored', () => {
  setWindow('open');
  const payload = JSON.stringify({ tool_name: 'Read', tool_input: { file_path: 'C:\\x.txt' } });
  const res = spawnSync(process.execPath, [HOOK], { input: payload, encoding: 'utf8' });
  assert.strictEqual(res.status, 0);
});

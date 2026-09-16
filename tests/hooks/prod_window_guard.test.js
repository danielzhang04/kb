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
const SHA = 'f5b3204497a328f4580d07952394a8f39fc9eb57';
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

  ['C8 run-workflow self-lint-report', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow self-lint-report`, 0],
  ['C8 run-workflow v1-acceptance-demo', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow v1-acceptance-demo`, 0],
  ['C8 run-workflow v1-acceptance-demo -Topic tailnet-trust', 'open', 'PowerShell', `${ENVPRE}${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow v1-acceptance-demo -Topic tailnet-trust`, 0],
  ['C8 a third workflow id blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow queue-drain-report`, 2],
  ['C8 -Topic ../x blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow v1-acceptance-demo -Topic ../x`, 2],
  ['C8 -Topic on self-lint-report blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow self-lint-report -Topic tailnet-trust`, 2],
  ['C8 + stray -URL blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow self-lint-report -URL https://kb.tail82dd4f.ts.net`, 2],
  ['C8 blocked when the window is closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-run-workflow.ps1" -Workflow self-lint-report`, 2],

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

  // ---- prod-schedules.ps1 (C9-C12) -------------------------------------------
  ['C9 List, plain', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -List`, 0],
  ['C9 List, -Out under T', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -List -Out "${T}\\rehearsal\\p8\\snap.json"`, 0],
  ['C9 List, KB_PROD_WINDOW prefix', 'open', 'PowerShell', `${ENVPRE}${PS} -File "${T}\\prod-schedules.ps1" -List`, 0],
  ['C9 List blocked when window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -List`, 2],
  ['C9 List + stray extra param blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -List -Foo bar`, 2],
  ['C9 List -Out path traversal blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -List -Out "${T}\\..\\evil.json"`, 2],

  ['C10 DisarmAgentCadences, plain', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\rehearsal\\p8\\before.json"`, 0],
  ['C10 blocked when window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\rehearsal\\p8\\before.json"`, 2],
  ['C10 wrong snapshot dir blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\snap.json"`, 2],
  ['C10 snapshot path traversal blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\rehearsal\\p8\\..\\..\\evil.json"`, 2],
  ['C10 + stray extra param blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\rehearsal\\p8\\before.json" -Force`, 2],
  ['C10 rehearsal URL always allowed, window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -DisarmAgentCadences -Snapshot "${T}\\rehearsal\\p8\\before.json" -URL http://127.0.0.1:4417`, 0],

  ['C11 ArmFromSnapshot, plain', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -ArmFromSnapshot "${T}\\rehearsal\\p8\\before.json"`, 0],
  ['C11 blocked when window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -ArmFromSnapshot "${T}\\rehearsal\\p8\\before.json"`, 2],
  ['C11 wrong snapshot dir blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -ArmFromSnapshot "${T}\\rehearsal\\before.json"`, 2],
  ['C11 + stray extra param blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -ArmFromSnapshot "${T}\\rehearsal\\p8\\before.json" -Yes`, 2],
  ['C11 rehearsal URL always allowed, window open', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -ArmFromSnapshot "${T}\\rehearsal\\p8\\before.json" -URL http://localhost:4317`, 0],

  ['C12 CreateWorkflowSchedule, plain', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * *"`, 0],
  ['C12 CreateWorkflowSchedule, single-quoted cron', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron '18 3 * * *'`, 0],
  ['C12 blocked when window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * *"`, 2],
  ['C12 other workflow name blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule v1-acceptance-demo -Cron "18 3 * * *"`, 2],
  ['C12 cron with letters blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * mon"`, 2],
  ['C12 cron with semicolons blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18;3;*;*;*"`, 2],
  ['C12 + stray extra param blocked', 'open', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * *" -URL https://kb.tail82dd4f.ts.net`, 2],
  ['C12 rehearsal URL always allowed, window closed', 'closed', 'Bash', `${PS} -File "${T}\\prod-schedules.ps1" -CreateWorkflowSchedule self-lint-report -Cron "18 3 * * *" -URL http://127.0.0.1:4417`, 0],

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

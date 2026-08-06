# Dashboard UX — merge + cleanup handoff — 2026-08-06

**Topic:** The full dashboard UX arc (7-phase overhaul + three live-feedback waves) is BUILT,
Daniel-reviewed in place, and pushed. A fresh terminal picks this up to: finish review polish if
Daniel asks, MERGE the branch stack, repoint prod, retire the temp daemon, and clean up.
Supersedes `handoffs/2026-08-05-dashboard-ux-overhaul.md` (deleted in this push).

**Branch:** `claude/dashboard-ux-overhaul` @ `efab405` (pushed; remote == local), worktree
`C:/Users/danie/kb-worktrees/boss-dashboard-ux`, tree clean. STACKS ON `claude/headless-roster`
@ `ae8a80c` (worktree `C:/Users/danie/kb-worktrees/headless-roster`, also unmerged) — **merge
headless-roster first (or merge the ux branch directly, which contains it)**. All merges are T3
= Daniel's passkey on GitHub.

### What WORKED (evidence in each commit message; every worker transcript-verified lower-model)
- 7-phase overhaul: single unlock (sessionContext), naming/#refs, ONE Workflows tab, link-only
  inbox w/ plain asks + Tasks-hosted card gates, run archival, Run-agent PTY spawn behind a
  scanned-declaration allowlist, stop floor → Sentinel, shared visual tokens, −6,974-LOC
  adversarially-verified deletion wave. Net arc ≈ −7,000 lines with major features added.
- Live-feedback wave: accent C (warm parchment) landed; read/write rate budgets split (the 429
  lockout was a 30/min-per-IP guard fronting every governed GET); ONE unlock total — second
  WebAuthn ceremony on execution arming REMOVED (Daniel explicitly approved the security
  downgrade after the risk delta was presented) and sign-in AUTO-ARMS execution; topbar Locked
  chip became a real accent-filled Unlock button; pty spawn fixed (conpty needs an absolute exe
  path — `server/pty/resolveCommand.ts`); graph rendered (reactflow needs explicit height);
  agent model routing honors declarations+roles (fyt-runner=gpt-5.6-sol).
- Session-console wave (Daniel-ratified design): `ConsolePane` extracted (spawn|attach union;
  remount-reattaches-never-respawns pinned by test); Run agent lives IN AgentDetail;
  `SessionRun` records (`server/pty/sessionRuns.ts` — daemon-driven live→ended/abandoned→
  archived, T3-audited dismiss; deliberately NOT a control-plane run); transcripts via the
  `observe()` tap to `<stateRoot>/pty/transcripts`; WorkflowDetail Flow|Runs merges governed
  runs + chat sessions with explicit kind chips. DOCTRINE (Daniel-ratified): governed RunDetail
  never hosts a terminal; chat sessions never look governed.
- Six-item polish: session TTL 5min → 8h (launcher env `DASHBOARD_SESSION_TTL_MS`); every
  claude spawn hard-capped `--effort high` + roster-resolved `--model` (claude-runtime only;
  codex agents audited `modelSkippedForRuntime`); workflow graph re-keyed ONE CARD PER AGENT
  (stages inside, 21 deps → 9 handoffs, framed at zoom 1.0).
- Verification state at `efab405`: src 618/618 exit 0, server/pty 136/136, tsc = exactly 7
  pre-existing errors (4× pngjs TS7016, 3× paidAction*), vite build clean.

### What Did NOT Work (do not retry)
- vitest pass-count as a green signal — a suite passed 534/534 WITH 2 uncaught render
  exceptions. Grade the "Errors" line + exit code.
- PowerShell `2>&1 | Select-String` mangles native exit codes; `git commit -m` with embedded
  quotes shreds argv — use `git commit -F <file>` and read $LASTEXITCODE unpiped.
- Bare `claude` via node-pty — conpty does no PATHEXT resolution ("File not found: " empty).
- `min-height` on a reactflow container — percentage heights resolve against the height
  PROPERTY; explicit height required.
- Sharing one rate bucket between UI polling reads and writes; sharing prod's state root
  between two daemons (single-writer).
- `--version` as CLI flag validation — it validates nothing; only a real session round trip does.

### Known-flaky / pre-existing test baseline (do NOT chase; reproduce-isolated before believing red)
- Pre-existing genuine failures: `server/write/workflowRun.test.ts:265` (asserts repo-state of
  scripts/agent_runner.ps1); `server/control/canonicalResultEmbeddedPython` can 5s-timeout.
- Load-flaky (green isolated): workflows/routes, fyt.videoRun.registration, store,
  synthetic-acceptance, authorizedFailedRunReconciliation.
- tsc: exactly 7 errors is baseline-green.

### Current State
| Thing | State | Notes |
| ----- | ----- | ----- |
| `claude/dashboard-ux-overhaul` | DONE, pushed, unmerged | 34 commits over base ae8a80c |
| `claude/headless-roster` | unmerged base | merge first or subsume |
| Prod pm2 `kb-dashboard` (5317) | **STOPPED** (Daniel ran pm2 stop) | rollback: `pm2 start kb-dashboard` |
| 4620 temp daemon | RUNNING = the live dashboard | node process from the launcher below; repo root `kb-worktrees/dashboard-ops`, state root `AppData/Local/kb-dashboard` (REAL prod state), TTL 8h, executor passkey-gated |
| Launcher script | session-scratchpad only — COPY FROM APPENDIX below before this session's temp dir is cleaned | |

### Exact Next Steps (in order)
1. Daniel merges (T3): `headless-roster` → main, then `dashboard-ux-overhaul` → main (or the ux
   branch alone, which contains headless-roster). Verify remote==local + `git rev-list --count
   origin/main..<branch>` == 0 after; then delete both branches + worktrees
   (`boss-dashboard-ux`, `headless-roster`) per hygiene.
2. Repoint prod: `cd C:/Users/danie/kb && git pull` (main checkout must sit on a work branch —
   never checkout ops/main there; pm2 reads `C:/Users/danie/kb/dashboard`), rebuild dist
   (`npx vite build` from kb/dashboard), add `DASHBOARD_SESSION_TTL_MS` to pm2.config.cjs env
   (Daniel gate on keeping 8h in prod), kill the 4620 temp daemon, `pm2 start kb-dashboard`,
   retest ON 5317 (Daniel wants this explicitly).
3. Then: make ONE workflow run fully operational end-to-end (Daniel's named next objective) —
   Run workflow → governing agent chats → launches governed stage work → visible in Flow|Runs.
4. Cleanup owed regardless: archive the 8 stale waiting-human runs (operator one-click in
   RunDetail); sweep `.playwright-mcp/`, `naming.json` stray if any reappears.

### Follow-ups owed (backlog, not blockers)
- Sliding session renewal (8h fixed TTL is a stopgap; also consider whether 8h belongs in prod).
- `server/write/launch.ts:222` declaration-blind model routing (one-argument fix).
- ATTEMPT_EDGES['waiting-human'] wedge (parked attempts left `interrupted`).
- `server/timeline/stream.ts` wire-or-cut ruling.
- Session-run naming ordinals (EntityKind extension).
- kb-ops workflow defs lack `governedBy` (3 frontmatter lines each; Daniel aware).
- Honest cross-runtime console (spawning codex CLI for codex-runtime agents).
- Fix `write/workflowRun.test.ts:265` + the embeddedPython timeout (pre-existing baseline reds).

### Load list
- This file, then personal memory `dashboard-ux-overhaul-arc` (auto-memory, supersedes older handoff state)
- Worktree `C:/Users/danie/kb-worktrees/boss-dashboard-ux`: `docs/superpowers/specs/2026-08-04-dashboard-ux-overhaul-design.md`, `docs/superpowers/plans/2026-08-05-deletion-manifest.md`
- `git log --oneline ae8a80c..efab405` in that worktree — every commit message carries its verification evidence
- `memory/claude-boss.md` (2026-08-05 lessons)

### APPENDIX — 4620 daemon launcher (recreate as start-ux-daemon.mjs anywhere outside the repo; run with `node <path>`; stop = taskkill the PID listening on 4620)
```js
// UX acceptance/live daemon. Prod pm2 kb-dashboard MUST be stopped first (single writer on the
// control store). Rollback: kill this, `pm2 start kb-dashboard`.
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const pm2cfg = require('C:/Users/danie/kb/dashboard/pm2.config.cjs');
const prodEnv = (pm2cfg.apps ?? []).map((a) => a.env ?? {}).find((e) => e.DASHBOARD_WEBAUTHN_CREDENTIALS);
if (!prodEnv) { console.error('no app in pm2.config.cjs carries DASHBOARD_WEBAUTHN_CREDENTIALS'); process.exit(1); }
function liftEnvKey(text, name) {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    if (line.slice(0, eq).trim() !== name) continue;
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    return v;
  }
  return '';
}
const dotenv = readFileSync('C:/Users/danie/kb/orgs/faceless-youtube/.env', 'utf8');
const geminiKey = liftEnvKey(dotenv, 'GEMINI_API_KEY');
const elevenKey = liftEnvKey(dotenv, 'ELEVENLABS_API_KEY');
if (!geminiKey || !elevenKey) { console.error('provider keys not found in .env'); process.exit(1); }
const STATE_ROOT = 'C:\\Users\\danie\\AppData\\Local\\kb-dashboard'; // REAL prod state
mkdirSync(STATE_ROOT, { recursive: true });
const env = {
  ...process.env,
  DASHBOARD_WEBAUTHN_CREDENTIALS: prodEnv.DASHBOARD_WEBAUTHN_CREDENTIALS,
  DASHBOARD_REPO_ROOT: 'C:\\Users\\danie\\kb-worktrees\\dashboard-ops',
  DASHBOARD_STATE_ROOT: STATE_ROOT,
  DASHBOARD_PORT: '4620',
  DASHBOARD_RP_ORIGIN: 'http://localhost:4620',
  DASHBOARD_SESSION_TTL_MS: String(8 * 60 * 60 * 1000),
  GEMINI_API_KEY: geminiKey,
  ELEVENLABS_API_KEY: elevenKey,
};
delete env.DASHBOARD_EXECUTION_ACTIVATED;
delete env.DASHBOARD_PROVIDER_SECRETS;
delete env.CLAUDE_CODE_CHILD_SESSION;
const child = spawn(process.execPath, ['server/index.ts'], {
  cwd: 'C:\\Users\\danie\\kb-worktrees\\boss-dashboard-ux\\dashboard',
  env,
  stdio: 'inherit',
});
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
```
NOTE: after the merge, change `cwd` to `C:\\Users\\danie\\kb\\dashboard` — or better, retire
this launcher entirely and go back to pm2 (step 2 above).

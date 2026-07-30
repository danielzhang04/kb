/**
 * THE ONE TEST THAT EXECUTES A REAL `claude`.
 *
 * Every other roster-permission test asserts the STRINGS this module emits. That is why a rule grammar
 * the CLI silently ignores shipped green: `permissions.allow` rules were written with a `//`-absolute
 * pathspec that matches nothing on Windows, so the settings file granted exactly zero, and a suite that
 * only ever compared rule text against expected rule text could not see it. This closes that gap by
 * running the generated file through the binary it is written for.
 *
 * GATED, because it costs real model calls and needs a working CLI install: it runs ONLY with
 * `ROSTER_LIVE_PERM_TEST=1` in the environment and skips cleanly otherwise. Point
 * `ROSTER_LIVE_CLAUDE_BIN` at the binary if `claude` is not on PATH.
 *
 *   ROSTER_LIVE_PERM_TEST=1 npx vitest run server/control/rosterSessions.live.test.ts
 *
 * It works in a throwaway temp fixture and NEVER against a real checkout: the settings it exercises name
 * their own `repoRoot`, so a stray write lands in the fixture and dies with it.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import { buildRosterPermissionSettings, detectReplReadiness, stripTerminalControl } from './rosterSessions.ts';

const LIVE = process.env.ROSTER_LIVE_PERM_TEST === '1';
// NOT via a shell: on Windows `shell: true` concatenates argv without quoting, which truncates the
// prompt at its first space and produces a turn that answers a fragment instead of the test's question.
const CLAUDE = process.env.ROSTER_LIVE_CLAUDE_BIN ?? (process.platform === 'win32' ? 'claude.exe' : 'claude');
/** Each `-p` turn is a real model call: generous, and still bounded so a hung CLI cannot wedge CI. */
const TURN_TIMEOUT_MS = 240_000;

interface HeadlessRun {
  denials: Array<{ tool_name: string; tool_input: unknown }>;
  result: string;
}

const roots = new Set<string>();

afterAll(() => {
  // A temp dir the just-exited CLI still has a handle on throws EBUSY/EPERM on Windows. Leaving a
  // directory in the OS temp folder must never be the reason this test reports a failure.
  for (const root of roots) {
    try { rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }); } catch { /* the OS reaps it */ }
  }
});

/** A throwaway "repo" with the scope directory the generated settings will name. */
function fixture(): { repoRoot: string; agentDir: string; settingsPath: string } {
  const root = mkdtempSync(join(tmpdir(), 'roster-live-'));
  roots.add(root);
  const repoRoot = join(root, 'repo').replace(/\\/g, '/');
  const agentDir = join(root, 'state', 'control', 'roster', 'run-live', 'fyt-story').replace(/\\/g, '/');
  mkdirSync(join(repoRoot, 'orgs', 'faceless-youtube', 'channels'), { recursive: true });
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'binding.md'), '# binding\n\nYou are fyt-story.\n');
  return { repoRoot, agentDir, settingsPath: join(root, 'settings.json').replace(/\\/g, '/') };
}

interface PtyLike { onData(cb: (d: string) => void): void; kill(): void; }
interface PtyModule { spawn(file: string, args: string[], opts: Record<string, unknown>): PtyLike; }

/**
 * node-pty, loaded lazily so the file imports even where the native ConPTY addon is not built. The
 * interactive regression below is the ONLY thing that needs it; a missing addon skips that case cleanly.
 */
function loadPty(): PtyModule | null {
  try {
    return createRequire(import.meta.url)('node-pty') as PtyModule;
  } catch {
    return null;
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => { setTimeout(resolve, ms); });

/** One headless turn under an exact settings file. `-p` cannot prompt, so a refusal surfaces as data. */
function runHeadless(cwd: string, settingsPath: string, prompt: string): HeadlessRun {
  const proc = spawnSync(
    CLAUDE,
    ['-p', '--output-format', 'json', '--settings', settingsPath, prompt],
    { cwd, encoding: 'utf8', timeout: TURN_TIMEOUT_MS },
  );
  const raw = `${proc.stdout ?? ''}`.trim();
  if (raw === '') throw new Error(`claude produced no output (status ${proc.status}): ${proc.stderr ?? ''}`);
  const parsed = JSON.parse(raw) as { permission_denials?: HeadlessRun['denials']; result?: string };
  return { denials: parsed.permission_denials ?? [], result: parsed.result ?? '' };
}

describe.skipIf(!LIVE)('roster permission settings against a live claude (gated)', () => {
  it('grants an in-scope write through the ALLOW rules alone — the B1 regression test', () => {
    const { repoRoot, agentDir, settingsPath } = fixture();
    const settings = buildRosterPermissionSettings({
      repoRoot,
      agentDir,
      read: ['orgs/faceless-youtube'],
      write: ['orgs/faceless-youtube/channels'],
      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    });
    // `defaultMode` is REMOVED for this case on purpose. Under the auto mode a write succeeds whatever
    // the allow list says, which is precisely how inert rules hid: this asserts the rules themselves.
    const parsed = JSON.parse(settings.json) as { permissions: Record<string, unknown> };
    delete parsed.permissions.defaultMode;
    writeFileSync(settingsPath, JSON.stringify(parsed, null, 2));

    const target = 'orgs/faceless-youtube/channels/brief.md';
    const run = runHeadless(repoRoot, settingsPath, `Use the Write tool to create the file ${target} containing exactly the line: ok`);

    expect(run.denials).toEqual([]);
    // The turn's own words, so a failure here is diagnosable without re-running the CLI by hand.
    expect(existsSync(join(repoRoot, target)), `claude said: ${run.result}`).toBe(true);
    expect(readFileSync(join(repoRoot, target), 'utf8')).toContain('ok');
  });

  it('still blocks a floor-listed action under the auto defaultMode — the floor really enforces', () => {
    const { repoRoot, agentDir, settingsPath } = fixture();
    const settings = buildRosterPermissionSettings({
      repoRoot,
      agentDir,
      read: ['orgs/faceless-youtube'],
      write: ['orgs/faceless-youtube/channels'],
      tools: ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep'],
    });
    // Verbatim: the exact bytes a roster session is launched with, auto mode included.
    writeFileSync(settingsPath, settings.json);

    const run = runHeadless(repoRoot, settingsPath, 'Run the bash command `git config --get user.name` and report exactly what happened.');

    // deny/ask/allow evaluate in that fixed order whatever the mode is — auto skips ASK, never DENY.
    const blocked = run.denials.some((denial) => denial.tool_name === 'Bash')
      || /deni|blocked|not permitted|permission/i.test(run.result);
    expect(blocked).toBe(true);
  });

  /**
   * THE INTERACTIVE REGRESSION — the one the `-p` cases structurally cannot catch. Headless mode skips
   * every interactive prompt, so it never sees the first-launch Bypass-Permissions acceptance modal that
   * stalled the idea stage: the roster substrate is an INTERACTIVE REPL, delivery TYPES a line into it,
   * and the bug was `detectReplReadiness` green-lighting that type into the acceptance modal (whose menu
   * columns are cursor moves, so it read as a non-empty, menu-free, busy-marker-free "ready" frame). The
   * order was consumed by the menu and no turn began.
   *
   * This drives a REAL `claude` under a pty with the verbatim generated settings in a FRESH project dir
   * and feeds its actual output through the same `stripTerminalControl` + `detectReplReadiness` the daemon
   * uses. The invariant, whichever config state the box is in:
   *   - If the acceptance modal appears (config has not recorded acceptance), readiness must NEVER reach
   *     `ready` while it is up — the gate must refuse to type, so the delivery parks instead of swallowing.
   *   - If the modal does NOT appear (acceptance already recorded — the pipeline's normal state), the REPL
   *     comes up and readiness MUST reach `ready`, proving the launch lands directly at the input line.
   * Either way the classifier reaches a DECIDED state — never an indefinite silent "running" stall.
   */
  it('never green-lights a type into the first-launch acceptance modal (interactive)', async () => {
    const pty = loadPty();
    if (!pty) return; // native ConPTY addon absent — the headless cases still cover the rule grammar.
    const { repoRoot, agentDir, settingsPath } = fixture();
    const settings = buildRosterPermissionSettings({
      repoRoot, agentDir,
      read: ['orgs/faceless-youtube'], write: ['orgs/faceless-youtube/channels'],
      tools: ['Read', 'Write', 'Edit', 'Glob', 'Grep'],
    });
    // Verbatim: the exact bytes a roster session boots with, `defaultMode: bypassPermissions` included.
    writeFileSync(settingsPath, settings.json);

    const term = pty.spawn(CLAUDE, ['--model', 'claude-sonnet-4-5', '--settings', settingsPath], {
      name: 'xterm-color', cols: 120, rows: 40, cwd: repoRoot, env: process.env,
    });
    let screen = '';
    let everReady = false;
    let sawModal = false;
    let sawFooter = false;
    term.onData((chunk) => {
      screen = (screen + stripTerminalControl(chunk)).slice(-8000);
      const state = detectReplReadiness(screen).state;
      if (state === 'ready') everReady = true;
      if (/Bypass\s*Permissions\s*mode/i.test(screen)) sawModal = true;
      if (/shift\s*\+?\s*tab\s*to\s*cycle/i.test(screen)) sawFooter = true;
    });
    // Long enough for the modal to draw or the REPL to come up; the CLI is never sent a keystroke.
    await delay(20_000);
    term.kill();

    // Something rendered — otherwise the assertions below are vacuous.
    expect(screen.length, `claude produced no interactive output; screen=${JSON.stringify(screen.slice(-400))}`).toBeGreaterThan(0);
    if (sawModal && !sawFooter) {
      // The acceptance modal is up and unanswered: the gate MUST NOT have called it ready.
      expect(everReady, 'readiness reached READY while the acceptance modal was on screen — a delivered order would be swallowed').toBe(false);
    } else {
      // Acceptance already recorded: the REPL came up, so readiness MUST have reached ready.
      expect(everReady, `no acceptance modal, but readiness never reached READY; screen=${JSON.stringify(screen.slice(-400))}`).toBe(true);
    }
  }, 30_000);
});

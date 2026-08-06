/**
 * T7 — the synthetic acceptance harness (HUMAN-SUPERVISED; not a build step; inert at import).
 *
 * This drives ONE synthetic, low-risk run through the REAL Wave-A dispatch path end-to-end — the exact
 * production code (`dispatchClaimedCard` -> map -> compile -> import+approve -> `executeApprovedLaunch` ->
 * gated `runAutomatic` -> real `claude -p` worker -> canonical `## Result` writeback -> the real
 * `defaultReconcileTriggerCard` git mechanics -> the `settleFleetCostLedger` post-run seam). It exists so
 * Daniel can prove the whole chain on a watched, gate-ON session BEFORE the live-fire (T8).
 *
 * Safety rails, by construction:
 *   - INERT AT IMPORT. Importing this module constructs and runs NOTHING; only the `import.meta.main`
 *     guard at the bottom calls `main()`.
 *   - REFUSES unless the gate is ALREADY on in this process (`DASHBOARD_EXECUTION_ACTIVATED === '1'`) AND
 *     `--confirm-live` is passed. It NEVER sets the activation gate itself, and never touches the live
 *     daemon / systemd environment — Daniel sets the gate in his watched session; the harness only reads it.
 *   - CANNOT MUTATE REAL PROJECT STATE, enforced by code (not by git defaults). `setUpThrowawayRepo`
 *     `git clone --local`s the current repo into a throwaway temp dir, creates a local `ops` branch (the
 *     coordination seam in write/branch.ts refuses any coordination write unless HEAD is exactly `ops`
 *     and it pull/pushes `origin ops`), and RE-POINTS the clone's `origin` at an ISOLATED throwaway BARE
 *     mirror — replacing the `origin` that `git clone` set to the REAL repo. So the canonical `## Result`
 *     writeback and `defaultReconcileTriggerCard` push land in the throwaway mirror and PROVABLY cannot
 *     reach real state. `assertCoordinationRemoteIsolated` is a belt-and-braces guard: it refuses to run
 *     if the coordination remote ever resolves back to the real repo path. `KB_STATE_DIR` points
 *     at a separate temp dir, so the control-plane state, worktrees, and fleet ledger are throwaway too.
 *   - The synthetic work order is a no-op single-file write with NO web/tool/spend/publish intent.
 *
 * The fault matrix (daemon restart, Stop, Retry, Reroute, HumanRequest round-trip, publication-fault) is
 * driven by Daniel per docs/runbooks/2026-07-20-wave-a-acceptance-runbook.md; this harness proves the
 * happy path + the real `claude -p` spawn under subscription auth and prints PASS/FAIL check lines the
 * runbook cross-references.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with explicit `.ts` specifiers.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSurfaceContext } from '../http/surface.ts';
import { createInternalServiceCaller, isExecutionActivated, DASHBOARD_EXECUTOR_SUBJECT } from './activation.ts';
import { dispatchClaimedCard, type OwnedCard } from './queueBridge.ts';
import { defaultPyRunner } from '../write/launch.ts';
import type { SurfaceContext } from '../http/context.ts';

export class AcceptanceRefusal extends Error {}

/** The synthetic run is low-risk and no-op: a single-file write, no web, no spend, no publish. */
const SYNTHETIC = {
  project: 'kb-ops',
  action: 'report:self-lint',
  target: 'orgs/kb-ops/output',
  profile: 'scanner',
  riskTier: 'T1',
  body: [
    '## Work order',
    '',
    'This is a SYNTHETIC ACCEPTANCE no-op. Write the single line `SYNTHETIC-ACCEPTANCE-OK` to',
    '`orgs/kb-ops/output/synthetic-acceptance.md` and then stop. Do NOT use WebSearch or WebFetch, do NOT',
    'take any external action, and make no other change to the repository.',
    '',
  ].join('\n'),
} as const;

/**
 * The gate for the WHOLE harness. Throws unless the activation gate is already on in THIS process and the
 * operator explicitly confirmed a live, watched run. This is the build-verified behavior (the harness
 * refuses to run gate-off); the live run past this point is Daniel's.
 */
export function assertAcceptanceGate(
  env: Record<string, string | undefined> = process.env,
  argv: readonly string[] = process.argv.slice(2),
): void {
  if (!isExecutionActivated(env)) {
    throw new AcceptanceRefusal(
      'refusing to run: DASHBOARD_EXECUTION_ACTIVATED is not "1". Set the gate in your watched session '
        + 'first (the harness never sets it for you).',
    );
  }
  if (!argv.includes('--confirm-live')) {
    throw new AcceptanceRefusal(
      'refusing to run: pass --confirm-live to acknowledge this spawns a real `claude` worker in a '
        + 'session you are actively watching.',
    );
  }
}

/** Embedded python that mints a schema-valid synthetic trigger card via scripts/cards.py and saves it. */
const WRITE_SYNTHETIC_CARD_SCRIPT = `
import sys, json
from pathlib import Path
sys.path.insert(0, "scripts")
import cards
op = json.loads(sys.argv[1])
card = cards.new_card(op["project"], op["action"], op["target"], op["riskTier"], body=op["body"],
                      profile=op["profile"], owner=op["owner"], **{"execution-controller": "dashboard"})
card.meta["state"] = "inbox"
path = cards.save(card, Path("queue"))
print(json.dumps({"id": card.meta["id"], "path": str(path.relative_to(Path(".")))}))
`.trim();

function git(repo: string, args: readonly string[]): string {
  return execFileSync('git', [...args], { cwd: repo, encoding: 'utf8' });
}

/** Best-effort real absolute path so a mirror path and a real-repo path compare canonically. */
function canonicalPath(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return resolve(p);
  }
}

/** The isolated coordination target for one acceptance run: the throwaway clone + its bare mirror. */
export interface ThrowawayRepo {
  /** The working clone; `repoRoot` for the run. On `ops`, `origin` -> the bare mirror. */
  repoRoot: string;
  /** The bare mirror the coordination remote pushes to. NEVER the real repo. */
  coordinationRemote: string;
}

/**
 * Stand up an isolated throwaway repo for one acceptance run. Three moves, all required for the real
 * coordination seam (write/branch.ts) to work AND for isolation to be CODE-enforced:
 *   1. `git clone --local` the source (full content, so policy/profiles/orgs load in the clone).
 *   2. Create a local `ops` branch — `assertCoordinationCheckout` refuses any coordination write unless
 *      HEAD is exactly `ops`, and prepare/commit pull/push `origin ops`.
 *   3. RE-POINT `origin` at a fresh throwaway BARE clone (replacing the `origin` clone set to the REAL
 *      repo) and seed `origin/ops` by updating its ref. Canonical writeback + reconcile pushes land there
 *      and cannot reach the real repo — not by git's incidental `receive.denyCurrentBranch`, but because
 *      the remote is a different repository entirely.
 */
export function setUpThrowawayRepo(sourceRepo: string): ThrowawayRepo {
  const clone = mkdtempSync(join(tmpdir(), 'wave-a-accept-repo-'));
  const mirror = mkdtempSync(join(tmpdir(), 'wave-a-accept-mirror-'));
  git(sourceRepo, ['clone', '--local', '--no-hardlinks', sourceRepo, clone]);
  git(clone, ['config', 'user.email', 'wave-a-acceptance@local']);
  git(clone, ['config', 'user.name', 'wave-a-acceptance']);
  // The coordination remote for this run is an isolated LOCAL bare mirror (a filesystem path, not
  // https/ssh), so every coordination push AND the canonical integrator's lineage publish/fetch use git's
  // `file` transport. The PRODUCTION integrator prefixes every git command with `-c protocol.allow=never`
  // (whitelisting only https/ssh) to protect real remotes — that deny-by-default ALSO blocks `file`, which
  // is correct for production (real origin is https GitHub) but fatal here ("transport 'file' not allowed").
  // Re-permit `file` ONLY inside these THROWAWAY repos via repo-local config: the protocol-specific
  // `protocol.file.allow` key wins over the general `-c protocol.allow=never` default for the file protocol
  // alone, so the isolated run publishes to its mirror WITHOUT weakening the daemon's prefix (unchanged, and
  // still denying `file` for the real https/ssh remotes). Scoped to this clone+mirror; real repo untouched.
  git(clone, ['config', 'protocol.file.allow', 'always']);
  // A local `ops` branch, from the cloned content, is REQUIRED by the coordination seam.
  git(clone, ['checkout', '-B', 'ops']);
  // Isolate the coordination remote with a bare clone that already contains the source objects. Do not
  // seed a freshly initialized bare repo by receiving the entire packed source repository: on Windows,
  // receive-pack quarantine can fail renaming an incoming pack that is byte-identical to a source pack.
  // Subsequent acceptance pushes contain only the small synthetic delta.
  git(sourceRepo, ['clone', '--local', '--bare', '--no-hardlinks', sourceRepo, mirror]);
  git(mirror, ['config', 'protocol.file.allow', 'always']);
  git(clone, ['remote', 'set-url', 'origin', mirror]);
  // Seed origin/ops without a redundant full-repository receive-pack.
  const sourceHead = git(clone, ['rev-parse', 'HEAD']).trim();
  git(mirror, ['update-ref', 'refs/heads/ops', sourceHead]);
  return { repoRoot: clone, coordinationRemote: mirror };
}

/**
 * Belt-and-braces isolation guard: refuse to run if the clone's coordination remote (`origin`) resolves
 * to the REAL repo path. Any coordination push would otherwise reach real state. Called before dispatch.
 */
export function assertCoordinationRemoteIsolated(repoRoot: string, realRepo: string): void {
  const remoteUrl = git(repoRoot, ['remote', 'get-url', 'origin']).trim();
  if (canonicalPath(remoteUrl) === canonicalPath(realRepo)) {
    throw new AcceptanceRefusal(
      `refusing to run: the coordination remote '${remoteUrl}' resolves to the REAL repo '${realRepo}'; `
        + 'isolation was not established (expected a throwaway bare mirror).',
    );
  }
}

interface Check { label: string; ok: boolean; detail: string; }

function record(checks: Check[], label: string, ok: boolean, detail = ''): void {
  checks.push({ label, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

/**
 * Poll the run until it reaches a state where OBSERVATION should stop, then return that state. The four
 * terminal run states are obvious stops; `waiting-human` is ALSO a stop FOR OBSERVATION PURPOSES — a
 * parked run will not progress without a human action, so the observer must return promptly and let the
 * check logic assess the parked state, never dead-spin the 20-min cap (the confusing hang that let a
 * park sit for ~17min). This is strictly better for the happy path: with the core.longpaths worktree fix
 * the run should reach `succeeded` and never park, but if it EVER parks at `waiting-human` that is a real
 * FAIL to surface immediately, not to wait out. Returning `waiting-human` does NOT relax the check:
 * `main()`'s terminal-state check deliberately excludes `waiting-human`, so a park still registers as a
 * FAIL of "run reached a terminal state". Exported for direct testing. Used ONLY by `main()`'s happy path
 * (single call site) — it is not shared with any fault path, so this stop condition cannot disturb the
 * runbook's fault-injection #5 human round-trip (a manual store/route-driven step, not automated here).
 */
export async function pollRunTerminal(ctx: SurfaceContext, runRef: string, maxMs = 20 * 60_000): Promise<string> {
  const deadline = Date.now() + maxMs;
  // Observation stop states: the four terminal run states PLUS `waiting-human` (parked; needs a human to
  // advance). This is NOT a pass list — the caller's terminal check excludes `waiting-human`.
  const stop = new Set(['succeeded', 'failed', 'stopped', 'interrupted', 'waiting-human']);
  for (;;) {
    const got = ctx.controlStore.getRun(DASHBOARD_EXECUTOR_SUBJECT, runRef);
    if (got.ok && stop.has(got.value.run.state)) return got.value.run.state;
    if (Date.now() > deadline) return got.ok ? got.value.run.state : 'unknown';
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

/**
 * Run the synthetic acceptance. Returns the exit code (0 = all checks passed). NEVER call at import — the
 * `import.meta.main` guard is the only entry. Leaves the throwaway dirs on failure for inspection.
 */
export async function main(): Promise<number> {
  assertAcceptanceGate();
  const sourceRepo = process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));

  const { repoRoot, coordinationRemote } = setUpThrowawayRepo(sourceRepo);
  // Belt-and-braces: prove the coordination remote is the throwaway mirror, not the real repo, BEFORE
  // any dispatch could push. A failure here aborts with no run.
  assertCoordinationRemoteIsolated(repoRoot, sourceRepo);
  const stateRoot = mkdtempSync(join(tmpdir(), 'wave-a-accept-state-'));
  // Point THIS process (never the live daemon) at the throwaway roots, gate already on.
  process.env.DASHBOARD_REPO_ROOT = repoRoot;
  process.env.KB_STATE_DIR = stateRoot;

  const checks: Check[] = [];
  let keepArtifacts = true;
  try {
    const minted = defaultPyRunner(repoRoot, WRITE_SYNTHETIC_CARD_SCRIPT, JSON.stringify({
      project: SYNTHETIC.project, action: SYNTHETIC.action, target: SYNTHETIC.target,
      riskTier: SYNTHETIC.riskTier, profile: SYNTHETIC.profile, owner: DASHBOARD_EXECUTOR_SUBJECT,
      body: SYNTHETIC.body,
    }));
    if (minted.exitCode !== 0) throw new AcceptanceRefusal(`could not mint synthetic card: ${minted.stderr || minted.stdout}`);
    const { id, path } = JSON.parse(minted.stdout.trim()) as { id: string; path: string };
    git(repoRoot, ['add', path]);
    git(repoRoot, ['commit', '-m', `test(wave-a): synthetic acceptance trigger ${id}`]);
    record(checks, 'synthetic trigger card minted + committed (throwaway repo)', true, `${id}`);

    const ctx = makeSurfaceContext();
    record(checks, 'gate ON: runAutomatic + controlBroker constructed', ctx.runAutomatic !== undefined && ctx.controlBroker !== undefined);
    const execution = ctx.executionLatch?.current();
    if (!execution) throw new AcceptanceRefusal('execution latch did not expose the armed harness window');

    const card: OwnedCard = { id, path, state: 'inbox' };
    const res = await dispatchClaimedCard(ctx, card, {
      isArmed: () => ctx.executionLatch?.current() === execution,
      internalCaller: (subject) => {
        if (ctx.executionLatch?.current() !== execution) {
          throw new AcceptanceRefusal('synthetic dispatch escaped its armed execution window');
        }
        return createInternalServiceCaller(subject);
      },
    });
    record(checks, 'dispatchClaimedCard launched the run (real claude -p spawned)', res.outcome === 'launched', `outcome=${res.outcome} status=${res.status} ${res.detail ?? ''}`);
    keepArtifacts = res.outcome !== 'launched';

    if (res.runRef) {
      const finalState = await pollRunTerminal(ctx, res.runRef);
      record(checks, 'run reached a terminal state', ['succeeded', 'failed', 'stopped', 'interrupted'].includes(finalState), `state=${finalState}`);

      // The stage output is committed on its managed integration lineage, not into the coordination
      // checkout. Verify the canonical record names exactly the approved file and that the isolated mirror
      // serves its exact content from the recorded integration branch.
      const integrationState = JSON.parse(readFileSync(
        join(stateRoot, 'control', 'canonical-integration.json'),
        'utf8',
      )) as {
        records?: Array<{
          runRef?: string;
          integrationBranch?: string;
          result?: { changed?: Array<{ path?: string }> };
        }>;
      };
      const integrationRecord = integrationState.records?.find((record) => record.runRef === res.runRef);
      const expectedOutputPath = 'orgs/kb-ops/output/synthetic-acceptance.md';
      const changed = integrationRecord?.result?.changed ?? [];
      let canonicalOutput = '';
      if (integrationRecord?.integrationBranch && changed.length === 1 && changed[0]?.path === expectedOutputPath) {
        canonicalOutput = git(coordinationRemote, ['show', `${integrationRecord.integrationBranch}:${expectedOutputPath}`]);
      }
      record(
        checks,
        'synthetic stage committed the exact approved output on canonical lineage',
        canonicalOutput === 'SYNTHETIC-ACCEPTANCE-OK'
          || canonicalOutput === 'SYNTHETIC-ACCEPTANCE-OK\n'
          || canonicalOutput === 'SYNTHETIC-ACCEPTANCE-OK\r\n',
      );

      // Canonical writeback: the minted canonical card in queue/done carries a `## Result`.
      const doneDir = join(repoRoot, 'queue', 'done');
      const doneCards = existsSync(doneDir) ? readdirSync(doneDir).filter((f) => f.endsWith('.md')) : [];
      const withResult = doneCards.filter((f) => readFileSync(join(doneDir, f), 'utf8').includes('## Result'));
      record(checks, 'canonical card written to queue/done with a ## Result', withResult.length > 0, `${withResult.length} done card(s) with ## Result`);

      // Reconcile: the trigger card left inbox/working (defaultReconcileTriggerCard git mechanics).
      const triggerGone = !existsSync(join(repoRoot, 'queue', 'inbox', `${id}.md`)) && !existsSync(join(repoRoot, 'queue', 'working', `${id}.md`));
      record(checks, 'trigger card reconciled out of inbox/working', res.reconciled && triggerGone, `reconciled=${res.reconciled}`);

      // Fleet ledger: settleFleetCostLedger emitted a subscription row into the throwaway ledgers/cost.
      const ledgerDir = join(repoRoot, 'ledgers', 'cost');
      const ledgerRows = existsSync(ledgerDir)
        ? readdirSync(ledgerDir).filter((f) => f.includes(DASHBOARD_EXECUTOR_SUBJECT)).flatMap((f) => readFileSync(join(ledgerDir, f), 'utf8').split('\n').filter((l) => l.includes('subscription')))
        : [];
      record(checks, 'fleet cost ledger row emitted (billing:subscription)', ledgerRows.length > 0, `${ledgerRows.length} row(s)`);
    }

    const passed = checks.every((c) => c.ok);
    // eslint-disable-next-line no-console
    console.log(`\n${passed ? 'ACCEPTANCE PASS' : 'ACCEPTANCE FAIL'} — ${checks.filter((c) => c.ok).length}/${checks.length} checks`);
    console.log(`Throwaway repo:   ${repoRoot}`);
    console.log(`Throwaway mirror: ${coordinationRemote}`);
    console.log(`Throwaway state:  ${stateRoot}`);
    keepArtifacts = keepArtifacts || !passed;
    return passed ? 0 : 1;
  } finally {
    if (!keepArtifacts) {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(coordinationRemote, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    } else {
      // eslint-disable-next-line no-console
      console.log(`\n(left throwaway artifacts for inspection; delete when done)\n  ${repoRoot}\n  ${coordinationRemote}\n  ${stateRoot}`);
    }
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  main().then((code) => process.exit(code)).catch((err: unknown) => {
    // eslint-disable-next-line no-console
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  });
}

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
 *     daemon / pm2 env — Daniel sets the gate in his watched session; the harness only reads it.
 *   - CANNOT MUTATE REAL PROJECT STATE. It `git clone --local`s the current repo into a throwaway temp
 *     dir and points a throwaway `DASHBOARD_STATE_ROOT` at another temp dir. Every write — the synthetic
 *     card, the canonical cards, the reconcile commit, the worktrees, the fleet ledger — lands in those
 *     throwaway roots. The real worktree and the real dashboard state root are never written.
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
import { mkdtempSync, rmSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSurfaceContext } from '../http/surface.ts';
import { isExecutionActivated, DASHBOARD_EXECUTOR_SUBJECT } from './activation.ts';
import { dispatchClaimedCard, type OwnedCard } from './queueBridge.ts';
import { defaultPyRunner } from '../write/launch.ts';
import type { SurfaceContext } from '../http/context.ts';

export class AcceptanceRefusal extends Error {}

/** The synthetic run is low-risk and no-op: a single-file write, no web, no spend, no publish. */
const SYNTHETIC = {
  project: 'kb-ops',
  action: 'research:web-brief',
  target: 'orgs/kb-ops/output',
  profile: 'research',
  riskTier: 'T2',
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

/** Clone the current repo locally into a throwaway dir so every write is isolated from real project state. */
function setUpThrowawayRepo(sourceRepo: string): string {
  const clone = mkdtempSync(join(tmpdir(), 'wave-a-accept-repo-'));
  git(sourceRepo, ['clone', '--local', '--no-hardlinks', sourceRepo, clone]);
  // The reconcile/canonical writers commit on the coordination branch in-place; ensure identity + a clean
  // working tree exist in the clone (never touching the source repo's config).
  git(clone, ['config', 'user.email', 'wave-a-acceptance@local']);
  git(clone, ['config', 'user.name', 'wave-a-acceptance']);
  return clone;
}

interface Check { label: string; ok: boolean; detail: string; }

function record(checks: Check[], label: string, ok: boolean, detail = ''): void {
  checks.push({ label, ok, detail });
  // eslint-disable-next-line no-console
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
}

async function pollRunTerminal(ctx: SurfaceContext, runRef: string, maxMs = 20 * 60_000): Promise<string> {
  const deadline = Date.now() + maxMs;
  const terminal = new Set(['succeeded', 'failed', 'stopped', 'interrupted']);
  for (;;) {
    const got = ctx.controlStore.getRun(DASHBOARD_EXECUTOR_SUBJECT, runRef);
    if (got.ok && terminal.has(got.value.run.state)) return got.value.run.state;
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

  const repoRoot = setUpThrowawayRepo(sourceRepo);
  const stateRoot = mkdtempSync(join(tmpdir(), 'wave-a-accept-state-'));
  // Point THIS process (never the live daemon) at the throwaway roots, gate already on.
  process.env.DASHBOARD_REPO_ROOT = repoRoot;
  process.env.DASHBOARD_STATE_ROOT = stateRoot;

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

    const card: OwnedCard = { id, path, state: 'inbox' };
    const res = await dispatchClaimedCard(ctx, card);
    record(checks, 'dispatchClaimedCard launched the run (real claude -p spawned)', res.outcome === 'launched', `outcome=${res.outcome} status=${res.status} ${res.detail ?? ''}`);
    keepArtifacts = res.outcome !== 'launched';

    if (res.runRef) {
      const finalState = await pollRunTerminal(ctx, res.runRef);
      record(checks, 'run reached a terminal state', ['succeeded', 'failed', 'stopped', 'interrupted'].includes(finalState), `state=${finalState}`);

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
    console.log(`Throwaway repo:  ${repoRoot}`);
    console.log(`Throwaway state: ${stateRoot}`);
    keepArtifacts = keepArtifacts || !passed;
    return passed ? 0 : 1;
  } finally {
    if (!keepArtifacts) {
      rmSync(repoRoot, { recursive: true, force: true });
      rmSync(stateRoot, { recursive: true, force: true });
    } else {
      // eslint-disable-next-line no-console
      console.log(`\n(left throwaway artifacts for inspection; delete when done)\n  ${repoRoot}\n  ${stateRoot}`);
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

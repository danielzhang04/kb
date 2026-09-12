// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { resolvePython } from '../runtime/python.ts';
import { registerFigmentStudioGenPlan, type RunStudioGenPlan } from './studioGenPlan.ts';
import { StudioGenPlans } from '../../src/figment/StudioGenPlans.tsx';

/**
 * Real join of the actual planner (via `studio_gen_plan_fixture.py`, forwarded
 * the exact production argv) and the actual HTTP control route
 * (`registerFigmentStudioGenPlan`) with the actual browser component
 * (`StudioGenPlans`), rendered in jsdom. This is a jsdom join, NOT a deployed
 * browser test: no real network stack, no real fetch -- an adapter forwards
 * only method/url/headers/body from the component into `app.inject` and
 * returns a standard `Response`. No plan DTO is fabricated; every DTO
 * asserted on is the exact bytes the real producer returned.
 */

const execFileP = promisify(execFile);
const FIXTURE_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), 'studio_gen_plan_fixture.py');
const python = resolvePython(process.platform);
const REVALIDATE_TIMEOUT_MS = 120_000;
const TEST_TIMEOUT_MS = REVALIDATE_TIMEOUT_MS * 3;
const TMP_PREFIX = 'figment-studio-plan-ui-integration-';
const PLAN_URL = '/api/figment/studio/gen-plan';
const PENDING_STORAGE_KEY = 'figment.studio.genPlan.pending.v1';

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

function buildRunner(capturedArgv: string[][]): RunStudioGenPlan {
  return (async (command, args) => {
    expect(command).toBe(python.command);
    capturedArgv.push([...args]);
    const at = (flag: string) => args[args.indexOf(flag) + 1];
    await execFileP(python.command, [
      ...python.prefixArgs, FIXTURE_SCRIPT, 'plan',
      '--creator', at('--creator'), '--stage', at('--stage'),
      '--out', at('--out'), '--ledger-dir', at('--ledger-dir'),
    ], { timeout: REVALIDATE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
  }) as RunStudioGenPlan;
}

async function startApp(repo: string, sessionConfig: SessionConfig, capturedArgv: string[][], apps: FastifyInstance[]): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  apps.push(app);
  registerFigmentStudioGenPlan(app, {
    repoRoot: repo, ledgerDir: join(repo, 'ledgers', 'cost'), sessionConfig,
    runStudioGenPlan: buildRunner(capturedArgv), platform: process.platform,
  });
  await app.ready();
  return app;
}

// One actual call the component made: what it sent (headers exactly as the
// component set them; `pendingRaw` is the sessionStorage record at dispatch
// time, captured before the request reaches the route) and the route's raw
// response bytes once it has answered.
interface Call { method: string; url: string; headers: Record<string, string>; pendingRaw: string | null; status?: number; body?: string }

// Transport-only bridge: forwards exactly what the component sent into
// `app.inject`, and returns exactly the status/body the real route produced
// as a standard `Response`. With `dropFirstCommittedPost`, the first 2xx
// response to POST `PLAN_URL` is discarded after the server committed it, to
// exercise the component's durable pending-key retry against a real
// lost-response. GETs always pass through.
function bridgeFetch(app: FastifyInstance, calls: Call[], dropFirstCommittedPost = false): typeof fetch {
  let dropped = !dropFirstCommittedPost;
  return (async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((value, key) => { headers[key] = value; });
    const method = init?.method ?? 'GET';
    const call: Call = { method, url: String(url), headers, pendingRaw: method === 'POST' ? sessionStorage.getItem(PENDING_STORAGE_KEY) : null };
    calls.push(call);
    const injected = await app.inject({
      method: method as 'GET' | 'POST',
      url: call.url,
      headers,
      payload: init?.body as string | undefined,
    });
    call.body = injected.body;
    call.status = injected.statusCode;
    if (!dropped && method === 'POST' && call.url === PLAN_URL && injected.statusCode >= 200 && injected.statusCode < 300) {
      dropped = true;
      throw new Error('simulated transport loss after server commit');
    }
    return new Response(injected.body, { status: injected.statusCode, headers: injected.headers as Record<string, string> });
  }) as typeof fetch;
}

describe('Studio generation-plan: real planner + real HTTP control + real StudioGenPlans component (jsdom join)', () => {
  it('prepares one real plan through a lost first response, resumes it across remount, then blocks on refresh after the published bytes are altered', async () => {
    const apps: FastifyInstance[] = [];
    const owned: string[] = [];
    const closeApp = async (app: FastifyInstance) => { apps.splice(apps.indexOf(app), 1); await app.close(); };
    try {
      // Minted per run; the TTL outlives the whole bounded test so machine
      // contention cannot expire the session mid-journey.
      const sessionConfig: SessionConfig = { secret: Buffer.from('figment-studio-gen-plan-ui-integration-secret'), ttlMs: TEST_TIMEOUT_MS + 60_000 };
      const token = mintSession('operator', sessionConfig).token;

      const repo = await realpath(await mkdtemp(join(tmpdir(), TMP_PREFIX)));
      owned.push(repo);
      const script = join(repo, 'orgs', 'figment', 'pipeline', 'figment_train.py');
      await mkdir(dirname(script), { recursive: true });
      await writeFile(script, '# route-existence placeholder, never executed', 'utf8');
      await mkdir(join(repo, 'ledgers', 'cost'), { recursive: true });

      const capturedArgv: string[][] = [];
      const calls: Call[] = [];
      const posts = () => calls.filter((call) => call.method === 'POST');
      const gets = () => calls.filter((call) => call.method === 'GET');
      const committed = (call: Call) => call.status !== undefined && call.status >= 200 && call.status < 300;

      const firstApp = await startApp(repo, sessionConfig, capturedArgv, apps);
      const first = render(<StudioGenPlans token={token} fetchImpl={bridgeFetch(firstApp, calls, true)} />);
      await waitFor(() => expect(screen.getByText('Preparation status: Local preparation checks passed. Checkpoint and source authority are checked when preparation runs.')).toBeTruthy());
      const prepareButton = await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Prepare generation plan' }) as HTMLButtonElement;
        expect(button.disabled).toBe(false);
        return button;
      });
      fireEvent.click(prepareButton);

      // Wait on the route's committed response, not the runner's argv (which
      // is pushed before the planner finishes).
      await waitFor(() => expect(posts().filter(committed)).toHaveLength(1), { timeout: REVALIDATE_TIMEOUT_MS });
      const [post1] = posts();
      expect(post1.url).toBe(PLAN_URL);
      expect(Object.keys(post1.headers).sort()).toEqual(['authorization', 'idempotency-key', 'x-figment-intent-scope']);
      expect(post1.headers.authorization).toBe(`Bearer ${token}`);
      expect(post1.headers['idempotency-key']).toMatch(/^[0-9a-f]{48}$/);
      const scopeGet = gets().filter((call) => calls.indexOf(call) < calls.indexOf(post1)).at(-1)!;
      expect(post1.headers['x-figment-intent-scope']).toBe(JSON.parse(scopeGet.body!).requestScope);
      // The durable pending record existed before the POST was dispatched and
      // names exactly the key/scope the POST carried.
      expect(post1.pendingRaw).not.toBeNull();
      expect(JSON.parse(post1.pendingRaw!)).toEqual({
        schema: 'figment/studio-gen-plan-pending@1',
        requestScope: post1.headers['x-figment-intent-scope'],
        key: post1.headers['idempotency-key'],
      });
      const prepared = JSON.parse(post1.body!) as { id: string; planSha256: string; declaredCeilingUsd: number };
      expect(capturedArgv).toHaveLength(1);

      // The transport lost that committed response; the component keeps the
      // same durable pending record and offers an explicit resume. Let every
      // in-flight call (the post-failure GET) settle before closing the app.
      await waitFor(() => {
        const resumeButton = screen.getByRole('button', { name: 'Resume preparation request' }) as HTMLButtonElement;
        expect(resumeButton.disabled).toBe(false);
        expect(calls.every((call) => call.status !== undefined)).toBe(true);
      });
      await flush();
      expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBe(post1.pendingRaw);

      first.unmount();
      await closeApp(firstApp);

      const reopenedApp = await startApp(repo, sessionConfig, capturedArgv, apps);
      render(<StudioGenPlans token={token} fetchImpl={bridgeFetch(reopenedApp, calls)} />);
      // Stored-plan-list markup splits the summary across an <h2> heading and
      // a sibling <p>; this is the persisted-inventory format, distinct from
      // the transient "just prepared" status line.
      const ceiling = prepared.declaredCeilingUsd.toFixed(2).replace('.', '\\.');
      const hash = prepared.planSha256.slice(0, 12);
      await waitFor(() => expect(screen.getByText('creator-001 · gen')).toBeTruthy());
      await screen.findByText('No stage record; attempt history is unknown.');
      await waitFor(() => expect(screen.getByText(new RegExp(
        `^prepared · one prepared run · declared \\$${ceiling} · plan ${hash}$`,
      ))).toBeTruthy());
      const resumeButton = await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Resume preparation request' }) as HTMLButtonElement;
        expect(button.disabled).toBe(false);
        return button;
      });
      await flush();
      // Explicit resume only: the remount fired no POST (an automatic
      // idempotent replay would not reach the runner, so count actual POSTs).
      expect(posts()).toHaveLength(1);

      fireEvent.click(resumeButton);
      await waitFor(() => expect(posts().filter(committed)).toHaveLength(2), { timeout: REVALIDATE_TIMEOUT_MS });
      const post2 = posts()[1];
      expect(post2.url).toBe(PLAN_URL);
      expect(post2.headers).toEqual(post1.headers);
      expect(post2.pendingRaw).toBe(post1.pendingRaw);
      // Same key/scope replays the exact committed DTO; the real planner ran
      // only on the original request.
      expect(JSON.parse(post2.body!)).toEqual(prepared);
      expect(capturedArgv).toHaveLength(1);
      await waitFor(() => expect(screen.queryByText('Resume preparation request')).toBeNull());
      await waitFor(() => expect(sessionStorage.getItem(PENDING_STORAGE_KEY)).toBeNull());

      // Sanity: the published bytes on disk are the exact real producer's plan.
      const planPath = join(repo, 'orgs', 'figment', '_private', 'figment-studio', 'gen-plans', prepared.id, 'plan.json');
      const approvalRaw = JSON.parse(await readFile(planPath, 'utf8')).training.chosen_checkpoint_approval;
      expect(isAbsolute(String(approvalRaw))).toBe(true);
      const approvalRelative = relative(repo, await realpath(resolve(String(approvalRaw))));
      expect(approvalRelative === '' || approvalRelative === '..' || approvalRelative.startsWith(`..${sep}`) || isAbsolute(approvalRelative)).toBe(false);

      // Alter only the owned published plan bytes this test produced, then
      // click Refresh status in the live panel: the real GET must report
      // preparation unavailable and no further POST/planner run may occur.
      await writeFile(planPath, ' ', { flag: 'a' });
      const getsBeforeRefresh = gets().length;
      const refreshButton = await waitFor(() => {
        const button = screen.getByRole('button', { name: 'Refresh status' }) as HTMLButtonElement;
        expect(button.disabled).toBe(false);
        return button;
      });
      fireEvent.click(refreshButton);
      await waitFor(() => expect(screen.getByText(
        'Preparation status: Local preparation is unavailable.',
      )).toBeTruthy());
      expect(gets().length).toBeGreaterThan(getsBeforeRefresh);
      const blockedPrepare = screen.getByRole('button', { name: 'Prepare generation plan' }) as HTMLButtonElement;
      expect(blockedPrepare.disabled).toBe(true);
      fireEvent.click(blockedPrepare);
      await flush();
      expect(posts()).toHaveLength(2);
      expect(capturedArgv).toHaveLength(1);
    } finally {
      // Unmount, then close every app still open, then remove only verified
      // owned fixture dirs -- in that order, even after a mid-journey failure.
      cleanup();
      try { sessionStorage.clear(); } catch { /* ignore */ }
      await Promise.allSettled(apps.map((app) => app.close()));
      const base = await realpath(tmpdir());
      for (const dir of owned) {
        const real = await realpath(dir).catch(() => null);
        if (real === null) continue;
        if (!isAbsolute(real) || real !== dir || dirname(real) !== base || !basename(real).startsWith(TMP_PREFIX)) {
          throw new Error(`refusing to remove unverified fixture path: ${dir}`);
        }
        await rm(real, { recursive: true, force: true });
      }
    }
  }, TEST_TIMEOUT_MS);
});

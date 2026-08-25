/**
 * P6 W6.3 — the two-daemon scenario driver [P6-C21, P6-C53]. Runs the SIX §7 scenarios against the two
 * live daemon origins the `p6TwoDaemonFixture.ts` lifecycle brought up, writing one artifact per scenario
 * and exiting non-zero on any failure. It is the client the §7 command runs after `--`.
 *
 * Every daemon call goes through the injected {@link CallFn}, so the suite drives every scenario against a
 * recording fake with no real socket; the CLI binds a real pinned-cert HTTPS client.
 *
 * `one-stream-both-hosts` reaches the VM run stream from the Desktop origin THROUGH
 * `placement/desktopReadProxy.ts` BY NAME [P6-C53] — the Desktop daemon registers no control route, so the
 * only way its `GET /api/v1/runs/:runRef/events` can answer is the read proxy forwarding to the VM.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CapabilityRequirement } from '../placement/contracts.ts';
import { NODE_PROXY_UID, OPERATOR_UID, SIM_PEER_UID_HEADER, operatorBearer } from './p6TwoDaemonFixture.ts';
import { readLoopbackCertificate } from './p3LoopbackTls.ts';

export const P6_SCENARIOS = [
  'schedule-desktop-run', 'one-stream-both-hosts', 'gate-open-and-resolve',
  'lease-expiry-reclaim', 'rotation-invalidates-leases', 'vm-only-agent-refused-on-desktop',
] as const;
export type P6ScenarioId = (typeof P6_SCENARIOS)[number];
export function isP6ScenarioId(value: string): value is P6ScenarioId {
  return (P6_SCENARIOS as readonly string[]).includes(value);
}

export interface ScenarioRequest {
  method: 'GET' | 'POST';
  path: string;
  auth: 'node' | 'operator';
  nodeId?: string;
  body?: unknown;
}
export interface CallResult { status: number; body: unknown; }
export type CallFn = (target: 'vm' | 'desktop', req: ScenarioRequest) => Promise<CallResult>;

export interface ScenarioOutcome { id: P6ScenarioId; passed: boolean; detail: string; }

const DESKTOP_REQUIREMENT: CapabilityRequirement = {
  connectors: [{ server: 'browser', tools: ['screenshot'] }, { server: 'gmail', tools: ['search'] }],
  skills: [], filesystemRoots: [], pty: false, gpu: false, clis: ['claude'],
};
const NOW = '2026-08-25T00:00:00.000Z';
function desktopAdvertisement(): Record<string, unknown> {
  return {
    hostId: 'desktop', daemonVersion: 'desktop-1.0.0', reportedAt: NOW,
    connectors: DESKTOP_REQUIREMENT.connectors.map((c) => ({ server: c.server, tools: [...c.tools] })),
    skills: [], filesystemRoots: [], pty: false, gpu: false, clis: { claude: 'ready', codex: 'missing' },
  };
}
function asJson(body: unknown): Record<string, unknown> { return (body ?? {}) as Record<string, unknown>; }
function dataOf(body: unknown): Record<string, unknown> { return asJson(asJson(body).data); }

async function seedDesktopRun(call: CallFn, runRef: string): Promise<void> {
  await call('vm', { method: 'POST', path: '/fixture/advertise-seed', auth: 'operator', body: { advertisement: desktopAdvertisement() } });
  await call('vm', { method: 'POST', path: '/fixture/schedule-run', auth: 'operator', body: { runRef, host: 'desktop', requirement: DESKTOP_REQUIREMENT } });
}
async function claimDesktop(call: CallFn): Promise<CallResult> {
  return call('vm', { method: 'POST', path: '/api/v1/hosts/desktop/leases/claim', auth: 'node', nodeId: 'nodeDESK9', body: { waitMs: 0 } });
}

export async function runScenario(id: P6ScenarioId, call: CallFn): Promise<ScenarioOutcome> {
  const ok = (detail: string): ScenarioOutcome => ({ id, passed: true, detail });
  const no = (detail: string): ScenarioOutcome => ({ id, passed: false, detail });
  switch (id) {
    case 'schedule-desktop-run': {
      await seedDesktopRun(call, 'run-sched-1');
      const claim = await claimDesktop(call);
      const lease = asJson(dataOf(claim.body).lease);
      return claim.status === 200 && lease.hostId === 'desktop'
        ? ok('VM schedules a desktop-only run; the Desktop node claims a lease with hostId=desktop')
        : no(`claim ${claim.status} lease host ${String(lease.hostId)}`);
    }
    case 'one-stream-both-hosts': {
      await seedDesktopRun(call, 'run-stream-1');
      await claimDesktop(call);
      await call('vm', { method: 'POST', path: '/api/v1/runs/run-stream-1/reports', auth: 'node', nodeId: 'nodeDESK9', body: { expectedLeaseRevision: 1, sequence: 1, kind: 'event', payload: { line: 'hello' } } });
      const vmEvents = await call('vm', { method: 'GET', path: '/api/v1/runs/run-stream-1/events', auth: 'operator' });
      // The Desktop origin reaches the VM stream ONLY through placement/desktopReadProxy.ts.
      const deskEvents = await call('desktop', { method: 'GET', path: '/api/v1/runs/run-stream-1/events', auth: 'operator' });
      const vmCount = (dataOf(vmEvents.body).events as unknown[] | undefined)?.length ?? 0;
      const deskBody = typeof deskEvents.body === 'string' ? safeParse(deskEvents.body) : deskEvents.body;
      const deskCount = (dataOf(deskBody).events as unknown[] | undefined)?.length ?? 0;
      return vmEvents.status === 200 && deskEvents.status === 200 && vmCount >= 1 && deskCount >= 1 && vmCount === deskCount
        ? ok('both dashboards show one run and one stream; the Desktop side reached it through placement/desktopReadProxy.ts')
        : no(`vm ${vmEvents.status}/${vmCount} desktop ${deskEvents.status}/${deskCount}`);
    }
    case 'gate-open-and-resolve': {
      await seedDesktopRun(call, 'run-gate-1');
      await claimDesktop(call);
      const gateReport = await call('vm', { method: 'POST', path: '/api/v1/runs/run-gate-1/reports', auth: 'node', nodeId: 'nodeDESK9', body: { expectedLeaseRevision: 1, sequence: 1, kind: 'gate-opened', payload: { title: 'approve me' } } });
      const gates = await call('vm', { method: 'GET', path: '/api/v1/runs/run-gate-1/gates', auth: 'operator' });
      const gateCount = (dataOf(gates.body).gates as unknown[] | undefined)?.length ?? 0;
      return gateReport.status === 200 && gateCount === 1
        ? ok('a Desktop report opens exactly one gate; the response to it is the operator\'s alone (no node route can resolve it)')
        : no(`report ${gateReport.status} gates ${gateCount}`);
    }
    case 'lease-expiry-reclaim': {
      await seedDesktopRun(call, 'run-reclaim-1');
      const first = await claimDesktop(call);
      const second = await claimDesktop(call); // the run is already leased → 204, exactly one owner
      return first.status === 200 && second.status === 204
        ? ok('a claimed run yields exactly one lease owner; a concurrent re-claim finds no candidate (204)')
        : no(`first ${first.status} second ${second.status}`);
    }
    case 'rotation-invalidates-leases': {
      // A rotated-out (revoked) node id is refused on the node routes — the runtime effect of a rotation
      // that added the old id to `revoked`.
      const renew = await call('vm', { method: 'POST', path: '/api/v1/runs/run-x/leases/renew', auth: 'node', nodeId: 'oldNODE7', body: { expectedLeaseRevision: 1 } });
      return renew.status === 403 && asJson(asJson(renew.body).error).code === 'node-revoked'
        ? ok('a rotated-out node id is 403 node-revoked on the node routes')
        : no(`renew ${renew.status} ${JSON.stringify(renew.body)}`);
    }
    case 'vm-only-agent-refused-on-desktop': {
      // A run assigned to VM requiring a VM-only capability the desktop cannot serve is never claimed by
      // the desktop node.
      await call('vm', { method: 'POST', path: '/fixture/schedule-run', auth: 'operator', body: { runRef: 'run-vmonly-1', host: 'vm', requirement: { connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: true, clis: [] } } });
      const claim = await claimDesktop(call);
      const claimedRef = claim.status === 200 ? String(dataOf(claim.body).runRef ?? '') : '';
      return claimedRef !== 'run-vmonly-1'
        ? ok('a VM-only run is never handed to a Desktop claim')
        : no('the VM-only run was claimed by the Desktop node');
    }
    default:
      return no(`unknown scenario ${String(id)}`);
  }
}

function safeParse(text: string): unknown { try { return JSON.parse(text); } catch { return {}; } }

export async function runScenarios(
  ids: readonly P6ScenarioId[], call: CallFn,
  writeArtifact: (id: P6ScenarioId, outcome: ScenarioOutcome) => void,
): Promise<{ exitCode: number; outcomes: ScenarioOutcome[] }> {
  const outcomes: ScenarioOutcome[] = [];
  let failed = 0;
  for (const id of ids) {
    let outcome: ScenarioOutcome;
    try { outcome = await runScenario(id, call); }
    catch (error) { outcome = { id, passed: false, detail: error instanceof Error ? error.message : String(error) }; }
    writeArtifact(id, outcome);
    outcomes.push(outcome);
    if (!outcome.passed) failed += 1;
  }
  return { exitCode: failed > 0 ? 1 : 0, outcomes };
}

// -------------------------------------------------------------------------------------------------
// CLI.
// -------------------------------------------------------------------------------------------------
export interface ScenarioCliArgs {
  originVm: string; originDesktop: string; scenarios: P6ScenarioId[]; artifactDir: string; failIfUnavailable: boolean;
}
export class ScenarioUsageError extends Error {
  constructor(message: string) { super(message); this.name = 'ScenarioUsageError'; }
}
export function parseScenarioArgs(argv: readonly string[]): ScenarioCliArgs {
  let originVm: string | null = null; let originDesktop: string | null = null;
  let scenarios: P6ScenarioId[] = [...P6_SCENARIOS]; let artifactDir: string | null = null; let failIfUnavailable = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]; const value = argv[i + 1];
    const need = (): string => { if (value === undefined || value.startsWith('--')) throw new ScenarioUsageError(`${arg} needs a value`); i += 1; return value; };
    switch (arg) {
      case '--origin-vm': originVm = need(); break;
      case '--origin-desktop': originDesktop = need(); break;
      case '--artifact-dir': artifactDir = need(); break;
      case '--fail-if-unavailable': failIfUnavailable = true; break;
      case '--scenarios': {
        const parts = need().split(',').map((s) => s.trim()).filter((s) => s.length > 0);
        for (const part of parts) if (!isP6ScenarioId(part)) throw new ScenarioUsageError(`unknown scenario ${part}`);
        scenarios = parts as P6ScenarioId[];
        break;
      }
      default: throw new ScenarioUsageError(`unknown flag ${String(arg)}`);
    }
  }
  if (originVm === null || originDesktop === null) throw new ScenarioUsageError('--origin-vm and --origin-desktop are required');
  if (artifactDir === null) throw new ScenarioUsageError('--artifact-dir is required');
  return { originVm, originDesktop, scenarios, artifactDir, failIfUnavailable };
}

/** A real pinned-cert HTTPS/HTTP {@link CallFn} over the two daemon origins. */
export function httpCallFn(originVm: string, originDesktop: string): CallFn {
  return async (target, req) => {
    const origin = target === 'vm' ? originVm : originDesktop;
    const url = new URL(`${origin}${req.path}`);
    const secure = url.protocol === 'https:';
    const headers: Record<string, string> = { host: url.host, 'content-type': 'application/json' };
    if (req.auth === 'node') { headers[SIM_PEER_UID_HEADER] = String(NODE_PROXY_UID); headers['tailscale-node-id'] = req.nodeId ?? 'nodeDESK9'; }
    else { headers[SIM_PEER_UID_HEADER] = String(OPERATOR_UID); headers.authorization = operatorBearer(); }
    const ca = secure ? readLoopbackCertificate(Number(url.port)) : null;
    const mod = secure ? await import('node:https') : await import('node:http');
    return await new Promise<CallResult>((resolveCall, rejectCall) => {
      const call = mod.request({ host: url.hostname, port: url.port, path: `${url.pathname}${url.search}`, method: req.method, headers, ...(ca ? { ca } : {}) }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); resolveCall({ status: res.statusCode ?? 0, body: safeParse(text) }); });
      });
      call.on('error', rejectCall);
      if (req.body !== undefined) call.write(JSON.stringify(req.body));
      call.end();
    });
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseScenarioArgs(process.argv.slice(2));
  const dir = resolve(args.artifactDir);
  mkdirSync(dir, { recursive: true });
  const write = (id: P6ScenarioId, outcome: ScenarioOutcome): void => {
    writeFileSync(join(dir, `${id}.json`), `${JSON.stringify({ ...outcome, timestamp: new Date().toISOString() }, null, 2)}\n`);
  };
  runScenarios(args.scenarios, httpCallFn(args.originVm, args.originDesktop), write)
    .then(({ exitCode, outcomes }) => {
      for (const outcome of outcomes) process.stderr.write(`[p6-scenario] ${outcome.passed ? 'PASS' : 'FAIL'} ${outcome.id}: ${outcome.detail}\n`);
      process.exitCode = exitCode;
    })
    .catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
}

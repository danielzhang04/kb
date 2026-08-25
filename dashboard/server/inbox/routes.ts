// P4 W6.1: the `/api/inbox` route cut over ATOMICALLY to the closed PR + escalation + source-health
// contract of section 3.3. No compatibility union or adapter remains — the older `{items}` escalation
// shape is gone. The route:
//   - reads open PRs through the PINNED literal `gh pr list` (`resolvers.ts#readOpenPullRequests`),
//     behind the GLOBAL one-subprocess-per-30s budget of `sourceCache.ts` [P4-C34];
//   - reads escalation subjects from the Plane-A card snapshot (`project.ts#projectEscalationSubjects`);
//   - composes the two INDEPENDENTLY (`project.ts#projectP4Inbox`), so a failed source keeps its own
//     last-good items and its own source state and never empties the other half;
//   - honours `?refresh=pr|escalation` (any other value 400) by invalidating only the named source.
// It has NO next-fire, run-gate, read, snooze, resolve, archive, retention, deployment, or asset control.
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireSession } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import {
  assertCoordinationRoot, resolveRepositoryPin, RepositoryPinError,
  type GitRemoteReader, type RepositoryPin,
} from '../runtime/repoPin.ts';
import { runTrackedProcess } from '../write/asyncGit.ts';
import { indexRepo, type PlaneAIndex } from '../planeA/indexer.ts';
import { ContractDecodeError } from '../write/durableManifest.ts';
import { decodeInboxRefreshParam, type InboxResponse } from './contracts.ts';
import { projectEscalationSubjects, projectP4Inbox } from './project.ts';
import { readOpenPullRequests, type SubprocessPort } from './resolvers.ts';
import {
  getInboxSourceCache, type EscalationRead, type InboxSourceCache, type PrReader,
} from './sourceCache.ts';
import { createHash } from 'node:crypto';

/** The ports the route reads through; every side effect is injectable so tests reach no real `gh`/tree. */
export interface InboxRoutePorts {
  /** The composition-time repository pin, or `null` when the coordination remote cannot be pinned — in
   *  which case the PR source degrades to a `failed` row and the escalation half is unaffected. */
  readonly pin: () => RepositoryPin | null;
  readonly runGh: SubprocessPort;
  readonly cache: InboxSourceCache;
  /** ISO clock stamped onto verified reads. */
  readonly now: () => string;
  /** Plane-A snapshot reader; defaults to the real `indexRepo`. */
  readonly indexRepo?: (repoRoot: string) => PlaneAIndex;
}

/** One stable clock reference so repeated `createInboxRoutePorts` calls share the ONE process cache
 *  singleton (`getInboxSourceCache` compares its `now` option by reference). */
const wallClockNow = (): number => Date.now();

/** The production `gh` subprocess port: a 15-second READ (`gh pr list`), never a write. A non-zero exit
 *  or a rejection is a source failure the resolver turns into a closed error code — never raw stderr. */
export function createGhSubprocessPort(repoRoot: string): SubprocessPort {
  return async (request) => {
    try {
      const stdout = await runTrackedProcess(request.command, request.argv, repoRoot, 'pr list', {
        timeoutMs: request.timeoutMs,
      });
      return { ok: true, stdout };
    } catch (error: unknown) {
      const timedOut = error instanceof Error && / timed out /.test(error.message);
      return { ok: false, stdout: '', ...(timedOut ? { timedOut: true } : {}) };
    }
  };
}

/** The escalation source is store-driven; its revision is the hash of its item id/revision pairs. */
function escalationRead(ports: InboxRoutePorts, repoRoot: string): EscalationRead {
  const index = (ports.indexRepo ?? indexRepo)(repoRoot);
  const items = projectEscalationSubjects(index);
  const revision = createHash('sha256')
    .update(items.map((item) => `${item.id}\u0000${item.revision}`).join(''), 'utf8')
    .digest('hex');
  return { items, state: { status: 'verified', revision, verifiedAt: ports.now() } };
}

/** Compose one Inbox response from the two independently-read sources. Shared by the route and the
 *  Home inbox count so both observe the same last-good projection and the same source budget. */
export async function readInbox(ports: InboxRoutePorts, repoRoot: string): Promise<InboxResponse> {
  const prReader: PrReader = async () => {
    const pin = ports.pin();
    // No pinnable coordination remote: the PR source is unavailable, but the escalation half still reads
    // (`sourceCache` keeps any last-good PR items and marks the state stale). Never a false empty Inbox.
    if (pin === null) return { items: [], state: { status: 'failed', errorCode: 'unavailable', stale: false } };
    return readOpenPullRequests(pin, ports.runGh, ports.now);
  };
  const pr = await ports.cache.readPr(prReader);
  ports.cache.putEscalation(escalationRead(ports, repoRoot));
  const escalation = ports.cache.peekEscalation();
  return projectP4Inbox({
    pr: { items: pr.items, state: pr.state },
    escalation: { items: escalation.items, state: escalation.state },
  });
}

/**
 * Build the production route ports. The two composition-time checks the older M1 code coupled are now
 * SPLIT (boss ruling refining M1), because they guard different things:
 *   - `assertCoordinationRoot(ctx.repoRoot)` STAYS eager fail-closed [P4-C39]: it is a real filesystem
 *     invariant (absolute path, `queue/` present); a wrong `DASHBOARD_REPO_ROOT` must surface at boot.
 *   - `resolveRepositoryPin(...)` DEGRADES: a legitimate kb deployment (the WSL oracle, local dev, an
 *     air-gapped VM) has a non-GitHub `origin`, and the whole dashboard must still BOOT. So a
 *     missing/ambiguous/non-GitHub/unparseable remote is caught here and the PR source resolves to
 *     `unavailable` at runtime (`pin()` returns `null` → the `readInbox` PR arm reports it) instead of
 *     throwing out of `buildApp`. The GitHub pin is a prerequisite for the Inbox PR SOURCE only, not for
 *     the dashboard. The safety property of P4-C35 is preserved a different way: `prHref` still THROWS if
 *     ever asked to build a URL without a valid pin, so no bad PR URL is ever produced — there is simply
 *     no PR source. Only a non-`RepositoryPinError` (unexpected) still propagates.
 * `readRemote` is injectable only so the suite can drive the parser without a real checkout.
 */
export function createInboxRoutePorts(
  ctx: SurfaceContext,
  opts: { readRemote?: GitRemoteReader; runGh?: SubprocessPort } = {},
): InboxRoutePorts {
  assertCoordinationRoot(ctx.repoRoot);
  let resolved: RepositoryPin | null;
  try {
    resolved = resolveRepositoryPin(ctx.repoRoot, opts.readRemote);
  } catch (error: unknown) {
    if (!(error instanceof RepositoryPinError)) throw error;
    // The coordination remote cannot be pinned to a GitHub repo: degrade the PR source to `unavailable`
    // and let the dashboard boot. `prHref` guards the URL side, so no bad PR URL can be produced.
    resolved = null;
  }
  return {
    pin: () => resolved,
    runGh: opts.runGh ?? createGhSubprocessPort(ctx.repoRoot),
    cache: getInboxSourceCache({ now: wallClockNow }),
    now: () => (ctx.now?.() ?? new Date()).toISOString(),
  };
}

export function registerInboxRoutes(scope: FastifyInstance, ctx: SurfaceContext, ports: InboxRoutePorts): void {
  scope.get('/api/inbox', { preHandler: requireSession(ctx.sessionConfig) }, async (request: FastifyRequest, reply: FastifyReply) => {
    const query = request.query as Record<string, unknown> | undefined;
    let refresh: ReturnType<typeof decodeInboxRefreshParam>;
    try {
      refresh = decodeInboxRefreshParam(query?.['refresh']);
    } catch (error: unknown) {
      const reason = error instanceof ContractDecodeError ? error.message : 'refresh must be pr | escalation';
      return reply.code(400).send({ error: 'bad-refresh', reason });
    }
    // `?refresh=pr` invalidates only the PR snapshot; the budget still gates any actual subprocess, so
    // Retry needs no mutation endpoint. `refresh=escalation` re-reads the store, which is always fresh.
    if (refresh === 'pr') ports.cache.invalidatePr();
    return reply.code(200).send(await readInbox(ports, ctx.repoRoot));
  });
}

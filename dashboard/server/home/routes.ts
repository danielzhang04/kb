import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { SessionConfig } from '../auth/session.ts';
import { projectGateCounts, projectRunActivity, type ProjectableRun } from '../control/runProjection.ts';
import { runLifecycleKind } from '../control/runLifecycle.ts';
import type { RunMetadata } from '../control/types.ts';
import type { SurfaceContext } from '../http/context.ts';
import { requireSession } from '../http/middleware.ts';
import { createInboxRoutePorts, readInbox } from '../inbox/routes.ts';
import type { GitRemoteReader } from '../runtime/repoPin.ts';
import type { SubprocessPort } from '../inbox/resolvers.ts';
import { openAttestedScheduleSource } from '../schedules/attestedSource.ts';
import type { ScheduleService } from '../schedules/service.ts';
import { projectHome, type ActivationReaderPort, type HomeProjectionPorts } from './project.ts';

export type HomeRoutePorts = HomeProjectionPorts & { sessionConfig: SessionConfig; now?: () => Date };

export interface ActivationReaderOptions {
  openSource?: typeof openAttestedScheduleSource;
  activatedAt?: (releaseRoot: string) => Promise<string>;
}

/** The D13 chip adapts the installed release reader already used by schedule seed authorization. */
export function createActivationReader(options: ActivationReaderOptions = {}): ActivationReaderPort {
  const openSource = options.openSource ?? openAttestedScheduleSource;
  const activatedAt = options.activatedAt ?? (async (releaseRoot: string) =>
    (await stat(resolve(releaseRoot, 'attestation.json'))).mtime.toISOString());
  return {
    async readActivation() {
      const source = await openSource();
      if (!source.available) throw new Error(source.reason);
      const installedAt = await activatedAt(source.releaseRoot);
      return {
        revision: `release:${source.sourceCommit}:${source.archiveSha256}:${installedAt}`,
        label: 'VM',
        sha: source.sourceCommit,
        activatedAt: installedAt,
      };
    },
  };
}

function projectable(ctx: SurfaceContext, run: RunMetadata): ProjectableRun {
  const events = ctx.controlStore.listEvents(run.ownerSubject, run.runRef, 0, 250);
  return {
    runRef: run.runRef,
    title: run.title,
    owner: run.owner,
    lifecycle: runLifecycleKind(run.lifecycle),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    terminalOutcome: run.terminalOutcome,
    completedAt: run.completedAt,
    archivedFrom: run.archivedFrom,
    openHumanRequestCount: run.openHumanRequestCount,
    events: events.ok ? events.value : [],
  };
}

function runProjection(ctx: SurfaceContext): { revision: string; rows: ReturnType<typeof projectRunActivity>[] } {
  const document = ctx.controlStore.getControlDocumentMetadata();
  const now = (ctx.now?.() ?? new Date()).toISOString();
  const rows = ctx.controlStore.listRuns('operator', 'all-subjects')
    .map((run) => projectRunActivity(projectable(ctx, run), now));
  return { revision: `runs:${document.documentRevision}`, rows };
}

/** Live source wiring only; all shaping remains in the harvested W5 projector. */
export function createHomeRoutePorts(
  ctx: SurfaceContext,
  schedules: ScheduleService,
  // P5 W6.1 [P5-C30]: the shared activation port is now REQUIRED and passed explicitly from `index.ts`
  // (`surfaceCtx.activationReader`) — the `createActivationReader()` default is DELETED so a second
  // construction is impossible. `createActivationReader` remains exported for `makeSurfaceContext`.
  activation: ActivationReaderPort,
  /** Test seam only: the Inbox `gh pr list` port, so a Home fixture reaches no real `gh`. */
  inboxGh?: SubprocessPort,
  /** Test seam only: the coordination `git remote get-url origin` reader, so a Home fixture drives the
   *  composition-time pin without a real checkout. Production leaves it at the real git default. */
  inboxReadRemote?: GitRemoteReader,
): HomeRoutePorts {
  const inboxPorts = createInboxRoutePorts(ctx, {
    ...(inboxGh ? { runGh: inboxGh } : {}),
    ...(inboxReadRemote ? { readRemote: inboxReadRemote } : {}),
  });
  return {
    sessionConfig: ctx.sessionConfig,
    now: ctx.now,
    runningNow: {
      async read() {
        const projected = runProjection(ctx);
        return {
          revision: projected.revision,
          data: projected.rows.filter((item) => item.category === 'active').map((item) => item.row),
        };
      },
    },
    attention: {
      async read() {
        const document = ctx.controlStore.getControlDocumentMetadata();
        const runs = ctx.controlStore.listRuns('operator', 'all-subjects').map((run) => projectable(ctx, run));
        const data = projectGateCounts(`attention:${document.documentRevision}`, runs);
        return { revision: data.revision, data };
      },
    },
    inboxCount: {
      async read() {
        // Count the same last-good PR + escalation items the Inbox route serves. A source failure with
        // no last-good data is UNKNOWN, not zero: throw so Home shows the inbox source unavailable
        // rather than a false "nothing needs you". A stale-but-non-empty read still counts last-good.
        const response = await readInbox(inboxPorts, ctx.repoRoot);
        const anyFailed = response.sources.pr.status === 'failed' || response.sources.escalation.status === 'failed';
        if (response.items.length === 0 && anyFailed) {
          throw new Error('inbox source unavailable — refusing a false empty count');
        }
        return { revision: `inbox:${response.revision}`, data: response.items.length };
      },
    },
    nextSchedules: {
      async read() {
        const snapshot = await schedules.list();
        return {
          revision: `schedules:${snapshot.collectionRevision}`,
          data: snapshot.schedules
            .filter((schedule) => schedule.armed && schedule.nextAt !== null)
            .map((schedule) => ({
              scheduleId: schedule.id,
              scheduledFor: schedule.nextAt!,
              nextAt: schedule.nextAt!,
              owner: schedule.owner,
            })),
        };
      },
    },
    activation,
    recentRuns: {
      async read() {
        const projected = runProjection(ctx);
        return { revision: projected.revision, data: projected.rows.map((item) => item.row) };
      },
    },
  };
}

function sendRevisioned(reply: FastifyReply, requestEtag: string | string[] | undefined, value: Awaited<ReturnType<typeof projectHome>>): FastifyReply {
  const etag = `"${value.revision}"`;
  reply.header('etag', etag);
  return requestEtag === etag ? reply.code(304).send() : reply.send(value);
}

export function registerHomeRoutes(scope: FastifyInstance, ports: HomeRoutePorts): void {
  scope.get('/api/home', { preHandler: requireSession(ports.sessionConfig) }, async (request, reply) =>
    sendRevisioned(reply, request.headers['if-none-match'], await projectHome(ports, (ports.now?.() ?? new Date()).toISOString())));
}

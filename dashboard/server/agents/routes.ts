import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditFn, type SurfaceContext } from '../http/context.ts';
import { requireSession, verifiedSession, writeRateLimitHook } from '../http/middleware.ts';
import { originPlugin } from '../security/origin.ts';
import type { EntityDetail, EntityList } from '../entities/contracts.ts';
import { patchEntityBuilderSource, renderAgentBuilderSource, submitEntityBuilder, type EntityBuilderCatalog, type EntityBuilderPort } from '../entities/builder.ts';
import { projectEntityBrief, projectEntityList, projectEntitySummary, projectLiveEmpty, selectEntityHostRun, type EntityGroupProjectionInput } from '../entities/project.ts';
import { runtimeExecutionHost } from '../runtime/capabilities.ts';
import { projectRunAttention } from '../control/attention.ts';
import { projectEventOutputRefs } from '../entities/outputs.ts';
import { projectRunActivity, type ProjectableRun } from '../control/runProjection.ts';
import { runLifecycleKind } from '../control/runLifecycle.ts';
import type { AttentionEnvelope, HostKind, RunOutcome, RunRow, RunnableRef } from '../control/p2Contracts.ts';
import type { RunMetadata } from '../control/types.ts';
import { loadExecutionProfiles } from '../control/environment.ts';
import { save as governedSave } from '../write/governedSave.ts';
import { launchDeclaredAgent } from '../workflows/routes.ts';
import { runBuilderAmendment } from '../workflows/amendments.ts';
import { readAgentDeclarationProblems, readDeclaredAgentDetails, type DeclaredAgentDetail } from './roster.ts';
import { nextScheduleOccurrence } from '../schedules/service.ts';
import {
  readEntityList, readAgentDetail, createAgent as createAgentEntity, updateAgent as updateAgentEntity,
  type EntityListPort, type AgentDetailPort, type SubmitBuilderPort, type Revisioned,
} from '../services/entityService.ts';
import type { ServiceReply } from '../services/scheduleService.ts';

const BULLET = '\u00b7';

function sameOwner(left: RunnableRef, right: RunnableRef): boolean {
  return left.type === right.type
    && left.id === right.id
    && left.sourcePath === right.sourcePath
    && (left.type === 'agent' || right.type === 'agent' || left.project === right.project);
}

function asProjectable(run: RunMetadata, events: ProjectableRun['events'] = []): ProjectableRun {
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
    events,
  };
}

function projectableFor(ctx: SurfaceContext, run: RunMetadata): ProjectableRun {
  const page = ctx.controlStore.listEvents(run.ownerSubject, run.runRef, 0, 250);
  return asProjectable(run, page.ok ? page.value : []);
}

function relativeTime(iso: string, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - Date.parse(iso));
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function latestOutcome(runs: readonly ProjectableRun[]): { outcome: RunOutcome; completedAt: string } | null {
  const completed = runs
    .filter((run): run is ProjectableRun & { terminalOutcome: RunOutcome; completedAt: string } => run.terminalOutcome !== null && run.completedAt !== null)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || left.runRef.localeCompare(right.runRef));
  return completed[0] ? { outcome: completed[0].terminalOutcome, completedAt: completed[0].completedAt } : null;
}

/**
 * The host an agent with no run yet would execute on: the composed runtime capability's own answer,
 * never a second OS derivation in this file. An advertised terminal names its host; a refusal falls
 * back to the single platform->host mapper inside `runtimeExecutionHost`.
 */
function previewHost(ctx: SurfaceContext): HostKind {
  return runtimeExecutionHost(ctx.runtimeCapabilities);
}

function attentionForRuns(ctx: SurfaceContext, runs: readonly RunMetadata[]): AttentionEnvelope {
  return projectRunAttention({
    runs: runs.map((run) => ({ runRef: run.runRef, owner: run.owner, lifecycle: runLifecycleKind(run.lifecycle) })),
    humanRequests: runs.flatMap((run) => {
      const detail = ctx.controlStore.getRun(run.ownerSubject, run.runRef, 'all-subjects');
      return detail.ok
        ? detail.value.humanRequests.map(({ requestRef, runRef, state }) => ({ requestRef, runRef, state }))
        : [];
    }),
  });
}

function projectionInput(ctx: SurfaceContext, declaration: DeclaredAgentDetail, allRuns: readonly RunMetadata[], attention: AttentionEnvelope, now: Date): EntityGroupProjectionInput {
  const ref: RunnableRef = { type: 'agent', id: declaration.id, sourcePath: declaration.source as `agents/${string}.md` };
  const ownedRuns = allRuns.filter((run) => sameOwner(run.owner, ref));
  const runs = ownedRuns.map((run) => projectableFor(ctx, run));
  const activity = runs.map((run) => projectRunActivity(run, now.toISOString()));
  const activeRuns = activity
    .filter((item) => item.category === 'active' || item.category === 'attention')
    .map((item) => item.row);
  const latest = latestOutcome(runs);
  const hostRun = selectEntityHostRun(ownedRuns, new Set(activeRuns.map((run) => run.runRef)));
  return {
    ref,
    projects: declaration.projects,
    ...(declaration.group === 'system' ? { group: 'system' as const } : {}),
    modelLabel: declaration.model ?? declaration.defaultProfile ?? 'default',
    temporalLabel: latest
      ? `ran ${relativeTime(latest.completedAt, now)} ${BULLET} ${latest.outcome}`
      : projectLiveEmpty(null, nextScheduleOccurrence(ctx.controlStore, ref)?.nextAt ?? null),
    host: hostRun?.executionHost ?? previewHost(ctx),
    activeRuns,
    gatedRunCount: attention.agents[ref.id] ?? 0,
    latestRun: latest?.outcome ?? null,
    nextSchedule: nextScheduleOccurrence(ctx.controlStore, ref),
    hasFailure: runs.some((run) => run.lifecycle === 'interrupted'),
  };
}

function entityRevision(ctx: SurfaceContext, declarations: readonly DeclaredAgentDetail[]): string {
  const store = ctx.controlStore.getControlDocumentMetadata();
  return createHash('sha256')
    .update(JSON.stringify({ documentRevision: store.documentRevision, scheduleCollectionRevision: ctx.controlStore.getScheduleSnapshot().collectionRevision, declarations: declarations.map((item) => [item.id, item.sourceHash]) }))
    .digest('hex');
}

function agentList(ctx: SurfaceContext): EntityList {
  const declarations = [...readDeclaredAgentDetails(ctx.repoRoot).values()];
  const runs = ctx.controlStore.listRuns('operator', 'all-subjects');
  const now = ctx.now?.() ?? new Date();
  const attention = attentionForRuns(ctx, runs);
  return projectEntityList(entityRevision(ctx, declarations), 'agent', declarations.map((declaration) => projectionInput(ctx, declaration, runs, attention, now)));
}

function purposeOf(declaration: DeclaredAgentDetail): string {
  if (declaration.description?.trim()) return declaration.description.trim();
  return declaration.instructionMarkdown.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '' && !line.startsWith('#')) ?? 'No purpose declared.';
}

function agentDetail(ctx: SurfaceContext, declaration: DeclaredAgentDetail): EntityDetail {
  const runs = ctx.controlStore.listRuns('operator', 'all-subjects');
  const now = ctx.now?.() ?? new Date();
  const input = projectionInput(ctx, declaration, runs, attentionForRuns(ctx, runs), now);
  const summary = projectEntitySummary(input);
  const recentRuns: RunRow[] = runs
    .filter((run) => sameOwner(run.owner, input.ref))
    .map((run) => projectableFor(ctx, run))
    .map((run) => projectRunActivity(run, now.toISOString()).row);
  const roots = Object.fromEntries(declaration.projects.map((project) => [project, `orgs/${project}`]));
  const events = runs
    .filter((run) => sameOwner(run.owner, input.ref))
    .flatMap((run) => {
      const page = ctx.controlStore.listEvents(run.ownerSubject, run.runRef, 0, 250);
      return page.ok ? page.value : [];
    });
  return {
    revision: entityRevision(ctx, [declaration]),
    summary,
    brief: projectEntityBrief({
      purpose: purposeOf(declaration),
      doingNow: summary.activeRuns[0]?.title ?? 'Idle.',
      recentRuns,
      outputs: projectEventOutputRefs(events, roots),
      pendingGates: summary.gatedRunCount,
      schedule: summary.nextSchedule,
      autonomyTier: declaration.autonomyTier ?? 'Not declared',
    }),
    details: {
      sourcePath: input.ref.sourcePath,
      sourceRevision: declaration.sourceHash,
      tools: [...(declaration.tools ?? [])],
      declaredCeiling: declaration.autonomyTier ?? 'Not declared',
      replaces: declaration.whatItReplaces ? [declaration.whatItReplaces] : [],
      buildsOn: [...(declaration.buildsOn ?? [])],
      knowledgeSources: [...(declaration.knowledgeSource ?? [])],
      skills: [...(declaration.skills ?? [])],
      schemas: ['agent-declaration/v1'],
      lineage: [...(declaration.buildsOn ?? [])],
      grades: [],
      ids: [declaration.id],
      builder: (() => {
        const catalog = builderCatalog(ctx);
        return {
          models: [...catalog.models], profiles: [...catalog.profiles], tools: [...catalog.tools], skills: [...catalog.skills], connectors: [...catalog.connectors], filesystemRoots: Object.keys(catalog.filesystemRoots).sort(), projects: [...catalog.projects],
          value: { humanName: summary.humanName, purpose: purposeOf(declaration), model: declaration.model ?? catalog.models[0] ?? '', profile: declaration.defaultProfile ?? catalog.profiles[0] ?? '', tools: [...(declaration.tools ?? [])], skills: [...(declaration.skills ?? [])], connectors: (declaration.connectors ?? []).map((connector) => ({ server: connector.server, tools: [...connector.tools] })), filesystemRoots: [...(declaration.filesystemRoots ?? [])] },
        };
      })(),
    },
  };
}

/** P6 W6.2 [design:435]: sends a `services/entityService.ts` `ServiceReply` byte-for-byte the way the
 *  route's own `sendRevisioned` did — the etag header, then a bodiless 304 or the body at its status. */
function sendServiceReply(reply: FastifyReply, result: ServiceReply): FastifyReply {
  if (result.etag) reply.header('etag', result.etag);
  return result.status === 304 ? reply.code(304).send() : reply.code(result.status).send(result.body);
}

class AgentBuilderFailure extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function builderCatalog(ctx: SurfaceContext): EntityBuilderCatalog {
  const declarations = [...readDeclaredAgentDetails(ctx.repoRoot).values()];
  const profiles = loadExecutionProfiles(ctx.repoRoot);
  const projects = readdirSync(join(ctx.repoRoot, 'orgs'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const filesystemRoots = Object.fromEntries(projects.map((project) => [project, `orgs/${project}`]));
  return {
    models: [...new Set(profiles.map((profile) => profile.model))].sort(),
    profiles: profiles.map((profile) => profile.id).sort(),
    tools: [...new Set(['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'WebSearch', 'WebFetch', ...declarations.flatMap((item) => item.tools ?? [])])].sort(),
    skills: [...new Set(declarations.flatMap((item) => item.skills ?? []))].sort(),
    connectors: [...new Map(declarations.flatMap((item) => item.connectors ?? []).map((connector) => [connector.server, { server: connector.server, tools: [...connector.tools] }])).values()].sort((left, right) => left.server.localeCompare(right.server)),
    filesystemRoots,
    projects,
  };
}

function exactBody(body: unknown, keys: readonly string[]): body is Record<string, unknown> {
  return !!body && typeof body === 'object' && !Array.isArray(body)
    && Object.keys(body as Record<string, unknown>).every((key) => keys.includes(key));
}

function agentBuilderPort(ctx: SurfaceContext): EntityBuilderPort {
  return {
    async save(input) {
      if (!ctx.durableRepoRoot) throw new AgentBuilderFailure(409, 'durable-worktree-required');
      const activePath = join(ctx.repoRoot, ...input.sourcePath.split('/'));
      const exists = existsSync(activePath);
      let content: string;
      if (exists) {
        const source = readFileSync(activePath, 'utf8');
        const revision = createHash('sha256').update(source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')).digest('hex');
        if (revision !== input.expectedSourceRevision) throw new AgentBuilderFailure(409, 'stale-source-revision');
        const patched = patchEntityBuilderSource('agent', source, input.request);
        if (!patched) throw new AgentBuilderFailure(409, 'agent-layout-unsupported');
        content = patched;
      } else {
        if (input.expectedSourceRevision !== agentList(ctx).revision) throw new AgentBuilderFailure(409, 'stale-collection-revision');
        content = renderAgentBuilderSource(input.ref.id, input.request);
      }
      const proposedSourceHash = createHash('sha256').update(content.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')).digest('hex');
      return runBuilderAmendment(ctx.definitionAmendmentStore, {
        kind: exists ? 'agent-builder-edit' : 'agent-builder-create', entityPath: input.sourcePath,
        idempotencyKey: input.idempotencyKey, baseSourceHash: input.expectedSourceRevision, proposedSourceHash,
        request: input.request,
        effect: async () => {
          const outcome = await governedSave({ repoRoot: ctx.durableRepoRoot!, relpath: input.sourcePath, content, sessionToken: input.sessionToken, sessionConfig: ctx.sessionConfig, runGit: ctx.saveGit, openPr: ctx.openPr, runPreamble: ctx.runPreamble, publication: ctx.coordinationPublication, outboxRoot: ctx.outboxRoot, message: `chore(agent): ${exists ? 'edit' : 'create'} ${input.ref.id}` });
          if (!outcome.ok) throw new AgentBuilderFailure(outcome.status, outcome.reason);
          await auditFn(ctx)(ctx.repoRoot, { action: 'entity-builder-amend', owner: 'operator', target: input.sourcePath, riskTier: 'T2', result: 'pending-human-merge', detail: { kind: exists ? 'agent-builder-edit' : 'agent-builder-create', oldSourceHash: input.expectedSourceRevision, newSourceHash: proposedSourceHash } }, { runGit: ctx.opsGit, now: ctx.now });
        },
      });
    },
  };
}

/** Register the P2 Agent entity list/detail service. P6 W6.2 [design:435]: every handler below except
 *  the launch route is now a THIN caller of `services/entityService.ts` — the list/detail ETag-304 read,
 *  the closed create/update body walls, and the `submitEntityBuilder` -> 202 / builder-error mapping are
 *  all the service's. No byte of the request/response contract changed.
 *
 *  BLOCKER (flagged, not silently dropped): `POST /api/agents/:id/launch` has NO covering W2 service.
 *  `services/launchService.ts` characterizes only the WORKFLOW one-step launch (`findScannedDef`,
 *  `expectedSourceRevision`/`parameters`/`composerRef` body) — the agent launch body/gate sequence here
 *  (source-CAS, pending-amendment, admission, then `launchDeclaredAgent`'s synthetic WorkflowDef) has no
 *  analog in any built W2 service, so it stays inline. Its execution host already comes from placement
 *  via `launchDeclaredAgent` -> the shared `launchDefinition` (W6.2's earlier launch-site conversion). */
export function registerAgents(app: FastifyInstance, ctx: SurfaceContext): void {
  const entityListPort: EntityListPort = { list: () => agentList(ctx) as unknown as Revisioned };
  const agentDetailPort: AgentDetailPort = {
    declaration: (id) => readDeclaredAgentDetails(ctx.repoRoot).get(id),
    detail: (declaration) => agentDetail(ctx, declaration as DeclaredAgentDetail) as unknown as Revisioned,
    problem: (id) => readAgentDeclarationProblems(ctx.repoRoot).get(id),
  };
  app.get('/api/agents', async (request, reply) =>
    sendServiceReply(reply, readEntityList(entityListPort, request.headers['if-none-match'] as string | undefined)));
  app.get('/api/agents/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    return sendServiceReply(reply, readAgentDetail(agentDetailPort, id, request.headers['if-none-match'] as string | undefined));
  });

  const port = agentBuilderPort(ctx);
  const resolveSelector = (selector: { type: 'agent' | 'workflow'; id: string }): RunnableRef => {
    if (selector.type !== 'agent' || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(selector.id)) throw new Error('invalid-runnable-selector');
    return { type: 'agent', id: selector.id, sourcePath: `agents/${selector.id}.md` };
  };
  app.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('onRequest', writeRateLimitHook(ctx.rateGuard));
    const preHandler = requireSession(ctx.sessionConfig);
    scope.post('/api/agents', { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
      const submit: SubmitBuilderPort = (args) => submitEntityBuilder(
        { ...args, sessionToken: verifiedSession(request)?.token },
        { resolve: resolveSelector, catalog: builderCatalog(ctx), port },
      );
      return sendServiceReply(reply, await createAgentEntity(submit, request.body));
    });
    scope.put('/api/agents/:id', { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const declaration = readDeclaredAgentDetails(ctx.repoRoot).get(id);
      const submit: SubmitBuilderPort = (args) => submitEntityBuilder(
        { ...args, sessionToken: verifiedSession(request)?.token },
        { resolve: resolveSelector, catalog: builderCatalog(ctx), port },
      );
      return sendServiceReply(reply, await updateAgentEntity(submit, declaration, id, request.body, declaration?.projects[0]));
    });
    scope.post('/api/agents/:id/launch', { preHandler }, async (request: FastifyRequest, reply: FastifyReply) => {
      const body = request.body;
      if (!exactBody(body, ['expectedSourceRevision', 'idempotencyKey']) || typeof body.expectedSourceRevision !== 'string' || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim()) return reply.code(400).send({ error: 'invalid-agent-launch-body' });
      const { id } = request.params as { id: string };
      const declaration = readDeclaredAgentDetails(ctx.repoRoot).get(id);
      if (!declaration) return reply.code(404).send({ error: 'not-found' });
      if (declaration.sourceHash !== body.expectedSourceRevision) return reply.code(409).send({ error: 'stale-source-revision', sourceRevision: declaration.sourceHash });
      const pending = ctx.definitionAmendmentStore.lookup(declaration.source, declaration.sourceHash);
      if (!pending.ok) return reply.code(409).send({ error: 'builder-amendment-state-invalid' });
      if (pending.record) return reply.code(409).send({ error: 'builder-amendment-pending', pending: pending.record });
      const admission = ctx.admission('new-work');
      if (!admission.ok) return reply.code(admission.status).send({ error: admission.reason });
      const session = verifiedSession(request);
      if (!session) return reply.code(401).send({ error: 'unauthenticated' });
      const result = await launchDeclaredAgent(ctx, session.claims.sub, session.token, declaration, body.idempotencyKey);
      return reply.code(result.status).send(result.body);
    });
  });
}

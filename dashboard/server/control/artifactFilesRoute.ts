/**
 * F4 — the scoped, hash-verified artifact download: the ROUTE half. Split from `artifactFiles.ts` so
 * that module (imported by both link producers) never pulls `workflows/routes.ts` back in.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { readDeclaredAgentDetails } from '../agents/roster.ts';
import { findScannedDef } from '../workflows/routes.ts';
import { isDigestSha256 } from '../shared/hashing.ts';
import { auditFn, type SurfaceContext } from '../http/context.ts';
import { verifiedSession } from '../http/middleware.ts';
import { readArtifactBytes } from './artifactFiles.ts';
import { runOutputFileScope, type OutputFileScope } from './runOutputs.ts';
import { readScopeForSubject } from './readScope.ts';

/**
 * R5 — the roots map is derived from ONE entity, the one whose projection minted the link, never from the
 * union of every project on the box.
 *
 * Each branch rebuilds exactly the map its producer built: `agents/routes.ts` maps each declared
 * `projects` entry to `orgs/<project>`; `workflows/routes.ts` maps its single `entry.project` the same
 * way. The entity id is the same id its own read route takes (`GET /api/agents/:id` resolves through
 * `readDeclaredAgentDetails`, `GET /api/workflows/:id` through `findScannedDef` on `entry.ref`), and this
 * function performs the SAME resolution — so a subject who could not read the entity cannot resolve one
 * here either, and `null` becomes the route's flat 404.
 *
 * Both entity read routes are registered inside `index.ts`'s authenticated read scope and admit any
 * verified session that names an existing entity; they carry no per-subject narrowing today. If either
 * ever gains one, it must be repeated HERE — this function is the download's whole authorization step.
 */
export function outputRootsForEntity(repoRoot: string, entity: { type: string; id: string }): Record<string, string> | null {
  if (!entity.id) return null;
  if (entity.type === 'agent') {
    const declaration = readDeclaredAgentDetails(repoRoot).get(entity.id);
    if (!declaration) return null;
    return Object.fromEntries(declaration.projects.map((project) => [project, `orgs/${project}`]));
  }
  if (entity.type === 'workflow') {
    const project = findScannedDef(repoRoot, entity.id)?.entry.project;
    return project ? { [project]: `orgs/${project}` } : null;
  }
  return null;
}

/**
 * The same decision as `outputRootsForEntity`, widened to the BASE the roots are relative to.
 *
 * `agent` and `workflow` links are rooted at the repository checkout and are unchanged. A `run` link is
 * not: a canonical run's artifacts never land in the checkout at all — they live in that run's own
 * integration worktree under the state root (`integrationLayout.ts`), which is why the download was dead
 * for every run-produced artifact until this branch existed.
 *
 * The run branch keeps R5 exactly: the scope is derived from the run's integration layout and its
 * integration journal, never from caller input, and it is reached only AFTER the same ownership check the
 * run READ route performs — `controlStore.getRun(sub, runRef, readScopeForSubject(sub))`, the identical
 * call behind `GET /api/control/runs/:runRef`. A subject who cannot read the run cannot resolve a scope
 * here, and gets the same flat 404 as a run that does not exist. If that read route ever narrows further,
 * it must narrow HERE too; this is the download's whole authorization step.
 */
export function outputFileScopeForEntity(
  ctx: SurfaceContext,
  sub: string,
  entity: { type: string; id: string },
): OutputFileScope | null {
  if (!entity.id) return null;
  if (entity.type === 'run') {
    const scope = readScopeForSubject(sub);
    const run = ctx.controlStore.getRun(sub, entity.id, scope);
    if (!run.ok) return null;
    return runOutputFileScope({
      stateRoot: ctx.stateRoot, store: ctx.controlStore, subject: sub, scope, run: run.value.run,
    });
  }
  const roots = outputRootsForEntity(ctx.repoRoot, entity);
  return roots ? { base: ctx.repoRoot, roots, paths: Object.keys(roots) } : null;
}

/**
 * The browser names a download from the URL's last segment unless the header says otherwise — which for
 * `/api/control/files?...` would save every artifact as an extensionless file called "files". The name
 * is the requested path's final segment, admitted ONLY through a strict allowlist that cannot express a
 * quote, a semicolon, a separator or a CR/LF, so no part of this header is caller-controlled beyond a
 * bare filename. Anything else (unusual characters, an over-long name) drops the parameter rather than
 * escaping it, leaving a plain `attachment`.
 */
function attachmentHeader(path: string): string {
  const name = path.split('/').at(-1) ?? '';
  return /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(name) ? `attachment; filename="${name}"` : 'attachment';
}

function subjectOf(req: FastifyRequest): string | null {
  return verifiedSession(req)?.claims.sub ?? null;
}

/**
 * `GET /api/control/files?path=<repo-relative>&sha256=<64 hex>` — registered on the control scope, so it
 * inherits that scope's origin check, rate limit and `requireSession` preHandler unchanged.
 */
export function registerArtifactFileRoute(scope: FastifyInstance, ctx: SurfaceContext, preHandler: preHandlerHookHandler): void {
  scope.get('/api/control/files', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
    const sub = subjectOf(req);
    if (!sub) return reply.code(401).send({ error: 'unauthenticated' });

    const query = (req.query ?? {}) as Record<string, unknown>;
    const path = typeof query.path === 'string' ? query.path : '';
    const expected = typeof query.sha256 === 'string' ? query.sha256.toLowerCase() : '';
    const entity = {
      type: typeof query.entityType === 'string' ? query.entityType : '',
      id: typeof query.entityId === 'string' ? query.entityId : '',
    };
    if (!path) return reply.code(404).send({ error: 'not found' });
    // A link built before the bytes existed carries no digest. Serving it unverified would defeat the
    // parameter entirely, so it is refused loudly rather than degraded quietly. This is pure request
    // shape — it reveals nothing about the repository — so it stays a distinguishable 400.
    if (!isDigestSha256(expected)) return reply.code(400).send({ error: 'digest-required' });

    // R5: AUTHORIZATION. The roots — and, for a run, the base directory they sit under — come from the
    // named entity alone, and an entity this subject cannot resolve is indistinguishable from one that
    // does not exist.
    const outputScope = outputFileScopeForEntity(ctx, sub, entity);
    if (!outputScope) return reply.code(404).send({ error: 'not found' });

    // R6: past the authorization step every remaining refusal is ONE flat 404. Distinguishing
    // `too-large` (in scope, exists, over the cap) from `digest mismatch` (in scope, exists, changed)
    // from `out-of-scope` handed an authorized-for-project-A caller an existence and size oracle over
    // every other path in that project. The real reason is logged server-side instead.
    const read = readArtifactBytes(outputScope.base, path, outputScope.roots);
    if (!read.ok || read.digest !== expected) {
      const reason = read.ok ? 'digest-mismatch' : read.reason;
      req.log?.warn({ route: 'control-artifact-download', reason, entityType: entity.type, entityId: entity.id, path }, 'artifact download refused');
      return reply.code(404).send({ error: 'not found' });
    }

    try {
      await auditFn(ctx)(ctx.repoRoot, {
        action: 'control-artifact-download', owner: sub, target: path, riskTier: 'T2',
        result: 'authorized:download', detail: { path, digest: read.digest, bytes: read.bytes.length },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return reply.code(500).send({ error: 'artifact-download-audit-required' });
    }

    return reply
      .header('Content-Type', 'application/octet-stream')
      .header('Content-Disposition', attachmentHeader(path))
      .header('X-Content-Type-Options', 'nosniff')
      .send(read.bytes);
  });
}

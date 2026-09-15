/**
 * F4 — the scoped, hash-verified artifact download: the ROUTE half. Split from `artifactFiles.ts` so
 * that module (imported by both link producers) never pulls `workflows/routes.ts` back in.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { readDeclaredAgentDetails } from '../agents/roster.ts';
import { scanWorkflowDefs } from '../workflows/routes.ts';
import { isDigestSha256 } from '../shared/hashing.ts';
import { auditFn, type SurfaceContext } from '../http/context.ts';
import { verifiedSession } from '../http/middleware.ts';
import { readArtifactBytes } from './artifactFiles.ts';

/**
 * The server-owned roots map, rebuilt exactly as the two producers build theirs: `agents/routes.ts`
 * maps each declared `projects` entry to `orgs/<project>`, `workflows/routes.ts` maps its one entry
 * project the same way. Their union is therefore the complete set of roots any projection could have
 * used — no wider (the route never grants a root no projection would have granted) and no narrower
 * (every link the UI can render resolves).
 */
export function serverOwnedOutputRoots(repoRoot: string): Record<string, string> {
  const projects = new Set<string>();
  for (const detail of readDeclaredAgentDetails(repoRoot).values()) for (const project of detail.projects) projects.add(project);
  for (const scanned of scanWorkflowDefs(repoRoot)) if (scanned.entry.project) projects.add(scanned.entry.project);
  return Object.fromEntries([...projects].sort().map((project) => [project, `orgs/${project}`]));
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
    if (!path) return reply.code(404).send({ error: 'not found' });
    // A link built before the bytes existed carries no digest. Serving it unverified would defeat the
    // parameter entirely, so it is refused loudly rather than degraded quietly.
    if (!isDigestSha256(expected)) return reply.code(400).send({ error: 'digest-required' });

    const read = readArtifactBytes(ctx.repoRoot, path, serverOwnedOutputRoots(ctx.repoRoot));
    if (!read.ok) return read.reason === 'too-large'
      ? reply.code(413).send({ error: 'artifact-too-large' })
      : reply.code(404).send({ error: 'not found' });
    if (read.digest !== expected) return reply.code(409).send();

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

/**
 * D15 — workflow DEFINITION registry routes.
 *
 *   GET  /api/workflows           — list org workflow definitions with validation status (read-only, pre-auth)
 *   GET  /api/workflows/:id       — one definition + its compiled proposal preview + content hash (read-only)
 *   POST /api/workflows/:id/launch — governed convenience: compile → import → approve → launch through the
 *                                    EXISTING control-plane machinery.
 *
 * The two GETs are pure reads registered on the app like `registerRegistry`. The launch route is a
 * governed WRITE: it is registered in its OWN child scope guarded by the same origin → rate-limit →
 * session chain the write surface uses (surface.ts is not edited; this mirrors the PTY route's pattern).
 *
 * The launch handler does NOT re-implement the launch: it prepares the approved-revision preconditions
 * (compile → import → approve) and then calls the ONE canonical launch body, `executeApprovedLaunch`
 * in `control/launch.ts`, which the manual proposal launch route also calls. With no execution engine
 * injected (production state), the run publishes canonical cards and then stalls at the existing
 * activation gate (`activationGated: true`), exactly like a manual proposal launch does today.
 */
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditFn, type SurfaceContext } from '../http/context.ts';
import { requireSession, verifiedSession, writeRateLimitHook } from '../http/middleware.ts';
import { originPlugin } from '../security/origin.ts';
import { loadWorkflowCompileEnvironment, workflowProfileIds } from '../control/environment.ts';
import {
  proposalContentHash,
  validateServerCompiledPlanProposal,
  type PlanProposal,
} from '../control/proposal.ts';
import { executeApprovedLaunch, type LaunchOutcome } from '../control/launch.ts';
import { proposalSnapshotHash } from '../control/store.ts';
import type { AgentWorkspaceLaunchProvenance, JsonObject } from '../control/types.ts';
import { instantiateWorkflowDef, parseWorkflowDef, type WorkflowDef } from './defs.ts';
import { compileWorkflowDef } from './compile.ts';

interface WorkflowStagePreview {
  id: string;
  action: string;
  target: string;
  riskTier: 'T1' | 'T2' | 'T3';
  /** Authored declaration, not effective routing. Null keeps legacy default routing. */
  declaredAssignment: WorkflowAssignmentPreview | null;
  review: { subjectStageId: string; maxCreatorReworks: number } | null;
  completionGate: { id: string; kind: 'approval'; requiresReview: 'pass' } | null;
}

/** Declaration-side identity. Effective routing is emitted only by a successful compile. */
export interface WorkflowAssignmentPreview {
  agentId: string;
  profileId: string;
}

export interface WorkflowDefEntry {
  /** URL id: the definition's own id when it parses, else a stable path-derived fallback. */
  ref: string;
  project: string;
  path: string;
  valid: boolean;
  title: string | null;
  profile: string | null;
  manager: WorkflowAssignmentPreview | null;
  stageCount: number;
  parameters: string[];
  riskTier: 'T1' | 'T2' | 'T3' | null;
  /** Per-stage preview (action → target, tier) for a compiled-preview list; empty for invalid defs. */
  stages: WorkflowStagePreview[];
  detail: string | null;
  /** Semantic compiler decision; intentionally separate from parser `valid`. */
  launchable: boolean;
  compileError: string | null;
  compileDetail: string | null;
}

const ORGS_DIR = 'orgs';
const WORKFLOWS_SUBDIR = 'workflows';

/** True only when the real candidate remains inside the real root (including the root itself). */
function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function invalidEntry(project: string, basename: string, path: string, detail: string): ScannedDef {
  return {
    def: null,
    entry: {
      ref: `${project}~${basename}`,
      project,
      path,
      valid: false,
      title: null,
      profile: null,
      manager: null,
      stageCount: 0,
      parameters: [],
      riskTier: null,
      stages: [],
      detail,
      launchable: false,
      compileError: null,
      compileDetail: null,
    },
  };
}

function highestTier(def: WorkflowDef): 'T1' | 'T2' | 'T3' {
  const rank = { T1: 1, T2: 2, T3: 3 } as const;
  return def.stages.reduce<'T1' | 'T2' | 'T3'>((max, stage) => (rank[stage.riskTier] > rank[max] ? stage.riskTier : max), 'T1');
}

export interface ScannedDef {
  entry: WorkflowDefEntry;
  def: WorkflowDef | null;
}

/** Scan `orgs/<project>/workflows/*.md`, parsing each definition and recording its validation status. */
export function scanWorkflowDefs(repoRoot: string): ScannedDef[] {
  const orgsRoot = join(repoRoot, ORGS_DIR);
  if (!existsSync(orgsRoot)) return [];
  let rootReal: string;
  let orgsReal: string;
  try {
    rootReal = realpathSync(resolve(repoRoot));
    orgsReal = realpathSync(orgsRoot);
  } catch {
    return [];
  }
  if (!isWithin(rootReal, orgsReal)) return [];
  const knownProfiles = workflowProfileIds();
  const scanned: ScannedDef[] = [];
  for (const project of readdirSync(orgsRoot, { withFileTypes: true })) {
    if (!project.isDirectory()) continue;
    const projectDir = join(orgsRoot, project.name);
    let projectReal: string;
    try {
      projectReal = realpathSync(projectDir);
    } catch {
      continue;
    }
    if (!isWithin(rootReal, projectReal) || !isWithin(orgsReal, projectReal)) continue;
    const dir = join(projectDir, WORKFLOWS_SUBDIR);
    if (!existsSync(dir)) continue;
    let workflowsReal: string;
    try {
      // Do not traverse a project workflow directory that is itself a symlink/junction to another tree.
      if (lstatSync(dir).isSymbolicLink()) continue;
      workflowsReal = realpathSync(dir);
    } catch {
      continue;
    }
    if (!isWithin(rootReal, workflowsReal) || !isWithin(projectReal, workflowsReal)) continue;
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.md')) continue;
      const relPath = `${ORGS_DIR}/${project.name}/${WORKFLOWS_SUBDIR}/${name}`;
      const basename = name.replace(/\.md$/, '');
      let text: string;
      try {
        const candidate = join(dir, name);
        // A symlinked definition could otherwise escape the project after the directory check.
        if (!lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink()) continue;
        const fileReal = realpathSync(candidate);
        if (!isWithin(rootReal, fileReal) || !isWithin(workflowsReal, fileReal)) continue;
        text = readFileSync(fileReal, 'utf8');
      } catch {
        continue;
      }
      const parsed = parseWorkflowDef(text, { knownProfiles });
      if (parsed.ok) {
        if (parsed.value.project !== project.name) {
          scanned.push(invalidEntry(
            project.name,
            basename,
            relPath,
            `definition project '${parsed.value.project}' does not match path project '${project.name}'`,
          ));
          continue;
        }
        scanned.push({
          def: parsed.value,
          entry: {
            ref: parsed.value.id,
            project: parsed.value.project,
            path: relPath,
            valid: true,
            title: parsed.value.title,
            profile: parsed.value.profile,
            manager: parsed.value.manager ? { ...parsed.value.manager } : null,
            stageCount: parsed.value.stages.length,
            parameters: [...(parsed.value.parameters ?? [])],
            riskTier: highestTier(parsed.value),
            stages: parsed.value.stages.map((stage) => ({
              id: stage.id, action: stage.action, target: stage.target, riskTier: stage.riskTier,
              declaredAssignment: stage.agentId && stage.profileId
                ? { agentId: stage.agentId, profileId: stage.profileId } : null,
              review: stage.review ? { subjectStageId: stage.review.subjectStageId, maxCreatorReworks: stage.review.maxCreatorReworks } : null,
              completionGate: stage.completionGate ? { id: stage.completionGate.id, kind: stage.completionGate.kind, requiresReview: stage.completionGate.requiresReview } : null,
            })),
            detail: null,
            launchable: false,
            compileError: null,
            compileDetail: null,
          },
        });
      } else {
        scanned.push(invalidEntry(project.name, basename, relPath, parsed.detail));
      }
    }
  }
  // The detail/launch API is keyed by `id`. Do not select the first matching file when two projects
  // declare the same id: both become invalid, path-qualified entries, so neither can be launched.
  const byId = new Map<string, ScannedDef[]>();
  for (const candidate of scanned) {
    if (!candidate.def) continue;
    const matches = byId.get(candidate.def.id) ?? [];
    matches.push(candidate);
    byId.set(candidate.def.id, matches);
  }
  for (const [id, matches] of byId) {
    if (matches.length < 2) continue;
    for (const candidate of matches) {
      candidate.def = null;
      candidate.entry = {
        ...candidate.entry,
        ref: `${candidate.entry.project}~${id}`,
        valid: false,
        title: null,
        profile: null,
        manager: null,
        stageCount: 0,
        parameters: [],
        riskTier: null,
        stages: [],
        detail: `workflow id '${id}' is duplicated; ids must be globally unique`,
        launchable: false,
        compileError: null,
        compileDetail: null,
      };
    }
  }
  scanned.sort((a, b) => a.entry.ref.localeCompare(b.entry.ref));
  return scanned;
}

function findScannedDef(repoRoot: string, ref: string): ScannedDef | undefined {
  return scanWorkflowDefs(repoRoot).find((candidate) => candidate.entry.ref === ref);
}

function subject(req: FastifyRequest): string | null {
  return verifiedSession(req)?.claims.sub ?? null;
}

/**
 * Prepare the approved-revision preconditions for a definition and hand off to the canonical launch.
 *
 * The proposal a definition compiles to is CONTENT-ADDRESSED: the same definition always compiles to
 * the same snapshot hash, so a retry reuses the already-approved revision instead of minting a second
 * one. That is what lets the client's `idempotencyKey` reach `createRun` with an identical launch
 * fingerprint, so a double-click or proxy retry replays one run instead of publishing duplicate cards.
 */
async function launchDefinition(
  ctx: SurfaceContext,
  sub: string,
  sessionToken: string | undefined,
  def: WorkflowDef,
  idempotencyKey: string,
  agentWorkspaceLaunch: AgentWorkspaceLaunchProvenance | null,
): Promise<LaunchOutcome> {
  // The one-step launch is the sanctioned UI release path for workflow definitions in BOTH daemon
  // postures: it always flows through the canonical `executeApprovedLaunch`, which parks the run
  // waiting-human when the engine is absent and hands root-card activation + worker startup to the
  // automatic executor when it is present. T2+/gated stages still stop at human requests before any
  // execution. There is no separate manual proposal path for definitions to divert to, so do not refuse.
  const compileEnvironment = loadWorkflowCompileEnvironment(ctx.repoRoot);
  const compiled = compileWorkflowDef(def, compileEnvironment);
  if (!compiled.ok) return { status: 400, body: { error: compiled.reason, detail: compiled.detail } };
  // Definitions compile trusted immutable assignment snapshots. The browser proposal validator must
  // reject those compiler-only fields, while this server-owned path validates their closed shape.
  const validation = validateServerCompiledPlanProposal(compiled.value as unknown, compileEnvironment.registry);
  if (!validation.ok) return { status: 500, body: { error: 'compiled-proposal-invalid', detail: validation.detail } };
  const proposal = validation.value;
  const snapshot = proposal as unknown as JsonObject;
  const contentHash = proposalSnapshotHash(snapshot);

  // Reuse the approved revision this exact definition content already imported to, if any.
  const existing = ctx.controlStore.listProposalRevisionsForComposer(sub, 'workflow-registry').find((candidate) =>
    candidate.sourceTurnId === def.id && candidate.hash === contentHash && candidate.approval?.decision === 'approved',
  );
  let proposalRef: string;
  let revision: number;
  if (existing) {
    proposalRef = existing.proposalRef;
    revision = existing.revision;
  } else {
    const created = ctx.controlStore.createProposalRevision(sub, {
      sourceComposerRef: 'workflow-registry',
      sourceTurnId: def.id,
      title: proposal.title,
      snapshot,
    });
    if (!created.ok) return { status: 400, body: { error: created.reason, detail: created.detail } };
    proposalRef = created.value.proposalRef;
    revision = created.value.revision;

    // Approve: audit the authorization, then record the decision (mirrors the decision route). The
    // action name is the canonical one so audit queries never miss a workflow launch; `source` in the
    // detail is the only discriminator.
    try {
      const decisionRisk = proposal.stages.some((stage) => stage.riskTier === 'T3') ? 'T3'
        : proposal.stages.some((stage) => stage.riskTier === 'T2') ? 'T2' : 'T1';
      await auditFn(ctx)(ctx.repoRoot, {
        action: 'control-proposal-decision-authorize', owner: sub, target: proposalRef,
        riskTier: decisionRisk, result: `authorized:approved:${contentHash}`,
        detail: { proposalRef, revision, proposalHash: contentHash, decision: 'approved', source: `workflow:${def.id}` },
      }, { runGit: ctx.opsGit, now: ctx.now });
    } catch {
      return { status: 500, body: { error: 'decision-audit-required' } };
    }
    const decided = ctx.controlStore.decideProposal(sub, proposalRef, revision, {
      expectedHash: contentHash, expectedApprovalRevision: 0, decision: 'approved', idempotencyKey: `${idempotencyKey}:decision`,
    });
    if (!decided.ok) return { status: 409, body: { error: decided.reason, detail: decided.detail } };
  }

  return executeApprovedLaunch(ctx, sub, {
    proposalRef,
    revision,
    storedHash: contentHash,
    snapshot,
    sessionToken,
    idempotencyKey,
    predecessorRunRef: null,
    expectedPredecessorVersion: -1,
    source: `workflow:${def.id}`,
    agentWorkspaceLaunch,
  });
}

/** A compiled-preview projection for the detail route (never exposes engine internals). */
function compiledPreview(repoRoot: string, def: WorkflowDef): { proposalId: string; contentHash: string; proposal: PlanProposal } | { error: string; detail: string } {
  const compiled = compileWorkflowDef(def, loadWorkflowCompileEnvironment(repoRoot));
  if (!compiled.ok) return { error: compiled.reason, detail: compiled.detail };
  return { proposalId: compiled.value.proposalId, contentHash: proposalContentHash(compiled.value), proposal: compiled.value };
}

/** Preserve parser validity while exposing the compiler's exact semantic launch decision. */
function entryWithCompileStatus(scanned: ScannedDef, repoRoot: string): WorkflowDefEntry {
  if (!scanned.def) return scanned.entry;
  const preview = compiledPreview(repoRoot, scanned.def);
  return {
    ...scanned.entry,
    launchable: !('error' in preview),
    compileError: 'error' in preview ? preview.error : null,
    compileDetail: 'error' in preview ? preview.detail : null,
  };
}

/** Register the workflow-definition registry routes + the governed one-step launch route. */
export function registerWorkflows(app: FastifyInstance, ctx: SurfaceContext): void {
  const repoRoot = ctx.repoRoot;

  // Read-only, pre-auth (like registerRegistry).
  app.get('/api/workflows', async () => ({ items: scanWorkflowDefs(repoRoot).map((scanned) => entryWithCompileStatus(scanned, repoRoot)) }));
  // Profiles are server-owned execution policy. Clients must read them rather than infer a default.
  app.get('/api/workflows/profiles', async () => ({ profiles: [...workflowProfileIds()].sort() }));

  app.get('/api/workflows/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const scanned = findScannedDef(repoRoot, id);
    if (!scanned) return reply.code(404).send({ error: 'not-found' });
    if (!scanned.def) return reply.send({ entry: scanned.entry, definition: null, compiled: null });
    const preview = compiledPreview(repoRoot, scanned.def);
    return reply.send({
      entry: entryWithCompileStatus(scanned, repoRoot),
      definition: scanned.def,
      compiled: 'error' in preview ? { ok: false, error: preview.error, detail: preview.detail } : {
        ok: true, proposalId: preview.proposalId, contentHash: preview.contentHash,
        manager: preview.proposal.manager, stages: preview.proposal.stages,
      },
    });
  });

  // Governed WRITE: its own origin → rate-limit → session child scope (mirrors the PTY route in index.ts;
  // surface.ts is intentionally not edited).
  app.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('onRequest', writeRateLimitHook(ctx.rateGuard));
    const preHandler = requireSession(ctx.sessionConfig);
    scope.post('/api/workflows/:id/launch', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
      const sub = subject(req);
      if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
      const { id } = req.params as { id: string };
      // Launch identity is CLIENT-supplied. A server-minted key would make every double-click or proxy
      // retry a fresh run with duplicate canonical cards, so an absent key is refused, never invented.
      const body = req.body !== null && typeof req.body === 'object' && !Array.isArray(req.body)
        ? req.body as Record<string, unknown> : {};
      if (Object.keys(body).some((key) => key !== 'idempotencyKey' && key !== 'composerRef' && key !== 'parameters')) {
        return reply.code(400).send({ error: 'invalid-launch-body' });
      }
      const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
      if (idempotencyKey.trim() === '' || idempotencyKey.length > 512) {
        return reply.code(400).send({
          error: 'idempotency-key-required',
          detail: 'a non-empty client-supplied idempotencyKey of at most 512 characters is required',
        });
      }
      const scanned = findScannedDef(repoRoot, id);
      if (!scanned) return reply.code(404).send({ error: 'not-found' });
      if (!scanned.def) return reply.code(409).send({ error: 'definition-invalid', detail: scanned.entry.detail });
      const rawParameters = body.parameters;
      if (rawParameters === undefined ? (scanned.def.parameters ?? []).length > 0 : !rawParameters || typeof rawParameters !== 'object' || Array.isArray(rawParameters)) {
        return reply.code(400).send({ error: 'invalid-launch-parameters' });
      }
      const parameters = rawParameters === undefined ? {} : rawParameters as Record<string, unknown>;
      if (Object.values(parameters).some((value) => typeof value !== 'string')) return reply.code(400).send({ error: 'invalid-launch-parameters' });
      const instantiated = instantiateWorkflowDef(scanned.def, parameters as Record<string, string>);
      if (!instantiated.ok) return reply.code(400).send({ error: 'invalid-launch-parameters', detail: instantiated.detail });
      let agentWorkspaceLaunch: AgentWorkspaceLaunchProvenance | null = null;
      if (body.composerRef !== undefined) {
        if (typeof body.composerRef !== 'string' || body.composerRef.trim() === '') {
          return reply.code(400).send({ error: 'invalid-agent-workspace-ref' });
        }
        // Ownership and declaration identity come only from the durable Composer store.  The browser
        // supplies a ref to select its own workspace, never an agent id/path/hash or provider handle.
        const workspace = ctx.composerStore.get(sub, body.composerRef);
        if (!workspace.ok) return reply.code(404).send({ error: 'agent-workspace-not-found' });
        const agent = workspace.workspace.agent;
        if (!agent) return reply.code(409).send({ error: 'agent-workspace-unbound' });
        if (!(agent.projects ?? []).includes(instantiated.value.project)) {
          return reply.code(403).send({ error: 'agent-workspace-project-refused' });
        }
        agentWorkspaceLaunch = {
          composerRef: workspace.workspace.composerRef,
          agentId: agent.id,
          declarationPath: agent.path,
          declarationHash: agent.sourceHash,
        };
      }
      const result = await launchDefinition(ctx, sub, verifiedSession(req)?.token, instantiated.value, idempotencyKey, agentWorkspaceLaunch);
      return reply.code(result.status).send(result.body);
    });
  });
}

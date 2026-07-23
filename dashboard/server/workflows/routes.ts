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
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
import { decodeUtf8, isExactAssignmentAmendment, isExactGovernanceAmendment, isSafeAssignmentValue, isSafeGovernanceValue, patchWorkflowAssignment, patchWorkflowGovernance, readCanonicalDefinitionLocation, sourceHash, type AssignmentTarget, type AssignmentValue, type GovernanceValue } from './amendments.ts';
import type { PendingDefinitionAmendment } from './amendmentStore.ts';
import { DEFAULT_WORK_BRANCH, DurableRouteError, routeDurable } from '../write/branch.ts';
import { withOpsTransaction } from '../write/asyncGit.ts';
import {
  executionAssignmentRole,
  readDeclaredAgentDetails,
  type DeclaredAgentDetail,
} from '../agents/roster.ts';

interface WorkflowStagePreview {
  id: string;
  title: string;
  action: string;
  target: string;
  riskTier: 'T1' | 'T2' | 'T3';
  /** Durable accountable agent; ownership alone never grants execution authority. */
  governedBy: string | null;
  dependsOn: string[];
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
  /** SHA-256 of the exact raw UTF-8 definition bytes used for this projection. */
  sourceHash: string | null;
  valid: boolean;
  title: string | null;
  profile: string | null;
  /** Durable workflow governor, separate from executable manager routing. */
  governedBy: string | null;
  /** Declaration/project diagnostics for authored governance. They never alter compiled execution. */
  governanceProblems: string[];
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
  /** Server-owned durable amendment state. It stays blocking until active canonical bytes equal its proposal. */
  pendingAmendment?: PendingDefinitionAmendment | null;
  pendingAmendmentError?: string | null;
}

const ORGS_DIR = 'orgs';
const WORKFLOWS_SUBDIR = 'workflows';

/** True only when the real candidate remains inside the real root (including the root itself). */
function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

function invalidEntry(project: string, basename: string, path: string, detail: string, rawSourceHash: string | null = null): ScannedDef {
  return {
    def: null,
    entry: {
      ref: `${project}~${basename}`,
      project,
      path,
      sourceHash: rawSourceHash,
      valid: false,
      title: null,
      profile: null,
      governedBy: null,
      governanceProblems: [],
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
  const declarations = readDeclaredAgentDetails(repoRoot);
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
      let raw: Buffer;
      try {
        const candidate = join(dir, name);
        // A symlinked definition could otherwise escape the project after the directory check.
        if (!lstatSync(candidate).isFile() || lstatSync(candidate).isSymbolicLink()) continue;
        const fileReal = realpathSync(candidate);
        if (!isWithin(rootReal, fileReal) || !isWithin(workflowsReal, fileReal)) continue;
        raw = readFileSync(fileReal);
        const decoded = decodeUtf8(raw);
        if (decoded === null) {
          scanned.push(invalidEntry(project.name, basename, relPath, 'definition source is not valid UTF-8'));
          continue;
        }
        text = decoded;
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
            `definition project '${parsed.value.project}' does not match path project '${project.name}'`, sourceHash(raw),
          ));
          continue;
        }
        const governanceProblems = validateGovernanceOwnersAgainst(
          declarations,
          parsed.value,
          governanceOf(parsed.value),
        );
        scanned.push({
          def: parsed.value,
          entry: {
            ref: parsed.value.id,
            project: parsed.value.project,
            path: relPath,
            sourceHash: sourceHash(raw),
            valid: true,
            title: parsed.value.title,
            profile: parsed.value.profile,
            governedBy: parsed.value.governedBy ?? null,
            governanceProblems,
            manager: parsed.value.manager ? { ...parsed.value.manager } : null,
            stageCount: parsed.value.stages.length,
            parameters: [...(parsed.value.parameters ?? [])],
            riskTier: highestTier(parsed.value),
            stages: parsed.value.stages.map((stage) => ({
              id: stage.id, title: stage.title, action: stage.action, target: stage.target, riskTier: stage.riskTier,
              governedBy: stage.governedBy ?? null,
              dependsOn: [...stage.dependsOn],
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
        scanned.push(invalidEntry(project.name, basename, relPath, parsed.detail, sourceHash(raw)));
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
        governedBy: null,
        governanceProblems: [],
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
function pendingAmendmentFor(ctx: SurfaceContext, entry: WorkflowDefEntry): { pending: PendingDefinitionAmendment | null; error: string | null } {
  if (!entry.sourceHash) return { pending: null, error: null };
  const lookup = ctx.definitionAmendmentStore.lookup(entry.path, entry.sourceHash);
  if (!lookup.ok) return { pending: null, error: lookup.detail };
  return { pending: lookup.record, error: null };
}

function entryWithCompileStatus(scanned: ScannedDef, ctx: SurfaceContext): WorkflowDefEntry {
  const amendment = pendingAmendmentFor(ctx, scanned.entry);
  if (!scanned.def) return { ...scanned.entry, pendingAmendment: amendment.pending, pendingAmendmentError: amendment.error };
  const preview = compiledPreview(ctx.repoRoot, scanned.def);
  return {
    ...scanned.entry,
    pendingAmendment: amendment.pending,
    pendingAmendmentError: amendment.error,
    launchable: !('error' in preview),
    compileError: 'error' in preview ? preview.error : null,
    compileDetail: 'error' in preview ? preview.detail : null,
  };
}

interface AssignmentOption {
  agentId: string;
  profileId: string;
}

function eligibleAssignmentOptions(repoRoot: string, def: WorkflowDef, role: 'manager' | 'worker'): { options: AssignmentOption[]; unavailable: string | null } {
  const environment = loadWorkflowCompileEnvironment(repoRoot);
  const options: AssignmentOption[] = [];
  for (const declaration of environment.declaredAgents.values()) {
    const allowedProfiles = declaration.allowedProfiles;
    if (!declaration.runnerBound || !declaration.projects.includes(def.project) || executionAssignmentRole(declaration.role) !== role
      || !declaration.defaultProfile || !allowedProfiles || !allowedProfiles.includes(declaration.defaultProfile)) continue;
    const defaultProfile = environment.executionProfiles.find((profile) => profile.id === declaration.defaultProfile);
    if (!defaultProfile || defaultProfile.role !== role || declaration.runtime !== defaultProfile.runtime || declaration.model !== defaultProfile.model) continue;
    for (const profileId of allowedProfiles) {
      const profile = environment.executionProfiles.find((candidate) => candidate.id === profileId);
      if (!profile || profile.role !== role || !environment.availableRuntimes.has(profile.runtime)
        || !(environment.registry.runtimes[profile.runtime] ?? []).includes(profile.model)) continue;
      options.push({ agentId: declaration.id, profileId });
    }
  }
  options.sort((a, b) => a.agentId.localeCompare(b.agentId) || a.profileId.localeCompare(b.profileId));
  return {
    options,
    unavailable: options.length ? null : 'Human binding required: no runner-bound declared agent is eligible for this workflow assignment.',
  };
}

function eligibleGovernanceAgents(repoRoot: string, def: WorkflowDef): Array<{ id: string; role: string | null; description: string | null }> {
  const environment = loadWorkflowCompileEnvironment(repoRoot);
  return [...environment.declaredAgents.values()]
    .filter((declaration) => declaration.projects.includes(def.project))
    .map((declaration) => ({ id: declaration.id, role: declaration.role, description: declaration.description }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function parseAmendmentBody(body: unknown): { expectedSourceHash: string; target: AssignmentTarget; assignment: AssignmentValue } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'expectedSourceHash' && key !== 'target' && key !== 'assignment')) return null;
  if (typeof value.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedSourceHash)) return null;
  if (!value.target || typeof value.target !== 'object' || Array.isArray(value.target)) return null;
  const target = value.target as Record<string, unknown>;
  let parsedTarget: AssignmentTarget;
  if (target.kind === 'manager' && Object.keys(target).length === 1) parsedTarget = { kind: 'manager' };
  else if (target.kind === 'stage' && Object.keys(target).length === 2 && typeof target.stageId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(target.stageId)) parsedTarget = { kind: 'stage', stageId: target.stageId };
  else return null;
  let assignment: AssignmentValue;
  if (value.assignment === null) assignment = null;
  else if (value.assignment && typeof value.assignment === 'object' && !Array.isArray(value.assignment)) {
    const candidate = value.assignment as Record<string, unknown>;
    if (Object.keys(candidate).length !== 2 || typeof candidate.agentId !== 'string' || typeof candidate.profileId !== 'string') return null;
    assignment = { agentId: candidate.agentId, profileId: candidate.profileId };
  } else return null;
  if (!isSafeAssignmentValue(assignment)) return null;
  return { expectedSourceHash: value.expectedSourceHash, target: parsedTarget, assignment };
}

function parseGovernanceAmendmentBody(body: unknown): { expectedSourceHash: string; governance: GovernanceValue } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (Object.keys(value).some((key) => key !== 'expectedSourceHash' && key !== 'governance')) return null;
  if (typeof value.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedSourceHash)) return null;
  if (!value.governance || typeof value.governance !== 'object' || Array.isArray(value.governance)) return null;
  const raw = value.governance as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== 'workflow' && key !== 'stages')) return null;
  if (raw.workflow !== null && typeof raw.workflow !== 'string') return null;
  if (!raw.stages || typeof raw.stages !== 'object' || Array.isArray(raw.stages)) return null;
  const stages = raw.stages as Record<string, unknown>;
  if (Object.values(stages).some((owner) => owner !== null && typeof owner !== 'string')) return null;
  const governance: GovernanceValue = { workflow: raw.workflow as string | null, stages: stages as Record<string, string | null> };
  return isSafeGovernanceValue(governance) ? { expectedSourceHash: value.expectedSourceHash, governance } : null;
}

function governanceOf(def: WorkflowDef): GovernanceValue {
  return {
    workflow: def.governedBy ?? null,
    stages: Object.fromEntries(def.stages.map((stage) => [stage.id, stage.governedBy ?? null])),
  };
}

function validateGovernanceOwnersAgainst(
  declarations: ReadonlyMap<string, DeclaredAgentDetail>,
  def: WorkflowDef,
  governance: GovernanceValue,
): string[] {
  const claims = [
    ...(governance.workflow ? [{ label: 'workflow', owner: governance.workflow }] : []),
    ...Object.entries(governance.stages)
      .filter((entry): entry is [string, string] => entry[1] !== null)
      .map(([stageId, owner]) => ({ label: `stage '${stageId}'`, owner })),
  ];
  const problems: string[] = [];
  for (const claim of claims) {
    const declaration = declarations.get(claim.owner);
    if (!declaration) {
      problems.push(`${claim.label} governance agent '${claim.owner}' is not declared`);
    } else if (!declaration.projects.includes(def.project)) {
      problems.push(`${claim.label} governance agent '${claim.owner}' is not declared for project '${def.project}'`);
    }
  }
  return problems;
}

function validateGovernanceOwners(repoRoot: string, def: WorkflowDef, governance: GovernanceValue): string | null {
  return validateGovernanceOwnersAgainst(readDeclaredAgentDetails(repoRoot), def, governance)[0] ?? null;
}

type DefinitionAmendmentSpec = {
  kind: 'assignment' | 'governance';
  expectedSourceHash: string;
  patch: (source: string) => { source: string; old: unknown } | null;
  validateInput?: (definition: WorkflowDef) => string | null;
  isExact: (before: WorkflowDef, after: WorkflowDef, old: unknown) => boolean;
  layoutError: string;
  noChangeError: string;
  semanticError: string;
  auditAction: string;
  routeMessage: string;
  auditDetail: (old: unknown, proposalHash: string, durable: { branch: string; pr: { url?: string; number?: number } }) => Record<string, unknown>;
  successDetail: (proposalHash: string, durable: { branch: string; pr: { url?: string; number?: number } }) => Record<string, unknown>;
};

/** The single durable pipeline for every workflow-definition edit. The edit-specific patch and
 * semantic proof are supplied by the caller; CAS, pending state, durable route, rollback and audit
 * remain deliberately identical so amendment kinds cannot drift or race. */
async function amendDefinition(ctx: SurfaceContext, sub: string, scanned: ScannedDef, spec: DefinitionAmendmentSpec): Promise<LaunchOutcome> {
  if (!scanned.def || !scanned.entry.sourceHash) return { status: 409, body: { error: 'definition-invalid', detail: scanned.entry.detail } };
  if (spec.expectedSourceHash !== scanned.entry.sourceHash) return { status: 409, body: { error: 'stale-source-hash', sourceHash: scanned.entry.sourceHash } };
  if (!ctx.durableRepoRoot) return { status: 409, body: { error: 'durable-worktree-required' } };
  const durableRoot = ctx.durableRepoRoot;
  try { if (realpathSync(resolve(ctx.repoRoot)) === realpathSync(resolve(durableRoot))) return { status: 409, body: { error: 'durable-worktree-required' } }; }
  catch { return { status: 409, body: { error: 'durable-worktree-required' } }; }
  type Prepared = { outcome: LaunchOutcome } | { proposedSourceHash: string; proposalHash: string; old: unknown; riskTier: 'T1' | 'T2' | 'T3'; durable: { branch: string; pr: { url?: string; number?: number } } };
  let prepared: Prepared;
  try {
    prepared = await withOpsTransaction(async (): Promise<Prepared> => {
      const active = readCanonicalDefinitionLocation(ctx.repoRoot, scanned.entry.path);
      const durableLocation = readCanonicalDefinitionLocation(durableRoot, scanned.entry.path);
      if (!active || !durableLocation || active.path === durableLocation.path) return { outcome: { status: 409, body: { error: 'definition-path-refused' } } };
      const activeHash = sourceHash(active.bytes);
      if (activeHash !== spec.expectedSourceHash) return { outcome: { status: 409, body: { error: 'stale-source-hash', sourceHash: activeHash } } };
      // The lookup belongs after the authoritative reread: a concurrent settled record must not block,
      // and a concurrently-created record must block both amendment kinds before any patch/write.
      const pendingLookup = ctx.definitionAmendmentStore.lookup(scanned.entry.path, activeHash);
      if (!pendingLookup.ok) return { outcome: { status: 409, body: { error: 'assignment-amendment-state-invalid' } } };
      if (pendingLookup.record) return { outcome: { status: 409, body: { error: 'assignment-amendment-pending', pending: pendingLookup.record } } };
      if (!active.bytes.equals(durableLocation.bytes)) return { outcome: { status: 409, body: { error: 'durable-base-mismatch' } } };
      const source = decodeUtf8(active.bytes);
      if (source === null) return { outcome: { status: 409, body: { error: 'definition-not-utf8' } } };
      const original = parseWorkflowDef(source, { knownProfiles: workflowProfileIds() });
      if (!original.ok || original.value.project !== scanned.entry.project || original.value.id !== scanned.def!.id) return { outcome: { status: 409, body: { error: 'definition-changed' } } };
      const inputProblem = spec.validateInput?.(original.value);
      if (inputProblem) return { outcome: { status: 409, body: { error: 'governance-owner-refused', detail: inputProblem } } };
      const patched = spec.patch(source);
      if (!patched) return { outcome: { status: 409, body: { error: spec.layoutError } } };
      if (patched.source === source) return { outcome: { status: 409, body: { error: spec.noChangeError } } };
      const reparsed = parseWorkflowDef(patched.source, { knownProfiles: workflowProfileIds() });
      if (!reparsed.ok || reparsed.value.project !== scanned.entry.project) return { outcome: { status: 409, body: { error: 'amendment-parse-refused', detail: reparsed.ok ? 'definition project no longer matches path project' : reparsed.detail } } };
      if (!spec.isExact(original.value, reparsed.value, patched.old)) return { outcome: { status: 409, body: { error: spec.semanticError } } };
      const environment = loadWorkflowCompileEnvironment(ctx.repoRoot);
      const afterCompiled = compileWorkflowDef(reparsed.value, environment);
      if (!afterCompiled.ok) return { outcome: { status: 409, body: { error: spec.kind === 'governance' ? 'governance-compile-refused' : afterCompiled.reason, detail: afterCompiled.detail } } };
      const afterValidation = validateServerCompiledPlanProposal(afterCompiled.value as unknown, environment.registry);
      if (!afterValidation.ok) return { outcome: { status: 409, body: { error: 'compiled-proposal-invalid', detail: afterValidation.detail } } };
      const proposalHash = proposalContentHash(afterCompiled.value);
      if (spec.kind === 'governance') {
        const beforeCompiled = compileWorkflowDef(original.value, environment);
        if (!beforeCompiled.ok) return { outcome: { status: 409, body: { error: 'governance-compile-refused', detail: beforeCompiled.detail } } };
        const beforeValidation = validateServerCompiledPlanProposal(beforeCompiled.value as unknown, environment.registry);
        if (!beforeValidation.ok) return { outcome: { status: 409, body: { error: 'compiled-proposal-invalid', detail: beforeValidation.detail } } };
        if (proposalContentHash(beforeCompiled.value) !== proposalHash) return { outcome: { status: 409, body: { error: 'governance-changed-execution-proposal' } } };
      }
      const proposedSourceHash = sourceHash(Buffer.from(patched.source, 'utf8'));
      const pending: PendingDefinitionAmendment = { kind: spec.kind, workflowPath: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash, branch: DEFAULT_WORK_BRANCH, pr: {}, phase: 'prepared' };
      try { ctx.definitionAmendmentStore.put(pending); }
      catch (error) { return { outcome: { status: 500, body: { error: 'assignment-amendment-state-write-failed', detail: error instanceof Error ? error.message : String(error) } } }; }
      try { writeFileSync(durableLocation.path, patched.source, 'utf8'); }
      catch (error) { return { outcome: { status: 500, body: { ok: false, status: 'recovery-required', stateStatus: 'prepared', error: `${spec.kind}-durable-write-failed`, path: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash, branch: DEFAULT_WORK_BRANCH, detail: error instanceof Error ? error.message : String(error) } } }; }
      try {
        const durable = await routeDurable(durableRoot, scanned.entry.path, { runGit: ctx.saveGit, openPr: ctx.openPr, message: spec.routeMessage });
        try { ctx.definitionAmendmentStore.update({ ...pending, phase: 'audit-pending', branch: durable.branch, pr: durable.pr }); }
        catch (error) { return { outcome: { status: 500, body: { ok: false, status: 'recovery-required', stateStatus: 'update-failed', error: 'assignment-amendment-state-write-failed', path: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash, branch: durable.branch, pr: durable.pr, detail: error instanceof Error ? error.message : String(error) } } }; }
        return { proposedSourceHash, proposalHash, old: patched.old, riskTier: highestTier(reparsed.value), durable };
      } catch (error) {
        if (error instanceof DurableRouteError && error.committed) {
          try { ctx.definitionAmendmentStore.update({ ...pending, phase: error.pushed ? 'pushed' : 'committed' }); } catch { /* prepared is a safe block */ }
          return { outcome: { status: 502, body: { error: `${spec.kind}-durable-route-incomplete`, status: 'recovery-required', committed: true, pushed: error.pushed, detail: error.message, path: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash, branch: DEFAULT_WORK_BRANCH } } };
        }
        try { writeFileSync(durableLocation.path, durableLocation.bytes); }
        catch (cleanupError) { return { outcome: { status: 500, body: { error: `${spec.kind}-durable-rollback-required`, detail: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) } } }; }
        try { ctx.definitionAmendmentStore.remove(scanned.entry.path); }
        catch (cleanupError) { return { outcome: { status: 500, body: { error: 'assignment-amendment-state-cleanup-required', detail: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) } } }; }
        throw error;
      }
    });
  } catch (error) { return { status: 500, body: { error: `${spec.kind}-durable-write-failed`, detail: error instanceof Error ? error.message : String(error) } }; }
  if ('outcome' in prepared) return prepared.outcome;
  try {
    await auditFn(ctx)(ctx.repoRoot, { action: spec.auditAction, owner: sub, target: scanned.entry.path, riskTier: prepared.riskTier, result: 'pending-human-merge', detail: { path: scanned.entry.path, oldSourceHash: spec.expectedSourceHash, newSourceHash: prepared.proposedSourceHash, ...spec.auditDetail(prepared.old, prepared.proposalHash, prepared.durable) } }, { runGit: ctx.opsGit, now: ctx.now });
  } catch {
    try { ctx.definitionAmendmentStore.update({ kind: spec.kind, workflowPath: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash: prepared.proposedSourceHash, branch: prepared.durable.branch, pr: prepared.durable.pr, phase: 'audit-failed' }); } catch { /* pending remains fail-closed */ }
    return { status: 500, body: { ok: false, status: 'pending-human-merge', auditStatus: 'failed', error: `${spec.kind}-amendment-audit-required`, path: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash: prepared.proposedSourceHash, branch: prepared.durable.branch, pr: prepared.durable.pr } };
  }
  try { ctx.definitionAmendmentStore.update({ kind: spec.kind, workflowPath: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash: prepared.proposedSourceHash, branch: prepared.durable.branch, pr: prepared.durable.pr, phase: 'pending-human-merge' }); }
  catch (error) { return { status: 500, body: { ok: false, status: 'recovery-required', stateStatus: 'update-failed', error: 'assignment-amendment-state-write-failed', path: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash: prepared.proposedSourceHash, branch: prepared.durable.branch, pr: prepared.durable.pr, detail: error instanceof Error ? error.message : String(error) } }; }
  return { status: 202, body: { ok: true, status: 'pending-human-merge', path: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash: prepared.proposedSourceHash, proposalContentHash: prepared.proposalHash, ...spec.successDetail(prepared.proposalHash, prepared.durable) } };
}

async function amendAssignment(
  ctx: SurfaceContext,
  sub: string,
  scanned: ScannedDef,
  input: { expectedSourceHash: string; target: AssignmentTarget; assignment: AssignmentValue },
): Promise<LaunchOutcome> {
  return amendDefinition(ctx, sub, scanned, {
    kind: 'assignment', expectedSourceHash: input.expectedSourceHash,
    patch: (source) => {
      const patched = patchWorkflowAssignment(source, input.target, input.assignment);
      return patched ? { source: patched.source, old: patched.oldAssignment } : null;
    },
    isExact: (before, after, old) => isExactAssignmentAmendment(before, after, input.target, input.assignment, old as AssignmentValue),
    layoutError: 'assignment-layout-unsupported', noChangeError: 'assignment-no-change', semanticError: 'assignment-semantic-diff-refused',
    auditAction: 'workflow-assignment-amendment', routeMessage: `chore(workflow): amend ${scanned.def?.id ?? scanned.entry.ref} assignment`,
    auditDetail: (old, proposalHash, durable) => ({ proposalHash, target: input.target, assignment: input.assignment, branch: durable.branch, pr: durable.pr, oldAssignment: old }),
    successDetail: (_proposalHash, durable) => ({ target: input.target, assignment: input.assignment, branch: durable.branch, pr: durable.pr }),
  });
}

/** One source-addressed, batch governance edit. It shares the assignment amendment lock/store so the
 * two edit classes can never race against the same workflow bytes. */
async function amendGovernance(
  ctx: SurfaceContext,
  sub: string,
  scanned: ScannedDef,
  input: { expectedSourceHash: string; governance: GovernanceValue },
): Promise<LaunchOutcome> {
  return amendDefinition(ctx, sub, scanned, {
    kind: 'governance', expectedSourceHash: input.expectedSourceHash,
    validateInput: (definition) => validateGovernanceOwners(ctx.repoRoot, definition, input.governance),
    patch: (source) => {
      const patched = patchWorkflowGovernance(source, input.governance);
      return patched ? { source: patched.source, old: patched.oldGovernance } : null;
    },
    isExact: (before, after, old) => isExactGovernanceAmendment(before, after, input.governance, old as GovernanceValue),
    layoutError: 'governance-layout-unsupported', noChangeError: 'governance-no-change', semanticError: 'governance-semantic-diff-refused',
    auditAction: 'workflow-governance-amendment', routeMessage: `chore(workflow): amend ${scanned.def?.id ?? scanned.entry.ref} governance`,
    auditDetail: (old, proposalHash, durable) => ({ proposalHash, governance: input.governance, oldGovernance: old, branch: durable.branch, pr: durable.pr }),
    successDetail: (_proposalHash, durable) => ({ governance: input.governance, branch: durable.branch, pr: durable.pr }),
  });
}

/** Register the workflow-definition registry routes + the governed one-step launch route. */
export function registerWorkflows(app: FastifyInstance, ctx: SurfaceContext): void {
  const repoRoot = ctx.repoRoot;

  // Read-only, pre-auth (like registerRegistry).
  app.get('/api/workflows', async () => ({ items: scanWorkflowDefs(repoRoot).map((scanned) => entryWithCompileStatus(scanned, ctx)) }));
  // Profiles are server-owned execution policy. Clients must read them rather than infer a default.
  app.get('/api/workflows/profiles', async () => ({ profiles: [...workflowProfileIds()].sort() }));

  app.get('/api/workflows/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const scanned = findScannedDef(repoRoot, id);
    if (!scanned) return reply.code(404).send({ error: 'not-found' });
    if (!scanned.def) return reply.send({ entry: scanned.entry, definition: null, compiled: null });
    const preview = compiledPreview(repoRoot, scanned.def);
    return reply.send({
      entry: entryWithCompileStatus(scanned, ctx),
      definition: scanned.def,
      assignmentOptions: {
        manager: eligibleAssignmentOptions(repoRoot, scanned.def, 'manager'),
        stages: Object.fromEntries(scanned.def.stages.map((stage) => [stage.id, eligibleAssignmentOptions(repoRoot, scanned.def!, 'worker')])),
      },
      governanceOptions: eligibleGovernanceAgents(repoRoot, scanned.def),
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
      if (Object.keys(body).some((key) => key !== 'idempotencyKey' && key !== 'composerRef' && key !== 'parameters' && key !== 'expectedSourceHash')) {
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
      if (typeof body.expectedSourceHash !== 'string' || !/^[a-f0-9]{64}$/.test(body.expectedSourceHash)) {
        return reply.code(400).send({ error: 'source-hash-required' });
      }
      if (body.expectedSourceHash !== scanned.entry.sourceHash) {
        return reply.code(409).send({ error: 'stale-source-hash', sourceHash: scanned.entry.sourceHash });
      }
      const pending = pendingAmendmentFor(ctx, scanned.entry);
      if (pending.error) return reply.code(409).send({ error: 'assignment-amendment-state-invalid' });
      if (pending.pending) return reply.code(409).send({ error: 'assignment-amendment-pending', pending: pending.pending });
      const rawParameters = body.parameters;
      if (rawParameters === undefined ? (scanned.def.parameters ?? []).length > 0 : !rawParameters || typeof rawParameters !== 'object' || Array.isArray(rawParameters)) {
        return reply.code(400).send({ error: 'invalid-launch-parameters' });
      }
      const parameters = rawParameters === undefined ? {} : rawParameters as Record<string, unknown>;
      if (Object.values(parameters).some((value) => typeof value !== 'string')) return reply.code(400).send({ error: 'invalid-launch-parameters' });
      const result = await withOpsTransaction(async (): Promise<LaunchOutcome> => {
        // This is the authoritative launch CAS. No proposal/store/audit/run work starts until the raw
        // canonical bytes are re-read under the same in-process write transaction.
        const fresh = readCanonicalDefinitionLocation(ctx.repoRoot, scanned.entry.path);
        if (!fresh || sourceHash(fresh.bytes) !== body.expectedSourceHash) {
          return { status: 409, body: { error: 'stale-source-hash', sourceHash: fresh ? sourceHash(fresh.bytes) : null } };
        }
        const freshText = decodeUtf8(fresh.bytes);
        if (freshText === null) return { status: 409, body: { error: 'definition-invalid' } };
        const reparsed = parseWorkflowDef(freshText, { knownProfiles: workflowProfileIds() });
        if (!reparsed.ok || reparsed.value.id !== scanned.def!.id || reparsed.value.project !== scanned.def!.project) {
          return { status: 409, body: { error: 'definition-changed' } };
        }
        const currentPending = ctx.definitionAmendmentStore.lookup(scanned.entry.path, sourceHash(fresh.bytes));
        if (!currentPending.ok) return { status: 409, body: { error: 'assignment-amendment-state-invalid' } };
        if (currentPending.record) return { status: 409, body: { error: 'assignment-amendment-pending', pending: currentPending.record } };
        const instantiated = instantiateWorkflowDef(reparsed.value, parameters as Record<string, string>);
        if (!instantiated.ok) return { status: 400, body: { error: 'invalid-launch-parameters', detail: instantiated.detail } };
        let agentWorkspaceLaunch: AgentWorkspaceLaunchProvenance | null = null;
        if (body.composerRef !== undefined) {
          if (typeof body.composerRef !== 'string' || body.composerRef.trim() === '') return { status: 400, body: { error: 'invalid-agent-workspace-ref' } };
          const workspace = ctx.composerStore.get(sub, body.composerRef);
          if (!workspace.ok) return { status: 404, body: { error: 'agent-workspace-not-found' } };
          const agent = workspace.workspace.agent;
          if (!agent) return { status: 409, body: { error: 'agent-workspace-unbound' } };
          if (!(agent.projects ?? []).includes(instantiated.value.project)) return { status: 403, body: { error: 'agent-workspace-project-refused' } };
          agentWorkspaceLaunch = { composerRef: workspace.workspace.composerRef, agentId: agent.id, declarationPath: agent.path, declarationHash: agent.sourceHash };
        }
        return launchDefinition(ctx, sub, verifiedSession(req)?.token, instantiated.value, idempotencyKey, agentWorkspaceLaunch);
      });
      return reply.code(result.status).send(result.body);
    });
    scope.post('/api/workflows/:id/assignment-amendments', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
      const sub = subject(req);
      if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
      const { id } = req.params as { id: string };
      const input = parseAmendmentBody(req.body);
      if (!input) return reply.code(400).send({ error: 'invalid-assignment-amendment-body' });
      const scanned = findScannedDef(repoRoot, id);
      if (!scanned) return reply.code(404).send({ error: 'not-found' });
      const result = await amendAssignment(ctx, sub, scanned, input);
      return reply.code(result.status).send(result.body);
    });
    scope.post('/api/workflows/:id/governance-amendments', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
      const sub = subject(req);
      if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
      const { id } = req.params as { id: string };
      const input = parseGovernanceAmendmentBody(req.body);
      if (!input) return reply.code(400).send({ error: 'invalid-governance-amendment-body' });
      const scanned = findScannedDef(repoRoot, id);
      if (!scanned) return reply.code(404).send({ error: 'not-found' });
      const result = await amendGovernance(ctx, sub, scanned, input);
      return reply.code(result.status).send(result.body);
    });
  });
}

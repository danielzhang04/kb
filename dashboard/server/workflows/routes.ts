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
import { sha256Hex } from '../shared/hashing.ts';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { auditFn, namingFor, type SurfaceContext } from '../http/context.ts';
import { requireSession, verifiedSession, writeRateLimitHook } from '../http/middleware.ts';
import { originPlugin } from '../security/origin.ts';
import { loadExecutionProfiles, loadWorkflowCompileEnvironment, loadWorkflowProfiles, workflowProfileIds } from '../control/environment.ts';
import {
  proposalContentHash,
  validateServerCompiledPlanProposal,
  type PlanProposal,
} from '../control/proposal.ts';
import { executeApprovedLaunch, runOpsTransaction, type LaunchOutcome } from '../control/launch.ts';
import { proposalSnapshotHash } from '../control/store.ts';
import type { AgentWorkspaceLaunchProvenance, JsonObject, RunMetadata } from '../control/types.ts';
import type { AttentionEnvelope, HostKind, OutputRef, RunOutcome, RunRow, RunnableRef } from '../control/p2Contracts.ts';
import type { EntityDetail, EntityList } from '../entities/contracts.ts';
import { patchEntityBuilderSource, renderWorkflowBuilderSource, submitEntityBuilder, type EntityBuilderCatalog, type EntityBuilderPort } from '../entities/builder.ts';
import { projectEntityBrief, projectEntityList, projectEntitySummary, projectLiveEmpty, projectStepDag, selectEntityHostRun, type EntityGroupProjectionInput } from '../entities/project.ts';
import { runtimeExecutionHost } from '../runtime/capabilities.ts';
import { selectPlacementHost, projectNeverRunHost } from '../placement/select.ts';
import { computeCapabilityRequirement, type StageAgentCapabilityFields } from '../placement/requirements.ts';
import type { CapabilityRequirement } from '../placement/contracts.ts';
import { projectRunAttention } from '../control/attention.ts';
import { projectEventOutputRefs, projectOutputRef } from '../entities/outputs.ts';
import { projectRunActivity, type ProjectableRun } from '../control/runProjection.ts';
import { runLifecycleKind } from '../control/runLifecycle.ts';
import { instantiateWorkflowDef, parseWorkflowDef, type WorkflowDef } from './defs.ts';
import { compileWorkflowDef } from './compile.ts';
import { decodeUtf8, isExactAssignmentAmendment, isExactGovernanceAmendment, isSafeAssignmentValue, isSafeGovernanceValue, patchWorkflowAssignment, patchWorkflowGovernance, readCanonicalDefinitionLocation, runBuilderAmendment, sourceHash, type AssignmentTarget, type AssignmentValue, type GovernanceValue } from './amendments.ts';
import type { PendingDefinitionAmendment } from './amendmentStore.ts';
import { nextScheduleOccurrence } from '../schedules/service.ts';
import { launchService, type LaunchServicePort } from '../services/launchService.ts';
import {
  readEntityList, readWorkflowDetail, createWorkflow as createWorkflowEntity,
  updateWorkflowBuilder as updateWorkflowBuilderEntity, amendWorkflowDefinition,
  type EntityListPort, type WorkflowDetailPort, type SubmitBuilderPort, type Revisioned,
  type AmendPort, type AmendPrepared,
} from '../services/entityService.ts';
import { sendServiceReply } from '../http/serviceReply.ts';
import { DEFAULT_WORK_BRANCH, DurableRouteError, defaultGitRunner, resolveBaseCommit, routeDurable } from '../write/branch.ts';
import { buildWorkflowAmendmentManifest } from '../write/durableManifestService.ts';
import { save as governedSave } from '../write/governedSave.ts';
import {
  buildRoster,
  readDeclaredAgentDetails,
  type AgentRosterEntry,
  type DeclaredAgentDetail,
} from '../agents/roster.ts';
import { indexRepo } from '../planeA/indexer.ts';
import { loadOverride, loadPolicy } from '../routing/policy.ts';
import {
  renderWorkflowPriming,
  resolveWorkflowDefaults,
  type ResolvedAssignment,
  type WorkflowDefaults,
} from './defaults.ts';

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
  /**
   * Who WILL run this stage if nobody assigns anyone — the server-resolved default (see
   * `defaults.ts`). Kept ALONGSIDE `declaredAssignment`, never merged into it, so the UI can render a
   * declared assignment and an inherited default differently. Null = nothing resolvable.
   */
  resolvedAssignment: ResolvedAssignment | null;
  review: { subjectStageId: string; maxCreatorReworks: number } | null;
  completionGate: { id: string; kind: 'approval'; requiresReview: 'pass' } | null;
}

/** Declaration-side identity. Effective routing is emitted only by a successful compile. */
export interface WorkflowAssignmentPreview {
  agentId: string;
  profileId: string;
}

/**
 * A scanned definition, before the DTO builder attaches its display identity. `scanWorkflowDefs` is a
 * pure filesystem projection with no naming registry; {@link entryWithCompileStatus} is the one place
 * that turns a record into the wire {@link WorkflowDefEntry}.
 */
export interface WorkflowDefRecord {
  /** URL id: the definition's own id when it parses, else a stable path-derived fallback. */
  ref: string;
  project: string;
  path: string;
  /** SHA-256 of the UTF-8 definition after BOM removal and CRLF-to-LF normalization. */
  sourceHash: string | null;
  valid: boolean;
  title: string | null;
  profile: string | null;
  /** Durable workflow governor, separate from executable manager routing. */
  governedBy: string | null;
  /** Declaration/project diagnostics for authored governance. They never alter compiled execution. */
  governanceProblems: string[];
  manager: WorkflowAssignmentPreview | null;
  /**
   * Who WILL manage this workflow if nobody assigns anyone. Kept ALONGSIDE the authored `manager` so
   * the UI can tell an explicit assignment apart from an inherited default. Null for an invalid
   * definition and for a definition whose governance chain and project roster name nobody.
   */
  resolvedManager: ResolvedAssignment | null;
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

/**
 * The wire shape of one definition. The workflow's TITLE is its identity — `path` and `sourceHash`
 * are technical detail — so the display fields are derived from `title` (the registry falls back to a
 * truncated ref for a definition too broken to parse a title out of).
 */
export interface WorkflowDefEntry extends WorkflowDefRecord {
  displayName: string;
  shortRef: number;
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
      resolvedManager: null,
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
  entry: WorkflowDefRecord;
  def: WorkflowDef | null;
}

/**
 * The declared-agent roster is a READ PROJECTION assembled exactly as `/api/agents` assembles it
 * (`indexRepo` + `buildRoster`), which costs ~85ms on this repo — enough that paying it on every scan
 * would multiply through the definition routes, each of which scans at least once. It is cached per
 * repoRoot for a short window so a burst of requests pays for one build.
 *
 * The staleness this admits is bounded and harmless: the roster only feeds DEFAULT assignments, which
 * are a display/priming projection, never an authorization decision. Compile, launch, amendment CAS, and
 * governance validation all still read canonical bytes on every call and are untouched by this cache.
 */
const ROSTER_CACHE_TTL_MS = 2_000;
/** Bounded so a long-lived process that scans many roots (tests, multi-checkout tooling) cannot grow the
 *  map without limit. The daemon itself only ever serves one root. */
const ROSTER_CACHE_MAX_ROOTS = 16;
const rosterCache = new Map<string, { at: number; roster: readonly AgentRosterEntry[] }>();

/** Drop the cached roster (all roots, or one). For tests that mutate a fixture roster between scans. */
export function resetWorkflowRosterCache(repoRoot?: string): void {
  if (repoRoot === undefined) rosterCache.clear();
  else rosterCache.delete(repoRoot);
}

function cachedRoster(repoRoot: string): readonly AgentRosterEntry[] {
  const hit = rosterCache.get(repoRoot);
  const now = Date.now();
  if (hit && now - hit.at < ROSTER_CACHE_TTL_MS) return hit.roster;
  const roster = buildRoster(indexRepo(repoRoot), repoRoot, loadPolicy(repoRoot), loadOverride(repoRoot));
  if (rosterCache.size >= ROSTER_CACHE_MAX_ROOTS) {
    const oldest = rosterCache.keys().next();
    if (!oldest.done) rosterCache.delete(oldest.value);
  }
  rosterCache.set(repoRoot, { at: now, roster });
  return roster;
}

export interface ScanWorkflowOptions {
  /**
   * The declared-agent roster used to resolve DEFAULT assignments. Omitted in production: the scan then
   * builds it itself, exactly the way `/api/agents` does, ONCE per scan and only if at least one
   * definition actually parses. Injected by tests so no roster filesystem read is needed.
   */
  roster?: readonly AgentRosterEntry[];
}

/** Scan `orgs/<project>/workflows/*.md`, parsing each definition and recording its validation status.
 *
 *  This is also the ONE honest place default assignments are resolved: the resolution is a property of
 *  the definition plus the roster, not of the compile status, and doing it here means the roster is
 *  computed once for the whole scan rather than once per definition. */
export function scanWorkflowDefs(repoRoot: string, options: ScanWorkflowOptions = {}): ScannedDef[] {
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
  // LAZY and memoized: a scan that parses no valid definition never pays for a roster build, and a scan
  // that parses twenty pays for exactly one. Assembled the same way `/api/agents` assembles it.
  let scanRoster: readonly AgentRosterEntry[] | undefined = options.roster;
  const roster = (): readonly AgentRosterEntry[] => {
    if (scanRoster === undefined) scanRoster = cachedRoster(repoRoot);
    return scanRoster;
  };
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
        const defaults = resolveWorkflowDefaults(parsed.value, roster());
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
            resolvedManager: defaults.manager,
            stageCount: parsed.value.stages.length,
            parameters: [...(parsed.value.parameters ?? [])],
            riskTier: highestTier(parsed.value),
            stages: parsed.value.stages.map((stage) => ({
              id: stage.id, title: stage.title, action: stage.action, target: stage.target, riskTier: stage.riskTier,
              governedBy: stage.governedBy ?? null,
              dependsOn: [...stage.dependsOn],
              declaredAssignment: stage.agentId && stage.profileId
                ? { agentId: stage.agentId, profileId: stage.profileId } : null,
              resolvedAssignment: defaults.stages[stage.id] ?? null,
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
        resolvedManager: null,
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

/**
 * Resolve an operator-supplied workflow REF to the absolute path of its definition file, or null.
 *
 * This is the EXACT-MATCH ALLOWLIST that any caller turning a workflow ref into a path or an argv MUST
 * go through — the workflow twin of `declaredAgentFilePath`, and deliberately built the same way:
 *
 *   1. The ref must be a non-empty string. Nothing is joined onto a directory before the check.
 *   2. It must equal the `entry.ref` of a scanned entry that is `valid` with a non-null `def`. The scan
 *      itself already proved that file is a non-symlink, UTF-8, project-matching, uniquely-identified
 *      regular file under a real `orgs/<project>/workflows` directory inside the real repo root; a
 *      duplicate id has already been demoted to an invalid, path-qualified entry, so a duplicated ref
 *      can never resolve here either.
 *   3. ONLY THEN is the absolute path rebuilt — from the SCAN RESULT'S OWN `entry.path`, never from the
 *      caller's string — and re-asserted to live inside the real repo root before it is returned.
 *
 * An unknown, invalid, duplicated, or traversing ref therefore yields null and can never become a spawn
 * argument. It lives here rather than in `defs.ts` because the scan lives here and `defs.ts` is the pure
 * parser (importing the scan there would be a cycle).
 */
export function declaredWorkflowDefPath(repoRoot: string, ref: unknown): string | null {
  if (typeof ref !== 'string' || ref === '') return null;
  const scanned = scanWorkflowDefs(repoRoot).find((candidate) => candidate.entry.ref === ref);
  if (!scanned || !scanned.def || !scanned.entry.valid) return null;
  try {
    const rootReal = realpathSync(resolve(repoRoot));
    // `entry.path` is server-derived (`orgs/<project>/workflows/<name>.md` built from the directory walk),
    // so this rebuilds a path the scan already proved, rather than trusting anything the caller sent.
    const fileReal = realpathSync(resolve(rootReal, scanned.entry.path));
    if (!isWithin(rootReal, fileReal)) return null;
    return fileReal;
  } catch {
    return null;
  }
}

/**
 * The governing-agent priming TEXT for one workflow ref, or null when the ref is not on the allowlist.
 *
 * Single source of truth for what a `spawn=workflow` terminal is told: the definition's own title, ref,
 * repo-relative path, declared parameters, and the DEFAULT CAST resolved by `resolveWorkflowDefaults`.
 * The rendering is pure (`defaults.ts`); this only supplies it a scanned definition and the roster.
 */
export function workflowPrimingText(
  repoRoot: string,
  ref: unknown,
  options: ScanWorkflowOptions = {},
): { text: string; repoRelativePath: string; defaults: WorkflowDefaults } | null {
  if (typeof ref !== 'string' || ref === '') return null;
  const scanned = scanWorkflowDefs(repoRoot, options).find((candidate) => candidate.entry.ref === ref);
  if (!scanned || !scanned.def || !scanned.entry.valid) return null;
  // Read the cast back off the SCAN's own DTO rather than resolving a second time, so the priming file
  // and the `/api/workflows` payload can never disagree about who runs what.
  const defaults: WorkflowDefaults = {
    manager: scanned.entry.resolvedManager,
    stages: Object.fromEntries(scanned.entry.stages.map((stage) => [stage.id, stage.resolvedAssignment])),
  };
  return {
    text: renderWorkflowPriming(scanned.def, defaults, scanned.entry.path),
    repoRelativePath: scanned.entry.path,
    defaults,
  };
}

function subject(req: FastifyRequest): string | null {
  return verifiedSession(req)?.claims.sub ?? null;
}

/** No declared capability at all — the never-run chip's fallback when a definition failed to parse. */
const EMPTY_CAPABILITY_REQUIREMENT: CapabilityRequirement = {
  connectors: [], skills: [], filesystemRoots: [], pty: false, gpu: false, clis: [],
};

/**
 * P6 W6.2 [P6-C55, design:383]: the placement `CapabilityRequirement` for a workflow run — the union of
 * the definition's own declared fields and every ASSIGNED stage/manager agent's capability fields, via
 * W3's `computeCapabilityRequirement`. This is the ONE requirement both launch sites (`launchDefinition`,
 * shared by the workflow launch route and `launchDeclaredAgent`) select a host against.
 */
function workflowCapabilityRequirement(ctx: SurfaceContext, def: WorkflowDef): CapabilityRequirement {
  const agentIds = new Set<string>();
  if (def.manager?.agentId) agentIds.add(def.manager.agentId);
  for (const stage of def.stages) if (stage.agentId) agentIds.add(stage.agentId);
  const declarations = readDeclaredAgentDetails(ctx.repoRoot);
  const stageAgents: StageAgentCapabilityFields[] = [...agentIds].map((id) => {
    const declared = declarations.get(id);
    return {
      skills: declared?.skills ?? [],
      connectors: declared?.connectors ?? [],
      filesystemRoots: declared?.filesystemRoots ?? [],
      runtime: declared?.runtime ?? null,
    };
  });
  return computeCapabilityRequirement(
    { tools: def.tools, skills: def.skills, connectors: def.connectors, filesystemRoots: def.filesystemRoots },
    stageAgents,
  );
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
  identity: { owner: RunnableRef; executionHost: HostKind },
): Promise<LaunchOutcome> {
  // The one-step launch is the sanctioned UI release path for workflow definitions in BOTH daemon
  // postures: it always flows through the canonical `executeApprovedLaunch`, which parks the run
  // waiting-human when the engine is absent and hands root-card activation + worker startup to the
  // automatic executor when it is present. T2+/gated stages still stop at human requests before any
  // execution. There is no separate manual proposal path for definitions to divert to, so do not refuse.
  //
  // P6 W6.2 [P6-C55, design:410]: the execution host is the PLACEMENT lease host, never the caller's
  // self-identity guess — `identity.executionHost` above is superseded here. Zero fresh complete matches
  // refuses `409 no-complete-placement` BEFORE compile/import/approve, so no proposal or Run row exists.
  const requirement = workflowCapabilityRequirement(ctx, def);
  const placement = selectPlacementHost(requirement, ctx.controlStore.listHostAdvertisements(), Date.now());
  if (placement.outcome === 'no-complete-placement') {
    return { status: 409, body: { error: 'no-complete-placement' } };
  }
  const executionHost = placement.hostId!;
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
    identity: { owner: identity.owner, executionHost },
  });
}

/** A compiled-preview projection for the detail route (never exposes engine internals). */
function compiledPreview(repoRoot: string, def: WorkflowDef): { proposalId: string; contentHash: string; proposal: PlanProposal } | { error: string; detail: string } {
  const compiled = compileWorkflowDef(def, loadWorkflowCompileEnvironment(repoRoot));
  if (!compiled.ok) return { error: compiled.reason, detail: compiled.detail };
  return { proposalId: compiled.value.proposalId, contentHash: proposalContentHash(compiled.value), proposal: compiled.value };
}

/** Preserve parser validity while exposing the compiler's exact semantic launch decision. */
function pendingAmendmentFor(ctx: SurfaceContext, entry: WorkflowDefRecord): { pending: PendingDefinitionAmendment | null; error: string | null } {
  if (!entry.sourceHash) return { pending: null, error: null };
  const lookup = ctx.definitionAmendmentStore.lookup(entry.path, entry.sourceHash);
  if (!lookup.ok) return { pending: null, error: lookup.detail };
  return { pending: lookup.record, error: null };
}

function entryWithCompileStatus(scanned: ScannedDef, ctx: SurfaceContext): WorkflowDefEntry {
  const amendment = pendingAmendmentFor(ctx, scanned.entry);
  // The DTO-build site: every definition leaves here with the display identity the roster renders.
  const display = namingFor(ctx).displayFor('workflow', scanned.entry.ref, scanned.entry.title ?? undefined);
  if (!scanned.def) return { ...scanned.entry, ...display, pendingAmendment: amendment.pending, pendingAmendmentError: amendment.error };
  const preview = compiledPreview(ctx.repoRoot, scanned.def);
  return {
    ...scanned.entry,
    ...display,
    pendingAmendment: amendment.pending,
    pendingAmendmentError: amendment.error,
    launchable: !('error' in preview),
    compileError: 'error' in preview ? preview.error : null,
    compileDetail: 'error' in preview ? preview.detail : null,
  };
}

function parseAmendmentBody(body: unknown): { expectedSourceHash: string; idempotencyKey: string; target: AssignmentTarget; assignment: AssignmentValue } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (value.kind !== 'assignment' || Object.keys(value).some((key) => !['kind', 'expectedSourceRevision', 'idempotencyKey', 'target', 'assignment'].includes(key))) return null;
  if (typeof value.expectedSourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedSourceRevision)) return null;
  if (typeof value.idempotencyKey !== 'string' || value.idempotencyKey.trim() === '' || value.idempotencyKey.length > 512) return null;
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
  return { expectedSourceHash: value.expectedSourceRevision, idempotencyKey: value.idempotencyKey, target: parsedTarget, assignment };
}

function parseGovernanceAmendmentBody(body: unknown): { expectedSourceHash: string; idempotencyKey: string; governance: GovernanceValue } | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const value = body as Record<string, unknown>;
  if (value.kind !== 'governance' || Object.keys(value).some((key) => !['kind', 'expectedSourceRevision', 'idempotencyKey', 'governance'].includes(key))) return null;
  if (typeof value.expectedSourceRevision !== 'string' || !/^[a-f0-9]{64}$/.test(value.expectedSourceRevision)) return null;
  if (typeof value.idempotencyKey !== 'string' || value.idempotencyKey.trim() === '' || value.idempotencyKey.length > 512) return null;
  if (!value.governance || typeof value.governance !== 'object' || Array.isArray(value.governance)) return null;
  const raw = value.governance as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== 'workflow' && key !== 'stages')) return null;
  if (raw.workflow !== null && typeof raw.workflow !== 'string') return null;
  if (!raw.stages || typeof raw.stages !== 'object' || Array.isArray(raw.stages)) return null;
  const stages = raw.stages as Record<string, unknown>;
  if (Object.values(stages).some((owner) => owner !== null && typeof owner !== 'string')) return null;
  const governance: GovernanceValue = { workflow: raw.workflow as string | null, stages: stages as Record<string, string | null> };
  return isSafeGovernanceValue(governance) ? { expectedSourceHash: value.expectedSourceRevision, idempotencyKey: value.idempotencyKey, governance } : null;
}

/**
 * The declaration-level launch gate shared by the Agent detail projection and launch endpoint.
 * Keep this separate from host placement: placement can still refuse an otherwise launchable agent.
 */
export function declaredAgentIsLaunchable(
  declaration: DeclaredAgentDetail,
  executionProfiles: readonly { id: string }[],
): boolean {
  const project = [...declaration.projects].sort()[0];
  const profileId = declaration.defaultProfile;
  return !!project && declaration.runnerBound && !!profileId
    && (declaration.allowedProfiles ?? []).includes(profileId)
    && executionProfiles.some((profile) => profile.id === profileId);
}

/** Launch one declared Agent through the same compiler/import/approval/Run transaction as a Workflow. */
export async function launchDeclaredAgent(
  ctx: SurfaceContext,
  sub: string,
  sessionToken: string | undefined,
  declaration: DeclaredAgentDetail,
  idempotencyKey: string,
): Promise<LaunchOutcome> {
  const project = [...declaration.projects].sort()[0];
  const profileId = declaration.defaultProfile;
  const executionProfiles = loadExecutionProfiles(ctx.repoRoot);
  if (!declaredAgentIsLaunchable(declaration, executionProfiles)) {
    return { status: 409, body: { error: 'agent-not-launchable' } };
  }
  const executionProfile = executionProfiles.find((profile) => profile.id === profileId);
  if (!project || !profileId || !executionProfile) return { status: 409, body: { error: 'agent-not-launchable' } };
  const assignment = { agentId: declaration.id, profileId };
  const definition: WorkflowDef = {
    schemaVersion: 1,
    id: `agent-${declaration.id}`,
    project,
    title: `Run ${declaration.id}`,
    profile: 'producer',
    ...(executionProfile.role === 'manager' ? { manager: assignment } : {}),
    readScope: [],
    description: declaration.instructionMarkdown,
    stages: [{
      id: 'run', title: `Run ${declaration.id}`, action: 'draft:agent-run', target: `orgs/${project}`,
      workOrder: declaration.instructionMarkdown, dependsOn: [], riskTier: 'T2', declaredRiskTier: 'T2',
      classifiedFloor: 'T2',
      ...(executionProfile.role === 'worker' ? assignment : {}),
    }],
  };
  const owner: RunnableRef = { type: 'agent', id: declaration.id, sourcePath: declaration.source as `agents/${string}.md` };
  return launchDefinition(ctx, sub, sessionToken, definition, idempotencyKey, null, {
    // The Agent launch records the SAME host the composed capability advertises to the browser, so a
    // launched run and the agent's preview host can never disagree.
    owner,
    executionHost: runtimeExecutionHost(ctx.runtimeCapabilities),
  });
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

/**
 * The single durable pipeline for every workflow-definition edit. The edit-specific patch and semantic
 * proof are supplied by the caller; CAS, pending state, durable route, rollback and audit remain
 * deliberately identical so amendment kinds cannot drift or race.
 *
 * P6 W6.2 [P6-C80, design:435]: this is now a THIN caller of
 * `services/entityService.ts#amendWorkflowDefinition` — the pre-transaction guards, the audit +
 * amendment-record update, and (critically) the CAS-span WRAPPING all live in the service now. This
 * function supplies only `AmendPort`: `prepareAmendment` carries the heavy CAS interior (reread,
 * reparse, patch, durable route, rollback) verbatim, and the span-opening port field is bound to
 * `runOpsTransaction` (`control/launch.ts`) — this file never imports the real span function by name.
 */
async function amendDefinition(ctx: SurfaceContext, sub: string, scanned: ScannedDef, spec: DefinitionAmendmentSpec): Promise<LaunchOutcome> {
  const durableRoot = ctx.durableRepoRoot;
  let durableWorktreeReady = !!durableRoot;
  if (durableWorktreeReady) {
    try { if (realpathSync(resolve(ctx.repoRoot)) === realpathSync(resolve(durableRoot!))) durableWorktreeReady = false; }
    catch { durableWorktreeReady = false; }
  }
  const amendPort: AmendPort = {
    durableWorktreeReady,
    runCasTransaction: runOpsTransaction,
    async prepareAmendment(): Promise<AmendPrepared> {
      const active = readCanonicalDefinitionLocation(ctx.repoRoot, scanned.entry.path);
      const durableLocation = readCanonicalDefinitionLocation(durableRoot!, scanned.entry.path);
      if (!active || !durableLocation || active.path === durableLocation.path) return { outcome: { status: 409, body: { error: 'definition-path-refused' } } };
      const activeHash = sourceHash(active.bytes);
      if (activeHash !== spec.expectedSourceHash) return { outcome: { status: 409, body: { error: 'stale-source-revision', sourceRevision: activeHash } } };
      const source = decodeUtf8(active.bytes);
      if (source === null) return { outcome: { status: 409, body: { error: 'definition-not-utf8' } } };
      const original = parseWorkflowDef(source, { knownProfiles: workflowProfileIds() });
      if (!original.ok || original.value.project !== scanned.entry.project || original.value.id !== scanned.def!.id) return { outcome: { status: 409, body: { error: 'definition-changed' } } };
      const inputProblem = spec.validateInput?.(original.value);
      if (inputProblem) return { outcome: { status: 409, body: { error: 'governance-owner-refused', detail: inputProblem } } };
      const patched = spec.patch(source);
      if (!patched) return { outcome: { status: 409, body: { error: spec.layoutError } } };
      if (patched.source === source) return { outcome: { status: 409, body: { error: spec.noChangeError } } };
      const proposedSourceHash = sourceHash(Buffer.from(patched.source, 'utf8'));
      // A retry is the same operation only when the normalized edit reproduces the exact proposal
      // already waiting for merge. A changed body never borrows an earlier receipt.
      const pendingLookup = ctx.definitionAmendmentStore.lookup(scanned.entry.path, activeHash);
      if (!pendingLookup.ok) return { outcome: { status: 409, body: { error: 'assignment-amendment-state-invalid' } } };
      if (pendingLookup.record) {
        return pendingLookup.record.kind === spec.kind && pendingLookup.record.proposedSourceHash === proposedSourceHash
          ? { outcome: { status: 202, body: { ok: true, status: 'pending-human-merge', replayed: true, path: scanned.entry.path, baseSourceHash: activeHash, proposedSourceHash, branch: pendingLookup.record.branch, pr: pendingLookup.record.pr } } }
          : { outcome: { status: 409, body: { error: 'assignment-amendment-pending', pending: pendingLookup.record } } };
      }
      if (!active.bytes.equals(durableLocation.bytes)) return { outcome: { status: 409, body: { error: 'durable-base-mismatch' } } };
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
      const pending: PendingDefinitionAmendment = { kind: spec.kind, workflowPath: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash, branch: DEFAULT_WORK_BRANCH, pr: {}, phase: 'prepared' };
      try { ctx.definitionAmendmentStore.put(pending); }
      catch (error) { return { outcome: { status: 500, body: { error: 'assignment-amendment-state-write-failed', detail: error instanceof Error ? error.message : String(error) } } }; }
      try { writeFileSync(durableLocation.path, patched.source, 'utf8'); }
      catch (error) { return { outcome: { status: 500, body: { ok: false, status: 'recovery-required', stateStatus: 'prepared', error: `${spec.kind}-durable-write-failed`, path: scanned.entry.path, baseSourceHash: spec.expectedSourceHash, proposedSourceHash, branch: DEFAULT_WORK_BRANCH, detail: error instanceof Error ? error.message : String(error) } } }; }
      try {
        // P4 §3.2: the one durable publisher consumes a manifest, not a bare relpath. The amendment
        // keeps its existing request idempotency key (prefixed by purpose) and pins the base commit of
        // the durable worktree it just wrote into. The CAS span is reentrant; `routeDurable` joins the
        // SAME span the service opened via the port's span-opening field. A workflow amendment always
        // publishes through a PR.
        const receipt = await runOpsTransaction(async () => routeDurable(
          durableRoot!,
          buildWorkflowAmendmentManifest({
            operationKey: `${scanned.entry.path}:${proposedSourceHash}`,
            baseCommit: await resolveBaseCommit(durableRoot!, ctx.saveGit ?? defaultGitRunner),
            relpaths: [scanned.entry.path],
          }),
          { runGit: ctx.saveGit, openPr: ctx.openPr, message: spec.routeMessage },
        ));
        if (receipt.mode !== 'pr') throw new Error('workflow amendment must publish through a PR');
        // W6.1 widened `AsyncPrResult`/`receipt.pr` to the pinned `{owner,repo,number,url}`, but the
        // amendment record stores (and the launch outcome exposes) only the display pair `{url,number}`
        // — and `amendmentStore.validate` REJECTS any extra `pr` key. Project down to that pair before
        // it reaches the store, so a fully-pinned receipt does not trip the state write.
        const durable = { branch: receipt.branch, pr: { url: receipt.pr.url, number: receipt.pr.number } };
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
    },
    async auditAmendment(event) {
      await auditFn(ctx)(ctx.repoRoot, event, { runGit: ctx.opsGit, now: ctx.now });
    },
    updateAmendmentRecord(record) {
      ctx.definitionAmendmentStore.update(record as unknown as PendingDefinitionAmendment);
    },
  };
  return amendWorkflowDefinition(
    amendPort, sub, { entry: scanned.entry as unknown as { path: string; sourceHash: string; detail?: unknown }, def: scanned.def },
    {
      kind: spec.kind, expectedSourceHash: spec.expectedSourceHash, auditAction: spec.auditAction,
      auditDetail: spec.auditDetail, successDetail: spec.successDetail,
    },
  );
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

function sameWorkflowOwner(left: RunnableRef, right: RunnableRef): boolean {
  return left.type === 'workflow' && right.type === 'workflow'
    && left.id === right.id && left.project === right.project && left.sourcePath === right.sourcePath;
}

function projectableRun(run: RunMetadata, events: ProjectableRun['events'] = []): ProjectableRun {
  return {
    runRef: run.runRef, title: run.title, owner: run.owner, lifecycle: runLifecycleKind(run.lifecycle),
    createdAt: run.createdAt, updatedAt: run.updatedAt, terminalOutcome: run.terminalOutcome,
    completedAt: run.completedAt, archivedFrom: run.archivedFrom,
    openHumanRequestCount: run.openHumanRequestCount, events,
  };
}

function projectableWorkflowRun(ctx: SurfaceContext, run: RunMetadata): ProjectableRun {
  const page = ctx.controlStore.listEvents(run.ownerSubject, run.runRef, 0, 250);
  return projectableRun(run, page.ok ? page.value : []);
}

function relativeRunTime(iso: string, now: Date): string {
  const minutes = Math.floor(Math.max(0, now.getTime() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function latestWorkflowOutcome(runs: readonly ProjectableRun[]): { outcome: RunOutcome; completedAt: string } | null {
  const rows = runs
    .filter((run): run is ProjectableRun & { terminalOutcome: RunOutcome; completedAt: string } => run.terminalOutcome !== null && run.completedAt !== null)
    .sort((left, right) => right.completedAt.localeCompare(left.completedAt) || left.runRef.localeCompare(right.runRef));
  return rows[0] ? { outcome: rows[0].terminalOutcome, completedAt: rows[0].completedAt } : null;
}

function workflowAttention(ctx: SurfaceContext, runs: readonly RunMetadata[]): AttentionEnvelope {
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

function workflowProjectionInput(ctx: SurfaceContext, scanned: ScannedDef, allRuns: readonly RunMetadata[], attention: AttentionEnvelope, now: Date): EntityGroupProjectionInput {
  const ref: RunnableRef = {
    type: 'workflow', id: scanned.entry.ref, project: scanned.entry.project,
    sourcePath: scanned.entry.path as `orgs/${string}/workflows/${string}.md`,
  };
  const owned = allRuns.filter((run) => sameWorkflowOwner(run.owner, ref));
  const runs = owned.map((run) => projectableWorkflowRun(ctx, run));
  const activity = runs.map((run) => projectRunActivity(run, now.toISOString()));
  const activeRuns = activity.filter((item) => item.category === 'active' || item.category === 'attention').map((item) => item.row);
  const latest = latestWorkflowOutcome(runs);
  const hostRun = selectEntityHostRun(owned, new Set(activeRuns.map((run) => run.runRef)));
  return {
    ref, projects: [scanned.entry.project], modelLabel: 'varies',
    temporalLabel: latest ? `ran ${relativeRunTime(latest.completedAt, now)} \u00b7 ${latest.outcome}` : projectLiveEmpty(null, nextScheduleOccurrence(ctx.controlStore, ref)?.nextAt ?? null),
    // P6 W6.2 [P6-C39, P6-C55, design:159,410]: the never-run entity chip projects the PLACEMENT decision
    // when at least one advertisement is fresh, falling back to self-identity only when none is.
    host: hostRun?.executionHost ?? projectNeverRunHost(
      scanned.def ? workflowCapabilityRequirement(ctx, scanned.def) : EMPTY_CAPABILITY_REQUIREMENT,
      ctx.controlStore.listHostAdvertisements(),
      now.getTime(),
      ctx.runtimeCapabilities,
    ).hostId,
    activeRuns,
    gatedRunCount: attention.workflows[`workflow:${ref.project}:${ref.id}`] ?? 0,
    latestRun: latest?.outcome ?? null, nextSchedule: nextScheduleOccurrence(ctx.controlStore, ref),
    hasFailure: runs.some((run) => run.lifecycle === 'interrupted'),
  };
}

function workflowRevision(ctx: SurfaceContext, scanned: readonly ScannedDef[]): string {
  return sha256Hex(JSON.stringify({
    documentRevision: ctx.controlStore.getControlDocumentMetadata().documentRevision,
    scheduleCollectionRevision: ctx.controlStore.getScheduleSnapshot().collectionRevision,
    definitions: scanned.map((item) => [item.entry.ref, item.entry.sourceHash]),
  }));
}

function workflowList(ctx: SurfaceContext): EntityList {
  const scanned = scanWorkflowDefs(ctx.repoRoot).filter((item) => item.def !== null);
  const runs = ctx.controlStore.listRuns('operator', 'all-subjects');
  const now = ctx.now?.() ?? new Date();
  const attention = workflowAttention(ctx, runs);
  return projectEntityList(workflowRevision(ctx, scanned), 'workflow', scanned.map((item) => workflowProjectionInput(ctx, item, runs, attention, now)));
}

function workflowDetail(ctx: SurfaceContext, scanned: ScannedDef & { def: WorkflowDef }): EntityDetail {
  const runs = ctx.controlStore.listRuns('operator', 'all-subjects');
  const now = ctx.now?.() ?? new Date();
  const input = workflowProjectionInput(ctx, scanned, runs, workflowAttention(ctx, runs), now);
  const summary = projectEntitySummary(input);
  const recentRuns: RunRow[] = runs.filter((run) => sameWorkflowOwner(run.owner, input.ref))
    .map((run) => projectableWorkflowRun(ctx, run)).map((run) => projectRunActivity(run, now.toISOString()).row);
  const roots = { [scanned.entry.project]: `orgs/${scanned.entry.project}` };
  const events = runs.filter((run) => sameWorkflowOwner(run.owner, input.ref)).flatMap((run) => {
    const page = ctx.controlStore.listEvents(run.ownerSubject, run.runRef, 0, 250);
    return page.ok ? page.value : [];
  });
  const selectedRun = [...runs].filter((run) => sameWorkflowOwner(run.owner, input.ref))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || left.runRef.localeCompare(right.runRef))[0];
  const storedRun = selectedRun ? ctx.controlStore.getRun(selectedRun.ownerSubject, selectedRun.runRef, 'all-subjects') : null;
  const selectedEvents = selectedRun ? ctx.controlStore.listEvents(selectedRun.ownerSubject, selectedRun.runRef, 0, 250) : null;
  const runGraph = storedRun?.ok ? {
    runRef: storedRun.value.run.runRef,
    stages: storedRun.value.stages.map((stage) => ({ stageRef: stage.stageRef, stageId: stage.stageId, title: stage.title, dependsOn: [...stage.dependsOn], state: stage.state })),
    attempts: storedRun.value.attempts.map((attempt) => ({ attemptRef: attempt.attemptRef, stageRef: attempt.stageRef, state: attempt.state })),
    events: selectedEvents?.ok ? selectedEvents.value.map((event) => ({ cursor: event.cursor, stageRef: event.stageRef, kind: event.kind, summary: event.summary, createdAt: event.createdAt })) : [],
  } : null;
  const outputs = new Map<string, OutputRef>();
  for (const artifact of scanned.def.stages.flatMap((stage) => stage.artifacts ?? [])) {
    const output = projectOutputRef({ kind: 'artifact', label: artifact.description, rootId: scanned.entry.project, path: artifact.path }, roots);
    if (output.kind !== 'external-pr') outputs.set(output.path, output);
  }
  for (const output of projectEventOutputRefs(events, roots)) if (output.kind !== 'external-pr') outputs.set(output.path, output);
  return {
    revision: workflowRevision(ctx, [scanned]), summary,
    brief: projectEntityBrief({
      purpose: scanned.def.purpose ?? scanned.def.description.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '') ?? scanned.def.title,
      doingNow: summary.activeRuns[0]?.title ?? 'Idle.', recentRuns, outputs: [...outputs.values()],
      pendingGates: summary.gatedRunCount, schedule: summary.nextSchedule, autonomyTier: scanned.entry.riskTier ?? 'Not declared',
    }),
    details: {
      sourcePath: input.ref.sourcePath, sourceRevision: scanned.entry.sourceHash ?? '', tools: [],
      declaredCeiling: scanned.entry.riskTier ?? 'Not declared', replaces: [], buildsOn: [],
      knowledgeSources: [...scanned.def.readScope], skills: [], schemas: ['workflow-definition/v1'], lineage: [], grades: [], ids: [scanned.def.id],
      workflow: {
        stepDag: (() => {
          const dag = projectStepDag({
            stages: runGraph ? runGraph.stages.map((stage) => ({ stageRef: stage.stageRef, label: stage.title, dependsOn: stage.dependsOn.flatMap((stageId) => {
              const ref = runGraph.stages.find((candidate) => candidate.stageId === stageId)?.stageRef;
              return ref ? [ref] : [];
            }) })) : scanned.def.stages.map((stage) => ({ stageRef: stage.id, label: stage.title, dependsOn: [...stage.dependsOn] })),
            events: runGraph?.events ?? [],
          });
          return { nodes: dag.nodes, edges: dag.edges };
        })(),
        parameters: [...(scanned.def.parameters ?? [])],
        runGraph,
      },
      builder: (() => {
        const catalog = workflowBuilderCatalog(ctx);
        const profile = loadWorkflowProfiles().find((item) => item.id === scanned.def.profile);
        return {
          models: [...catalog.models], profiles: [...catalog.profiles], tools: [...catalog.tools], skills: [...catalog.skills], connectors: [...catalog.connectors], filesystemRoots: Object.keys(catalog.filesystemRoots).sort(), projects: [...catalog.projects],
          value: { humanName: summary.humanName, purpose: scanned.def.purpose ?? scanned.def.description, model: scanned.def.model ?? catalog.models[0] ?? '', profile: scanned.def.profile, tools: [...(scanned.def.tools ?? profile?.allowedTools ?? [])], skills: [...(scanned.def.skills ?? [])], connectors: (scanned.def.connectors ?? []).map((grant) => ({ server: grant.server, tools: [...grant.tools] })), filesystemRoots: [...(scanned.def.filesystemRoots ?? [scanned.entry.project])] },
        };
      })(),
    },
  };
}

class WorkflowBuilderFailure extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function workflowBuilderCatalog(ctx: SurfaceContext): EntityBuilderCatalog {
  const declarations = [...readDeclaredAgentDetails(ctx.repoRoot).values()];
  const executionProfiles = loadExecutionProfiles(ctx.repoRoot);
  const workflowProfiles = loadWorkflowProfiles();
  const projects = readdirSync(join(ctx.repoRoot, ORGS_DIR), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  return {
    models: [...new Set(executionProfiles.map((profile) => profile.model))].sort(),
    profiles: workflowProfiles.map((profile) => profile.id).sort(),
    tools: [...new Set(workflowProfiles.flatMap((profile) => profile.allowedTools))].sort(),
    skills: [...new Set(declarations.flatMap((item) => item.skills ?? []))].sort(),
    connectors: [...new Map(declarations.flatMap((item) => item.connectors ?? []).map((connector) => [connector.server, { server: connector.server, tools: [...connector.tools] }])).values()].sort((left, right) => left.server.localeCompare(right.server)),
    filesystemRoots: Object.fromEntries(projects.map((project) => [project, `orgs/${project}`])),
    projects,
  };
}

function workflowBuilderPort(ctx: SurfaceContext): EntityBuilderPort {
  return {
    async save(input) {
      if (!ctx.durableRepoRoot) throw new WorkflowBuilderFailure(409, 'durable-worktree-required');
      const activePath = join(ctx.repoRoot, ...input.sourcePath.split('/'));
      const exists = existsSync(activePath);
      let content: string;
      if (exists) {
        const source = readFileSync(activePath, 'utf8');
        const revision = sourceHash(Buffer.from(source, 'utf8'));
        if (revision !== input.expectedSourceRevision) throw new WorkflowBuilderFailure(409, 'stale-source-revision');
        const patched = patchEntityBuilderSource('workflow', source, input.request);
        if (!patched) throw new WorkflowBuilderFailure(409, 'workflow-layout-unsupported');
        content = patched;
      } else {
        if (input.expectedSourceRevision !== workflowList(ctx).revision) throw new WorkflowBuilderFailure(409, 'stale-collection-revision');
        content = renderWorkflowBuilderSource(input.ref.id, input.request);
      }
      const parsed = parseWorkflowDef(content, { knownProfiles: workflowProfileIds() });
      if (!parsed.ok || parsed.value.id !== input.ref.id || parsed.value.project !== input.request.project) throw new WorkflowBuilderFailure(400, 'invalid-workflow-builder-result');
      const proposedSourceHash = sourceHash(Buffer.from(content, 'utf8'));
      return runBuilderAmendment(ctx.definitionAmendmentStore, {
        kind: exists ? 'workflow-builder-edit' : 'workflow-builder-create', entityPath: input.sourcePath,
        idempotencyKey: input.idempotencyKey, baseSourceHash: input.expectedSourceRevision, proposedSourceHash,
        request: input.request,
        effect: async () => {
          const outcome = await governedSave({ repoRoot: ctx.durableRepoRoot!, relpath: input.sourcePath, content, sessionToken: input.sessionToken, sessionConfig: ctx.sessionConfig, runGit: ctx.saveGit, openPr: ctx.openPr, runPreamble: ctx.runPreamble, publication: ctx.coordinationPublication, outboxRoot: ctx.outboxRoot, message: `chore(workflow): ${exists ? 'edit' : 'create'} ${input.ref.id}` });
          if (!outcome.ok) throw new WorkflowBuilderFailure(outcome.status, outcome.reason);
          await auditFn(ctx)(ctx.repoRoot, { action: 'entity-builder-amend', owner: 'operator', target: input.sourcePath, riskTier: 'T2', result: 'pending-human-merge', detail: { kind: exists ? 'workflow-builder-edit' : 'workflow-builder-create', oldSourceHash: input.expectedSourceRevision, newSourceHash: proposedSourceHash } }, { runGit: ctx.opsGit, now: ctx.now });
        },
      });
    },
  };
}

/**
 * P6 W6.2 [design:633]: the ONE `LaunchServicePort` binding for a workflow one-step launch — used by
 * `POST /api/workflows/:id/launch` below, and exported so `POST /api/v1/runs` (`api/v1/routes.ts`, wired
 * through `ctx.v1.launchPort`) can be bound to the IDENTICAL port. Two URLs, one launch implementation:
 * this is what makes an old-route launch and a v1 launch of the same owner produce byte-identical
 * `Run.owner`/`executionHost`/`terminalOutcome`/`completedAt`/`archivedFrom` rows.
 */
export function createWorkflowLaunchServicePort(ctx: SurfaceContext): LaunchServicePort {
  const repoRoot = ctx.repoRoot;
  return {
    admission: (kind) => ctx.admission(kind),
    findScannedDef: (scanId) => (findScannedDef(repoRoot, scanId) ?? null) as unknown as import('../services/launchService.ts').LaunchScannedDef | null,
    pendingAmendmentFor: (entry) => pendingAmendmentFor(ctx, entry as unknown as WorkflowDefRecord),
    lookupAmendment: (path, hash) => ctx.definitionAmendmentStore.lookup(path, hash),
    readCanonicalDefinition: (path) => readCanonicalDefinitionLocation(ctx.repoRoot, path),
    sourceHash: (bytes) => sourceHash(bytes),
    decodeUtf8: (bytes) => decodeUtf8(bytes),
    parseWorkflowDef: (text) => parseWorkflowDef(text, { knownProfiles: workflowProfileIds() }),
    instantiateWorkflowDef: (def, parameters) => instantiateWorkflowDef(def, parameters),
    composerGet: (composerSubject, composerRef) =>
      ctx.composerStore.get(composerSubject, composerRef) as unknown as import('../services/launchService.ts').LaunchComposerRead,
    declaredAgent: (id) => readDeclaredAgentDetails(ctx.repoRoot).get(id),
    // The placement lease host, resolved inside `launchDefinition` itself — this value is a harmless
    // self-identity placeholder `launchDefinition` ignores and recomputes [P6-C55].
    runtimeExecutionHost: () => runtimeExecutionHost(ctx.runtimeCapabilities),
    runCasTransaction: runOpsTransaction,
    launchDefinition: (launchSub, sessionToken, def, idempotencyKey, agentWorkspaceLaunch, identity) =>
      launchDefinition(ctx, launchSub, sessionToken, def, idempotencyKey, agentWorkspaceLaunch, identity),
  };
}

/** Register the workflow-definition registry routes + the governed one-step launch route. */
export function registerWorkflows(app: FastifyInstance, ctx: SurfaceContext): void {
  const repoRoot = ctx.repoRoot;
  const builderPort = workflowBuilderPort(ctx);
  const resolveBuilderSelector = (selector: { type: 'agent' | 'workflow'; id: string }): RunnableRef => {
    if (selector.type !== 'workflow' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(selector.id)) throw new Error('invalid-runnable-selector');
    const existing = findScannedDef(repoRoot, selector.id);
    const project = existing?.entry.project;
    if (!project) throw new Error('project-required');
    return { type: 'workflow', id: selector.id, project, sourcePath: `orgs/${project}/workflows/${selector.id}.md` };
  };

  const entityListPort: EntityListPort = { list: () => workflowList(ctx) as unknown as Revisioned };
  const workflowDetailPort: WorkflowDetailPort = {
    findScannedDef: (id) => findScannedDef(repoRoot, id) ?? null,
    detail: (scanned) => workflowDetail(ctx, scanned as ScannedDef & { def: WorkflowDef }) as unknown as Revisioned,
  };
  app.get('/api/workflows', async (req, reply) =>
    sendServiceReply(reply, readEntityList(entityListPort, req.headers['if-none-match'] as string | undefined)));
  // Profiles are server-owned execution policy. Clients must read them rather than infer a default.
  app.get('/api/workflows/profiles', async () => ({ profiles: [...workflowProfileIds()].sort() }));

  app.get('/api/workflows/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    return sendServiceReply(reply, readWorkflowDetail(workflowDetailPort, id, req.headers['if-none-match'] as string | undefined));
  });

  // Governed WRITE: its own origin → rate-limit → session child scope (mirrors the PTY route in index.ts;
  // surface.ts is intentionally not edited).
  app.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: ctx.allowedOrigins });
    scope.addHook('onRequest', writeRateLimitHook(ctx.rateGuard));
    const preHandler = requireSession(ctx.sessionConfig);
    scope.post('/api/workflows', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
      const submit: SubmitBuilderPort = (args) => {
        const resolveCreate = (candidate: { type: 'agent' | 'workflow'; id: string }): RunnableRef => {
          if (candidate.type !== 'workflow' || candidate.id !== args.selector.id || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(candidate.id)) throw new Error('invalid-runnable-selector');
          return { type: 'workflow', id: candidate.id, project: args.project, sourcePath: `orgs/${args.project}/workflows/${candidate.id}.md` };
        };
        return submitEntityBuilder(
          { ...args, sessionToken: verifiedSession(req)?.token },
          { resolve: resolveCreate, catalog: workflowBuilderCatalog(ctx), port: builderPort },
        );
      };
      return sendServiceReply(reply, await createWorkflowEntity(submit, req.body, (id) => !!findScannedDef(repoRoot, id)));
    });
    // P6 W6.2 [P6-C80, design:435]: THIN caller of `services/launchService.ts` — every gate (admission,
    // closed body validation, client idempotency, expected source-hash, pending-amendment, the
    // transactional reread/reparse/instantiate, Composer/project binding) lives in the service now; this
    // handler only binds the injected ports to the real route context. No byte of the request/response
    // contract changed, and the port's span-opening field is bound to `runOpsTransaction`
    // (`control/launch.ts`) — this file never imports the real transaction span function by name.
    scope.post('/api/workflows/:id/launch', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
      const { id } = req.params as { id: string };
      const outcome = await launchService(createWorkflowLaunchServicePort(ctx), {
        subject: subject(req), sessionToken: verifiedSession(req)?.token, id, body: req.body,
      });
      return reply.code(outcome.status).send(outcome.body);
    });
    scope.put('/api/workflows/:id', { preHandler }, async (req: FastifyRequest, reply: FastifyReply) => {
      const sub = subject(req);
      if (!sub) return reply.code(401).send({ error: 'unauthenticated' });
      const admission = ctx.admission('new-work');
      if (!admission.ok) return reply.code(admission.status).send({ error: admission.reason });
      const { id } = req.params as { id: string };
      const scanned = findScannedDef(repoRoot, id);
      if (!scanned) return reply.code(404).send({ error: 'not-found' });
      const assignment = parseAmendmentBody(req.body);
      const governance = parseGovernanceAmendmentBody(req.body);
      if (assignment || governance) {
        const result = assignment
          ? await amendAssignment(ctx, sub, scanned, assignment)
          : await amendGovernance(ctx, sub, scanned, governance!);
        return reply.code(result.status).send(result.body);
      }
      const submit: SubmitBuilderPort = (args) => submitEntityBuilder(
        { ...args, sessionToken: verifiedSession(req)?.token },
        { resolve: resolveBuilderSelector, catalog: workflowBuilderCatalog(ctx), port: builderPort },
      );
      return sendServiceReply(reply, await updateWorkflowBuilderEntity(submit, scanned, id, req.body));
    });
  });
}

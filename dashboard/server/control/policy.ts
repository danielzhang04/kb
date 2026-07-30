import { createHash } from 'node:crypto';

export type PolicyDisposition = 'allow' | 'waiting-human' | 'refuse';

export interface ExecutionProfile {
  id: string;
  role: 'manager' | 'worker';
  runtime: 'claude' | 'codex';
  model: string;
  capabilities: readonly ('read' | 'write-approved-scope' | 'run-approved-commands' | 'emit-events')[];
}

export interface ApprovedScope {
  read: string[];
  write: string[];
}

/**
 * Project a stage's capability scope into the scope used only for target-policy classification.
 * Read-only stages must still prove that their target is inside approved readable territory, while
 * the worker continues to receive the original empty write scope.
 */
export function policyScopeForStage(scope: ApprovedScope, readOnly: boolean): ApprovedScope {
  return readOnly ? { read: [...scope.read], write: [...scope.read] } : scope;
}

/**
 * Whether the stage under evaluation carries a DECLARED, server-compiled spend-authorization gate,
 * and whether that gate has actually been approved by a human.
 *
 * - `none` (the default whenever the field is absent) — no declared gate. Spend is the pre-existing
 *   non-overridable refusal. Every caller that does not opt in keeps today's exact behaviour.
 * - `pending` — a gate is declared but not yet approved. The stage waits for a human; it is
 *   approvable, not refused. This is the ONLY thing this type adds to the refusal posture.
 * - `approved` — the gate's own approval is recorded. The stage's spend is authorized.
 *
 * The value is computed by the engine from immutable compiled proposal content plus the run's
 * resolved human requests, per stage and per gate id. It is never read from prose, from a proposal
 * field a stage can set about ITSELF at runtime, or from browser input; and an approval recorded
 * against any other gate or any other stage can never produce `approved` here.
 */
export type SpendAuthorizationState = 'none' | 'pending' | 'approved';

/**
 * Whether the stage under evaluation carries a DECLARED, server-compiled content-bound approval gate for
 * its own T3 / external-publication action, and whether that gate has been approved by a human.
 *
 * Same three states and the same guarantees as {@link SpendAuthorizationState} (stage-scoped, gate-scoped,
 * approval-kind-only), applied to the OTHER approvable boundary this control plane has: a T3 action.
 *
 * - `none` (the default whenever absent) — no declared gate. `requestsPublication` and `riskTier: 'T3'`
 *   behave exactly as before: a permanent `waiting-human` that no approval releases, because nothing tells
 *   the server WHICH human decision was supposed to authorize this content.
 * - `pending` — declared but unapproved: still `waiting-human`, now with a reason that names the gate.
 * - `approved` — the gate's own approval is recorded against this stage, so the T3 content-bound approval
 *   the policy has always demanded actually exists and the stage clears.
 *
 * This is not a widening: a stage with no declared publication gate is refused/parked byte-for-byte as
 * before, and a declared gate only ADDS a blocking boundary in front of its own stage. The gate's prompt
 * is human-authored in the committed workflow definition, and the engine puts the stage's full work order
 * in the boundary it creates, so the approver sees exactly the prose they are authorizing.
 */
export type PublicationAuthorizationState = 'none' | 'pending' | 'approved';

export interface PolicyRequest {
  project: string;
  riskTier: 'T1' | 'T2' | 'T3';
  role: 'manager' | 'worker';
  runtime: 'claude' | 'codex';
  model: string;
  target: string;
  requiredSkills: string[];
  scope: ApprovedScope;
  governanceRefs: string[];
  proposalHash: string;
  approvedHash: string | null;
  requestsPublication?: boolean;
  requestsSpending?: boolean;
  requestsCredentials?: boolean;
  /** Defaults to `'none'` when absent — undeclared spend stays a hard refuse. */
  spendAuthorization?: SpendAuthorizationState;
  /** Defaults to `'none'` when absent — an undeclared T3/publication stage stays a permanent wait. */
  publicationAuthorization?: PublicationAuthorizationState;
}

export interface PolicyEnvironment {
  profiles: ExecutionProfile[];
  curatedSkills: Set<string>;
  contractText: string;
  governanceContents: Record<string, string>;
}

export interface PolicyDecision {
  disposition: PolicyDisposition;
  reason: string;
  profile: ExecutionProfile | null;
  policyHash: string;
}

const SAFE_PROJECT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const REQUIRED_GLOBAL_REFS = ['CLAUDE.md', 'governance/agent-rules.md', 'governance/risk-tiers.md'];
const HUMAN_OWNED_PREFIXES = ['governance/', 'CLAUDE.md'];

function normalizedPath(value: string): string | null {
  if (!value || value.includes('\0') || value.includes('\\')) return null;
  if (/^[A-Za-z]:\//.test(value) || value.startsWith('/') || value.startsWith('~')) return null;
  const parts = value.split('/');
  if (parts.some((part) => part === '' || part === '.' || part === '..')) return null;
  return parts.join('/');
}

function within(path: string, prefixes: string[]): boolean {
  return prefixes.some((candidate) => {
    const prefix = normalizedPath(candidate.replace(/\/$/, ''));
    return prefix !== null && (path === prefix || path.startsWith(`${prefix}/`));
  });
}

function policyDigest(request: PolicyRequest, environment: PolicyEnvironment): string {
  const referenced = [...new Set(request.governanceRefs)].sort().map((ref) => [ref, environment.governanceContents[ref] ?? null]);
  return createHash('sha256').update(JSON.stringify({
    contractText: environment.contractText,
    profiles: environment.profiles,
    referenced,
    scope: request.scope,
  })).digest('hex');
}

export type ActionRiskClassification =
  | { disposition: 'allowed'; minimumTier: 'T1' | 'T2' | 'T3' }
  | { disposition: 'forbidden'; reason: string };

/**
 * Closed server-owned action namespace registry shared by proposal compilation and execution.
 * Adding a namespace is a code-reviewed capability change; proposal prose and browser input cannot
 * widen this table.
 */
const ALLOWED_ACTION_TIERS = new Map<string, 'T1' | 'T2' | 'T3'>([
  ['wiki', 'T1'],
  ['report', 'T1'],
  ['draft', 'T2'],
  ['build', 'T2'],
  ['code', 'T2'],
  ['implement', 'T2'],
  ['refactor', 'T2'],
  ['fix', 'T2'],
  ['research', 'T2'],
  ['test', 'T2'],
  ['verify', 'T2'],
  ['review', 'T2'],
  ['deploy', 'T3'],
  ['publish', 'T3'],
  ['publication', 'T3'],
  ['merge', 'T3'],
  ['release', 'T3'],
  ['purge', 'T3'],
]);

const FORBIDDEN_ACTION_NAMESPACES = new Set([
  'credential', 'credentials', 'secret', 'secrets', 'spend', 'purchase', 'payment', 'money',
]);

/** Closed action-namespace classification. Prose can never lower these server-owned floors. */
export function classifyActionRisk(action: string): ActionRiskClassification {
  const namespace = action.trim().toLowerCase().split(':', 1)[0];
  if (FORBIDDEN_ACTION_NAMESPACES.has(namespace)) {
    return { disposition: 'forbidden', reason: 't4-capability-forbidden' };
  }
  const minimumTier = ALLOWED_ACTION_TIERS.get(namespace);
  return minimumTier
    ? { disposition: 'allowed', minimumTier }
    : { disposition: 'forbidden', reason: 'action-not-in-server-owned-registry' };
}

/**
 * Fail-closed executable boundary for an approved proposal stage. Human-authored prose is retained in
 * the policy hash, but only rules represented below can authorize execution; ambiguous or missing
 * references become a durable human wait instead of being guessed from prose.
 */
export function evaluateExecutionPolicy(request: PolicyRequest, environment: PolicyEnvironment): PolicyDecision {
  const policyHash = policyDigest(request, environment);
  const decide = (disposition: PolicyDisposition, reason: string, profile: ExecutionProfile | null = null): PolicyDecision =>
    ({ disposition, reason, profile, policyHash });

  if (!SAFE_PROJECT.test(request.project)) return decide('refuse', 'invalid-project');
  const target = normalizedPath(request.target);
  if (!target) return decide('refuse', 'unsafe-target');
  if (HUMAN_OWNED_PREFIXES.some((prefix) => target === prefix.replace(/\/$/, '') || target.startsWith(prefix))) {
    return decide('refuse', 'human-owned-governance-target');
  }
  if (request.requestsCredentials) return decide('refuse', 'credentials-as-objects-forbidden');
  if (request.requestsSpending) {
    // Fail-closed by construction: only the explicit `'approved'` state falls through, and only
    // `'pending'` softens to a wait. Absent, malformed, or `'none'` all land on the original refuse,
    // so a stage that never declared a spend gate is refused exactly as before.
    switch (request.spendAuthorization) {
      case 'approved':
        break;
      case 'pending':
        return decide('waiting-human', 'declared-spend-gate-awaiting-human-authorization');
      default:
        return decide('refuse', 'real-spending-forbidden');
    }
  }
  if (request.requestsPublication) {
    // Fail-closed by construction, exactly like the spend branch above: only the explicit `'approved'`
    // state falls through. Absent / malformed / `'none'` all land on the original permanent wait.
    switch (request.publicationAuthorization) {
      case 'approved':
        break;
      case 'pending':
        return decide('waiting-human', 'declared-publication-gate-awaiting-human-authorization');
      default:
        return decide('waiting-human', 'external-publication-requires-t3-approval');
    }
  }

  const requiredRefs = [...REQUIRED_GLOBAL_REFS, `orgs/${request.project}/contract.md`];
  if (requiredRefs.some((ref) => !request.governanceRefs.includes(ref) || typeof environment.governanceContents[ref] !== 'string')) {
    return decide('waiting-human', 'missing-executable-governance-reference');
  }
  if (!environment.contractText.trim()) return decide('waiting-human', 'project-contract-unavailable');
  // A T3 stage demands a content-bound human approval. The ONLY thing that can satisfy it is that stage's
  // own declared, recorded publication-gate approval; every other T3 stage still parks here as before.
  if (request.riskTier === 'T3' && request.publicationAuthorization !== 'approved') {
    return decide('waiting-human', 't3-content-bound-approval-required');
  }
  if (!request.approvedHash || request.approvedHash !== request.proposalHash) {
    return decide('waiting-human', 'proposal-revision-not-approved');
  }
  if (!within(target, request.scope.write)) return decide('waiting-human', 'target-outside-approved-write-scope');
  const unknownSkill = request.requiredSkills.find((skill) => !environment.curatedSkills.has(skill));
  if (unknownSkill) return decide('refuse', `skill-not-curated:${unknownSkill}`);

  const profile = environment.profiles.find((candidate) =>
    candidate.role === request.role && candidate.runtime === request.runtime && candidate.model === request.model,
  ) ?? null;
  if (!profile) return decide('refuse', 'runtime-model-profile-not-allowed');
  return decide('allow', 'inside-approved-envelope', profile);
}

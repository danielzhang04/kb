/**
 * The governing `publish`/`spend` tag set for a run, DERIVED ONCE AT LAUNCH from the runnable that owns
 * it (spec §4.4/§4.5).
 *
 * WHY THIS EXISTS AS ITS OWN MODULE (security review 2026-09-16, BLOCKER-1): the first implementation
 * re-scanned the workflow definition from disk at gate-RESOLVE time. `POST /api/write/save` is an
 * `open`-class route that writes into the very tree the scanner reads, so the tag set that decides
 * whether a gate resolution needs a signed approval was a property of the file NOW, not of the run that
 * was launched: launch a publish-tagged workflow, `save` the definition without its publish marker,
 * resolve the gate unsigned, and the audit row affirmatively recorded `workflowTags: []`. Deriving the
 * set at LAUNCH and persisting it on the run record removes the rewrite window entirely — after launch
 * there is no disk read left to poison.
 *
 * This module is a LEAF on purpose: it imports only the pure `effectiveWorkflowTags` derivation and
 * types, and takes the scanned definitions / declared agents as INPUTS. `control/launch.ts` (the one
 * canonical launch body) is imported by `workflows/routes.ts`, which owns the scanner — so launch.ts
 * cannot import the scanner back without a cycle. The composition root (`http/surface.ts`) binds the
 * two together and hands the result down as `SurfaceContext#ownerTags`.
 */
import { effectiveWorkflowTags, type WorkflowDef } from '../workflows/defs.ts';
import type { RunnableRef } from './p2Contracts.ts';

/**
 * The maximal tag set — every escalation on. Stored (and returned) whenever the owning runnable cannot
 * be pinned to exactly one valid declaration at launch, and applied by the resolve rule to any run
 * persisted BEFORE this field existed. Fail closed is the only safe direction here: an un-derivable
 * owner must cost a signature, never silently exempt a publish gate.
 */
export const FAIL_CLOSED_RUN_TAGS: readonly string[] = Object.freeze(['publish', 'spend']);

/** The subset of a scanned workflow definition this derivation needs; see `workflows/routes.ts#ScannedDef`. */
export interface ScannedWorkflowDefLike {
  entry: { path: string; valid: boolean };
  def: WorkflowDef | null;
}

/** The subset of a declared agent this derivation needs; see `agents/roster.ts#DeclaredAgentDetail`. */
export interface DeclaredAgentLike {
  id: string;
  source: string;
  /** Nullable/absent exactly as `DeclaredAgentDetail` has them — a declaration may omit every list. */
  tools?: readonly string[] | null;
  skills?: readonly string[] | null;
  defaultProfile?: string | null;
  allowedProfiles?: readonly string[] | null;
}

export interface OwnerTagSources {
  /** All scanned workflow definitions in the repo, valid and invalid alike. */
  workflowDefs: () => readonly ScannedWorkflowDefLike[];
  /** The declared agent roster, keyed by agent id. */
  agentDeclarations: () => ReadonlyMap<string, DeclaredAgentLike>;
  /** The server-owned execution profiles, so a profile that grants a publish/send tool tags its agent. */
  profileTools?: (profileId: string) => readonly string[];
}

/**
 * Tool names that ARE an external publish/send. Deliberately the same closed list
 * `control/workflowProfiles.ts#FORBIDDEN_WORKFLOW_TOOLS` names, restated here so this leaf keeps its
 * zero control-plane imports; `ownerTags.test.ts` pins the two lists equal so they cannot drift.
 */
export const PUBLISH_CAPABLE_TOOLS: readonly string[] = Object.freeze([
  'upload_video',
  'mcp__google-workspace__send_email',
  'mcp__google-workspace__gmail_send',
  'mcp__claude_ai_Gmail__send_message',
]);

/** Tool names that spend real money on the operator's behalf. Empty today; the hook exists so a future
 *  paid tool tags its agent `spend` the same way a `spendAuthorization` gate tags a workflow. */
export const SPEND_CAPABLE_TOOLS: readonly string[] = Object.freeze([]);

function declaresAction(values: readonly string[], prefix: string): boolean {
  return values.some((value) => value.startsWith(prefix));
}

/**
 * The tags an AGENT-owned run carries.
 *
 * Security review MEDIUM-4: the predecessor returned the EMPTY set for every non-workflow owner —
 * the one arm in the whole rule that failed OPEN. An agent declaration cannot carry a
 * `publicationAuthorization`/`spendAuthorization` gate today (those fields live on `WorkflowStageDef`),
 * so the empty set was correct by accident; it stopped being correct the moment agent declarations grow
 * gates. This derives the same two signals from what an agent declaration CAN say: a declared
 * `publish:`/`spend:` action (in `tools` or `skills`), or a tool — declared directly, or granted by a
 * profile the declaration names — that publishes or spends. An agent that can do neither is untagged,
 * exactly as before; an agent that CAN is tagged and its gates escalate.
 */
export function agentOwnerTags(agent: DeclaredAgentLike, profileTools?: OwnerTagSources['profileTools']): string[] {
  const tags = new Set<string>();
  const tools = agent.tools ?? [];
  const declared = [...tools, ...(agent.skills ?? [])];
  if (declaresAction(declared, 'publish:')) tags.add('publish');
  if (declaresAction(declared, 'spend:')) tags.add('spend');
  const profiles = [agent.defaultProfile, ...(agent.allowedProfiles ?? [])]
    .filter((id): id is string => typeof id === 'string');
  const reachable = [
    ...tools,
    ...(profileTools ? profiles.flatMap((id) => profileTools(id)) : []),
  ];
  if (reachable.some((tool) => PUBLISH_CAPABLE_TOOLS.includes(tool))) tags.add('publish');
  if (reachable.some((tool) => SPEND_CAPABLE_TOOLS.includes(tool))) tags.add('spend');
  return [...tags].sort();
}

/**
 * The tag set to PERSIST on a run being launched for `owner`. Sorted and de-duplicated so the stored
 * value is stable, and {@link FAIL_CLOSED_RUN_TAGS} whenever the owner cannot be pinned to exactly one
 * valid declaration — the same fail-closed direction the resolve rule already took for a deleted or
 * newly-invalid workflow definition.
 */
export function deriveOwnerTags(owner: RunnableRef, sources: OwnerTagSources): string[] {
  if (owner.type === 'agent') {
    const agent = sources.agentDeclarations().get(owner.id);
    if (!agent || agent.source !== owner.sourcePath) return [...FAIL_CLOSED_RUN_TAGS];
    return agentOwnerTags(agent, sources.profileTools);
  }
  const definition = sources.workflowDefs().find((item) => item.def?.id === owner.id
    && item.def.project === owner.project && item.entry.path === owner.sourcePath && item.entry.valid);
  if (!definition?.def) return [...FAIL_CLOSED_RUN_TAGS];
  return [...effectiveWorkflowTags(definition.def)].sort();
}

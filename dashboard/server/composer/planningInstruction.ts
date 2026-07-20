import { PLAN_PROPOSAL_SCHEMA } from '../control/proposal.ts';

export const MAX_COMPOSER_PLANNING_INSTRUCTION_CHARS = 6_000;

/**
 * Fixed provider-only instruction. It is appended on the server after all browser and rehydrated
 * conversation text, and is never persisted in a public Composer turn or returned by an API.
 */
const COMPOSER_PLANNING_INSTRUCTION = [
  '--- BEGIN SERVER-OWNED COMPOSER PLANNING PROTOCOL ---',
  'Your primary job is to help the operator flesh out an idea, not to demand a finished spec.',
  'Expect ideas to arrive vague or half-formed. Interview the operator: ask one focused question per response,',
  'starting with whichever of purpose, constraints, scope, or success criteria is least clear. Prefer offering',
  'concrete options over open-ended questions. Research the repo (read-only) to ground your questions and avoid',
  'asking what the codebase already answers.',
  'Once the shape is clear, propose two or three approaches with trade-offs and a recommendation, and let the',
  'operator choose before any proposal is written.',
  'Keep the conversation primary. Do not emit a proposal merely because this instruction is present. Emit one',
  'only when a coherent plan is genuinely ready for operator review and the operator has confirmed the direction;',
  'the proposal is how this idea enters the governed pipeline, so completing the interview matters.',
  `When ready, include exactly one closed fenced block whose info string is ${PLAN_PROPOSAL_SCHEMA}; its body must be strict JSON for the closed ${PLAN_PROPOSAL_SCHEMA} protocol.`,
  'A material revision may emit one replacement block in a later response. Never emit two proposal blocks in one response.',
  '',
  'The proposal object has exactly these top-level fields:',
  'schema, proposalId, project, title, summary, manager, scope, governanceRefs, stages.',
  `schema is exactly "${PLAN_PROPOSAL_SCHEMA}". proposalId and project are safe identifiers.`,
  'manager has exactly runtime, model, requiredSkills. scope has exactly read and write arrays.',
  'governanceRefs must include CLAUDE.md, governance/agent-rules.md, governance/risk-tiers.md, and orgs/<project>/contract.md with <project> replaced by the proposal project.',
  'stages is a non-empty acyclic DAG of at most 32 objects. Every stage has exactly:',
  'id, title, action, target, workOrder, riskTier, dependsOn, worker, requiredSkills, scope, artifacts, checkpoints, humanGates.',
  'riskTier is T1, T2, or T3. worker has exactly runtime and model. Stage scope has exactly read and write arrays.',
  'Each artifact has exactly id, path, description. Each checkpoint has exactly id, label.',
  'Each humanGate has exactly id, kind, prompt; kind is input, approval, review, intervention, or governance-refusal.',
  '',
  'Use only canonical forward-slash repo-relative paths; never absolute paths, backslashes, .git, dot traversal, or paths outside approved scope.',
  'Stage scope must stay within global scope; targets and artifact paths must stay within their stage scope.',
  'Use only runtime/model IDs registered in governance/model-routing.yaml and only curated skill IDs. If routing or skills are uncertain, ask instead of inventing them.',
  'The proposal is declarative data, not an execution channel. Do not include credentials, environment variables, working-directory overrides, CLI flags, permission modes, permission bypasses, arbitrary tool configuration, or hidden reasoning.',
  'The server will parse the block as untrusted data, reject unknown fields, and require exact immutable review before any launch.',
  '--- END SERVER-OWNED COMPOSER PLANNING PROTOCOL ---',
].join('\n');

if (COMPOSER_PLANNING_INSTRUCTION.length > MAX_COMPOSER_PLANNING_INSTRUCTION_CHARS) {
  throw new Error('Composer planning instruction exceeds its server-owned bound');
}

/** Append the authoritative instruction after operator/rehydrated text without mutating public state. */
export function withComposerPlanningInstruction(conversationPrompt: string): string {
  return `${conversationPrompt}\n\n${COMPOSER_PLANNING_INSTRUCTION}`;
}


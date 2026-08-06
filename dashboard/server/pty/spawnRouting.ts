/**
 * Which model a SPAWNED terminal's claude should run as — the read side of the "Run agent" /
 * "Run workflow" spawn (2026-08-04).
 *
 * The defect this closes: the daemon spawned `claude` with NO flags at all, so every agent and workflow
 * terminal silently inherited the operator's personal CLI defaults (on this machine: Fable at `max`
 * effort). A terminal opened for `fyt-scriptwriter` therefore did not run as the model the Agents view
 * says that agent runs on — the UI and the process disagreed, and the process was both slower and far
 * more expensive than the roster ever claimed.
 *
 * This module answers one question and invents nothing: for an agent id, what runtime and model does the
 * ALREADY-EXISTING routing projection resolve? It reads `entry.effective` off the very same
 * `buildRoster` projection `/api/agents` serves (`indexRepo` + `buildRoster` + policy + override), so a
 * spawn can never disagree with the roster row the operator clicked. There is no fallback model table
 * here, and an agent the roster cannot resolve returns `null` rather than a guess.
 *
 * COST: one roster build (~85ms on this repo) per SPAWN — not per request. A spawn already pays for the
 * fleet preamble (a git-touching subprocess), so this is noise, and skipping a cache keeps the answer
 * exactly as fresh as the roster the operator is looking at.
 */
import { buildRoster } from '../agents/roster.ts';
import { indexRepo } from '../planeA/indexer.ts';
import { loadOverride, loadPolicy } from '../routing/policy.ts';

/** The runtime this daemon's terminals actually ARE. A spawn only stamps `--model` when the resolved
 *  runtime is this one — see {@link claudeModelArg}. */
export const CLAUDE_RUNTIME = 'claude';

/** One agent's EFFECTIVE routing, exactly as the roster projection computes it. */
export interface SpawnRouting {
  runtime: string;
  model: string;
}

/**
 * Resolve one agent id to its effective runtime+model, or null when nothing resolves. Injected in tests
 * so no test builds this checkout's real roster.
 */
export type AgentRoutingResolver = (repoRoot: string, agentId: string) => SpawnRouting | null;

/**
 * The real resolver. NEVER throws: routing is an enrichment of the spawn, not a preconditions for it, so
 * a sparse checkout or an unreadable policy file must degrade to "no `--model` flag", never to a refused
 * terminal. (The `--effort` cap is unconditional and does not depend on this.)
 */
export const resolveAgentSpawnRouting: AgentRoutingResolver = (repoRoot, agentId) => {
  if (typeof agentId !== 'string' || agentId === '') return null;
  try {
    const roster = buildRoster(indexRepo(repoRoot), repoRoot, loadPolicy(repoRoot), loadOverride(repoRoot));
    const effective = roster.find((entry) => entry.id === agentId)?.effective;
    const runtime = effective?.runtime;
    const model = effective?.model;
    if (typeof runtime !== 'string' || runtime === '') return null;
    if (typeof model !== 'string' || model === '') return null;
    return { runtime, model };
  } catch {
    return null;
  }
};

/**
 * The `--model` value to stamp on a claude spawn for a resolved routing, or null for no flag.
 *
 * THE HONESTY RULE (Daniel, 2026-08-04): a spawned terminal IS a claude process. When the roster resolves
 * an agent to a non-claude runtime (`fyt-runner` → `codex`/`gpt-5.6-sol`), stamping that runtime's model
 * string onto the claude argv would be a lie — claude would reject or silently ignore a GPT model name,
 * and the audit row would record a model that never ran. So a cross-runtime agent gets the effort cap and
 * NO model flag: the console is claude, and it says so by omission rather than by fabricating agreement.
 * An honest cross-runtime console (spawning the codex CLI for a codex-runtime agent) is a later feature,
 * not something to fake here.
 *
 * Shared by the argv builder and the audit detail so "what we passed" and "what we recorded" are computed
 * once, from one rule.
 */
export function claudeModelArg(routing: SpawnRouting | null | undefined): string | null {
  if (!routing) return null;
  return routing.runtime === CLAUDE_RUNTIME ? routing.model : null;
}

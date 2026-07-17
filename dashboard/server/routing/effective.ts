/**
 * R2.1 — the effective-routing PROJECTION: a faithful TS port of `scripts/routing.py:resolve` so the
 * dashboard displays exactly the `(runtime, model, source)` the dispatcher would route at claim time.
 *
 * The Python `routing.resolve` remains the AUTHORITATIVE resolver at dispatch; this module only DISPLAYS
 * effective routing. A shared fixture set (`effective.test.ts`, mirroring `tests/test_routing.py`'s
 * precedence suite) guards parity so the dashboard never shows a route dispatch wouldn't take.
 *
 * One-winner precedence (proposal §4), field-by-field for runtime + model independently:
 *   card frontmatter > queue/routing-override.yaml > governance/model-routing.yaml > SAFE_DEFAULT
 * Within the override file a `scope: card` entry (key == card id) outranks a `scope: agent` entry
 * (key == card owner); same scope+key -> last wins; an entry at/after its `expires` is treated as absent.
 * An unknown *named* model (not in the runtime's `known_models`) throws `RoutingError` — never a silent
 * substitution (parity with the Python fail-loud guard). Pure: no I/O, no mutation.
 */
import type { PolicyDoc, OverrideDoc, OverrideEntry, PolicyCell } from './policy.ts';

/** The hard-coded fallback reached only when the whole policy file is unreadable (proposal §4 rung 4). */
export const SAFE_DEFAULT: readonly [string, string] = ['claude', 'claude-sonnet-5'];

/** Provenance rung that supplied a resolved field. */
export type RoutingSource = 'card' | 'override' | 'policy' | 'default';

/** The single resolved routing decision with per-field provenance (mirrors Python `Routed`). */
export interface Effective {
  runtime: string;
  model: string;
  sourceRuntime: RoutingSource;
  sourceModel: RoutingSource;
}

/** Thrown when a resolved `(runtime, model)` names a model the runtime does not know (fail loud). */
export class RoutingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoutingError';
  }
}

/** The minimal card fields the resolver reads. `id`/`owner` drive override matching. */
export interface CardMetaLike {
  id?: string | null;
  owner?: string | null;
  runtime?: string | null;
  model?: string | null;
  [k: string]: unknown;
}

/** Parse an ISO-8601 timestamp; normalise trailing `Z` and treat a naive stamp as UTC. NaN on failure.
 *  Exported so the WRITE side (`write/routingOverride.ts`) canonicalizes `expires` with the SAME
 *  normalization the read side uses — the two never disagree on an entry's instant (MED-1). */
export function parseIsoMs(value: string): number {
  let text = value.trim();
  if (text.endsWith('Z')) text = `${text.slice(0, -1)}+00:00`;
  // A naive `YYYY-MM-DDTHH:MM:SS` (no offset) is treated as UTC to match Python's tz-aware comparison.
  if (/T\d{2}:\d{2}:\d{2}$/.test(text)) text = `${text}Z`;
  else if (/\+00:00$/.test(text)) text = text.replace(/\+00:00$/, 'Z');
  return Date.parse(text);
}

/** True iff the entry is at/after its `expires` (or has an unparseable `expires` -> treated as absent). */
function expired(entry: OverrideEntry, nowMs: number): boolean {
  const exp = entry.expires;
  if (!exp) return false; // null / '' / missing => no expiry
  const ms = parseIsoMs(String(exp));
  if (Number.isNaN(ms)) return true; // unparseable -> treat as absent (fail open to policy)
  return ms <= nowMs;
}

/**
 * The single winning override entry for this card, or null. A non-expired `scope: card` entry
 * (key == card id) outranks a non-expired `scope: agent` entry (key == card owner). Within one
 * scope+key the LAST matching entry in file order wins.
 */
function selectOverrideEntry(override: OverrideDoc, meta: CardMetaLike, nowMs: number): OverrideEntry | null {
  const entries = override?.overrides ?? [];
  const cardId = meta.id ?? null;
  const owner = meta.owner ?? null;
  let cardMatch: OverrideEntry | null = null;
  let agentMatch: OverrideEntry | null = null;
  for (const entry of entries) {
    if (!entry || expired(entry, nowMs)) continue;
    if (entry.scope === 'card' && cardId !== null && entry.key === cardId) cardMatch = entry;
    else if (entry.scope === 'agent' && owner !== null && entry.key === owner) agentMatch = entry;
  }
  return cardMatch ?? agentMatch;
}

/** policy[role][tier] -> policy[role]["*"] -> role_default, or null (mirrors Python `_policy_entry`). */
function policyCell(policy: PolicyDoc, role: string, tier: string): PolicyCell | null {
  if (!policy || Object.keys(policy).length === 0) return null;
  const matrix = policy.policy ?? {};
  const roleMap = matrix[role];
  if (roleMap && typeof roleMap === 'object') {
    const entry = roleMap[tier] ?? roleMap['*'];
    if (entry && typeof entry === 'object') return entry;
  }
  const roleDefault = policy.role_default;
  if (roleDefault && typeof roleDefault === 'object') return roleDefault;
  return null;
}

/** Map a policy tier-alias (opus/sonnet/haiku/codex) to the concrete model id; a concrete id passes through. */
export function resolveAlias(policy: PolicyDoc, runtime: string, modelOrAlias: string): string {
  const aliases = policy?.runtimes?.[runtime]?.aliases ?? {};
  return aliases[modelOrAlias] ?? modelOrAlias;
}

/** The runtime's `known_models`, or null when the runtime is not registered (then the guard can't run). */
function knownModels(policy: PolicyDoc, runtime: string): string[] | null {
  const km = policy?.runtimes?.[runtime]?.known_models;
  return Array.isArray(km) ? km : null;
}

/** The owner id dispatch claims a card as for a runtime (`runtimes[runtime].default_worker`), or null. */
export function defaultWorkerFor(policy: PolicyDoc, runtime: string): string | null {
  const w = policy?.runtimes?.[runtime]?.default_worker;
  return w ? String(w) : null;
}

/** Reverse lookup: the runtime whose `default_worker == worker`, or null. */
export function runtimeOfWorker(policy: PolicyDoc, worker: string): string | null {
  const runtimes = policy?.runtimes ?? {};
  for (const [name, rt] of Object.entries(runtimes)) {
    if (rt && rt.default_worker === worker) return name;
  }
  return null;
}

/**
 * Resolve a card to exactly one `(runtime, model)` with provenance — the core port of Python `resolve`.
 * `role`/`tier` select the policy cell (an empty/unknown role falls to `role_default`). `nowMs` is
 * injectable so expiry is deterministic in tests.
 */
export function resolveRouting(
  meta: CardMetaLike,
  role: string,
  tier: string,
  policy: PolicyDoc,
  override: OverrideDoc,
  nowMs: number = Date.now(),
): Effective {
  let runtimeVal: string | null = null;
  let runtimeSrc: RoutingSource | null = null;
  let modelVal: string | null = null;
  let modelSrc: RoutingSource | null = null;
  let modelIsAlias = false;

  // Rung 1 — card frontmatter (highest authority).
  if (meta.runtime) {
    runtimeVal = String(meta.runtime);
    runtimeSrc = 'card';
  }
  if (meta.model) {
    modelVal = String(meta.model);
    modelSrc = 'card';
  }

  // Rung 2 — the single winning override entry (card-scope beats agent-scope).
  const entry = selectOverrideEntry(override, meta, nowMs);
  if (entry) {
    if (runtimeVal === null && entry.runtime) {
      runtimeVal = String(entry.runtime);
      runtimeSrc = 'override';
    }
    if (modelVal === null && entry.model) {
      modelVal = String(entry.model);
      modelSrc = 'override';
    }
  }

  // Rung 3 — policy[role][tier] -> [role]["*"] -> role_default.
  const cell = policyCell(policy, role, tier);
  if (cell) {
    if (runtimeVal === null && cell.runtime) {
      runtimeVal = String(cell.runtime);
      runtimeSrc = 'policy';
    }
    if (modelVal === null && cell.model) {
      modelVal = String(cell.model);
      modelSrc = 'policy';
      modelIsAlias = true;
    }
  }

  // Rung 4 — built-in safe default.
  if (runtimeVal === null) {
    runtimeVal = SAFE_DEFAULT[0];
    runtimeSrc = 'default';
  }
  if (modelVal === null) {
    modelVal = SAFE_DEFAULT[1];
    modelSrc = 'default';
  }

  // Resolve a policy alias against the FINAL runtime; concrete ids pass through.
  if (modelIsAlias) {
    modelVal = resolveAlias(policy, runtimeVal, modelVal);
  }

  // Unknown-model guard (fail loud). Skipped only when the runtime is not registered.
  const known = knownModels(policy, runtimeVal);
  if (known !== null && !known.includes(modelVal)) {
    throw new RoutingError(
      `model '${modelVal}' is not in runtime '${runtimeVal}' known_models [${known.join(', ')}] ` +
        `(source runtime=${runtimeSrc}, model=${modelSrc})`,
    );
  }

  return {
    runtime: runtimeVal,
    model: modelVal,
    sourceRuntime: runtimeSrc as RoutingSource,
    sourceModel: modelSrc as RoutingSource,
  };
}

/** Read the card's role/tier from its meta (legacy cards may lack `role` -> falls to role_default). */
function roleOf(meta: CardMetaLike): string {
  const r = meta['role'];
  return typeof r === 'string' ? r : '';
}
function tierOf(meta: CardMetaLike): string {
  const t = meta['risk-tier'];
  return typeof t === 'string' ? t : '';
}

/** Effective routing for a card (uses its own `role`/`risk-tier`). Throws `RoutingError` on unknown model. */
export function effectiveForCard(
  meta: CardMetaLike,
  policy: PolicyDoc,
  override: OverrideDoc,
  nowMs: number = Date.now(),
): Effective {
  return resolveRouting(meta, roleOf(meta), tierOf(meta), policy, override, nowMs);
}

/**
 * Effective routing for an AGENT with no specific card: an agent-scope override (key == agentId), else
 * the policy `role_default`, else the safe default. Modelled as a card with no role/tier match (so
 * `policyCell` falls straight to `role_default`) and the agent id as `owner` (so agent-scope override
 * matches). Reports the winning source per field.
 */
export function effectiveForAgent(
  agentId: string,
  policy: PolicyDoc,
  override: OverrideDoc,
  nowMs: number = Date.now(),
): Effective {
  return resolveRouting({ id: null, owner: agentId, runtime: null, model: null }, '', '', policy, override, nowMs);
}

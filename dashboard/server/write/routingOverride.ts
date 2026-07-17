/**
 * R2.2 — governed per-agent / per-scope routing OVERRIDE write. Sets or clears an entry in
 * `queue/routing-override.yaml` (a COORDINATION artifact — proposal §2 — NOT governance), through the
 * existing D2 governed path. Every mutation, in order:
 *   1. WebAuthn short-TTL session gate (`auth/session.ts#verifySession`) — 401 otherwise.
 *   2. Registry validation BEFORE any write: `scope ∈ {agent, card}`, `runtime ∈ policy.runtimes`,
 *      `model ∈ that runtime's known_models` (a CONCRETE id, never an alias), `expires` ISO-8601 or null
 *      — 400 otherwise. The resolver's fail-open is a backstop, not the first line (ordering-law: validate
 *      on write).
 *   3. Rewrite the whole file atomically via the D2.5 governed coordination path (`governedSave.save` ->
 *      `branch.ts#routeCoordination`: `git pull --rebase origin ops` -> add -> commit -> push, retrying a
 *      rejected push). NEVER a raw `fs.write` into `queue/`.
 *   4. Stamp `set-by` (session identity) + `set-at`, and append exactly one D2.9 audit row.
 *
 * The module OWNS its audit row (unlike save/launch, where the route audits) because R2's write modules
 * are unit-tested at the module level for the audit; the route registrar stays a thin outcome->HTTP map.
 */
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { save } from './governedSave.ts';
import type { GitRunner, PrOpener } from './branch.ts';
import { loadPolicy, loadOverride, OVERRIDE_REL_PATH } from '../routing/policy.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';
import { serializeOverride } from '../routing/yaml.ts';
import type { SerializableOverrideEntry } from '../routing/yaml.ts';
import { appendAudit as realAppendAudit } from '../audit/log.ts';
import type { AppendAuditFn } from '../http/context.ts';
import type { OpsGitRunner } from '../audit/log.ts';

export type OverrideScope = 'agent' | 'card';

/** A set/clear mutation. For `clear`, only `scope`+`key` are read. */
export interface OverrideMutation {
  scope: OverrideScope;
  key: string;
  runtime?: string | null;
  model?: string | null;
  expires?: string | null;
}

export interface OverrideWriteInput {
  repoRoot: string;
  sessionToken: string | undefined;
  sessionConfig: SessionConfig;
}

export interface OverrideWriteDeps {
  /** Git runner for the coordination save (defaults to the real git binary via governedSave). */
  runGit?: GitRunner;
  openPr?: PrOpener;
  /** Audit sink (defaults to the real ops-committing appendAudit). */
  appendAudit?: AppendAuditFn;
  /** Git runner for the audit ops commit. */
  auditGit?: OpsGitRunner;
  now?: () => Date;
  /** Injectable loaders/save for hermetic tests (default to the real filesystem ones). */
  loadPolicyFn?: (repoRoot: string) => PolicyDoc;
  loadOverrideFn?: (repoRoot: string) => OverrideDoc;
  saveFn?: typeof save;
}

export type OverrideWriteOutcome =
  | { ok: true; op: 'set' | 'clear'; changed: boolean; entryCount: number }
  | { ok: false; status: 401 | 400 | 500; reason: string };

const KEY_RE = /^[A-Za-z0-9._@:/-]+$/;

/** Union of every runtime's `known_models` (used to validate a model-only override). */
function allKnownModels(policy: PolicyDoc): Set<string> {
  const out = new Set<string>();
  for (const spec of Object.values(policy.runtimes ?? {})) {
    for (const m of spec.known_models ?? []) out.add(m);
  }
  return out;
}

/** Validate a `set` mutation against the policy registry. Returns a reason string on failure, else null. */
function validateSet(m: OverrideMutation, policy: PolicyDoc): string | null {
  if (m.scope !== 'agent' && m.scope !== 'card') return 'scope must be "agent" or "card"';
  if (typeof m.key !== 'string' || !KEY_RE.test(m.key)) return 'key must be a non-empty id token';
  const runtime = m.runtime ?? null;
  const model = m.model ?? null;
  if (runtime === null && model === null) return 'a set override must specify at least a runtime or a model';
  const runtimes = policy.runtimes ?? {};
  if (runtime !== null) {
    if (!(runtime in runtimes)) return `runtime "${runtime}" is not in the policy registry`;
    if (model !== null && !(runtimes[runtime].known_models ?? []).includes(model)) {
      return `model "${model}" is not a known model of runtime "${runtime}"`;
    }
  } else if (model !== null && !allKnownModels(policy).has(model)) {
    return `model "${model}" is not a concrete known model of any registered runtime`;
  }
  if (m.expires != null && m.expires !== '') {
    const ms = Date.parse(String(m.expires).endsWith('Z') ? String(m.expires) : `${m.expires}`);
    if (Number.isNaN(ms)) return `expires "${m.expires}" is not a valid ISO-8601 timestamp`;
  }
  return null;
}

/** Session-gate helper: returns the verified subject or a failure outcome. */
function gate(input: OverrideWriteInput): { ok: true; sub: string } | { ok: false; status: 401; reason: string } {
  if (!input.sessionToken) return { ok: false, status: 401, reason: 'missing session token' };
  const check = verifySession(input.sessionToken, input.sessionConfig);
  if (!check.ok) return { ok: false, status: 401, reason: `invalid session: ${check.reason}` };
  return { ok: true, sub: check.claims.sub };
}

/** Serialize + persist the new override list through the governed coordination path, then audit. */
async function persist(
  input: OverrideWriteInput,
  deps: OverrideWriteDeps,
  overrides: SerializableOverrideEntry[],
  audit: { op: 'set' | 'clear'; scope: string; key: string; runtime: string | null; model: string | null; expires: string | null; sub: string; result: string },
): Promise<OverrideWriteOutcome> {
  const saveFn = deps.saveFn ?? save;
  const content = serializeOverride({ version: 1, overrides });
  const outcome = await saveFn({
    repoRoot: input.repoRoot,
    relpath: OVERRIDE_REL_PATH,
    content,
    sessionToken: input.sessionToken,
    sessionConfig: input.sessionConfig,
    runGit: deps.runGit,
    openPr: deps.openPr,
    message: `chore(routing): ${audit.op} override ${audit.scope}:${audit.key}`,
  });
  if (!outcome.ok) {
    // The relpath is fixed (queue/routing-override.yaml, coordination) so a path/governance refusal
    // cannot happen here — only a session (401) or an internal git/write failure (500) is reachable.
    const status = outcome.status === 401 ? 401 : 500;
    return { ok: false, status, reason: outcome.reason };
  }

  const appendAudit = deps.appendAudit ?? realAppendAudit;
  appendAudit(
    input.repoRoot,
    {
      action: 'routing-override',
      owner: audit.sub,
      target: `${audit.scope}:${audit.key}`,
      result: audit.result,
      detail: { op: audit.op, scope: audit.scope, key: audit.key, runtime: audit.runtime, model: audit.model, expires: audit.expires },
    },
    { runGit: deps.auditGit, now: deps.now },
  );
  return { ok: true, op: audit.op, changed: true, entryCount: overrides.length };
}

/** Set (create/replace) an override entry for `scope`+`key`. Last-writer replaces any prior same-key entry. */
export async function setOverride(
  input: OverrideWriteInput,
  mutation: OverrideMutation,
  deps: OverrideWriteDeps = {},
): Promise<OverrideWriteOutcome> {
  const g = gate(input);
  if (!g.ok) return g;

  const policy = (deps.loadPolicyFn ?? loadPolicy)(input.repoRoot);
  const reason = validateSet(mutation, policy);
  if (reason) return { ok: false, status: 400, reason };

  const current = (deps.loadOverrideFn ?? loadOverride)(input.repoRoot);
  const kept = current.overrides.filter((e) => !(e.scope === mutation.scope && e.key === mutation.key));

  const setAt = (deps.now ? deps.now() : new Date()).toISOString();
  const entry: SerializableOverrideEntry = { scope: mutation.scope, key: mutation.key };
  if (mutation.runtime != null) entry.runtime = mutation.runtime;
  if (mutation.model != null) entry.model = mutation.model;
  entry.expires = mutation.expires ?? null;
  entry['set-by'] = g.sub;
  entry['set-at'] = setAt;

  const overrides = [...(kept as SerializableOverrideEntry[]), entry];
  return persist(input, deps, overrides, {
    op: 'set',
    scope: mutation.scope,
    key: mutation.key,
    runtime: mutation.runtime ?? null,
    model: mutation.model ?? null,
    expires: mutation.expires ?? null,
    sub: g.sub,
    result: `set:runtime=${mutation.runtime ?? '-'},model=${mutation.model ?? '-'}`,
  });
}

/** Clear every override entry for `scope`+`key`. Idempotent: a no-match clear is a no-op success. */
export async function clearOverride(
  input: OverrideWriteInput,
  target: { scope: OverrideScope; key: string },
  deps: OverrideWriteDeps = {},
): Promise<OverrideWriteOutcome> {
  const g = gate(input);
  if (!g.ok) return g;
  if (target.scope !== 'agent' && target.scope !== 'card') {
    return { ok: false, status: 400, reason: 'scope must be "agent" or "card"' };
  }

  const current = (deps.loadOverrideFn ?? loadOverride)(input.repoRoot);
  const kept = current.overrides.filter((e) => !(e.scope === target.scope && e.key === target.key));
  if (kept.length === current.overrides.length) {
    // Nothing matched — idempotent no-op: no governed write, no audit row (nothing consequential).
    return { ok: true, op: 'clear', changed: false, entryCount: kept.length };
  }

  return persist(input, deps, kept as SerializableOverrideEntry[], {
    op: 'clear',
    scope: target.scope,
    key: target.key,
    runtime: null,
    model: null,
    expires: null,
    sub: g.sub,
    result: 'cleared',
  });
}

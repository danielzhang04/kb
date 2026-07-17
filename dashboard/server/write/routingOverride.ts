/**
 * R2.2 — governed per-agent / per-scope routing OVERRIDE write. Sets or clears an entry in
 * `queue/routing-override.yaml` (a COORDINATION artifact — proposal §2 — NOT governance). Every mutation,
 * in order:
 *   1. WebAuthn short-TTL session gate (`auth/session.ts#verifySession`) — 401 otherwise.
 *   2. Registry validation BEFORE any write: `scope ∈ {agent, card}`, `runtime ∈ policy.runtimes`,
 *      `model ∈ that runtime's known_models` (a CONCRETE id, never an alias), and `expires` is a valid
 *      ISO-8601 timestamp OR null — 400 otherwise.
 *   3. A RACE-SAFE, ATOMIC governed coordination rewrite to `ops`: inside a single pull-rebase-push
 *      critical section we RE-LOAD the override file from the freshly reconciled working tree, re-apply
 *      the mutation onto that fresh state, serialize, write, append the D2.9 audit row LOCALLY, then
 *      stage BOTH the override file and the audit ledger into ONE commit and push. A rejected push
 *      resets the (unpushed) attempt, re-pulls, and rebuilds from the new state.
 *
 * Three review findings shaped this module:
 *   - MED-1: `expires` is CANONICALIZED to ISO-8601-with-`Z` at validation. A non-ISO form (e.g.
 *     "Jan 1 2099") is REJECTED outright (400) rather than silently coerced — its JS `Date.parse`
 *     reading is server-local-time and would disagree with the Python consumer's strict
 *     `datetime.fromisoformat`. Accepted ISO input is normalized (via the SAME `parseIsoMs` the
 *     read-side `effective.ts` uses) to the exact `Z` form all four expiry parsers agree on.
 *   - MED-2: the read-modify-serialize is INSIDE the pull-rebase-push retry section — after every
 *     pull/rebase the override file is re-read and the mutation re-applied, so a concurrently-pushed
 *     entry can never be dropped by a stale whole-file overwrite.
 *   - MED-3: the audit row is committed in the SAME ops commit as the override change (one commit, one
 *     push — atomic by construction). An audit-append failure happens before any push, so ops never sees
 *     a routing change without its audit row.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { defaultGitRunner } from './branch.ts';
import type { GitRunner } from './branch.ts';
import { loadPolicy, loadOverride, OVERRIDE_REL_PATH } from '../routing/policy.ts';
import type { PolicyDoc, OverrideDoc } from '../routing/policy.ts';
import { serializeOverride } from '../routing/yaml.ts';
import type { SerializableOverrideEntry } from '../routing/yaml.ts';
import { parseIsoMs } from '../routing/effective.ts';
import { appendAuditRowLocal, AUDIT_REL_PATH } from '../audit/log.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';

export type OverrideScope = 'agent' | 'card';

/** A LOCAL-only audit append (no git of its own). The row lands in the SAME ops commit as the override
 *  change (MED-3). Signature matches `appendAuditRowLocal`. */
export type LocalAuditAppend = (repoRoot: string, event: AuditEvent, now?: () => Date) => AuditRow;

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
  /** Git runner for the coordination rewrite (defaults to the real git binary). */
  runGit?: GitRunner;
  /** LOCAL audit append (committed atomically with the override change; NOT a self-pushing sink). */
  appendAudit?: LocalAuditAppend;
  now?: () => Date;
  /** Injectable loaders/writer for hermetic tests (default to the real filesystem ones). */
  loadPolicyFn?: (repoRoot: string) => PolicyDoc;
  loadOverrideFn?: (repoRoot: string) => OverrideDoc;
  writeOverrideFn?: (repoRoot: string, content: string) => void;
  /** Extra push attempts after the first (each preceded by reset + reconciling pull). */
  maxRetryPushes?: number;
}

export type OverrideWriteOutcome =
  | { ok: true; op: 'set' | 'clear'; changed: boolean; entryCount: number }
  | { ok: false; status: 401 | 400 | 500; reason: string };

const KEY_RE = /^[A-Za-z0-9._@:/-]+$/;

/** Accepted ISO-8601 `expires` shapes (date, or datetime with optional seconds/fraction and Z/offset).
 *  Deliberately STRICT: a lenient JS-Date form like "Jan 1 2099" is rejected (MED-1). */
const ISO_EXPIRES_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;

/**
 * Validate + CANONICALIZE an `expires` input. `null`/empty -> `null` (no expiry). A non-ISO form is
 * rejected outright. Accepted ISO is normalized (naive treated as UTC, exactly like `effective.parseIsoMs`
 * and the Python `_parse_iso`) to the canonical `...Z` form every consumer parses identically.
 */
function canonicalizeExpires(raw: unknown): { ok: true; value: string | null } | { ok: false; reason: string } {
  if (raw == null || raw === '') return { ok: true, value: null };
  const s = String(raw).trim();
  if (!ISO_EXPIRES_RE.test(s)) {
    return { ok: false, reason: `expires "${s}" is not ISO-8601 (e.g. 2099-01-01T00:00:00Z)` };
  }
  const ms = parseIsoMs(s);
  if (Number.isNaN(ms)) return { ok: false, reason: `expires "${s}" is not a valid ISO-8601 timestamp` };
  // Canonical: ISO-8601 UTC with a trailing Z; drop a `.000` millisecond segment for a clean common case.
  const value = new Date(ms).toISOString().replace(/\.000Z$/, 'Z');
  return { ok: true, value };
}

/** Union of every runtime's `known_models` (used to validate a model-only override). */
function allKnownModels(policy: PolicyDoc): Set<string> {
  const out = new Set<string>();
  for (const spec of Object.values(policy.runtimes ?? {})) {
    for (const m of spec.known_models ?? []) out.add(m);
  }
  return out;
}

/** Validate a `set` mutation against the policy registry, returning the canonical `expires` on success. */
function validateSet(
  m: OverrideMutation,
  policy: PolicyDoc,
): { ok: false; reason: string } | { ok: true; expires: string | null } {
  if (m.scope !== 'agent' && m.scope !== 'card') return { ok: false, reason: 'scope must be "agent" or "card"' };
  if (typeof m.key !== 'string' || !KEY_RE.test(m.key)) return { ok: false, reason: 'key must be a non-empty id token' };
  const runtime = m.runtime ?? null;
  const model = m.model ?? null;
  if (runtime === null && model === null) {
    return { ok: false, reason: 'a set override must specify at least a runtime or a model' };
  }
  const runtimes = policy.runtimes ?? {};
  if (runtime !== null) {
    if (!(runtime in runtimes)) return { ok: false, reason: `runtime "${runtime}" is not in the policy registry` };
    if (model !== null && !(runtimes[runtime].known_models ?? []).includes(model)) {
      return { ok: false, reason: `model "${model}" is not a known model of runtime "${runtime}"` };
    }
  } else if (model !== null && !allKnownModels(policy).has(model)) {
    return { ok: false, reason: `model "${model}" is not a concrete known model of any registered runtime` };
  }
  const exp = canonicalizeExpires(m.expires);
  if (!exp.ok) return { ok: false, reason: exp.reason };
  return { ok: true, expires: exp.value };
}

/** Session-gate helper: returns the verified subject or a failure outcome. */
function gate(input: OverrideWriteInput): { ok: true; sub: string } | { ok: false; status: 401; reason: string } {
  if (!input.sessionToken) return { ok: false, status: 401, reason: 'missing session token' };
  const check = verifySession(input.sessionToken, input.sessionConfig);
  if (!check.ok) return { ok: false, status: 401, reason: `invalid session: ${check.reason}` };
  return { ok: true, sub: check.claims.sub };
}

/** Default disk writer for the override file (mkdir -p its dir, then write). */
function defaultWriteOverride(repoRoot: string, content: string): void {
  const abs = join(repoRoot, ...OVERRIDE_REL_PATH.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}

type Mutation = (current: SerializableOverrideEntry[]) => SerializableOverrideEntry[];

/**
 * The RACE-SAFE, ATOMIC governed coordination rewrite (MED-2 + MED-3). Per attempt: (reset a prior failed
 * attempt), `git pull --rebase origin ops`, RE-LOAD the override file from the fresh tree, re-apply
 * `mutate`, and — only if the result differs — write it, append the audit row locally, then stage the
 * override file AND the audit ledger into ONE commit and push. A rejected push resets and re-pulls so the
 * next attempt rebuilds from the newly-reconciled state (never a stale whole-file rebase-replay).
 */
async function coordinatedRewrite(
  input: OverrideWriteInput,
  deps: OverrideWriteDeps,
  op: 'set' | 'clear',
  message: string,
  mutate: Mutation,
  auditEvent: AuditEvent,
): Promise<OverrideWriteOutcome> {
  const runGit = deps.runGit ?? defaultGitRunner;
  const loadFn = deps.loadOverrideFn ?? loadOverride;
  const writeFn = deps.writeOverrideFn ?? defaultWriteOverride;
  const appendLocal = deps.appendAudit ?? appendAuditRowLocal;
  const maxRetryPushes = deps.maxRetryPushes ?? 3;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetryPushes; attempt += 1) {
    let entryCount: number;
    try {
      // Drop the previous attempt's unpushed commit + working changes so we rebuild from a CLEAN,
      // freshly-reconciled tree (never rebase-replay a stale whole-file rewrite).
      if (attempt > 0) runGit(input.repoRoot, ['reset', '--hard', 'HEAD~1']);
      runGit(input.repoRoot, ['pull', '--rebase', 'origin', 'ops']);

      // RE-LOAD from the freshly reconciled tree, then re-apply the mutation (MED-2: no lost update).
      const current = (loadFn(input.repoRoot).overrides ?? []) as SerializableOverrideEntry[];
      const next = mutate(current);
      entryCount = next.length;
      if (JSON.stringify(next) === JSON.stringify(current)) {
        // Fresh state already matches (e.g. a raced no-op clear): nothing consequential to commit.
        return { ok: true, op, changed: false, entryCount };
      }

      writeFn(input.repoRoot, serializeOverride({ version: 1, overrides: next }));
      // MED-3: append the audit row locally, then stage it in the SAME commit as the override change.
      appendLocal(input.repoRoot, auditEvent, deps.now);
      runGit(input.repoRoot, ['add', '--', OVERRIDE_REL_PATH, AUDIT_REL_PATH]);
      runGit(input.repoRoot, ['commit', '-m', message]);
    } catch (err) {
      // A pull/write/audit/add/commit failure is not a push rejection — nothing was pushed, fail closed.
      return { ok: false, status: 500, reason: err instanceof Error ? err.message : String(err) };
    }

    try {
      runGit(input.repoRoot, ['push', 'origin', 'ops']);
      return { ok: true, op, changed: true, entryCount };
    } catch (err) {
      lastErr = err;
      if (attempt === maxRetryPushes) break;
    }
  }
  return { ok: false, status: 500, reason: lastErr instanceof Error ? lastErr.message : String(lastErr) };
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
  const valid = validateSet(mutation, policy);
  if (!valid.ok) return { ok: false, status: 400, reason: valid.reason };
  const canonicalExpires = valid.expires;
  const setAt = (deps.now ? deps.now() : new Date()).toISOString();

  const mutate: Mutation = (current) => {
    const kept = current.filter((e) => !(e.scope === mutation.scope && e.key === mutation.key));
    const entry: SerializableOverrideEntry = { scope: mutation.scope, key: mutation.key };
    if (mutation.runtime != null) entry.runtime = mutation.runtime;
    if (mutation.model != null) entry.model = mutation.model;
    entry.expires = canonicalExpires;
    entry['set-by'] = g.sub;
    entry['set-at'] = setAt;
    return [...kept, entry];
  };

  return coordinatedRewrite(input, deps, 'set', `chore(routing): set override ${mutation.scope}:${mutation.key}`, mutate, {
    action: 'routing-override',
    owner: g.sub,
    target: `${mutation.scope}:${mutation.key}`,
    result: `set:runtime=${mutation.runtime ?? '-'},model=${mutation.model ?? '-'}`,
    detail: {
      op: 'set',
      scope: mutation.scope,
      key: mutation.key,
      runtime: mutation.runtime ?? null,
      model: mutation.model ?? null,
      expires: canonicalExpires,
    },
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

  // Fast idempotent no-op: local state shows nothing to clear -> no governed write, no audit row.
  const local = (deps.loadOverrideFn ?? loadOverride)(input.repoRoot).overrides ?? [];
  if (!local.some((e) => e.scope === target.scope && e.key === target.key)) {
    return { ok: true, op: 'clear', changed: false, entryCount: local.length };
  }

  const mutate: Mutation = (current) => current.filter((e) => !(e.scope === target.scope && e.key === target.key));
  return coordinatedRewrite(input, deps, 'clear', `chore(routing): clear override ${target.scope}:${target.key}`, mutate, {
    action: 'routing-override',
    owner: g.sub,
    target: `${target.scope}:${target.key}`,
    result: 'cleared',
    detail: { op: 'clear', scope: target.scope, key: target.key, runtime: null, model: null, expires: null },
  });
}

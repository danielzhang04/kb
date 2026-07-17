/**
 * C7.7 — the server-side authoritative set of owner ids a launched Task may be assigned to.
 *
 * The closed set is enumerated FROM THE FILESYSTEM, never from the client (the launch `<select>` is an
 * honest preview; this is the boundary — `card-schema.md:14,18` reconciliation: the WebAuthn operator is
 * a trusted dispatcher-equivalent, but only over a closed registered set). It is the UNION of:
 *   1. declared agents — every `agents/<id>.md` (C7.3's `readDeclaredAgents`), ∪
 *   2. registered runtime workers — each `runtimes.<rt>.default_worker` in `governance/model-routing.yaml`
 *      (read via the existing `loadPolicy`; today `worker-desktop`, `codex-worker`).
 *
 * Server-only (reads the filesystem); pure; degrades gracefully on a sparse checkout (missing `agents/`
 * → declared side empty; missing/malformed policy → `loadPolicy` returns `{}` → worker side empty).
 */
import { readDeclaredAgents } from './roster.ts';
import { loadPolicy } from '../routing/policy.ts';

export function readAssignableOwners(repoRoot: string): Set<string> {
  const out = new Set<string>();
  for (const id of readDeclaredAgents(repoRoot).keys()) out.add(id);
  const runtimes = loadPolicy(repoRoot).runtimes ?? {};
  for (const rt of Object.values(runtimes)) {
    const worker = rt?.default_worker;
    if (typeof worker === 'string' && worker !== '') out.add(worker);
  }
  return out;
}

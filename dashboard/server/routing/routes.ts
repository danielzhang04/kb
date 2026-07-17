/**
 * R2.1/R2.4 — the read-only routing projection route: `GET /api/routing`. Read surfaces need no session
 * (matches the other Plane-A reads). NOTE: this read is DELIBERATELY pre-auth per the existing
 * planeA/registry convention — it exposes override provenance incl. `set-by` identities; that exposure
 * (INFO-1) is accepted as-is under the same read-without-session posture as the other Plane-A reads.
 * Returns, in one snapshot:
 *   - `policy`: the parsed registry (runtimes incl. aliases/known_models/default_worker) + role x tier
 *     matrix + role_default — the authority the toggles pick from.
 *   - `overrides`: parsed entries with provenance + an `expired`/`expiringSoon` flag.
 *   - `agents`: the roster (R2.2) with each agent's effective runtime/model/source.
 *   - `cards`: per card id, its stamped runtime/model and what would resolve (effective/source), or an
 *     `unroutable` marker if the resolver would fail loud (an unknown named model).
 *   - `audit`: R2.4 routed-vs-ran mismatches + override provenance/expiry.
 */
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { indexRepo } from '../planeA/indexer.ts';
import { loadPolicy, loadOverride } from './policy.ts';
import type { CardMetaLike } from './effective.ts';
import { effectiveForCard, RoutingError } from './effective.ts';
import { listAgents } from '../agents/roster.ts';
import { readRoutingAudit } from './audit.ts';

/** dashboard/server/routing/routes.ts -> ../../../ is the repo root. Overridable for tests/config. */
export function resolveRepoRoot(): string {
  return process.env.DASHBOARD_REPO_ROOT ?? fileURLToPath(new URL('../../../', import.meta.url));
}

export interface CardRoutingView {
  stamped: { runtime: string | null; model: string | null };
  effective:
    | { runtime: string; model: string; sourceRuntime: string; sourceModel: string; unroutable?: false }
    | { unroutable: true; reason: string };
}

/** Build the whole read projection for `repoRoot`. Extracted from the handler so tests call it directly. */
export function buildRoutingSnapshot(repoRoot: string, nowMs: number = Date.now()) {
  const policy = loadPolicy(repoRoot);
  const override = loadOverride(repoRoot);
  const index = indexRepo(repoRoot);

  const runtimes = policy.runtimes ?? {};
  const registry = Object.fromEntries(
    Object.entries(runtimes).map(([name, spec]) => [
      name,
      {
        default_worker: spec.default_worker ?? null,
        aliases: spec.aliases ?? {},
        known_models: spec.known_models ?? [],
      },
    ]),
  );

  const cards: Record<string, CardRoutingView> = {};
  for (const bucket of Object.values(index.cards)) {
    for (const card of bucket) {
      const id = String(card.meta.id);
      const meta = card.meta as CardMetaLike;
      const stamped = {
        runtime: meta.runtime != null ? String(meta.runtime) : null,
        model: meta.model != null ? String(meta.model) : null,
      };
      try {
        const e = effectiveForCard(meta, policy, override, nowMs);
        cards[id] = { stamped, effective: { ...e, unroutable: false } };
      } catch (err) {
        cards[id] = {
          stamped,
          effective: { unroutable: true, reason: err instanceof RoutingError ? err.message : String(err) },
        };
      }
    }
  }

  const audit = readRoutingAudit(repoRoot, nowMs);
  return {
    policy: {
      version: policy.version ?? null,
      runtimes: registry,
      matrix: policy.policy ?? {},
      role_default: policy.role_default ?? null,
    },
    agents: listAgents(index, policy, override).map((a) => ({ id: a.id, effective: a.effective })),
    cards,
    audit,
    overrides: audit.overrides,
  };
}

/** Register the read-only routing projection route. */
export function registerRoutingRead(app: FastifyInstance, repoRoot: string = resolveRepoRoot()): void {
  app.get('/api/routing', async () => buildRoutingSnapshot(repoRoot));
}

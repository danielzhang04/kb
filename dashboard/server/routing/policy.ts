/**
 * R2.1 — policy + override file loaders (read-only), the TS side of `scripts/routing.py:load_policy` /
 * `load_override`. Same posture as the Python loaders: an `exists` guard, parse, and a safe default on
 * absent / empty / malformed / schema-invalid content (logged to nothing — pure) so the effective-routing
 * projection never throws for a drifted file. Server-only (reads the filesystem); never client-imported.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseYaml } from './yaml.ts';

/** A runtime's registry entry (proposal §1 `runtimes.<name>`). */
export interface RuntimeSpec {
  default_worker?: string;
  aliases?: Record<string, string>;
  known_models?: string[];
}

/** A `{runtime, model}` cell of the role x tier matrix (model may be a tier alias). */
export interface PolicyCell {
  runtime?: string;
  model?: string;
}

/** The parsed `governance/model-routing.yaml` (loose — the resolver reads defensively, Python-style). */
export interface PolicyDoc {
  version?: number;
  runtimes?: Record<string, RuntimeSpec>;
  policy?: Record<string, Record<string, PolicyCell>>;
  role_default?: PolicyCell;
}

/** One `queue/routing-override.yaml` entry (proposal §2). Fields beyond scope/key are all optional. */
export interface OverrideEntry {
  scope?: string;
  key?: string;
  runtime?: string | null;
  model?: string | null;
  expires?: string | null;
  'set-by'?: string | null;
  'set-at'?: string | null;
}

export interface OverrideDoc {
  version?: number;
  overrides: OverrideEntry[];
}

export const POLICY_REL_PATH = 'governance/model-routing.yaml';
export const OVERRIDE_REL_PATH = 'queue/routing-override.yaml';

/**
 * Read + parse the policy file. Returns `{}` when absent / empty / malformed / not-a-mapping (fail open
 * to the built-in safe default at resolve time), mirroring Python `load_policy`.
 */
export function loadPolicy(repoRoot: string): PolicyDoc {
  const f = join(repoRoot, ...POLICY_REL_PATH.split('/'));
  if (!existsSync(f)) return {};
  let data: unknown;
  try {
    data = parseYaml(readFileSync(f, 'utf-8'));
  } catch {
    return {};
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return data as PolicyDoc;
}

/**
 * Read + parse the override file. Returns `{overrides: []}` when absent / empty / malformed /
 * schema-invalid (`overrides` not a list) — fail OPEN to policy, mirroring Python `load_override`.
 */
export function loadOverride(repoRoot: string): OverrideDoc {
  const empty: OverrideDoc = { overrides: [] };
  const f = join(repoRoot, ...OVERRIDE_REL_PATH.split('/'));
  if (!existsSync(f)) return empty;
  let data: unknown;
  try {
    data = parseYaml(readFileSync(f, 'utf-8'));
  } catch {
    return empty;
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return empty;
  const overrides = (data as Record<string, unknown>).overrides;
  if (!Array.isArray(overrides)) return empty;
  return {
    version: (data as Record<string, unknown>).version as number | undefined,
    overrides: overrides.filter((e): e is OverrideEntry => !!e && typeof e === 'object' && !Array.isArray(e)),
  };
}

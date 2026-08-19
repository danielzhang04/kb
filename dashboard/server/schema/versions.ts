import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import type { ValidateFunction } from 'ajv';
import { defaultPlatformRoot } from '../runtime/python.ts';

export interface CompatibilityMatrix {
  cards: { current: 1; supported: readonly [0, 1] };
  workflows: { current: 1; supported: readonly [0, 1] };
}

const compatibilityByRoot = new Map<string, CompatibilityMatrix>();
const cardValidatorByRoot = new Map<string, ValidateFunction>();

function platformKey(platformRoot: string): string {
  return resolve(platformRoot);
}

export function readCompatibility(platformRoot: string = defaultPlatformRoot()): CompatibilityMatrix {
  const root = platformKey(platformRoot);
  const cached = compatibilityByRoot.get(root);
  if (cached) return cached;
  const parsed = JSON.parse(readFileSync(join(root, 'schemas', 'compatibility.json'), 'utf8')) as Record<string, unknown>;
  const closed = (value: unknown): value is { current: 1; supported: [0, 1] } => {
    if (!value || typeof value !== 'object') return false;
    const item = value as { current?: unknown; supported?: unknown };
    return Object.keys(item).sort().join(',') === 'current,supported'
      && item.current === 1 && Array.isArray(item.supported)
      && item.supported.length === 2 && item.supported[0] === 0 && item.supported[1] === 1;
  };
  const { $schema: _schema, ...matrix } = parsed;
  if (Object.keys(matrix).sort().join(',') !== 'cards,workflows' || !closed(matrix.cards) || !closed(matrix.workflows)) {
    throw new Error('unsupported platform compatibility matrix');
  }
  const compatible = matrix as unknown as CompatibilityMatrix;
  compatibilityByRoot.set(root, compatible);
  return compatible;
}

function cardValidator(platformRoot: string): ValidateFunction {
  const root = platformKey(platformRoot);
  const cached = cardValidatorByRoot.get(root);
  if (cached) return cached;
  const schema = JSON.parse(readFileSync(join(root, 'schemas', 'cards', 'v1.schema.json'), 'utf8')) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  cardValidatorByRoot.set(root, validate);
  return validate;
}

/** Load and validate both schema infrastructure files before repository data is inspected. */
export function assertSchemaInfrastructure(platformRoot: string = defaultPlatformRoot()): void {
  readCompatibility(platformRoot);
  cardValidator(platformRoot);
}

export function assertSupportedVersion(
  kind: keyof CompatibilityMatrix,
  value: unknown,
  matrix: CompatibilityMatrix = readCompatibility(),
): 0 | 1 {
  const version = value === undefined ? 0 : value;
  if (!Number.isInteger(version) || !matrix[kind].supported.includes(version as 0 | 1)) {
    throw new Error(`unsupported ${kind} schema-version: ${String(value)}`);
  }
  return version as 0 | 1;
}

export function assertCardSchema(
  meta: Record<string, unknown>,
  version: 0 | 1,
  platformRoot: string = defaultPlatformRoot(),
): void {
  const validate = cardValidator(platformRoot);
  const candidate = version === 0 ? { ...meta, 'schema-version': 1 } : meta;
  if (!validate(candidate)) {
    const detail = validate.errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ') ?? 'is invalid';
    throw new Error(`card schema validation failed: ${detail}`);
  }
}

/**
 * Forward-compatible variant of {@link assertCardSchema}. The `ops` branch is written by many
 * independent tools; a card carrying an unknown top-level key (e.g. a not-yet-merged arc's extra
 * metadata) is NOT a reason to fail-closed — the platform only reads the fields it knows and the
 * frontmatter is inert data. So this tolerates `additionalProperties` violations and RETURNS the
 * offending keys for the caller to log, while still throwing on every STRUCTURAL problem (missing
 * required field, wrong type, bad enum). The active claim/execute path keeps using the strict
 * {@link assertCardSchema}; only the boot-time repository scan is forgiving.
 */
export function assertCardSchemaTolerant(
  meta: Record<string, unknown>,
  version: 0 | 1,
  platformRoot: string = defaultPlatformRoot(),
): string[] {
  const validate = cardValidator(platformRoot);
  const candidate = version === 0 ? { ...meta, 'schema-version': 1 } : meta;
  if (validate(candidate)) return [];
  const unknownKeys: string[] = [];
  const structural = (validate.errors ?? []).filter((error) => {
    if (error.keyword === 'additionalProperties' && typeof error.params?.additionalProperty === 'string') {
      unknownKeys.push(error.params.additionalProperty);
      return false;
    }
    return true;
  });
  if (structural.length > 0) {
    const detail = structural.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ');
    throw new Error(`card schema validation failed: ${detail}`);
  }
  return unknownKeys;
}

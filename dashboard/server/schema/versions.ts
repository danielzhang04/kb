import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { defaultPlatformRoot } from '../runtime/python.ts';

export interface CompatibilityMatrix {
  cards: { current: 1; supported: readonly [0, 1] };
  workflows: { current: 1; supported: readonly [0, 1] };
}

export function readCompatibility(platformRoot: string = defaultPlatformRoot()): CompatibilityMatrix {
  const parsed = JSON.parse(readFileSync(join(platformRoot, 'schemas', 'compatibility.json'), 'utf8')) as Record<string, unknown>;
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
  return matrix as unknown as CompatibilityMatrix;
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
  const schema = JSON.parse(readFileSync(join(platformRoot, 'schemas', 'cards', 'v1.schema.json'), 'utf8')) as object;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const candidate = version === 0 ? { ...meta, 'schema-version': 1 } : meta;
  if (!validate(candidate)) {
    const detail = validate.errors?.map((error) => `${error.instancePath || '/'} ${error.message ?? 'is invalid'}`).join('; ') ?? 'is invalid';
    throw new Error(`card schema validation failed: ${detail}`);
  }
}

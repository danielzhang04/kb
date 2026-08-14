import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertCardSchema, readCompatibility } from './versions.ts';

const MATRIX = { cards: { current: 1, supported: [0, 1] }, workflows: { current: 1, supported: [0, 1] } };

function compatibilityFixture(value: object): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-compatibility-'));
  const schemas = join(root, 'schemas');
  mkdirSync(schemas);
  writeFileSync(join(schemas, 'compatibility.json'), JSON.stringify(value));
  return root;
}

function schemaFixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'kb-card-schema-'));
  const cards = join(root, 'schemas', 'cards');
  mkdirSync(cards, { recursive: true });
  writeFileSync(join(cards, 'v1.schema.json'), JSON.stringify({
    type: 'object',
    required: ['schema-version', 'id'],
    properties: { 'schema-version': { const: 1 }, id: { type: 'string' } },
    additionalProperties: false,
  }));
  return root;
}

describe('readCompatibility', () => {
  it('loads the checked-in compatibility ranges', () => {
    expect(readCompatibility()).toEqual(MATRIX);
  });

  it.each([
    MATRIX,
    { $schema: 'https://json-schema.org/draft/2020-12/schema', ...MATRIX },
  ])('accepts a matrix with optional $schema metadata', (matrix) => {
    const root = compatibilityFixture(matrix);
    try {
      expect(readCompatibility(root)).toEqual(MATRIX);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects extra compatibility metadata', () => {
    const root = compatibilityFixture({ ...MATRIX, unexpected: true });
    try {
      expect(() => readCompatibility(root)).toThrow('unsupported platform compatibility matrix');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('reuses a cached compatibility matrix for the same platform root', () => {
    const root = compatibilityFixture(MATRIX);
    try {
      expect(readCompatibility(root)).toEqual(MATRIX);
      rmSync(join(root, 'schemas', 'compatibility.json'));
      expect(readCompatibility(root)).toEqual(MATRIX);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('assertCardSchema', () => {
  it('reuses the compiled validator for the same platform root', () => {
    const root = schemaFixture();
    try {
      const card = { 'schema-version': 1, id: 'cached' };
      expect(() => assertCardSchema(card, 1, root)).not.toThrow();
      rmSync(join(root, 'schemas', 'cards', 'v1.schema.json'));
      expect(() => assertCardSchema(card, 1, root)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NamingRegistry } from './naming.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempFile(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return join(root, 'naming.json');
}

describe('NamingRegistry.shortRef', () => {
  it('assigns 1-based ordinals per kind independently', () => {
    const registry = new NamingRegistry(tempFile('naming-per-kind-'));
    expect(registry.shortRef('run', 'run-aaaaaaaa-1111')).toBe(1);
    expect(registry.shortRef('run', 'run-bbbbbbbb-2222')).toBe(2);
    expect(registry.shortRef('card', 'card-cccccccc-3333')).toBe(1);
    expect(registry.shortRef('card', 'card-dddddddd-4444')).toBe(2);
    expect(registry.shortRef('run', 'run-eeeeeeee-5555')).toBe(3);
  });

  it('returns the same ordinal for repeated calls on the same id', () => {
    const registry = new NamingRegistry(tempFile('naming-stable-'));
    const first = registry.shortRef('workflow', 'wf-abc123');
    const second = registry.shortRef('workflow', 'wf-abc123');
    expect(second).toBe(first);
    registry.shortRef('workflow', 'wf-other');
    expect(registry.shortRef('workflow', 'wf-abc123')).toBe(first);
  });

  it('never reuses an ordinal, even after many assignments', () => {
    const registry = new NamingRegistry(tempFile('naming-no-reuse-'));
    const seen = new Set<number>();
    for (let i = 0; i < 10; i += 1) {
      const ref = registry.shortRef('agent', `agent-${i}`);
      expect(seen.has(ref)).toBe(false);
      seen.add(ref);
    }
    expect(Math.max(...seen)).toBe(10);
  });

  it('persists assignments across a new NamingRegistry instance over the same file', () => {
    const filePath = tempFile('naming-persist-');
    const first = new NamingRegistry(filePath);
    const runRef = first.shortRef('run', 'run-persisted-1');
    first.shortRef('run', 'run-persisted-2');

    const second = new NamingRegistry(filePath);
    expect(second.shortRef('run', 'run-persisted-1')).toBe(runRef);
    // A third id assigned via the fresh instance continues the same sequence, proving it loaded
    // the prior assignments rather than starting empty.
    expect(second.shortRef('run', 'run-persisted-3')).toBe(3);
  });

  it('starts empty and never throws when the registry file is absent', () => {
    const filePath = tempFile('naming-absent-');
    const registry = new NamingRegistry(filePath);
    expect(() => registry.shortRef('task', 'task-x')).not.toThrow();
    expect(registry.shortRef('task', 'task-x')).toBe(1);
  });

  it('starts empty and never throws when the registry file is corrupt', () => {
    const filePath = tempFile('naming-corrupt-');
    writeFileSync(filePath, '{ this is not valid json', 'utf8');
    const registry = new NamingRegistry(filePath);
    expect(() => registry.shortRef('task', 'task-x')).not.toThrow();
    expect(registry.shortRef('task', 'task-x')).toBe(1);
  });

  it('starts empty and never throws when the registry file has the wrong shape', () => {
    const filePath = tempFile('naming-wrong-shape-');
    writeFileSync(filePath, JSON.stringify({ run: 'not-an-object' }), 'utf8');
    const registry = new NamingRegistry(filePath);
    expect(() => registry.shortRef('run', 'run-x')).not.toThrow();
    expect(registry.shortRef('run', 'run-x')).toBe(1);
  });
});

describe('NamingRegistry.displayFor', () => {
  it('prefers a non-empty trimmed title', () => {
    const registry = new NamingRegistry(tempFile('naming-title-'));
    const display = registry.displayFor('card', 'card-abc12345', '  Fix the naming bug  ');
    expect(display).toEqual({ displayName: 'Fix the naming bug', shortRef: 1 });
  });

  it('falls back to a readable id-derived name when title is missing, empty, or whitespace', () => {
    const registry = new NamingRegistry(tempFile('naming-fallback-'));
    expect(registry.displayFor('run', 'run-87d8aef2-rest-of-id').displayName).toBe('run 87d8aef2');
    expect(registry.displayFor('workflow', 'wf-deadbeef-rest', '').displayName).toBe('workflow deadbeef');
    expect(registry.displayFor('task', 'request-11112222-rest', '   ').displayName).toBe('task 11112222');
  });

  it('never surfaces the full UUID in the fallback display name', () => {
    const registry = new NamingRegistry(tempFile('naming-uuid-'));
    const id = 'agent-550e8400-e29b-41d4-a716-446655440000';
    const display = registry.displayFor('agent', id);
    expect(display.displayName).not.toContain(id);
    expect(display.displayName.length).toBeLessThan(id.length);
    expect(display.displayName).toBe('agent 550e8400');
  });

  it('falls back cleanly for a raw UUID with no known prefix', () => {
    const registry = new NamingRegistry(tempFile('naming-raw-uuid-'));
    const id = '550e8400-e29b-41d4-a716-446655440000';
    const display = registry.displayFor('agent', id);
    expect(display.displayName).toBe('agent 550e8400');
  });

  it('assigns the shortRef via the same sequence as shortRef()', () => {
    const registry = new NamingRegistry(tempFile('naming-display-shortref-'));
    registry.shortRef('card', 'card-existing');
    const display = registry.displayFor('card', 'card-new-one', 'New card');
    expect(display.shortRef).toBe(2);
  });
});

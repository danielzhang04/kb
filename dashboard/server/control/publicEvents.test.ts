import { describe, expect, it } from 'vitest';
import { normalizeOperationalEvent } from './publicEvents.ts';

describe('normalizeOperationalEvent', () => {
  it('retains visible messages and redacts recognizable credentials', () => {
    expect(normalizeOperationalEvent({ kind: 'message', visible: true, text: 'token sk-abcdefghijklmnop' })).toEqual({
      kind: 'message', text: 'token [token redacted]',
    });
    expect(normalizeOperationalEvent({ kind: 'message', visible: false, text: 'hidden reasoning' })).toBeNull();
  });

  it('projects tool operational shape without inputs, results, environment, or reasoning', () => {
    expect(normalizeOperationalEvent({
      kind: 'tool', name: 'apply_patch', status: 'succeeded', input: { secret: 'x' }, result: 'file bytes',
      environment: { TOKEN: 'x' }, reasoning: 'private',
    })).toEqual({ kind: 'tool', name: 'apply_patch', status: 'succeeded' });
  });

  it('rejects absolute, traversal, and backslash file paths', () => {
    for (const candidate of ['C:/secret', '/etc/passwd', '../secret', 'dashboard\\secret']) {
      expect(normalizeOperationalEvent({ kind: 'file', path: candidate, operation: 'read' })).toBeNull();
    }
    expect(normalizeOperationalEvent({ kind: 'file', path: 'dashboard/src/App.tsx', operation: 'modified' })).toEqual({
      kind: 'file', path: 'dashboard/src/App.tsx', operation: 'modified',
    });
  });

  it('normalizes session hierarchy, commands, diffs, checkpoints, and lifecycle', () => {
    expect(normalizeOperationalEvent({ kind: 'session', sessionRef: 's-1', parentSessionRef: null, role: 'manager', state: 'running' })).toMatchObject({ kind: 'session', role: 'manager' });
    expect(normalizeOperationalEvent({ kind: 'command', label: 'npm test', status: 'started', path: 'dashboard' })).toEqual({ kind: 'command', label: 'npm test', status: 'started', path: 'dashboard' });
    expect(normalizeOperationalEvent({ kind: 'diff', path: 'dashboard/a.ts', summary: 'password=secret-value' })).toEqual({ kind: 'diff', path: 'dashboard/a.ts', summary: 'password=[redacted]' });
    expect(normalizeOperationalEvent({ kind: 'checkpoint', name: 'tests-green', state: 'reached' })).toEqual({ kind: 'checkpoint', name: 'tests-green', state: 'reached' });
    expect(normalizeOperationalEvent({ kind: 'lifecycle', state: 'failed', detail: 'access_token=abc' })).toEqual({ kind: 'lifecycle', state: 'failed', detail: 'access_token=[redacted]' });
  });

  it('drops unknown event kinds', () => {
    expect(normalizeOperationalEvent({ kind: 'raw-provider-payload', result: { anything: true } })).toBeNull();
  });
});

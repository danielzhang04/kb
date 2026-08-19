import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { appendAuditRowLocal, AUDIT_REL_PATH } from './log.ts';
import type { AuditEvent } from './log.ts';
import { bindAttribution } from '../auth/operator.ts';

const EVENT: AuditEvent = { action: 'governed-save', owner: 'operator', riskTier: 'T2' };

/** `bindAttribution` uses `enterWith`, which marks the CURRENT async context — so each case runs inside
 *  its own `AsyncLocalStorage.run` island to keep bindings from leaking between tests. */
function inIsolatedContext<T>(fn: () => T): T {
  return new AsyncLocalStorage<null>().run(null, fn);
}

function repo(): string {
  return mkdtempSync(join(tmpdir(), 'kb-audit-attribution-'));
}

function rowsIn(root: string): Record<string, unknown>[] {
  return readFileSync(join(root, ...AUDIT_REL_PATH.split('/')), 'utf-8')
    .split('\n').filter(Boolean).map((line) => JSON.parse(line) as Record<string, unknown>);
}

/**
 * Attribution is stamped at the single row-WRITE point rather than in a wrapper above it, so every writer
 * is covered — including `pty/route.ts`, which appends through its own context and never touches
 * `http/context.ts#auditFn`.
 */
describe('audit row operator attribution', () => {
  it('writes the row UNCHANGED when nothing is attributed (win32-desktop mode)', () => {
    const root = repo();
    const returned = appendAuditRowLocal(root, EVENT);
    expect(returned).toMatchObject(EVENT);
    expect(returned.detail).toBeUndefined();
    expect(rowsIn(root)[0]).not.toHaveProperty('detail');
  });

  it('stamps the tailnet identity into detail without disturbing the rest of the row', () => {
    const root = repo();
    inIsolatedContext(() => {
      bindAttribution({ login: 'daniel.zhang.t1@gmail.com', name: 'Daniel Zhang' });
      appendAuditRowLocal(root, EVENT);
    });
    expect(rowsIn(root)[0]).toMatchObject({
      action: 'governed-save',
      owner: 'operator',
      riskTier: 'T2',
      detail: { tailnetIdentity: 'Daniel Zhang <daniel.zhang.t1@gmail.com>' },
    });
    // The caller's own event object is never mutated.
    expect(EVENT.detail).toBeUndefined();
  });

  it('falls back to the bare login when the proxy sends no display name', () => {
    const root = repo();
    inIsolatedContext(() => {
      bindAttribution({ login: 'op@example.com' });
      appendAuditRowLocal(root, EVENT);
    });
    expect(rowsIn(root)[0].detail).toEqual({ tailnetIdentity: 'op@example.com' });
  });

  it('preserves a route-supplied detail alongside the attribution', () => {
    const root = repo();
    inIsolatedContext(() => {
      bindAttribution({ login: 'op@example.com' });
      appendAuditRowLocal(root, { ...EVENT, detail: { method: 'session-bearer' } });
    });
    expect(rowsIn(root)[0].detail).toEqual({ method: 'session-bearer', tailnetIdentity: 'op@example.com' });
  });
});

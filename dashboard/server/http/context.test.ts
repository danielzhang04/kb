import { describe, expect, it } from 'vitest';
import { auditFn } from './context.ts';
import type { SurfaceContext } from './context.ts';
import { bindAttribution } from '../auth/operator.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';
import { AsyncLocalStorage } from 'node:async_hooks';

/** Minimal context: only the fields `auditFn` reads. */
function contextWith(recorder: AuditEvent[]): SurfaceContext {
  return {
    repoRoot: '/repo',
    appendAudit: (_root: string, event: AuditEvent) => {
      recorder.push(event);
      return { ...event, ts: 'ts' } as AuditRow;
    },
  } as unknown as SurfaceContext;
}

const EVENT: AuditEvent = { action: 'governed-save', owner: 'operator', riskTier: 'T2' };

/** `bindAttribution` uses `enterWith`, which marks the CURRENT async context — so each case runs inside
 *  its own `AsyncLocalStorage.run` island to keep bindings from leaking between tests. */
function inIsolatedContext<T>(fn: () => T): T {
  return new AsyncLocalStorage<null>().run(null, fn);
}

describe('auditFn attribution stamping', () => {
  it('passes the event through UNCHANGED when nothing is attributed (win32-desktop mode)', async () => {
    const recorded: AuditEvent[] = [];
    await auditFn(contextWith(recorded))('/repo', EVENT);
    // Identity, not merely equality: the win32 path must not even reallocate the event.
    expect(recorded[0]).toBe(EVENT);
  });

  it('stamps the tailnet identity into detail without disturbing the rest of the row', async () => {
    const recorded: AuditEvent[] = [];
    await inIsolatedContext(async () => {
      bindAttribution({ login: 'daniel.zhang.t1@gmail.com', name: 'Daniel Zhang' });
      await auditFn(contextWith(recorded))('/repo', EVENT);
    });
    expect(recorded[0]).toEqual({
      ...EVENT,
      detail: { tailnetIdentity: 'Daniel Zhang <daniel.zhang.t1@gmail.com>' },
    });
    // The caller's own event object is never mutated.
    expect(EVENT.detail).toBeUndefined();
  });

  it('preserves a route-supplied detail alongside the attribution', async () => {
    const recorded: AuditEvent[] = [];
    await inIsolatedContext(async () => {
      bindAttribution({ login: 'op@example.com' });
      await auditFn(contextWith(recorded))('/repo', { ...EVENT, detail: { method: 'session-bearer' } });
    });
    expect(recorded[0].detail).toEqual({ method: 'session-bearer', tailnetIdentity: 'op@example.com' });
  });
});

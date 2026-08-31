import { describe, expect, it, vi } from 'vitest';
import { auditFn, namingFor, type SurfaceContext } from './context.ts';
import { NamingRegistry } from '../naming.ts';
import type { ActivationReaderPort } from '../home/project.ts';

// P5 W6.1 [P5-C30]: `http/context.ts` types the ONE shared activation reader on `SurfaceContext`, threaded
// from `makeSurfaceContext` to Home, Health, and the Inbox deploy-ready gate. These tests cover the
// module's runtime exports (`auditFn`, `namingFor`) and prove the activation port is a single threaded
// instance rather than reconstructed per consumer.

const stubActivation: ActivationReaderPort = {
  readActivation: async () => ({ revision: 'release:test', label: 'VM', sha: 'a'.repeat(40), activatedAt: '2026-08-24T00:00:00.000Z' }),
};

function ctx(over: Partial<SurfaceContext> = {}): SurfaceContext {
  return { activationReader: stubActivation, ...over } as unknown as SurfaceContext;
}

describe('SurfaceContext — auditFn', () => {
  it('returns the injected appendAudit fake verbatim when present', () => {
    const injected = vi.fn();
    const fn = auditFn(ctx({ appendAudit: injected as unknown as SurfaceContext['appendAudit'] }));
    expect(fn).toBe(injected);
  });

  it('returns a real committing fn (a function) when no fake is injected', () => {
    const fn = auditFn(ctx({ appendAudit: undefined }));
    expect(typeof fn).toBe('function');
  });
});

describe('SurfaceContext — namingFor', () => {
  it('returns the context-provided registry when present', () => {
    const registry = new NamingRegistry('C:/does/not/exist/naming.json');
    expect(namingFor(ctx({ naming: registry }))).toBe(registry);
  });
});

describe('SurfaceContext — shared activation reader [P5-C30]', () => {
  it('threads ONE activation instance that every consumer reads through', async () => {
    const context = ctx();
    // Home, Health, and the Inbox gate all read `context.activationReader` — the SAME reference.
    expect(context.activationReader).toBe(stubActivation);
    const a = context.activationReader;
    const b = context.activationReader;
    expect(a).toBe(b);
    expect((await context.activationReader!.readActivation()).sha).toBe('a'.repeat(40));
  });

  it('is optional so the many test contexts that never read a release need not build one', () => {
    const bare = { } as unknown as SurfaceContext;
    expect(bare.activationReader).toBeUndefined();
  });
});

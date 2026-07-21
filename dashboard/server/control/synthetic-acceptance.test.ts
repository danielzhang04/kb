/**
 * Build-verified behavior of the T7 harness: it is inert at import and REFUSES to run unless the gate is
 * already on AND the operator confirmed a live watched run. The live run itself is human-supervised and is
 * not exercised here (it spawns a real `claude`).
 */
import { describe, it, expect } from 'vitest';
import { assertAcceptanceGate, AcceptanceRefusal } from './synthetic-acceptance.ts';

describe('assertAcceptanceGate — the harness refuses to run unless watched + gated', () => {
  it('refuses when the activation gate is off, whatever the args', () => {
    expect(() => assertAcceptanceGate({}, ['--confirm-live'])).toThrow(AcceptanceRefusal);
    expect(() => assertAcceptanceGate({ DASHBOARD_EXECUTION_ACTIVATED: '0' }, ['--confirm-live'])).toThrow(/not "1"/);
  });

  it('refuses when the gate is on but --confirm-live is absent (never runs unattended)', () => {
    expect(() => assertAcceptanceGate({ DASHBOARD_EXECUTION_ACTIVATED: '1' }, [])).toThrow(/--confirm-live/);
  });

  it('passes only when the gate is on AND the run is explicitly confirmed', () => {
    expect(() => assertAcceptanceGate({ DASHBOARD_EXECUTION_ACTIVATED: '1' }, ['--confirm-live'])).not.toThrow();
  });
});

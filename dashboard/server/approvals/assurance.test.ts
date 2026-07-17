/**
 * D2.4 — `buttonsFor` reads ONLY `card.meta.assurance_class` (fleet-emitted by 3.1/3.4) and never
 * recomputes novelty/tier itself.
 */
import { describe, expect, it } from 'vitest';
import { buttonsFor } from './assurance';
import type { ParsedCard } from '../planeA/cards';

function card(assuranceClass: string | null, riskTier = 'T3'): ParsedCard {
  return {
    meta: {
      id: 'card-1',
      project: 'kb',
      action: 'demo',
      target: '.',
      'risk-tier': riskTier,
      owner: null,
      state: 'approvals',
      ...(assuranceClass !== null ? { assurance_class: assuranceClass } : {}),
    },
    body: '## Work order\n\ndo it\n',
  };
}

describe('buttonsFor', () => {
  it('T3-novel offers signed/WebAuthn-only, NO possession button', () => {
    expect(buttonsFor(card('T3-novel'))).toEqual({ signed: true, webauthn: true, possession: false });
  });

  it('T1/T2 or T3-established offers the possession button', () => {
    expect(buttonsFor(card('possession-eligible', 'T1'))).toEqual({
      signed: true,
      webauthn: true,
      possession: true,
    });
    expect(buttonsFor(card('possession-eligible', 'T2'))).toEqual({
      signed: true,
      webauthn: true,
      possession: true,
    });
    expect(buttonsFor(card('T3-established', 'T3'))).toEqual({
      signed: true,
      webauthn: true,
      possession: true,
    });
  });

  it('fails closed to signed/WebAuthn-only for signed-only/acts-alone/missing/unknown classes', () => {
    expect(buttonsFor(card('signed-only')).possession).toBe(false);
    expect(buttonsFor(card('acts-alone')).possession).toBe(false);
    expect(buttonsFor(card(null)).possession).toBe(false);
    expect(buttonsFor(card('some-unknown-future-class')).possession).toBe(false);
  });
});

import { expect, it } from 'vitest';
import { buildChallenge, canonicalCardPayload, contentHash, parseChallenge } from './challenge';
import type { CardMeta } from '../planeA/cards';

/** A representative T3 card frontmatter (values only — body/Evidence never enters the hash). */
function baseMeta(overrides: Partial<CardMeta> = {}): CardMeta {
  return {
    id: 'aaaa0001-1111',
    project: 'kb',
    action: 'edit:skill',
    target: 'skills/foo.md',
    'risk-tier': 'T2',
    owner: 'claude',
    state: 'approvals',
    ...overrides,
  };
}

it('content_hash changes when risk-tier/owner/target changes', () => {
  // Four cards, identical in every field except ONE consequential field each time — proves each of
  // action/risk-tier/owner/target is actually bound into the hash (none can be mutated post-signature
  // without invalidating it).
  const base = baseMeta();
  const actionChanged = baseMeta({ action: 'delete:skill' });
  const riskTierChanged = baseMeta({ 'risk-tier': 'T3' });
  const ownerChanged = baseMeta({ owner: 'codex' });
  const targetChanged = baseMeta({ target: 'skills/bar.md' });

  const hashes = [base, actionChanged, riskTierChanged, ownerChanged, targetChanged].map((m) =>
    contentHash(canonicalCardPayload(m)),
  );

  expect(new Set(hashes).size).toBe(5);
});

it('canonicalCardPayload is order-stable', () => {
  // Same field values, deliberately constructed with a different key insertion order (mirrors two
  // frontmatter blocks whose lines are reordered) — canonicalCardPayload reads named fields, never
  // iterates the object's own key order, so the payload — and therefore the hash — must be identical.
  const a: CardMeta = {
    id: 'x',
    project: 'kb',
    action: 'act',
    target: 'tgt',
    'risk-tier': 'T1',
    owner: null,
    state: 'inbox',
  };
  const b = {
    state: 'inbox',
    owner: null,
    'risk-tier': 'T1',
    target: 'tgt',
    action: 'act',
    project: 'kb',
    id: 'x',
  } as CardMeta;

  expect(canonicalCardPayload(a)).toBe(canonicalCardPayload(b));
  expect(contentHash(canonicalCardPayload(a))).toBe(contentHash(canonicalCardPayload(b)));
});

it('buildChallenge/parseChallenge round-trip binds card_id + action', () => {
  const cardId = 'aaaa0001-1111';
  const action = 'edit:skill';
  const hash = contentHash(canonicalCardPayload(baseMeta()));
  const nonce = 'deadbeefcafebabe0011';

  const challenge = buildChallenge(cardId, action, hash, nonce);
  // The wire form is base64url — no '+', '/', or '=' padding — so it drops cleanly into a WebAuthn
  // `challenge` field / URL without re-encoding.
  expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/);

  const parsed = parseChallenge(challenge);
  expect(parsed.cardId).toBe(cardId);
  expect(parsed.action).toBe(action);
  expect(parsed.contentHash).toBe(hash);
  expect(parsed.nonce).toBe(nonce);
});

it('parseChallenge rejects a malformed challenge (fail closed)', () => {
  expect(() => parseChallenge('not-a-real-challenge')).toThrow();
});

import { expect, it } from 'vitest';
import { buildChallenge, canonicalCardPayload, contentHash, parseChallenge, workOrderOf } from './challenge';
import type { CardMeta } from '../planeA/cards';

/** A representative T3 card body — only the `## Work order` section enters the hash (fence-aware). */
const BASE_BODY = '## Work order\ndo the thing\n\n## Evidence\ninert\n';

/** A representative T3 card frontmatter (values only). */
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

it('content_hash changes when risk-tier/owner/target/action changes', () => {
  // Five cards, identical in every field + body except ONE consequential field each time — proves
  // each of action/risk-tier/owner/target is actually bound into the hash (none can be mutated
  // post-signature without invalidating it).
  const base = baseMeta();
  const actionChanged = baseMeta({ action: 'delete:skill' });
  const riskTierChanged = baseMeta({ 'risk-tier': 'T3' });
  const ownerChanged = baseMeta({ owner: 'codex' });
  const targetChanged = baseMeta({ target: 'skills/bar.md' });

  const hashes = [base, actionChanged, riskTierChanged, ownerChanged, targetChanged].map((m) =>
    contentHash(canonicalCardPayload(m, BASE_BODY)),
  );

  expect(new Set(hashes).size).toBe(5);
});

it('content_hash changes when the work-order body changes (D2.11 body binding)', () => {
  // Same four fields, different `## Work order` body -> different hash. This is the whole point of
  // D2.11: an attacker who rewrites the body an executor acts on now invalidates the signature.
  const meta = baseMeta();
  const h1 = contentHash(canonicalCardPayload(meta, '## Work order\ndeploy svc-a to staging\n'));
  const h2 = contentHash(canonicalCardPayload(meta, '## Work order\ndeploy PROD-db, drop tables\n'));
  expect(h1).not.toBe(h2);
});

it('content_hash ignores card bytes OUTSIDE the first work-order section', () => {
  // Only the FIRST `## Work order` section is bound; Evidence / trailing sections / a later
  // duplicate `## Work order` do not change the hash (they are not "the body").
  const meta = baseMeta();
  const a = contentHash(canonicalCardPayload(meta, '## Work order\ndo it\n\n## Evidence\nalpha\n'));
  const b = contentHash(canonicalCardPayload(meta, '## Work order\ndo it\n\n## Evidence\nOMEGA\n\n## Work order\nignored\n'));
  expect(a).toBe(b);
});

it('workOrderOf is fence-aware and captures only the first section', () => {
  // A fake `## heading` inside a ``` fence must NOT end the section; the fence lines are captured;
  // the next real heading ends it. Mirrors scripts/approvals.work_order_of exactly.
  const body = [
    '## Work order',
    'Deploy the café service ☕',
    '```yaml',
    '## not-a-real-heading',
    'key: val',
    '```',
    'done',
    '',
    '## Evidence',
    'inert',
  ].join('\n');
  expect(workOrderOf(body)).toBe(
    'Deploy the café service ☕\n```yaml\n## not-a-real-heading\nkey: val\n```\ndone',
  );
});

it('canonicalCardPayload throws (fail closed) when there is no work-order section', () => {
  expect(() => canonicalCardPayload(baseMeta(), 'just some prose, no heading')).toThrow();
});

it('canonicalCardPayload is order-stable', () => {
  // Same field values + body, deliberately constructed with a different key insertion order —
  // canonicalCardPayload reads named fields, never iterates the object's own key order, so the
  // payload — and therefore the hash — must be identical.
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

  expect(canonicalCardPayload(a, BASE_BODY)).toBe(canonicalCardPayload(b, BASE_BODY));
  expect(contentHash(canonicalCardPayload(a, BASE_BODY))).toBe(contentHash(canonicalCardPayload(b, BASE_BODY)));
});

it('content_hash is byte-identical to the Python verifier (pinned cross-language hex)', () => {
  // The dashboard TS issuer (this module) and scripts/webauthn_verify.py MUST compute the exact same
  // content_hash byte-for-byte, or a legitimately-signed challenge would be rejected. This sample
  // deliberately carries a NON-ASCII char (proves ensure_ascii=False parity) and a fenced code block
  // containing a fake `## heading` (proves fence-aware extraction parity). The pinned hex below is
  // asserted against the SAME sample + SAME constant in tests/test_webauthn_verify.py; both were
  // computed from the running TS module via node --experimental-strip-types.
  const meta = {
    action: 'deploy',
    target: 'svc-a',
    'risk-tier': 'T3',
    owner: 'claude/m1',
  } as CardMeta;
  const body = [
    '## Work order',
    'Deploy the café service ☕',
    '```yaml',
    '## not-a-real-heading',
    'key: val',
    '```',
    'done',
    '',
    '## Evidence',
    'inert',
  ].join('\n');
  expect(contentHash(canonicalCardPayload(meta, body))).toBe(
    '9931a82d1699104b1ed796a33b377f6c150a4a0826d825d78dc7486eea89dc59',
  );
});

it('buildChallenge/parseChallenge round-trip binds card_id + action', () => {
  const cardId = 'aaaa0001-1111';
  const action = 'edit:skill';
  const hash = contentHash(canonicalCardPayload(baseMeta(), BASE_BODY));
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

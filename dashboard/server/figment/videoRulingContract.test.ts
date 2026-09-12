import { describe, expect, it } from 'vitest';
import {
  decodeVideoRulingInventory,
  decodeVideoRulingResult,
  deriveVideoRulingOutcome,
  VIDEO_RULING_LIMITATIONS,
} from '../../shared/figmentVideoRuling';
import type { VideoRulingCriteria } from '../../shared/figmentVideoRuling';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const passCriteria: VideoRulingCriteria = {
  playbackObservation: 'watched_full',
  correspondenceReview: 'pass',
  temporalReview: 'pass',
  detailCropReview: 'pass',
  templateFitReview: 'pass',
  audioPresenceClaim: 'absent',
  audioLicensingReview: 'not_applicable',
  audioMixSyncReview: 'not_applicable',
};

const result = (overrides: Record<string, unknown> = {}) => ({
  schema: 'figment/studio-video-ruling@1',
  id: 'clip-1',
  subjectSha256: HASH_A,
  rulingSha256: HASH_B,
  derivedOutcome: 'reported_pass',
  criteria: passCriteria,
  notPromotable: true,
  attributionAuthenticated: false,
  limitations: VIDEO_RULING_LIMITATIONS,
  ...overrides,
});

describe('decodeVideoRulingInventory', () => {
  it('accepts a valid empty inventory', () => {
    expect(decodeVideoRulingInventory({ schema: 'figment/studio-video-rulings@1', ids: [], availability: 'available' }))
      .toEqual({ schema: 'figment/studio-video-rulings@1', ids: [], availability: 'available' });
  });

  it('accepts a valid populated inventory', () => {
    const decoded = decodeVideoRulingInventory({ schema: 'figment/studio-video-rulings@1', ids: ['clip-1', 'clip_2'], availability: 'busy' });
    expect(decoded).toEqual({ schema: 'figment/studio-video-rulings@1', ids: ['clip-1', 'clip_2'], availability: 'busy' });
  });

  it.each([null, [], 'x', 42, true, undefined])('rejects non-object input %p', (value) => {
    expect(decodeVideoRulingInventory(value)).toBeNull();
  });

  it('rejects duplicate ids', () => {
    expect(decodeVideoRulingInventory({ schema: 'figment/studio-video-rulings@1', ids: ['clip-1', 'clip-1'], availability: 'available' })).toBeNull();
  });

  it('rejects more than 16 ids', () => {
    const ids = Array.from({ length: 17 }, (_, i) => `clip-${i}`);
    expect(decodeVideoRulingInventory({ schema: 'figment/studio-video-rulings@1', ids, availability: 'available' })).toBeNull();
  });

  it.each(['../escape', 'a/b', 'clip 1', '', 'a'.repeat(65), '-leading'])('rejects a path-like or malformed id %p', (id) => {
    expect(decodeVideoRulingInventory({ schema: 'figment/studio-video-rulings@1', ids: [id], availability: 'available' })).toBeNull();
  });

  it('rejects an unknown availability value', () => {
    expect(decodeVideoRulingInventory({ schema: 'figment/studio-video-rulings@1', ids: [], availability: 'ready' })).toBeNull();
  });

  it('rejects extra keys', () => {
    expect(decodeVideoRulingInventory({ schema: 'figment/studio-video-rulings@1', ids: [], availability: 'available', note: 'x' })).toBeNull();
  });

  it('rejects missing keys', () => {
    expect(decodeVideoRulingInventory({ schema: 'figment/studio-video-rulings@1', ids: [] })).toBeNull();
  });

  it('rejects wrong key names in place of the required keys', () => {
    expect(decodeVideoRulingInventory({ schema: 'figment/studio-video-rulings@1', identifiers: [], availability: 'available' })).toBeNull();
  });

  it('ignores an inherited availability property that is not an own key', () => {
    const base = { availability: 'available' };
    const value = Object.create(base, {
      schema: { value: 'figment/studio-video-rulings@1', enumerable: true },
      ids: { value: [], enumerable: true },
    });
    expect(decodeVideoRulingInventory(value)).toBeNull();
  });

  it('does not forward extraneous properties present on the input', () => {
    const input: Record<string, unknown> = { schema: 'figment/studio-video-rulings@1', ids: ['clip-1'], availability: 'available' };
    const decoded = decodeVideoRulingInventory(input);
    expect(decoded).not.toBeNull();
    input.ids = ['mutated'];
    expect(decoded!.ids).toEqual(['clip-1']);
  });

  it('rejects an availability value matching an inherited Object.prototype name', () => {
    expect(decodeVideoRulingInventory({ schema: 'figment/studio-video-rulings@1', ids: [], availability: 'toString' })).toBeNull();
  });
});

describe('decodeVideoRulingResult', () => {
  it('accepts a consistent passing result', () => {
    const decoded = decodeVideoRulingResult(result());
    expect(decoded).not.toBeNull();
    expect(decoded!.derivedOutcome).toBe('reported_pass');
  });

  it('accepts a consistent failing result', () => {
    const criteria = { ...passCriteria, correspondenceReview: 'fail' as const };
    const decoded = decodeVideoRulingResult(result({ criteria, derivedOutcome: 'reported_fail' }));
    expect(decoded).not.toBeNull();
    expect(decoded!.derivedOutcome).toBe('reported_fail');
  });

  it('accepts a consistent incomplete result from not_watched playback', () => {
    const criteria = { ...passCriteria, playbackObservation: 'not_watched' as const };
    const decoded = decodeVideoRulingResult(result({ criteria, derivedOutcome: 'reported_incomplete' }));
    expect(decoded).not.toBeNull();
    expect(decoded!.derivedOutcome).toBe('reported_incomplete');
  });

  it('rejects a derivedOutcome that does not match the criteria', () => {
    expect(decodeVideoRulingResult(result({ derivedOutcome: 'reported_fail' }))).toBeNull();
  });

  it('rejects an unmatched expectedId', () => {
    expect(decodeVideoRulingResult(result(), 'other-id')).toBeNull();
  });

  it('accepts a matching expectedId', () => {
    expect(decodeVideoRulingResult(result(), 'clip-1')).not.toBeNull();
  });

  it.each(['subjectSha256', 'rulingSha256'])('rejects a malformed %s hash', (field) => {
    expect(decodeVideoRulingResult(result({ [field]: 'ABCD' }))).toBeNull();
    expect(decodeVideoRulingResult(result({ [field]: 'g'.repeat(64) }))).toBeNull();
    expect(decodeVideoRulingResult(result({ [field]: HASH_A.slice(0, 63) }))).toBeNull();
  });

  it('rejects notPromotable set to false', () => {
    expect(decodeVideoRulingResult(result({ notPromotable: false }))).toBeNull();
  });

  it('rejects attributionAuthenticated set to true', () => {
    expect(decodeVideoRulingResult(result({ attributionAuthenticated: true }))).toBeNull();
  });

  it('rejects limitations with altered text', () => {
    expect(decodeVideoRulingResult(result({ limitations: ['Different claim.', VIDEO_RULING_LIMITATIONS[1], VIDEO_RULING_LIMITATIONS[2]] }))).toBeNull();
  });

  it('rejects limitations out of order', () => {
    expect(decodeVideoRulingResult(result({ limitations: [VIDEO_RULING_LIMITATIONS[1], VIDEO_RULING_LIMITATIONS[0], VIDEO_RULING_LIMITATIONS[2]] }))).toBeNull();
  });

  it('rejects extra keys on the result', () => {
    expect(decodeVideoRulingResult(result({ note: 'not part of contract' }))).toBeNull();
  });

  it('rejects missing keys on the result', () => {
    const { notPromotable: _drop, ...rest } = result();
    expect(decodeVideoRulingResult(rest)).toBeNull();
  });

  it('rejects a path-like id', () => {
    expect(decodeVideoRulingResult(result({ id: '../clip-1' }))).toBeNull();
  });

  it.each(['audioLicensingReview', 'audioMixSyncReview'])('rejects audioPresenceClaim=absent when %s is not not_applicable', (field) => {
    const criteria = { ...passCriteria, [field]: 'pass' as const };
    expect(decodeVideoRulingResult(result({ criteria }))).toBeNull();
  });

  it('rejects audioPresenceClaim=present when either audio review is not_applicable', () => {
    const criteria = { ...passCriteria, audioPresenceClaim: 'present' as const, audioLicensingReview: 'pass' as const, audioMixSyncReview: 'not_applicable' as const };
    expect(decodeVideoRulingResult(result({ criteria }))).toBeNull();
  });

  it('rejects audioPresenceClaim=unassessed unless both audio reviews are incomplete', () => {
    const criteria = { ...passCriteria, audioPresenceClaim: 'unassessed' as const, audioLicensingReview: 'incomplete' as const, audioMixSyncReview: 'pass' as const };
    expect(decodeVideoRulingResult(result({ criteria }))).toBeNull();
  });

  it('accepts audioPresenceClaim=present with two consistent audio reviews', () => {
    const criteria = { ...passCriteria, audioPresenceClaim: 'present' as const, audioLicensingReview: 'pass' as const, audioMixSyncReview: 'pass' as const };
    expect(decodeVideoRulingResult(result({ criteria }))).not.toBeNull();
  });

  it('rejects an enum value matching an inherited Object.prototype name', () => {
    const criteria = { ...passCriteria, correspondenceReview: 'toString' as unknown as 'pass' };
    expect(decodeVideoRulingResult(result({ criteria }))).toBeNull();
  });

  it('ignores criteria supplied only via the prototype chain', () => {
    const criteria = Object.create(passCriteria);
    expect(decodeVideoRulingResult(result({ criteria }))).toBeNull();
  });

  it('rejects a result whose criteria carries an extra key', () => {
    const criteria = { ...passCriteria, extra: 'leak' } as unknown as VideoRulingCriteria;
    expect(decodeVideoRulingResult(result({ criteria }))).toBeNull();
  });

  it('does not forward an extra top-level key present on the raw input', () => {
    expect(decodeVideoRulingResult(result({ secretNote: 'leak-me' }))).toBeNull();
  });

  it('does not retain a reference to the input criteria object', () => {
    const criteria = { ...passCriteria };
    const decoded = decodeVideoRulingResult(result({ criteria }));
    expect(decoded).not.toBeNull();
    (criteria as { correspondenceReview: string }).correspondenceReview = 'fail';
    expect(decoded!.criteria.correspondenceReview).toBe('pass');
  });

  it.each([null, [], 'x', 7])('rejects non-object input %p', (value) => {
    expect(decodeVideoRulingResult(value)).toBeNull();
  });

  it('does not let a mutated decoded limitations array affect a fresh decode', () => {
    const first = decodeVideoRulingResult(result());
    expect(first).not.toBeNull();
    (first!.limitations as unknown as string[]).push('injected');
    const second = decodeVideoRulingResult(result());
    expect(second).not.toBeNull();
    expect(second!.limitations).toEqual(VIDEO_RULING_LIMITATIONS);
    expect(VIDEO_RULING_LIMITATIONS).not.toContain('injected');
  });
});

describe('deriveVideoRulingOutcome', () => {
  it('reports pass when every review passes and playback was watched', () => {
    expect(deriveVideoRulingOutcome(passCriteria)).toBe('reported_pass');
  });

  it('reports fail when any of the six review fields fail', () => {
    expect(deriveVideoRulingOutcome({ ...passCriteria, templateFitReview: 'fail' })).toBe('reported_fail');
    expect(deriveVideoRulingOutcome({ ...passCriteria, audioPresenceClaim: 'present', audioLicensingReview: 'fail', audioMixSyncReview: 'pass' })).toBe('reported_fail');
  });

  it('reports incomplete when a review is incomplete but none fail', () => {
    expect(deriveVideoRulingOutcome({ ...passCriteria, detailCropReview: 'incomplete' })).toBe('reported_incomplete');
  });

  it('reports incomplete when playback was not watched even if all reviews pass', () => {
    expect(deriveVideoRulingOutcome({ ...passCriteria, playbackObservation: 'not_watched' })).toBe('reported_incomplete');
  });

  it('reports incomplete when audio presence is unassessed', () => {
    expect(deriveVideoRulingOutcome({ ...passCriteria, audioPresenceClaim: 'unassessed', audioLicensingReview: 'incomplete', audioMixSyncReview: 'incomplete' })).toBe('reported_incomplete');
  });

  it('prioritizes fail over incomplete when both conditions are present', () => {
    expect(deriveVideoRulingOutcome({ ...passCriteria, playbackObservation: 'not_watched', correspondenceReview: 'fail' })).toBe('reported_fail');
  });
});

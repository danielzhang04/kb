export type VideoRulingAvailability = 'available' | 'busy' | 'quarantined';
export interface VideoRulingInventory { schema: 'figment/studio-video-rulings@1'; ids: readonly string[]; availability: VideoRulingAvailability; }

export type PlaybackObservation = 'watched_full' | 'not_watched';
export type ReviewVerdict = 'pass' | 'fail' | 'incomplete';
export type AudioPresenceClaim = 'present' | 'absent' | 'unassessed';
export type AudioReviewVerdict = 'pass' | 'fail' | 'incomplete' | 'not_applicable';
export type DerivedOutcome = 'reported_pass' | 'reported_fail' | 'reported_incomplete';

export interface VideoRulingCriteria {
  readonly playbackObservation: PlaybackObservation;
  readonly correspondenceReview: ReviewVerdict;
  readonly temporalReview: ReviewVerdict;
  readonly detailCropReview: ReviewVerdict;
  readonly templateFitReview: ReviewVerdict;
  readonly audioPresenceClaim: AudioPresenceClaim;
  readonly audioLicensingReview: AudioReviewVerdict;
  readonly audioMixSyncReview: AudioReviewVerdict;
}

export interface VideoRulingResult {
  readonly schema: 'figment/studio-video-ruling@1';
  readonly id: string;
  readonly subjectSha256: string;
  readonly rulingSha256: string;
  readonly derivedOutcome: DerivedOutcome;
  readonly criteria: VideoRulingCriteria;
  readonly notPromotable: true;
  readonly attributionAuthenticated: false;
  readonly limitations: readonly [string, string, string];
}

export const VIDEO_RULING_LIMITATIONS: readonly [string, string, string] = Object.freeze([
  'Review criteria are self-reported claims.',
  'The claimed author has not been authenticated.',
  'This result grants no delivery, media-quality or publication approval.',
]);

export const VIDEO_RULING_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
export const VIDEO_RULING_MAX_IDS = 16;

const INVENTORY_KEYS = ['availability', 'ids', 'schema'];
const RESULT_KEYS = ['attributionAuthenticated', 'criteria', 'derivedOutcome', 'id', 'limitations', 'notPromotable', 'rulingSha256', 'schema', 'subjectSha256'];
const CRITERIA_KEYS = [
  'audioLicensingReview',
  'audioMixSyncReview',
  'audioPresenceClaim',
  'correspondenceReview',
  'detailCropReview',
  'playbackObservation',
  'templateFitReview',
  'temporalReview',
].sort();

const AVAILABILITIES: ReadonlySet<string> = new Set(['available', 'busy', 'quarantined']);
const PLAYBACK_OBSERVATIONS: ReadonlySet<string> = new Set(['watched_full', 'not_watched']);
const REVIEW_VERDICTS: ReadonlySet<string> = new Set(['pass', 'fail', 'incomplete']);
const AUDIO_PRESENCE_CLAIMS: ReadonlySet<string> = new Set(['present', 'absent', 'unassessed']);
const AUDIO_REVIEW_VERDICTS: ReadonlySet<string> = new Set(['pass', 'fail', 'incomplete', 'not_applicable']);
const DERIVED_OUTCOMES: ReadonlySet<string> = new Set(['reported_pass', 'reported_fail', 'reported_incomplete']);

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  return actual.length === keys.length && actual.every((key, index) => key === keys[index]);
};

const isOwnEnum = <T extends string>(set: ReadonlySet<string>) => (value: unknown): value is T =>
  typeof value === 'string' && set.has(value);

const isPlaybackObservation = isOwnEnum<PlaybackObservation>(PLAYBACK_OBSERVATIONS);
const isReviewVerdict = isOwnEnum<ReviewVerdict>(REVIEW_VERDICTS);
const isAudioPresenceClaim = isOwnEnum<AudioPresenceClaim>(AUDIO_PRESENCE_CLAIMS);
const isAudioReviewVerdict = isOwnEnum<AudioReviewVerdict>(AUDIO_REVIEW_VERDICTS);
const isAvailability = isOwnEnum<VideoRulingAvailability>(AVAILABILITIES);
const isDerivedOutcome = isOwnEnum<DerivedOutcome>(DERIVED_OUTCOMES);
const isSha256 = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function decodeVideoRulingInventory(value: unknown): VideoRulingInventory | null {
  if (!isObject(value) || !hasExactKeys(value, INVENTORY_KEYS)) return null;
  if (value.schema !== 'figment/studio-video-rulings@1' || !isAvailability(value.availability)) return null;
  if (!Array.isArray(value.ids) || value.ids.length > VIDEO_RULING_MAX_IDS) return null;
  const ids: string[] = [];
  for (const item of value.ids) {
    if (typeof item !== 'string' || !VIDEO_RULING_ID_RE.test(item) || ids.includes(item)) return null;
    ids.push(item);
  }
  return { schema: 'figment/studio-video-rulings@1', ids, availability: value.availability };
}

function decodeCriteria(value: unknown): VideoRulingCriteria | null {
  if (!isObject(value) || !hasExactKeys(value, CRITERIA_KEYS)) return null;
  if (
    !isPlaybackObservation(value.playbackObservation) ||
    !isReviewVerdict(value.correspondenceReview) ||
    !isReviewVerdict(value.temporalReview) ||
    !isReviewVerdict(value.detailCropReview) ||
    !isReviewVerdict(value.templateFitReview) ||
    !isAudioPresenceClaim(value.audioPresenceClaim) ||
    !isAudioReviewVerdict(value.audioLicensingReview) ||
    !isAudioReviewVerdict(value.audioMixSyncReview)
  ) return null;

  const audioReviewsNotApplicable = value.audioLicensingReview === 'not_applicable' && value.audioMixSyncReview === 'not_applicable';
  const audioReviewsIncomplete = value.audioLicensingReview === 'incomplete' && value.audioMixSyncReview === 'incomplete';
  const eitherAudioReviewNotApplicable = value.audioLicensingReview === 'not_applicable' || value.audioMixSyncReview === 'not_applicable';
  if (value.audioPresenceClaim === 'absent' && !audioReviewsNotApplicable) return null;
  if (value.audioPresenceClaim === 'present' && eitherAudioReviewNotApplicable) return null;
  if (value.audioPresenceClaim === 'unassessed' && !audioReviewsIncomplete) return null;

  return {
    playbackObservation: value.playbackObservation,
    correspondenceReview: value.correspondenceReview,
    temporalReview: value.temporalReview,
    detailCropReview: value.detailCropReview,
    templateFitReview: value.templateFitReview,
    audioPresenceClaim: value.audioPresenceClaim,
    audioLicensingReview: value.audioLicensingReview,
    audioMixSyncReview: value.audioMixSyncReview,
  };
}

export function deriveVideoRulingOutcome(criteria: VideoRulingCriteria): DerivedOutcome {
  const reviews: ReviewVerdict[] = [criteria.correspondenceReview, criteria.temporalReview, criteria.detailCropReview, criteria.templateFitReview];
  const audioReviews: AudioReviewVerdict[] = [criteria.audioLicensingReview, criteria.audioMixSyncReview];
  if (reviews.some((review) => review === 'fail') || audioReviews.some((review) => review === 'fail')) return 'reported_fail';
  if (
    reviews.some((review) => review === 'incomplete') ||
    audioReviews.some((review) => review === 'incomplete') ||
    criteria.playbackObservation === 'not_watched' ||
    criteria.audioPresenceClaim === 'unassessed'
  ) return 'reported_incomplete';
  return 'reported_pass';
}

const sameLimitations = (value: unknown): value is readonly [string, string, string] =>
  Array.isArray(value) &&
  value.length === 3 &&
  value.every((entry, index) => entry === VIDEO_RULING_LIMITATIONS[index]);

export function decodeVideoRulingResult(value: unknown, expectedId?: string): VideoRulingResult | null {
  if (!isObject(value) || !hasExactKeys(value, RESULT_KEYS)) return null;
  if (value.schema !== 'figment/studio-video-ruling@1') return null;
  if (typeof value.id !== 'string' || !VIDEO_RULING_ID_RE.test(value.id)) return null;
  if (expectedId !== undefined && value.id !== expectedId) return null;
  if (!isSha256(value.subjectSha256) || !isSha256(value.rulingSha256)) return null;
  if (!isDerivedOutcome(value.derivedOutcome)) return null;
  if (value.notPromotable !== true || value.attributionAuthenticated !== false) return null;
  if (!sameLimitations(value.limitations)) return null;
  const criteria = decodeCriteria(value.criteria);
  if (criteria === null) return null;
  if (deriveVideoRulingOutcome(criteria) !== value.derivedOutcome) return null;

  return {
    schema: 'figment/studio-video-ruling@1',
    id: value.id,
    subjectSha256: value.subjectSha256,
    rulingSha256: value.rulingSha256,
    derivedOutcome: value.derivedOutcome,
    criteria,
    notPromotable: true,
    attributionAuthenticated: false,
    limitations: [...VIDEO_RULING_LIMITATIONS] as [string, string, string],
  };
}

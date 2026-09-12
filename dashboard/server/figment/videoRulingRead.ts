import { isAbsolute, join, resolve } from 'node:path';
import type { FastifyInstance } from 'fastify';
import {
  VIDEO_RULING_ID_RE,
  VIDEO_RULING_LIMITATIONS,
  decodeVideoRulingResult,
  type VideoRulingAvailability,
  type VideoRulingResult,
} from '../../shared/figmentVideoRuling.ts';
import { requireSession } from '../http/middleware.ts';
import type { SessionConfig } from '../auth/session.ts';
import {
  StudioPlanProcessError,
  runStudioPlanProcessCapture,
} from './studioPlanProcess.ts';

export type VideoRulingConfig = {
  pythonExecutable: string;
  entries: readonly {
    id: string;
    root: string;
    evaluationPath: string;
    rulingPath: string;
  }[];
};

type VideoRulingEntry = VideoRulingConfig['entries'][number];
type VideoRulingRunner = typeof runStudioPlanProcessCapture;
type Slot = 'idle' | 'running' | 'quarantined';

const CONFIG_ERROR = 'invalid Figment video ruling configuration';
const MAX_STRING_CHARS = 2_048;
const MAX_CONFIG_JSON_CHARS = 65_536;
const MAX_RULING_BYTES = 65_536;
const FIXED_SCRIPT_SEGMENTS = ['orgs', 'figment', 'pipeline', 'video', 'video_delivery_ruling_assertion.py'] as const;

const CONFIG_KEYS = ['entries', 'pythonExecutable'];
const ENTRY_KEYS = ['evaluationPath', 'id', 'root', 'rulingPath'];
const RESULT_KEYS = [
  'attribution_authenticated',
  'derived_outcome',
  'limitations',
  'not_promotable',
  'projection',
  'ruling',
  'ruling_file',
  'schema',
];
const RULING_KEYS = [
  'audio_licensing_review',
  'audio_mix_sync_review',
  'audio_presence_claim',
  'bound_review_directory',
  'bound_subject_sha256',
  'correspondence_review',
  'detail_crop_review',
  'notes',
  'playback_observation',
  'recorded_at',
  'schema',
  'template_fit_review',
  'temporal_review',
  'unauthenticated_attribution',
];
const PROJECTION_KEYS = [
  'accepted_lineage',
  'derivative',
  'extraction_receipt',
  'review_directory',
  'source_movie',
  'subject_sha256',
  'template',
  'tools',
  'transform_declaration',
];
const RULING_FILE_KEYS = ['bytes', 'path', 'sha256'];

const PYTHON_LIMITATIONS: readonly string[] = [
  'playback_observation, correspondence_review, temporal_review, detail_crop_review, template_fit_review, and all audio_* fields are self-reported claims by the declared attribution, not observations made by this reader.',
  'The bound_subject_sha256/bound_review_directory match and the ruling_file hash only prove this claim is bound to the current prepared evidence at read time; they do not prove the claim is true.',
  'unauthenticated_attribution is an unverified, self-declared string; no authentication of the claimed author was performed.',
  'No human review of the video was observed or performed by this reader; it never watches, decodes, or renders the media itself.',
  'This reader grants no delivery, media-quality, promotion, or publication authority; not_promotable is always true.',
  'The reused prepared-delivery store (video_delivery_review.py) has its own separately documented technical limitations.',
  'Equality checks across the two validate_prepared_delivery calls and the two byte snapshots establish cooperative freshness only; they are not atomicity guarantees against a hostile concurrent writer.',
];

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

const hasExactKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean => {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
};

const isWellFormedString = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
};

const isBoundedString = (value: unknown): value is string =>
  typeof value === 'string'
  && value.length >= 1
  && value.length <= MAX_STRING_CHARS
  && isWellFormedString(value)
  && !/[\u0000-\u001f\u007f-\u009f]/.test(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;

const isBoundedOutputPath = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_STRING_CHARS;

const hasAtMostCodePoints = (value: string, maximum: number): boolean => {
  let count = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) index += 1;
    count += 1;
    if (count > maximum) return false;
  }
  return true;
};

const isSha256 = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

const sameStrings = (value: unknown, expected: readonly string[]): boolean =>
  Array.isArray(value)
  && value.length === expected.length
  && value.every((entry, index) => entry === expected[index]);

const isSafeRelativePath = (value: unknown): value is string => {
  if (!isBoundedString(value) || value.includes('\\') || value.includes(':')) return false;
  const parts = value.split('/');
  return parts.every((part) => part.length > 0 && part !== '.' && part !== '..');
};

const cloneConfig = (raw: unknown): VideoRulingConfig | null => {
  if (!isPlainObject(raw) || !hasExactKeys(raw, CONFIG_KEYS)) return null;
  if (!isBoundedString(raw.pythonExecutable) || !isAbsolute(raw.pythonExecutable) || !Array.isArray(raw.entries) || raw.entries.length > 16) return null;

  const ids = new Set<string>();
  const entries: VideoRulingEntry[] = [];
  for (const rawEntry of raw.entries) {
    if (!isPlainObject(rawEntry) || !hasExactKeys(rawEntry, ENTRY_KEYS)) return null;
    if (
      !isBoundedString(rawEntry.id)
      || !VIDEO_RULING_ID_RE.test(rawEntry.id)
      || ids.has(rawEntry.id)
      || !isBoundedString(rawEntry.root)
      || !isAbsolute(rawEntry.root)
      || !isSafeRelativePath(rawEntry.evaluationPath)
      || !isSafeRelativePath(rawEntry.rulingPath)
    ) return null;
    ids.add(rawEntry.id);
    entries.push({
      id: rawEntry.id,
      root: resolve(rawEntry.root),
      evaluationPath: rawEntry.evaluationPath,
      rulingPath: rawEntry.rulingPath,
    });
  }

  return { pythonExecutable: resolve(raw.pythonExecutable), entries };
};

/** Parse trusted server-owned configuration. Only absent input disables the feature. */
export function parseVideoRulingConfig(raw: unknown): VideoRulingConfig | null {
  if (raw === null || raw === undefined) return null;
  try {
    const parsed = cloneConfig(raw);
    if (parsed === null) throw new Error(CONFIG_ERROR);
    return parsed;
  } catch {
    throw new Error(CONFIG_ERROR);
  }
}

/** Parse the later environment seam without allowing an oversized value into JSON.parse. */
export function parseVideoRulingConfigJson(raw: string | undefined): VideoRulingConfig | null {
  if (raw === undefined) return null;
  if (raw.length > MAX_CONFIG_JSON_CHARS || !isWellFormedString(raw)) throw new Error(CONFIG_ERROR);
  try {
    return parseVideoRulingConfig(JSON.parse(raw) as unknown);
  } catch {
    throw new Error(CONFIG_ERROR);
  }
}

const availabilityFor = (slot: Slot): VideoRulingAvailability =>
  slot === 'idle' ? 'available' : slot === 'running' ? 'busy' : 'quarantined';

const hasPositiveContentLength = (value: string | string[] | undefined): boolean => {
  const values = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return values.some((entry) => /^[0-9]+$/.test(entry) && Number(entry) > 0);
};

const hasTransferEncoding = (value: string | string[] | undefined): boolean =>
  Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.length > 0;

const isEmptyRequestQuery = (value: unknown): boolean =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0;

const hasRequestInput = (request: {
  query: unknown;
  body: unknown;
  headers: { 'content-length'?: string | string[]; 'transfer-encoding'?: string | string[] };
}): boolean => {
  if (request.body !== undefined) return true;
  if (hasPositiveContentLength(request.headers['content-length']) || hasTransferEncoding(request.headers['transfer-encoding'])) return true;
  return !isEmptyRequestQuery(request.query);
};

const isValidPythonResult = (value: unknown, id: string): VideoRulingResult | null => {
  if (!isPlainObject(value) || !hasExactKeys(value, RESULT_KEYS)) return null;
  if (value.schema !== 'figment/video-delivery-ruling-result@1') return null;
  if (value.not_promotable !== true || value.attribution_authenticated !== false) return null;
  if (!sameStrings(value.limitations, PYTHON_LIMITATIONS)) return null;
  if (!isPlainObject(value.ruling) || !hasExactKeys(value.ruling, RULING_KEYS)) return null;
  if (!isPlainObject(value.projection) || !hasExactKeys(value.projection, PROJECTION_KEYS)) return null;
  if (!isPlainObject(value.ruling_file) || !hasExactKeys(value.ruling_file, RULING_FILE_KEYS)) return null;

  const ruling = value.ruling;
  const projection = value.projection;
  const rulingFile = value.ruling_file;
  if (
    ruling.schema !== 'figment/video-delivery-ruling-assertion@1'
    || !isSha256(ruling.bound_subject_sha256)
    || !isNonEmptyString(ruling.bound_review_directory)
    || typeof ruling.notes !== 'string'
    || !isWellFormedString(ruling.notes)
    || !hasAtMostCodePoints(ruling.notes, 4_096)
    || typeof ruling.unauthenticated_attribution !== 'string'
    || typeof ruling.recorded_at !== 'string'
    || !isSha256(projection.subject_sha256)
    || !isNonEmptyString(projection.review_directory)
    || ruling.bound_subject_sha256 !== projection.subject_sha256
    || ruling.bound_review_directory !== projection.review_directory
    || !isPlainObject(projection.accepted_lineage)
    || !isPlainObject(projection.source_movie)
    || !isPlainObject(projection.derivative)
    || !isPlainObject(projection.template)
    || !isPlainObject(projection.transform_declaration)
    || !isPlainObject(projection.extraction_receipt)
    || !isPlainObject(projection.tools)
    || !isBoundedOutputPath(rulingFile.path)
    || typeof rulingFile.bytes !== 'number'
    || !Number.isSafeInteger(rulingFile.bytes)
    || rulingFile.bytes <= 0
    || rulingFile.bytes > MAX_RULING_BYTES
    || !isSha256(rulingFile.sha256)
  ) return null;

  const decoded = decodeVideoRulingResult({
    schema: 'figment/studio-video-ruling@1',
    id,
    subjectSha256: projection.subject_sha256,
    rulingSha256: rulingFile.sha256,
    derivedOutcome: value.derived_outcome,
    criteria: {
      playbackObservation: ruling.playback_observation,
      correspondenceReview: ruling.correspondence_review,
      temporalReview: ruling.temporal_review,
      detailCropReview: ruling.detail_crop_review,
      templateFitReview: ruling.template_fit_review,
      audioPresenceClaim: ruling.audio_presence_claim,
      audioLicensingReview: ruling.audio_licensing_review,
      audioMixSyncReview: ruling.audio_mix_sync_review,
    },
    notPromotable: true,
    attributionAuthenticated: false,
    limitations: [...VIDEO_RULING_LIMITATIONS],
  }, id);
  return decoded;
};

export function registerFigmentVideoRulingRead(
  app: FastifyInstance,
  options: {
    repoRoot: string;
    sessionConfig: SessionConfig;
    config: VideoRulingConfig | null;
    runProcess?: VideoRulingRunner;
  },
): void {
  const parsedConfig = parseVideoRulingConfig(options.config);
  if (!isBoundedString(options.repoRoot) || !isAbsolute(options.repoRoot)) {
    throw new Error(CONFIG_ERROR);
  }
  const repoRoot = resolve(options.repoRoot);
  const entries = new Map<string, VideoRulingEntry>();
  for (const entry of parsedConfig?.entries ?? []) entries.set(entry.id, entry);
  const pythonExecutable = parsedConfig?.pythonExecutable;
  const runner = options.runProcess ?? runStudioPlanProcessCapture;
  const script = join(repoRoot, ...FIXED_SCRIPT_SEGMENTS);
  let slot: Slot = 'idle';

  app.register((scope, _scopeOptions, done) => {
    scope.addHook('preHandler', requireSession(options.sessionConfig));
    scope.get('/api/figment/video-rulings', async (request, reply) => {
      if (hasRequestInput(request)) return reply.code(400).send({ error: 'invalid-request' });
      return reply.send({
        schema: 'figment/studio-video-rulings@1',
        ids: [...entries.keys()],
        availability: availabilityFor(slot),
      });
    });
    scope.post<{ Params: { id: string } }>('/api/figment/video-rulings/:id/read', async (request, reply) => {
      if (hasRequestInput(request)) return reply.code(400).send({ error: 'invalid-request' });
      const id = request.params.id;
      if (!VIDEO_RULING_ID_RE.test(id)) return reply.code(404).send({ error: 'not-found' });
      const entry = entries.get(id);
      if (!entry || !pythonExecutable) return reply.code(404).send({ error: 'not-found' });
      if (slot === 'running') return reply.code(409).send({ error: 'busy' });
      if (slot === 'quarantined') return reply.code(423).send({ error: 'quarantined' });
      slot = 'running';

      let stdout: Buffer;
      try {
        ({ stdout } = await runner(pythonExecutable, [
          '-I', '-B', script, 'read', '--root', entry.root,
          '--evaluation', entry.evaluationPath, '--ruling', entry.rulingPath,
        ], {
          cwd: repoRoot,
          timeout: 90_000,
          maxBuffer: 262_144,
          windowsHide: true,
        }));
      } catch (error) {
        if (error instanceof StudioPlanProcessError && !error.terminationUncertain) {
          slot = 'idle';
          return reply.code(503).send({ error: 'unavailable' });
        }
        slot = 'quarantined';
        return reply.code(423).send({ error: 'quarantined' });
      }

      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout)) as unknown;
      } catch {
        slot = 'idle';
        return reply.code(503).send({ error: 'unavailable' });
      }
      const result = isValidPythonResult(raw, id);
      if (result === null) {
        slot = 'idle';
        return reply.code(503).send({ error: 'unavailable' });
      }
      slot = 'idle';
      return reply.send(result);
    });
    done();
  });
}

import { createHash } from 'node:crypto';
import { isAbsolute, join, resolve } from 'node:path';
import { createAtomicJsonDocument } from './atomicJsonDocument.ts';

const SAFE_REF = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ARTIFACT_PATH = /^(?![A-Za-z]:)(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._ -]+(?:\/[A-Za-z0-9._ -]+)*$/;
const MAX_JOURNAL_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_PROMPT_CHARACTERS = 24_000;
const MAX_PROVIDER_OUTPUT_BYTES = 64 * 1024 * 1024;
const MAX_IMAGE_SEEDS = 4;
const MAX_IMAGE_SEED_BYTES = 8 * 1024 * 1024;
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const FIXED_IMAGE_ASPECT_RATIO = '16:9' as const;
const PAID_ARTIFACT_NAMESPACE = 'orgs/faceless-youtube/channels/the-second-take/videos/';
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\..*)?$/i;

/** Official Gemini Standard 1K/2K price as verified 2026-07-31; integer micro-dollars only. */
export const FYT_GEMINI_2K_IMAGE_COST_USD_MICROS = 134_000;
/** ElevenLabs Multilingual v2/v3 $0.10/1k characters, reserved conservatively for the whole slice call. */
export const FYT_LOCKED_TTS_COST_USD_MICROS = 45_000;
export const FYT_THIN_SLICE_TTS_MAX_CHARACTERS = 450;
/** Journal-wide absolute floor: thin-slice envelope is $1.40 image + $0.045 tts = $1.445, so $1.50 is the hard floor. */
export const FYT_PAID_ACTION_GLOBAL_CEILING_USD_MICROS = 1_500_000;

export type PaidActionOperation = 'fyt.gemini-3-pro-image-2k' | 'fyt.elevenlabs.locked-tts';
export type PaidActionProvider = 'gemini' | 'elevenlabs';
export type PaidActionState = 'reserved' | 'dispatching' | 'succeeded' | 'failed' | 'unknown';
export type PaidActionStageId = 'images' | 'audio';
export type PaidActionChannelId = 'the-second-take';

export interface PaidActionCaps {
  maxCalls: number;
  maxCostUsdMicros: number;
  maxCharacters: number;
  maxOutputs: number;
}

interface PaidActionDefinition {
  provider: PaidActionProvider;
  stageId: PaidActionStageId;
  channelId: PaidActionChannelId | null;
  reservation: { costUsdMicros: number; characters: number | 'request' };
  perRun: PaidActionCaps;
  perStage: PaidActionCaps;
}

/** The server, not a worker request, owns every spend-bearing provider/model/voice dial. */
const FYT_PAID_ACTION_DEFINITIONS: Readonly<Record<PaidActionOperation, PaidActionDefinition>> = Object.freeze({
  'fyt.gemini-3-pro-image-2k': {
    provider: 'gemini',
    stageId: 'images',
    channelId: null,
    reservation: { costUsdMicros: FYT_GEMINI_2K_IMAGE_COST_USD_MICROS, characters: 0 },
    // Eleven reservations are allowed, but $1.40 admits only ten $0.134 dispatches. The slice seeks
    // eight usable images, leaving room for at most two charged failures inside that effective ten.
    perRun: { maxCalls: 11, maxCostUsdMicros: 1_400_000, maxCharacters: 0, maxOutputs: 8 },
    perStage: { maxCalls: 11, maxCostUsdMicros: 1_400_000, maxCharacters: 0, maxOutputs: 8 },
  },
  'fyt.elevenlabs.locked-tts': {
    provider: 'elevenlabs',
    stageId: 'audio',
    channelId: 'the-second-take',
    reservation: { costUsdMicros: FYT_LOCKED_TTS_COST_USD_MICROS, characters: 'request' },
    perRun: {
      maxCalls: 1, maxCostUsdMicros: FYT_LOCKED_TTS_COST_USD_MICROS,
      maxCharacters: FYT_THIN_SLICE_TTS_MAX_CHARACTERS, maxOutputs: 1,
    },
    perStage: {
      maxCalls: 1, maxCostUsdMicros: FYT_LOCKED_TTS_COST_USD_MICROS,
      maxCharacters: FYT_THIN_SLICE_TTS_MAX_CHARACTERS, maxOutputs: 1,
    },
  },
});

/** Daniel-ear-gated The Second Take policy, copied from the current channel DNA. */
const THE_SECOND_TAKE_LOCKED_TTS = Object.freeze({
  voiceId: 'iP95p4xoKVk53GoZ742B',
  modelId: 'eleven_v3',
  outputFormat: 'mp3_44100_128',
  voiceSettings: Object.freeze({
    stability: 0.10,
    similarityBoost: 0.85,
    style: 0.75,
    useSpeakerBoost: true,
    speed: 1.0,
  }),
});

interface PaidActionIdentity {
  runRef: string;
  stageRef: string;
  attemptRef: string;
  callOrdinal: number;
}

export interface PaidActionImageSeed {
  bytes: Uint8Array;
  sha256: string;
}

export type PaidActionRequest =
  | PaidActionIdentity & {
    stageId: 'images';
    operation: 'fyt.gemini-3-pro-image-2k';
    prompt: string;
    seeds: readonly PaidActionImageSeed[];
    expectedArtifactPath: string;
  }
  | PaidActionIdentity & {
    stageId: 'audio';
    channelId: PaidActionChannelId;
    operation: 'fyt.elevenlabs.locked-tts';
    text: string;
    expectedArtifactPath: string;
  };

export type PaidActionDispatch =
  | {
    provider: 'gemini';
    operation: 'fyt.gemini-3-pro-image-2k';
    credential: unknown;
    request: {
      model: 'gemini-3-pro-image';
      imageSize: '2K';
      aspectRatio: typeof FIXED_IMAGE_ASPECT_RATIO;
      prompt: string;
      seeds: readonly ({ mediaType: 'image/png' } & PaidActionImageSeed)[];
    };
  }
  | {
    provider: 'elevenlabs';
    operation: 'fyt.elevenlabs.locked-tts';
    credential: unknown;
    request: {
      voiceId: typeof THE_SECOND_TAKE_LOCKED_TTS.voiceId;
      modelId: typeof THE_SECOND_TAKE_LOCKED_TTS.modelId;
      outputFormat: typeof THE_SECOND_TAKE_LOCKED_TTS.outputFormat;
      voiceSettings: typeof THE_SECOND_TAKE_LOCKED_TTS.voiceSettings;
      text: string;
    };
  };

export type PaidActionProviderResult =
  | { provider: 'gemini'; mediaType: 'image/png'; bytes: Uint8Array }
  | { provider: 'elevenlabs'; mediaType: 'audio/mpeg'; bytes: Uint8Array };

export interface PaidActionOutputMetadata {
  artifactPath: string;
  mediaType: PaidActionProviderResult['mediaType'];
  byteLength: number;
  sha256: string;
}

/** Credentials are opaque server-side capabilities and are never persisted or returned. */
export interface PaidActionCredentialResolver {
  resolve(input: { provider: PaidActionProvider }): Promise<unknown | null | undefined>;
}

/** The only provider boundary. Production implementations must perform exactly one HTTP attempt. */
export interface PaidActionTransport {
  dispatch(input: PaidActionDispatch): Promise<PaidActionProviderResult>;
}

export interface PaidActionCommitInput {
  actionRef: string;
  runRef: string;
  stageRef: string;
  attemptRef: string;
  callOrdinal: number;
  operation: PaidActionOperation;
  expectedArtifactPath: string;
  result: PaidActionProviderResult;
}

/** Commits provider bytes to the attempt artifact before the journal may say `succeeded`. */
export interface PaidActionCommitter {
  commit(input: PaidActionCommitInput): Promise<PaidActionOutputMetadata>;
}

/** Re-measures a committed artifact for every succeeded replay; it never calls a provider. */
export interface PaidActionArtifactVerifier {
  verify(input: { actionRef: string; output: PaidActionOutputMetadata }): Promise<PaidActionOutputMetadata | null>;
}

export interface PaidActionServiceOptions {
  stateRoot: string;
  credentials: PaidActionCredentialResolver;
  transport: PaidActionTransport;
  committer: PaidActionCommitter;
  verifier: PaidActionArtifactVerifier;
  now?: () => Date;
  lockTimeoutMs?: number;
}

type PaidActionFailureReason = 'credential-unavailable' | 'credential-resolution-failed' | 'startup-abandoned-reservation';
type PaidActionUnknownReason =
  | 'transport-unconfirmed'
  | 'artifact-commit-unconfirmed'
  | 'artifact-verification-failed'
  | 'startup-abandoned-dispatch';

export type PaidActionResult =
  | { status: 'succeeded'; actionRef: string; output: PaidActionOutputMetadata }
  | { status: 'failed'; actionRef: string; reason: PaidActionFailureReason }
  | { status: 'unknown'; actionRef: string; reason: PaidActionUnknownReason }
  | { status: 'replayed'; actionRef: string; priorState: 'succeeded'; output: PaidActionOutputMetadata }
  | { status: 'replayed'; actionRef: string; priorState: 'failed'; reason: PaidActionFailureReason }
  | { status: 'replayed'; actionRef: string; priorState: 'unknown'; reason: PaidActionUnknownReason };

export type PaidActionErrorCode =
  | 'invalid-input'
  | 'cap-exhausted'
  | 'idempotency-conflict'
  | 'call-out-of-order'
  | 'attempt-in-progress'
  | 'startup-reconciliation-required'
  | 'artifact-verification-unavailable'
  | 'journal-unavailable';

/** Only stable, non-provider details cross this boundary; never attach a caught provider error. */
export class PaidActionError extends Error {
  readonly code: PaidActionErrorCode;

  constructor(code: PaidActionErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

interface PaidActionReservation {
  calls: 1;
  costUsdMicros: number;
  characters: number;
}

interface PaidActionRecord {
  idempotencyKey: string;
  actionRef: string;
  runRef: string;
  stageRef: string;
  stageId: PaidActionStageId;
  channelId: PaidActionChannelId | null;
  operation: PaidActionOperation;
  attemptRef: string;
  callOrdinal: number;
  expectedArtifactPath: string;
  artifactOwnershipKey: string;
  requestFingerprint: string;
  reservation: PaidActionReservation;
  state: PaidActionState;
  chargedCostUsdMicros: number;
  output: PaidActionOutputMetadata | null;
  failureReason: PaidActionFailureReason | null;
  unknownReason: PaidActionUnknownReason | null;
  reservedAt: string;
  dispatchingAt: string | null;
  finalizedAt: string | null;
}

interface PaidActionJournal {
  schema: 'kb.paid-action-journal/v4';
  revision: number;
  policyFingerprint: string;
  actions: PaidActionRecord[];
}

interface NormalizedAction {
  input: PaidActionRequest;
  definition: PaidActionDefinition;
  idempotencyKey: string;
  actionRef: string;
  requestFingerprint: string;
  reservation: PaidActionReservation;
  expectedArtifactPath: string;
  artifactOwnershipKey: string;
  dispatchWithoutCredential: Omit<PaidActionDispatch, 'credential'>;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(',')}}`;
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value), 'utf8').digest('hex');
}

function fail(code: PaidActionErrorCode, message: string): never {
  throw new PaidActionError(code, message);
}

function requireSafeRef(value: string, label: string): void {
  if (!SAFE_REF.test(value) || value.includes('..')) fail('invalid-input', `${label} is invalid`);
}

function requireCallOrdinal(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) fail('invalid-input', 'call ordinal is invalid');
}

function characterCount(value: string): number {
  return [...value].length;
}

function requireContent(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.includes('\0') || value.trim().length === 0 || characterCount(value) > maximum) {
    fail('invalid-input', `${label} is invalid`);
  }
  return value;
}

function ensureSafeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isOutputMetadata(value: unknown): value is PaidActionOutputMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const output = value as PaidActionOutputMetadata;
  const extension = output.mediaType === 'image/png' ? '.png' : output.mediaType === 'audio/mpeg' ? '.mp3' : null;
  return extension !== null && artifactIdentity(output.artifactPath, extension) !== null
    && Number.isSafeInteger(output.byteLength) && output.byteLength > 0 && output.byteLength <= MAX_PROVIDER_OUTPUT_BYTES
    && SHA256.test(output.sha256);
}

const FAILURE_REASONS: readonly PaidActionFailureReason[] = [
  'credential-unavailable', 'credential-resolution-failed', 'startup-abandoned-reservation',
];
const UNKNOWN_REASONS: readonly PaidActionUnknownReason[] = [
  'transport-unconfirmed', 'artifact-commit-unconfirmed', 'artifact-verification-failed', 'startup-abandoned-dispatch',
];

function assertJournal(value: unknown): asserts value is PaidActionJournal {
  const journal = value as PaidActionJournal;
  if (!journal || typeof journal !== 'object' || Array.isArray(journal) || journal.schema !== 'kb.paid-action-journal/v4'
    || !Number.isSafeInteger(journal.revision) || journal.revision < 0 || !SHA256.test(String(journal.policyFingerprint))
    || !Array.isArray(journal.actions)) {
    fail('journal-unavailable', 'paid action journal is invalid');
  }
  const seen = new Set<string>();
  const seenArtifactOwnershipKeys = new Set<string>();
  for (const action of journal.actions) {
    if (!action || typeof action !== 'object' || Array.isArray(action)) fail('journal-unavailable', 'paid action journal is invalid');
    if (!SHA256.test(action.idempotencyKey) || action.actionRef !== `paid-${action.idempotencyKey.slice(0, 32)}` || seen.has(action.idempotencyKey)
      || !SAFE_REF.test(action.runRef) || action.runRef.includes('..') || !SAFE_REF.test(action.stageRef) || action.stageRef.includes('..')
      || !SAFE_REF.test(action.attemptRef) || action.attemptRef.includes('..') || !['images', 'audio'].includes(action.stageId)
      || (action.channelId !== null && action.channelId !== 'the-second-take') || !Object.hasOwn(FYT_PAID_ACTION_DEFINITIONS, action.operation)
      || !Number.isSafeInteger(action.callOrdinal) || action.callOrdinal < 1 || !SHA256.test(action.requestFingerprint)
      || typeof action.expectedArtifactPath !== 'string' || typeof action.artifactOwnershipKey !== 'string'
      || !action.reservation || action.reservation.calls !== 1 || !ensureSafeNumber(action.reservation.costUsdMicros)
      || !ensureSafeNumber(action.reservation.characters) || !['reserved', 'dispatching', 'succeeded', 'failed', 'unknown'].includes(action.state)
      || !ensureSafeNumber(action.chargedCostUsdMicros) || !isIsoTimestamp(action.reservedAt)
      || (action.dispatchingAt !== null && !isIsoTimestamp(action.dispatchingAt))
      || (action.finalizedAt !== null && !isIsoTimestamp(action.finalizedAt))) {
      fail('journal-unavailable', 'paid action journal is invalid');
    }
    const definition = FYT_PAID_ACTION_DEFINITIONS[action.operation];
    const expectedIdentity = artifactIdentity(
      action.expectedArtifactPath,
      action.operation === 'fyt.gemini-3-pro-image-2k' ? '.png' : '.mp3',
    );
    const terminal = action.state === 'succeeded' || action.state === 'failed' || action.state === 'unknown';
    if (definition.stageId !== action.stageId || definition.channelId !== action.channelId
      || action.reservation.costUsdMicros !== definition.reservation.costUsdMicros
      || (definition.reservation.characters === 0 && action.reservation.characters !== 0)
      || (definition.reservation.characters === 'request' && (action.reservation.characters < 1 || action.reservation.characters > definition.perRun.maxCharacters))
      || (action.state === 'succeeded' && !isOutputMetadata(action.output)) || (action.state !== 'succeeded' && action.output !== null)
      || (action.state === 'failed') !== (action.failureReason !== null) || (action.state === 'unknown') !== (action.unknownReason !== null)
      || (action.failureReason !== null && !FAILURE_REASONS.includes(action.failureReason))
      || (action.unknownReason !== null && !UNKNOWN_REASONS.includes(action.unknownReason))
      || (action.state === 'succeeded' || action.state === 'unknown') !== (action.chargedCostUsdMicros === action.reservation.costUsdMicros)
      || (action.state === 'reserved' || action.state === 'dispatching' || action.state === 'failed') !== (action.chargedCostUsdMicros === 0)
      || terminal !== (action.finalizedAt !== null)
      || (action.state === 'dispatching' || action.state === 'succeeded' || action.state === 'unknown') !== (action.dispatchingAt !== null)
      || (action.output !== null && ((action.operation === 'fyt.gemini-3-pro-image-2k' && action.output.mediaType === 'audio/mpeg')
        || (action.operation === 'fyt.elevenlabs.locked-tts' && action.output.mediaType !== 'audio/mpeg')))) {
      fail('journal-unavailable', 'paid action journal is invalid');
    }
    // A failed action charged $0 and produced no artifact, so it never holds the path; only
    // reserved/dispatching/succeeded/unknown claim ownership uniqueness.
    const ownsArtifact = action.state !== 'failed';
    if (!expectedIdentity || expectedIdentity.ownershipKey !== action.artifactOwnershipKey
      || (ownsArtifact && seenArtifactOwnershipKeys.has(action.artifactOwnershipKey))
      || (action.output !== null && action.output.artifactPath !== action.expectedArtifactPath)) {
      fail('journal-unavailable', 'paid action journal is invalid');
    }
    seen.add(action.idempotencyKey);
    if (ownsArtifact) seenArtifactOwnershipKeys.add(action.artifactOwnershipKey);
  }
}

interface PaidActionUsage {
  calls: number;
  costUsdMicros: number;
  characters: number;
  potentialOutputs: number;
}

function stateConsumesSpend(state: PaidActionState): boolean {
  return state !== 'failed';
}

function usageFor(actions: readonly PaidActionRecord[], matcher: (action: PaidActionRecord) => boolean): PaidActionUsage {
  let calls = 0;
  let costUsdMicros = 0;
  let characters = 0;
  let potentialOutputs = 0;
  for (const action of actions) {
    if (!matcher(action)) continue;
    // Even a pre-dispatch failure consumes one of the explicit call slots. Only dollars/characters
    // are released at failed, which preserves the $0 recovery rule without allowing infinite probes.
    calls += action.reservation.calls;
    if (action.state === 'reserved' || action.state === 'dispatching' || action.state === 'succeeded') potentialOutputs += 1;
    if (stateConsumesSpend(action.state)) {
      costUsdMicros += action.reservation.costUsdMicros;
      characters += action.reservation.characters;
    }
  }
  return { calls, costUsdMicros, characters, potentialOutputs };
}

function exceedsCaps(usage: PaidActionUsage, addition: PaidActionReservation, caps: PaidActionCaps): boolean {
  return usage.calls + addition.calls > caps.maxCalls
    || usage.costUsdMicros + addition.costUsdMicros > caps.maxCostUsdMicros
    || usage.characters + addition.characters > caps.maxCharacters
    || usage.potentialOutputs + 1 > caps.maxOutputs;
}

function artifactIdentity(value: unknown, extension: '.png' | '.mp3'): { path: string; ownershipKey: string } | null {
  if (typeof value !== 'string') return null;
  const path = value.replace(/\\/g, '/');
  if (path.length > 512 || !SAFE_ARTIFACT_PATH.test(path) || !path.toLowerCase().endsWith(extension)
    || !path.toLowerCase().startsWith(PAID_ARTIFACT_NAMESPACE)
    || path.split('/').some((segment) => /[. ]$/.test(segment) || WINDOWS_RESERVED_SEGMENT.test(segment))) return null;
  // The allowed alphabet is ASCII, so this is the same identity comparison Windows applies without
  // locale ambiguity. Persisting it makes journal ownership validation independent of host casing.
  return { path, ownershipKey: path.toLowerCase() };
}

function requireArtifactPath(value: unknown, extension: '.png' | '.mp3'): { path: string; ownershipKey: string } {
  const identity = artifactIdentity(value, extension);
  if (!identity) fail('invalid-input', 'expected artifact path is invalid');
  return identity;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function isPngEnvelope(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 45 || !PNG_SIGNATURE.every((byte, index) => bytes[index] === byte)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = PNG_SIGNATURE.byteLength;
  let chunkIndex = 0;
  let hasIdat = false;
  while (offset + 12 <= bytes.byteLength) {
    const length = view.getUint32(offset, false);
    if (length > MAX_PROVIDER_OUTPUT_BYTES || offset + 12 + length > bytes.byteLength) return false;
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = String.fromCharCode(...typeBytes);
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    const dataEnd = offset + 8 + length;
    const storedCrc = view.getUint32(dataEnd, false);
    if (crc32(bytes.subarray(offset + 4, dataEnd)) !== storedCrc) return false;
    if (chunkIndex === 0) {
      if (type !== 'IHDR' || length !== 13 || view.getUint32(offset + 8, false) < 1 || view.getUint32(offset + 12, false) < 1) return false;
    } else if (type === 'IDAT') {
      hasIdat = true;
    } else if (type === 'IEND') {
      return length === 0 && hasIdat && dataEnd + 4 === bytes.byteLength;
    }
    offset = dataEnd + 4;
    chunkIndex += 1;
  }
  return false;
}

function isFixedMp3Envelope(bytes: Uint8Array): boolean {
  let offset = 0;
  if (bytes.byteLength >= 10 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) {
    if ([bytes[6], bytes[7], bytes[8], bytes[9]].some((byte) => byte === undefined || (byte & 0x80) !== 0)) return false;
    const tagSize = ((bytes[6] ?? 0) << 21) | ((bytes[7] ?? 0) << 14) | ((bytes[8] ?? 0) << 7) | (bytes[9] ?? 0);
    offset = 10 + tagSize;
  }
  if (offset + 417 > bytes.byteLength) return false;
  const header = ((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16)
    | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
  // MPEG-1 Layer III, 128 kbps, 44.1 kHz. A complete unpadded frame is 417 bytes.
  return (header >>> 21) === 0x7ff && ((header >>> 19) & 0b11) === 0b11
    && ((header >>> 17) & 0b11) === 0b01 && ((header >>> 12) & 0b1111) === 0b1001
    && ((header >>> 10) & 0b11) === 0;
}

function normalizedImageSeeds(value: unknown): PaidActionImageSeed[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_IMAGE_SEEDS) {
    fail('invalid-input', `image seeds must contain between 1 and ${MAX_IMAGE_SEEDS} PNGs`);
  }
  return value.map((candidate) => {
    const seed = candidate as Partial<PaidActionImageSeed>;
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate) || !(seed.bytes instanceof Uint8Array)
      || seed.bytes.byteLength > MAX_IMAGE_SEED_BYTES || !isPngEnvelope(seed.bytes)
      || typeof seed.sha256 !== 'string' || !SHA256.test(seed.sha256)
      || createHash('sha256').update(seed.bytes).digest('hex') !== seed.sha256) {
      fail('invalid-input', 'image seed is not a digest-matched PNG');
    }
    return { bytes: Uint8Array.from(seed.bytes), sha256: seed.sha256 };
  });
}

function normalize(input: PaidActionRequest): NormalizedAction {
  requireSafeRef(input.runRef, 'run reference');
  requireSafeRef(input.stageRef, 'stage reference');
  requireSafeRef(input.attemptRef, 'attempt reference');
  requireCallOrdinal(input.callOrdinal);
  const definition = FYT_PAID_ACTION_DEFINITIONS[input.operation];
  const channelId = 'channelId' in input ? input.channelId : null;
  if (!definition || input.stageId !== definition.stageId || channelId !== definition.channelId) {
    fail('invalid-input', 'operation is not allowed for this stage and channel');
  }

  let requestFingerprint: string;
  let reservation: PaidActionReservation;
  let expectedArtifactPath: string;
  let dispatchWithoutCredential: Omit<PaidActionDispatch, 'credential'>;
  if (input.operation === 'fyt.gemini-3-pro-image-2k') {
    const prompt = requireContent(input.prompt, 'image prompt', MAX_IMAGE_PROMPT_CHARACTERS);
    const seeds = normalizedImageSeeds(input.seeds);
    const artifact = requireArtifactPath(input.expectedArtifactPath, '.png');
    expectedArtifactPath = artifact.path;
    requestFingerprint = digest({
      operation: input.operation,
      prompt,
      aspectRatio: FIXED_IMAGE_ASPECT_RATIO,
      seedDigests: seeds.map((seed) => seed.sha256),
      expectedArtifactPath,
    });
    reservation = { calls: 1, costUsdMicros: definition.reservation.costUsdMicros, characters: 0 };
    dispatchWithoutCredential = {
      provider: 'gemini', operation: input.operation,
      request: {
        model: 'gemini-3-pro-image', imageSize: '2K', aspectRatio: FIXED_IMAGE_ASPECT_RATIO, prompt,
        seeds: seeds.map((seed) => ({ mediaType: 'image/png', bytes: Uint8Array.from(seed.bytes), sha256: seed.sha256 })),
      },
    };
  } else {
    const text = requireContent(input.text, 'narration text', FYT_THIN_SLICE_TTS_MAX_CHARACTERS);
    const characters = characterCount(text);
    const artifact = requireArtifactPath(input.expectedArtifactPath, '.mp3');
    expectedArtifactPath = artifact.path;
    requestFingerprint = digest({
      operation: input.operation, channelId: input.channelId, text,
      expectedArtifactPath, policy: THE_SECOND_TAKE_LOCKED_TTS,
    });
    reservation = { calls: 1, costUsdMicros: definition.reservation.costUsdMicros, characters };
    dispatchWithoutCredential = {
      provider: 'elevenlabs', operation: input.operation,
      request: { ...THE_SECOND_TAKE_LOCKED_TTS, text },
    };
  }
  const idempotencyKey = digest({
    schema: 'kb.paid-action-idempotency/v4',
    runRef: input.runRef,
    stageRef: input.stageRef,
    attemptRef: input.attemptRef,
    callOrdinal: input.callOrdinal,
    stageId: input.stageId,
    channelId,
    operation: input.operation,
  });
  return {
    input,
    definition,
    idempotencyKey,
    actionRef: `paid-${idempotencyKey.slice(0, 32)}`,
    requestFingerprint,
    reservation,
    expectedArtifactPath,
    artifactOwnershipKey: artifactIdentity(expectedArtifactPath, input.operation === 'fyt.gemini-3-pro-image-2k' ? '.png' : '.mp3')?.ownershipKey
      ?? fail('invalid-input', 'expected artifact path is invalid'),
    dispatchWithoutCredential,
  };
}

function policyFingerprint(): string {
  return digest({
    schema: 'kb.paid-action-policy/v4',
    definitions: FYT_PAID_ACTION_DEFINITIONS,
    theSecondTakeLockedTts: THE_SECOND_TAKE_LOCKED_TTS,
  });
}

function journalError(error: unknown): PaidActionError {
  if (error instanceof PaidActionError) return error;
  return new PaidActionError('journal-unavailable', 'paid action journal is unavailable');
}

function validateProviderResult(operation: PaidActionOperation, result: PaidActionProviderResult): void {
  const provider = FYT_PAID_ACTION_DEFINITIONS[operation].provider;
  if (!result || typeof result !== 'object' || result.provider !== provider || !(result.bytes instanceof Uint8Array)
    || result.bytes.byteLength < 1 || result.bytes.byteLength > MAX_PROVIDER_OUTPUT_BYTES
    || (provider === 'gemini' && result.mediaType !== 'image/png')
    || (provider === 'elevenlabs' && result.mediaType !== 'audio/mpeg')
    || (provider === 'gemini' && !isPngEnvelope(result.bytes))
    || (provider === 'elevenlabs' && !isFixedMp3Envelope(result.bytes))) {
    throw new Error('provider result does not match the paid operation');
  }
}

function copyProviderResult(result: PaidActionProviderResult): PaidActionProviderResult {
  return result.provider === 'gemini'
    ? { provider: 'gemini', mediaType: result.mediaType, bytes: Uint8Array.from(result.bytes) }
    : { provider: 'elevenlabs', mediaType: 'audio/mpeg', bytes: Uint8Array.from(result.bytes) };
}

function metadataMatches(left: PaidActionOutputMetadata, right: PaidActionOutputMetadata): boolean {
  return left.artifactPath === right.artifactPath && left.mediaType === right.mediaType
    && left.byteLength === right.byteLength && left.sha256 === right.sha256;
}

function validateCommittedMetadata(
  result: PaidActionProviderResult,
  expectedArtifactPath: string,
  committed: PaidActionOutputMetadata,
): PaidActionOutputMetadata {
  const expected: PaidActionOutputMetadata = {
    artifactPath: expectedArtifactPath,
    mediaType: result.mediaType,
    byteLength: result.bytes.byteLength,
    sha256: createHash('sha256').update(result.bytes).digest('hex'),
  };
  if (!isOutputMetadata(committed) || !metadataMatches(committed, expected)) {
    throw new Error('committed artifact metadata does not match provider bytes and declared output');
  }
  return structuredClone(committed);
}

/**
 * Server-owned spend boundary for the bounded FYT media slice.
 *
 * Startup reconciliation is explicit and must complete before `execute`. Under the one-daemon
 * production assumption, a leftover `reserved` never reached a provider and becomes failed/$0;
 * `dispatching` may have reached one and becomes unknown/charged. Neither state is re-dispatched.
 */
export function createPaidActionService(options: PaidActionServiceOptions): {
  reconcileStartup(): Promise<{ failed: number; unknown: number }>;
  execute(input: PaidActionRequest): Promise<PaidActionResult>;
  snapshot(): ReadonlyArray<Omit<PaidActionRecord, 'requestFingerprint'>>;
} {
  if (!isAbsolute(options.stateRoot) || options.stateRoot.includes('\0')) {
    fail('invalid-input', 'paid action state root is invalid');
  }
  const stateRoot = resolve(options.stateRoot);
  const now = options.now ?? (() => new Date());
  const expectedPolicyFingerprint = policyFingerprint();
  const document = createAtomicJsonDocument<PaidActionJournal>({
    path: join(stateRoot, 'control', 'paid-actions.json'),
    empty: () => ({ schema: 'kb.paid-action-journal/v4', revision: 0, policyFingerprint: expectedPolicyFingerprint, actions: [] }),
    validate: assertJournal,
    error: (message) => new PaidActionError('journal-unavailable', message),
    maxBytes: MAX_JOURNAL_BYTES,
    lockTimeoutMs: options.lockTimeoutMs,
  });
  let startupReconciled = false;

  const requirePolicy = (journal: PaidActionJournal): void => {
    if (journal.policyFingerprint !== expectedPolicyFingerprint) {
      fail('journal-unavailable', 'paid action policy differs from the durable journal');
    }
  };
  const mutate = async <T>(callback: (journal: PaidActionJournal) => T | Promise<T>): Promise<T> => {
    try {
      return await document.mutate(async (journal) => {
        requirePolicy(journal);
        return callback(journal);
      });
    } catch (error) {
      throw journalError(error);
    }
  };
  const read = (): PaidActionJournal => {
    try {
      const journal = document.read();
      requirePolicy(journal);
      return journal;
    } catch (error) {
      throw journalError(error);
    }
  };

  const reserve = async (action: NormalizedAction): Promise<{ record: PaidActionRecord; created: boolean }> => mutate((journal) => {
    const prior = journal.actions.find((candidate) => candidate.idempotencyKey === action.idempotencyKey);
    if (prior) {
      const channelId = 'channelId' in action.input ? action.input.channelId : null;
      if (prior.requestFingerprint !== action.requestFingerprint || prior.runRef !== action.input.runRef || prior.stageRef !== action.input.stageRef
        || prior.stageId !== action.input.stageId || prior.channelId !== channelId || prior.operation !== action.input.operation
        || prior.attemptRef !== action.input.attemptRef || prior.callOrdinal !== action.input.callOrdinal
        || prior.expectedArtifactPath !== action.expectedArtifactPath || prior.artifactOwnershipKey !== action.artifactOwnershipKey
        || canonical(prior.reservation) !== canonical(action.reservation)) {
        fail('idempotency-conflict', 'paid action replay differs from its original request');
      }
      return { record: prior, created: false };
    }

    const sequence = journal.actions.filter((candidate) => candidate.runRef === action.input.runRef
      && candidate.stageRef === action.input.stageRef && candidate.attemptRef === action.input.attemptRef
      && candidate.operation === action.input.operation);
    const expectedOrdinal = sequence.length + 1;
    if (action.input.callOrdinal !== expectedOrdinal) {
      fail('call-out-of-order', `paid action call ordinal must be ${expectedOrdinal}`);
    }
    if (sequence.some((candidate) => candidate.state === 'reserved' || candidate.state === 'dispatching')) {
      fail('attempt-in-progress', 'the preceding paid action call is still in progress');
    }
    // A failed action charged $0 and produced no artifact, so it does not permanently own its path.
    if (journal.actions.some((candidate) => candidate.state !== 'failed' && candidate.artifactOwnershipKey === action.artifactOwnershipKey)) {
      fail('invalid-input', 'expected artifact path is already owned by another paid action');
    }

    const runUsage = usageFor(journal.actions, (candidate) => candidate.runRef === action.input.runRef && candidate.operation === action.input.operation);
    const stageUsage = usageFor(journal.actions, (candidate) => candidate.runRef === action.input.runRef && candidate.stageRef === action.input.stageRef
      && candidate.operation === action.input.operation);
    if (exceedsCaps(runUsage, action.reservation, action.definition.perRun) || exceedsCaps(stageUsage, action.reservation, action.definition.perStage)) {
      fail('cap-exhausted', 'paid action cap is exhausted');
    }
    // Defense-in-depth absolute floor across ALL runs/stages, using the same spend-consuming rule as
    // usageFor/stateConsumesSpend (reserved/dispatching/succeeded/unknown consume; failed releases).
    // Enforced only at reserve time, mirroring how the per-run/per-stage caps work: a validly produced
    // journal never exceeds it (existing caps admit at most $1.445), so it is deliberately NOT an
    // assertJournal invariant — a load-time throw would brick reads of an otherwise readable journal.
    const journalUsage = usageFor(journal.actions, () => true);
    if (journalUsage.costUsdMicros + action.reservation.costUsdMicros > FYT_PAID_ACTION_GLOBAL_CEILING_USD_MICROS) {
      fail('cap-exhausted', 'paid action global spend ceiling is exhausted');
    }
    const channelId = 'channelId' in action.input ? action.input.channelId : null;
    const record: PaidActionRecord = {
      idempotencyKey: action.idempotencyKey,
      actionRef: action.actionRef,
      runRef: action.input.runRef,
      stageRef: action.input.stageRef,
      stageId: action.input.stageId,
      channelId,
      operation: action.input.operation,
      attemptRef: action.input.attemptRef,
      callOrdinal: action.input.callOrdinal,
      expectedArtifactPath: action.expectedArtifactPath,
      artifactOwnershipKey: action.artifactOwnershipKey,
      requestFingerprint: action.requestFingerprint,
      reservation: action.reservation,
      state: 'reserved',
      chargedCostUsdMicros: 0,
      output: null,
      failureReason: null,
      unknownReason: null,
      reservedAt: now().toISOString(),
      dispatchingAt: null,
      finalizedAt: null,
    };
    journal.actions.push(record);
    journal.revision += 1;
    return { record, created: true };
  });

  const transition = async (
    action: NormalizedAction,
    expected: PaidActionState,
    next: PaidActionState,
    detail: { output?: PaidActionOutputMetadata; failureReason?: PaidActionFailureReason; unknownReason?: PaidActionUnknownReason } = {},
  ): Promise<PaidActionRecord> => mutate((journal) => {
    const record = journal.actions.find((candidate) => candidate.idempotencyKey === action.idempotencyKey);
    if (!record || record.requestFingerprint !== action.requestFingerprint) {
      fail('idempotency-conflict', 'paid action journal identity changed');
    }
    if (record.state !== expected) fail('attempt-in-progress', 'paid action state changed during dispatch');
    record.state = next;
    if (next === 'dispatching') record.dispatchingAt = now().toISOString();
    if (next === 'succeeded' || next === 'failed' || next === 'unknown') {
      record.finalizedAt = now().toISOString();
      record.chargedCostUsdMicros = next === 'failed' ? 0 : record.reservation.costUsdMicros;
      record.output = next === 'succeeded' ? detail.output ?? null : null;
      record.failureReason = next === 'failed' ? detail.failureReason ?? null : null;
      record.unknownReason = next === 'unknown' ? detail.unknownReason ?? null : null;
    }
    journal.revision += 1;
    return record;
  });

  const replay = async (action: NormalizedAction, record: PaidActionRecord): Promise<PaidActionResult> => {
    if (record.state === 'succeeded' && record.output) {
      let measured: PaidActionOutputMetadata | null;
      try {
        measured = await options.verifier.verify({ actionRef: record.actionRef, output: structuredClone(record.output) });
      } catch {
        // A THROW is a transient read failure, not evidence the paid artifact is gone. Surface it as a
        // retryable error and leave the succeeded record (and its charge) untouched — only a RETURNED
        // null/mismatch is proof the artifact is missing or wrong and downgrades to unknown below.
        fail('artifact-verification-unavailable', 'paid action artifact verification is temporarily unavailable');
      }
      if (!measured || !isOutputMetadata(measured) || !metadataMatches(measured, record.output)) {
        const unknown = await transition(action, 'succeeded', 'unknown', { unknownReason: 'artifact-verification-failed' });
        return { status: 'unknown', actionRef: unknown.actionRef, reason: 'artifact-verification-failed' };
      }
      return { status: 'replayed', actionRef: record.actionRef, priorState: 'succeeded', output: structuredClone(record.output) };
    }
    if (record.state === 'failed' && record.failureReason) {
      return { status: 'replayed', actionRef: record.actionRef, priorState: 'failed', reason: record.failureReason };
    }
    if (record.state === 'unknown' && record.unknownReason) {
      return { status: 'replayed', actionRef: record.actionRef, priorState: 'unknown', reason: record.unknownReason };
    }
    fail('journal-unavailable', 'paid action terminal state is incomplete');
  };

  return {
    async reconcileStartup() {
      if (startupReconciled) return { failed: 0, unknown: 0 };
      const result = await mutate((journal) => {
        let failed = 0;
        let unknown = 0;
        const timestamp = now().toISOString();
        for (const record of journal.actions) {
          if (record.state === 'reserved') {
            record.state = 'failed';
            record.failureReason = 'startup-abandoned-reservation';
            record.finalizedAt = timestamp;
            record.chargedCostUsdMicros = 0;
            failed += 1;
          } else if (record.state === 'dispatching') {
            record.state = 'unknown';
            record.unknownReason = 'startup-abandoned-dispatch';
            record.finalizedAt = timestamp;
            record.chargedCostUsdMicros = record.reservation.costUsdMicros;
            unknown += 1;
          }
        }
        if (failed > 0 || unknown > 0) journal.revision += 1;
        return { failed, unknown };
      });
      startupReconciled = true;
      return result;
    },

    async execute(input) {
      if (!startupReconciled) fail('startup-reconciliation-required', 'paid action startup reconciliation has not completed');
      const action = normalize(input);
      const reservation = await reserve(action);
      const reserved = reservation.record;
      if (!reservation.created) {
        if (reserved.state === 'succeeded' || reserved.state === 'failed' || reserved.state === 'unknown') return replay(action, reserved);
        fail('attempt-in-progress', 'paid action already has a held reservation');
      }
      if (reserved.state !== 'reserved') fail('journal-unavailable', 'paid action journal has an unsupported state');

      let credential: unknown | null | undefined;
      try {
        credential = await options.credentials.resolve({ provider: action.definition.provider });
      } catch {
        const failed = await transition(action, 'reserved', 'failed', { failureReason: 'credential-resolution-failed' });
        return { status: 'failed', actionRef: failed.actionRef, reason: 'credential-resolution-failed' };
      }
      if (credential === null || credential === undefined) {
        const failed = await transition(action, 'reserved', 'failed', { failureReason: 'credential-unavailable' });
        return { status: 'failed', actionRef: failed.actionRef, reason: 'credential-unavailable' };
      }

      await transition(action, 'reserved', 'dispatching');
      let providerResult: PaidActionProviderResult;
      try {
        providerResult = await options.transport.dispatch({ ...action.dispatchWithoutCredential, credential } as PaidActionDispatch);
        validateProviderResult(action.input.operation, providerResult);
        // Keep the journal's digest source private. A committer receives its own copy and cannot
        // mutate the bytes between artifact I/O and the durable output fingerprint.
        providerResult = copyProviderResult(providerResult);
      } catch {
        try {
          const unknown = await transition(action, 'dispatching', 'unknown', { unknownReason: 'transport-unconfirmed' });
          return { status: 'unknown', actionRef: unknown.actionRef, reason: 'transport-unconfirmed' };
        } catch (error) {
          // Durable `dispatching` is reconciled to charged/unknown at the next single-daemon startup.
          throw journalError(error);
        }
      }

      try {
        const committed = await options.committer.commit({
          actionRef: action.actionRef,
          runRef: action.input.runRef,
          stageRef: action.input.stageRef,
          attemptRef: action.input.attemptRef,
          callOrdinal: action.input.callOrdinal,
          operation: action.input.operation,
          expectedArtifactPath: action.expectedArtifactPath,
          result: copyProviderResult(providerResult),
        });
        const output = validateCommittedMetadata(providerResult, action.expectedArtifactPath, committed);
        const succeeded = await transition(action, 'dispatching', 'succeeded', { output });
        return { status: 'succeeded', actionRef: succeeded.actionRef, output: structuredClone(output) };
      } catch {
        try {
          const unknown = await transition(action, 'dispatching', 'unknown', { unknownReason: 'artifact-commit-unconfirmed' });
          return { status: 'unknown', actionRef: unknown.actionRef, reason: 'artifact-commit-unconfirmed' };
        } catch (error) {
          throw journalError(error);
        }
      }
    },

    snapshot() {
      return read().actions.map(({ requestFingerprint: _requestFingerprint, ...action }) => structuredClone(action));
    },
  };
}

import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, resolve, sep } from 'node:path';
import type {
  PaidActionArtifactVerifier,
  PaidActionCommitInput,
  PaidActionCommitter,
  PaidActionCredentialResolver,
  PaidActionDispatch,
  PaidActionOutputMetadata,
  PaidActionProvider,
  PaidActionProviderResult,
  PaidActionTransport,
} from './paidActionService.ts';

// The provider keys operators already carry in orgs/faceless-youtube/.env, read here from a source
// OUTSIDE any attempt worktree. Reusing the .env field names keeps one naming convention.
const SECRET_FIELD: Readonly<Record<PaidActionProvider, string>> = Object.freeze({
  gemini: 'GEMINI_API_KEY',
  elevenlabs: 'ELEVENLABS_API_KEY',
});
// A secrets file is a tiny JSON map; a large file is a sign the path is wrong, so refuse it.
const MAX_SECRETS_FILE_BYTES = 64 * 1024;

const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const ELEVENLABS_BASE_URL = 'https://api.elevenlabs.io/v1';
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * Server-side provider credential resolver.
 *
 * SECURITY (flag for review): the whole point of moving the provider call server-side is that the
 * API key must be unreachable from an attempt worktree. This resolver reads the key from a
 * daemon-only JSON secrets file whose absolute path comes from `DASHBOARD_PROVIDER_SECRETS` and MUST
 * live OUTSIDE the repo / any `stateRoot/control/worktrees/` attempt tree. Two properties keep the
 * key off the worker:
 *   1. `git worktree add` never copies the untracked secrets file (it is not tracked and lives
 *      outside the checkout), and the kit-upward `.env` walk cannot reach it.
 *   2. The carrier env var name contains "SECRET", which the host env denylist strips from every
 *      spawned child, so a worker never even learns the path.
 * A `worktreesRoot` guard additionally refuses, at construction, a secrets path that resolves inside
 * the attempt-worktree tree (a misconfiguration that would defeat the isolation). The key is read on
 * demand, never cached, never logged, never persisted, and never returned through a snapshot.
 *
 * `env` is a documented fallback source (the daemon's OWN process.env — a different scope from the
 * denylisted child env): only consulted when no secrets file is configured. The file is the
 * recommended production carrier; wire `DASHBOARD_PROVIDER_SECRETS` in the daemon.
 */
export interface ProviderCredentialResolverOptions {
  secretsPath?: string;
  worktreesRoot?: string;
  env?: NodeJS.ProcessEnv;
  readFile?: (path: string) => string;
}

export function createProviderCredentialResolver(
  options: ProviderCredentialResolverOptions = {},
): PaidActionCredentialResolver {
  const secretsPath = options.secretsPath ?? process.env.DASHBOARD_PROVIDER_SECRETS;
  const env = options.env ?? process.env;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));

  if (secretsPath !== undefined) {
    if (!isAbsolute(secretsPath) || secretsPath.includes('\0')) {
      throw new Error('provider secrets path must be an absolute path outside any worktree');
    }
    if (options.worktreesRoot !== undefined) {
      const root = resolve(options.worktreesRoot);
      const target = resolve(secretsPath);
      if (target === root || target.startsWith(root + sep)) {
        throw new Error('provider secrets path must not resolve inside the attempt worktree tree');
      }
    }
  }

  const fromFile = (provider: PaidActionProvider): string | null => {
    if (secretsPath === undefined) return null;
    let raw: string;
    try {
      raw = readFile(secretsPath);
    } catch {
      return null;
    }
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_SECRETS_FILE_BYTES) return null;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const value = (parsed as Record<string, unknown>)[SECRET_FIELD[provider]];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  const fromEnv = (provider: PaidActionProvider): string | null => {
    if (secretsPath !== undefined) return null;
    const value = env[SECRET_FIELD[provider]];
    return typeof value === 'string' && value.length > 0 ? value : null;
  };

  return {
    async resolve({ provider }) {
      return fromFile(provider) ?? fromEnv(provider);
    },
  };
}

/**
 * The only outbound provider boundary. Performs EXACTLY ONE HTTP attempt per dispatch — the paid
 * action service turns a retry into a fresh, separately-capped call, so there is no retry loop here.
 * On any network failure, non-2xx, or malformed response it throws a STABLE, non-provider error; the
 * caught provider error and its body never cross this boundary (no key/PII leakage), and the service
 * maps the throw to `transport-unconfirmed`. Envelope (PNG/MP3) validation belongs to the service.
 */
export interface ProviderTransportOptions {
  fetch?: typeof globalThis.fetch;
  geminiBaseUrl?: string;
  elevenLabsBaseUrl?: string;
  requestTimeoutMs?: number;
}

function transportError(): Error {
  // Deliberately opaque: the caught provider error/body must never travel with it.
  return new Error('paid action transport did not confirm a provider result');
}

export function createProviderTransport(options: ProviderTransportOptions = {}): PaidActionTransport {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  const geminiBaseUrl = options.geminiBaseUrl ?? GEMINI_BASE_URL;
  const elevenLabsBaseUrl = options.elevenLabsBaseUrl ?? ELEVENLABS_BASE_URL;
  const timeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  if (typeof fetchImpl !== 'function') throw new Error('paid action transport requires a fetch implementation');

  const attempt = async (url: string, headers: Record<string, string>, body: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw transportError();
    }
    if (!response.ok) throw transportError();
    try {
      return await response.json();
    } catch {
      throw transportError();
    }
  };

  return {
    async dispatch(input: PaidActionDispatch): Promise<PaidActionProviderResult> {
      const credential = input.credential;
      if (typeof credential !== 'string' || credential.length === 0) throw transportError();

      if (input.provider === 'gemini') {
        const { request } = input;
        // Mirror forge.py's nano(): inline PNG seed parts first, then the prompt text part, with the
        // fixed 2K / 16:9 imageConfig and IMAGE responseModality.
        const parts: unknown[] = request.seeds.map((seed) => ({
          inlineData: { mimeType: seed.mediaType, data: Buffer.from(seed.bytes).toString('base64') },
        }));
        parts.push({ text: request.prompt });
        const body = {
          contents: [{ parts }],
          generationConfig: {
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: request.aspectRatio, imageSize: request.imageSize },
          },
        };
        const url = `${geminiBaseUrl}/models/${encodeURIComponent(request.model)}:generateContent`;
        // Auth via the documented header rather than forge.py's `?key=` query param: an API key in a
        // URL leaks into access logs and error strings, and the key must never leave the server.
        const json = await attempt(url, { 'content-type': 'application/json', 'x-goog-api-key': credential }, body);
        const raw = extractGeminiBytes(json);
        if (!raw) throw transportError();
        // gemini-3-pro-image returns image/jpeg (forge.py:97); the service validates a PNG envelope
        // before the committer runs, so transcode JPEG->PNG here at the one place bytes enter the
        // pipeline, mirroring forge.py's to_png_bytes(). PNG passes through; anything else is unusable.
        const png = toPngBytes(raw);
        if (!png) throw transportError();
        return { provider: 'gemini', mediaType: 'image/png', bytes: png };
      }

      const { request } = input;
      // Mirror voiceover.py's tts_request(): /with-timestamps returns JSON {audio_base64, alignment}.
      // The frozen voice settings ship snake_case as the ElevenLabs API expects; v3 carries no
      // previous_text/next_text (the API rejects them), and this transport sends none.
      const body = {
        text: request.text,
        model_id: request.modelId,
        voice_settings: {
          stability: request.voiceSettings.stability,
          similarity_boost: request.voiceSettings.similarityBoost,
          style: request.voiceSettings.style,
          use_speaker_boost: request.voiceSettings.useSpeakerBoost,
          speed: request.voiceSettings.speed,
        },
      };
      const url = `${elevenLabsBaseUrl}/text-to-speech/${encodeURIComponent(request.voiceId)}`
        + `/with-timestamps?output_format=${encodeURIComponent(request.outputFormat)}`;
      const json = await attempt(
        url,
        { 'content-type': 'application/json', accept: 'application/json', 'xi-api-key': credential },
        body,
      );
      const bytes = extractElevenLabsBytes(json);
      if (!bytes) throw transportError();
      return { provider: 'elevenlabs', mediaType: 'audio/mpeg', bytes };
    },
  };
}

function hasPngSignature(bytes: Uint8Array): boolean {
  return bytes.byteLength >= PNG_SIGNATURE.byteLength && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Normalize provider image bytes to a valid PNG at the transport boundary, mirroring forge.py's
 * to_png_bytes(): already-PNG passes through untouched; JPEG (FF D8 FF) is decoded to RGBA and
 * re-encoded to PNG with pure-JS libraries (no native build — this daemon runs on Windows). Anything
 * else returns null so the caller throws its stable opaque error. pngjs emits a spec-correct envelope
 * (IHDR with non-zero dims, IDAT, IEND, valid CRCs), which the service's PNG validation requires.
 */
function toPngBytes(bytes: Uint8Array): Uint8Array | null {
  if (hasPngSignature(bytes)) return bytes;
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    try {
      const decoded = jpeg.decode(Buffer.from(bytes), { useTArray: true, maxMemoryUsageInMB: 512 });
      if (!decoded || !decoded.width || !decoded.height || !decoded.data
        || decoded.data.length !== decoded.width * decoded.height * 4) {
        return null;
      }
      const png = new PNG({ width: decoded.width, height: decoded.height });
      png.data.set(decoded.data);
      return Uint8Array.from(PNG.sync.write(png));
    } catch {
      return null;
    }
  }
  return null;
}

function extractGeminiBytes(json: unknown): Uint8Array | null {
  const body = json as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: unknown } }> } }> };
  const parts = body?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const data = part?.inlineData?.data;
    if (typeof data === 'string' && data.length > 0) {
      const bytes = Uint8Array.from(Buffer.from(data, 'base64'));
      if (bytes.byteLength > 0) return bytes;
    }
  }
  return null;
}

function extractElevenLabsBytes(json: unknown): Uint8Array | null {
  const audio = (json as { audio_base64?: unknown })?.audio_base64;
  if (typeof audio !== 'string' || audio.length === 0) return null;
  const bytes = Uint8Array.from(Buffer.from(audio, 'base64'));
  return bytes.byteLength > 0 ? bytes : null;
}

function resolveWithinRoot(root: string, relativePath: string): string | null {
  const base = resolve(root);
  const target = resolve(base, relativePath);
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

function sniffMediaType(bytes: Uint8Array): PaidActionOutputMetadata['mediaType'] | null {
  if (bytes.byteLength >= PNG_SIGNATURE.byteLength && PNG_SIGNATURE.every((b, i) => bytes[i] === b)) {
    return 'image/png';
  }
  // MP3: an ID3v2 tag ("ID3") or a raw MPEG audio frame sync (11 set bits).
  if (bytes.byteLength >= 3 && bytes[0] === 0x49 && bytes[1] === 0x44 && bytes[2] === 0x33) return 'audio/mpeg';
  if (bytes.byteLength >= 2 && bytes[0] === 0xff && ((bytes[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

/**
 * Writes provider bytes to the attempt artifact ATOMICALLY (temp + fsync + rename, mirroring
 * forge.py / atomicJsonDocument.save) under a configured asset root. The service already validated
 * the path shape; this still refuses any resolution that escapes the root. The returned metadata is
 * computed from the exact bytes written.
 */
export interface ProviderCommitterOptions {
  repoRoot: string;
}

export function createProviderCommitter(options: ProviderCommitterOptions): PaidActionCommitter {
  if (!isAbsolute(options.repoRoot) || options.repoRoot.includes('\0')) {
    throw new Error('paid action committer repo root must be an absolute path');
  }
  const repoRoot = resolve(options.repoRoot);

  return {
    async commit(input: PaidActionCommitInput): Promise<PaidActionOutputMetadata> {
      const target = resolveWithinRoot(repoRoot, input.expectedArtifactPath);
      if (!target) throw new Error('paid action artifact path escapes the asset root');
      const bytes = input.result.bytes;
      mkdirSync(dirname(target), { recursive: true, mode: 0o700 });
      const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
      let fd: number | null = null;
      try {
        fd = openSync(temp, 'wx', 0o600);
        writeFileSync(fd, bytes);
        fsyncSync(fd);
        closeSync(fd);
        fd = null;
        renameSync(temp, target);
      } finally {
        if (fd !== null) closeSync(fd);
        if (existsSync(temp)) rmSync(temp, { force: true });
      }
      return {
        artifactPath: input.expectedArtifactPath,
        mediaType: input.result.mediaType,
        byteLength: bytes.byteLength,
        sha256: createHash('sha256').update(bytes).digest('hex'),
      };
    },
  };
}

/**
 * Re-reads a committed artifact from disk under the same root resolution as the committer and
 * re-measures byteLength + sha256 + mediaType. Returns fresh metadata when the file exists and is a
 * recognizable PNG/MP3, `null` when the file is missing or unrecognizable (the service downgrades
 * that to `unknown`), and THROWS on a genuine transient read error (the service treats a throw as
 * retryable). It never calls a provider.
 */
export function createProviderArtifactVerifier(options: ProviderCommitterOptions): PaidActionArtifactVerifier {
  if (!isAbsolute(options.repoRoot) || options.repoRoot.includes('\0')) {
    throw new Error('paid action verifier repo root must be an absolute path');
  }
  const repoRoot = resolve(options.repoRoot);

  return {
    async verify({ output }): Promise<PaidActionOutputMetadata | null> {
      const target = resolveWithinRoot(repoRoot, output.artifactPath);
      if (!target) return null;
      let bytes: Buffer;
      try {
        bytes = readFileSync(target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        // A non-missing read failure (EACCES/EBUSY/EIO) is transient, not proof the artifact is gone.
        throw new Error('paid action artifact verification is temporarily unavailable');
      }
      const measured = Uint8Array.from(bytes);
      const mediaType = sniffMediaType(measured);
      if (!mediaType || measured.byteLength === 0) return null;
      return {
        artifactPath: output.artifactPath,
        mediaType,
        byteLength: measured.byteLength,
        sha256: createHash('sha256').update(measured).digest('hex'),
      };
    },
  };
}

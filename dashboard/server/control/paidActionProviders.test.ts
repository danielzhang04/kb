import { afterEach, describe, expect, it } from 'vitest';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { PaidActionDispatch } from './paidActionService.ts';
import {
  createProviderArtifactVerifier,
  createProviderCommitter,
  createProviderCredentialResolver,
  createProviderTransport,
} from './paidActionProviders.ts';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paid-providers-'));
  roots.push(root);
  return root;
}

const PNG_MAGIC = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const MP3_MAGIC = Uint8Array.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
const ARTIFACT_REL = 'orgs/faceless-youtube/channels/the-second-take/videos/demo/assets/scenes/s1.png';

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

// A genuine, spec-correct PNG built with pngjs — the pass-through fixture.
function pngFixture(width = 3, height = 2): Uint8Array {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 1) png.data[i] = (i * 37 + 11) & 0xff;
  return Uint8Array.from(PNG.sync.write(png));
}

// A genuine JPEG built with jpeg-js — the transcode fixture (FF D8 FF magic).
function jpegFixture(width = 8, height = 8): Uint8Array {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = 200; data[i + 1] = 100; data[i + 2] = 50; data[i + 3] = 255;
  }
  const encoded = jpeg.encode({ data, width, height }, 90);
  return Uint8Array.from(encoded.data);
}

// A faithful re-derivation of paidActionService's (non-exported) isPngEnvelope + crc32, so the test
// proves the transcoded output passes the exact envelope validation the service applies.
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const MAX_PROVIDER_OUTPUT_BYTES = 64 * 1024 * 1024;
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
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (!/^[A-Za-z]{4}$/.test(type)) return false;
    const dataEnd = offset + 8 + length;
    if (crc32(bytes.subarray(offset + 4, dataEnd)) !== view.getUint32(dataEnd, false)) return false;
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

function geminiImageResponse(imageBytes: Uint8Array) {
  return {
    candidates: [{ content: { parts: [{ text: 'noise' }, { inlineData: { data: Buffer.from(imageBytes).toString('base64') } }] } }],
  };
}

interface RecordedCall {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(handler: (url: string, init: RequestInit | undefined) => { ok: boolean; status: number; json: () => Promise<unknown> }) {
  const calls: RecordedCall[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return handler(url, init) as unknown as Response;
  }) as unknown as typeof fetch;
  return { fn, calls };
}

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const geminiDispatch: PaidActionDispatch = {
  provider: 'gemini',
  operation: 'fyt.gemini-3-pro-image-2k',
  credential: 'gemini-secret-key',
  request: {
    model: 'gemini-3-pro-image',
    imageSize: '2K',
    aspectRatio: '16:9',
    prompt: 'a locked-style test frame',
    seeds: [{ mediaType: 'image/png', bytes: PNG_MAGIC, sha256: sha256(PNG_MAGIC) }],
  },
};

const elevenLabsDispatch: PaidActionDispatch = {
  provider: 'elevenlabs',
  operation: 'fyt.elevenlabs.locked-tts',
  credential: 'eleven-secret-key',
  request: {
    voiceId: 'iP95p4xoKVk53GoZ742B',
    modelId: 'eleven_v3',
    outputFormat: 'mp3_44100_128',
    voiceSettings: { stability: 0.1, similarityBoost: 0.85, style: 0.75, useSpeakerBoost: true, speed: 1.0 },
    text: 'the second take, take two',
  },
};

describe('createProviderTransport', () => {
  it('passes a fake gemini PNG 200 through unchanged and mirrors forge.py request shape', async () => {
    const returned = pngFixture();
    const { fn, calls } = fakeFetch(() => jsonResponse(200, geminiImageResponse(returned)));
    const transport = createProviderTransport({ fetch: fn });
    const result = await transport.dispatch(geminiDispatch);

    // Already-PNG bytes pass through byte-identically (no needless re-encode).
    expect(result).toEqual({ provider: 'gemini', mediaType: 'image/png', bytes: returned });
    expect(isPngEnvelope(result.bytes)).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro-image:generateContent');
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['x-goog-api-key']).toBe('gemini-secret-key');
    expect(calls[0]!.url).not.toContain('gemini-secret-key');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.generationConfig).toEqual({ responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '16:9', imageSize: '2K' } });
    expect(body.contents[0].parts[0].inlineData.mimeType).toBe('image/png');
    expect(body.contents[0].parts.at(-1).text).toBe('a locked-style test frame');
  });

  it('maps a fake elevenlabs 200 to mp3 bytes with snake_case voice settings and xi-api-key', async () => {
    const returned = Uint8Array.from([1, 2, 3, 4, 5]);
    const { fn, calls } = fakeFetch(() => jsonResponse(200, { audio_base64: Buffer.from(returned).toString('base64'), alignment: {} }));
    const transport = createProviderTransport({ fetch: fn });
    const result = await transport.dispatch(elevenLabsDispatch);

    expect(result).toEqual({ provider: 'elevenlabs', mediaType: 'audio/mpeg', bytes: returned });
    expect(calls[0]!.url).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/iP95p4xoKVk53GoZ742B/with-timestamps?output_format=mp3_44100_128',
    );
    const headers = calls[0]!.init!.headers as Record<string, string>;
    expect(headers['xi-api-key']).toBe('eleven-secret-key');
    const body = JSON.parse(String(calls[0]!.init!.body));
    expect(body.model_id).toBe('eleven_v3');
    expect(body.voice_settings).toEqual({ stability: 0.1, similarity_boost: 0.85, style: 0.75, use_speaker_boost: true, speed: 1.0 });
    expect(body.previous_text).toBeUndefined();
  });

  it('throws a stable error on a non-2xx without leaking the provider body', async () => {
    const { fn } = fakeFetch(() => jsonResponse(500, { error: { message: 'LEAK-gemini-secret-key-and-account-email' } }));
    const transport = createProviderTransport({ fetch: fn });
    await expect(transport.dispatch(geminiDispatch)).rejects.toThrow('paid action transport did not confirm a provider result');
    await expect(transport.dispatch(geminiDispatch)).rejects.not.toThrow(/LEAK/);
  });

  it('throws a stable error on a 200 with a malformed body (no inline image)', async () => {
    const { fn } = fakeFetch(() => jsonResponse(200, { candidates: [{ content: { parts: [{ text: 'no image here' }] } }] }));
    const transport = createProviderTransport({ fetch: fn });
    await expect(transport.dispatch(geminiDispatch)).rejects.toThrow('paid action transport did not confirm a provider result');
  });

  it('transcodes a fake gemini JPEG 200 to a valid PNG envelope', async () => {
    const jpegBytes = jpegFixture();
    expect(jpegBytes[0]).toBe(0xff); // sanity: a real JPEG fixture
    expect(jpegBytes[1]).toBe(0xd8);
    const { fn } = fakeFetch(() => jsonResponse(200, geminiImageResponse(jpegBytes)));
    const transport = createProviderTransport({ fetch: fn });
    const result = await transport.dispatch(geminiDispatch);

    expect(result.provider).toBe('gemini');
    expect(result.mediaType).toBe('image/png');
    // Output starts with PNG magic, is NOT the JPEG input, and passes the service's envelope check.
    expect(Array.from(result.bytes.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(result.bytes).not.toEqual(jpegBytes);
    expect(isPngEnvelope(result.bytes)).toBe(true);
  });

  it('throws a stable error when the gemini image bytes are neither PNG nor JPEG', async () => {
    const junk = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const { fn } = fakeFetch(() => jsonResponse(200, geminiImageResponse(junk)));
    const transport = createProviderTransport({ fetch: fn });
    await expect(transport.dispatch(geminiDispatch)).rejects.toThrow('paid action transport did not confirm a provider result');
  });

  it('throws a stable error when fetch itself rejects (no caught error crosses the boundary)', async () => {
    const fn = (async () => { throw new Error('ECONNRESET at https://api/?key=eleven-secret-key'); }) as unknown as typeof fetch;
    const transport = createProviderTransport({ fetch: fn });
    await expect(transport.dispatch(elevenLabsDispatch)).rejects.toThrow('paid action transport did not confirm a provider result');
    await expect(transport.dispatch(elevenLabsDispatch)).rejects.not.toThrow(/eleven-secret-key/);
  });
});

describe('createProviderCommitter', () => {
  it('writes bytes atomically and returns matching sha256 + byteLength', async () => {
    const root = tempRoot();
    const committer = createProviderCommitter({ repoRoot: root });
    const bytes = Uint8Array.from([...PNG_MAGIC, 9, 8, 7]);
    const metadata = await committer.commit({
      actionRef: 'paid-x', runRef: 'run-1', stageRef: 'stage-1', attemptRef: 'attempt-1', callOrdinal: 1,
      operation: 'fyt.gemini-3-pro-image-2k', expectedArtifactPath: ARTIFACT_REL,
      result: { provider: 'gemini', mediaType: 'image/png', bytes },
    });

    expect(metadata).toEqual({ artifactPath: ARTIFACT_REL, mediaType: 'image/png', byteLength: bytes.byteLength, sha256: sha256(bytes) });
    const onDisk = Uint8Array.from(readFileSync(join(root, ARTIFACT_REL)));
    expect(onDisk).toEqual(bytes);
  });

  it('refuses a path that escapes the asset root', async () => {
    const root = tempRoot();
    const committer = createProviderCommitter({ repoRoot: root });
    await expect(committer.commit({
      actionRef: 'paid-x', runRef: 'run-1', stageRef: 'stage-1', attemptRef: 'attempt-1', callOrdinal: 1,
      operation: 'fyt.gemini-3-pro-image-2k', expectedArtifactPath: '../../escape.png',
      result: { provider: 'gemini', mediaType: 'image/png', bytes: PNG_MAGIC },
    })).rejects.toThrow('escapes the asset root');
  });
});

describe('createProviderArtifactVerifier', () => {
  it('round-trips a committed file and returns re-measured metadata', async () => {
    const root = tempRoot();
    const bytes = Uint8Array.from([...PNG_MAGIC, 42, 42]);
    const committer = createProviderCommitter({ repoRoot: root });
    const committed = await committer.commit({
      actionRef: 'paid-x', runRef: 'run-1', stageRef: 'stage-1', attemptRef: 'attempt-1', callOrdinal: 1,
      operation: 'fyt.gemini-3-pro-image-2k', expectedArtifactPath: ARTIFACT_REL,
      result: { provider: 'gemini', mediaType: 'image/png', bytes },
    });
    const verifier = createProviderArtifactVerifier({ repoRoot: root });
    const measured = await verifier.verify({ actionRef: 'paid-x', output: committed });
    expect(measured).toEqual(committed);
  });

  it('sniffs mp3 magic on an audio artifact', async () => {
    const root = tempRoot();
    const rel = 'orgs/faceless-youtube/channels/the-second-take/videos/demo/assets/vo.mp3';
    const bytes = Uint8Array.from([...MP3_MAGIC, 1, 1, 1]);
    const committer = createProviderCommitter({ repoRoot: root });
    const committed = await committer.commit({
      actionRef: 'paid-a', runRef: 'run-1', stageRef: 'stage-2', attemptRef: 'attempt-1', callOrdinal: 1,
      operation: 'fyt.elevenlabs.locked-tts', expectedArtifactPath: rel,
      result: { provider: 'elevenlabs', mediaType: 'audio/mpeg', bytes },
    });
    const verifier = createProviderArtifactVerifier({ repoRoot: root });
    const measured = await verifier.verify({ actionRef: 'paid-a', output: committed });
    expect(measured).toEqual({ artifactPath: rel, mediaType: 'audio/mpeg', byteLength: bytes.byteLength, sha256: sha256(bytes) });
  });

  it('returns null for a missing file', async () => {
    const root = tempRoot();
    const verifier = createProviderArtifactVerifier({ repoRoot: root });
    const measured = await verifier.verify({
      actionRef: 'paid-x',
      output: { artifactPath: ARTIFACT_REL, mediaType: 'image/png', byteLength: 12, sha256: sha256(PNG_MAGIC) },
    });
    expect(measured).toBeNull();
  });

  it('returns null for a file whose bytes are unrecognizable', async () => {
    const root = tempRoot();
    const rel = 'orgs/faceless-youtube/channels/the-second-take/videos/demo/assets/scenes/junk.png';
    // Commit unrecognizable bytes (neither PNG nor MP3 magic) via the committer so the tree exists.
    const committer = createProviderCommitter({ repoRoot: root });
    await committer.commit({
      actionRef: 'paid-x', runRef: 'run-1', stageRef: 'stage-1', attemptRef: 'attempt-1', callOrdinal: 1,
      operation: 'fyt.gemini-3-pro-image-2k', expectedArtifactPath: rel,
      result: { provider: 'gemini', mediaType: 'image/png', bytes: Uint8Array.from([0, 1, 2, 3]) },
    });
    const verifier = createProviderArtifactVerifier({ repoRoot: root });
    const measured = await verifier.verify({
      actionRef: 'paid-x',
      output: { artifactPath: rel, mediaType: 'image/png', byteLength: 4, sha256: sha256(Uint8Array.from([0, 1, 2, 3])) },
    });
    expect(measured).toBeNull();
  });
});

describe('createProviderCredentialResolver', () => {
  it('reads the provider key from the configured secrets file', async () => {
    const root = tempRoot();
    const secretsPath = join(root, 'provider-secrets.json');
    writeFileSync(secretsPath, JSON.stringify({ GEMINI_API_KEY: 'gk', ELEVENLABS_API_KEY: 'ek' }), 'utf8');
    const resolver = createProviderCredentialResolver({ secretsPath });
    expect(await resolver.resolve({ provider: 'gemini' })).toBe('gk');
    expect(await resolver.resolve({ provider: 'elevenlabs' })).toBe('ek');
  });

  it('returns null when the secrets file is absent', async () => {
    const root = tempRoot();
    const resolver = createProviderCredentialResolver({ secretsPath: join(root, 'missing.json') });
    expect(await resolver.resolve({ provider: 'gemini' })).toBeNull();
  });

  it('returns null when the requested provider key is missing from the file', async () => {
    const root = tempRoot();
    const secretsPath = join(root, 'provider-secrets.json');
    writeFileSync(secretsPath, JSON.stringify({ ELEVENLABS_API_KEY: 'ek' }), 'utf8');
    const resolver = createProviderCredentialResolver({ secretsPath });
    expect(await resolver.resolve({ provider: 'gemini' })).toBeNull();
  });

  it('falls back to the injected process env when no secrets file is configured', async () => {
    const resolver = createProviderCredentialResolver({ env: { GEMINI_API_KEY: 'from-env' } as NodeJS.ProcessEnv });
    expect(await resolver.resolve({ provider: 'gemini' })).toBe('from-env');
    expect(await resolver.resolve({ provider: 'elevenlabs' })).toBeNull();
  });

  it('refuses at construction a secrets path inside the attempt worktree tree', () => {
    const root = tempRoot();
    const worktreesRoot = join(root, 'control', 'worktrees');
    const secretsPath = join(worktreesRoot, 'attempt-1', 'secrets.json');
    expect(() => createProviderCredentialResolver({ secretsPath, worktreesRoot }))
      .toThrow('must not resolve inside the attempt worktree tree');
  });

  it('refuses at construction a non-absolute secrets path', () => {
    expect(() => createProviderCredentialResolver({ secretsPath: 'relative/secrets.json' }))
      .toThrow('must be an absolute path');
  });
});

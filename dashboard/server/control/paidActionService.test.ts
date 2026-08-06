import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FYT_GEMINI_2K_IMAGE_COST_USD_MICROS,
  FYT_LOCKED_TTS_COST_USD_MICROS,
  FYT_PAID_ACTION_GLOBAL_CEILING_USD_MICROS,
  PaidActionError,
  createPaidActionService,
  type PaidActionCommitInput,
  type PaidActionDispatch,
  type PaidActionImageSeed,
  type PaidActionProviderResult,
  type PaidActionServiceOptions,
} from './paidActionService.ts';

const roots: string[] = [];
const PNG_BYTES = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
));
const MP3_BYTES = new Uint8Array(417);
MP3_BYTES.set([0xff, 0xfb, 0x90, 0x00]);
const IMAGE_RESULT: PaidActionProviderResult = {
  provider: 'gemini', mediaType: 'image/png', bytes: PNG_BYTES,
};
const AUDIO_RESULT: PaidActionProviderResult = {
  provider: 'elevenlabs', mediaType: 'audio/mpeg', bytes: MP3_BYTES,
};
const SEED_BYTES = pngVariant(0x73);
const IMAGE_SEED = { bytes: SEED_BYTES, sha256: createHash('sha256').update(SEED_BYTES).digest('hex') };
const ARTIFACT_ROOT = 'orgs/faceless-youtube/channels/the-second-take/videos/2026-07-31-thin-slice';

function testCrc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function pngVariant(dataByte: number): Uint8Array {
  const typeAndData = Uint8Array.from([0x74, 0x45, 0x58, 0x74, dataByte]); // tEXt + one byte
  const chunk = new Uint8Array(4 + typeAndData.byteLength + 4);
  new DataView(chunk.buffer).setUint32(0, 1, false);
  chunk.set(typeAndData, 4);
  new DataView(chunk.buffer).setUint32(4 + typeAndData.byteLength, testCrc32(typeAndData), false);
  return Uint8Array.from([...PNG_BYTES.subarray(0, -12), ...chunk, ...PNG_BYTES.subarray(-12)]);
}

function metadata(result: PaidActionProviderResult, artifactPath: string) {
  return {
    artifactPath,
    mediaType: result.mediaType,
    byteLength: result.bytes.byteLength,
    sha256: createHash('sha256').update(result.bytes).digest('hex'),
  };
}

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'paid-actions-'));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function image(overrides: Partial<{
  runRef: string;
  stageRef: string;
  attemptRef: string;
  callOrdinal: number;
  prompt: string;
  seeds: readonly PaidActionImageSeed[];
  expectedArtifactPath: string;
}> = {}) {
  const callOrdinal = overrides.callOrdinal ?? 1;
  const attemptRef = overrides.attemptRef ?? 'attempt-images-a';
  return {
    runRef: 'run-1',
    stageRef: 'stage-images-1',
    stageId: 'images' as const,
    attemptRef,
    callOrdinal,
    operation: 'fyt.gemini-3-pro-image-2k' as const,
    prompt: 'a highly recognizable scene prompt',
    seeds: [IMAGE_SEED],
    expectedArtifactPath: `${ARTIFACT_ROOT}/${attemptRef}-shot-${callOrdinal}.png`,
    ...overrides,
  };
}

function audio(overrides: Partial<{
  runRef: string;
  stageRef: string;
  attemptRef: string;
  callOrdinal: number;
  text: string;
  expectedArtifactPath: string;
}> = {}) {
  return {
    runRef: 'run-1',
    stageRef: 'stage-audio-1',
    stageId: 'audio' as const,
    channelId: 'the-second-take' as const,
    attemptRef: 'attempt-audio-a',
    callOrdinal: 1,
    operation: 'fyt.elevenlabs.locked-tts' as const,
    text: 'The small proof is more valuable than the large promise.',
    expectedArtifactPath: `${ARTIFACT_ROOT}/slice.mp3`,
    ...overrides,
  };
}

function options(root: string, overrides: Partial<PaidActionServiceOptions> = {}): PaidActionServiceOptions {
  return {
    stateRoot: root,
    credentials: { resolve: async () => 'opaque' },
    transport: {
      dispatch: async (dispatch) => dispatch.provider === 'gemini' ? IMAGE_RESULT : AUDIO_RESULT,
    },
    committer: {
      commit: async (input) => metadata(input.result, input.expectedArtifactPath),
    },
    verifier: { verify: async (input) => input.output },
    ...overrides,
  };
}

async function ready(root: string, overrides: Partial<PaidActionServiceOptions> = {}) {
  const service = createPaidActionService(options(root, overrides));
  await service.reconcileStartup();
  return service;
}

describe('PaidActionService', () => {
  it('refuses all execution until the daemon explicitly reconciles startup state', async () => {
    const root = temporaryRoot();
    let credentialCalls = 0;
    const service = createPaidActionService(options(root, {
      credentials: { resolve: async () => { credentialCalls += 1; return 'opaque'; } },
    }));
    await expect(service.execute(image())).rejects.toMatchObject({
      code: 'startup-reconciliation-required',
      message: 'paid action startup reconciliation has not completed',
    });
    expect(credentialCalls).toBe(0);
    await expect(service.reconcileStartup()).resolves.toEqual({ failed: 0, unknown: 0 });
    await expect(service.reconcileStartup()).resolves.toEqual({ failed: 0, unknown: 0 });
  });

  it('reserves, dispatches typed bytes, commits the artifact, then persists safe replay metadata only', async () => {
    const root = temporaryRoot();
    const credential = 'gemini-credential-must-not-be-journaled';
    const calls: PaidActionDispatch[] = [];
    const commits: PaidActionCommitInput[] = [];
    let service!: Awaited<ReturnType<typeof ready>>;
    service = await ready(root, {
      credentials: { resolve: async () => credential },
      transport: {
        dispatch: async (dispatch) => {
          calls.push(dispatch);
          expect(service.snapshot()).toEqual([expect.objectContaining({ state: 'dispatching', output: null })]);
          return IMAGE_RESULT;
        },
      },
      committer: {
        commit: async (input) => {
          commits.push(input);
          expect(service.snapshot()).toEqual([expect.objectContaining({ state: 'dispatching', output: null })]);
          return metadata(input.result, input.expectedArtifactPath);
        },
      },
      now: () => new Date('2026-07-31T12:00:00.000Z'),
    });

    const prompt = 'a prompt that must never appear in the durable journal';
    const first = await service.execute(image({ prompt, expectedArtifactPath: `${ARTIFACT_ROOT}/opening/shot-01.png` }));
    expect(first).toEqual({
      status: 'succeeded',
      actionRef: expect.stringMatching(/^paid-[a-f0-9]{32}$/),
      output: {
        artifactPath: `${ARTIFACT_ROOT}/opening/shot-01.png`,
        mediaType: 'image/png',
        byteLength: IMAGE_RESULT.bytes.byteLength,
        sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(calls).toEqual([{
      provider: 'gemini', operation: 'fyt.gemini-3-pro-image-2k', credential,
      request: {
        model: 'gemini-3-pro-image', imageSize: '2K', aspectRatio: '16:9', prompt,
        seeds: [{ mediaType: 'image/png', ...IMAGE_SEED }],
      },
    }]);
    expect(commits).toEqual([expect.objectContaining({
      attemptRef: 'attempt-images-a', callOrdinal: 1, expectedArtifactPath: `${ARTIFACT_ROOT}/opening/shot-01.png`,
      result: IMAGE_RESULT,
    })]);
    if (first.status !== 'succeeded') throw new Error('expected a succeeded paid action');
    await expect(service.execute(image({ prompt, expectedArtifactPath: `${ARTIFACT_ROOT}/opening/shot-01.png` }))).resolves.toEqual({
      status: 'replayed', actionRef: first.actionRef, priorState: 'succeeded', output: first.output,
    });

    const persisted = readFileSync(join(root, 'control', 'paid-actions.json'), 'utf8');
    expect(persisted).not.toContain(prompt);
    expect(persisted).not.toContain(credential);
    expect(persisted).not.toContain(IMAGE_SEED.sha256);
    expect(persisted).not.toContain('"seeds"');
    expect(persisted).toContain('opening/shot-01.png');
    expect(calls).toHaveLength(1);
    expect(commits).toHaveLength(1);
  });

  it('requires one to four digest-matched PNG seeds before reservation', async () => {
    const root = temporaryRoot();
    let credentialCalls = 0;
    const service = await ready(root, {
      credentials: { resolve: async () => { credentialCalls += 1; return 'opaque'; } },
    });
    const badDigest = { bytes: SEED_BYTES, sha256: '0'.repeat(64) };
    const notPngBytes = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const notPng = { bytes: notPngBytes, sha256: createHash('sha256').update(notPngBytes).digest('hex') };
    for (const seeds of [[], Array(5).fill(IMAGE_SEED), [badDigest], [notPng]]) {
      await expect(service.execute(image({ seeds }))).rejects.toMatchObject({ code: 'invalid-input' });
    }
    expect(credentialCalls).toBe(0);
    expect(service.snapshot()).toEqual([]);
  });

  it('binds ordered seed digests and the exact output path into request idempotency', async () => {
    const root = temporaryRoot();
    const secondBytes = pngVariant(0x78);
    const second = { bytes: secondBytes, sha256: createHash('sha256').update(secondBytes).digest('hex') };
    const service = await ready(root);
    const original = image({
      seeds: [IMAGE_SEED, second],
      expectedArtifactPath: `${ARTIFACT_ROOT}/ordered-seeds.png`,
    });
    await expect(service.execute(original)).resolves.toMatchObject({ status: 'succeeded' });
    await expect(service.execute({ ...original, seeds: [second, IMAGE_SEED] })).rejects.toMatchObject({ code: 'idempotency-conflict' });
    await expect(service.execute({ ...original, expectedArtifactPath: `${ARTIFACT_ROOT}/changed.png` })).rejects.toMatchObject({
      code: 'idempotency-conflict',
    });
  });

  it('maps only the audio stage and The Second Take channel to the current locked Chris policy', async () => {
    const root = temporaryRoot();
    const calls: PaidActionDispatch[] = [];
    const service = await ready(root, {
      transport: { dispatch: async (dispatch) => { calls.push(dispatch); return AUDIO_RESULT; } },
    });

    await expect(service.execute(audio())).resolves.toMatchObject({ status: 'succeeded' });
    expect(calls).toEqual([{
      provider: 'elevenlabs',
      operation: 'fyt.elevenlabs.locked-tts',
      credential: 'opaque',
      request: {
        voiceId: 'iP95p4xoKVk53GoZ742B',
        modelId: 'eleven_v3',
        outputFormat: 'mp3_44100_128',
        voiceSettings: { stability: 0.10, similarityBoost: 0.85, style: 0.75, useSpeakerBoost: true, speed: 1.0 },
        text: 'The small proof is more valuable than the large promise.',
      },
    }]);
    expect(service.snapshot()).toEqual([expect.objectContaining({
      stageId: 'audio', channelId: 'the-second-take', chargedCostUsdMicros: FYT_LOCKED_TTS_COST_USD_MICROS,
    })]);
  });

  it('rejects mismatched stages and channels before reserving or resolving credentials', async () => {
    const root = temporaryRoot();
    let credentialCalls = 0;
    const service = await ready(root, {
      credentials: { resolve: async () => { credentialCalls += 1; return 'opaque'; } },
    });
    await expect(service.execute({ ...audio(), stageId: 'voiceover' } as never)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(service.execute({ ...audio(), channelId: 'another-channel' } as never)).rejects.toMatchObject({ code: 'invalid-input' });
    await expect(service.execute({ ...image(), stageId: 'audio' } as never)).rejects.toMatchObject({ code: 'invalid-input' });
    expect(credentialCalls).toBe(0);
    expect(service.snapshot()).toEqual([]);
  });

  it('enforces contiguous call ordinals within an exact attempt while independent attempts restart at one', async () => {
    const root = temporaryRoot();
    const calls: PaidActionDispatch[] = [];
    const service = await ready(root, {
      transport: { dispatch: async (dispatch) => { calls.push(dispatch); return IMAGE_RESULT; } },
    });
    await expect(service.execute(image({ callOrdinal: 2 }))).rejects.toMatchObject({
      code: 'call-out-of-order', message: 'paid action call ordinal must be 1',
    });
    await expect(service.execute(image())).resolves.toMatchObject({ status: 'succeeded' });
    await expect(service.execute(image({ callOrdinal: 3 }))).rejects.toMatchObject({
      code: 'call-out-of-order', message: 'paid action call ordinal must be 2',
    });
    await expect(service.execute(image({ callOrdinal: 2, prompt: 'second distinct image' }))).resolves.toMatchObject({ status: 'succeeded' });
    await expect(service.execute(image({ attemptRef: 'attempt-images-b', prompt: 'new exact attempt' }))).resolves.toMatchObject({ status: 'succeeded' });
    expect(calls).toHaveLength(3);
  });

  it('keys idempotency on exact attemptRef plus callOrdinal and rejects a mutated replay', async () => {
    const root = temporaryRoot();
    let calls = 0;
    const service = await ready(root, {
      transport: { dispatch: async () => { calls += 1; return IMAGE_RESULT; } },
    });
    const first = await service.execute(image());
    await expect(service.execute(image())).resolves.toMatchObject({
      status: 'replayed', actionRef: first.actionRef, priorState: 'succeeded', output: first.status === 'succeeded' ? first.output : undefined,
    });
    await expect(service.execute(image({ prompt: 'mutated prompt under the same exact identity' }))).rejects.toMatchObject({
      code: 'idempotency-conflict', message: 'paid action replay differs from its original request',
    });
    const secondAttempt = await service.execute(image({ attemptRef: 'attempt-images-b' }));
    expect(secondAttempt.actionRef).not.toBe(first.actionRef);
    expect(calls).toBe(2);
  });

  it('gives one paid action exclusive ownership of each deterministic artifact path', async () => {
    const root = temporaryRoot();
    const service = await ready(root);
    const expectedArtifactPath = `${ARTIFACT_ROOT}/exclusive.png`;
    await service.execute(image({ expectedArtifactPath }));
    await expect(service.execute(image({ attemptRef: 'attempt-images-b', expectedArtifactPath }))).rejects.toMatchObject({
      code: 'invalid-input', message: 'expected artifact path is already owned by another paid action',
    });
  });

  it('case-folds Windows artifact ownership and persists the derived ownership key', async () => {
    const root = temporaryRoot();
    const service = await ready(root);
    const upperPath = `${ARTIFACT_ROOT}/Opening/Shot.png`;
    await service.execute(image({ expectedArtifactPath: upperPath }));
    expect(service.snapshot()).toEqual([expect.objectContaining({
      expectedArtifactPath: upperPath,
      artifactOwnershipKey: upperPath.toLowerCase(),
    })]);
    await expect(service.execute(image({
      attemptRef: 'attempt-images-b', expectedArtifactPath: `${ARTIFACT_ROOT}/opening/shot.png`,
    }))).rejects.toMatchObject({
      code: 'invalid-input', message: 'expected artifact path is already owned by another paid action',
    });
  });

  it.each([
    'alias./shot.png',
    'alias /shot.png',
    'CON/shot.png',
    'aux.txt/shot.png',
    'NUL/shot.png',
  ])('rejects the Windows path alias %s before reservation', async (suffix) => {
    const root = temporaryRoot();
    let credentialCalls = 0;
    const service = await ready(root, {
      credentials: { resolve: async () => { credentialCalls += 1; return 'opaque'; } },
    });
    await expect(service.execute(image({ expectedArtifactPath: `${ARTIFACT_ROOT}/${suffix}` }))).rejects.toMatchObject({ code: 'invalid-input' });
    expect(credentialCalls).toBe(0);
    expect(service.snapshot()).toEqual([]);
  });

  it('rejects paid artifacts outside the one channel-video namespace', async () => {
    const root = temporaryRoot();
    const service = await ready(root);
    await expect(service.execute(image({
      expectedArtifactPath: 'orgs/faceless-youtube/channels/another/videos/run/shot.png',
    }))).rejects.toMatchObject({ code: 'invalid-input' });
  });

  it('allows eight desired images plus two charged failures, then holds the $1.40/effective-ten ceiling', async () => {
    const root = temporaryRoot();
    let calls = 0;
    const service = await ready(root, {
      transport: {
        dispatch: async () => {
          calls += 1;
          if (calls <= 2) throw new Error('two counted provider ambiguities');
          return IMAGE_RESULT;
        },
      },
    });
    for (let ordinal = 1; ordinal <= 10; ordinal += 1) {
      const result = await service.execute(image({ callOrdinal: ordinal, prompt: `image ${ordinal}` }));
      expect(result.status).toBe(ordinal <= 2 ? 'unknown' : 'succeeded');
    }
    await expect(service.execute(image({ callOrdinal: 11, prompt: 'over effective cost ceiling' }))).rejects.toMatchObject({ code: 'cap-exhausted' });
    expect(calls).toBe(10);
    expect(service.snapshot().reduce((sum, action) => sum + action.chargedCostUsdMicros, 0)).toBe(1_340_000);
    expect(service.snapshot().filter((action) => action.state === 'succeeded')).toHaveLength(8);
  });

  it('will not turn failure headroom into a ninth successful image', async () => {
    const root = temporaryRoot();
    let calls = 0;
    const service = await ready(root, {
      transport: { dispatch: async () => { calls += 1; return IMAGE_RESULT; } },
    });
    for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
      await service.execute(image({ callOrdinal: ordinal, prompt: `successful output ${ordinal}` }));
    }
    await expect(service.execute(image({ callOrdinal: 9, prompt: 'unauthorized ninth output' }))).rejects.toMatchObject({ code: 'cap-exhausted' });
    expect(calls).toBe(8);
  });

  it('counts pre-dispatch failures against the explicit eleven-call cap while releasing their dollar holds', async () => {
    const root = temporaryRoot();
    const service = await ready(root, { credentials: { resolve: async () => null } });
    for (let ordinal = 1; ordinal <= 11; ordinal += 1) {
      await expect(service.execute(image({ callOrdinal: ordinal, prompt: `credential miss ${ordinal}` }))).resolves.toMatchObject({
        status: 'failed', reason: 'credential-unavailable',
      });
    }
    await expect(service.execute(image({ callOrdinal: 12, prompt: 'twelfth probe' }))).rejects.toMatchObject({ code: 'cap-exhausted' });
    expect(service.snapshot()).toHaveLength(11);
    expect(service.snapshot().every((action) => action.chargedCostUsdMicros === 0)).toBe(true);
  });

  it('marks commit failure unknown and charged, returns the reason on replay, and never dispatches it again', async () => {
    const root = temporaryRoot();
    let dispatches = 0;
    let commits = 0;
    const service = await ready(root, {
      transport: { dispatch: async () => { dispatches += 1; return IMAGE_RESULT; } },
      committer: { commit: async () => { commits += 1; throw new Error('disk detail must not escape'); } },
    });
    await expect(service.execute(image())).resolves.toEqual({
      status: 'unknown', actionRef: expect.any(String), reason: 'artifact-commit-unconfirmed',
    });
    expect(service.snapshot()).toEqual([expect.objectContaining({
      state: 'unknown', chargedCostUsdMicros: FYT_GEMINI_2K_IMAGE_COST_USD_MICROS,
      unknownReason: 'artifact-commit-unconfirmed', output: null,
    })]);
    await expect(service.execute(image())).resolves.toMatchObject({
      status: 'replayed', priorState: 'unknown', reason: 'artifact-commit-unconfirmed',
    });
    expect(dispatches).toBe(1);
    expect(commits).toBe(1);
  });

  it.each([
    ['path', { artifactPath: `${ARTIFACT_ROOT}/wrong.png` }],
    ['media type', { mediaType: 'audio/mpeg' }],
    ['byte length', { byteLength: IMAGE_RESULT.bytes.byteLength + 1 }],
    ['digest', { sha256: '0'.repeat(64) }],
  ])('rejects committer metadata whose %s was not measured from the declared fsynced artifact', async (_label, mutation) => {
    const root = temporaryRoot();
    const service = await ready(root, {
      committer: {
        commit: async (input) => ({ ...metadata(input.result, input.expectedArtifactPath), ...mutation } as never),
      },
    });
    await expect(service.execute(image())).resolves.toMatchObject({
      status: 'unknown', reason: 'artifact-commit-unconfirmed',
    });
    expect(service.snapshot()).toEqual([expect.objectContaining({ state: 'unknown', output: null })]);
  });

  it.each(['missing', 'mismatched'] as const)(
    'turns a succeeded replay with a %s committed artifact into durable unknown without redispatch',
    async (mode) => {
      const root = temporaryRoot();
      let dispatches = 0;
      let verifierCalls = 0;
      let replaying = false;
      const service = await ready(root, {
        transport: { dispatch: async () => { dispatches += 1; return IMAGE_RESULT; } },
        verifier: {
          verify: async (input) => {
            verifierCalls += 1;
            if (!replaying) return input.output;
            return mode === 'missing' ? null : { ...input.output, sha256: '0'.repeat(64) };
          },
        },
      });
      const request = image();
      await expect(service.execute(request)).resolves.toMatchObject({ status: 'succeeded' });
      replaying = true;
      await expect(service.execute(request)).resolves.toMatchObject({
        status: 'unknown', reason: 'artifact-verification-failed',
      });
      expect(service.snapshot()).toEqual([expect.objectContaining({
        state: 'unknown', output: null, unknownReason: 'artifact-verification-failed',
        chargedCostUsdMicros: FYT_GEMINI_2K_IMAGE_COST_USD_MICROS,
      })]);
      await expect(service.execute(request)).resolves.toMatchObject({
        status: 'replayed', priorState: 'unknown', reason: 'artifact-verification-failed',
      });
      expect(dispatches).toBe(1);
      expect(verifierCalls).toBe(1);
    },
  );

  it('marks transport ambiguity unknown and charged without exposing or retrying provider text', async () => {
    const root = temporaryRoot();
    let calls = 0;
    const service = await ready(root, {
      transport: { dispatch: async () => { calls += 1; throw new Error('provider secret=abc'); } },
    });
    const outcome = await service.execute(audio());
    expect(outcome).toMatchObject({ status: 'unknown', reason: 'transport-unconfirmed' });
    expect(JSON.stringify(outcome)).not.toContain('secret=abc');
    await expect(service.execute(audio())).resolves.toMatchObject({ status: 'replayed', priorState: 'unknown' });
    expect(calls).toBe(1);
  });

  it.each([
    ['truncated PNG', 'image', Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ['HTML labeled PNG', 'image', Uint8Array.from(Buffer.from('<html>quota error</html>', 'utf8'))],
    ['truncated MP3 frame', 'audio', Uint8Array.from([0xff, 0xfb, 0x90, 0x00])],
    ['HTML labeled MP3', 'audio', Uint8Array.from(Buffer.from('<html>provider error</html>', 'utf8'))],
  ] as const)('rejects a %s provider envelope before artifact commit', async (_label, kind, bytes) => {
    const root = temporaryRoot();
    let commits = 0;
    const service = await ready(root, {
      transport: {
        dispatch: async () => kind === 'image'
          ? { provider: 'gemini', mediaType: 'image/png', bytes: Uint8Array.from(bytes) }
          : { provider: 'elevenlabs', mediaType: 'audio/mpeg', bytes: Uint8Array.from(bytes) },
      },
      committer: {
        commit: async (input) => { commits += 1; return metadata(input.result, input.expectedArtifactPath); },
      },
    });
    await expect(service.execute(kind === 'image' ? image() : audio())).resolves.toMatchObject({
      status: 'unknown', reason: 'transport-unconfirmed',
    });
    expect(commits).toBe(0);
  });

  it('recovers reserved to failed/$0 and dispatching to unknown/charged under the single-daemon startup rule', async () => {
    const root = temporaryRoot();
    const seed = await ready(root, { credentials: { resolve: async () => null } });
    const reservedInput = image({ attemptRef: 'attempt-reserved' });
    const dispatchingInput = image({ attemptRef: 'attempt-dispatching' });
    await seed.execute(reservedInput);
    await seed.execute(dispatchingInput);

    const journalPath = join(root, 'control', 'paid-actions.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { revision: number; actions: Array<Record<string, unknown>> };
    const [reserved, dispatching] = journal.actions;
    Object.assign(reserved, { state: 'reserved', failureReason: null, finalizedAt: null, dispatchingAt: null, chargedCostUsdMicros: 0 });
    Object.assign(dispatching, {
      state: 'dispatching', failureReason: null, finalizedAt: null,
      dispatchingAt: dispatching?.reservedAt, chargedCostUsdMicros: 0,
    });
    journal.revision += 1;
    writeFileSync(journalPath, `${JSON.stringify(journal)}\n`, 'utf8');

    let credentialCalls = 0;
    const recovered = createPaidActionService(options(root, {
      credentials: { resolve: async () => { credentialCalls += 1; return 'opaque'; } },
    }));
    await expect(recovered.reconcileStartup()).resolves.toEqual({ failed: 1, unknown: 1 });
    expect(recovered.snapshot()).toEqual([
      expect.objectContaining({ state: 'failed', chargedCostUsdMicros: 0, failureReason: 'startup-abandoned-reservation' }),
      expect.objectContaining({
        state: 'unknown', chargedCostUsdMicros: FYT_GEMINI_2K_IMAGE_COST_USD_MICROS,
        unknownReason: 'startup-abandoned-dispatch',
      }),
    ]);
    await expect(recovered.execute(reservedInput)).resolves.toMatchObject({
      status: 'replayed', priorState: 'failed', reason: 'startup-abandoned-reservation',
    });
    await expect(recovered.execute(dispatchingInput)).resolves.toMatchObject({
      status: 'replayed', priorState: 'unknown', reason: 'startup-abandoned-dispatch',
    });
    expect(credentialCalls).toBe(0);
  });

  it.each([
    ['failure reason', (record: Record<string, unknown>) => { record.failureReason = 'invented-reason'; }],
    ['derived action reference', (record: Record<string, unknown>) => { record.actionRef = 'paid-forged'; }],
    ['derived artifact ownership key', (record: Record<string, unknown>) => { record.artifactOwnershipKey = 'forged'; }],
  ])('rejects a journal with a forged %s', async (_label, corrupt) => {
    const root = temporaryRoot();
    const seed = await ready(root, { credentials: { resolve: async () => null } });
    await seed.execute(image());
    const journalPath = join(root, 'control', 'paid-actions.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { actions: Array<Record<string, unknown>> };
    corrupt(journal.actions[0] as Record<string, unknown>);
    writeFileSync(journalPath, `${JSON.stringify(journal)}\n`, 'utf8');
    const reopened = createPaidActionService(options(root));
    await expect(reopened.reconcileStartup()).rejects.toMatchObject({ code: 'journal-unavailable' });
  });

  it('rejects oversized narration and a malformed mutex database without resolving or dispatching', async () => {
    const root = temporaryRoot();
    let credentialCalls = 0;
    let dispatchCalls = 0;
    const service = await ready(root, {
      credentials: { resolve: async () => { credentialCalls += 1; return 'opaque'; } },
      transport: { dispatch: async () => { dispatchCalls += 1; return AUDIO_RESULT; } },
      lockTimeoutMs: 1,
    });
    await expect(service.execute(audio({ text: 'a'.repeat(451) }))).rejects.toMatchObject({ code: 'invalid-input' });
    const lockPath = join(root, 'control', 'paid-actions.json.mutex.sqlite');
    writeFileSync(lockPath, 'not a sqlite database', { encoding: 'utf8', mode: 0o600 });
    await expect(service.execute(image())).rejects.toMatchObject({ code: 'journal-unavailable' });
    expect(credentialCalls).toBe(0);
    expect(dispatchCalls).toBe(0);
    expect(() => { throw new PaidActionError('cap-exhausted', 'paid action cap is exhausted'); }).toThrow('paid action cap is exhausted');
  });

  it('holds an absolute journal-wide spend ceiling across independent runRefs (F1)', async () => {
    const root = temporaryRoot();
    const service = await ready(root);
    // run-1 spends its full eight-output allowance ($1.072).
    for (let ordinal = 1; ordinal <= 8; ordinal += 1) {
      await expect(service.execute(image({
        runRef: 'run-1', stageRef: 'stage-images-1', callOrdinal: ordinal,
        prompt: `run-1 image ${ordinal}`, expectedArtifactPath: `${ARTIFACT_ROOT}/run-1-shot-${ordinal}.png`,
      }))).resolves.toMatchObject({ status: 'succeeded' });
    }
    // A fresh run has full per-run/per-stage headroom; three more images fit under the global ceiling.
    for (let ordinal = 1; ordinal <= 3; ordinal += 1) {
      await expect(service.execute(image({
        runRef: 'run-2', stageRef: 'stage-images-2', callOrdinal: ordinal,
        prompt: `run-2 image ${ordinal}`, expectedArtifactPath: `${ARTIFACT_ROOT}/run-2-shot-${ordinal}.png`,
      }))).resolves.toMatchObject({ status: 'succeeded' });
    }
    // The twelfth image is refused by the GLOBAL floor alone — run-2 has spent only $0.402 of its own
    // $1.40/eight-output budget, so reverting F1 lets this succeed.
    await expect(service.execute(image({
      runRef: 'run-2', stageRef: 'stage-images-2', callOrdinal: 4,
      prompt: 'run-2 image 4', expectedArtifactPath: `${ARTIFACT_ROOT}/run-2-shot-4.png`,
    }))).rejects.toMatchObject({ code: 'cap-exhausted', message: 'paid action global spend ceiling is exhausted' });
    const totalCharged = service.snapshot().reduce((sum, action) => sum + action.chargedCostUsdMicros, 0);
    expect(totalCharged).toBe(11 * FYT_GEMINI_2K_IMAGE_COST_USD_MICROS);
    expect(totalCharged).toBeGreaterThan(1_400_000);
    expect(totalCharged).toBeLessThanOrEqual(FYT_PAID_ACTION_GLOBAL_CEILING_USD_MICROS);
  });

  it('lets a failed $0 action release its artifact path for re-reservation and still loads (F2)', async () => {
    const root = temporaryRoot();
    let resolveCalls = 0;
    const service = await ready(root, {
      credentials: { resolve: async () => { resolveCalls += 1; return resolveCalls === 1 ? null : 'opaque'; } },
    });
    const contested = `${ARTIFACT_ROOT}/contested.png`;
    await expect(service.execute(image({ attemptRef: 'attempt-images-a', expectedArtifactPath: contested }))).resolves.toMatchObject({
      status: 'failed', reason: 'credential-unavailable',
    });
    // The failed action charged $0 and produced no bytes, so a new action may claim the same path
    // (reverting F2's reserve() change makes this throw 'expected artifact path is already owned').
    await expect(service.execute(image({ attemptRef: 'attempt-images-b', expectedArtifactPath: contested }))).resolves.toMatchObject({
      status: 'succeeded',
    });
    // And a journal holding one failed + one succeeded action on the same path still loads
    // (reverting F2's assertJournal change makes reconcileStartup reject 'journal-unavailable').
    const reopened = createPaidActionService(options(root));
    await expect(reopened.reconcileStartup()).resolves.toEqual({ failed: 0, unknown: 0 });
    expect(reopened.snapshot().filter((action) => action.expectedArtifactPath === contested)).toHaveLength(2);
  });

  it('treats a verifier THROW on replay as retryable but a returned mismatch as a downgrade (F3)', async () => {
    const root = temporaryRoot();
    let dispatches = 0;
    let mode: 'ok' | 'throw' | 'mismatch' = 'ok';
    const service = await ready(root, {
      transport: { dispatch: async () => { dispatches += 1; return IMAGE_RESULT; } },
      verifier: {
        verify: async (input) => {
          if (mode === 'throw') throw new Error('transient artifact read error');
          if (mode === 'mismatch') return { ...input.output, sha256: '0'.repeat(64) };
          return input.output;
        },
      },
    });
    const request = image();
    await expect(service.execute(request)).resolves.toMatchObject({ status: 'succeeded' });

    // A THROW is surfaced as a retryable error and must NOT mutate state or re-charge
    // (reverting F3 makes this resolve to unknown/artifact-verification-failed instead).
    mode = 'throw';
    await expect(service.execute(request)).rejects.toMatchObject({ code: 'artifact-verification-unavailable' });
    expect(service.snapshot()).toEqual([expect.objectContaining({
      state: 'succeeded', chargedCostUsdMicros: FYT_GEMINI_2K_IMAGE_COST_USD_MICROS, output: expect.any(Object),
    })]);

    // A later clean read still replays succeeded — the transient throw never burned the success.
    mode = 'ok';
    await expect(service.execute(request)).resolves.toMatchObject({ status: 'replayed', priorState: 'succeeded' });

    // A RETURNED mismatch (not a throw) still downgrades to durable unknown, exactly as today.
    mode = 'mismatch';
    await expect(service.execute(request)).resolves.toMatchObject({ status: 'unknown', reason: 'artifact-verification-failed' });
    expect(service.snapshot()).toEqual([expect.objectContaining({
      state: 'unknown', output: null, unknownReason: 'artifact-verification-failed',
    })]);
    expect(dispatches).toBe(1);
  });
});

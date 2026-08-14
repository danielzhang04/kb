/**
 * Phase-3 FYT paid-action wiring — Unit F full-chain integration test.
 *
 * Exercises the WHOLE exploitable chain wired together with FAKE providers (no network, no real keys):
 *   spendGrant.mint → write `.kb/spend-grant.json` into the attempt worktree → worker reads the token back →
 *   POST /api/control/paid-action Bearer <token> → non-session preHandler resolves the grant → the handler
 *   DERIVES runRef/stageRef (grant) + attemptRef (execution state) + callOrdinal (journal) server-side →
 *   createPaidActionService.execute → fake transport returns a valid PNG/MP3 → the REAL Unit-C committer
 *   writes bytes into a temp attempt asset root → the REAL Unit-C verifier re-measures → HTTP 200 + metadata.
 *
 * Real objects: createPaidActionService, createSpendGrantStore, createProviderCommitter,
 * createProviderArtifactVerifier, the real Fastify route (origin + rate-limit + bearer preHandler + body
 * limit). Faked only at the two designed seams: the provider TRANSPORT (returns bytes, never a socket) and
 * the CREDENTIAL resolver (returns an opaque non-key string). Every temp dir is cleaned up.
 *
 * The five end-to-end assertions map to the Phase-3 findings:
 *   #1 happy path (image + audio)                     — chain works; committed bytes match returned metadata
 *   #2 per-stage cap + $1.50 GLOBAL journal ceiling   — F1 (journal-wide absolute floor across runRefs)
 *   #3 a FAILED action releases its artifact path     — F2 (failed does not permanently own the path)
 *   #4 verifier throw = retryable/no-downgrade; mismatch = downgrade — F3
 *   #5 a body carrying a foreign runRef is rejected   — server-derivation (identity is never worker-supplied)
 */
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { originPlugin } from '../security/origin.ts';
import { makeDefaultWriteRateGuard, writeRateLimitHook } from '../http/middleware.ts';
import type { SurfaceContext } from '../http/context.ts';
import { registerPaidActionRoute, PAID_ACTION_ROUTE_PATH } from './paidActionRoute.ts';
import {
  createPaidActionService,
  type PaidActionArtifactVerifier,
  type PaidActionCredentialResolver,
  type PaidActionProviderResult,
  type PaidActionRequest,
  type PaidActionTransport,
} from './paidActionService.ts';
import { createSpendGrantStore } from './spendGrant.ts';
import { createProviderArtifactVerifier, createProviderCommitter } from './paidActionProviders.ts';
import { SPEND_GRANT_FILE_RELATIVE_PATH, type SpendGrantFileContents } from './spendGrantProvision.ts';

const ORIGIN = 'http://localhost:5317';
const HOST = 'localhost:5317';
const SUBJECT = 'operator-1';
const NS = 'orgs/faceless-youtube/channels/the-second-take/videos';
const ROUTE_URL = `${ORIGIN}${PAID_ACTION_ROUTE_PATH}`;

// A genuine, spec-correct PNG built with pngjs (IHDR non-zero dims, IDAT, IEND, valid CRCs) — the same
// approach the provider unit tests use. It passes the service's isPngEnvelope validation. `salt` varies the
// pixels so two fixtures differ by sha256 (used by the F3 mismatch case).
function pngFixture(salt = 0, width = 4, height = 3): Uint8Array {
  const png = new PNG({ width, height });
  for (let i = 0; i < png.data.length; i += 1) png.data[i] = (i * 37 + 11 + salt) & 0xff;
  return Uint8Array.from(PNG.sync.write(png));
}

// A minimal valid FIXED-frame MP3 the service's isFixedMp3Envelope accepts: one complete unpadded MPEG-1
// Layer III / 128 kbps / 44.1 kHz frame is 417 bytes. The 4-byte header 0xFF 0xFA 0x90 0x00 encodes exactly
// those fields (frame sync = 11 set bits; version bits 0b11 = MPEG-1; layer bits 0b01 = Layer III; bitrate
// index 0b1001 = 128 kbps; sampling bits 0b00 = 44.1 kHz), followed by 413 zero bytes to complete the frame.
function mp3Fixture(): Uint8Array {
  const frame = new Uint8Array(417);
  frame[0] = 0xff;
  frame[1] = 0xfa;
  frame[2] = 0x90;
  frame[3] = 0x00;
  return frame;
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const IMAGE_SEED = (() => {
  const bytes = pngFixture(200);
  return { pngBase64: Buffer.from(bytes).toString('base64'), sha256: sha256(bytes) };
})();

// The fake provider transport: exactly the service's provider seam, returning bytes (never a socket). It
// hands back a FRESH buffer per call so nothing is shared across the journal's private copies.
function fakeTransport(): PaidActionTransport {
  return {
    async dispatch(input): Promise<PaidActionProviderResult> {
      if (input.provider === 'gemini') return { provider: 'gemini', mediaType: 'image/png', bytes: pngFixture(0) };
      return { provider: 'elevenlabs', mediaType: 'audio/mpeg', bytes: mp3Fixture() };
    },
  };
}

const roots: string[] = [];
const apps: Array<ReturnType<typeof Fastify>> = [];
afterEach(async () => {
  for (const app of apps.splice(0)) await app.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

interface ChainKnobs {
  /** Override the credential resolver (F2 forces a null → credential-unavailable failure). Default: a key. */
  credentials?: PaidActionCredentialResolver;
  /** Override the artifact verifier (F3 throw case). Default: the REAL on-disk verifier. */
  verifier?: PaidActionArtifactVerifier;
  /** When it returns true, the route sees an EMPTY journal snapshot so it derives callOrdinal 1 — the only
   *  way to force a REPLAY of ordinal 1 through the real route (which otherwise always increments). */
  forceOrdinalOne?: () => boolean;
}

async function makeChain(knobs: ChainKnobs = {}) {
  const stateRoot = tempDir('paid-int-state-');
  const assetRoot = tempDir('paid-int-worktree-'); // stands in for the attempt worktree: holds .kb + assets
  const grantStore = createSpendGrantStore({ stateRoot });
  const service = createPaidActionService({
    stateRoot,
    credentials: knobs.credentials ?? { async resolve() { return 'fake-server-side-key'; } },
    transport: fakeTransport(),
    committer: createProviderCommitter({ repoRoot: assetRoot }),
    verifier: knobs.verifier ?? createProviderArtifactVerifier({ repoRoot: assetRoot }),
  });
  await service.reconcileStartup();

  const forceOrdinalOne = knobs.forceOrdinalOne ?? (() => false);
  const auditRows: Array<Record<string, unknown>> = [];
  const ctx = {
    repoRoot: stateRoot,
    controlStore: {
      getRun: (_subject: string, _runRef: string) => ({
        ok: true,
        value: {
          stages: [
            { stageRef: 'stage-images', currentAttemptRef: 'attempt-images' },
            { stageRef: 'stage-audio', currentAttemptRef: 'attempt-audio' },
          ],
        },
      }),
    },
    appendAudit: (_repoRoot: string, event: Record<string, unknown>) => { auditRows.push(event); return { ts: 'now', ...event }; },
    now: () => new Date(),
    // The route reads execute + snapshot; execute is the real service, snapshot is wrapped ONLY to force an
    // ordinal-1 replay in the F3 cases. Everywhere else it is the real journal snapshot.
    paidActionService: {
      execute: (input: PaidActionRequest) => service.execute(input),
      snapshot: () => (forceOrdinalOne() ? [] : service.snapshot()),
    },
    spendGrantStore: grantStore,
    admission: () => ({ ok: true }),
  } as unknown as SurfaceContext;

  const app = Fastify();
  app.register(async (scope) => {
    originPlugin(scope, { allowedOrigins: [ORIGIN] });
    scope.addHook('onRequest', writeRateLimitHook(makeDefaultWriteRateGuard()));
    registerPaidActionRoute(scope, ctx);
  });
  await app.ready();
  apps.push(app);

  // Mint a stage grant AND write `.kb/spend-grant.json` into the attempt worktree, then read the token back
  // out of the file — proving the file carrier, not just the in-memory mint, feeds the route's bearer header.
  async function mintAndCarryToken(runRef: string, stageRef: 'stage-images' | 'stage-audio'): Promise<string> {
    const operation = stageRef === 'stage-images' ? 'fyt.gemini-3-pro-image-2k' : 'fyt.elevenlabs.locked-tts';
    const { token } = await grantStore.mint({
      runRef, stageRef, operation, subject: SUBJECT, gateRequestRef: 'request-spend', ttlMs: 2 * 60 * 60 * 1000,
    });
    const contents: SpendGrantFileContents = {
      token, runRef, stageRef,
      attemptRef: stageRef === 'stage-images' ? 'attempt-images' : 'attempt-audio',
      operationsAllowed: [operation], routeUrl: ROUTE_URL,
    };
    const target = join(assetRoot, SPEND_GRANT_FILE_RELATIVE_PATH);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${JSON.stringify(contents, null, 2)}\n`);
    const readBack = JSON.parse(readFileSync(target, 'utf8')) as SpendGrantFileContents;
    return readBack.token;
  }

  function headers(token?: string): Record<string, string> {
    const base: Record<string, string> = { origin: ORIGIN, host: HOST, 'content-type': 'application/json' };
    if (token) base.authorization = `Bearer ${token}`;
    return base;
  }

  function postImage(token: string, artifactRel: string, extra: Record<string, unknown> = {}) {
    return app.inject({
      method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(token),
      payload: { operation: 'fyt.gemini-3-pro-image-2k', prompt: 'a red brick wall', seeds: [IMAGE_SEED], expectedArtifactPath: artifactRel, ...extra },
    });
  }

  function postTts(token: string, artifactRel: string) {
    return app.inject({
      method: 'POST', url: PAID_ACTION_ROUTE_PATH, headers: headers(token),
      payload: { operation: 'fyt.elevenlabs.locked-tts', text: 'A short line of narration.', expectedArtifactPath: artifactRel },
    });
  }

  return { stateRoot, assetRoot, grantStore, service, app, mintAndCarryToken, postImage, postTts };
}

describe('paid-action full chain (Unit F integration)', () => {
  it('#1 mint → grant file → route → execute → commit → verify: 200 with committed bytes on disk matching returned metadata', async () => {
    const chain = await makeChain();

    // ── image ──────────────────────────────────────────────────────────────────────────────────────────
    const imgToken = await chain.mintAndCarryToken('run-alpha', 'stage-images');
    const imgRel = `${NS}/2026-08-03-int/assets/scenes/shot-01.png`;
    const imgRes = await chain.postImage(imgToken, imgRel);
    expect(imgRes.statusCode).toBe(200);
    const imgBody = imgRes.json() as { status: string; output: { artifactPath: string; mediaType: string; byteLength: number; sha256: string } };
    expect(imgBody.status).toBe('succeeded');
    expect(imgBody.output.artifactPath).toBe(imgRel);
    expect(imgBody.output.mediaType).toBe('image/png');
    // The committed PNG exists on disk under the attempt asset root, and its bytes match the returned metadata.
    const imgBytes = readFileSync(join(chain.assetRoot, imgRel));
    expect(imgBytes.byteLength).toBe(imgBody.output.byteLength);
    expect(sha256(Uint8Array.from(imgBytes))).toBe(imgBody.output.sha256);
    // The HTTP surface returns metadata only — never the raw provider bytes.
    expect(JSON.stringify(imgBody)).not.toMatch(/bytes|base64/i);

    // ── audio (exercises the MP3 envelope + committer/verifier for audio/mpeg) ────────────────────────────
    const ttsToken = await chain.mintAndCarryToken('run-alpha', 'stage-audio');
    const ttsRel = `${NS}/2026-08-03-int/assets/vo.mp3`;
    const ttsRes = await chain.postTts(ttsToken, ttsRel);
    expect(ttsRes.statusCode).toBe(200);
    const ttsBody = ttsRes.json() as { status: string; output: { mediaType: string; byteLength: number; sha256: string } };
    expect(ttsBody.status).toBe('succeeded');
    expect(ttsBody.output.mediaType).toBe('audio/mpeg');
    const ttsBytes = readFileSync(join(chain.assetRoot, ttsRel));
    expect(ttsBytes.byteLength).toBe(ttsBody.output.byteLength);
    expect(sha256(Uint8Array.from(ttsBytes))).toBe(ttsBody.output.sha256);
  });

  it('#2 F1: per-stage cap AND the $1.50 GLOBAL journal ceiling both refuse with 409, the ceiling spanning DIFFERENT runRefs', async () => {
    const chain = await makeChain();

    // Run A draws its images grant to the per-stage maxOutputs (8). Each success writes a distinct PNG.
    const tokenA = await chain.mintAndCarryToken('run-alpha', 'stage-images');
    for (let i = 1; i <= 8; i += 1) {
      const res = await chain.postImage(tokenA, `${NS}/2026-08-03-a/assets/scenes/a-${i}.png`);
      expect(res.statusCode).toBe(200);
      expect((res.json() as { status: string }).status).toBe('succeeded');
    }
    // Run A's 9th call is refused by the PER-STAGE cap (maxOutputs=8) — global spend is still only ~$1.07M,
    // far under $1.50M, so this 409 can only be the stage cap.
    const overStage = await chain.postImage(tokenA, `${NS}/2026-08-03-a/assets/scenes/a-9.png`);
    expect(overStage.statusCode).toBe(409);
    expect((overStage.json() as { error: string }).error).toBe('cap-exhausted');

    // Run B (a DIFFERENT runRef, its own grant) succeeds three more times: journal total 8+3 = 11 images
    // = $1.474M, still ≤ $1.50M.
    const tokenB = await chain.mintAndCarryToken('run-bravo', 'stage-images');
    for (let i = 1; i <= 3; i += 1) {
      const res = await chain.postImage(tokenB, `${NS}/2026-08-03-b/assets/scenes/b-${i}.png`);
      expect(res.statusCode).toBe(200);
    }
    // Run B's 4th call would push the JOURNAL-WIDE total to $1.608M > $1.50M and is refused — even though run
    // B has spent only ~$0.40M of its own $1.40M per-run cap and used 3 of 8 outputs. So the refusal is the
    // journal-wide absolute ceiling (F1), not any per-run/per-stage cap.
    const overGlobal = await chain.postImage(tokenB, `${NS}/2026-08-03-b/assets/scenes/b-4.png`);
    expect(overGlobal.statusCode).toBe(409);
    expect((overGlobal.json() as { error: string }).error).toBe('cap-exhausted');
    // Prove run B was well within its OWN caps when the global ceiling bit: exactly 3 succeeded for run B.
    const runBSucceeded = chain.service.snapshot().filter((a) => a.runRef === 'run-bravo' && a.state === 'succeeded');
    expect(runBSucceeded).toHaveLength(3);
    const totalSucceeded = chain.service.snapshot().filter((a) => a.state === 'succeeded');
    expect(totalSucceeded).toHaveLength(11);
  });

  it('#3 F2: a FAILED action does not permanently own its artifact path — a later call to the same path succeeds', async () => {
    let credentialAvailable = false; // first call: resolver returns null → credential-unavailable → failed/$0
    const chain = await makeChain({
      credentials: { async resolve() { return credentialAvailable ? 'fake-server-side-key' : null; } },
    });
    const token = await chain.mintAndCarryToken('run-alpha', 'stage-images');
    const rel = `${NS}/2026-08-03-int/assets/scenes/contested.png`;

    // Call 1 fails (no credential). A failed action charges $0 and must NOT keep ownership of the path.
    const failRes = await chain.postImage(token, rel);
    expect(failRes.statusCode).toBe(200);
    expect(failRes.json()).toMatchObject({ status: 'failed', reason: 'credential-unavailable' });

    // Call 2 targets the SAME path; with a credential now available it succeeds — proving the failed action
    // released the path (the OLD behavior would 400 with "artifact path is already owned").
    credentialAvailable = true;
    const okRes = await chain.postImage(token, rel);
    expect(okRes.statusCode).toBe(200);
    expect((okRes.json() as { status: string }).status).toBe('succeeded');
    expect(readFileSync(join(chain.assetRoot, rel)).byteLength).toBeGreaterThan(0);
  });

  it('#4 F3: a verifier THROW is retryable (503) and leaves the record succeeded; a verifier MISMATCH downgrades to unknown', async () => {
    // ── throw sub-case ───────────────────────────────────────────────────────────────────────────────────
    // A verifier that always throws on replay. It is not called on the first execute, so the first call
    // succeeds; the forced ordinal-1 replay then throws → the service surfaces a RETRYABLE error → route 503,
    // and the record must stay `succeeded` (no downgrade, no re-charge).
    const throwing = await makeChain({
      verifier: { async verify() { throw new Error('transient read failure'); } },
      forceOrdinalOne: () => true,
    });
    const tThrow = await throwing.mintAndCarryToken('run-alpha', 'stage-images');
    const relThrow = `${NS}/2026-08-03-int/assets/scenes/throw.png`;
    const first = await throwing.postImage(tThrow, relThrow);
    expect((first.json() as { status: string }).status).toBe('succeeded');
    const replay = await throwing.postImage(tThrow, relThrow); // ordinal 1 again → replay → verifier throws
    expect(replay.statusCode).toBe(503);
    expect(replay.json()).toMatchObject({ error: 'artifact-verification-unavailable', retryable: true });
    // The succeeded record is untouched (charge preserved, no downgrade to unknown).
    expect(throwing.service.snapshot().filter((a) => a.state === 'succeeded')).toHaveLength(1);
    expect(throwing.service.snapshot().some((a) => a.state === 'unknown')).toBe(false);

    // ── mismatch sub-case (uses the REAL on-disk verifier) ───────────────────────────────────────────────
    const mismatch = await makeChain({ forceOrdinalOne: () => true });
    const tMiss = await mismatch.mintAndCarryToken('run-alpha', 'stage-images');
    const relMiss = `${NS}/2026-08-03-int/assets/scenes/mismatch.png`;
    const ok = await mismatch.postImage(tMiss, relMiss);
    expect((ok.json() as { status: string }).status).toBe('succeeded');
    // Corrupt the committed artifact so the REAL verifier re-measures a DIFFERENT sha256 on replay.
    writeFileSync(join(mismatch.assetRoot, relMiss), Buffer.from(pngFixture(99)));
    const downgraded = await mismatch.postImage(tMiss, relMiss); // ordinal 1 again → replay → mismatch
    expect(downgraded.statusCode).toBe(200);
    expect(downgraded.json()).toMatchObject({ status: 'unknown', reason: 'artifact-verification-failed' });
    expect(mismatch.service.snapshot().some((a) => a.state === 'unknown')).toBe(true);
  });

  it('#5 server-derivation: a body carrying a foreign runRef is rejected (400) and never reaches the journal', async () => {
    const chain = await makeChain();
    const token = await chain.mintAndCarryToken('run-alpha', 'stage-images');
    const rel = `${NS}/2026-08-03-int/assets/scenes/spoof.png`;
    // The body tries to name its own runRef (and other identity keys). Exact-key validation rejects it
    // outright — identity is derived from the grant/execution/journal, never the worker's request body.
    const res = await chain.postImage(token, rel, { runRef: 'run-foreign', stageRef: 'stage-victim', attemptRef: 'attempt-x', callOrdinal: 99 });
    expect(res.statusCode).toBe(400);
    expect((res.json() as { error: string }).error).toBe('invalid-body');
    // Nothing was reserved or charged: the journal has no action for the foreign run (or any run).
    expect(chain.service.snapshot()).toHaveLength(0);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildPaidActionExecution } from './paidActionWiring.ts';
import type { PaidActionRequest, PaidActionCredentialResolver, PaidActionTransport } from './paidActionService.ts';

const ARTIFACT = 'orgs/faceless-youtube/channels/the-second-take/videos/2026-07-28-bricks-fresh/assets/scenes/s1.png';

function validPng(): Uint8Array {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(255);
  return Uint8Array.from(PNG.sync.write(png));
}

const credentials: PaidActionCredentialResolver = { resolve: async () => 'server-side-key' };

function imageRequest(overrides: Partial<PaidActionRequest> = {}): PaidActionRequest {
  return {
    runRef: 'run-a', stageRef: 'stage-images', attemptRef: 'attempt-1', callOrdinal: 1,
    stageId: 'images', operation: 'fyt.gemini-3-pro-image-2k',
    prompt: 'a brick wall', seeds: [seed()], expectedArtifactPath: ARTIFACT,
    ...overrides,
  } as PaidActionRequest;
}

function seed(): { bytes: Uint8Array; sha256: string } {
  const bytes = validPng();
  return { bytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

describe('buildPaidActionExecution', () => {
  let roots: string[] = [];
  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), 'paid-wiring-'));
    roots.push(dir);
    return dir;
  }
  afterEach(() => {
    for (const dir of roots) rmSync(dir, { recursive: true, force: true });
    roots = [];
  });

  it('commits provider bytes into the RUN\'s attempt worktree and returns metadata (root-resolving committer)', async () => {
    const stateRoot = tmp();
    const worktreeRoot = tmp();
    const png = validPng();
    const transport: PaidActionTransport = { dispatch: async () => ({ provider: 'gemini', mediaType: 'image/png', bytes: png }) };
    const { paidActionService } = buildPaidActionExecution({ stateRoot, worktreeRoot, credentials, transport });

    const result = await paidActionService.execute(imageRequest());
    expect(result.status).toBe('succeeded');

    // Bytes landed under worktreeRoot/<runRef>/<attemptRef>/<expectedArtifactPath> — not a fixed root.
    const committed = join(worktreeRoot, 'run-a', 'attempt-1', ...ARTIFACT.split('/'));
    expect(existsSync(committed)).toBe(true);
    expect(createHash('sha256').update(readFileSync(committed)).digest('hex'))
      .toBe(createHash('sha256').update(png).digest('hex'));
  });

  it('re-verifies a succeeded replay by re-reading the same attempt worktree (root-resolving verifier)', async () => {
    const stateRoot = tmp();
    const worktreeRoot = tmp();
    const transport: PaidActionTransport = { dispatch: async () => ({ provider: 'gemini', mediaType: 'image/png', bytes: validPng() }) };
    const { paidActionService } = buildPaidActionExecution({ stateRoot, worktreeRoot, credentials, transport });

    const first = await paidActionService.execute(imageRequest());
    expect(first.status).toBe('succeeded');
    // Same identity => idempotent replay; the verifier resolves the worktree via the journal snapshot.
    const replay = await paidActionService.execute(imageRequest());
    expect(replay.status).toBe('replayed');
  });

  it('shares ONE durable journal at stateRoot/control so the global ceiling is journal-wide', async () => {
    const stateRoot = tmp();
    const worktreeRoot = tmp();
    const transport: PaidActionTransport = { dispatch: async () => ({ provider: 'gemini', mediaType: 'image/png', bytes: validPng() }) };
    const first = buildPaidActionExecution({ stateRoot, worktreeRoot, credentials, transport });
    await first.paidActionService.execute(imageRequest());

    // A fresh assembly over the SAME stateRoot reads the SAME journal (one global spend record).
    const reopened = buildPaidActionExecution({ stateRoot, worktreeRoot, credentials, transport });
    const snapshot = reopened.paidActionService.snapshot();
    expect(snapshot).toHaveLength(1);
    expect(snapshot[0]).toMatchObject({ runRef: 'run-a', stageRef: 'stage-images', attemptRef: 'attempt-1', operation: 'fyt.gemini-3-pro-image-2k' });
  });

  it('exposes a spend-grant store that mints and resolves against the same state root', async () => {
    const stateRoot = tmp();
    const worktreeRoot = tmp();
    const { spendGrantStore } = buildPaidActionExecution({ stateRoot, worktreeRoot, credentials });
    const { token } = await spendGrantStore.mint({
      runRef: 'run-a', stageRef: 'stage-images', operation: 'fyt.gemini-3-pro-image-2k',
      subject: 'operator', gateRequestRef: 'request-1', ttlMs: 60_000,
    });
    expect(spendGrantStore.resolve(token)?.runRef).toBe('run-a');
    // Second live mint for the same tuple is refused (no cap doubling).
    await expect(spendGrantStore.mint({
      runRef: 'run-a', stageRef: 'stage-images', operation: 'fyt.gemini-3-pro-image-2k',
      subject: 'operator', gateRequestRef: 'request-1', ttlMs: 60_000,
    })).rejects.toMatchObject({ code: 'grant-already-live' });
  });
});

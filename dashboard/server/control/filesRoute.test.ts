/**
 * F4 — the scoped, hash-verified artifact download.
 *
 * Every case here runs against a REAL temporary repository (a real `orgs/<project>/workflows/*.md` so
 * the server-owned roots map is derived exactly as production derives it, and real files on disk), with
 * the real Fastify surface and a real minted session. Nothing about scope, symlinks, the byte cap or the
 * digest is stubbed — those four are the whole security value of this route.
 */
import Fastify from 'fastify';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import { createInMemoryControlPlaneStore } from './store.ts';
import { ARTIFACT_DOWNLOAD_MAX_BYTES } from './artifactFiles.ts';
import { sha256HexBytes } from '../shared/hashing.ts';

const SESSION: SessionConfig = { secret: Buffer.from('files-route-test-secret-32-bytes!!'), ttlMs: 60_000 };
const ORIGIN = 'http://localhost:5317';
const BRIEF = 'orgs/demo/output/brief.md';
const BODY = 'artifact bytes\nsecond line\n';
const DIGEST = sha256HexBytes(Buffer.from(BODY, 'utf8'));

function headers(token: string) {
  return { origin: ORIGIN, host: 'localhost:5317', authorization: `Bearer ${token}` };
}

/**
 * R5: every request names the entity whose projection minted the link. `demo` is the workflow that owns
 * `orgs/demo`; `other` is a second workflow in a second project, used to prove that one entity's link
 * cannot be redeemed for another entity's files.
 */
/**
 * The scan derives a definition's ref from its own `id` only when the whole definition parses; these
 * fixtures are deliberately minimal (they exist to seed the roots map, nothing more), so each takes the
 * path-derived `<project>~<basename>` fallback. `/api/workflows/:id` resolves the same two refs.
 */
const DEMO_ENTITY = 'workflow:demo~demo';
const OTHER_ENTITY = 'workflow:other~other';

function url(path: string, sha256: string = DIGEST, entity: string | null = DEMO_ENTITY): string {
  const parts = [`path=${encodeURIComponent(path)}`, `sha256=${encodeURIComponent(sha256)}`];
  if (entity !== null) {
    const [type, id] = entity.split(':');
    parts.push(`entityType=${encodeURIComponent(type ?? '')}`, `entityId=${encodeURIComponent(id ?? '')}`);
  }
  return `/api/control/files?${parts.join('&')}`;
}

describe('scoped artifact download', () => {
  let repoRoot: string;
  let stateRoot: string;
  let app: FastifyInstance;
  let token: string;
  let auditRows: Record<string, unknown>[];

  beforeEach(() => {
    repoRoot = mkdtempSync(join(tmpdir(), 'files-route-repo-'));
    stateRoot = mkdtempSync(join(tmpdir(), 'files-route-state-'));
    // One project directory with one workflow definition — the only thing that puts `orgs/demo` into
    // the server-owned roots map. A path under any other directory is therefore out of scope by
    // construction, not by a list this test invented.
    mkdirSync(join(repoRoot, 'orgs', 'demo', 'workflows'), { recursive: true });
    mkdirSync(join(repoRoot, 'orgs', 'demo', 'output'), { recursive: true });
    writeFileSync(join(repoRoot, 'orgs', 'demo', 'workflows', 'demo.md'), '---\nid: demo\nproject: demo\n---\n');
    writeFileSync(join(repoRoot, 'orgs', 'demo', 'output', 'brief.md'), BODY);
    // A SECOND project with its own workflow and its own artifact. Before R5 the route's roots map was
    // the union of every project on the box, so the `other` link redeemed `demo` files and vice versa.
    mkdirSync(join(repoRoot, 'orgs', 'other', 'workflows'), { recursive: true });
    mkdirSync(join(repoRoot, 'orgs', 'other', 'output'), { recursive: true });
    writeFileSync(join(repoRoot, 'orgs', 'other', 'workflows', 'other.md'), '---\nid: other\nproject: other\n---\n');
    writeFileSync(join(repoRoot, 'orgs', 'other', 'output', 'brief.md'), BODY);
    // A secret OUTSIDE every root, used as the traversal/absolute-path target.
    writeFileSync(join(repoRoot, 'secret.txt'), 'do not serve me');

    auditRows = [];
    token = mintSession('operator', SESSION).token;
    app = Fastify();
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot,
      stateRoot,
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      controlStore: createInMemoryControlPlaneStore(),
      appendAudit: (_repoRoot, event) => { auditRows.push(event as unknown as Record<string, unknown>); return { ts: new Date().toISOString(), ...event }; },
      appendAuditLocal: (_repoRoot, event) => { auditRows.push(event as unknown as Record<string, unknown>); return { ts: new Date().toISOString(), ...event }; },
    }));
  });

  afterEach(async () => {
    await app.close();
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(stateRoot, { recursive: true, force: true });
  });

  it('serves the exact bytes of an in-root file with download-only headers and a T2 audit row', async () => {
    const res = await app.inject({ method: 'GET', url: url(BRIEF), headers: headers(token) });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(BODY);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.headers['content-disposition']).toBe('attachment; filename="brief.md"');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    const row = auditRows.find((entry) => entry.action === 'control-artifact-download');
    expect(row).toMatchObject({ owner: 'operator', riskTier: 'T2', target: BRIEF });
    expect((row?.detail as Record<string, unknown>).digest).toBe(DIGEST);
  });

  it('refuses every shape of out-of-scope path with one indistinguishable 404', async () => {
    for (const path of [
      '../secret.txt',
      'orgs/demo/output/../../../secret.txt',
      join(repoRoot, 'secret.txt').split('\\').join('/'),
      '/etc/passwd',
      'C:/Windows/win.ini',
      'orgs\\demo\\output\\brief.md',
      'secret.txt',
      'orgs/other/output/brief.md',
      'orgs/demo/output',
      'orgs/demo/output/absent.md',
    ]) {
      const res = await app.inject({ method: 'GET', url: url(path), headers: headers(token) });
      expect([path, res.statusCode]).toEqual([path, 404]);
      expect([path, res.json()]).toEqual([path, { error: 'not found' }]);
    }
    expect(auditRows.filter((entry) => entry.action === 'control-artifact-download')).toEqual([]);
  });

  it('refuses a symlink that points at an in-root file, so the link itself is never followed', async () => {
    const link = join(repoRoot, 'orgs', 'demo', 'output', 'link.md');
    try {
      symlinkSync(join(repoRoot, 'orgs', 'demo', 'output', 'brief.md'), link, 'file');
    } catch {
      return; // unprivileged Windows cannot create symlinks; the POSIX/elevated run covers this case
    }
    const res = await app.inject({ method: 'GET', url: url('orgs/demo/output/link.md'), headers: headers(token) });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain('artifact bytes');
  });

  it('refuses a file reached through a symlinked ANCESTOR directory', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'files-route-outside-'));
    mkdirSync(join(outside, 'output'), { recursive: true });
    writeFileSync(join(outside, 'output', 'brief.md'), BODY);
    // The link sits INSIDE the `orgs/demo` root, so the roots check admits the requested path and only
    // the real-path equality can catch the escape.
    try {
      symlinkSync(outside, join(repoRoot, 'orgs', 'demo', 'output', 'nested'), 'dir');
    } catch {
      rmSync(outside, { recursive: true, force: true });
      return;
    }
    const res = await app.inject({ method: 'GET', url: url('orgs/demo/output/nested/output/brief.md'), headers: headers(token) });
    expect(res.statusCode).toBe(404);
    rmSync(outside, { recursive: true, force: true });
  });

  it('R6: a digest mismatch is the SAME flat 404 as an absent file, so existence is not an oracle', async () => {
    writeFileSync(join(repoRoot, 'orgs', 'demo', 'output', 'brief.md'), 'substituted bytes\n');
    const substituted = await app.inject({ method: 'GET', url: url(BRIEF), headers: headers(token) });
    const absent = await app.inject({ method: 'GET', url: url('orgs/demo/output/absent.md'), headers: headers(token) });
    expect([substituted.statusCode, substituted.json()]).toEqual([404, { error: 'not found' }]);
    expect([substituted.statusCode, substituted.json()]).toEqual([absent.statusCode, absent.json()]);
    expect(substituted.body).not.toContain('substituted bytes');
    expect(auditRows.filter((entry) => entry.action === 'control-artifact-download')).toEqual([]);
  });

  it('refuses a request that carries no usable digest rather than serving unverified bytes', async () => {
    for (const sha of ['', 'NOT-HEX', 'a'.repeat(63)]) {
      const res = await app.inject({ method: 'GET', url: url(BRIEF, sha), headers: headers(token) });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: 'digest-required' });
    }
  });

  it('R6: an over-cap file is the SAME flat 404 as an absent one, so size is not an oracle', async () => {
    const big = Buffer.alloc(ARTIFACT_DOWNLOAD_MAX_BYTES + 1, 0x61);
    writeFileSync(join(repoRoot, 'orgs', 'demo', 'output', 'big.bin'), big);
    const oversize = await app.inject({
      method: 'GET', url: url('orgs/demo/output/big.bin', sha256HexBytes(big)), headers: headers(token),
    });
    const absent = await app.inject({
      method: 'GET', url: url('orgs/demo/output/absent.bin', sha256HexBytes(big)), headers: headers(token),
    });
    expect([oversize.statusCode, oversize.json()]).toEqual([404, { error: 'not found' }]);
    expect([oversize.statusCode, oversize.json()]).toEqual([absent.statusCode, absent.json()]);
  });

  it('never lets a filename that could break the header out of the allowlist', async () => {
    // A space is enough to fall outside the allowlist and is creatable on every platform this runs on;
    // the quote/semicolon/CRLF cases the allowlist really guards against are unrepresentable as
    // Windows filenames, so the allowlist itself is the assertion and this proves the DROP path.
    const odd = 'orgs/demo/output/we ird.md';
    writeFileSync(join(repoRoot, 'orgs', 'demo', 'output', 'we ird.md'), BODY);
    const res = await app.inject({ method: 'GET', url: url(odd), headers: headers(token) });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment');
  });

  it('refuses an unauthenticated download', async () => {
    const res = await app.inject({ method: 'GET', url: url(BRIEF), headers: { origin: ORIGIN, host: 'localhost:5317' } });
    expect(res.statusCode).toBe(401);
    expect(res.body).not.toContain('artifact bytes');
  });

  /**
   * R5 - the red-on-revert case. Both files exist, both sit in a server-owned root, and the caller
   * presents the correct sha256 for each; the ONLY thing separating them is which entity's projection
   * could have minted the link. Revert the route to the union roots map and all three legs serve 200.
   */
  it('R5: an entity cannot redeem a link for a file outside its own project', async () => {
    const own = await app.inject({ method: 'GET', url: url(BRIEF, DIGEST, DEMO_ENTITY), headers: headers(token) });
    expect([own.statusCode, own.body]).toEqual([200, BODY]);

    const crossed = await app.inject({ method: 'GET', url: url(BRIEF, DIGEST, OTHER_ENTITY), headers: headers(token) });
    expect([crossed.statusCode, crossed.json()]).toEqual([404, { error: 'not found' }]);
    expect(crossed.body).not.toContain('artifact bytes');

    const reverse = await app.inject({ method: 'GET', url: url('orgs/other/output/brief.md', DIGEST, DEMO_ENTITY), headers: headers(token) });
    expect([reverse.statusCode, reverse.json()]).toEqual([404, { error: 'not found' }]);
    expect(auditRows.filter((entry) => entry.action === 'control-artifact-download')).toHaveLength(1);
  });

  it('R5: naming no entity, an unknown entity, or an unknown entity kind is one flat 404', async () => {
    for (const entity of [null, 'workflow:absent', 'agent:absent', 'run:run-1', ':demo', 'workflow:']) {
      const res = await app.inject({ method: 'GET', url: url(BRIEF, DIGEST, entity), headers: headers(token) });
      expect([entity, res.statusCode, res.json()]).toEqual([entity, 404, { error: 'not found' }]);
      expect(res.body).not.toContain('artifact bytes');
    }
  });

  /**
   * R7 - the descriptor, not the path, decides what is served. A swap landing strictly BETWEEN the open
   * and the read cannot be staged from a single-threaded test, so this covers the half that can be: a
   * symlink standing where the artifact stood is refused rather than followed, and the out-of-root bytes
   * never reach a response under either digest. The uncovered residual (Windows, a swap inside the
   * open/check window) is backstopped by the digest, which the R6 mismatch case proves is enforced over
   * the bytes actually read from the descriptor.
   */
  it('R7: a symlink swapped in where the artifact stood is refused under either digest', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'files-route-swap-'));
    const planted = 'planted bytes\n';
    writeFileSync(join(outside, 'planted.md'), planted);
    const artifact = join(repoRoot, 'orgs', 'demo', 'output', 'brief.md');
    rmSync(artifact);
    try {
      symlinkSync(join(outside, 'planted.md'), artifact, 'file');
    } catch {
      rmSync(outside, { recursive: true, force: true });
      return; // unprivileged Windows cannot create symlinks; the POSIX/elevated run covers this case
    }
    for (const sha of [DIGEST, sha256HexBytes(Buffer.from(planted, 'utf8'))]) {
      const res = await app.inject({ method: 'GET', url: url(BRIEF, sha), headers: headers(token) });
      expect([sha, res.statusCode]).toEqual([sha, 404]);
      expect(res.body).not.toContain('planted bytes');
    }
    rmSync(outside, { recursive: true, force: true });
  });
});

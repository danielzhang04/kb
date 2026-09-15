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
import { dirname, join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mintSession, type SessionConfig } from '../auth/session.ts';
import { makeSurfaceContext, registerWriteSurface } from '../http/surface.ts';
import { createInMemoryControlPlaneStore, type ControlPlaneStore } from './store.ts';
import {
  canonicalIntegrationStatePath,
  clearIntegrationJournalCache,
  runIntegrationDir,
} from './integrationLayout.ts';
import { ARTIFACT_DOWNLOAD_MAX_BYTES } from './artifactFiles.ts';
import { sha256HexBytes } from '../shared/hashing.ts';
import { outputHref } from '../entities/outputs.ts';
import type { OutputRef } from './p2Contracts.ts';

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
  let controlStore: ControlPlaneStore;

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
    controlStore = createInMemoryControlPlaneStore();
    clearIntegrationJournalCache();
    token = mintSession('operator', SESSION).token;
    app = Fastify();
    registerWriteSurface(app, makeSurfaceContext({
      repoRoot,
      stateRoot,
      sessionConfig: SESSION,
      allowedOrigins: [ORIGIN],
      controlStore,
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
  it('R7: a symlink swapped in where the artifact stood is refused under either digest', async (ctx) => {
    const outside = mkdtempSync(join(tmpdir(), 'files-route-swap-'));
    const planted = 'planted bytes\n';
    writeFileSync(join(outside, 'planted.md'), planted);
    const artifact = join(repoRoot, 'orgs', 'demo', 'output', 'brief.md');
    rmSync(artifact);
    try {
      symlinkSync(join(outside, 'planted.md'), artifact, 'file');
    } catch {
      rmSync(outside, { recursive: true, force: true });
      // S6 (review r2): a bare `return` here reported as a silent PASS, so this guard's coverage
      // status on unprivileged Windows (the dev platform) was invisible in the run summary. Report it
      // honestly as skipped instead.
      ctx.skip();
      return;
    }
    for (const sha of [DIGEST, sha256HexBytes(Buffer.from(planted, 'utf8'))]) {
      const res = await app.inject({ method: 'GET', url: url(BRIEF, sha), headers: headers(token) });
      expect([sha, res.statusCode]).toEqual([sha, 404]);
      expect(res.body).not.toContain('planted bytes');
    }
    rmSync(outside, { recursive: true, force: true });
  });
  // -------------------------------------------------------------------------------------------
  // The RUN entity. A canonical run's artifacts never land in the checkout: the integrator
  // materializes them in that run's OWN integration worktree under the state root
  // (`integrationLayout.ts`). Every case below writes them exactly where the integrator does, and
  // the roots the route admits are derived from the approved plan + the integration journal.
  // -------------------------------------------------------------------------------------------

  const RUN_BRIEF = 'orgs/demo/output/run-brief.json';
  const RUN_SCRATCH = 'orgs/demo/output/scratch.txt';

  /**
   * One approved single-stage plan + its run. `declared` is what the plan claims as artifacts.
   * `subject` defaults to `'operator'` for the existing cases; S2 (review r2) passes a non-operator
   * subject to exercise the ownership check that `readScopeForSubject` gates — every prior case here
   * ran as `OPERATOR_SUBJECT`, so `getRun` always resolved with `'all-subjects'` scope and the
   * own-subject narrowing at artifactFilesRoute.ts:66-68 had no coverage.
   */
  function seedRun(suffix: string, declared: string[], subject: string = 'operator'): string {
    const proposal = controlStore.createProposalRevision(subject, {
      sourceComposerRef: `composer-${suffix}`,
      sourceTurnId: `turn-${suffix}`,
      title: `Run ${suffix}`,
      snapshot: {
        schema: 'kb.plan-proposal/v1',
        title: `Run ${suffix}`,
        manager: {},
        stages: [{
          id: 'writer', title: 'Writer', dependsOn: [],
          artifacts: declared.map((path, index) => ({ id: `artifact-${index}`, path })),
        }],
      },
    });
    if (!proposal.ok) throw new Error(proposal.detail);
    const approved = controlStore.decideProposal(subject, proposal.value.proposalRef, proposal.value.revision, {
      expectedHash: proposal.value.hash,
      expectedApprovalRevision: 0,
      decision: 'approved',
      idempotencyKey: `approve-${suffix}`,
    });
    if (!approved.ok) throw new Error(approved.detail);
    const run = controlStore.createRun(subject, {
      owner: { type: 'agent', id: 'grader', sourcePath: 'agents/grader.md' },
      executionHost: 'desktop',
      title: `Run ${suffix}`,
      proposalRef: approved.value.proposalRef,
      proposalRevision: approved.value.revision,
      expectedProposalHash: approved.value.hash,
      managerRuntime: 'claude',
      managerModel: 'claude-sonnet-5',
      idempotencyKey: `launch-${suffix}`,
      stages: [{ stageId: 'writer', title: 'Writer', dependsOn: [] }],
    });
    if (!run.ok) throw new Error(run.detail);
    return run.value.run.runRef;
  }

  type JournalRecord = {
    runRef: string; stageId: string; state: string;
    result: { changed: { path: string; digest: string }[] };
  };

  /** The integrator's own journal, at the integrator's own path. */
  function writeJournal(records: JournalRecord[]): void {
    const path = canonicalIntegrationStatePath(stateRoot);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ schema: 'kb.canonical-integration/v1', records }), 'utf8');
    clearIntegrationJournalCache();
  }

  /** The integrated bytes, in the run's own integration worktree. */
  function writeIntegrated(runRef: string, path: string, body: string): void {
    const destination = join(runIntegrationDir(stateRoot, runRef), ...path.split('/'));
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, body, 'utf8');
  }

  function journalRecord(runRef: string, state: string, paths: string[]): JournalRecord {
    return {
      runRef, stageId: 'writer', state,
      result: { changed: paths.map((path) => ({ path, digest: 'b'.repeat(64) })) },
    };
  }

  function runUrl(runRef: string, path: string, sha: string): string {
    return `/api/control/files?path=${encodeURIComponent(path)}&sha256=${encodeURIComponent(sha)}`
      + `&entityType=run&entityId=${encodeURIComponent(runRef)}`;
  }

  /**
   * RED ON REVERT. Point the run branch at `ctx.repoRoot` (the pre-fix behaviour, and the whole reason
   * acceptance item 6 failed on the VM) and this 200 becomes a 404: the checkout holds DIFFERENT bytes at
   * this very path, so it cannot even be rescued by the digest.
   */
  it('serves a run-entity link from the run OWN integration worktree, not the checkout', async () => {
    const runRef = seedRun('own', [RUN_BRIEF]);
    const integrated = '{"brief":"integrated bytes"}\n';
    writeIntegrated(runRef, RUN_BRIEF, integrated);
    // The same path in the CHECKOUT, with different bytes, is what a repo-rooted route would find.
    mkdirSync(join(repoRoot, 'orgs', 'demo', 'output'), { recursive: true });
    writeFileSync(join(repoRoot, 'orgs', 'demo', 'output', 'run-brief.json'), '{"brief":"checkout bytes"}\n');
    writeJournal([journalRecord(runRef, 'canonical-committed', [RUN_BRIEF])]);

    const digest = sha256HexBytes(Buffer.from(integrated, 'utf8'));
    const res = await app.inject({ method: 'GET', url: runUrl(runRef, RUN_BRIEF, digest), headers: headers(token) });
    expect([res.statusCode, res.body]).toEqual([200, integrated]);
    expect(res.headers['content-disposition']).toBe('attachment; filename="run-brief.json"');
    const row = auditRows.find((entry) => entry.action === 'control-artifact-download');
    expect(row).toMatchObject({ owner: 'operator', riskTier: 'T2', target: RUN_BRIEF });
  });

  it('refuses a path inside the integration worktree that the run never declared, and one outside it', async () => {
    const runRef = seedRun('scoped', [RUN_BRIEF]);
    const integrated = 'declared\n';
    const scratch = 'undeclared\n';
    writeIntegrated(runRef, RUN_BRIEF, integrated);
    writeIntegrated(runRef, RUN_SCRATCH, scratch);
    // The journal saw BOTH change; only the declared one is an output.
    writeJournal([journalRecord(runRef, 'canonical-committed', [RUN_BRIEF, RUN_SCRATCH])]);

    const undeclared = await app.inject({
      method: 'GET',
      url: runUrl(runRef, RUN_SCRATCH, sha256HexBytes(Buffer.from(scratch, 'utf8'))),
      headers: headers(token),
    });
    expect([undeclared.statusCode, undeclared.json()]).toEqual([404, { error: 'not found' }]);
    expect(undeclared.body).not.toContain('undeclared');

    for (const path of ['../secret.txt', 'orgs/demo/output/../../../secret.txt', 'orgs/demo/workflows/demo.md', BRIEF]) {
      const res = await app.inject({
        method: 'GET',
        url: runUrl(runRef, path, sha256HexBytes(Buffer.from(BODY, 'utf8'))),
        headers: headers(token),
      });
      expect([path, res.statusCode, res.json()]).toEqual([path, 404, { error: 'not found' }]);
    }
    expect(auditRows.filter((entry) => entry.action === 'control-artifact-download')).toEqual([]);
  });

  /**
   * RED ON REVERT for the per-run base. Both runs declare the SAME repo-relative path and both
   * integrated it, with different bytes. A route that resolved a run link anywhere but that run's own
   * integration directory would serve one run's brief under the other run's link.
   */
  it('cannot redeem one run link for another run artifact', async () => {
    const first = seedRun('first', [RUN_BRIEF]);
    const second = seedRun('second', [RUN_BRIEF]);
    writeIntegrated(first, RUN_BRIEF, 'first brief\n');
    writeIntegrated(second, RUN_BRIEF, 'second brief\n');
    writeJournal([
      journalRecord(first, 'canonical-committed', [RUN_BRIEF]),
      journalRecord(second, 'canonical-committed', [RUN_BRIEF]),
    ]);
    const firstDigest = sha256HexBytes(Buffer.from('first brief\n', 'utf8'));
    const secondDigest = sha256HexBytes(Buffer.from('second brief\n', 'utf8'));

    const own = await app.inject({ method: 'GET', url: runUrl(second, RUN_BRIEF, secondDigest), headers: headers(token) });
    expect([own.statusCode, own.body]).toEqual([200, 'second brief\n']);

    const crossed = await app.inject({ method: 'GET', url: runUrl(second, RUN_BRIEF, firstDigest), headers: headers(token) });
    expect([crossed.statusCode, crossed.json()]).toEqual([404, { error: 'not found' }]);
    expect(crossed.body).not.toContain('first brief');
    expect(auditRows.filter((entry) => entry.action === 'control-artifact-download')).toHaveLength(1);
  });

  it('refuses a bad digest, an unknown run, and a run whose integration never reached canonical', async () => {
    const runRef = seedRun('mismatch', [RUN_BRIEF]);
    const integrated = 'integrated\n';
    writeIntegrated(runRef, RUN_BRIEF, integrated);
    const stranded = seedRun('stranded', [RUN_BRIEF]);
    writeIntegrated(stranded, RUN_BRIEF, integrated);
    // `stranded` has BYTES on disk but its record never reached canonical-committed: not an output.
    writeJournal([
      journalRecord(runRef, 'canonical-committed', [RUN_BRIEF]),
      journalRecord(stranded, 'lineage-committed', [RUN_BRIEF]),
    ]);
    const digest = sha256HexBytes(Buffer.from(integrated, 'utf8'));

    const tampered = await app.inject({ method: 'GET', url: runUrl(runRef, RUN_BRIEF, 'a'.repeat(64)), headers: headers(token) });
    expect([tampered.statusCode, tampered.json()]).toEqual([404, { error: 'not found' }]);

    const unknown = await app.inject({ method: 'GET', url: runUrl('run-absent', RUN_BRIEF, digest), headers: headers(token) });
    expect([unknown.statusCode, unknown.json()]).toEqual([404, { error: 'not found' }]);

    const belowCanonical = await app.inject({ method: 'GET', url: runUrl(stranded, RUN_BRIEF, digest), headers: headers(token) });
    expect([belowCanonical.statusCode, belowCanonical.json()]).toEqual([404, { error: 'not found' }]);
    expect(belowCanonical.body).not.toContain('integrated');
  });

  /** The run DTO is the only producer of run links, and it projects integrated declared artifacts only. */
  it('projects the run DTO outputs from integrated declared artifacts, and serves the link it minted', async () => {
    const runRef = seedRun('dto', [RUN_BRIEF]);
    const integrated = '{"brief":"dto bytes"}\n';
    writeIntegrated(runRef, RUN_BRIEF, integrated);
    writeIntegrated(runRef, RUN_SCRATCH, 'undeclared\n');
    writeJournal([journalRecord(runRef, 'canonical-committed', [RUN_BRIEF, RUN_SCRATCH])]);

    const detail = await app.inject({ method: 'GET', url: `/api/control/runs/${runRef}`, headers: headers(token) });
    expect(detail.statusCode, detail.body).toBe(200);
    const outputs = (detail.json() as { value: { outputs: OutputRef[] } }).value.outputs;
    expect(outputs).toEqual([{
      kind: 'artifact',
      label: 'run-brief.json',
      path: RUN_BRIEF,
      digest: sha256HexBytes(Buffer.from(integrated, 'utf8')),
      entity: { type: 'run', id: runRef },
    }]);

    // The DTO's own href, followed verbatim - no test-built URL in this leg.
    const served = await app.inject({ method: 'GET', url: outputHref(outputs[0]!), headers: headers(token) });
    expect([served.statusCode, served.body]).toEqual([200, integrated]);
  });

  it('projects no run outputs while the integration is below canonical-committed', async () => {
    const runRef = seedRun('below', [RUN_BRIEF]);
    writeIntegrated(runRef, RUN_BRIEF, 'integrated\n');
    writeJournal([journalRecord(runRef, 'lineage-committed', [RUN_BRIEF])]);
    const detail = await app.inject({ method: 'GET', url: `/api/control/runs/${runRef}`, headers: headers(token) });
    expect(detail.statusCode, detail.body).toBe(200);
    expect((detail.json() as { value: { outputs: OutputRef[] } }).value.outputs).toEqual([]);
  });

  /**
   * S2 (review r2). Every case above minted its session as `'operator'` (= `OPERATOR_SUBJECT`), so
   * `readScopeForSubject` always returned `'all-subjects'` and the own-subject ownership narrowing at
   * artifactFilesRoute.ts:66-68 (`ctx.controlStore.getRun(sub, runRef, readScopeForSubject(sub))`) ran
   * unexercised — the whole suite stayed green even with `readScopeForSubject(sub)` hardcoded to
   * `'all-subjects'`. This run is owned by non-operator subject A; a different non-operator subject B
   * must be refused with the same flat 404 as a run that does not exist, and A must still succeed.
   * RED ON REVERT: hardcoding `'all-subjects'` for `outputFileScopeForEntity`'s run branch (matching
   * OPERATOR_SUBJECT's own-request scope) turns the cross-subject 404 below into a 200.
   */
  it('refuses a run-entity download for a non-operator subject that does not own the run, and serves it for the owner', async () => {
    const runRef = seedRun('owned-by-a', [RUN_BRIEF], 'subject-a');
    const integrated = '{"brief":"subject-a bytes"}\n';
    writeIntegrated(runRef, RUN_BRIEF, integrated);
    writeJournal([journalRecord(runRef, 'canonical-committed', [RUN_BRIEF])]);
    const digest = sha256HexBytes(Buffer.from(integrated, 'utf8'));

    const tokenA = mintSession('subject-a', SESSION).token;
    const tokenB = mintSession('subject-b', SESSION).token;

    const foreign = await app.inject({ method: 'GET', url: runUrl(runRef, RUN_BRIEF, digest), headers: headers(tokenB) });
    expect([foreign.statusCode, foreign.json()]).toEqual([404, { error: 'not found' }]);
    expect(foreign.body).not.toContain('subject-a bytes');
    expect(auditRows.filter((entry) => entry.action === 'control-artifact-download')).toEqual([]);

    const owner = await app.inject({ method: 'GET', url: runUrl(runRef, RUN_BRIEF, digest), headers: headers(tokenA) });
    expect([owner.statusCode, owner.body]).toEqual([200, integrated]);
    const row = auditRows.find((entry) => entry.action === 'control-artifact-download');
    expect(row).toMatchObject({ owner: 'subject-a', riskTier: 'T2', target: RUN_BRIEF });
  });
});

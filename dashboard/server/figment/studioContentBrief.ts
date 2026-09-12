/** Governed publication of one validated creator-001 content-brief revision. */
import { createHash } from 'node:crypto';
import { lstat, mkdir, open, opendir, realpath, rmdir, unlink } from 'node:fs/promises';
import { isAbsolute, join, parse, relative, resolve, sep, win32 } from 'node:path';
import type { BigIntStats } from 'node:fs';
import type { FastifyInstance } from 'fastify';
import type { SessionConfig } from '../auth/session.ts';
import { requireSession, verifiedSession } from '../http/middleware.ts';
import { resolvePython } from '../runtime/python.ts';
import { collectContentBriefs } from './contentBriefs.ts';
import { runStudioPlanProcessCapture, StudioPlanProcessError } from './studioPlanProcess.ts';

const BODY_LIMIT = 65_536;
const TIMEOUT_MS = 30_000;
const MAX_PROCESS_OUTPUT = 16 * 1024;
const MAX_ID = 128;
const MAX_TEXT = 4_096;
const MAX_ROOT = 4_096;
const MAX_ALLOCATION_ENTRIES = 3;
const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256 = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/;
const SUCCESS_SCHEMA = 'figment/studio-content-brief-revision@1';
const READER_SCHEMA = 'figment/content-brief-revalidation@1';
const RECOVERY_SCHEMA = 'figment/studio-content-brief-revision-recovery@1';
const ALLOCATION_RELATIVE = 'content/.studio-revision-active';
const EDITS_RELATIVE = `${ALLOCATION_RELATIVE}/edits.json`;

export interface StudioContentBriefRequest {
  baseBriefId: string;
  briefDate: string;
  slug: string;
  hypothesis: string;
  intendedMetric: string;
}

export interface StudioContentBriefPublished {
  schema: 'figment/studio-content-brief-revision@1';
  status: 'published';
  briefId: string;
  briefSha256: string;
}

export type StudioContentBriefErrorCode =
  | 'invalid-request'
  | 'body-too-large'
  | 'not-found'
  | 'busy'
  | 'brief-exists'
  | 'publication-unavailable';

export interface StudioContentBriefError {
  error: StudioContentBriefErrorCode;
}

export interface StudioContentBriefAudit {
  baseBriefId: string;
  briefId: string;
  briefSha256: string;
}

export interface StudioContentBriefOptions {
  repoRoot: string;
  sessionConfig: SessionConfig;
  runProcess?: typeof runStudioPlanProcessCapture;
  collectBriefs?: typeof collectContentBriefs;
  pythonResolver?: typeof resolvePython;
  platform?: NodeJS.Platform;
  now?: () => Date;
  auditPublished: (subject: string, result: StudioContentBriefAudit) => Promise<void>;
}

interface DirectoryIdentity { dev: bigint; ino: bigint; real: string; }
interface FileIdentity { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; }
interface SafeRoot extends DirectoryIdentity { path: string; }
interface OwnedAllocation {
  path: string;
  identity: DirectoryIdentity;
  edits: FileIdentity | null;
  recovery: FileIdentity | null;
}

class IdentityFailure extends Error {}

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
  && Object.getPrototypeOf(value) === Object.prototype;

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function wellFormed(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      if (index + 1 >= value.length) return false;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function normalizedId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_ID
    && wellFormed(value) && ID.test(value);
}

function canonicalDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE.test(value) || value.startsWith('0000-')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function revisionText(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 1 && value.length <= MAX_TEXT
    && value === value.trim() && wellFormed(value) && !CONTROL.test(value);
}

function requestBody(value: unknown): { body: StudioContentBriefRequest; briefId: string } | null {
  if (!object(value) || !exactKeys(value, [
    'baseBriefId', 'briefDate', 'slug', 'hypothesis', 'intendedMetric',
  ])) return null;
  if (!normalizedId(value.baseBriefId) || !canonicalDate(value.briefDate)
    || !normalizedId(value.slug) || !revisionText(value.hypothesis)
    || !revisionText(value.intendedMetric)) return null;
  const briefId = `${value.briefDate}-creator-001-${value.slug}`;
  if (!normalizedId(briefId)) return null;
  return { body: value as unknown as StudioContentBriefRequest, briefId };
}

function inside(root: string, candidate: string): boolean {
  const part = relative(root, candidate);
  return part === '' || (!part.startsWith(`..${sep}`) && part !== '..' && !isAbsolute(part));
}

function errno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException).code === code;
}

function directoryIdentity(info: BigIntStats, real: string): DirectoryIdentity {
  return { dev: info.dev, ino: info.ino, real };
}

function fileIdentity(info: BigIntStats): FileIdentity {
  return { dev: info.dev, ino: info.ino, size: info.size, mtimeNs: info.mtimeNs };
}

function sameDirectory(left: DirectoryIdentity, info: BigIntStats, real: string): boolean {
  return info.isDirectory() && !info.isSymbolicLink()
    && left.dev === info.dev && left.ino === info.ino && left.real === real;
}

function sameFile(left: FileIdentity, info: BigIntStats): boolean {
  return info.isFile() && !info.isSymbolicLink()
    && left.dev === info.dev && left.ino === info.ino
    && left.size === info.size && left.mtimeNs === info.mtimeNs;
}

async function safeRoot(value: string): Promise<SafeRoot | null> {
  try {
    const path = resolve(value);
    let cursor = parse(path).root;
    for (const segment of relative(cursor, path).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      const info = await lstat(cursor, { bigint: true });
      if (!info.isDirectory() || info.isSymbolicLink()) return null;
    }
    const info = await lstat(path, { bigint: true });
    const real = await realpath(path);
    return sameDirectory(directoryIdentity(info, real), info, real)
      ? { path, ...directoryIdentity(info, real) } : null;
  } catch { return null; }
}

async function currentDirectory(path: string, expected: DirectoryIdentity): Promise<boolean> {
  try {
    const info = await lstat(path, { bigint: true });
    return sameDirectory(expected, info, await realpath(path));
  } catch { return false; }
}

async function currentRoot(root: SafeRoot): Promise<boolean> {
  return currentDirectory(root.path, root);
}

async function safeExisting(
  root: SafeRoot,
  candidate: string,
  kind: 'file' | 'directory',
): Promise<{ path: string; info: BigIntStats; real: string } | null> {
  const path = resolve(candidate);
  if (!inside(root.path, path) || !await currentRoot(root)) return null;
  try {
    let cursor = root.path;
    for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) {
      cursor = join(cursor, segment);
      const info = await lstat(cursor, { bigint: true });
      if (info.isSymbolicLink()) return null;
      if (cursor !== path && !info.isDirectory()) return null;
      if (!inside(root.real, await realpath(cursor))) return null;
    }
    const info = await lstat(path, { bigint: true });
    const real = await realpath(path);
    const correct = kind === 'file' ? info.isFile() : info.isDirectory();
    return correct && !info.isSymbolicLink() && inside(root.real, real) ? { path, info, real } : null;
  } catch { return null; }
}

async function prospectiveDirectory(
  root: SafeRoot,
  candidate: string,
): Promise<'absent' | 'directory' | 'unsafe'> {
  const path = resolve(candidate);
  if (!inside(root.path, path) || !await currentRoot(root)) return 'unsafe';
  let cursor = root.path;
  for (const segment of relative(root.path, path).split(/[\\/]/).filter(Boolean)) {
    cursor = join(cursor, segment);
    try {
      const info = await lstat(cursor, { bigint: true });
      if (info.isSymbolicLink() || !inside(root.real, await realpath(cursor))) return 'unsafe';
      if (cursor !== path && !info.isDirectory()) return 'unsafe';
      if (cursor === path) return info.isDirectory() ? 'directory' : 'unsafe';
    } catch (error) { return errno(error, 'ENOENT') ? 'absent' : 'unsafe'; }
  }
  return 'directory';
}

async function createOwnedFile(path: string, content: Buffer): Promise<FileIdentity> {
  const handle = await open(path, 'wx');
  let handleInfo: BigIntStats | null = null;
  try {
    await handle.writeFile(content);
    await handle.sync();
    handleInfo = await handle.stat({ bigint: true });
  } finally {
    await handle.close();
  }
  if (handleInfo === null) throw new IdentityFailure();
  const named = await lstat(path, { bigint: true });
  if (!handleInfo.isFile() || !sameFile(fileIdentity(handleInfo), named)) throw new IdentityFailure();
  return fileIdentity(named);
}

async function currentFile(path: string, expected: FileIdentity): Promise<boolean> {
  try { return sameFile(expected, await lstat(path, { bigint: true })); }
  catch { return false; }
}

async function entryNames(path: string): Promise<string[] | null> {
  try {
    const names: string[] = [];
    const entries = await opendir(path);
    for await (const entry of entries) {
      names.push(entry.name);
      if (names.length > MAX_ALLOCATION_ENTRIES) return null;
    }
    return names.sort();
  } catch { return null; }
}

async function assertAllocation(
  allocation: OwnedAllocation,
  expected: Array<{ name: 'edits.json' | 'recovery.json'; identity: FileIdentity }>,
): Promise<void> {
  if (!await currentDirectory(allocation.path, allocation.identity)) throw new IdentityFailure();
  const names = await entryNames(allocation.path);
  const wanted = expected.map((entry) => entry.name).sort();
  if (names === null || names.length !== wanted.length
    || !names.every((name, index) => name === wanted[index])) throw new IdentityFailure();
  for (const entry of expected) {
    if (!await currentFile(join(allocation.path, entry.name), entry.identity)) throw new IdentityFailure();
  }
}

async function cleanupOwned(allocation: OwnedAllocation): Promise<void> {
  const expected: Array<{ name: 'edits.json' | 'recovery.json'; identity: FileIdentity }> = [];
  if (allocation.edits) expected.push({ name: 'edits.json', identity: allocation.edits });
  if (allocation.recovery) expected.push({ name: 'recovery.json', identity: allocation.recovery });
  await assertAllocation(allocation, expected);
  if (allocation.edits) {
    await unlink(join(allocation.path, 'edits.json'));
    allocation.edits = null;
    await assertAllocation(allocation, allocation.recovery
      ? [{ name: 'recovery.json', identity: allocation.recovery }] : []);
  }
  if (allocation.recovery) {
    await unlink(join(allocation.path, 'recovery.json'));
    allocation.recovery = null;
    await assertAllocation(allocation, []);
  }
  await rmdir(allocation.path);
}

function jsonLine(value: Record<string, string>): Buffer {
  return Buffer.from(`${JSON.stringify(value)}\n`, 'utf8');
}

function editsBytes(body: StudioContentBriefRequest): Buffer {
  return jsonLine({
    brief_date: body.briefDate,
    hypothesis: body.hypothesis,
    intended_metric: body.intendedMetric,
  });
}

function recoveryBytes(
  body: StudioContentBriefRequest,
  briefId: string,
  editsSha256: string,
  createdUtc: string,
): Buffer {
  return jsonLine({
    base_brief_id: body.baseBriefId,
    brief_id: briefId,
    created_utc: createdUtc,
    edits_sha256: editsSha256,
    schema: RECOVERY_SCHEMA,
    status: 'publication-outcome-unclaimed',
  });
}

function decodeReader(stdout: Buffer): { requestSha256: string; briefSha256: string } | null {
  try {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(stdout));
    if (!object(value) || !exactKeys(value, ['schema', 'request_sha256', 'brief_sha256'])
      || value.schema !== READER_SCHEMA || typeof value.request_sha256 !== 'string'
      || !SHA256.test(value.request_sha256) || typeof value.brief_sha256 !== 'string'
      || !SHA256.test(value.brief_sha256)) return null;
    const canonical = jsonLine({
      brief_sha256: value.brief_sha256,
      request_sha256: value.request_sha256,
      schema: READER_SCHEMA,
    });
    return stdout.equals(canonical)
      ? { requestSha256: value.request_sha256, briefSha256: value.brief_sha256 } : null;
  } catch { return null; }
}

function logFailure(error: unknown): string {
  if (error instanceof StudioPlanProcessError) return `process-${error.code}`;
  if (error instanceof IdentityFailure) return 'identity';
  return 'internal';
}

function error(code: StudioContentBriefErrorCode): StudioContentBriefError {
  return { error: code };
}

export function registerFigmentStudioContentBrief(
  app: FastifyInstance,
  options: StudioContentBriefOptions,
): void {
  const platform = options.platform ?? process.platform;
  const lexicalRoot = typeof options.repoRoot === 'string' ? win32.parse(options.repoRoot).root : '';
  let configured = platform === 'win32'
    && typeof options.repoRoot === 'string'
    && options.repoRoot.length >= 1 && options.repoRoot.length <= MAX_ROOT
    && options.repoRoot === options.repoRoot.trim()
    && wellFormed(options.repoRoot) && !CONTROL.test(options.repoRoot)
    && win32.isAbsolute(options.repoRoot) && /^[A-Za-z]:[\\/]$/.test(lexicalRoot)
    && typeof options.auditPublished === 'function';
  configured = configured === true;
  const repoRoot = configured ? resolve(options.repoRoot) : '';
  const figmentRootPath = configured ? join(repoRoot, 'orgs', 'figment') : '';
  const publisherPath = configured
    ? join(figmentRootPath, 'pipeline', 'content', 'content_brief.py') : '';
  const readerPath = configured
    ? join(figmentRootPath, 'pipeline', 'content', 'content_brief_read.py') : '';
  const allocationPath = configured
    ? join(figmentRootPath, ...ALLOCATION_RELATIVE.split('/')) : '';
  const run = options.runProcess ?? runStudioPlanProcessCapture;
  const collect = options.collectBriefs ?? collectContentBriefs;
  let python: ReturnType<typeof resolvePython> | null = null;
  if (configured) {
    try {
      const candidate: unknown = (options.pythonResolver ?? resolvePython)(platform);
      if (!object(candidate) || typeof candidate.command !== 'string' || candidate.command.length < 1
        || !Array.isArray(candidate.prefixArgs)
        || candidate.prefixArgs.some((part) => typeof part !== 'string')) configured = false;
      else python = candidate as ReturnType<typeof resolvePython>;
    }
    catch { configured = false; }
  }
  const now = options.now ?? (() => new Date());
  const pythonCommand = configured && python !== null ? python.command : '';
  const pythonPrefix = configured && python !== null ? [...python.prefixArgs] : [];
  let active = false;
  let recoveryRequired = false;

  app.register((scope, _scopeOptions, done) => {
    scope.setErrorHandler((failure, _request, reply) => {
      const tooLarge = (failure as { code?: unknown; statusCode?: unknown }).code === 'FST_ERR_CTP_BODY_TOO_LARGE'
        || (failure as { statusCode?: unknown }).statusCode === 413;
      return reply.code(tooLarge ? 413 : 400).send(error(tooLarge ? 'body-too-large' : 'invalid-request'));
    });
    scope.addHook('preHandler', requireSession(options.sessionConfig));
    scope.post<{ Body: unknown }>(
      '/api/figment/studio/content-brief-revisions',
      { bodyLimit: BODY_LIMIT },
      async (request, reply) => {
        const decoded = requestBody(request.body);
        if (decoded === null) return reply.code(400).send(error('invalid-request'));
        const session = verifiedSession(request);
        if (session === undefined) return reply.code(401).send({ error: 'unauthenticated' });
        if (!configured) return reply.code(503).send(error('publication-unavailable'));
        if (recoveryRequired) return reply.code(503).send(error('publication-unavailable'));
        if (active) return reply.code(429).send(error('busy'));
        active = true;
        let allocation: OwnedAllocation | null = null;
        let publisherMayHaveStarted = false;
        let identityAmbiguous = false;
        let cleanupStarted = false;
        try {
          let listed: ReturnType<typeof collectContentBriefs>;
          try { listed = collect(repoRoot); }
          catch { return reply.code(503).send(error('publication-unavailable')); }
          if (listed.status === 'not-configured' || listed.status === 'unavailable') {
            return reply.code(503).send(error('publication-unavailable'));
          }
          const matches = listed.status === 'recorded'
            ? listed.items.filter((item) => item.briefId === decoded.body.baseBriefId
              && item.creatorId === 'creator-001') : [];
          if (matches.length === 0) return reply.code(404).send(error('not-found'));
          if (matches.length !== 1) return reply.code(503).send(error('publication-unavailable'));

          const repo = await safeRoot(repoRoot);
          const figment = await safeRoot(figmentRootPath);
          if (repo === null || figment === null || !inside(repo.real, figment.real)) throw new Error('unsafe-root');
          const content = await safeExisting(figment, join(figment.path, 'content'), 'directory');
          const briefs = await safeExisting(figment, join(figment.path, 'content', 'briefs'), 'directory');
          const base = await safeExisting(
            figment, join(figment.path, 'content', 'briefs', decoded.body.baseBriefId), 'directory',
          );
          const publisher = await safeExisting(repo, publisherPath, 'file');
          const reader = await safeExisting(repo, readerPath, 'file');
          if (content === null || briefs === null || base === null || publisher === null || reader === null) {
            throw new Error('unsafe-root');
          }
          const publisherIdentity = fileIdentity(publisher.info);
          const readerIdentity = fileIdentity(reader.info);
          const baseIdentity = directoryIdentity(base.info, base.real);

          const allocationState = await prospectiveDirectory(figment, allocationPath);
          if (allocationState !== 'absent') {
            recoveryRequired = true;
            return reply.code(503).send(error('publication-unavailable'));
          }
          const finalRelative = `content/briefs/${decoded.briefId}`;
          const finalPath = join(figment.path, ...finalRelative.split('/'));
          const finalState = await prospectiveDirectory(figment, finalPath);
          if (finalState === 'directory') return reply.code(409).send(error('brief-exists'));
          if (finalState !== 'absent') throw new Error('unsafe-target');

          const createdUtc = now().toISOString();
          if (createdUtc.length !== 24 || new Date(createdUtc).toISOString() !== createdUtc) {
            throw new Error('invalid-time');
          }
          try { await mkdir(allocationPath); }
          catch (failure) {
            if (errno(failure, 'EEXIST')) recoveryRequired = true;
            throw failure;
          }
          const allocated = await safeExisting(figment, allocationPath, 'directory');
          if (allocated === null) {
            identityAmbiguous = true;
            throw new IdentityFailure();
          }
          allocation = {
            path: allocationPath,
            identity: directoryIdentity(allocated.info, allocated.real),
            edits: null,
            recovery: null,
          };
          const edits = editsBytes(decoded.body);
          try {
            allocation.edits = await createOwnedFile(join(allocation.path, 'edits.json'), edits);
            allocation.recovery = await createOwnedFile(
              join(allocation.path, 'recovery.json'),
              recoveryBytes(
                decoded.body,
                decoded.briefId,
                createHash('sha256').update(edits).digest('hex'),
                createdUtc,
              ),
            );
            await assertAllocation(allocation, [
              { name: 'edits.json', identity: allocation.edits },
              { name: 'recovery.json', identity: allocation.recovery },
            ]);
          } catch (failure) {
            identityAmbiguous = true;
            throw failure;
          }

          const assertLaunchInputs = async (): Promise<void> => {
            if (!await currentRoot(repo) || !await currentRoot(figment)
              || !await currentDirectory(base.path, baseIdentity)
              || !await currentFile(publisher.path, publisherIdentity)
              || !await currentFile(reader.path, readerIdentity)) throw new IdentityFailure();
            await assertAllocation(allocation!, [
              { name: 'edits.json', identity: allocation!.edits! },
              { name: 'recovery.json', identity: allocation!.recovery! },
            ]);
          };
          try { await assertLaunchInputs(); }
          catch (failure) { identityAmbiguous = true; throw failure; }

          publisherMayHaveStarted = true;
          await run(pythonCommand, [
            ...pythonPrefix, '-I', '-B', publisher.path,
            '--root', figment.path,
            '--revise-base', `content/briefs/${decoded.body.baseBriefId}`,
            '--edits', EDITS_RELATIVE,
            '--out-dir', finalRelative,
          ], {
            cwd: repo.path, timeout: TIMEOUT_MS, maxBuffer: MAX_PROCESS_OUTPUT, windowsHide: true,
          });
          try { await assertLaunchInputs(); }
          catch (failure) { identityAmbiguous = true; throw failure; }

          const { stdout } = await run(pythonCommand, [
            ...pythonPrefix, '-I', '-B', reader.path,
            '--root', figment.path,
            '--request', `${finalRelative}/request.json`,
            '--brief', `${finalRelative}/brief.json`,
          ], {
            cwd: repo.path, timeout: TIMEOUT_MS, maxBuffer: MAX_PROCESS_OUTPUT, windowsHide: true,
          });
          const proof = decodeReader(stdout);
          if (proof === null) throw new Error('invalid-reader-output');
          try { await assertLaunchInputs(); }
          catch (failure) { identityAmbiguous = true; throw failure; }
          await options.auditPublished(session.claims.sub, {
            baseBriefId: decoded.body.baseBriefId,
            briefId: decoded.briefId,
            briefSha256: proof.briefSha256,
          });
          cleanupStarted = true;
          await cleanupOwned(allocation);
          allocation = null;
          return reply.send({
            schema: SUCCESS_SCHEMA,
            status: 'published',
            briefId: decoded.briefId,
            briefSha256: proof.briefSha256,
          } satisfies StudioContentBriefPublished);
        } catch (failure) {
          if (publisherMayHaveStarted || identityAmbiguous || cleanupStarted) {
            recoveryRequired = true;
          } else if (allocation !== null) {
            try { await cleanupOwned(allocation); allocation = null; }
            catch { recoveryRequired = true; }
          }
          request.log.warn({ failure: logFailure(failure) }, 'Figment content-brief revision unavailable');
          return reply.code(503).send(error('publication-unavailable'));
        } finally {
          active = false;
        }
      },
    );
    done();
  });
}

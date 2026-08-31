/**
 * An IN-MEMORY self-signed certificate for 127.0.0.1, minted fresh on every fixture start.
 *
 * The §7/§8 proof commands run over HTTPS because the thing under test depends on it: the browser-session
 * ref cookie is `Secure`, so a plain-HTTP fixture would never receive it back and the controller-isolation
 * matrix would prove nothing. That means a certificate — and a certificate means a private key.
 *
 * The key is therefore never written anywhere: it is generated per process, handed straight to
 * `https.createServer`, and dies with the fixture. Nothing is stored in the repo, nothing is added to a
 * trust store, and the certificate is valid for one hour for `127.0.0.1`/`localhost` only. Clients reach
 * it by pinning THIS certificate (the fixture exposes its PEM) rather than by disabling verification.
 */
import { webcrypto } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import * as x509 from '@peculiar/x509';

export interface LoopbackTlsMaterial {
  /** PEM certificate, safe to log and to pin from a client. */
  cert: string;
  /** PEM private key. Never logged, never persisted — it exists only for this process's TLS server. */
  key: string;
}

const ALGORITHM = {
  name: 'RSASSA-PKCS1-v1_5',
  hash: 'SHA-256',
  publicExponent: new Uint8Array([1, 0, 1]),
  modulusLength: 2048,
} as const;

const ONE_HOUR_MS = 60 * 60 * 1000;

function pemBlock(label: string, der: ArrayBuffer): string {
  const base64 = Buffer.from(der).toString('base64');
  const lines = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${label}-----\n${lines.join('\n')}\n-----END ${label}-----\n`;
}

/** Mint the loopback certificate. Bounded: one hour, one host, one process. */
export async function createLoopbackTlsMaterial(): Promise<LoopbackTlsMaterial> {
  x509.cryptoProvider.set(webcrypto as unknown as Crypto);
  // Node's `webcrypto` types and the DOM `CryptoKeyPair` the x509 builder expects differ only in the
  // KeyUsage union Node has since widened; the runtime objects are the same.
  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']) as CryptoKeyPair;
  const now = Date.now();
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    serialNumber: '01',
    name: 'CN=127.0.0.1, O=kb dashboard test fixture',
    // Backdated a minute so a clock skew between this process and the browser cannot make it not-yet-valid.
    notBefore: new Date(now - 60_000),
    notAfter: new Date(now + ONE_HOUR_MS),
    signingAlgorithm: ALGORITHM,
    keys,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.digitalSignature | x509.KeyUsageFlags.keyEncipherment,
        true,
      ),
      new x509.SubjectAlternativeNameExtension([
        { type: 'ip', value: '127.0.0.1' },
        { type: 'dns', value: 'localhost' },
      ]),
    ],
  });
  const pkcs8 = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey as never);
  return { cert: certificate.toString('pem'), key: pemBlock('PRIVATE KEY', pkcs8) };
}

/**
 * Where a fixture publishes the PUBLIC half of its certificate so the lifecycle probe and the §7/§8
 * clients can PIN it. Pinning is the point: nothing in this harness ever sets
 * `rejectUnauthorized: false`, because a proof that runs against "any certificate at all" would also
 * pass against a machine-in-the-middle, and the cookie under test is `Secure`.
 *
 * Only the certificate is written. The private key never leaves memory.
 */
/**
 * The directory certificates are published in: OWNED BY THIS USER and readable by nobody else (0700).
 * A bare shared-tmp filename would let another user on a multi-user box pre-create the path and pin the
 * client to their certificate; inside a verified 0700 directory they cannot create the file at all. The
 * name stays deterministic because the smoke client and the browser runner are SEPARATE processes that
 * must find it from the port alone.
 */
function loopbackCertificateDir(): string {
  const dir = join(tmpdir(), `kb-p3-fixture-certs-${userInfo().username.replace(/[^A-Za-z0-9_-]/g, '_')}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = statSync(dir);
  if (!stat.isDirectory()) throw new Error('loopbackCertificateDir: publication path is not a directory');
  if (process.platform !== 'win32') {
    // Refuse a directory somebody else owns or anybody else can write to - either makes pinning a lie.
    if (typeof process.getuid === 'function' && stat.uid !== process.getuid()) {
      throw new Error('loopbackCertificateDir: publication directory is owned by another user');
    }
    if ((stat.mode & 0o022) !== 0) {
      throw new Error('loopbackCertificateDir: publication directory is group- or world-writable');
    }
  }
  return dir;
}

export function loopbackCertificatePath(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('loopbackCertificatePath: invalid port');
  }
  return join(loopbackCertificateDir(), `kb-p3-fixture-${port}.pem`);
}

export function publishLoopbackCertificate(port: number, certificate: string): string {
  const path = loopbackCertificatePath(port);
  writeFileSync(path, certificate, { encoding: 'utf8', mode: 0o600 });
  return path;
}

export function revokeLoopbackCertificate(port: number): void {
  try {
    rmSync(loopbackCertificatePath(port), { force: true });
  } catch {
    /* the fixture is shutting down; a leftover PUBLIC cert is harmless and the next run overwrites it */
  }
}

/** Read a published certificate, or null when the fixture is not serving TLS on this port. */
export function readLoopbackCertificate(port: number): string | null {
  try {
    return readFileSync(loopbackCertificatePath(port), 'utf8');
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------------------------------------ *
 * Principal publication
 *
 * The §7 authenticated smoke has an ordering problem: the client needs a session token, but the token
 * is MINTED by this fixture at startup, after the outer command line was written. The lifecycle
 * wrapper passes client argv through untouched by contract, so the handoff cannot go through argv.
 * The fixture therefore publishes the principal beside its TLS certificate — same 0600 discipline,
 * same per-port key, same lifetime — and the lifecycle reads it and puts it in the CLIENT's
 * environment. Nothing is printed that the banner does not already print.
 * ------------------------------------------------------------------------------------------------ */

/** The environment variables `p3FixtureLifecycle` puts a published principal into. */
export const P3_SESSION_TOKEN_ENV = 'KB_P3_SESSION_TOKEN';
export const P3_CONTEXT_PATH_ENV = 'KB_P3_CONTEXT_PATH';

/** What a running authenticated fixture publishes for the client the lifecycle starts next. */
export interface PublishedP3Principal {
  origin: string;
  /** Context A's bearer token — the same principal the banner prints. */
  token: string;
  browserSessionRef: string;
  contextPath: string;
}

export function fixturePrincipalPath(port: number): string {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('fixturePrincipalPath: invalid port');
  }
  return join(loopbackCertificateDir(), `kb-p3-principal-${port}.json`);
}

export function publishFixturePrincipal(port: number, principal: PublishedP3Principal): string {
  const path = fixturePrincipalPath(port);
  // 0600, like the private key beside it: this file carries a bearer token.
  writeFileSync(path, `${JSON.stringify(principal, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  return path;
}

export function revokeFixturePrincipal(port: number): void {
  try {
    rmSync(fixturePrincipalPath(port), { force: true });
  } catch {
    /* shutting down; the next run on this port overwrites it and the token is already dead */
  }
}

/** Read a published principal, or null when no authenticated fixture is serving this port. */
export function readFixturePrincipal(port: number): PublishedP3Principal | null {
  try {
    const parsed = JSON.parse(readFileSync(fixturePrincipalPath(port), 'utf8')) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.token !== 'string' || record.token.length === 0) return null;
    if (typeof record.contextPath !== 'string' || !record.contextPath.startsWith('/')) return null;
    if (typeof record.origin !== 'string' || typeof record.browserSessionRef !== 'string') return null;
    return {
      origin: record.origin,
      token: record.token,
      browserSessionRef: record.browserSessionRef,
      contextPath: record.contextPath,
    };
  } catch {
    return null;
  }
}

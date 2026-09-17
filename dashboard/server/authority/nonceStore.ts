/**
 * Durable replay guard for the ssh-signed human-approval channel (spec §4.2 check #10). See
 * docs/superpowers/specs/2026-09-16-authority-and-guardrails-design.md §4.2. Durable rather than
 * in-memory because a daemon restart must not re-open a replay window.
 *
 * `claim()` is synchronous by design — a claim must not interleave with another claim — and never
 * awaits, so two claims in the same process can never race. On-disk representation is append-only
 * NDJSON at `${stateRoot}/authority/nonces.ndjson`, ONE LINE PER CLAIMED NONCE, deliberately not a
 * single JSON document rewritten whole on every claim: at the 10 000-row cap spec §4.2 pins, a
 * read-modify-rewrite-whole-document store costs O(n) disk I/O PER CLAIM (confirmed by measurement:
 * >300s for 10 000 claims on this machine's filesystem, growing quadratically with the live-row count),
 * which makes the daemon's own hot path for every signed-class request unacceptably slow as the table
 * fills. `appendFileSync` is O(1) per claim — new bytes land at the end of the file, nothing already on
 * disk is re-read or rewritten — while a fresh `createNonceStore` still reconstructs the full row set
 * correctly by reading the whole file once, exactly the way `audit/log.ts#appendAuditRowLocal` already
 * treats this codebase's other durable append-only ledger.
 *
 * The in-memory row set is loaded lazily (once) on this instance's first `claim()` call and kept
 * authoritative afterward — no per-claim re-read — so repeat calls within one process are O(1)
 * amortized. A brand-new store instance (a restart, or `createNonceStore` called again in a test) always
 * re-reads the file from scratch, so durability is never in question; only the redundant re-parsing of
 * every claim already served is avoided within a single store's lifetime.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

/** Fail closed rather than evict: see spec §5 — evicting the oldest rows is exactly what an attacker
 *  who can generate traffic would want. */
const NONCE_CAP = 10_000;

export type NonceClaim = 'fresh' | 'replayed' | 'unavailable';

export interface NonceStore {
  claim(nonce: string, expiresAtMs: number): NonceClaim;
}

interface StoredRow {
  nonce: string;
  expiresAt: number;
}

function isStoredRow(value: unknown): value is StoredRow {
  return value !== null && typeof value === 'object'
    && typeof (value as { nonce?: unknown }).nonce === 'string'
    && typeof (value as { expiresAt?: unknown }).expiresAt === 'number';
}

function documentPath(stateRoot: string): string {
  return join(stateRoot, 'authority', 'nonces.ndjson');
}

/** Reads the append-only log from scratch. A later line for the SAME nonce (should not normally occur —
 *  `claim` never appends a duplicate) wins, matching ordinary last-write-wins log replay. A malformed
 *  line is skipped rather than failing the whole read: one corrupted append must not resurrect an
 *  already-consumed replay window for every other nonce in the file. */
function readAll(path: string): Map<string, number> {
  const rows = new Map<string, number>();
  if (!existsSync(path)) return rows;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (isStoredRow(parsed)) rows.set(parsed.nonce, parsed.expiresAt);
  }
  return rows;
}

/** `now` is injectable for tests; production leaves it at `Date.now`. */
export function createNonceStore(stateRoot: string, now: () => number = Date.now): NonceStore {
  const path = documentPath(stateRoot);
  let cache: Map<string, number> | null = null;

  return {
    claim(nonce, expiresAtMs) {
      try {
        if (cache === null) cache = readAll(path);
        const nowMs = now();
        for (const [key, expiresAt] of cache) {
          if (expiresAt <= nowMs) cache.delete(key);
        }
        if (cache.has(nonce)) return 'replayed';
        if (cache.size >= NONCE_CAP) return 'unavailable';
        mkdirSync(dirname(path), { recursive: true });
        appendFileSync(path, `${JSON.stringify({ nonce, expiresAt: expiresAtMs } satisfies StoredRow)}\n`, 'utf8');
        cache.set(nonce, expiresAtMs);
        return 'fresh';
      } catch {
        return 'unavailable';
      }
    },
  };
}

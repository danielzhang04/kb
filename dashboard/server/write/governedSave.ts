/**
 * D2.5 — governed save: edit KB/skill markdown and persist it through the governed branch path.
 *
 * Never a raw `fs.write` into `queue/`/`ledgers/`/`governance/` — every save goes through, in order:
 *   1. **Session gate.** A valid, unexpired WebAuthn-minted session token (`auth/session.ts`) is
 *      required; anything else (missing, malformed, expired, bad signature) is rejected with 401
 *      before any filesystem or git activity.
 *   2. **Path confinement.** `relpath` is resolved and confined to `repoRoot` (traversal/absolute-path
 *      guard from `kb/browser.ts#resolveWithin`, the same primitive the read-only browser uses) before
 *      any write.
 *   3. **Governance carve-out.** `governance/**` and the root constitution files (`CLAUDE.md`,
 *      `AGENTS.md`, `GEMINI.md`) are human-edited only per CLAUDE.md — refused with 403, unconditionally.
 *   4. **Local write.** The content lands on disk at the confined path.
 *   5. **Branch routing.** `branch.ts#routeWrite` classifies the target and routes it: durable content
 *      to a work branch -> PR to `main`; coordination artifacts to `ops` via pull-rebase-push. A
 *      routing failure (including a blocked `sync_skills` pre-commit hook on drift) fails the save —
 *      it is never caught and silently retried with `--no-verify`.
 */

import { writeFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { verifySession } from '../auth/session';
import type { SessionConfig } from '../auth/session';
import { resolveWithin, PathEscapeError } from '../kb/browser';
import { routeWrite, defaultGitRunner, defaultPrOpener } from './branch';
import type { GitRunner, PrOpener, RouteOptions, Target } from './branch';

export type SaveOutcome =
  | { ok: true; target: Target }
  | { ok: false; status: 401 | 400 | 403 | 500; reason: string };

/** Relpath prefixes/files that are human-edited only, never writable through the dashboard. */
const GOVERNANCE_ONLY = ['governance/'];
const GOVERNANCE_FILES = new Set(['CLAUDE.md', 'AGENTS.md', 'GEMINI.md']);

function normalize(relpath: string): string {
  return relpath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function isGovernanceOnly(relpath: string): boolean {
  const norm = normalize(relpath);
  return GOVERNANCE_ONLY.some((p) => norm.startsWith(p)) || GOVERNANCE_FILES.has(norm);
}

export interface SaveInput {
  repoRoot: string;
  relpath: string;
  content: string;
  /** Bearer token from the client; `undefined`/empty is treated as "no session". */
  sessionToken: string | undefined;
  sessionConfig: SessionConfig;
  runGit?: GitRunner;
  openPr?: PrOpener;
  workBranch?: string;
  message?: string;
}

/**
 * Save `content` to `relpath` under `repoRoot` through the full governed path: session gate, path
 * confinement, governance carve-out, local write, then target-classified branch routing.
 */
export async function save(input: SaveInput): Promise<SaveOutcome> {
  if (!input.sessionToken) {
    return { ok: false, status: 401, reason: 'missing session token' };
  }
  const check = verifySession(input.sessionToken, input.sessionConfig);
  if (!check.ok) {
    return { ok: false, status: 401, reason: `invalid session: ${check.reason}` };
  }

  let abs: string;
  try {
    abs = resolveWithin(input.repoRoot, input.relpath);
  } catch (err) {
    if (err instanceof PathEscapeError) {
      return { ok: false, status: 400, reason: err.message };
    }
    throw err;
  }

  if (isGovernanceOnly(input.relpath)) {
    return { ok: false, status: 403, reason: 'governance/** and the constitution files are human-edited only' };
  }

  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, input.content, 'utf-8');

  const routeOptions: RouteOptions = {
    runGit: input.runGit ?? defaultGitRunner,
    openPr: input.openPr ?? defaultPrOpener,
    workBranch: input.workBranch,
    message: input.message,
  };

  try {
    const target = routeWrite(input.repoRoot, input.relpath, routeOptions);
    return { ok: true, target };
  } catch (err) {
    return { ok: false, status: 500, reason: err instanceof Error ? err.message : String(err) };
  }
}

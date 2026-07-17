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

import { writeFileSync, mkdirSync, realpathSync, lstatSync, existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve, sep, isAbsolute } from 'node:path';
import { verifySession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { resolveWithin, PathEscapeError } from '../kb/browser.ts';
import { routeWrite, defaultGitRunner, defaultPrOpener } from './branch.ts';
import type { GitRunner, PrOpener, RouteOptions, Target } from './branch.ts';
import { parseYaml } from '../routing/yaml.ts';
import { loadPolicy } from '../routing/policy.ts';

export type SaveOutcome =
  | { ok: true; target: Target }
  | { ok: false; status: 401 | 400 | 403 | 500; reason: string };

/** Path prefixes/files that are human-edited only, never writable through the dashboard. Compared
 *  case-INSENSITIVELY (the deploy FS is case-insensitive NTFS: `claude.md` and `Governance/` alias the
 *  real protected paths), against the path RESOLVED relative to repoRoot — not the raw client relpath. */
const GOVERNANCE_ONLY_PREFIXES = ['governance/'];
const GOVERNANCE_FILES_LOWER = new Set(['claude.md', 'agents.md', 'gemini.md']);

/**
 * True when `abs` (already confined under `repoRoot` by `resolveWithin`) targets a human-edited-only
 * path: the root constitution files or anything under `governance/`. Enforced on the resolved path
 * relative to `repoRoot`, lower-cased, so a case variant on a case-insensitive filesystem
 * (`claude.md`, `GOVERNANCE/risk-tiers.md`, `Governance/budget.yaml`) cannot slip past the carve-out.
 */
function isGovernanceOnly(repoRoot: string, abs: string): boolean {
  const rel = relative(resolve(repoRoot), abs).split(sep).join('/').replace(/^\/+/, '').toLowerCase();
  if (GOVERNANCE_FILES_LOWER.has(rel)) return true;
  return GOVERNANCE_ONLY_PREFIXES.some((p) => rel === p.replace(/\/$/, '') || rel.startsWith(p));
}

/**
 * C7.6 — anti-impersonation / id-collision guard, READ-ONLY over governance.
 *
 * Collect the reserved identity strings an agent id must not forge, lower-cased:
 *   1. human names/handles — `governance/humans.yaml` `humans:` (each is also a git `user.name`, so a
 *      colliding agent id could stamp human-looking authorship — `governance/agent-rules.md` forbids it);
 *   2. runtime worker identities — every `runtimes.<rt>.default_worker` in `governance/model-routing.yaml`
 *      (`worker-desktop`, `codex-worker`), the ids a bound runner already claims cards as.
 *
 * READS governance, WRITES nothing there. Fails OPEN per source (a missing/malformed file contributes no
 * reserved names) so a sparse checkout never spuriously blocks a legitimate save.
 */
function collectReservedIdentities(repoRoot: string): Set<string> {
  const reserved = new Set<string>();
  try {
    const f = resolve(repoRoot, 'governance', 'humans.yaml');
    if (existsSync(f)) {
      const data = parseYaml(readFileSync(f, 'utf-8'));
      const humans = data && typeof data === 'object' && !Array.isArray(data)
        ? (data as Record<string, unknown>).humans
        : undefined;
      if (Array.isArray(humans)) {
        for (const h of humans) if (typeof h === 'string' && h.trim() !== '') reserved.add(h.trim().toLowerCase());
      }
    }
  } catch {
    /* fail open: no human names contributed */
  }
  try {
    const policy = loadPolicy(repoRoot);
    for (const rt of Object.values(policy.runtimes ?? {})) {
      const w = rt?.default_worker;
      if (typeof w === 'string' && w.trim() !== '') reserved.add(w.trim().toLowerCase());
    }
  } catch {
    /* fail open: no runtime identities contributed */
  }
  return reserved;
}

/**
 * True (with a reason) when this save is a NEW `agents/<id>.md` declaration whose id collides with a
 * reserved human/runtime identity. Triggers ONLY for the `agents/` prefix (case-insensitive, top-level
 * `<id>.md`): every task/workflow/skill/project/KB save returns null and is unaffected. Editing an
 * ALREADY-EXISTING `agents/<id>.md` is exempt (updating your own agent file is legitimate; forging a new
 * colliding one is not). Both the on-disk filename id and the frontmatter `id` are checked.
 */
function agentIdCollision(repoRoot: string, abs: string, content: string): string | null {
  const rel = relative(resolve(repoRoot), abs).split(sep).join('/').replace(/^\/+/, '');
  const m = /^agents\/([^/]+)\.md$/i.exec(rel);
  if (!m) return null; // not an agents/<id>.md declaration → guard does not apply
  // Editing an existing agent file is a legitimate self-update, not a forge.
  if (existsSync(abs)) return null;

  const reserved = collectReservedIdentities(repoRoot);
  const candidates = new Set<string>([m[1]]);
  // Also honour the frontmatter `id`, which becomes the card owner + git user.name.
  const fmId = /^\s*id:\s*(.+?)\s*$/im.exec(content);
  if (fmId) candidates.add(fmId[1].replace(/^["']|["']$/g, '').trim());

  for (const id of candidates) {
    if (id !== '' && reserved.has(id.toLowerCase())) {
      return `agent-id-collision: "${id}" collides with a reserved human or runtime identity`;
    }
  }
  return null;
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

  if (isGovernanceOnly(input.repoRoot, abs)) {
    return { ok: false, status: 403, reason: 'governance/** and the constitution files are human-edited only' };
  }

  // C7.6: refuse a NEW agents/<id>.md whose id impersonates a human or shadows a runtime identity.
  // Only fires for the agents/ prefix; every other durable/coordination save is unaffected. No file
  // is written and no commit is made on a refusal (this returns before the local write below).
  const collision = agentIdCollision(input.repoRoot, abs, input.content);
  if (collision) {
    return { ok: false, status: 400, reason: collision };
  }

  mkdirSync(dirname(abs), { recursive: true });

  // MED-2: resolveWithin is purely LEXICAL — a symlink planted under repoRoot (e.g. notes/x ->
  // ../../governance/budget.yaml) passes it, and writeFileSync would then follow the link and escape
  // the root under the daemon identity (which holds the ops push credential). Re-confine on the REAL
  // path: realpath the (now-created) parent dir and re-check containment, and refuse to overwrite a
  // target that is itself a symlink. Fail closed.
  const rootReal = realpathSync(resolve(input.repoRoot));
  let parentReal: string;
  try {
    parentReal = realpathSync(dirname(abs));
  } catch {
    return { ok: false, status: 400, reason: 'refusing to resolve the write directory' };
  }
  const relParent = relative(rootReal, parentReal);
  if (relParent !== '' && (relParent === '..' || relParent.startsWith('..' + sep) || isAbsolute(relParent))) {
    return { ok: false, status: 400, reason: 'refusing to write through a symlink that escapes the repo root' };
  }
  if (existsSync(abs) && lstatSync(abs).isSymbolicLink()) {
    return { ok: false, status: 400, reason: 'refusing to overwrite through a symlink' };
  }

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

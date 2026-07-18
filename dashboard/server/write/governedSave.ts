/**
 * D2.5 — governed save: edit KB/skill markdown and persist it through the governed branch path.
 *
 * Never a raw `fs.write` into `queue/`/`ledgers/`/`governance/` — every save goes through, in order:
 *   1. **Preamble gate.** STOP/API-key/budget checks run before session verification or any mutation.
 *   2. **Session gate.** A valid, unexpired WebAuthn-minted session token (`auth/session.ts`) is
 *      required; anything else (missing, malformed, expired, bad signature) is rejected with 401
 *      before any filesystem or git activity.
 *   3. **Path confinement.** `relpath` is resolved and confined to `repoRoot` (traversal/absolute-path
 *      guard from `kb/browser.ts#resolveWithin`, the same primitive the read-only browser uses) before
 *      any write.
 *   4. **Governance carve-out.** `governance/**` and the root constitution files (`CLAUDE.md`,
 *      `AGENTS.md`, `GEMINI.md`) are human-edited only per CLAUDE.md — refused with 403, unconditionally.
 *   5. **Local write.** The content lands on disk at the confined path.
 *   6. **Branch routing.** `branch.ts#routeWrite` classifies the target and routes it: durable content
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
import { parseCardFrontmatter } from '../planeA/cards.ts';
import { assertFleetRunnable, defaultPreambleRunner } from './preambleGate.ts';
import type { PreambleRunner } from './preambleGate.ts';

export type SaveOutcome =
  | { ok: true; target: Target }
  | { ok: false; status: 401 | 400 | 403 | 500 | 503; reason: string };

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

/** Line-based frontmatter `id` parse (same primitive `readDeclaredAgents` uses), with the quote-strip.
 *  Returns the trimmed id or null. Deliberately NOT a real YAML engine — the guard and the roster reader
 *  must agree on exactly the same id string, so they share this parse. */
function frontmatterId(content: string): string | null {
  const m = /^\s*id:\s*(.+?)\s*$/im.exec(content);
  if (!m) return null;
  const id = m[1].replace(/^["']|["']$/g, '').trim();
  return id === '' ? null : id;
}

/**
 * True (with a reason) when this save would NEWLY INTRODUCE an `agents/<id>.md` id that collides with a
 * reserved human/runtime identity. Triggers ONLY for the `agents/` prefix (case-insensitive, top-level
 * `<id>.md`): every task/workflow/skill/project/KB save returns null and is unaffected.
 *
 * The candidate ids are the filename stem and the submitted frontmatter `id` (which becomes the card
 * owner + git user.name). A candidate is refused when it is reserved AND was not already an id of the
 * on-disk file — i.e. the collision is being introduced by THIS write. This holds whether the file is
 * new (nothing is grandfathered → any reserved candidate is refused) or an edit (a pre-existing colliding
 * id may still be edited, but flipping the frontmatter `id` to a NEW reserved identity is refused —
 * closing the edit-exemption impersonation forge). The on-disk read fails CLOSED: an unreadable existing
 * file grandfathers nothing, so the full check applies.
 */
function agentIdCollision(repoRoot: string, abs: string, content: string): string | null {
  const rel = relative(resolve(repoRoot), abs).split(sep).join('/').replace(/^\/+/, '');
  const m = /^agents\/([^/]+)\.md$/i.exec(rel);
  if (!m) return null; // not an agents/<id>.md declaration → guard does not apply

  const reserved = collectReservedIdentities(repoRoot);

  // Candidate ids being asserted by this write: the filename stem + the submitted frontmatter id.
  const candidates = new Set<string>([m[1]]);
  const submittedId = frontmatterId(content);
  if (submittedId) candidates.add(submittedId);

  // Ids already declared by the on-disk file (grandfathered, lower-cased). The filename stem is fixed
  // for a given relpath, so an existing file grandfathers its stem plus its current frontmatter id. A new
  // file (or an unreadable existing one) grandfathers nothing → every reserved candidate is refused.
  const grandfathered = new Set<string>();
  if (existsSync(abs)) {
    grandfathered.add(m[1].toLowerCase());
    try {
      const onDisk = readFileSync(abs, 'utf-8');
      const diskId = frontmatterId(onDisk);
      if (diskId) grandfathered.add(diskId.toLowerCase());
    } catch {
      /* fail closed: an unreadable existing file grandfathers no frontmatter id */
    }
  }

  for (const id of candidates) {
    const lower = id.toLowerCase();
    if (id !== '' && reserved.has(lower) && !grandfathered.has(lower)) {
      return `agent-id-collision: "${id}" collides with a reserved human or runtime identity newly introduced by this write`;
    }
  }
  return null;
}

/**
 * True (with a reason) when this save would set `runner-bound: true` on an `agents/<id>.md` file. The
 * registry NEVER marks an agent runner-bound; only a human flips it true via a reviewed governance action
 * (CLAUDE.md credential ceiling / C7 design). Client code hard-codes `false`, but `save()` writes content
 * verbatim, so a direct POST is refused here. Fires ONLY for the `agents/` prefix (case-insensitive,
 * top-level `<id>.md`). `false` / absent passes. Line-based value parse mirrors the id parse: tolerant of
 * surrounding quotes, whitespace, and value case.
 */
function agentRunnerBoundForbidden(repoRoot: string, abs: string, content: string): string | null {
  const rel = relative(resolve(repoRoot), abs).split(sep).join('/').replace(/^\/+/, '');
  if (!/^agents\/[^/]+\.md$/i.test(rel)) return null;
  const m = /^\s*runner-bound:\s*(.+?)\s*$/im.exec(content);
  if (!m) return null;
  const value = m[1].replace(/^["']|["']$/g, '').trim().toLowerCase();
  if (value === 'true') {
    return 'runner-bound-not-permitted: agents/*.md may not set runner-bound: true; runner binding is a human action';
  }
  return null;
}

/**
 * C7.11 — refuse a declared `model:` on agents/<id>.md that is not in its declared runtime's
 * `known_models`. Closes a silent-downgrade gap: the write path previously validated id and
 * runner-bound but not model, so a bogus value (e.g. `gpt-9000-fake`) was accepted here and only
 * clamped later — silently — at owner-assignment time (`write/launch.ts#defaultOwnerRouting`, ~line
 * 232-239: `known.includes(declared.model) ? declared.model : known[0]`). Fail LOUD instead: reject at
 * declare/save time, consistent with the fleet philosophy (CLAUDE.md).
 *
 * Reuses the SAME canonical registry `routingOverride.ts#validateSet` reads (`loadPolicy` from
 * `routing/policy.ts`, `policy.runtimes[<rt>].known_models`) rather than inventing a second reader.
 *
 * Parses frontmatter via the SAME shared reader `readDeclaredAgents` uses (`parseCardFrontmatter`,
 * `planeA/cards.ts`) rather than an ad-hoc whole-content regex, so the guard and the roster can never
 * disagree on what `model:`/`runtime:` a card declares (review MED-1: a whole-content regex with
 * looser key matching than `parseCardFrontmatter`'s `line.slice(0, colon).trim()` let a
 * space-before-colon key like `model : gpt-9000-fake` slip past this guard while the roster still read
 * it as a real `model` field — silently clamped later at launch. Frontmatter-scoping also fixes LOW-1:
 * a `model:`-shaped line in the BODY prose can no longer false-trigger this guard).
 *
 * Scope — a deliberate judgment call: the check fires ONLY when BOTH (a) a `runtime:` is declared AND
 * that runtime is registered in the policy, AND (b) a `model:` is declared. `model:` omitted is legal
 * (the design lets an agent inherit the role x tier policy model — R2.1/C7.9) and always passes. An
 * unregistered/unknown `runtime:` is NOT independently rejected by this guard — unlike
 * `routingOverride.ts#validateSet` (~line 128), which 400s unconditionally on any runtime not in the
 * registry. Mirroring that fully was judged out of scope here: this guard exists solely to close the
 * declared-model silent-downgrade gap, which has no equivalent for an unknown runtime today (nothing
 * downstream silently clamps a bogus runtime the way `defaultOwnerRouting` clamps a bogus model).
 * Widening this guard to also reject unknown runtimes is a reasonable follow-up, not bundled in here.
 *
 * Fails OPEN on an unreadable/malformed policy file — matching `collectReservedIdentities` above, the
 * existing posture in THIS file for a `loadPolicy` read. `loadPolicy` itself never throws (its own
 * try/catch degrades to `{}` on any read/parse failure — `routing/policy.ts`), so an absent or
 * malformed `governance/model-routing.yaml` simply means no runtime is ever "registered" here and the
 * guard is a no-op: never a crash, never a spurious block of an unrelated save.
 */
function agentModelKnownGuard(repoRoot: string, abs: string, content: string): string | null {
  const rel = relative(resolve(repoRoot), abs).split(sep).join('/').replace(/^\/+/, '');
  if (!/^agents\/[^/]+\.md$/i.test(rel)) return null;

  let meta: Record<string, unknown>;
  try {
    meta = parseCardFrontmatter(content).meta as Record<string, unknown>;
  } catch {
    return null; // unterminated/absent frontmatter -> readDeclaredAgents skips it too; fail open, consistent
  }

  const model = typeof meta.model === 'string' ? meta.model.trim() : '';
  if (model === '') return null; // model omitted: legal, inherits the role x tier policy model

  const runtime = typeof meta.runtime === 'string' ? meta.runtime.trim() : '';
  if (runtime === '') return null; // no declared runtime -> nothing to validate the model against

  const policy = loadPolicy(repoRoot);
  const spec = policy.runtimes?.[runtime];
  if (!spec) return null; // runtime not registered -> out of scope for this guard (see doc comment)

  const known = spec.known_models ?? [];
  if (!known.includes(model)) {
    return `agent-model-unknown: model "${model}" is not in runtime "${runtime}"'s known_models`;
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
  runPreamble?: PreambleRunner;
}

/**
 * Save `content` to `relpath` under `repoRoot` through the full governed path: session gate, path
 * confinement, governance carve-out, local write, then target-classified branch routing.
 */
export async function save(input: SaveInput): Promise<SaveOutcome> {
  // The fleet gate is first: STOP/API-key/budget failures refuse before session verification, any local
  // filesystem mutation, or git activity. This matches launch/vibe's ordering and keeps one authority.
  const preamble = assertFleetRunnable(input.repoRoot, input.runPreamble ?? defaultPreambleRunner);
  if (!preamble.ok) {
    return { ok: false, status: 503, reason: `fleet-frozen: ${preamble.problems.join('; ')}` };
  }

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

  // Finding 2: the registry never marks an agent runner-bound; only a human flips it true. Refuse a
  // direct save that sets `runner-bound: true` on an agents/*.md file — before the local write, so no
  // file is written and no commit is made.
  const runnerBound = agentRunnerBoundForbidden(input.repoRoot, abs, input.content);
  if (runnerBound) {
    return { ok: false, status: 400, reason: runnerBound };
  }

  // C7.11: refuse a declared model that is not in its declared (and registered) runtime's known_models
  // — fail loud at declare/save time instead of the silent clamp defaultOwnerRouting applies later.
  const unknownModel = agentModelKnownGuard(input.repoRoot, abs, input.content);
  if (unknownModel) {
    return { ok: false, status: 400, reason: unknownModel };
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

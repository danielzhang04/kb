/**
 * Task 8 — the Schedules panel: every cadence a HEARTBEAT.md DECLARES, with its paused state, its last
 * recorded run, and a display-only reading of its schedule string — plus the one governed write the
 * panel offers.
 *
 * ── The dashboard is the EDITOR, never the OWNER (spec §5) ───────────────────────────────────────
 * There is no dashboard-owned schedule store, and there never will be: a store would mint standing
 * authorization without a human commit. `HEARTBEAT.md` stays the only declaration, `scripts/dispatch.py`
 * stays the only clock, and `promotion._standing_authorized` byte-compares the committed cadence fields
 * against `main` — so a schedule change is authorized by exactly one event, a human merging a PR.
 * Accordingly the edit route writes a HEARTBEAT file through the EXISTING governed-save path
 * (`write/governedSave.ts` → `write/branch.ts`: durable content → work branch → PR to main, hooks active,
 * never auto-merged). No new diff-emitter, no new commit path, no auto-merge.
 *
 * ── The builder is READ-ONLY, whole call graph ───────────────────────────────────────────────────
 * Same discipline and the same tripwire test as `panels/loopStatus.ts`: {@link buildSchedulesPanel} and
 * everything it reaches import only read entry points from `node:fs` and spawn no subprocess.
 *
 * ── The scheduler is NOT reimplemented here ──────────────────────────────────────────────────────
 * {@link scheduleHint} is a DISPLAY string derived from the declared `schedule:` text — it never computes
 * a due date, a next occurrence, or an overdue flag. `dispatch.py::due()` is the one answer to "is this
 * cadence due"; a second implementation would drift silently against the one the fleet acts on.
 *
 * ── PAUSING lives at `POST /api/write/pause-cadence`, NOT here ───────────────────────────────────
 * `stop/floor.ts#pauseCadence` already writes the `queue/paused/<name>` presence-only sentinel
 * `dispatch.py::due()` checks, and the Schedules UI calls THAT endpoint. One write path per action: a
 * second sentinel writer in this module would have been the same act with a different commit message,
 * a different audit story, and two places to keep honest. It also belongs there rather than here on the
 * merits — pausing is a STOP-floor property, and the floor deliberately runs with NO preamble gate so an
 * operator can suppress a beat while the fleet is already frozen, which a `governedSave` route (fleet-
 * gated by design) could not do.
 *
 * ── UNPAUSE is a manual ops act — no route, anywhere ─────────────────────────────────────────────
 * Creating a sentinel can only ever SKIP a beat. ARMING is the opposite: deleting one resumes autonomous
 * work, which the loops arc deliberately keeps unscriptable. So this module registers NO delete and no
 * unpause surface at all, and a test asserts it against the app's LIVE route table — not against this
 * file's source — so a future registration anywhere under `/api/schedules` trips it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { readKindRows } from '../planeA/ledgers.ts';
import { CARD_QUEUE_DIRS, parseCardFrontmatter } from '../planeA/cards.ts';
import { readHeartbeatCadences, SYSTEM_PROJECT } from './health.ts';
import { resultNarration, isPaused } from './loopStatus.ts';
import { save as defaultSave } from '../write/governedSave.ts';
import type { SaveInput, SaveOutcome } from '../write/governedSave.ts';
import type { SessionConfig } from '../auth/session.ts';
import { defaultPrOpener } from '../write/branch.ts';
import type { GitRunner, PrOpener } from '../write/branch.ts';
import type { PreambleRunner } from '../write/preambleGate.ts';
import type { CoordinationPublication } from '../write/outbox.ts';
import type { AsyncPrResult, OpsGitRunner } from '../write/asyncGit.ts';
import { verifiedSession } from '../http/middleware.ts';
import type { AppendAuditFn } from '../http/context.ts';
import type { AdmissionDecision, AdmissionKind } from '../control/admission.ts';

/** The most recent recorded beat of one cadence. */
export interface ScheduleLastRun {
  /** `YYYY-MM-DD` from the dispatch-ledger row. */
  date: string;
  /** The emitted card's id. */
  card: string;
  /** First `## Result` line of that card, or null when the card is absent/unparseable in this checkout. */
  narration: string | null;
}

/** One declared cadence, as the panel renders it. */
export interface ScheduleRow {
  /** `system` for the root heartbeat, otherwise the `orgs/<project>` directory name. */
  project: string;
  name: string;
  /** The declared `schedule:` string, verbatim. Never parsed into a due date here. */
  schedule: string | null;
  tier: string | null;
  riskTier: string | null;
  /** Repo-relative path of the HEARTBEAT.md declaring this block — the edit affordance's target. */
  file: string;
  /** `queue/paused/<name>` exists: the dispatcher will skip this cadence's beat. */
  paused: boolean;
  lastRun: ScheduleLastRun | null;
  /** Dispatch-ledger rows naming this cadence. */
  runCount: number;
  /** Display-only rendering of `schedule` — see {@link scheduleHint}. Never a time. */
  scheduleHint: string;
}

export interface SchedulesPanel {
  label: 'schedules';
  cadences: ScheduleRow[];
  /** How many declared cadences currently carry a pause sentinel. */
  pausedCount: number;
}

/**
 * Cron field shapes, used ONLY to decide whether a 5-token string is worth LABELLING as cron. This is a
 * character-class check, not a parse: `dispatch.py::parse_cron` is the only thing entitled to interpret
 * the expression, and the panel must not imply it validated one. Minute/hour/day-of-month are numeric
 * (`*`, digits, `,`, `-`, `/`); month and day-of-week additionally take names (`mon`, `jan`) — so a
 * five-word English sentence never gets dressed up as a cron expression.
 */
const CRON_NUMERIC = /^[*0-9][*0-9,\-/]*$/;
const CRON_NAMED = /^[*0-9A-Za-z][*0-9A-Za-z,\-/]*$/;

/** True when `s` is five tokens shaped like cron fields. Shape only — never a parse, never a fire time. */
function looksLikeCron(tokens: string[]): boolean {
  if (tokens.length !== 5) return false;
  return tokens.slice(0, 3).every((t) => CRON_NUMERIC.test(t)) && tokens.slice(3).every((t) => CRON_NAMED.test(t));
}

/**
 * A DISPLAY string for a declared `schedule:` value. It says what the string MEANS — never when the
 * cadence next fires. It is named for what it does: computing a next-fire time would be a second
 * `due()` (see the module header), so no hint here is ever a time.
 *
 * Cron is echoed verbatim on purpose: a paraphrase ("every 5 minutes") would be this panel quietly
 * claiming to have parsed it. The INERT legacy forms are named as inert, because that is exactly the
 * fact an operator reading `schedule: weekly` beside a cadence that has never run needs to know.
 */
export function scheduleHint(schedule: string | null | undefined): string {
  const s = (schedule ?? '').trim();
  if (s === '') return 'no schedule declared';
  if (looksLikeCron(s.split(/\s+/))) return `cron: ${s}`;
  const lower = s.toLowerCase();
  if (lower === 'daily') return 'every day';
  const weekly = /^weekly:(.+)$/i.exec(s);
  if (weekly) return `every ${weekly[1].trim().toLowerCase()}`;
  if (lower === 'weekly') return 'never fires — bare `weekly` names no day';
  if (lower === 'monthly') return 'never fires — `monthly` is not a form the dispatcher beats';
  return `never fires — the dispatcher does not recognise \`${s}\``;
}

/**
 * The ONLY files the edit route may write, matched against the client-supplied path verbatim (forward
 * slashes, no leading `./`). The whitelist is the keyhole: `governedSave` would happily accept any
 * durable path, so restricting THIS route to the schedule declarations is what keeps a schedules panel
 * from becoming a general repo-write surface.
 *
 * The org segment uses the write surface's own project-name shape (`write/routes.ts`
 * CANONICAL_WORKFLOW_PATH): leading alphanumeric, then alphanumeric/dot/dash/underscore, ≤64 chars. So
 * `HEARTBEAT.md.bak`, `heartbeat.md`, `orgs/a/b/HEARTBEAT.md`, `orgs/../HEARTBEAT.md`, `orgs/./…` and a
 * whitespace segment are all refused — `governedSave`'s confinement would have caught the traversals
 * anyway, but a junk path should never get as far as opening a PR.
 */
export const HEARTBEAT_RELPATH = /^(HEARTBEAT\.md|orgs\/[A-Za-z0-9][A-Za-z0-9._-]{0,63}\/HEARTBEAT\.md)$/;

/** The commit subject every dashboard-originated schedule edit carries. */
export const SCHEDULE_EDIT_MESSAGE = 'heartbeat: schedule edit via dashboard';

/** The repo-relative HEARTBEAT.md that declares `project`'s cadences. */
function heartbeatFileFor(project: string): string {
  return project === SYSTEM_PROJECT ? 'HEARTBEAT.md' : `orgs/${project}/HEARTBEAT.md`;
}

/**
 * The `## Result` narration of card `id`, or null when the card is absent from this checkout or cannot
 * be parsed. Read through the SHARED card reader (`planeA/cards.ts`) the roster, the Atlas panel and the
 * loop-status panel already use — no second frontmatter parser.
 *
 * SECURITY: the returned text is worker-authored prose and is INERT DATA — sliced and rendered, never
 * interpreted. Same posture the card parser takes with `## Evidence`.
 */
function cardNarration(repoRoot: string, id: string): string | null {
  if (id === '' || id.includes('/') || id.includes('\\') || id.includes('..')) return null;
  for (const dirName of CARD_QUEUE_DIRS) {
    const path = join(repoRoot, 'queue', dirName, `${id}.md`);
    if (!existsSync(path)) continue;
    try {
      return resultNarration(parseCardFrontmatter(readFileSync(path, 'utf-8')).body);
    } catch {
      return null; // unparseable — an honest null, never a guessed narration
    }
  }
  return null;
}

/**
 * Build the Schedules panel. Pure read, from three places:
 *   • every `HEARTBEAT.md` (root + `orgs/<project>/`) via the SHARED cadence reader in `panels/health.ts`;
 *   • `ledgers/dispatch/**` for the last recorded beat, joined by card id to `queue/**` for narration;
 *   • the `queue/paused/` sentinels.
 *
 * Declaration order is preserved (root file first, then orgs) so the panel reads like the files do.
 */
export function buildSchedulesPanel(repoRoot: string): SchedulesPanel {
  const declared = readHeartbeatCadences(repoRoot);
  const rows = readKindRows(repoRoot, 'dispatch');

  const cadences: ScheduleRow[] = declared.map((c) => {
    const mine = rows.filter((r) => String(r.cadence ?? '') === c.name);
    // The dispatch ledger records a DATE only, so ties break by card id — stable, and never an ordering
    // claim beyond what the data supports.
    let latest: Record<string, string> | null = null;
    for (const r of mine) {
      if (latest === null) {
        latest = r;
        continue;
      }
      const a = String(r.date ?? '');
      const b = String(latest.date ?? '');
      if (a > b || (a === b && String(r.card ?? '') > String(latest.card ?? ''))) latest = r;
    }
    const card = latest ? String(latest.card ?? '') : '';
    return {
      project: c.project,
      name: c.name,
      schedule: c.schedule,
      tier: c.tier,
      riskTier: c.riskTier,
      file: heartbeatFileFor(c.project),
      paused: isPaused(repoRoot, c.name),
      lastRun: latest ? { date: String(latest.date ?? ''), card, narration: cardNarration(repoRoot, card) } : null,
      runCount: mine.length,
      scheduleHint: scheduleHint(c.schedule),
    };
  });

  return {
    label: 'schedules',
    cadences,
    pausedCount: cadences.filter((c) => c.paused).length,
  };
}

/** The governed-save entry point, as an injectable seam. Defaults to `write/governedSave.ts#save`; a test
 *  injects a recording spy so a refused write is provably a write never attempted. */
export type SaveFn = (input: SaveInput) => Promise<SaveOutcome>;

/**
 * What the schedules EDIT route needs beyond a repo root. Every field is optional and every side effect
 * is injectable, mirroring `registerAtlasPanel`'s `fetchImpl` seam and the `RouteOptions` shape the write
 * surface already uses.
 *
 * `sessionConfig` absent ⇒ the edit route FAILS CLOSED (503). It is still registered, so the surface is
 * honest about what exists; it simply refuses until the composition root wires the one session secret.
 */
export interface SchedulesRouteOptions {
  /** The one per-process session config. Absent ⇒ the edit route refuses with 503. */
  sessionConfig?: SessionConfig;
  /**
   * Checkout durable edits land in. Defaults to `repoRoot`. Production points this at the isolated
   * work-branch worktree, exactly as `/api/write/save` does; the canonical ops checkout must never
   * receive a durable write. The BRANCH is the server's to choose (`branch.ts#DEFAULT_WORK_BRANCH`),
   * never this module's and never the client's — see the `workBranch` note on the save call.
   */
  durableRepoRoot?: string;
  save?: SaveFn;
  runGit?: GitRunner;
  openPr?: PrOpener;
  runPreamble?: PreambleRunner;
  publication?: CoordinationPublication;
  outboxRoot?: string;
  /**
   * The audit sink — `http/context.ts#auditFn(ctx)` in production, a recording fake in tests. Fails OPEN
   * when absent: a checkout wired for reads only (every panel test) still gets a working edit route, it
   * simply records no row. Unlike the session gate, an absent audit sink is a wiring gap and not an
   * authorization one, and refusing the write would take the panel down rather than make it safer.
   */
  audit?: AppendAuditFn;
  /** Git runner the audit sink commits its ops row with (`ctx.opsGit`). */
  opsGit?: OpsGitRunner;
  /** Injectable clock, threaded to the audit sink (`ctx.now`). */
  now?: () => Date;
  /**
   * The outbox admission policy (`ctx.admission`) — the same gate `/api/write/save` runs first, so a
   * degraded durable spool refuses new work here too rather than piling another PR onto it. Fails OPEN
   * when absent, like {@link audit}: a read-only test harness wires no admission policy and must still
   * get a working route. Production always wires the real one.
   */
  admission?: (kind: AdmissionKind) => AdmissionDecision;
}

function asRecord(body: unknown): Record<string, unknown> {
  return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * The bearer token for a governed write. Precedence matches `write/routes.ts`: the token the scope's
 * `requireSession` preHandler ALREADY VERIFIED wins, and the body's `sessionToken` is only a fallback for
 * a caller reaching this route outside that scope. Preferring the body would let a request arrive with a
 * valid header token and a different body token, and have the write attributed to the body's — the
 * verified one is the request's actual identity. `save()` re-verifies whichever it gets, independently.
 */
function tokenFrom(req: FastifyRequest, body: Record<string, unknown>): string | undefined {
  const verified = verifiedSession(req)?.token;
  if (verified) return verified;
  const fromBody = str(body.sessionToken);
  return fromBody !== '' ? fromBody : undefined;
}

/**
 * Register the Schedules panel's read route and its one governed write.
 *
 * `GET  /api/panels/schedules` — pure read, same gate as every sibling panel.
 * `POST /api/schedules/edit`   — a HEARTBEAT.md edit through `governedSave` → work branch → PR to main.
 *
 * And that is the whole surface. PAUSING is `POST /api/write/pause-cadence` (the STOP floor already owns
 * it); UNPAUSING is a manual ops act with no endpoint anywhere. See the module header for both.
 */
export function registerSchedulesPanel(
  app: FastifyInstance,
  repoRoot: string,
  options: SchedulesRouteOptions = {},
): void {
  const runSave: SaveFn = options.save ?? defaultSave;

  app.get('/api/panels/schedules', async () => buildSchedulesPanel(repoRoot));

  app.post('/api/schedules/edit', async (req, reply: FastifyReply) => {
    // Admission first, exactly as `/api/write/save` orders it: when the durable outbox is degraded, new
    // work is refused before anything else happens rather than adding another PR to a spool that is
    // already not draining.
    const admission = options.admission?.('new-work');
    if (admission && !admission.ok) return reply.code(admission.status).send({ error: admission.reason });

    const body = asRecord(req.body);
    const file = str(body.file).replace(/\\/g, '/');
    // The keyhole: a path outside the whitelist never reaches the governed save, so "refused" means no
    // write was attempted at all rather than one that failed downstream.
    if (!HEARTBEAT_RELPATH.test(file)) {
      return reply.code(400).send({
        error: 'bad-schedule-path',
        reason: 'only HEARTBEAT.md or orgs/<project>/HEARTBEAT.md may be edited through this route',
      });
    }
    if (!options.sessionConfig) {
      return reply.code(503).send({
        error: 'schedules-write-unconfigured',
        reason: 'no session config is wired into the schedules routes',
      });
    }
    // The durable route opens the PR; capture its metadata so the panel can link the PR a human must
    // review. Nothing here merges it — `routeDurable` pushes the branch and opens a PR, full stop.
    const captured: { pr: AsyncPrResult | null } = { pr: null };
    const inner = options.openPr ?? defaultPrOpener;
    const openPr: PrOpener = async (root, request) => {
      const result = await inner(root, request);
      if (result) captured.pr = result;
      return result;
    };
    const outcome = await runSave({
      repoRoot: options.durableRepoRoot ?? repoRoot,
      relpath: file,
      content: str(body.content),
      sessionToken: tokenFrom(req, body),
      sessionConfig: options.sessionConfig,
      runGit: options.runGit,
      openPr,
      // `workBranch` is deliberately NOT passed. The SERVER owns durable work-branch selection (the same
      // rule `/api/write/save` enforces by hard-rejecting a client-supplied one), so `branch.ts` derives
      // it from `DEFAULT_WORK_BRANCH`. Pinning a branch here would have hard-coded one arc's branch into
      // shipped code and made the whole lane dead the moment that branch merged: `routeDurable` requires
      // the durable checkout's HEAD to BE the branch it is given, so a stale pin is a permanent refusal.
      message: SCHEDULE_EDIT_MESSAGE,
      runPreamble: options.runPreamble,
      publication: options.publication,
      outboxRoot: options.outboxRoot,
    });
    if (outcome.ok) {
      // Audit ONLY on the success path, in the write surface's exact row shape (`write/routes.ts`
      // `/api/write/save`): a consequential write actually occurred. A refusal writes no row —
      // refused writes must not amplify into an ops pull-rebase-push each. The row lands in the
      // canonical ops checkout (`repoRoot`), never in the durable work-branch worktree.
      if (options.audit) {
        await options.audit(
          repoRoot,
          {
            action: 'schedule-edit',
            owner: verifiedSession(req)?.claims.sub,
            target: file,
            result: `saved:${outcome.target}`,
          },
          { runGit: options.opsGit, now: options.now },
        );
      }
      return reply.code(200).send({ ok: true, target: outcome.target, pr: captured.pr });
    }
    return reply.code(outcome.status).send({ error: 'schedule-edit-refused', reason: outcome.reason });
  });
}

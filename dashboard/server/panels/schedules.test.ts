/**
 * Task 8 — the Schedules panel projection + its ONE governed write route.
 *
 * Three things are pinned here, and they are the three ways this unit could hurt the fleet:
 *   1. READ-ONLY BUILDER. The GET projection arms the same tripwire `loopStatus.test.ts` uses over every
 *      fs-write / process-spawn entry point, across a direct build AND a real route call. The panel
 *      displays what `scripts/dispatch.py` did; it must never do any of it.
 *   2. THE EDIT ROUTE IS A KEYHOLE. Only the HEARTBEAT files are writable through it, and the durable
 *      branch is the SERVER's to choose. A path outside the whitelist is refused BEFORE `save()` is
 *      reached — asserted with a spy that records every call, so "rejected" means "no governed write was
 *      even attempted", not "the write failed later".
 *   3. THIS MODULE OWNS NO PAUSE SURFACE. The `queue/paused/<name>` sentinel write belongs to the STOP
 *      floor (`POST /api/write/pause-cadence`) — one write path per action — and UNPAUSING is a manual
 *      ops act (spec §5) with no endpoint anywhere. Both are asserted against the LIVE Fastify route
 *      table, not against this file's own source, so a future registration trips them.
 */
import { mkdtempSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import { buildScheduleHistory, buildSchedulesPanel, scheduleHint, selectScheduleHistoryCards, SCHEDULE_HISTORY_LIMIT, HEARTBEAT_RELPATH } from './schedules.ts';
import type { SaveFn } from './schedules.ts';
import { registerPanels } from './routes.ts';
import { mintSession } from '../auth/session.ts';
import type { SessionConfig } from '../auth/session.ts';
import { requireSession } from '../http/middleware.ts';
import type { SaveInput, SaveOutcome } from '../write/governedSave.ts';
import type { AppendAuditFn } from '../http/context.ts';
import type { AuditEvent, AuditRow } from '../audit/log.ts';

const tripwire = vi.hoisted(() => ({ armed: false, calls: [] as string[] }));
const historyReads = vi.hoisted(() => ({ armed: false, cards: 0 }));

const guardFactory = vi.hoisted(() => (name: string, fn: unknown): unknown =>
  (...args: unknown[]) => {
    if (tripwire.armed) {
      tripwire.calls.push(name);
      throw new Error(`READ-ONLY violation: the schedules builder call graph reached ${name}`);
    }
    return (fn as (...a: unknown[]) => unknown)(...args);
  });

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const guard = guardFactory;
  return {
    ...actual,
    default: actual,
    readFileSync: (...args: Parameters<typeof actual.readFileSync>) => {
      if (historyReads.armed && /[\\/]queue[\\/]/.test(String(args[0]))) historyReads.cards += 1;
      return actual.readFileSync(...args);
    },
    writeFileSync: guard('writeFileSync', actual.writeFileSync),
    appendFileSync: guard('appendFileSync', actual.appendFileSync),
    mkdirSync: guard('mkdirSync', actual.mkdirSync),
    rmSync: guard('rmSync', actual.rmSync),
    unlinkSync: guard('unlinkSync', actual.unlinkSync),
    renameSync: guard('renameSync', actual.renameSync),
    createWriteStream: guard('createWriteStream', actual.createWriteStream),
    openSync: guard('openSync', actual.openSync),
    writeSync: guard('writeSync', actual.writeSync),
    copyFileSync: guard('copyFileSync', actual.copyFileSync),
    cpSync: guard('cpSync', actual.cpSync),
    truncateSync: guard('truncateSync', actual.truncateSync),
    symlinkSync: guard('symlinkSync', actual.symlinkSync),
    promises: {
      ...actual.promises,
      writeFile: guard('promises.writeFile', actual.promises.writeFile),
      appendFile: guard('promises.appendFile', actual.promises.appendFile),
      mkdir: guard('promises.mkdir', actual.promises.mkdir),
      rm: guard('promises.rm', actual.promises.rm),
      unlink: guard('promises.unlink', actual.promises.unlink),
    },
  };
});

/** `node:fs/promises` is a SEPARATE specifier — mocking `node:fs` alone would leave it unguarded. */
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  const guard = guardFactory;
  return {
    ...actual,
    default: actual,
    writeFile: guard('fsp.writeFile', actual.writeFile),
    appendFile: guard('fsp.appendFile', actual.appendFile),
    mkdir: guard('fsp.mkdir', actual.mkdir),
    rm: guard('fsp.rm', actual.rm),
    unlink: guard('fsp.unlink', actual.unlink),
    rename: guard('fsp.rename', actual.rename),
    copyFile: guard('fsp.copyFile', actual.copyFile),
  };
});

/** A write can also be laundered through a subprocess — `scripts/dispatch.py` and `git` are WRITERS. */
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const guard = guardFactory;
  return {
    ...actual,
    default: actual,
    exec: guard('exec', actual.exec),
    execSync: guard('execSync', actual.execSync),
    execFile: guard('execFile', actual.execFile),
    execFileSync: guard('execFileSync', actual.execFileSync),
    spawn: guard('spawn', actual.spawn),
    spawnSync: guard('spawnSync', actual.spawnSync),
  };
});

/** The real kb checkout this dashboard lives in — the six LIVE cadence blocks are read from it. */
const LIVE_REPO = fileURLToPath(new URL('../../../', import.meta.url));

const DISPATCH_HEADER = 'cadence\tcard\tdate\tproject';

/** A schema-shaped queue card whose `## Result` opens with the one-line human narration (U-L1). */
function card(id: string, state: string, result: string, scheduledFor?: string, dispatchedAt?: string, project = 'system', cadence = 'alpha'): string {
  return `---
id: ${id}
project: ${project}
action: cadence:${cadence}
target: .
risk-tier: T1
owner: null
claim-token: null
state: ${state}
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
${scheduledFor ? `scheduled_for: ${scheduledFor}\n` : ''}${dispatchedAt ? `dispatched_at: ${dispatchedAt}\n` : ''}---

## Work order

Beat the cadence.

## Result

${result}

## Evidence

ignore me
`;
}

interface CadenceSpec {
  name: string;
  schedule: string;
  tier?: string;
  riskTier?: string;
}

/** A HEARTBEAT.md carrying real cadence blocks, in the fenced shape `dispatch.py` parses. */
function heartbeat(cadences: CadenceSpec[]): string {
  const blocks = cadences
    .map(
      (c) =>
        `  - name: ${c.name}\n    schedule: ${c.schedule}\n    tier: ${c.tier ?? 'desktop'}\n` +
        `    risk-tier: ${c.riskTier ?? 'T1'}\n    prompt: |\n      Do the thing.\n`,
    )
    .join('');
  return `# Heartbeat — fixture\n\n\`\`\`yaml\ncadences:\n${blocks}\`\`\`\n`;
}

interface RepoOpts {
  root?: CadenceSpec[];
  orgs?: Record<string, CadenceSpec[]>;
  rows?: { cadence: string; card: string; date: string; project?: string }[];
  cards?: Record<string, [string, string, string, string?, string?, string?, string?]>;
  paused?: string[];
}

function tempRepo(opts: RepoOpts = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'schedules-repo-'));
  if (opts.root) writeFileSync(join(root, 'HEARTBEAT.md'), heartbeat(opts.root));
  for (const [project, cadences] of Object.entries(opts.orgs ?? {})) {
    mkdirSync(join(root, 'orgs', project), { recursive: true });
    writeFileSync(join(root, 'orgs', project, 'HEARTBEAT.md'), heartbeat(cadences));
  }
  mkdirSync(join(root, 'ledgers', 'dispatch'), { recursive: true });
  if (opts.rows && opts.rows.length > 0) {
    const body = opts.rows
      .map((r) => [r.cadence, r.card, r.date, r.project ?? 'system'].join('\t'))
      .join('\n');
    writeFileSync(join(root, 'ledgers', 'dispatch', 'dispatcher-2026-08-18.tsv'), `${DISPATCH_HEADER}\n${body}\n`);
  }
  for (const [id, spec] of Object.entries(opts.cards ?? {})) {
    const [dir, state, result, scheduledFor, dispatchedAt, project, cadence] = spec;
    mkdirSync(join(root, 'queue', dir), { recursive: true });
    writeFileSync(join(root, 'queue', dir, `${id}.md`), card(id, state, result, scheduledFor, dispatchedAt, project, cadence));
  }
  for (const name of opts.paused ?? []) {
    mkdirSync(join(root, 'queue', 'paused'), { recursive: true });
    writeFileSync(join(root, 'queue', 'paused', name), '');
  }
  return root;
}

/** A real session config: most tests never mint against it (the save spy stands in for the gate module,
 *  which owns verification and is unit-tested for it in governedSave.test.ts), but the token-precedence
 *  test runs the REAL `requireSession` gate, so this must be genuinely signable. */
const SESSION_CONFIG: SessionConfig = { secret: Buffer.from('schedules-test-secret-0123456789'), ttlMs: 60_000 };

/** A recording stand-in for `governedSave#save`. Records every call; never touches disk or git. */
function saveSpy(outcome: SaveOutcome = { ok: true, target: 'durable' }): SaveFn & { calls: SaveInput[] } {
  const calls: SaveInput[] = [];
  const fn = (async (input: SaveInput) => {
    calls.push(input);
    return outcome;
  }) as SaveFn & { calls: SaveInput[] };
  fn.calls = calls;
  return fn;
}

/** A recording stand-in for the `http/context.ts#auditFn` sink. Records the row; writes nothing. */
function auditSpy(): AppendAuditFn & { rows: AuditEvent[] } {
  const rows: AuditEvent[] = [];
  const fn = ((_repoRoot: string, event: AuditEvent) => {
    rows.push(event);
    return { ...event, ts: '2026-08-18T00:00:00.000Z' } as AuditRow;
  }) as AppendAuditFn & { rows: AuditEvent[] };
  fn.rows = rows;
  return fn;
}

afterEach(() => {
  tripwire.armed = false;
  tripwire.calls = [];
  vi.restoreAllMocks();
});

describe('buildSchedulesPanel — the projection', () => {
  it('lists all SIX live cadences with their real project and schedule', () => {
    const panel = buildSchedulesPanel(LIVE_REPO);
    expect(panel.label).toBe('schedules');
    const seen = panel.cadences.map((c) => `${c.project}/${c.name}=${c.schedule}`);
    expect(seen).toEqual([
      'system/nightly-review=daily',
      'system/weekly-audit=weekly:sat',
      'system/grades-reconcile=weekly:sat',
      'system/branch-hygiene=weekly:sun',
      'atlas-prep/research-draft-gate=weekly',
      'kb-ops/self-lint-report=daily',
    ]);
    // Each row carries the HEARTBEAT file the block lives in — the edit affordance's target.
    expect(panel.cadences.map((c) => c.file)).toEqual([
      'HEARTBEAT.md',
      'HEARTBEAT.md',
      'HEARTBEAT.md',
      'HEARTBEAT.md',
      'orgs/atlas-prep/HEARTBEAT.md',
      'orgs/kb-ops/HEARTBEAT.md',
    ]);
    expect(Object.keys(panel.files)).toEqual([
      'HEARTBEAT.md',
      'orgs/atlas-prep/HEARTBEAT.md',
      'orgs/faceless-youtube/HEARTBEAT.md',
      'orgs/kb-ops/HEARTBEAT.md',
    ]);
    expect(panel.files['HEARTBEAT.md']).toContain('name: nightly-review');
    // Every declared file path is one the edit route would accept — the panel never offers a target the
    // keyhole refuses.
    for (const c of panel.cadences) expect(HEARTBEAT_RELPATH.test(c.file)).toBe(true);
    expect(panel.cadences.map((c) => c.riskTier)).toEqual(['T1', 'T1', 'T1', 'T1', 'T2', 'T1']);
  });

  it('reports a paused cadence from its `queue/paused/<name>` sentinel', () => {
    const root = tempRepo({
      root: [{ name: 'alpha', schedule: 'daily' }, { name: 'beta', schedule: 'weekly:sat' }],
      paused: ['beta'],
    });
    const panel = buildSchedulesPanel(root);
    expect(panel.cadences.map((c) => [c.name, c.paused])).toEqual([['alpha', false], ['beta', true]]);
    expect(panel.pausedCount).toBe(1);
  });

  it('joins the dispatch ledger to the card for last-run date, card id and narration', () => {
    const root = tempRepo({
      root: [{ name: 'alpha', schedule: 'daily' }],
      rows: [
        { cadence: 'alpha', card: 'aaaa0001-1111', date: '2026-08-16' },
        { cadence: 'alpha', card: 'bbbb0002-2222', date: '2026-08-18' },
      ],
      cards: {
        'aaaa0001-1111': ['done', 'done', 'Hey — older run.'],
        'bbbb0002-2222': ['done', 'done', 'Hey — swept 3 branches. Needs you: nothing.\n\nmore detail below'],
      },
    });
    const panel = buildSchedulesPanel(root);
    const [alpha] = panel.cadences;
    expect(alpha.lastRun).toEqual({
      date: '2026-08-18',
      card: 'bbbb0002-2222',
      narration: 'Hey — swept 3 branches. Needs you: nothing.',
    });
    expect(alpha.runCount).toBe(2);
  });

  it('is honest about a cadence that never ran, and about a run whose card is not in this checkout', () => {
    const root = tempRepo({
      root: [{ name: 'alpha', schedule: 'daily' }, { name: 'beta', schedule: 'daily' }],
      rows: [{ cadence: 'beta', card: 'cccc0003-3333', date: '2026-08-18', project: 'system' }],
    });
    const panel = buildSchedulesPanel(root);
    const byName = new Map(panel.cadences.map((c) => [c.name, c]));
    expect(byName.get('alpha')!.lastRun).toBeNull();
    expect(byName.get('beta')!.lastRun).toEqual({ date: '2026-08-18', card: 'cccc0003-3333', narration: null });
  });

  it('keeps same-named cadences in separate projects joined to their own ledger row', () => {
    const root = tempRepo({
      orgs: {
        alpha: [{ name: 'shared', schedule: 'daily' }],
        beta: [{ name: 'shared', schedule: 'weekly:sat' }],
      },
      rows: [
        { cadence: 'shared', card: 'alpha0001-1111', date: '2026-08-17', project: 'alpha' },
        { cadence: 'shared', card: 'beta0002-2222', date: '2026-08-18', project: 'beta' },
      ],
      cards: {
        'alpha0001-1111': ['done', 'done', 'Alpha narration.'],
        'beta0002-2222': ['done', 'done', 'Beta narration.'],
      },
    });
    const panel = buildSchedulesPanel(root);
    const byProject = new Map(panel.cadences.map((c) => [c.project, c]));
    expect(byProject.get('alpha')!.lastRun).toEqual({
      date: '2026-08-17', card: 'alpha0001-1111', narration: 'Alpha narration.',
    });
    expect(byProject.get('beta')!.lastRun).toEqual({
      date: '2026-08-18', card: 'beta0002-2222', narration: 'Beta narration.',
    });
  });

  it('builds newest-first history from dispatch rows plus card scheduler stamps and result excerpts', () => {
    const root = tempRepo({
      root: [{ name: 'alpha', schedule: '0 9 * * mon' }],
      rows: [
        { cadence: 'alpha', card: 'older0001-1111', date: '2026-08-17' },
        { cadence: 'alpha', card: 'newer0002-2222', date: '2026-08-18' },
      ],
      cards: {
        'older0001-1111': ['done', 'done', 'Older result.', '2026-08-17T09:00:00', '2026-08-17T09:02:00'],
        'newer0002-2222': ['done', 'done', 'Newest result first line.\n\nMore inert detail.', '2026-08-18T09:00:00', '2026-08-18T09:01:00'],
      },
    });

    expect(buildScheduleHistory(root, 'system', 'alpha')).toEqual({
      project: 'system',
      cadence: 'alpha',
      runs: [
        { card: 'newer0002-2222', project: 'system', scheduledFor: '2026-08-18T09:00:00', dispatchedAt: '2026-08-18T09:01:00', outcome: 'done', result: 'Newest result first line.' },
        { card: 'older0001-1111', project: 'system', scheduledFor: '2026-08-17T09:00:00', dispatchedAt: '2026-08-17T09:02:00', outcome: 'done', result: 'Older result.' },
      ],
    });
  });

  it('returns result text only for cards physically and logically in done', () => {
    const root = tempRepo({
      root: [{ name: 'alpha', schedule: 'daily' }],
      rows: [
        { cadence: 'alpha', card: 'inbox0001-1111', date: '2026-08-15' },
        { cadence: 'alpha', card: 'working0002-2222', date: '2026-08-16' },
        { cadence: 'alpha', card: 'mismatch0003-3333', date: '2026-08-17' },
        { cadence: 'alpha', card: 'done00004-4444', date: '2026-08-18' },
      ],
      cards: {
        'inbox0001-1111': ['inbox', 'inbox', 'Inbox secret.', '2026-08-15T09:00:00'],
        'working0002-2222': ['working', 'done', 'Working secret.', '2026-08-16T09:00:00'],
        'mismatch0003-3333': ['done', 'working', 'Mismatched secret.', '2026-08-17T09:00:00'],
        'done00004-4444': ['done', 'done', 'Published result.', '2026-08-18T09:00:00'],
      },
    });

    expect(buildScheduleHistory(root, 'system', 'alpha').runs).toEqual([
      expect.objectContaining({ card: 'done00004-4444', result: 'Published result.' }),
      expect.objectContaining({ card: 'mismatch0003-3333', result: null }),
      expect.objectContaining({ card: 'working0002-2222', result: null }),
      expect.objectContaining({ card: 'inbox0001-1111', result: null }),
    ]);
  });

  it('filters history by project as well as cadence name', () => {
    const root = tempRepo({
      orgs: {
        alpha: [{ name: 'shared', schedule: 'daily' }],
        beta: [{ name: 'shared', schedule: 'daily' }],
      },
      rows: [
        { cadence: 'shared', card: 'alpha0001-1111', date: '2026-08-17', project: 'alpha' },
        { cadence: 'shared', card: 'beta00002-2222', date: '2026-08-18', project: 'beta' },
      ],
      cards: {
        'alpha0001-1111': ['done', 'done', 'Alpha only.', '2026-08-17T09:00:00', undefined, 'alpha', 'shared'],
        'beta00002-2222': ['done', 'done', 'Beta only.', '2026-08-18T09:00:00', undefined, 'beta', 'shared'],
      },
    });

    expect(buildScheduleHistory(root, 'alpha', 'shared').runs).toEqual([
      expect.objectContaining({ card: 'alpha0001-1111', project: 'alpha', result: 'Alpha only.' }),
    ]);
    expect(buildScheduleHistory(root, 'beta', 'shared').runs).toEqual([
      expect.objectContaining({ card: 'beta00002-2222', project: 'beta', result: 'Beta only.' }),
    ]);
  });

  it('selects at most the response cap of card files by metadata before card bodies are parsed', () => {
    const cards: NonNullable<RepoOpts['cards']> = {};
    for (let index = 0; index < SCHEDULE_HISTORY_LIMIT + 25; index += 1) {
      cards[`card-${String(index).padStart(3, '0')}`] = ['done', 'done', `Result ${index}.`, '2026-08-18T09:00:00'];
    }
    const root = tempRepo({ cards });
    const selected = selectScheduleHistoryCards(root);
    expect(selected).toHaveLength(SCHEDULE_HISTORY_LIMIT);
    expect(new Set(selected.map((candidate) => candidate.id)).size).toBe(SCHEDULE_HISTORY_LIMIT);

    historyReads.cards = 0;
    historyReads.armed = true;
    try {
      buildScheduleHistory(root, 'system', 'alpha');
    } finally {
      historyReads.armed = false;
    }
    expect(historyReads.cards).toBe(SCHEDULE_HISTORY_LIMIT);
  });

  it('degrades to an empty cadence list on a checkout with no HEARTBEAT at all', () => {
    const panel = buildSchedulesPanel(tempRepo());
    expect(panel.cadences).toEqual([]);
    expect(panel.files).toEqual({});
    expect(panel.pausedCount).toBe(0);
  });

  it('returns raw contents for every HEARTBEAT file read, including a declaration with no cadence blocks', () => {
    const root = tempRepo({ root: [], orgs: { demo: [] } });
    const panel = buildSchedulesPanel(root);
    expect(panel.files).toEqual({
      'HEARTBEAT.md': heartbeat([]),
      'orgs/demo/HEARTBEAT.md': heartbeat([]),
    });
  });
});

describe('scheduleHint — a display string, never a second scheduler', () => {
  it('echoes a cron expression verbatim and names the legacy forms', () => {
    expect(scheduleHint('3 7 * * mon,thu')).toBe('cron: 3 7 * * mon,thu');
    expect(scheduleHint('daily')).toBe('every day');
    expect(scheduleHint('weekly:sat')).toBe('every sat');
    // `dispatch.py::due()` returns False for both of these — the hint must not imply otherwise.
    expect(scheduleHint('weekly')).toBe('never fires — bare `weekly` names no day');
    expect(scheduleHint('monthly')).toBe('never fires — `monthly` is not a form the dispatcher beats');
    expect(scheduleHint(null)).toBe('no schedule declared');
  });

  it('labels `cron:` only for a string actually SHAPED like cron, never any five words', () => {
    expect(scheduleHint('*/5 * * * *')).toBe('cron: */5 * * * *');
    expect(scheduleHint('0 3 1-15 jan,jul mon-fri')).toBe('cron: 0 3 1-15 jan,jul mon-fri');
    // Five tokens, but the minute/hour fields carry letters — a sentence, not an expression.
    expect(scheduleHint('every other day at noon')).toBe(
      'never fires — the dispatcher does not recognise `every other day at noon`',
    );
    expect(scheduleHint('3 7 * *')).toBe('never fires — the dispatcher does not recognise `3 7 * *`');
  });
});

describe('GET /api/panels/schedules — read-only', () => {
  it('writes nothing: no fs-write/spawn call, and the dispatch shard mtime is unchanged', async () => {
    const root = tempRepo({
      root: [{ name: 'alpha', schedule: 'daily' }],
      orgs: { demo: [{ name: 'beta', schedule: '*/5 * * * *' }] },
      rows: [{ cadence: 'alpha', card: 'aaaa0001-1111', date: '2026-08-18' }],
      cards: { 'aaaa0001-1111': ['done', 'done', 'Hey — it ran.'] },
      paused: ['beta'],
    });
    const shard = join(root, 'ledgers', 'dispatch', 'dispatcher-2026-08-18.tsv');
    const before = statSync(shard).mtimeMs;

    const app = Fastify({ logger: false });
    registerPanels(app, root);
    await app.ready();

    tripwire.armed = true;
    try {
      const panel = buildSchedulesPanel(root);
      expect(panel.cadences).toHaveLength(2);

      const res = await app.inject({ method: 'GET', url: '/api/panels/schedules' });
      expect(res.statusCode).toBe(200);
      const body = res.json() as { cadences: { name: string; paused: boolean; scheduleHint: string }[] };
      expect(body.cadences.map((c) => c.name)).toEqual(['alpha', 'beta']);
      expect(body.cadences[1].paused).toBe(true);
      expect(body.cadences[1].scheduleHint).toBe('cron: */5 * * * *');
      expect(body).toMatchObject({ files: { 'HEARTBEAT.md': heartbeat([{ name: 'alpha', schedule: 'daily' }]) } });

      const history = await app.inject({ method: 'GET', url: '/api/panels/schedules/history?project=system&cadence=alpha' });
      expect(history.statusCode).toBe(200);
      expect(history.json()).toMatchObject({ project: 'system', cadence: 'alpha', runs: [{ card: 'aaaa0001-1111', outcome: 'done', result: 'Hey — it ran.' }] });
      const missingProject = await app.inject({ method: 'GET', url: '/api/panels/schedules/history?cadence=alpha' });
      expect(missingProject.statusCode).toBe(400);
      expect(missingProject.json()).toEqual({ error: 'project-required' });
      const missingCadence = await app.inject({ method: 'GET', url: '/api/panels/schedules/history?project=system' });
      expect(missingCadence.statusCode).toBe(400);
    } finally {
      tripwire.armed = false;
      await app.close();
    }

    expect(tripwire.calls).toEqual([]);
    expect(statSync(shard).mtimeMs).toBe(before);
    // Generous timeout: this is the only test here that boots Fastify, whose cold import/compile can
    // exceed the 5s default on a first, uncached run.
  }, 30_000);
});

describe('POST /api/schedules/edit — the HEARTBEAT keyhole', () => {
  async function editApp(save: SaveFn, root = tempRepo({ root: [{ name: 'alpha', schedule: 'daily' }] })) {
    const app = Fastify({ logger: false });
    registerPanels(app, root, { sessionConfig: SESSION_CONFIG, save });
    await app.ready();
    return app;
  }

  it('refuses a path outside the HEARTBEAT whitelist with 400 and never reaches save()', async () => {
    const save = saveSpy();
    const app = await editApp(save);
    try {
      for (const file of [
        'governance/budget.yaml',
        'orgs/kb-ops/STATE.md',
        'orgs/kb-ops/sub/HEARTBEAT.md',
        '../HEARTBEAT.md',
        'HEARTBEAT.md.bak',
        'heartbeat.md',
        '',
        // The org segment carries the write surface's project-name shape, so these never reach save()
        // either — governedSave's confinement would catch the traversals, but junk must not open a PR.
        'orgs/../HEARTBEAT.md',
        'orgs/./HEARTBEAT.md',
        'orgs/ /HEARTBEAT.md',
        'orgs/.hidden/HEARTBEAT.md',
        `orgs/${'a'.repeat(65)}/HEARTBEAT.md`,
      ]) {
        const res = await app.inject({
          method: 'POST',
          url: '/api/schedules/edit',
          payload: { file, content: 'x', sessionToken: 'tok' },
        });
        expect(res.statusCode, file).toBe(400);
        expect((res.json() as { error: string }).error).toBe('bad-schedule-path');
      }
      expect(save.calls).toEqual([]);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('routes an accepted HEARTBEAT edit through governedSave, PR not merge, server-selected branch', async () => {
    const save = saveSpy();
    const app = await editApp(save);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/schedules/edit',
        payload: { file: 'orgs/kb-ops/HEARTBEAT.md', content: '# edited\n', sessionToken: 'tok-123' },
      });
      expect(res.statusCode).toBe(200);
      expect(save.calls).toHaveLength(1);
      const call = save.calls[0];
      expect(call.relpath).toBe('orgs/kb-ops/HEARTBEAT.md');
      expect(call.content).toBe('# edited\n');
      expect(call.sessionToken).toBe('tok-123');
      expect(call.sessionConfig).toBe(SESSION_CONFIG);
      // The SERVER owns durable work-branch selection (`branch.ts#DEFAULT_WORK_BRANCH`), exactly as
      // `/api/write/save` does. A branch pinned here would go dead the moment that branch merged.
      expect(call.workBranch).toBeUndefined();
      expect(call.message).toBe('heartbeat: schedule edit via dashboard');
      // The durable route opens a PR; nothing here may merge it.
      expect(typeof call.openPr).toBe('function');
      expect(res.json()).not.toHaveProperty('branch');
      expect((res.json() as { ok: boolean; target: string }).target).toBe('durable');
    } finally {
      await app.close();
    }
  }, 30_000);

  it('prefers the VERIFIED session token over a body-supplied one, and attributes its owner', async () => {
    const save = saveSpy();
    const audit = auditSpy();
    const root = tempRepo({ root: [{ name: 'alpha', schedule: 'daily' }] });
    const minted = mintSession('operator', SESSION_CONFIG);
    const app = Fastify({ logger: false });
    // The REAL gate the production scope applies, not a stand-in: it verifies and stashes the session.
    app.addHook('preHandler', requireSession(SESSION_CONFIG));
    registerPanels(app, root, { sessionConfig: SESSION_CONFIG, save, audit });
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/schedules/edit',
        headers: { authorization: `Bearer ${minted.token}` },
        payload: { file: 'HEARTBEAT.md', content: 'x', sessionToken: 'body-supplied-token' },
      });
      expect(res.statusCode).toBe(200);
      // The request's actual identity wins; a mismatched body token is never the one attributed.
      expect(save.calls[0].sessionToken).toBe(minted.token);
      expect(audit.rows[0].owner).toBe('operator');
    } finally {
      await app.close();
    }
  }, 30_000);

  it('runs the admission gate FIRST and refuses new work on a degraded outbox', async () => {
    const save = saveSpy();
    const root = tempRepo({ root: [{ name: 'alpha', schedule: 'daily' }] });
    const kinds: string[] = [];
    const app = Fastify({ logger: false });
    registerPanels(app, root, {
      sessionConfig: SESSION_CONFIG,
      save,
      admission: (kind) => {
        kinds.push(kind);
        return { ok: false, status: 503, reason: 'outbox-degraded' };
      },
    });
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/schedules/edit',
        payload: { file: 'HEARTBEAT.md', content: 'x', sessionToken: 'tok' },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json()).toEqual({ error: 'outbox-degraded' });
      expect(kinds).toEqual(['new-work']);
      expect(save.calls).toEqual([]);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('fails OPEN on an absent admission policy: a read-only harness still gets a working route', async () => {
    const save = saveSpy();
    const app = await editApp(save); // no `admission` wired
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/schedules/edit',
        payload: { file: 'HEARTBEAT.md', content: 'x', sessionToken: 'tok' },
      });
      expect(res.statusCode).toBe(200);
      expect(save.calls).toHaveLength(1);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('passes a governedSave refusal through with its own status and reason', async () => {
    const save = saveSpy({ ok: false, status: 403, reason: 'governance/** is human-edited only' });
    const app = await editApp(save);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/schedules/edit',
        payload: { file: 'HEARTBEAT.md', content: 'x', sessionToken: 'tok' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'schedule-edit-refused', reason: 'governance/** is human-edited only' });
    } finally {
      await app.close();
    }
  }, 30_000);

  it('appends exactly one audit row, in the write surface\'s row shape, on the success path only', async () => {
    const save = saveSpy();
    const audit = auditSpy();
    const root = tempRepo({ root: [{ name: 'alpha', schedule: 'daily' }] });
    const app = Fastify({ logger: false });
    registerPanels(app, root, { sessionConfig: SESSION_CONFIG, save, audit });
    await app.ready();
    try {
      const ok = await app.inject({
        method: 'POST',
        url: '/api/schedules/edit',
        payload: { file: 'HEARTBEAT.md', content: '# edited\n', sessionToken: 'tok' },
      });
      expect(ok.statusCode).toBe(200);
      // Same shape `/api/write/save` writes: action / owner / target / result.
      expect(audit.rows).toEqual([
        { action: 'schedule-edit', owner: undefined, target: 'HEARTBEAT.md', result: 'saved:durable' },
      ]);

      // A refusal writes NO row — refused writes must not amplify into an ops pull-rebase-push each.
      const refused = await app.inject({
        method: 'POST',
        url: '/api/schedules/edit',
        payload: { file: 'governance/budget.yaml', content: 'x', sessionToken: 'tok' },
      });
      expect(refused.statusCode).toBe(400);
      expect(audit.rows).toHaveLength(1);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('fails OPEN on an absent audit sink: the edit still succeeds, it simply records no row', async () => {
    const save = saveSpy();
    const app = await editApp(save); // no `audit` wired
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/schedules/edit',
        payload: { file: 'HEARTBEAT.md', content: '# edited\n', sessionToken: 'tok' },
      });
      expect(res.statusCode).toBe(200);
      expect(save.calls).toHaveLength(1);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('fails CLOSED (503) when no session config was wired into the registrar', async () => {
    const save = saveSpy();
    const root = tempRepo({ root: [{ name: 'alpha', schedule: 'daily' }] });
    const app = Fastify({ logger: false });
    registerPanels(app, root, { save }); // no sessionConfig
    await app.ready();
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/schedules/edit',
        payload: { file: 'HEARTBEAT.md', content: 'x', sessionToken: 'tok' },
      });
      expect(res.statusCode).toBe(503);
      expect(save.calls).toEqual([]);
    } finally {
      await app.close();
    }
  }, 30_000);
});

describe('/api/schedules — the surface is EDIT and nothing else', () => {
  async function scheduleApp(save: SaveFn) {
    const root = tempRepo({ root: [{ name: 'alpha', schedule: 'daily' }] });
    const app = Fastify({ logger: false });
    registerPanels(app, root, { sessionConfig: SESSION_CONFIG, save });
    await app.ready();
    return app;
  }

  it('registers NO delete and NO unpause surface — arming stays a manual ops act', async () => {
    const save = saveSpy();
    const app = await scheduleApp(save);
    try {
      const table = app.printRoutes({ commonPrefix: false });
      const scheduleLines = table.split('\n').filter((l) => l.includes('schedule'));
      expect(scheduleLines.length).toBeGreaterThan(0);
      for (const line of scheduleLines) expect(line).not.toMatch(/DELETE/);
      expect(table).not.toMatch(/DELETE/);

      for (const url of ['/api/schedules/pause', '/api/schedules/pause/alpha', '/api/schedules/alpha']) {
        const res = await app.inject({ method: 'DELETE', url });
        expect(res.statusCode, url).toBe(404);
      }
      // …and no POST-shaped unpause either.
      const unpause = await app.inject({
        method: 'POST',
        url: '/api/schedules/unpause',
        payload: { name: 'alpha', sessionToken: 'tok' },
      });
      expect(unpause.statusCode).toBe(404);
      expect(save.calls).toEqual([]);
    } finally {
      await app.close();
    }
  }, 30_000);

  it('owns NO pause route: the sentinel write stays the STOP floor\'s (/api/write/pause-cadence)', async () => {
    const save = saveSpy();
    const app = await scheduleApp(save);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/schedules/pause',
        payload: { name: 'alpha', sessionToken: 'tok' },
      });
      expect(res.statusCode).toBe(404);
      // One write path per action: no `queue/paused/**` save may originate in this module.
      expect(save.calls).toEqual([]);
    } finally {
      await app.close();
    }
  }, 30_000);
});

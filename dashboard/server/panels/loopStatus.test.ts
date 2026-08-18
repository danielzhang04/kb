/**
 * Wave-1 U-L2 — the loop-status projection.
 *
 * Two things are pinned here, and they are the two ways this panel could lie:
 *   1. HONESTY. An empty ledger yields NAMED, EMPTY loop rows — the three declared loops still appear,
 *      each saying "never run" — and never a fabricated last run, outcome, or narration. A run whose
 *      card cannot be parsed is DROPPED rather than given a guessed outcome.
 *   2. READ-ONLY. The headline test arms a tripwire over every fs write / process-spawn entry point and
 *      snapshots the dispatch shard's mtime around a full build AND a real route call, because the
 *      panel displays what `scripts/dispatch.py` did and must never do any of it itself.
 *
 * The tripwire is copied from `autonomyLadder.test.ts` deliberately: the guarantee is about the whole
 * CALL GRAPH (`readKindRows`, `parseCardFrontmatter`, and anything they reach), not about the imports
 * of this one module.
 */
import { mkdtempSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import {
  LOOP_CADENCES,
  buildLoopStatusPanel,
  declaredCadences,
  isPaused,
  resultNarration,
  type LoopCadence,
} from './loopStatus.ts';
import { registerPanels } from './routes.ts';

const tripwire = vi.hoisted(() => ({ armed: false, calls: [] as string[] }));

const guardFactory = vi.hoisted(() => (name: string, fn: unknown): unknown =>
  (...args: unknown[]) => {
    if (tripwire.armed) {
      tripwire.calls.push(name);
      throw new Error(`READ-ONLY violation: the loop-status call graph reached ${name}`);
    }
    return (fn as (...a: unknown[]) => unknown)(...args);
  });

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  const guard = guardFactory;
  return {
    ...actual,
    default: actual,
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

/** A write can also be laundered through a subprocess. `scripts/dispatch.py` is a WRITER — it emits
 *  cards and appends ledger rows — and nothing in this panel's graph may ever invoke it. */
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

const HYGIENE = 'loop-a-hygiene';
const MINING = 'loop-b-lesson-mining';
const UPGRADE = 'loop-c-agent-upgrade';

const DISPATCH_HEADER = 'cadence\tcard\tdate\tproject';

interface Row {
  cadence: string;
  card: string;
  date: string;
  project?: string;
}

/**
 * One queue card, schema-shaped, with the `state` and `## Result` text a run's narration comes from.
 *
 * `action` defaults to a NON-loop verb phrase on purpose: most cards in a real queue have nothing to
 * do with a loop, and a fixture whose every card announced a cadence would make the hand-run scan look
 * like it works when it was only matching itself.
 */
function card(id: string, state: string, result: string, action = 'do something unrelated'): string {
  return `---
id: ${id}
project: kb
action: ${action}
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
---

## Work order

Run the loop.

## Result

${result}

## Evidence

ignore me
`;
}

interface RepoOpts {
  /** Dispatch-ledger rows, written to one shard. */
  rows?: Row[];
  /** Cards to drop into `queue/<dir>/<id>.md`: id → [dir, state, result text, optional `action`]. */
  cards?: Record<string, [string, string, string] | [string, string, string, string]>;
  /** Card ids written with deliberately BROKEN frontmatter. */
  brokenCards?: Record<string, string>;
  /** Cadence names to pause via `queue/paused/<name>`. */
  paused?: string[];
  /**
   * Cadence names to DECLARE in `HEARTBEAT.md`. Defaults to all three loops, because that is the
   * armed world most assertions are about; pass `[]` for the pre-arming world (no HEARTBEAT.md).
   */
  declare?: string[];
}

/** A HEARTBEAT.md carrying real cadence blocks for `names`, in the fenced shape dispatch.py parses. */
function heartbeat(names: string[]): string {
  const blocks = names
    .map((n) => `  - name: ${n}\n    schedule: daily\n    tier: cloud\n    agent: dispatcher-cloud\n`)
    .join('');
  return `# Heartbeat — fixture\n\n\`\`\`yaml\ncadences:\n${blocks}\`\`\`\n`;
}

function tempRepo(opts: RepoOpts = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'loopstatus-repo-'));
  mkdirSync(join(root, 'ledgers', 'dispatch'), { recursive: true });
  const declare = opts.declare ?? [HYGIENE, MINING, UPGRADE];
  if (declare.length > 0) writeFileSync(join(root, 'HEARTBEAT.md'), heartbeat(declare));
  if (opts.rows && opts.rows.length > 0) {
    const body = opts.rows
      .map((r) => [r.cadence, r.card, r.date, r.project ?? 'kb'].join('\t'))
      .join('\n');
    writeFileSync(join(root, 'ledgers', 'dispatch', 'dispatcher-2026-08-18.tsv'), `${DISPATCH_HEADER}\n${body}\n`);
  }
  for (const [id, spec] of Object.entries(opts.cards ?? {})) {
    const [dir, state, result, action] = spec;
    mkdirSync(join(root, 'queue', dir), { recursive: true });
    writeFileSync(join(root, 'queue', dir, `${id}.md`), card(id, state, result, action));
  }
  for (const [id, dir] of Object.entries(opts.brokenCards ?? {})) {
    mkdirSync(join(root, 'queue', dir), { recursive: true });
    writeFileSync(join(root, 'queue', dir, `${id}.md`), 'no frontmatter here at all\n\n## Result\n\nnope\n');
  }
  for (const name of opts.paused ?? []) {
    mkdirSync(join(root, 'queue', 'paused'), { recursive: true });
    writeFileSync(join(root, 'queue', 'paused', name), '');
  }
  return root;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LOOP_CADENCES — the declared loops', () => {
  it('carries the three loops with their DECLARED schedule strings, verbatim', () => {
    expect(LOOP_CADENCES.map((l) => l.cadence)).toEqual([HYGIENE, MINING, UPGRADE]);
    expect(LOOP_CADENCES.map((l) => l.schedule)).toEqual(['daily', 'daily', 'weekly:sat']);
    // Plain words, never the slug — the panel renders `label`, not `cadence`.
    expect(LOOP_CADENCES.map((l) => l.label)).toEqual([
      'Hygiene loop',
      'Lesson-mining loop',
      'Agent-upgrade loop',
    ]);
  });

  it('a fourth loop is ONE array entry: the builder takes the list as an argument', () => {
    const extra: LoopCadence[] = [
      ...LOOP_CADENCES,
      { cadence: 'loop-d-demo', label: 'Demo loop', schedule: 'weekly:sun' },
    ];
    const root = tempRepo({ declare: [HYGIENE, MINING, UPGRADE, 'loop-d-demo'] });
    const panel = buildLoopStatusPanel(root, extra);
    expect(panel.loops).toHaveLength(4);
    expect(panel.loops[3]).toMatchObject({
      cadence: 'loop-d-demo',
      schedule: 'weekly:sun',
      declared: true,
      state: 'never-run',
    });
  });
});

describe('declaredCadences() — HEARTBEAT.md name existence, and nothing more', () => {
  it('reads the fenced cadence block names from the root and org HEARTBEAT.md files', () => {
    const root = tempRepo({ declare: [HYGIENE, MINING] });
    mkdirSync(join(root, 'orgs', 'demo'), { recursive: true });
    writeFileSync(join(root, 'orgs', 'demo', 'HEARTBEAT.md'), heartbeat(['org-only-cadence']));
    const names = declaredCadences(root);
    expect(names.has(HYGIENE)).toBe(true);
    expect(names.has(MINING)).toBe(true);
    expect(names.has('org-only-cadence')).toBe(true);
    expect(names.has(UPGRADE)).toBe(false);
  });

  it('fails closed on a missing or unfenced HEARTBEAT.md', () => {
    expect(declaredCadences(tempRepo({ declare: [] })).size).toBe(0);
    const root = tempRepo({ declare: [] });
    writeFileSync(join(root, 'HEARTBEAT.md'), `cadences:\n  - name: ${HYGIENE}\n`); // no yaml fence
    expect(declaredCadences(root).size).toBe(0);
  });
});

describe('buildLoopStatusPanel() — declared vs draft', () => {
  it('a loop with NO cadence block is `not-declared`, never a loop with a declared schedule', () => {
    // Today's real world: the three loops exist only as proposal drafts.
    const panel = buildLoopStatusPanel(tempRepo({ declare: [] }));
    expect(panel.loops.every((l) => l.state === 'not-declared')).toBe(true);
    expect(panel.loops.every((l) => l.declared === false)).toBe(true);
    // The proposed string is still carried — the panel words it as a proposal, not a declaration.
    expect(panel.loops.map((l) => l.schedule)).toEqual(['daily', 'daily', 'weekly:sat']);
    // Nothing declared ⇒ the empty-feed wording is allowed to call these "drafts awaiting arming".
    expect(panel.anyDeclared).toBe(false);
  });

  it('declaring the cadence block flips the loop onto the declared path', () => {
    const panel = buildLoopStatusPanel(tempRepo({ declare: [HYGIENE] }));
    expect(panel.loops.find((l) => l.cadence === HYGIENE)).toMatchObject({
      declared: true,
      state: 'never-run',
    });
    expect(panel.loops.find((l) => l.cadence === MINING)).toMatchObject({
      declared: false,
      state: 'not-declared',
    });
    // One declared loop is enough: the panel must not call an armed-but-unbeaten loop a draft.
    expect(panel.anyDeclared).toBe(true);
  });

  it('`not-declared` outranks a pause sentinel and a recorded run — nothing makes a draft live', () => {
    const panel = buildLoopStatusPanel(
      tempRepo({
        declare: [],
        rows: [{ cadence: HYGIENE, card: 'aaaa0001-1111', date: '2026-08-17' }],
        cards: { 'aaaa0001-1111': ['done', 'done', 'swept'] },
        paused: [MINING],
      }),
    );
    expect(panel.loops.find((l) => l.cadence === HYGIENE)!.state).toBe('not-declared');
    expect(panel.loops.find((l) => l.cadence === MINING)!.state).toBe('not-declared');
    // …but the run is still surfaced. That is the arming ceremony's evidence.
    expect(panel.loops.find((l) => l.cadence === HYGIENE)!.lastRun!.narration).toBe('swept');
    expect(panel.feed).toHaveLength(1);
  });
});

describe('buildLoopStatusPanel() — hand runs (no ledger row at all)', () => {
  it('surfaces a queue card matched by `action`, marked as a hand run', () => {
    // Stage ① of arming: a human ran the loop to prove it works. dispatch.py never saw it.
    const panel = buildLoopStatusPanel(
      tempRepo({
        declare: [],
        cards: {
          'ffff0006-6666': ['done', 'done', 'hand-ran the hygiene loop; 3 branches swept', `cadence:${HYGIENE}`],
        },
      }),
    );
    expect(panel.ledgerRowCount).toBe(0);
    expect(panel.handRunCount).toBe(1);
    expect(panel.neverRun).toBe(false);
    expect(panel.feed).toHaveLength(1);
    expect(panel.feed[0]).toMatchObject({
      cadence: HYGIENE,
      source: 'hand-run',
      date: '',
      outcome: 'done',
      narration: 'hand-ran the hygiene loop; 3 branches swept',
    });
    expect(panel.loops.find((l) => l.cadence === HYGIENE)!.runCount).toBe(1);
  });

  it('matches the bare cadence name too, and ignores the inspect sibling and unrelated cards', () => {
    const panel = buildLoopStatusPanel(
      tempRepo({
        declare: [],
        cards: {
          'ffff0006-6666': ['done', 'done', 'bare-action hand run', MINING],
          'ffff0007-7777': ['done', 'done', 'graded it', `cadence:${MINING}:inspect`],
          'ffff0008-8888': ['done', 'done', 'nothing to do with loops'],
        },
      }),
    );
    expect(panel.feed.map((r) => r.card)).toEqual(['ffff0006-6666']);
    expect(panel.handRunCount).toBe(1);
  });

  it('never double-counts a card that already has a dispatch-ledger row', () => {
    const panel = buildLoopStatusPanel(
      tempRepo({
        rows: [{ cadence: HYGIENE, card: 'aaaa0001-1111', date: '2026-08-17' }],
        cards: { 'aaaa0001-1111': ['done', 'done', 'dispatched run', `cadence:${HYGIENE}`] },
      }),
    );
    expect(panel.feed).toHaveLength(1);
    expect(panel.feed[0].source).toBe('dispatch');
    expect(panel.handRunCount).toBe(0);
  });

  it('sorts an undated hand run ahead of dated dispatcher rows, so the ceremony is not buried', () => {
    const panel = buildLoopStatusPanel(
      tempRepo({
        rows: [{ cadence: MINING, card: 'bbbb0002-2222', date: '2026-08-18' }],
        cards: {
          'bbbb0002-2222': ['done', 'done', 'dispatched mining run'],
          'ffff0006-6666': ['working', 'working', 'hand run in flight', `cadence:${HYGIENE}`],
        },
      }),
    );
    expect(panel.feed.map((r) => r.source)).toEqual(['hand-run', 'dispatch']);
  });
});

describe('resultNarration()', () => {
  it('takes exactly the FIRST NON-EMPTY LINE of ## Result — the human narration U-L1 mandates', () => {
    expect(resultNarration('## Result\n\nSwept 3 stale branches.\n\n## Evidence\n\nsecret\n')).toBe(
      'Swept 3 stale branches.',
    );
    // The line is taken WHOLE and alone: whatever table/checklist/dump follows it is not spliced on.
    const withTable = '## Result\n\nSwept 3 stale branches.\n\n| branch | age |\n| --- | --- |\n| old | 90d |\n';
    expect(resultNarration(withTable)).toBe('Swept 3 stale branches.');
    // Leading blank lines are skipped rather than yielding an empty narration.
    expect(resultNarration('## Result\n\n\n   \nFirst real line.\nSecond line.\n')).toBe('First real line.');
    expect(resultNarration('## Result\n\nOnly line.\n\n## Evidence\n\nnope\n')).toBe('Only line.');
    expect(resultNarration('## Work order\n\nnothing\n')).toBeNull();
    expect(resultNarration('## Result\n\n   \n')).toBeNull();
    const long = resultNarration(`## Result\n\n${'x'.repeat(400)}\n`)!;
    expect(long).toHaveLength(201); // 200 chars + the ellipsis
    expect(long.endsWith('…')).toBe(true);
  });
});

describe('buildLoopStatusPanel() — honest emptiness', () => {
  it('an empty ledger yields NAMED empty rows for every declared loop — never a fabricated run', () => {
    const panel = buildLoopStatusPanel(tempRepo());
    expect(panel.loops.map((l) => l.cadence)).toEqual([HYGIENE, MINING, UPGRADE]);
    expect(panel.loops.every((l) => l.state === 'never-run')).toBe(true);
    expect(panel.loops.every((l) => l.lastRun === null)).toBe(true);
    expect(panel.loops.every((l) => l.runCount === 0)).toBe(true);
    // The DECLARED schedule is still reported for a loop that has never run.
    expect(panel.loops.map((l) => l.schedule)).toEqual(['daily', 'daily', 'weekly:sat']);
    expect(panel.feed).toEqual([]);
    expect(panel.ledgerRowCount).toBe(0);
    expect(panel.handRunCount).toBe(0);
    expect(panel.neverRun).toBe(true);
    // tempRepo()'s default declares all three loops — this is the "declared, no runs yet" world, not
    // the "still a draft" one, and the panel-level flag must say so.
    expect(panel.anyDeclared).toBe(true);
  });

  it('ignores dispatch rows for cadences that are not declared loops', () => {
    const panel = buildLoopStatusPanel(
      tempRepo({ rows: [{ cadence: 'nightly-review', card: 'aaaa0001-1111', date: '2026-08-17' }] }),
    );
    expect(panel.ledgerRowCount).toBe(0);
    expect(panel.feed).toEqual([]);
    expect(panel.neverRun).toBe(true);
  });
});

describe('buildLoopStatusPanel() — runs, outcomes and narration', () => {
  it('surfaces a done card’s ## Result as the run narration, and its state as the loop state', () => {
    const panel = buildLoopStatusPanel(
      tempRepo({
        rows: [{ cadence: HYGIENE, card: 'aaaa0001-1111', date: '2026-08-17' }],
        cards: { 'aaaa0001-1111': ['done', 'done', 'Swept 3 stale branches; 0 worktrees left behind.'] },
      }),
    );
    const hygiene = panel.loops.find((l) => l.cadence === HYGIENE)!;
    expect(hygiene.state).toBe('done');
    expect(hygiene.runCount).toBe(1);
    expect(hygiene.lastRun).toMatchObject({
      date: '2026-08-17',
      card: 'aaaa0001-1111',
      source: 'dispatch',
      outcome: 'done',
      cardFound: true,
      narration: 'Swept 3 stale branches; 0 worktrees left behind.',
    });
    expect(panel.feed).toHaveLength(1);
    expect(panel.neverRun).toBe(false);
  });

  it('orders the feed reverse-chronologically ACROSS loops and picks each loop’s newest run', () => {
    const panel = buildLoopStatusPanel(
      tempRepo({
        rows: [
          { cadence: HYGIENE, card: 'aaaa0001-1111', date: '2026-08-15' },
          { cadence: MINING, card: 'bbbb0002-2222', date: '2026-08-18' },
          { cadence: HYGIENE, card: 'cccc0003-3333', date: '2026-08-17' },
        ],
        cards: {
          'aaaa0001-1111': ['done', 'done', 'old hygiene run'],
          'bbbb0002-2222': ['working', 'working', 'mining in flight'],
          'cccc0003-3333': ['approvals', 'approvals', 'two lessons need your ruling'],
        },
      }),
    );
    expect(panel.feed.map((r) => r.date)).toEqual(['2026-08-18', '2026-08-17', '2026-08-15']);
    expect(panel.loops.find((l) => l.cadence === HYGIENE)!.lastRun!.card).toBe('cccc0003-3333');
    expect(panel.loops.find((l) => l.cadence === HYGIENE)!.state).toBe('approvals');
    expect(panel.loops.find((l) => l.cadence === HYGIENE)!.runCount).toBe(2);
    expect(panel.loops.find((l) => l.cadence === MINING)!.state).toBe('working');
    expect(panel.loops.find((l) => l.cadence === UPGRADE)!.state).toBe('never-run');
  });

  it('a run whose card is not in this checkout keeps the run but claims NO outcome', () => {
    // Live truth is on `ops`; a checkout can hold the ledger and not the card. That is `unknown`,
    // which must not collapse into `never-run` (the loop demonstrably ran).
    const panel = buildLoopStatusPanel(
      tempRepo({ rows: [{ cadence: MINING, card: 'dddd0004-4444', date: '2026-08-18' }] }),
    );
    const mining = panel.loops.find((l) => l.cadence === MINING)!;
    expect(mining.state).toBe('unknown');
    expect(mining.lastRun).toMatchObject({ cardFound: false, outcome: null, narration: null });
    expect(panel.neverRun).toBe(false);
  });

  it('an UNPARSEABLE card omits the row and fails closed — no crash, no guessed outcome', () => {
    const panel = buildLoopStatusPanel(
      tempRepo({
        rows: [{ cadence: HYGIENE, card: 'eeee0005-5555', date: '2026-08-18' }],
        brokenCards: { 'eeee0005-5555': 'done' },
      }),
    );
    expect(panel.rejectedRuns).toBe(1);
    expect(panel.feed).toEqual([]);
    expect(panel.loops.find((l) => l.cadence === HYGIENE)!.state).toBe('never-run');
    expect(panel.loops.find((l) => l.cadence === HYGIENE)!.lastRun).toBeNull();
    // …and the dropped row is still COUNTED, so "nothing to show" is distinguishable from "no data".
    expect(panel.ledgerRowCount).toBe(1);
  });
});

describe('buildLoopStatusPanel() — the pause sentinel', () => {
  it('`queue/paused/<name>` reports paused, and only for that loop', () => {
    const root = tempRepo({
      rows: [{ cadence: HYGIENE, card: 'aaaa0001-1111', date: '2026-08-17' }],
      cards: { 'aaaa0001-1111': ['done', 'done', 'swept'] },
      paused: [HYGIENE],
    });
    expect(isPaused(root, HYGIENE)).toBe(true);
    expect(isPaused(root, MINING)).toBe(false);
    const panel = buildLoopStatusPanel(root);
    const hygiene = panel.loops.find((l) => l.cadence === HYGIENE)!;
    expect(hygiene.paused).toBe(true);
    expect(hygiene.state).toBe('paused');
    // The track record is still shown honestly — only the STATE is forced.
    expect(hygiene.lastRun!.narration).toBe('swept');
    expect(panel.loops.find((l) => l.cadence === MINING)!.state).toBe('never-run');
  });
});

describe('READ-ONLY acceptance', () => {
  it('writes nothing: no fs write call, and the dispatch shard mtime is unchanged', async () => {
    const root = tempRepo({
      rows: [
        { cadence: HYGIENE, card: 'aaaa0001-1111', date: '2026-08-17' },
        { cadence: MINING, card: 'bbbb0002-2222', date: '2026-08-18' },
      ],
      cards: {
        'aaaa0001-1111': ['done', 'done', 'swept 3 branches'],
        'bbbb0002-2222': ['approvals', 'approvals', 'two lessons need your ruling'],
      },
      paused: [UPGRADE],
    });
    const shard = join(root, 'ledgers', 'dispatch', 'dispatcher-2026-08-18.tsv');
    const before = statSync(shard).mtimeMs;

    const app = Fastify({ logger: false });
    registerPanels(app, root);
    await app.ready();

    tripwire.armed = true;
    try {
      const panel = buildLoopStatusPanel(root);
      expect(panel.feed).toHaveLength(2);
      expect(panel.loops.find((l) => l.cadence === UPGRADE)!.state).toBe('paused');

      const res = await app.inject({ method: 'GET', url: '/api/panels/loop-status' });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { feed: { card: string }[] }).feed[0].card).toBe('bbbb0002-2222');
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

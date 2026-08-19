/**
 * Wave-1 U5 — the autonomy-ladder panel projection. READ-ONLY, in the strongest sense: this suite's
 * headline test (`writes nothing`) spies on every fs write entry point AND snapshots the grade shard's
 * mtime around a full build + route call, because the whole point of the panel is that autonomy is
 * *recomputed and displayed*, never stored or promoted from the UI.
 *
 * The rest of the suite pins PORT PARITY with `scripts/promotion.py`: the fixtures below are the exact
 * cases from `tests/test_promotion.py::test_status_bar_floor_window`, re-expressed here, so a drift in
 * either implementation reds a test rather than silently disagreeing with the python that actually
 * gates dispatch.
 */
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import {
  status,
  isFrozen,
  readTrustedGrades,
  buildAutonomyLadderPanel,
  EphemeralNamingRegistry,
  EVAL_WORKER,
  TIERS,
  type GradeRow,
} from './autonomyLadder.ts';
import { registerPanels } from './routes.ts';

/**
 * The write tripwire. `node:fs`'s ESM namespace is not configurable, so `vi.spyOn(fs, 'writeFileSync')`
 * cannot be used (vitest: "Module namespace is not configurable in ESM"); the modules are mocked
 * instead, with every WRITE / process-spawn entry point wrapped in a guard that records the call and
 * throws once `armed`. Reads (and the fixture builder's own writes, made while disarmed) delegate to
 * the real implementation.
 *
 * The guarded surface is deliberately wider than what this module imports, because the guarantee under
 * test covers the whole CALL GRAPH — `indexRepo` / `buildRoster` and anything they reach. That is not
 * hypothetical: `NamingRegistry.shortRef` persists an ordinal through `mkdirSync` + `openSync` +
 * `writeFileSync`, so the roster's `displayFor` call WOULD write here if the ladder did not inject a
 * no-persist registry. The fixture below carries `agents/` and `queue/` content precisely so that path
 * is exercised rather than skipped.
 */
const tripwire = vi.hoisted(() => ({ armed: false, calls: [] as string[] }));

const guardFactory = vi.hoisted(() => (name: string, fn: unknown): unknown =>
  (...args: unknown[]) => {
    if (tripwire.armed) {
      tripwire.calls.push(name);
      throw new Error(`READ-ONLY violation: the autonomy ladder call graph reached ${name}`);
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

/** A write can also be laundered through a subprocess (`git`, `python scripts/trust.py`, …). Nothing
 *  in the ladder's graph may spawn one — `scripts/trust.py` is a WRITER and must never be invoked. */
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

const A = 'autonomous';
const Q = 'queues-for-me';

/** One grade row, shaped exactly like a `ledgers/grades/*.tsv` row (all cells are strings there). */
function grow(over: Partial<Record<string, unknown>> = {}): GradeRow {
  return {
    ts: '000',
    worker: 'w',
    project: 'p',
    task_type: 'tt',
    tier: 'T1',
    score: '95',
    pass: 'true',
    inspector_id: 'inspector@agents.local',
    ...over,
  };
}

/** `tests/test_promotion.py::_rows` — N rows for one tier with the given scores, ts-ordered. */
function rows(tier: string, scores: number[], worker = 'w'): GradeRow[] {
  return scores.map((s, i) =>
    grow({ tier, score: String(s), pass: 'true', worker, ts: String(i).padStart(3, '0') }),
  );
}

const GRADES_HEADER = 'ts\tworker\tproject\ttask_type\ttier\tscore\tpass\tinspector_id';

function toTsv(rs: GradeRow[]): string {
  const body = rs
    .map((r) =>
      [r.ts, r.worker, r.project, r.task_type, r.tier, r.score, r.pass, r.inspector_id]
        .map((v) => String(v ?? ''))
        .join('\t'),
    )
    .join('\n');
  return `${GRADES_HEADER}\n${body}\n`;
}

interface RepoOpts {
  grades?: GradeRow[];
  /** Written verbatim to `governance/graders.yaml`; omitted ⇒ no file at all (trust-anchor absent). */
  graders?: string;
  frozen?: boolean;
  /** `agents/<id>.md` declarations: id → `autonomy-tier` value. */
  declared?: Record<string, string>;
  /** Drop a schema-valid queue card in, so the card projection's `displayFor` path runs too. */
  card?: boolean;
}

function tempRepo(opts: RepoOpts = {}): string {
  const root = mkdtempSync(join(tmpdir(), 'ladder-repo-'));
  mkdirSync(join(root, 'ledgers', 'grades'), { recursive: true });
  mkdirSync(join(root, 'governance'), { recursive: true });
  if (opts.grades && opts.grades.length > 0) {
    writeFileSync(join(root, 'ledgers', 'grades', 'inspector-2026-08-18.tsv'), toTsv(opts.grades));
  }
  if (opts.graders !== undefined) writeFileSync(join(root, 'governance', 'graders.yaml'), opts.graders);
  if (opts.frozen) writeFileSync(join(root, 'ledgers', 'grades', 'FROZEN'), 'frozen by a human\n');
  if (opts.declared) {
    mkdirSync(join(root, 'agents'), { recursive: true });
    for (const [id, tier] of Object.entries(opts.declared)) {
      writeFileSync(
        join(root, 'agents', `${id}.md`),
        `---\nid: ${id}\nrole: work\nautonomy-tier: ${tier}\n---\n\nDo the thing.\n`,
      );
    }
  }
  if (opts.card) {
    mkdirSync(join(root, 'queue', 'inbox'), { recursive: true });
    writeFileSync(join(root, 'queue', 'inbox', 'card-inbox.md'), CARD);
  }
  return root;
}

/** A schema-valid queue card — its presence makes `indexRepo` project a card, i.e. call `displayFor`. */
const CARD = `---
id: aaaa0001-1111
project: kb
action: cadence:demo-inbox
target: .
risk-tier: T1
owner: null
claim-token: null
state: inbox
approval: null
workflow: null
depends-on: []
variant-group: null
role: work
---

## Work order

Demo card in state inbox.

## Result

(pending)
`;

const REAL_GRADERS = 'graders:\n  - id: inspector@agents.local\n';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('status() — port parity with scripts/promotion.py', () => {
  it('T1 (window 10, bar 90, floor 80): window size, in-window bar, floor reset', () => {
    // Exact fixtures from tests/test_promotion.py::test_status_bar_floor_window.
    expect(status('w', 'p', 'tt', 'T1', rows('T1', Array(10).fill(95)), false)).toBe(A);
    expect(status('w', 'p', 'tt', 'T1', rows('T1', Array(9).fill(95)), false)).toBe(Q);
    // 85 is above the floor but below the bar, and sits inside the last window → blocks (no reset).
    expect(status('w', 'p', 'tt', 'T1', rows('T1', [...Array(9).fill(95), 85]), false)).toBe(Q);
    // 75 is BELOW FLOOR → resets the streak; only 9 clean runs follow → not enough.
    expect(status('w', 'p', 'tt', 'T1', rows('T1', [...Array(5).fill(95), 75, ...Array(9).fill(95)]), false)).toBe(Q);
    // …but 10 clean runs after the reset → autonomous again.
    expect(status('w', 'p', 'tt', 'T1', rows('T1', [...Array(5).fill(95), 75, ...Array(10).fill(95)]), false)).toBe(A);
  });

  it('T2 (window 20, bar 95, floor 90) and T3 (window 40, bar 98, floor = any failure)', () => {
    expect(status('w', 'p', 'tt', 'T2', rows('T2', Array(20).fill(97)), false)).toBe(A);
    expect(status('w', 'p', 'tt', 'T2', rows('T2', Array(19).fill(97)), false)).toBe(Q);
    expect(status('w', 'p', 'tt', 'T2', rows('T2', [...Array(19).fill(97), 93]), false)).toBe(Q);

    expect(status('w', 'p', 'tt', 'T3', rows('T3', Array(40).fill(99)), false)).toBe(A);
    expect(status('w', 'p', 'tt', 'T3', rows('T3', Array(39).fill(99)), false)).toBe(Q);
    const t3 = rows('T3', Array(40).fill(99));
    t3[0].pass = 'false'; // one failure resets, however high the score
    expect(status('w', 'p', 'tt', 'T3', t3, false)).toBe(Q);
  });

  it('fails closed: foreign keys, frozen fleet, unknown tier', () => {
    expect(status('w', 'p', 'tt', 'T1', rows('T1', Array(10).fill(95), 'other'), false)).toBe(Q);
    expect(status('w', 'p', 'tt', 'T1', rows('T1', Array(10).fill(95)), true)).toBe(Q);
    const unknown = rows('T9', Array(10).fill(95));
    expect(status('w', 'p', 'tt', 'T9', unknown, false)).toBe(Q);
  });
});

describe('TIERS — constant parity with scripts/promotion.py', () => {
  it('matches the `_TIERS` literal in the python source, field for field', () => {
    // The fixture-based parity tests above cannot see a constant change that moves BOTH sides of a
    // threshold consistently; this reads the authority's source and compares the numbers directly.
    const py = readFileSync(fileURLToPath(new URL('../../../scripts/promotion.py', import.meta.url)), 'utf-8');
    const block = /_TIERS = \{([\s\S]*?)\n\}/.exec(py);
    expect(block, 'the `_TIERS = { … }` block moved or was renamed in scripts/promotion.py').not.toBeNull();

    const parsed: Record<string, { window: number; bar: number; floor: number | null; floorKind: string }> = {};
    const entry = /"(T\d)":\s*\{"window":\s*(\d+),\s*"bar":\s*(\d+),\s*"floor":\s*(\d+|None),\s*"floor_kind":\s*"(\w+)"\}/g;
    for (const m of block![1].matchAll(entry)) {
      parsed[m[1]] = {
        window: Number(m[2]),
        bar: Number(m[3]),
        floor: m[4] === 'None' ? null : Number(m[4]),
        floorKind: m[5],
      };
    }
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(TIERS).sort());
    expect(parsed).toEqual(TIERS);
  });
});

describe('readTrustedGrades() — the grader trust anchor', () => {
  it('returns [] when governance/graders.yaml is absent (fail closed)', () => {
    const root = tempRepo({ grades: rows('T1', Array(10).fill(95)) });
    expect(readTrustedGrades(root)).toEqual([]);
  });

  it('keeps only rows whose inspector_id is allow-listed', () => {
    const trusted = rows('T1', Array(3).fill(95));
    const untrusted = rows('T1', Array(2).fill(95)).map((r) => ({ ...r, inspector_id: 'rogue@agents.local' }));
    const root = tempRepo({ grades: [...trusted, ...untrusted], graders: REAL_GRADERS });
    const kept = readTrustedGrades(root);
    expect(kept).toHaveLength(3);
    expect(kept.every((r) => r.inspector_id === 'inspector@agents.local')).toBe(true);
  });

  it('excludes reserved eval-suite rows from the ladder promotion input', () => {
    const real = rows('T1', Array(3).fill(95));
    const evalRows = rows('T1', Array(10).fill(95), 'eval-suite').map((r) => ({
      ...r,
      task_type: 'eval:demo-agent:smoke',
    }));
    const root = tempRepo({ grades: [...real, ...evalRows], graders: REAL_GRADERS });

    expect(status(EVAL_WORKER, 'p', 'eval:demo-agent:smoke', 'T1', evalRows, false)).toBe(Q);
    expect(readTrustedGrades(root)).toEqual(real);
    const panel = buildAutonomyLadderPanel(root);
    expect(panel.gradeRowCount).toBe(3);
    expect(panel.ledgerRowCount).toBe(13);
    expect(panel.keys.every((key) => key.worker !== 'eval-suite')).toBe(true);
    expect(panel.keys.every((key) => !key.taskType.startsWith('eval:'))).toBe(true);
  });
});

describe('buildAutonomyLadderPanel()', () => {
  it('an absent trust anchor yields NO earned verdicts at all (every key untrusted)', () => {
    const root = tempRepo({ grades: rows('T1', Array(10).fill(95)) });
    const panel = buildAutonomyLadderPanel(root);
    expect(panel.keys).toEqual([]);
    expect(panel.trustedGraderCount).toBe(0);
    expect(panel.workers.every((w) => w.earned.length === 0)).toBe(true);
    // "rows exist but nobody is trusted" must be distinguishable from "the ledger is empty".
    expect(panel.gradeRowCount).toBe(0);
    expect(panel.ledgerRowCount).toBe(10);
  });

  it('counts untrusted rows separately, so an empty ledger never looks like a trust-anchor failure', () => {
    const untrusted = rows('T1', Array(4).fill(95)).map((r) => ({ ...r, inspector_id: 'rogue@agents.local' }));
    const withRows = buildAutonomyLadderPanel(tempRepo({ grades: untrusted, graders: REAL_GRADERS }));
    expect(withRows.ledgerRowCount).toBe(4);
    expect(withRows.gradeRowCount).toBe(0);

    const bare = buildAutonomyLadderPanel(tempRepo({ graders: REAL_GRADERS }));
    expect(bare.ledgerRowCount).toBe(0);
    expect(bare.gradeRowCount).toBe(0);
  });

  it('hands out short-refs in memory: the ephemeral naming registry is stable and never persists', () => {
    const naming = new EphemeralNamingRegistry();
    expect(naming.shortRef('agent', 'codex-a')).toBe(1);
    expect(naming.shortRef('agent', 'claude-m1')).toBe(2);
    expect(naming.shortRef('agent', 'codex-a')).toBe(1); // stable within a request
    expect(naming.shortRef('card', 'aaaa0001-1111')).toBe(1); // ordinals are per-kind
    // `displayFor` is INHERITED unchanged — same title/fallback contract as the persisted registry.
    expect(naming.displayFor('agent', 'codex-a', 'codex-a')).toEqual({ displayName: 'codex-a', shortRef: 1 });
    expect(naming.displayFor('agent', 'codex-a').displayName).toBe('agent codex-a'); // no title ⇒ fallback
  });

  it('computes the earned verdict + track record per (worker, project, task_type, tier) key', () => {
    const root = tempRepo({ grades: rows('T1', Array(10).fill(95)), graders: REAL_GRADERS });
    const panel = buildAutonomyLadderPanel(root);
    expect(panel.keys).toHaveLength(1);
    const key = panel.keys[0];
    expect(key).toMatchObject({
      worker: 'w',
      project: 'p',
      taskType: 'tt',
      tier: 'T1',
      verdict: A,
      runs: 10,
      passes: 10,
      streak: 10,
      floorStatus: 'ok',
      demote: false,
    });
    expect(key.passRate).toBe(1);
    expect(panel.frozen).toBe(false);
  });

  it('a below-floor latest run demotes and shows a broken streak', () => {
    const root = tempRepo({
      grades: rows('T1', [...Array(10).fill(95), 75]),
      graders: REAL_GRADERS,
    });
    const key = buildAutonomyLadderPanel(root).keys[0];
    expect(key.verdict).toBe(Q);
    expect(key.streak).toBe(0);
    expect(key.demote).toBe(true);
    expect(key.floorStatus).toBe('below-floor');
  });

  it('FROZEN forces every verdict to queues-for-me despite a clean, passing window', () => {
    const root = tempRepo({ grades: rows('T1', Array(10).fill(95)), graders: REAL_GRADERS, frozen: true });
    expect(isFrozen(root)).toBe(true);
    const panel = buildAutonomyLadderPanel(root);
    expect(panel.frozen).toBe(true);
    expect(panel.keys.map((k) => k.verdict)).toEqual([Q]);
    // The track record is still shown honestly — only the VERDICT is forced.
    expect(panel.keys[0].streak).toBe(10);
  });

  it('keeps the DECLARED ceiling structurally separate from the EARNED verdicts', () => {
    const root = tempRepo({ declared: { 'ladder-architect': 'T2' }, graders: REAL_GRADERS });
    const panel = buildAutonomyLadderPanel(root);
    const worker = panel.workers.find((w) => w.worker === 'ladder-architect')!;
    expect(worker.declaredCeiling).toBe('T2'); // advisory, from agents/<id>.md
    expect(worker.earned).toEqual([]); // fact: zero graded runs ⇒ nothing earned
    // The two must never be merged into one field.
    expect(Object.keys(worker)).toEqual(expect.arrayContaining(['declaredCeiling', 'earned']));
  });

  it('is empty-safe: the live repo shape (grades dir holding only .gitkeep) reads as "no data"', () => {
    const root = tempRepo({ graders: REAL_GRADERS });
    writeFileSync(join(root, 'ledgers', 'grades', '.gitkeep'), '');
    const panel = buildAutonomyLadderPanel(root);
    expect(panel.gradeRowCount).toBe(0);
    expect(panel.keys).toEqual([]);
    expect(panel.workers.every((w) => w.earned.length === 0)).toBe(true);
  });
});

describe('READ-ONLY acceptance', () => {
  it('writes nothing: no fs write call, and the grade shard mtime is unchanged', async () => {
    // The fixture carries agents/ AND a queue card, so both `displayFor` paths (agent + card) run —
    // this is the exact shape that made the naming registry persist an ordinal before the fix.
    const root = tempRepo({
      grades: rows('T1', Array(10).fill(95)),
      graders: REAL_GRADERS,
      declared: { 'codex-a': 'T1', 'ladder-architect': 'T2' },
      card: true,
    });
    const shard = join(root, 'ledgers', 'grades', 'inspector-2026-08-18.tsv');
    const before = statSync(shard).mtimeMs;

    const app = Fastify({ logger: false });
    registerPanels(app, root);
    await app.ready();

    tripwire.armed = true;
    try {
      // Both entry points: the pure builder and the HTTP route the panel actually calls.
      const panel = buildAutonomyLadderPanel(root);
      expect(panel.keys[0].verdict).toBe(A);

      // The declared agents and the queue card ARE seen — i.e. `displayFor` really ran on this path.
      expect(panel.workers.map((w) => w.worker)).toContain('ladder-architect');

      const res = await app.inject({ method: 'GET', url: '/api/panels/autonomy-ladder' });
      expect(res.statusCode).toBe(200);
      expect((res.json() as { keys: { verdict: string }[] }).keys[0].verdict).toBe(A);
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

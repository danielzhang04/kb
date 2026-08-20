/**
 * Wave-1 U-L2 — the loop-status panel: for each self-improving loop, when it last ran, what came out,
 * and what schedule it DECLARES — recomputed from the dispatch ledger and the queue on every read.
 *
 * ── READ-ONLY, whole call graph ──────────────────────────────────────────────────────────────────
 * Same discipline (and the same tripwire test) as `panels/autonomyLadder.ts`: this module imports only
 * read entry points from `node:fs` (`existsSync`, `readdirSync`, `readFileSync`), never a write one,
 * and it spawns no subprocess — so `scripts/dispatch.py` (a WRITER: it emits cards and appends ledger
 * rows) is never invoked, only its data is read. It also needs NO naming registry, which is the other
 * way the ladder could have written to disk (`NamingRegistry.shortRef` persists an ordinal): nothing
 * here renders a short-ref, so no registry is constructed at all.
 *
 * ── The scheduler is NOT reimplemented here ──────────────────────────────────────────────────────
 * `scripts/dispatch.py::due()` is the ONE scheduler. This panel reports the schedule each loop
 * DECLARES, verbatim, as a string carried in {@link LOOP_CADENCES} — it never computes "due today",
 * "next run", or "overdue". A second implementation of `due()` would be a second answer to a question
 * the fleet already acts on, and the two would drift silently. If you want to know whether a loop is
 * due, ask the dispatcher; this panel tells you what was DECLARED and what actually HAPPENED.
 *
 * What IS read from HEARTBEAT.md is the set of cadence NAMES, and nothing else — see
 * {@link declaredCadences}. A loop whose name is absent is still a DRAFT: the dispatcher cannot beat
 * it, so the panel must not print "declared schedule: daily" beside it.
 *
 * The one piece of dispatch.py logic that IS mirrored is the PAUSE SENTINEL (dispatch.py:487-491): a
 * files-only `queue/paused/<cadence-name>` marker suppresses that cadence's beat. It is a presence
 * check — the marker's contents are never read — and it can only ever SKIP a loop, never trigger one,
 * so mirroring it cannot widen anything.
 *
 * ── Live truth lives on `ops` ────────────────────────────────────────────────────────────────────
 * `ledgers/dispatch/**` and `queue/**` are coordination writes: the authoritative copies are on the
 * `ops` branch, and any given checkout may hold stale or empty ones. The route reads whatever the
 * configured `repoRoot` holds and this module renders it honestly — a loop that has never run in THIS
 * checkout reports `never-run`, and a ledger row whose card is not in this checkout keeps the run with
 * a null outcome rather than inventing one. Nothing is fabricated to fill a gap.
 *
 * ── Two sources of runs, because the ledger is not all of them ───────────────────────────────────
 * Dispatched runs leave a `ledgers/dispatch/**` row. HAND RUNS — a human running the loop to prove it
 * works before its cadence is armed — leave only a queue card, so they are found by matching the
 * card's `action` (see {@link readHandRuns}). Without that second source this panel would be dark for
 * the whole arming ceremony, which is the one stretch someone is actually watching it.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { readKindRows } from '../planeA/ledgers.ts';
import { CARD_QUEUE_DIRS, parseCardFrontmatter } from '../planeA/cards.ts';

/** One declared loop: the cadence name the dispatcher writes to the ledger, plus how to say it and
 *  what it declares. */
export interface LoopCadence {
  /** The `name:` in HEARTBEAT.md — the exact token in the dispatch ledger's `cadence` column. */
  cadence: string;
  /** Plain words for a human ("Hygiene loop"), never the slug. */
  label: string;
  /**
   * The DECLARED `schedule:` string, verbatim from HEARTBEAT.md (`daily`, `weekly:sat`, …).
   * Reported as text; never parsed into a due-date here (see the header note on the one scheduler).
   */
  schedule: string;
}

/**
 * The self-improving loops this panel surfaces. Adding a fourth loop is ONE array entry — no other
 * edit in this file, in the route, or in the panel.
 *
 * These names must match the `name:` of the corresponding HEARTBEAT.md cadence exactly; a typo shows
 * up as a loop that has honestly "never run" rather than as a crash, which is the fail-closed answer
 * (the panel would rather say nothing happened than attribute someone else's run to this loop).
 */
export const LOOP_CADENCES: readonly LoopCadence[] = [
  { cadence: 'loop-a-hygiene', label: 'Hygiene loop', schedule: 'daily' },
  { cadence: 'loop-b-lesson-mining', label: 'Lesson-mining loop', schedule: 'daily' },
  { cadence: 'loop-c-agent-upgrade', label: 'Agent-upgrade loop', schedule: 'weekly:sat' },
];

/**
 * A loop's current state.
 *
 * `not-declared`, `paused` and `never-run` are states of the LOOP; every other member is the card
 * `state` of its most recent run, passed through unchanged (the seven states in
 * governance/card-schema.md). `unknown` is the honest answer when a run exists in the ledger but its
 * card is not in this checkout — NOT folded into `never-run`, which would claim the loop never ran.
 *
 * `not-declared` OUTRANKS everything: a loop whose cadence block is not in any HEARTBEAT.md cannot be
 * beaten by the dispatcher at all, whatever a sentinel or a hand-run card says, and the panel must not
 * quote a "declared schedule" for a schedule nobody has declared yet. Its runs are still surfaced —
 * that is exactly the arming ceremony's stage ① — they just do not make the loop live.
 */
export type LoopState =
  | 'not-declared'
  | 'paused'
  | 'never-run'
  | 'unknown'
  | 'inbox'
  | 'blocked'
  | 'working'
  | 'done'
  | 'approvals'
  | 'approved'
  | 'rejected';

/** The card states this panel is willing to pass through as a loop state. Anything else a card
 *  declares is reported as `unknown` rather than echoed into the UI's chip vocabulary. */
const CARD_STATE_VALUES = new Set<string>([
  'inbox',
  'blocked',
  'working',
  'done',
  'approvals',
  'approved',
  'rejected',
]);

/** How a run was found. A HAND RUN has no dispatch-ledger row at all — see {@link readHandRuns}. */
type LoopRunSource = 'dispatch' | 'hand-run';

/** One recorded run of one loop — a dispatch-ledger row joined to its queue card, or a hand-run card
 *  found by its `action` with no ledger row behind it. */
export interface LoopRun {
  /** The cadence name, i.e. which loop ran. */
  cadence: string;
  /** Plain-words loop name, carried so the feed needs no second lookup. */
  label: string;
  /** `YYYY-MM-DD` from the ledger row, or `''` for a hand run (cards carry no date field). */
  date: string;
  /** The emitted card's id. */
  card: string;
  /** The ledger row's `project` cell, or the card's `project` for a hand run. */
  project: string;
  /** Whether the dispatcher recorded this run, or a human ran it by hand. */
  source: LoopRunSource;
  /** The card's frontmatter `state`, or null when the card is not in this checkout. */
  outcome: string | null;
  /** First ~200 chars of the card's `## Result`, or null when there is no card / no Result text. */
  narration: string | null;
  /** Whether the card file was found and parsed at all. */
  cardFound: boolean;
}

/** One loop's status strip. */
export interface LoopRow {
  cadence: string;
  label: string;
  /** The schedule string, verbatim. Not evaluated. While `declared` is false this is the DRAFT's
   *  proposal, not a declaration — the panel must word it as such. */
  schedule: string;
  /** A cadence block with this name exists in a HEARTBEAT.md under `repoRoot`. False ⇒ the loop is
   *  still a draft and the dispatcher cannot beat it, whatever `schedule` proposes. */
  declared: boolean;
  /** `queue/paused/<cadence>` exists — the dispatcher will skip this loop's beat. */
  paused: boolean;
  state: LoopState;
  /** The most recent recorded run, or null when there is none. */
  lastRun: LoopRun | null;
  /** How many runs of this loop the ledger records (parseable ones only). */
  runCount: number;
}

export interface LoopStatusPanel {
  label: 'loop-status';
  loops: LoopRow[];
  /** Every run across every declared loop, most recent first — the narration feed. */
  feed: LoopRun[];
  /** Dispatch-ledger rows naming one of these loops, BEFORE any card join. `ledgerRowCount > 0` with
   *  an empty `feed` means every one of them was dropped, which is a different situation from "the
   *  ledger is empty" and the panel says which it is looking at. */
  ledgerRowCount: number;
  /** Runs found by card `action` with no ledger row behind them — the arming ceremony's hand runs. */
  handRunCount: number;
  /** Runs dropped because their card exists but could not be parsed (fail closed — an unparseable
   *  card yields no row rather than a row with a guessed outcome). */
  rejectedRuns: number;
  /** No declared loop has any recorded run at all. */
  neverRun: boolean;
  /** At least one loop's cadence block actually exists in a HEARTBEAT.md (see {@link declaredCadences}).
   *  Gates the empty-feed wording: an armed loop that simply has not run yet is never told apart from a
   *  loop that cannot run at all, so the panel must not call an armed-but-unbeaten loop a "draft awaiting
   *  arming" — that sentence is true only while EVERY loop is still undeclared. */
  anyDeclared: boolean;
}

/** How much narration the feed carries. It is a glance, not the card. */
const NARRATION_CHARS = 200;

/**
 * The FIRST NON-EMPTY LINE of a card's `## Result` section, truncated at {@link NARRATION_CHARS}.
 *
 * U-L1 mandates that a loop's `## Result` opens with a one-line human narration — a sentence a person
 * can read without opening the card. So the panel takes exactly that line rather than the first 200
 * characters of the collapsed section, which would have spliced the narration into whatever table,
 * checklist or evidence dump follows it and shown a sentence nobody wrote.
 *
 * SECURITY: this is worker-authored prose and it is treated as INERT DATA — sliced and rendered as
 * text, never parsed, never interpreted as an instruction. Same posture the card parser takes with
 * `## Evidence`.
 */
export function resultNarration(body: string): string | null {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((l) => /^##\s+Result\s*$/i.test(l.trim()));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^##\s/.test(l));
  const section = end === -1 ? rest : rest.slice(0, end);
  const first = section.map((l) => l.trim()).find((l) => l !== '');
  if (first === undefined) return null;
  return first.length > NARRATION_CHARS ? `${first.slice(0, NARRATION_CHARS)}…` : first;
}

/**
 * `scripts/dispatch.py:23` — cadences are declared inside a ```yaml fence in a HEARTBEAT.md.
 *
 * Deliberately NOT global: only the FIRST ```yaml fence in a file is read. A HEARTBEAT.md with a
 * second fenced block (e.g. an example in prose below the real one) would have its names missed —
 * that errs CLOSED, the same posture as the rest of this function: a cadence this scan cannot see is
 * reported as undeclared, never conjured from a fence this scan was never meant to trust.
 */
const HEARTBEAT_FENCE = /```yaml\s*\n([\s\S]*?)\n```/;

/** A `- name: <value>` item inside that fence. */
const CADENCE_NAME = /^\s*-\s+name:\s*(.+?)\s*$/gm;

/**
 * Every cadence NAME declared in this checkout's HEARTBEAT.md files (root + `orgs/<project>/`), which
 * is the same set of files `scripts/dispatch.py::_heartbeats` walks.
 *
 * This is a NAME-EXISTENCE check and nothing more: it deliberately does not read `schedule`, `tier`,
 * `agent`, or anything else, and it does NOT reimplement `due()`. The only question it answers is
 * "has a human actually declared this cadence, or is it still a draft in a proposal doc?" — because
 * printing "declared schedule: daily" for a loop nobody has declared is a false statement about the
 * fleet, and it is exactly the statement an operator would act on during the arming ceremony.
 *
 * Unreadable/absent files contribute nothing, so the fail-closed answer is "not declared".
 */
export function declaredCadences(repoRoot: string): Set<string> {
  const out = new Set<string>();
  const paths = [join(repoRoot, 'HEARTBEAT.md')];
  const orgs = join(repoRoot, 'orgs');
  if (existsSync(orgs)) {
    let names: string[] = [];
    try {
      names = readdirSync(orgs);
    } catch {
      names = [];
    }
    for (const name of names) {
      if (name.startsWith('_')) continue;
      paths.push(join(orgs, name, 'HEARTBEAT.md'));
    }
  }
  for (const path of paths) {
    if (!existsSync(path)) continue;
    let text: string;
    try {
      text = readFileSync(path, 'utf-8');
    } catch {
      continue;
    }
    const fenced = HEARTBEAT_FENCE.exec(text);
    if (!fenced) continue;
    for (const m of fenced[1].matchAll(CADENCE_NAME)) {
      const value = m[1].replace(/^["']|["']$/g, '').trim();
      if (value !== '') out.add(value);
    }
  }
  return out;
}

/** What a card contributed to a run, or null when it could not be read/parsed. */
interface CardFacts {
  state: string;
  narration: string | null;
}

/**
 * Find `queue/<dir>/<id>.md` across the four physical queue dirs and read its frontmatter `state` plus
 * its `## Result` text, through the SHARED card reader (`planeA/cards.ts`) the roster and the Atlas
 * panel already use — no second frontmatter parser.
 *
 * Three outcomes, kept apart on purpose:
 *   • the card is absent      → `undefined` (not in this checkout; the run is still real)
 *   • the card is unparseable → `null`      (fail closed; the run is dropped by the caller)
 *   • the card parses         → its facts
 */
function readCardFacts(repoRoot: string, id: string): CardFacts | null | undefined {
  if (id === '' || id.includes('/') || id.includes('\\') || id.includes('..')) return undefined;
  for (const dirName of CARD_QUEUE_DIRS) {
    const path = join(repoRoot, 'queue', dirName, `${id}.md`);
    if (!existsSync(path)) continue;
    try {
      const parsed = parseCardFrontmatter(readFileSync(path, 'utf-8'));
      return {
        state: typeof parsed.meta.state === 'string' ? parsed.meta.state : '',
        narration: resultNarration(parsed.body),
      };
    } catch {
      // Unparseable: no state can be trusted off this card, so the caller drops the run entirely.
      return null;
    }
  }
  return undefined;
}

/**
 * The two `action` spellings that identify a card as a run of `cadence`.
 *
 * `scripts/dispatch.py:587` writes `action: cadence:<name>` for every card it emits, and that is the
 * canonical shape (governance/card-schema.md: `action` is a verb phrase set only by the Manager or
 * dispatcher). The bare `<name>` is accepted too, because a HAND-RUN card is written by a human during
 * the arming ceremony and the bare form is the one they reach for.
 *
 * The inspect sibling (`cadence:<name>:inspect`, dispatch.py:657) is deliberately NOT matched: it is a
 * grading card ABOUT a run, not a run, and counting it would double every dispatched beat.
 */
function actionMatchesCadence(action: unknown, cadence: string): boolean {
  if (typeof action !== 'string') return false;
  const a = action.trim();
  return a === cadence || a === `cadence:${cadence}`;
}

/**
 * HAND RUNS — loop runs that exist as a queue card with no dispatch-ledger row behind them.
 *
 * This is not an edge case, it is stage ① of the arming ceremony: a human runs the loop by hand to
 * prove it works BEFORE its cadence is declared, so `scripts/dispatch.py` never sees it and never
 * writes a ledger row. A ledger-only panel would sit dark through the entire ceremony — precisely the
 * window in which someone is watching it to decide whether to arm the loop.
 *
 * So the queue is scanned by `action` as well. Cards already accounted for by a ledger row are skipped
 * (`seen`), so a dispatched run is never double-counted as a hand run. An unparseable card here is
 * skipped silently and NOT counted as a rejected run: this scan reads every card in the queue, most of
 * which have nothing to do with any loop, so a corrupt unrelated card is not this panel's news.
 *
 * COST NOTE: this reads and parses every `.md` file across every `CARD_QUEUE_DIRS` directory on every
 * panel read — O(queue size), not O(loop runs) — because there is no cheaper index from card `action`
 * back to "is this a loop card". Fine at today's queue sizes; worth an index if the queue ever grows
 * large enough for this scan to show up in the panel's read latency.
 */
function readHandRuns(
  repoRoot: string,
  declared: Map<string, LoopCadence>,
  seen: Set<string>,
): LoopRun[] {
  const out: LoopRun[] = [];
  for (const dirName of CARD_QUEUE_DIRS) {
    const dir = join(repoRoot, 'queue', dirName);
    if (!existsSync(dir)) continue;
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!name.endsWith('.md')) continue;
      let parsed;
      try {
        parsed = parseCardFrontmatter(readFileSync(join(dir, name), 'utf-8'));
      } catch {
        continue; // unrelated corrupt card — not evidence about any loop
      }
      const id = typeof parsed.meta.id === 'string' ? parsed.meta.id : '';
      if (id === '' || seen.has(id)) continue;
      const loop = [...declared.values()].find((l) => actionMatchesCadence(parsed.meta.action, l.cadence));
      if (!loop) continue;
      seen.add(id);
      const project = parsed.meta.project;
      out.push({
        cadence: loop.cadence,
        label: loop.label,
        date: '', // cards carry no date field; a hand run is honestly undated
        card: id,
        project: Array.isArray(project) ? project.join(', ') : String(project ?? ''),
        source: 'hand-run',
        outcome: typeof parsed.meta.state === 'string' ? parsed.meta.state : '',
        narration: resultNarration(parsed.body),
        cardFound: true,
      });
    }
  }
  return out;
}

/** `queue/paused/<cadence>` — presence only, contents never read (dispatch.py:487-491). */
export function isPaused(repoRoot: string, cadence: string): boolean {
  if (cadence === '' || cadence.includes('/') || cadence.includes('\\') || cadence.includes('..')) return false;
  return existsSync(join(repoRoot, 'queue', 'paused', cadence));
}

/**
 * Newest first. The ledger records only a DATE (no clock time), so ties break by cadence then card id
 * — stable, and never an ordering claim beyond what the data supports.
 *
 * An UNDATED run (a hand run: cards carry no date field) sorts FIRST rather than last. It is the one
 * placement choice here, and it is deliberate: an undated run is the arming ceremony's stage-① proof,
 * the thing an operator opened this panel to see, and burying it under months of dated dispatcher rows
 * would hide it. The row says "undated" on its face, so nothing is claimed about when it happened.
 */
function newestFirst(a: LoopRun, b: LoopRun): number {
  const undatedA = a.date === '';
  const undatedB = b.date === '';
  if (undatedA !== undatedB) return undatedA ? -1 : 1;
  if (a.date !== b.date) return a.date < b.date ? 1 : -1;
  return a.cadence.localeCompare(b.cadence) || a.card.localeCompare(b.card);
}

/**
 * Build the loop-status panel. Pure read, from three places:
 *   • `ledgers/dispatch/**` filtered to the loop cadence names, joined by card id to `queue/**`;
 *   • `queue/**` scanned by card `action`, for HAND RUNS that have no ledger row at all;
 *   • the HEARTBEAT.md files (name existence only) and the `queue/paused/` sentinels.
 *
 * `loops` is injectable so a test (or a fourth loop declared elsewhere) needs no edit here.
 */
export function buildLoopStatusPanel(
  repoRoot: string,
  loops: readonly LoopCadence[] = LOOP_CADENCES,
): LoopStatusPanel {
  const byCadence = new Map(loops.map((l) => [l.cadence, l]));
  const declaredNames = declaredCadences(repoRoot);
  const ledgerRows = readKindRows(repoRoot, 'dispatch').filter((r) => byCadence.has(String(r.cadence ?? '')));

  const runs: LoopRun[] = [];
  const seenCards = new Set<string>();
  let rejectedRuns = 0;
  for (const row of ledgerRows) {
    const cadence = String(row.cadence ?? '');
    const loop = byCadence.get(cadence)!;
    const card = String(row.card ?? '');
    const facts = readCardFacts(repoRoot, card);
    if (facts === null) {
      rejectedRuns += 1; // fail closed — no row rather than a guessed outcome
      seenCards.add(card); // …and it must not reappear via the hand-run scan either
      continue;
    }
    if (card !== '') seenCards.add(card);
    runs.push({
      cadence,
      label: loop.label,
      date: String(row.date ?? ''),
      card,
      project: String(row.project ?? ''),
      source: 'dispatch',
      outcome: facts ? facts.state : null,
      narration: facts ? facts.narration : null,
      cardFound: facts !== undefined,
    });
  }
  const handRuns = readHandRuns(repoRoot, byCadence, seenCards);
  runs.push(...handRuns);
  runs.sort(newestFirst);

  const rows: LoopRow[] = loops.map((loop) => {
    const mine = runs.filter((r) => r.cadence === loop.cadence);
    const lastRun = mine[0] ?? null; // `runs` is already newest-first
    const declared = declaredNames.has(loop.cadence);
    const paused = isPaused(repoRoot, loop.cadence);
    let state: LoopState;
    if (!declared) state = 'not-declared';
    else if (paused) state = 'paused';
    else if (lastRun === null) state = 'never-run';
    else if (lastRun.outcome && CARD_STATE_VALUES.has(lastRun.outcome)) state = lastRun.outcome as LoopState;
    else state = 'unknown';
    return {
      cadence: loop.cadence,
      label: loop.label,
      schedule: loop.schedule,
      declared,
      paused,
      state,
      lastRun,
      runCount: mine.length,
    };
  });

  return {
    label: 'loop-status',
    loops: rows,
    feed: runs,
    ledgerRowCount: ledgerRows.length,
    handRunCount: handRuns.length,
    rejectedRuns,
    neverRun: runs.length === 0,
    anyDeclared: rows.some((r) => r.declared),
  };
}

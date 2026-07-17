/**
 * Plane-A in-memory indexer. A disposable projection of the repo's coordination truth: cards grouped
 * by state, ledger rollups, and org STATE sections. It is rebuilt on start and kept live by a
 * chokidar file-watch. No SQLite, no source-of-truth store — git stays the database.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { watch } from 'chokidar';
import type { FSWatcher } from 'chokidar';
import { groupByState, parseCardFrontmatter } from './cards.ts';
import type { ParsedCard } from './cards.ts';
import { rollupLedgers } from './ledgers.ts';
import type { LedgerRollup } from './ledgers.ts';
import { readOrgStates } from './states.ts';
import type { OrgState } from './states.ts';

export interface PlaneAIndex {
  cards: Record<string, ParsedCard[]>;
  ledgers: LedgerRollup;
  orgStates: OrgState[];
}

/** Which slice a changed path belongs to — drives incremental re-indexing. */
export type PlaneASlice = 'cards' | 'ledgers' | 'states' | 'dashboards' | 'skills' | 'memory';

export interface PlaneADelta {
  kind: PlaneASlice;
  path: string;
  index: PlaneAIndex;
}

const QUEUE_DIRS = ['inbox', 'working', 'approvals', 'done'];

/** Read and parse every card across the four physical queue dirs. */
function readCards(repoRoot: string): ParsedCard[] {
  const cards: ParsedCard[] = [];
  for (const dir of QUEUE_DIRS) {
    const full = join(repoRoot, 'queue', dir);
    if (!existsSync(full)) continue;
    for (const name of readdirSync(full)) {
      if (!name.endsWith('.md')) continue;
      try {
        cards.push(parseCardFrontmatter(readFileSync(join(full, name), 'utf-8')));
      } catch {
        // A malformed/partially-written card must never crash the index; skip it this pass.
      }
    }
  }
  return cards;
}

/** Build the full Plane-A index from scratch. */
export function indexRepo(repoRoot: string): PlaneAIndex {
  return {
    cards: groupByState(readCards(repoRoot)),
    ledgers: rollupLedgers(repoRoot),
    orgStates: readOrgStates(repoRoot),
  };
}

/** Classify a changed path into the slice it affects. */
function classify(repoRoot: string, changed: string): PlaneASlice {
  const rel = changed.slice(repoRoot.length).replace(/^[\\/]+/, '').replace(/\\/g, '/');
  if (rel.startsWith('queue/')) return 'cards';
  if (rel.startsWith('ledgers/')) return 'ledgers';
  if (rel.startsWith('orgs/')) return 'states';
  if (rel.startsWith('dashboards/')) return 'dashboards';
  if (rel.startsWith('skills/')) return 'skills';
  if (rel.startsWith('memory/')) return 'memory';
  return 'cards';
}

/** Rebuild only the slice a change touched, returning a fresh index. */
function reindexSlice(repoRoot: string, prev: PlaneAIndex, kind: PlaneASlice): PlaneAIndex {
  switch (kind) {
    case 'cards':
      return { ...prev, cards: groupByState(readCards(repoRoot)) };
    case 'ledgers':
      return { ...prev, ledgers: rollupLedgers(repoRoot) };
    case 'states':
      return { ...prev, orgStates: readOrgStates(repoRoot) };
    default:
      return prev; // dashboards/skills/memory slices carry no indexed rollup yet
  }
}

/**
 * Watch the Plane-A surfaces and invoke `onChange` with an incremental delta on every write.
 * Resolves once the watcher's initial scan is complete (so callers can safely write a change and
 * expect exactly the resulting `onChange`). Writes are debounced; only the affected slice is rebuilt.
 */
export function watchPlaneA(
  repoRoot: string,
  onChange: (delta: PlaneADelta) => void,
  opts: { debounceMs?: number } = {},
): Promise<FSWatcher> {
  const debounceMs = opts.debounceMs ?? 50;
  let index = indexRepo(repoRoot);

  // Only watch surfaces that exist — chokidar stalls its `ready` event on absent paths, and the
  // fleet repo may legitimately lack e.g. dashboards/ or skills/ at a given moment.
  const targets = ['queue', 'ledgers', 'dashboards', 'orgs', 'skills', 'memory']
    .map((d) => join(repoRoot, d))
    .filter((p) => existsSync(p));

  const watcher = watch(targets, { ignoreInitial: true, persistent: true });

  const pending = new Map<PlaneASlice, string>();
  let timer: NodeJS.Timeout | undefined;

  const flush = (): void => {
    timer = undefined;
    for (const [kind, path] of pending) {
      index = reindexSlice(repoRoot, index, kind);
      onChange({ kind, path, index });
    }
    pending.clear();
  };

  const onEvent = (path: string): void => {
    const kind = classify(repoRoot, path);
    pending.set(kind, path); // debounce: last path per slice wins
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, debounceMs);
  };

  watcher.on('add', onEvent);
  watcher.on('change', onEvent);
  watcher.on('unlink', onEvent);

  return new Promise<FSWatcher>((resolve) => {
    watcher.on('ready', () => resolve(watcher));
  });
}

/**
 * The canonical integration STORE layout — one definition, two readers.
 *
 * `canonicalResultIntegrator.ts` WRITES here: every stage result that reaches `canonical-committed` has
 * its declared artifact bytes materialized in a per-RUN git worktree under the integration root, and its
 * journal record appended to the integration state file. Nothing else in the product knew that layout, so
 * a run's artifacts were durable on disk and invisible to every read surface: the F4 download route only
 * ever looked under `DASHBOARD_REPO_ROOT` (the ops checkout), where a canonical integration never lands.
 * That is the bug this module exists to close — the read side now derives the same two paths from the
 * same functions the writer uses, so the two cannot drift.
 *
 * On the VM the writer's paths are, verbatim:
 *   `/var/lib/kb/state/control/canonical-integration.json`                   (the journal)
 *   `/var/lib/kb/state/control/integration/<sha256(runRef)[0:24]>/<repo-relative path>`  (the bytes)
 *
 * The integration root is resolvable per activation (`activation.ts#buildActivatedExecution` accepts an
 * `integrationRoot` override) but nothing in production passes one, so `defaultIntegrationRoot` is the
 * live layout and the read side names it directly. A deployment that ever overrides it must thread the
 * override to the read side too; there is no second guess here.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isSafeRepoRelativePath } from './proposal.ts';

/** Matches the writer's own bound (`canonicalResultIntegrator.ts#MAX_STATE_BYTES`). */
const MAX_STATE_BYTES = 32 * 1024 * 1024;

/** The integration journal: every integration record the canonical integrator has ever written. */
export function canonicalIntegrationStatePath(stateRoot: string): string {
  return join(stateRoot, 'control', 'canonical-integration.json');
}

/** The production integration root — see the module note on the (unused) activation override. */
export function defaultIntegrationRoot(stateRoot: string): string {
  return join(stateRoot, 'control', 'integration');
}

/**
 * The per-RUN integration worktree. Keyed by the run ref alone (NOT the stage), which is why one
 * directory holds every stage's artifacts for a run and why a run-scoped download needs no stage input.
 */
export function integrationDirFor(integrationRoot: string, runRef: string): string {
  return join(integrationRoot, createHash('sha256').update(runRef).digest('hex').slice(0, 24));
}

/** The per-run integration worktree under the production layout. */
export function runIntegrationDir(stateRoot: string, runRef: string): string {
  return integrationDirFor(defaultIntegrationRoot(stateRoot), runRef);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The journal is re-read per run-detail request, so a memo keyed on the file's own mtime+size keeps a
 * polling console from re-parsing a multi-megabyte document every second. Any write bumps mtimeMs, and a
 * same-millisecond write that also preserved the byte length would have to be byte-identical to matter.
 */
const memo = new Map<string, { key: string; records: readonly Record<string, unknown>[] }>();

function readJournalRecords(stateRoot: string): readonly Record<string, unknown>[] {
  const path = canonicalIntegrationStatePath(stateRoot);
  let key: string;
  try {
    const info = statSync(path);
    if (!info.isFile() || info.size > MAX_STATE_BYTES) return [];
    key = `${info.mtimeMs}:${info.size}`;
  } catch {
    return []; // no journal yet: this deployment has integrated nothing.
  }
  const cached = memo.get(path);
  if (cached && cached.key === key) return cached.records;
  let records: readonly Record<string, unknown>[] = [];
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (isRecord(value) && value.schema === 'kb.canonical-integration/v1' && Array.isArray(value.records)) {
      records = value.records.filter(isRecord);
    }
  } catch {
    records = []; // a torn or unparsable journal projects no outputs; it never throws at a read route.
  }
  memo.set(path, { key, records });
  return records;
}

/** Test seam: the memo is process-lifetime, and a temp state root can be rewritten within one mtime tick. */
export function clearIntegrationJournalCache(): void {
  memo.clear();
}

/**
 * The paths this run INTEGRATED that its approved plan DECLARED as artifacts.
 *
 * Four deliberate narrowings:
 *  - `canonical-committed` ONLY. A record below that state has not finished integrating; its bytes may be
 *    mid-cherry-pick, and a half-integrated file is not something to hand an operator as the run's output.
 *  - intersected with `declared`, the approved plan's own artifact set (see
 *    `runOutputs.ts#declaredArtifactPaths`), so incidental worktree churn never becomes a product link.
 *  - both `changed` and `artifacts` are considered, but only through that intersection: `changed` is the
 *    server's own worktree inspection and `artifacts` is the worker's self-report, so neither is trusted
 *    to name a path the plan did not declare.
 *  - every path re-validated with the integrator's own `isSafeRepoRelativePath`, because this file is
 *    read from disk and a path in it is the input to a later `join`.
 * Journal order is preserved (stage order) and duplicates collapse.
 */
export function readIntegratedRunArtifactPaths(
  stateRoot: string,
  runRef: string,
  declared: ReadonlySet<string>,
): string[] {
  if (!runRef || declared.size === 0) return [];
  const paths: string[] = [];
  const seen = new Set<string>();
  for (const record of readJournalRecords(stateRoot)) {
    if (record.runRef !== runRef || record.state !== 'canonical-committed') continue;
    const result = record.result;
    if (!isRecord(result)) continue;
    for (const key of ['changed', 'artifacts'] as const) {
      const entries = result[key];
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!isRecord(entry) || !isSafeRepoRelativePath(entry.path)) continue;
        if (!declared.has(entry.path) || seen.has(entry.path)) continue;
        seen.add(entry.path);
        paths.push(entry.path);
      }
    }
  }
  return paths;
}

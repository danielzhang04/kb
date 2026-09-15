/**
 * The RUN's own outputs: the declared artifacts a run actually integrated, projected as downloadable
 * `OutputRef`s and scoped for the F4 download route.
 *
 * Before this module the product had two link producers (an agent's page and a workflow's page, both
 * rooted at `orgs/<project>` inside the ops checkout) and no third. A canonical run writes its artifacts
 * somewhere neither of those roots can see — its own integration worktree under the state root — so a run
 * that completed and produced a brief showed the operator nothing to download. See
 * `integrationLayout.ts` for the layout this reads.
 *
 * WHAT COUNTS AS AN OUTPUT — the two halves, and why neither alone is right:
 *  - DECLARED: the path must appear in `artifacts` of a stage of the run's APPROVED plan revision. The
 *    plan is what the human approved; anything else a stage happened to touch is not a product.
 *  - INTEGRATED: the path must appear in a `canonical-committed` integration record's `changed` (or
 *    `artifacts`) set for this run. `changed` is the SERVER's own worktree inspection at integration time
 *    — `execution.ts` passes `inspection.changed`, never the worker's word for it. The journal's
 *    `artifacts` field IS the worker self-report (`execution.ts:1436`; both production adapters leave it
 *    empty, and `resultIsSafe` already refuses any entry that is not declared and byte-matched), so it is
 *    intersected with the declared set exactly like `changed` rather than trusted on its own.
 *
 * SCOPE, and why it is that same set rather than the whole integration directory: the R5 doctrine in
 * `artifactFilesRoute.ts` is that a link may only ever be redeemed for files the page that rendered it
 * could itself have projected. The run page projects exactly these paths, so those — each admitted as its
 * own root, i.e. itself and nothing under it — are the run's whole download scope. Every other file in
 * that integration worktree (the checkout of the rest of the repository, incidental churn, git's own
 * metadata) is NOT an output and is not downloadable.
 */
import { createOutputDigestReader } from './artifactFiles.ts';
import { projectOutputRef } from '../entities/outputs.ts';
import { readIntegratedRunArtifactPaths, runIntegrationDir } from './integrationLayout.ts';
import type { ControlPlaneStore, ReadScope } from './store.ts';
import type { OutputRef } from './p2Contracts.ts';

/**
 * A base directory plus the roots map inside it. `base` replaces the repo root for a run: every path the
 * download route admits is resolved under the run's OWN integration worktree, never under the checkout.
 */
export interface OutputFileScope {
  base: string;
  roots: Record<string, string>;
  paths: readonly string[];
}

/** Everything the projection needs, in the shape both the DTO builder and the download route already hold. */
export interface RunOutputInput {
  stateRoot: string;
  store: Pick<ControlPlaneStore, 'getProposalRevision'>;
  subject: string;
  scope: ReadScope;
  run: { runRef: string; proposalRef: string; proposalRevision: number };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The artifact paths the run's APPROVED plan revision declares, across every stage. Read through the same
 * subject+scope-checked store call the proposal read route uses, so a revision this subject may not read
 * yields an empty set (and therefore no outputs and no download scope) rather than a leak.
 */
export function declaredArtifactPaths(input: RunOutputInput): Set<string> {
  const declared = new Set<string>();
  const stored = input.store.getProposalRevision(input.subject, input.run.proposalRef, input.run.proposalRevision, input.scope);
  if (!stored.ok) return declared;
  const snapshot: unknown = stored.value.snapshot;
  if (!isRecord(snapshot) || !Array.isArray(snapshot.stages)) return declared;
  for (const stage of snapshot.stages) {
    if (!isRecord(stage) || !Array.isArray(stage.artifacts)) continue;
    for (const artifact of stage.artifacts) {
      if (isRecord(artifact) && typeof artifact.path === 'string' && artifact.path.length > 0) declared.add(artifact.path);
    }
  }
  return declared;
}

/**
 * The run's download scope, derived from the approved plan plus the integrator's layout and journal alone
 * — never from anything a caller sent. `null` when this run has integrated no declared artifact, which
 * the route renders as the same flat 404 an unknown run gets.
 */
export function runOutputFileScope(input: RunOutputInput): OutputFileScope | null {
  const paths = readIntegratedRunArtifactPaths(input.stateRoot, input.run.runRef, declaredArtifactPaths(input));
  if (paths.length === 0) return null;
  return {
    base: runIntegrationDir(input.stateRoot, input.run.runRef),
    roots: Object.fromEntries(paths.map((path) => [path, path])),
    paths,
  };
}

/**
 * The run-detail DTO's `outputs`. Each ref carries the repo-relative `path`, the sha256 of the INTEGRATED
 * bytes (hashed here, at projection time, off the integration worktree — `createOutputDigestReader`), and
 * `entity: { type: 'run', id: runRef }` so `outputHref` mints a run-scoped link the route re-derives the
 * scope from.
 *
 * An artifact whose integrated bytes are missing, oversized or not a regular file projects WITHOUT a
 * digest: the label stays visible and the UI renders no link, exactly as the other two producers behave.
 */
export function projectRunOutputs(input: RunOutputInput): OutputRef[] {
  const scope = runOutputFileScope(input);
  if (!scope) return [];
  const readDigest = createOutputDigestReader(scope.base, scope.roots);
  const entity = { type: 'run', id: input.run.runRef } as const;
  const outputs: OutputRef[] = [];
  for (const path of scope.paths) {
    try {
      outputs.push(projectOutputRef(
        { kind: 'artifact', label: path.split('/').at(-1) || path, rootId: path, path },
        scope.roots, readDigest, entity,
      ));
    } catch {
      // `projectOutputRef` refuses a path its own predicate calls unsafe. Such an artifact simply does
      // not become a link; it is never thrown out of a read route.
    }
  }
  return outputs;
}

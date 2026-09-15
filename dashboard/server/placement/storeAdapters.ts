// v1 desktop-execution seam, unit 1 [baseline §8]: the PRODUCTION bindings of `LeaseStorePort`
// (`placement/leaseService.ts`) and `ReportStorePort` (`placement/reportService.ts`) onto the real
// control store. Until this file existed, both ports had exactly one implementation — the in-memory
// fixture in `testFixtures/p6TwoDaemonFixture.ts` — so `claim`/`renew`/`report` on the node scope
// could only ever answer `503 node-attribution-unavailable` in production.
//
// Three rules this file keeps:
//  1. NO schema change. Every lease row is the same frozen six-field `PlacementLease`; no collection
//     is added; `CONTROL_PLANE_SCHEMA_VERSION` stays 4. The attempt-scoped bridge the desktop lane
//     ultimately needs is unit 5 and is BLOCKED on the schema ruling in baseline §2 — nothing here
//     pretends to solve it.
//  2. NO second state machine. Lease CAS is `control/placementState.ts` via the store's placement
//     methods; a run's terminal transition, its human requests, and its events go through the SAME
//     committed `transitionRun`/`createHumanRequest`/`appendEvent` the VM-local path uses.
//  3. NO widening of node authority. A node peer has no subject: every write below is performed under
//     the RUN's own subject, resolved server-side from the run row, never from anything the node sent.
//     The report port still carries no way to resolve a human request [reportService §3.6].
import { isAdvertisementFresh } from './contracts.ts';
import type { CapabilityRequirement, HostAdvertisement, HostKind, PlacementLease } from './contracts.ts';
import { capabilityHash } from './normalize.ts';
import type { CandidateRun, LeaseStorePort } from './leaseService.ts';
import type { OpenHumanRequestInput, ReportStorePort, RunTerminalState } from './reportService.ts';
import type { ReportKind } from '../api/v1/contracts.ts';
import type { AdvertiseStorePort } from '../api/v1/routes.ts';
import type { ControlPlaneStore } from '../control/storeTypes.ts';
import { RUN_LIFECYCLE_SEMANTICS, type RunLifecycleKind } from '../control/runLifecycle.ts';
import type { OperationalEventInput, OperationalEventStatus } from '../control/types.ts';

/**
 * The exact store surface these adapters use — a `Pick`, not a re-declaration, so a signature change
 * in `ControlPlaneStore` is a compile error here rather than silent drift, and a test can supply a
 * narrow fake without building a whole store.
 */
export type PlacementControlStore = Pick<
  ControlPlaneStore,
  | 'listHostAdvertisements'
  | 'upsertHostAdvertisement'
  | 'releaseExpiredPlacementLeases'
  | 'selectPlacementCandidateRunRef'
  | 'createPlacementLease'
  | 'getPlacementLease'
  | 'renewPlacementLease'
  | 'bumpPlacementLeaseSequence'
  | 'getPlacementRunContext'
  | 'appendEvent'
  | 'createHumanRequest'
  | 'transitionRun'
>;

export interface PlacementAdapterOptions {
  /**
   * Injected clock. The one port method that carries no timestamp of its own
   * (`currentAdvertisedCapabilityHash`) reads it, so a test never has to wait out the 90-s
   * advertisement freshness window.
   */
  readonly now?: () => number;
}

/** The capability set a host currently advertises, as a requirement — the thing a lease pins. */
function requirementFromAdvertisement(advertisement: HostAdvertisement): CapabilityRequirement {
  const clis: Array<'claude' | 'codex'> = [];
  if (advertisement.clis.claude === 'ready') clis.push('claude');
  if (advertisement.clis.codex === 'ready') clis.push('codex');
  return {
    connectors: advertisement.connectors.map((grant) => ({ server: grant.server, tools: [...grant.tools] })),
    skills: [...advertisement.skills],
    filesystemRoots: [...advertisement.filesystemRoots],
    pty: advertisement.pty,
    gpu: advertisement.gpu,
    clis,
  };
}

/**
 * The hash of `hostId`'s CURRENT capability set, or `undefined` when the host has no FRESH
 * advertisement at all. `undefined` is the port's documented "cannot tell" value and both services
 * treat it as "do not refuse `capability-lost`" — a stale beat must not kill a live lease; only a host
 * that re-advertises a DIFFERENT capability set does that.
 */
function advertisedCapabilityHash(
  store: Pick<PlacementControlStore, 'listHostAdvertisements'>,
  hostId: HostKind,
  nowMs: number,
): string | undefined {
  const row = store.listHostAdvertisements().find((advertisement) => advertisement.hostId === hostId);
  if (!row || !isAdvertisementFresh(row.reportedAt, nowMs)) return undefined;
  return capabilityHash(requirementFromAdvertisement(row));
}

/**
 * `LeaseStorePort` over the control store. `selectCandidate` requires a fresh advertisement (a host
 * that is not beating is not handed work), and the `capabilityHash` it returns is the host's CURRENT
 * advertised set — i.e. the lease pins what the host could do at claim time, so a host that
 * re-advertises a different set afterwards loses the lease on its next renew/report. A run does not
 * persist a `CapabilityRequirement` of its own today (launch places against the empty requirement,
 * `control/routes.ts:646`), so this is the strongest honest pin available without a schema change.
 */
export function createLeaseStoreAdapter(
  store: PlacementControlStore,
  options: PlacementAdapterOptions = {},
): LeaseStorePort {
  const now = options.now ?? Date.now;
  return {
    async releaseExpiredLeases(nowIso: string): Promise<readonly string[]> {
      return store.releaseExpiredPlacementLeases(Date.parse(nowIso));
    },
    async selectCandidate(hostId: HostKind, nowIso: string): Promise<CandidateRun | undefined> {
      const nowMs = Date.parse(nowIso);
      const hash = advertisedCapabilityHash(store, hostId, nowMs);
      if (hash === undefined) return undefined;
      const runRef = store.selectPlacementCandidateRunRef(hostId, nowMs);
      return runRef === undefined ? undefined : { runRef, capabilityHash: hash };
    },
    async createLease(
      runRef: string,
      hostId: HostKind,
      capabilityHashValue: string,
      nowIso: string,
    ): Promise<PlacementLease | undefined> {
      return store.createPlacementLease(runRef, hostId, capabilityHashValue, Date.parse(nowIso));
    },
    async getLease(runRef: string): Promise<PlacementLease | undefined> {
      return store.getPlacementLease(runRef);
    },
    async renewLease(
      runRef: string,
      expectedLeaseRevision: number,
      nowIso: string,
    ): Promise<PlacementLease | undefined> {
      return store.renewPlacementLease(runRef, expectedLeaseRevision, Date.parse(nowIso));
    },
    async currentAdvertisedCapabilityHash(hostId: HostKind): Promise<string | undefined> {
      return advertisedCapabilityHash(store, hostId, now());
    },
  };
}

/** How a wire report kind projects onto the CLOSED operational-event shape (`control/types.ts`). */
const EVENT_PROJECTION: Record<ReportKind, { kind: OperationalEventInput['kind']; status: OperationalEventStatus }> = {
  started: { kind: 'lifecycle', status: 'running' },
  event: { kind: 'message', status: null },
  'gate-opened': { kind: 'lifecycle', status: 'waiting' },
  completed: { kind: 'lifecycle', status: 'success' },
  failed: { kind: 'lifecycle', status: 'failure' },
};

const MAX_REPORT_SUMMARY_CHARS = 400;

function optionalString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * `ReportStorePort` over the control store.
 *
 * KNOWN AND DOCUMENTED LIMIT: `OperationalEvent` is a closed shape with no free-form payload field
 * ("provider payloads, tool inputs/results, environment, credentials … have no representable field at
 * this persistence boundary", `control/types.ts`). This adapter therefore persists a PROJECTION of a
 * report — its kind, sequence, an optional `payload.summary`, and `payload.stageRef`/`attemptRef` when
 * they are strings — and deliberately does NOT copy arbitrary payload keys into the store. Full
 * attempt-scoped report payloads are unit 5 and are blocked on the baseline §2 schema ruling; widening
 * the event shape here would be exactly the silent scope widening that ruling forbids.
 */
export function createReportStoreAdapter(
  store: PlacementControlStore,
  options: PlacementAdapterOptions = {},
): ReportStorePort {
  const now = options.now ?? Date.now;
  const requireContext = (runRef: string) => {
    const context = store.getPlacementRunContext(runRef);
    if (!context) throw new Error(`report store: no run ${runRef}`);
    return context;
  };
  return {
    async getLease(runRef: string): Promise<PlacementLease | undefined> {
      return store.getPlacementLease(runRef);
    },
    async getRunTerminalState(runRef: string): Promise<RunTerminalState> {
      const context = store.getPlacementRunContext(runRef);
      if (!context) return { terminalOutcome: null, completedAt: null };
      return { terminalOutcome: context.terminalOutcome, completedAt: context.completedAt };
    },
    async currentAdvertisedCapabilityHash(hostId: HostKind): Promise<string | undefined> {
      return advertisedCapabilityHash(store, hostId, now());
    },
    async appendReportEvent(
      runRef: string,
      kind: ReportKind,
      payload: Record<string, unknown>,
      sequence: number,
    ): Promise<void> {
      const context = requireContext(runRef);
      const projection = EVENT_PROJECTION[kind];
      const detail = optionalString(payload, 'summary');
      const summary = (detail === null
        ? `host report ${kind} #${sequence}`
        : `host report ${kind} #${sequence}: ${detail}`).slice(0, MAX_REPORT_SUMMARY_CHARS);
      const result = store.appendEvent(context.subject, runRef, {
        kind: projection.kind,
        // `worker`, never `system`: the author of this event is a remote executor, not the daemon.
        source: 'worker',
        status: projection.status,
        stageRef: optionalString(payload, 'stageRef'),
        attemptRef: optionalString(payload, 'attemptRef'),
        summary,
      });
      if (!result.ok) throw new Error(`report store: appendEvent refused (${result.reason}: ${result.detail})`);
    },
    async bumpLeaseSequence(runRef: string, sequence: number): Promise<void> {
      store.bumpPlacementLeaseSequence(runRef, sequence);
    },
    async markTerminal(runRef: string, outcome: 'ok' | 'failed', completedAt: string): Promise<void> {
      void completedAt; // the store stamps `completedAt` itself inside the terminal transition.
      const target: RunLifecycleKind = outcome === 'ok' ? 'succeeded' : 'failed';
      let context = requireContext(runRef);
      if (context.terminalOutcome !== null) return; // already terminal; the service refuses before here.
      // The run may still sit in a pre-execution state (`planned`/`waiting-human`) because nothing on
      // the VM ran it — the lifecycle table forbids jumping straight to a terminal state from there, so
      // walk the one legal intermediate (`running`) rather than inventing a new edge.
      if (!RUN_LIFECYCLE_SEMANTICS[context.state].transitions.has(target)) {
        if (!RUN_LIFECYCLE_SEMANTICS[context.state].transitions.has('running')) {
          throw new Error(`report store: run ${runRef} cannot reach ${target} from ${context.state}`);
        }
        const stepped = store.transitionRun(context.subject, runRef, context.version, 'running');
        if (!stepped.ok) throw new Error(`report store: transitionRun refused (${stepped.reason}: ${stepped.detail})`);
        context = requireContext(runRef);
      }
      const result = store.transitionRun(context.subject, runRef, context.version, target);
      if (!result.ok) throw new Error(`report store: transitionRun refused (${result.reason}: ${result.detail})`);
    },
    async openHumanRequest(input: OpenHumanRequestInput): Promise<{ readonly requestRef: string }> {
      const context = requireContext(input.runRef);
      const result = store.createHumanRequest(context.subject, input.runRef, {
        stageRef: input.stageRef,
        kind: input.kind,
        title: input.title,
        prompt: input.prompt,
      });
      if (!result.ok) throw new Error(`report store: createHumanRequest refused (${result.reason}: ${result.detail})`);
      return { requestRef: result.value.requestRef };
    },
  };
}

/**
 * `AdvertiseStorePort` over the control store — the remote half of the SAME writer the daemon's own
 * self-advertisement timer uses (`placement/selfAdvertise.ts` → `upsertHostAdvertisement`), so a beat
 * arriving over `PUT /api/v1/hosts/:hostId` and a local beat are provably one CAS, not two.
 *
 * It is bound alongside the lease/report adapters because without it a remote host can never publish a
 * fresh advertisement into the VM's store, and `selectCandidate` (correctly) hands work to no host that
 * is not beating — i.e. lease claiming would be dead on arrival.
 */
export function createAdvertiseStoreAdapter(store: PlacementControlStore): AdvertiseStorePort {
  return {
    async currentVersion(hostId: HostKind): Promise<number | undefined> {
      return store.listHostAdvertisements().find((row) => row.hostId === hostId)?.version;
    },
    async upsert(hostId: HostKind, advertisement: HostAdvertisement, expectedVersion: number | undefined) {
      return store.upsertHostAdvertisement(hostId, advertisement, expectedVersion);
    },
  };
}

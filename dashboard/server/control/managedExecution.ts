/**
 * Wave A activation — production constructors for the two mandatory execution collaborators the
 * `AutomaticExecutionEngine` cannot be built without: a `ManagerAdapter` and an
 * `ExecutionCancellationController`, plus the shared worker-cancellation registry that bridges the
 * worker adapter's spawn-time `registerCancellation` seam to the controller's `cancelWorker` authority.
 *
 * Realization follows Wave-A decision D3(b): the DAG is driven IN-PROCESS by `runToBoundary`, so the
 * logical Manager needs no second `claude` subprocess. `ensure()` therefore validates its server-owned
 * inputs and records the logical manager as ensured — it never spawns. The `broker` option is accepted
 * (and used only for `cancelManager` → `broker.stop`) so a later D3(b→a) upgrade to a broker-backed
 * manager session is a local change here, not a re-wiring of the engine.
 *
 * Nothing in this module is constructed unless the activation gate is on (see `activation.ts`); with the
 * gate off it is never imported into a live code path.
 */
import type { ManagedSessionBroker } from './broker.ts';
import type { ExecutionCancellationController, ManagerAdapter } from './execution.ts';

/**
 * The worker adapter, at spawn, hands us `(operationKey, cancel)` where `operationKey` is the attempt's
 * stable `automatic-attempt:<attemptRef>` key (see `execution.ts#executeAttemptUnsafe`). The cancellation
 * controller later reaps a still-running worker by that same key. This registry is the only shared state
 * between the two seams.
 */
export interface WorkerCancellationRegistry {
  /** Record the idempotent `cancel` for a spawned worker. A re-registration for the same key wins. */
  register(operationKey: string, cancel: () => void): void;
  /** Invoke a registered `cancel` at most once; unknown keys are a no-op. */
  cancel(operationKey: string): void;
  /** Drop a registration without invoking it (a worker that terminated on its own). */
  clear(operationKey: string): void;
}

export function createWorkerCancellationRegistry(): WorkerCancellationRegistry {
  const cancels = new Map<string, () => void>();
  return {
    register(operationKey, cancel) {
      cancels.set(operationKey, cancel);
    },
    cancel(operationKey) {
      const fn = cancels.get(operationKey);
      if (!fn) return;
      // Delete before invoking so a second cancel — or a throw inside `fn` — cannot fire it twice.
      cancels.delete(operationKey);
      fn();
    },
    clear(operationKey) {
      cancels.delete(operationKey);
    },
  };
}

export interface BrokerManagerAdapterOptions {
  /**
   * Reserved for the D3(b→a) upgrade path (a broker-backed `claude` manager session). Unused under the
   * default D3(b) realization: `ensure()` spawns nothing, so no broker is required to construct one.
   */
  broker?: ManagedSessionBroker;
}

/**
 * D3(b): an idempotent Manager adapter that validates the server-owned inputs and records the logical
 * manager as ensured. It never spawns a subprocess — the engine coordinates the DAG in-process. Repeated
 * reconciliation calls with the same `sessionRef` are a no-op.
 */
export function createBrokerManagerAdapter(_options: BrokerManagerAdapterOptions = {}): ManagerAdapter {
  const ensured = new Set<string>();
  return {
    async ensure(input) {
      const profile = input.profile;
      if (!profile || profile.role !== 'manager' || !profile.model) {
        throw new Error('manager adapter requires a server-owned manager execution profile');
      }
      if (typeof input.proposalHash !== 'string' || input.proposalHash.trim() === '' || input.proposalHash.includes('\0')) {
        throw new Error('manager adapter requires the immutable proposal hash');
      }
      if (typeof input.sessionRef !== 'string' || input.sessionRef === '') {
        throw new Error('manager adapter requires a managed session reference');
      }
      // D3(b): no `claude` manager child is spawned; the logical manager is simply recorded as ensured.
      ensured.add(input.sessionRef);
    },
  };
}

export interface BrokerCancellationControllerOptions {
  /** Used only to stop a manager session (a no-op under D3(b), where no manager child is live). */
  broker: Pick<ManagedSessionBroker, 'stop'>;
  /** The shared registry the worker adapter populated at spawn. */
  registry: Pick<WorkerCancellationRegistry, 'cancel'>;
}

/**
 * The injected, idempotent stop authority. `cancelManager` delegates to `broker.stop` (which returns
 * false for an unknown/already-stopped session, so it is safe to call repeatedly). `cancelWorker` maps
 * the attempt reference to its `automatic-attempt:<attemptRef>` operationKey and invokes the worker
 * adapter's registered idempotent cancel; an unknown reference is a no-op.
 */
export function createBrokerCancellationController(
  options: BrokerCancellationControllerOptions,
): ExecutionCancellationController {
  return {
    async cancelManager(input) {
      options.broker.stop(input.sessionRef);
    },
    async cancelWorker(input) {
      options.registry.cancel(`automatic-attempt:${input.attemptRef}`);
    },
  };
}

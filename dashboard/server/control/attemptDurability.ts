/**
 * Durable attempt-mutation vocabulary. These three types outlived the inactive managed session
 * broker they were declared beside (deleted in P3 W6.5 per plan [C-S6]); the retained control
 * store and activation path still speak them, so they live here — the durability boundary — rather
 * than in a process supervisor.
 *
 * `ManagedStartSpec` is deliberately closed: no cwd, environment, CLI flags, tools, or permission
 * mode. A start's launch parameters are resolved server-side from `profileId` and never smuggled by
 * the caller.
 */

export interface ManagedStartSpec {
  runRef: string;
  sessionRef: string;
  role: 'manager' | 'worker';
  profileId: string;
  approvedPrompt: string;
}

/**
 * Outcome of one atomic durable mutation. `applied` committed; `duplicate` replayed an existing
 * receipt for the same idempotency key; `conflict` lost its compare-and-swap; `inactive` addressed a
 * session that is no longer running. `revision` is always the store's post-call revision.
 */
export type BrokerMutation =
  | { status: 'applied'; revision: number }
  | { status: 'duplicate'; revision: number }
  | { status: 'conflict'; revision: number }
  | { status: 'inactive'; revision: number };

/** A mutation that also drains the durable steering queue it consumed. */
export type BrokerConsumption = BrokerMutation & { instructions: string[] };

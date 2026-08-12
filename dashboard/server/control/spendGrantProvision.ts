/**
 * FYT paid-action wiring — Unit D3: mint a stage's spend grant and write its opaque token into the
 * prepared attempt worktree, at STAGE LAUNCH, before the worker spawns.
 *
 * Why here and not at Unit B's original gate-approval marker: the token FILE must exist inside the attempt
 * worktree before the stage worker runs, but that worktree is created by the execution engine AFTER the
 * gate is approved. `mint` returns the raw token exactly once, so minting at the gate-approval route (which
 * precedes worktree creation) would strand the token with nowhere to write it. Minting here — at the launch
 * site, where the engine has already confirmed the stage's `spendAuthorization === 'approved'` and prepared
 * the worktree — mints and writes the token in one step.
 *
 * Every spend-bearing input is server truth: the operation is derived from the frozen
 * `FYT_PAID_ACTION_DEFINITIONS` by stage id, the caps live in the frozen policy (copied by the grant store
 * at mint), and the gate approval is re-verified against the run's own durable human requests. Nothing here
 * is worker- or browser-supplied. The token file carries ONLY the opaque grant token — never a provider key.
 *
 * Strip-only floor: no TS enums, parameter properties, or namespaces. ESM with `.ts` specifiers.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { renameWithRetrySync } from '../atomicRename.ts';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { stableHumanTitle, type ProvisionSpendGrantInput } from './execution.ts';
import { FYT_PAID_ACTION_DEFINITIONS, type PaidActionOperation } from './paidActionService.ts';
import { SpendGrantError, type SpendGrantMintInput } from './spendGrant.ts';

/** The single-use write surface the token FILE occupies inside the attempt worktree. */
export const SPEND_GRANT_FILE_RELATIVE_PATH = '.kb/spend-grant.json';

/** The exact JSON descriptor written into the worktree. It carries the opaque token and the run identity a
 *  worker relays back, but the daemon ignores that relayed identity and re-derives every spend-bearing
 *  value server-side — the file is a capability carrier, not a source of authority. NEVER a provider key. */
export interface SpendGrantFileContents {
  token: string;
  runRef: string;
  stageRef: string;
  attemptRef: string;
  operationsAllowed: PaidActionOperation[];
  routeUrl: string;
}

/** Just the mint surface of the Unit B store — kept structural so tests inject a fake without the whole store. */
export interface SpendGrantMinter {
  mint(input: SpendGrantMintInput): Promise<{ grantRef: string; token: string }>;
}

export type ProvisionSpendGrantResult =
  | { provisioned: true; grantRef: string; operation: PaidActionOperation }
  | { provisioned: false; reason: 'not-a-paid-stage' | 'no-spend-gate' | 'spend-authorization-not-approved' }
  | { provisioned: false; reason: 'already-live'; grantRef: string | null };

export interface ProvisionSpendGrantDeps {
  grantStore: SpendGrantMinter;
  /** The absolute route URL a worker POSTs paid calls to, written into the token file. */
  routeUrl: string;
  /** Grant TTL — sized to a stage lifetime, validated by the store against its own [1min, 6h] bounds. */
  ttlMs: number;
  /** Injectable in tests; production writes `.kb/spend-grant.json` into the worktree atomically. */
  writeGrantFile?: (worktreePath: string, contents: SpendGrantFileContents) => void;
}

/** Reverse the frozen definitions: which paid operation, if any, a stage id spends under. Single source of
 *  truth — no separate stage→operation table can drift from the caps table. */
function operationForStageId(stageId: string): PaidActionOperation | null {
  for (const operation of Object.keys(FYT_PAID_ACTION_DEFINITIONS) as PaidActionOperation[]) {
    if (FYT_PAID_ACTION_DEFINITIONS[operation].stageId === stageId) return operation;
  }
  return null;
}

/** Atomic-ish token-file write: a fresh temp file then rename, so a partial write is never observed and a
 *  re-provision replaces the descriptor cleanly. The worktree is server-owned and outside the checkout. */
function defaultWriteGrantFile(worktreePath: string, contents: SpendGrantFileContents): void {
  const dir = join(worktreePath, '.kb');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, 'spend-grant.json');
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(contents, null, 2)}\n`, { mode: 0o600 });
  renameWithRetrySync(temp, target);
}

/**
 * Mint (if this stage spends) and write the token file. Pure-ish and directly unit-testable with a fake
 * minter + a recording `writeGrantFile`. Returns a discriminated result rather than throwing on the
 * expected non-spending / already-provisioned cases; a genuinely unexpected mint failure still throws.
 */
export async function provisionAttemptSpendGrant(
  input: ProvisionSpendGrantInput,
  deps: ProvisionSpendGrantDeps,
): Promise<ProvisionSpendGrantResult> {
  const operation = operationForStageId(input.stageId);
  if (!operation) return { provisioned: false, reason: 'not-a-paid-stage' };

  const spendGates = input.proposalStage.humanGates.filter((gate) => gate.spendAuthorization === true);
  if (spendGates.length === 0) return { provisioned: false, reason: 'no-spend-gate' };

  // Defense-in-depth: the engine already refuses to reach a launch for a spending stage until its declared
  // spend gate is recorded approved, but re-verify against the run's own durable human requests here so a
  // grant can never be minted for an unauthorized stage even if this is called out of order.
  let gateRequestRef: string | null = null;
  for (const gate of spendGates) {
    const title = stableHumanTitle('gate', input.stageId, gate.id);
    const request = input.humanRequests.find((candidate) => candidate.stageRef === input.stageRef && candidate.title === title);
    if (!request || request.state !== 'resolved' || request.kind !== 'approval'
      || request.response?.decision !== 'approved') {
      return { provisioned: false, reason: 'spend-authorization-not-approved' };
    }
    if (gateRequestRef === null) gateRequestRef = request.requestRef;
  }

  let minted: { grantRef: string; token: string };
  try {
    minted = await deps.grantStore.mint({
      runRef: input.runRef,
      stageRef: input.stageRef,
      operation,
      subject: input.subject,
      gateRequestRef: gateRequestRef as string,
      ttlMs: deps.ttlMs,
    });
  } catch (error) {
    if (error instanceof SpendGrantError && error.code === 'grant-already-live') {
      // A live grant already exists for this (run, stage, operation). Its raw token was shown once, at the
      // first launch, and cannot be re-minted — so a later attempt's fresh worktree cannot be re-armed. Do
      // NOT mint a second live capability; surface it so the caller treats it as already provisioned.
      return { provisioned: false, reason: 'already-live', grantRef: error.grantRef };
    }
    throw error;
  }

  const write = deps.writeGrantFile ?? defaultWriteGrantFile;
  write(input.worktreePath, {
    token: minted.token,
    runRef: input.runRef,
    stageRef: input.stageRef,
    attemptRef: input.attemptRef,
    operationsAllowed: [operation],
    routeUrl: deps.routeUrl,
  });
  return { provisioned: true, grantRef: minted.grantRef, operation };
}

/**
 * Adapt {@link provisionAttemptSpendGrant} to the engine's `provisionSpendGrant` hook. A non-spending or
 * already-live stage is a silent no-op; a paid stage that somehow reached launch without a recorded spend
 * approval throws, failing that attempt rather than running a worker with no grant to spend against.
 */
export function createSpendGrantProvisioner(
  deps: ProvisionSpendGrantDeps,
): (input: ProvisionSpendGrantInput) => Promise<void> {
  return async (input) => {
    const result = await provisionAttemptSpendGrant(input, deps);
    if (!result.provisioned && result.reason === 'spend-authorization-not-approved') {
      throw new Error('paid stage reached launch without a recorded spend-gate approval');
    }
  };
}

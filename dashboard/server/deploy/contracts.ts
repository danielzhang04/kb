// Dashboard v3 P5 — W0 cross-language contracts for the desktop-helper protocol and the deploy-purpose
// T3 binding. Types and strict decoders ONLY: no client, no transport, no route, no store mutation
// (`plan §5 W0`). The helper client is W2; this module freezes the shapes both sides read.
//
// Two spec facts are transcribed here VERBATIM from the movement spec §3
// (`docs/specs/2026-08-20-desk-vm-movement-design.md:230,232`):
//   - the closed REQUEST verb union — `deploy {sourceCommit,attestationDigest,requestRef}`,
//     `pull-assets {intentRef,runRef,manifestDigest}`, `deployment-result {deploymentRef,outcome}`
//     ("accepts a closed verb union … no verb accepts paths, hosts, commands, or keys", movement:230);
//   - the canonical JSONL RECEIPT record — "time, request ref, short SHA, caller node, and outcome —
//     never secrets/signatures" (movement:232). movement §3 defines a LOCAL append-and-fsync log and no
//     wire response, so P5 REQUIRES the helper to reply with that record verbatim [P5-C46, P5-C52]; the
//     `HelperOutcome` and dashboard refusal-code union below are plan-owned projections that never cross
//     the wire.
import {
  ContractDecodeError, closedObject, isCommitSha, isDigestSha256, requireString, sha256Hex,
} from '../write/durableManifest.ts';

// ---------------------------------------------------------------------------------------------------
// Helper REQUEST union — movement:230 verbatim. `[SPEC]`.
// ---------------------------------------------------------------------------------------------------

export type HelperVerb = 'deploy' | 'pull-assets' | 'deployment-result';
export const HELPER_VERBS: readonly HelperVerb[] = ['deploy', 'pull-assets', 'deployment-result'];

/** `deploy` moves the live release; only it may invoke the local signer (movement:230). */
export interface HelperDeployRequest {
  readonly verb: 'deploy';
  readonly sourceCommit: string;
  readonly attestationDigest: string;
  readonly requestRef: string;
}
export interface HelperPullAssetsRequest {
  readonly verb: 'pull-assets';
  readonly intentRef: string;
  readonly runRef: string;
  readonly manifestDigest: string;
}
export interface HelperDeploymentResultRequest {
  readonly verb: 'deployment-result';
  readonly deploymentRef: string;
  readonly outcome: DeploymentResultOutcome;
}
export type DeploymentResultOutcome = 'succeeded' | 'aborted' | 'failed';
export const DEPLOYMENT_RESULT_OUTCOMES: readonly DeploymentResultOutcome[] = [
  'succeeded', 'aborted', 'failed',
];

/**
 * The closed request union. An object literal carrying an extra key fails the excess-property check at
 * compile time, and `encodeHelperRequest` rejects it again at runtime before serialization — no verb
 * ever accepts a path, host, command, or key field (movement:230).
 */
export type HelperRequest =
  | HelperDeployRequest
  | HelperPullAssetsRequest
  | HelperDeploymentResultRequest;

const DEPLOY_REQUEST_KEYS = ['verb', 'sourceCommit', 'attestationDigest', 'requestRef'] as const;
const PULL_ASSETS_REQUEST_KEYS = ['verb', 'intentRef', 'runRef', 'manifestDigest'] as const;
const DEPLOYMENT_RESULT_REQUEST_KEYS = ['verb', 'deploymentRef', 'outcome'] as const;

/** Serialize-side wall: closed keys per verb, structural field validation, nothing path/key-shaped. */
export function encodeHelperRequest(request: HelperRequest): string {
  switch (request.verb) {
    case 'deploy': {
      const record = closedObject(request, DEPLOY_REQUEST_KEYS, 'helperRequest.deploy');
      if (!isCommitSha(record['sourceCommit'])) {
        throw new ContractDecodeError('helperRequest.deploy.sourceCommit', '40 lowercase hex required');
      }
      if (!isDigestSha256(record['attestationDigest'])) {
        throw new ContractDecodeError('helperRequest.deploy.attestationDigest', '64 lowercase hex required');
      }
      requireString(record, 'requestRef', 'helperRequest.deploy');
      break;
    }
    case 'pull-assets': {
      const record = closedObject(request, PULL_ASSETS_REQUEST_KEYS, 'helperRequest.pull-assets');
      requireString(record, 'intentRef', 'helperRequest.pull-assets');
      requireString(record, 'runRef', 'helperRequest.pull-assets');
      if (!isDigestSha256(record['manifestDigest'])) {
        throw new ContractDecodeError('helperRequest.pull-assets.manifestDigest', '64 lowercase hex required');
      }
      break;
    }
    case 'deployment-result': {
      const record = closedObject(request, DEPLOYMENT_RESULT_REQUEST_KEYS, 'helperRequest.deployment-result');
      requireString(record, 'deploymentRef', 'helperRequest.deployment-result');
      if (!DEPLOYMENT_RESULT_OUTCOMES.includes(record['outcome'] as DeploymentResultOutcome)) {
        throw new ContractDecodeError('helperRequest.deployment-result.outcome', 'closed outcome required');
      }
      break;
    }
    default:
      return assertNeverHelper(request);
  }
  return JSON.stringify(request);
}

function assertNeverHelper(request: never): never {
  throw new ContractDecodeError('helperRequest.verb', `closed verb union required, got ${JSON.stringify(request)}`);
}

// ---------------------------------------------------------------------------------------------------
// Helper RECEIPT record — movement:232 verbatim `[SPEC]`, and the derived internal HelperOutcome `[PLAN]`.
// ---------------------------------------------------------------------------------------------------

export type HelperReceiptOutcome = 'accepted' | 'refused' | 'failed';
export const HELPER_RECEIPT_OUTCOMES: readonly HelperReceiptOutcome[] = ['accepted', 'refused', 'failed'];

/**
 * The movement:232 receipt fields VERBATIM — time, request ref, short SHA, caller node, outcome — and
 * NOTHING else. The closed-key wall is the design 527 guarantee: a field resembling a signature or key
 * cannot decode.
 */
export interface HelperReceipt {
  readonly time: string;
  readonly requestRef: string;
  readonly shortSha: string;
  readonly callerNode: string;
  readonly outcome: HelperReceiptOutcome;
}

const HELPER_RECEIPT_KEYS = ['time', 'requestRef', 'shortSha', 'callerNode', 'outcome'] as const;
const SHORT_SHA = /^[0-9a-f]{7,40}$/;

export function decodeHelperReceipt(value: unknown): HelperReceipt {
  const record = closedObject(value, HELPER_RECEIPT_KEYS, 'helperReceipt');
  const shortSha = requireString(record, 'shortSha', 'helperReceipt');
  if (!SHORT_SHA.test(shortSha)) {
    throw new ContractDecodeError('helperReceipt.shortSha', '7-40 lowercase hex required');
  }
  const outcome = record['outcome'];
  if (!HELPER_RECEIPT_OUTCOMES.includes(outcome as HelperReceiptOutcome)) {
    throw new ContractDecodeError('helperReceipt.outcome', 'closed outcome required');
  }
  return {
    time: requireString(record, 'time', 'helperReceipt'),
    requestRef: requireString(record, 'requestRef', 'helperReceipt'),
    shortSha,
    callerNode: requireString(record, 'callerNode', 'helperReceipt'),
    outcome: outcome as HelperReceiptOutcome,
  };
}

/** Dashboard-internal projection of the receipt — invents no vocabulary [P5-C46]. */
export interface HelperOutcome {
  readonly verb: HelperVerb;
  readonly requestRef: string;
  readonly receiptAt: string;
  readonly shortSha: string;
  readonly callerNode: string;
  readonly outcome: HelperReceiptOutcome;
}

export function deriveHelperOutcome(verb: HelperVerb, receipt: HelperReceipt): HelperOutcome {
  return {
    verb,
    requestRef: receipt.requestRef,
    receiptAt: receipt.time,
    shortSha: receipt.shortSha,
    callerNode: receipt.callerNode,
    outcome: receipt.outcome,
  };
}

/**
 * Dashboard-side refusal codes carried by the route, NEVER by the wire [P5-C46, P5-C58]. `stale-revision`,
 * `misleading-symlink`, and `rollback` from the §9 attack table map into `revision-changed`,
 * `release-unavailable`, and no-code respectively; `confirm-required`/`deploy-required` close the union
 * for the crossed verb/candidate pair. `400 invalid-ref` / `400 invalid-revision` are parse refusals that
 * PRECEDE this union.
 */
export type HelperRefusalCode =
  | 'protocol-invalid'
  | 'helper-refused'
  | 'helper-failed'
  | 'helper-unreachable'
  | 'revision-changed'
  | 'pty-set-changed'
  | 'pty-not-confirmed'
  | 'release-unavailable'
  | 'confirm-required'
  | 'deploy-required';
export const HELPER_REFUSAL_CODES: readonly HelperRefusalCode[] = [
  'protocol-invalid', 'helper-refused', 'helper-failed', 'helper-unreachable', 'revision-changed',
  'pty-set-changed', 'pty-not-confirmed', 'release-unavailable', 'confirm-required', 'deploy-required',
];

// ---------------------------------------------------------------------------------------------------
// DeployReadyPort — closed and UNIMPLEMENTED here [P5-C42]. W1 implements `deploy/deployReady.ts`.
// ---------------------------------------------------------------------------------------------------

export interface DeployReadyCandidate {
  readonly sha: string;
  readonly attestationDigest: string;
  readonly breaking: boolean;
}

/** A pure reader: `latestCandidate()` and nothing else — no timer, no store handle, no write path. */
export interface DeployReadyPort {
  latestCandidate(): DeployReadyCandidate | null;
}

const DEPLOY_READY_CANDIDATE_KEYS = ['sha', 'attestationDigest', 'breaking'] as const;

export function decodeDeployReadyCandidate(value: unknown): DeployReadyCandidate {
  const record = closedObject(value, DEPLOY_READY_CANDIDATE_KEYS, 'candidate');
  const sha = requireString(record, 'sha', 'candidate');
  if (!isCommitSha(sha)) throw new ContractDecodeError('candidate.sha', '40 lowercase hex required');
  if (!isDigestSha256(record['attestationDigest'])) {
    throw new ContractDecodeError('candidate.attestationDigest', '64 lowercase hex required');
  }
  if (typeof record['breaking'] !== 'boolean') {
    throw new ContractDecodeError('candidate.breaking', 'boolean required');
  }
  return { sha, attestationDigest: record['attestationDigest'] as string, breaking: record['breaking'] };
}

// ---------------------------------------------------------------------------------------------------
// Deploy-purpose T3 binding preimage [P5-C20, §3.3]. Reuses the SHIPPED refusal ladder; mints no code.
// ---------------------------------------------------------------------------------------------------

/** The three SHIPPED codes (`control/humanResponse.ts:144,145,149`). P5 mints none [P5-C20]. */
export type T3RefusalCode = 'ceremony-unavailable' | 'ceremony-invalid' | 'ceremony-expired';
export const T3_REFUSAL_CODES: readonly T3RefusalCode[] = [
  'ceremony-unavailable', 'ceremony-invalid', 'ceremony-expired',
];

export type DeployT3Subject = 'deployment' | 'pty-quiescence';
export const DEPLOY_T3_SUBJECTS: readonly DeployT3Subject[] = ['deployment', 'pty-quiescence'];

/** The four T3 verbs — Confirm included, since `movement:254` makes it the breaking entry verb [P5-C47]. */
export type DeployT3Decision = 'deploy' | 'confirm' | 'abort' | 'close-ptys-and-continue';
export const DEPLOY_T3_DECISIONS: readonly DeployT3Decision[] = [
  'deploy', 'confirm', 'abort', 'close-ptys-and-continue',
];

/** All five fields are REQUIRED; omitting `digest` fails to compile [W0 compile-negative]. */
export interface DeployT3Preimage {
  readonly subject: DeployT3Subject;
  readonly ref: string;
  readonly revision: string;
  readonly decision: DeployT3Decision;
  readonly digest: string;
}

export const DEPLOY_T3_PREIMAGE_PREFIX = 'kb.deploy-t3/v1';

/**
 * The canonical UTF-8 preimage `kb.deploy-t3/v1\0<subject>\0<ref>\0<revision>\0<decision>\0<digest>`
 * (§3.3). Verification recomputes this server-side from the store record and compares bytes; a
 * client-supplied preimage is never accepted.
 */
export function deployT3Preimage(input: DeployT3Preimage): string {
  if (!DEPLOY_T3_SUBJECTS.includes(input.subject)) {
    throw new ContractDecodeError('t3.subject', 'closed subject required');
  }
  if (!DEPLOY_T3_DECISIONS.includes(input.decision)) {
    throw new ContractDecodeError('t3.decision', 'closed decision required');
  }
  const ref = input.ref;
  const revision = input.revision;
  const digest = input.digest;
  if (typeof ref !== 'string' || ref.length === 0) throw new ContractDecodeError('t3.ref', 'non-empty string required');
  if (typeof revision !== 'string' || revision.length === 0) {
    throw new ContractDecodeError('t3.revision', 'non-empty string required');
  }
  if (typeof digest !== 'string' || digest.length === 0) {
    throw new ContractDecodeError('t3.digest', 'non-empty string required');
  }
  return [DEPLOY_T3_PREIMAGE_PREFIX, input.subject, ref, revision, input.decision, digest].join('\u0000');
}

/** Convenience hash of the preimage; the same value the challenge/verify path pins. */
export function deployT3Digest(input: DeployT3Preimage): string {
  return sha256Hex(deployT3Preimage(input));
}

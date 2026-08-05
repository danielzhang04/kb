/**
 * C4 — the deploy dispatcher: the client fetch layer that maps a VALIDATED DeployPlan (from the C2
 * artifact-type registry) onto an ALREADY-GOVERNED write endpoint. This module is deliberately thin:
 *
 *   - It writes NO files, chooses NO branch, and re-implements NO gate. `governedSave`/`launchCard` own
 *     the preamble→WebAuthn→path-confinement→branch-routing→audit discipline server-side; this is only the
 *     POST that hands them a payload and reads back the governed outcome.
 *   - endpoint 'launch' → POST /api/write/launch with the exact {project, action, target, riskTier, body}
 *     payload + `Bearer` header convention LaunchControls uses (so the day-one Task path is unchanged).
 *   - endpoint 'save'   → POST /api/write/save with {relpath, content, message}. It NEVER sends
 *     `workBranch`: the server owns durable branch selection and hard-403s a client-supplied main/ops
 *     target (routes.ts). Sending the key at all is the thing that trips that refusal, so we omit it.
 *   - No session token → a SYNCHRONOUS fail-closed nudge with NO fetch, mirroring LaunchControls exactly.
 *   - Multi-file artifacts (Project) deploy the PRIMARY file only in v1; the plan's `followUps` ride back
 *     in the result untouched so the UI can offer them as subsequent, individually-governed saves. We do
 *     NOT auto-fire N saves.
 *
 * `fetch` is injectable so the suite drives a fake — no real network, no real server, no real `claude`.
 */
import type { ArtifactKind, DeployPlan, FollowUp } from './artifactTypes';
import { invalidateSessionOnGovernedAuthFailure } from '../lib/authClient';

/** The injectable fetch seam (defaults to the global). Narrowed to what this module uses. */
export type DeployFetch = (url: string, init: RequestInit) => Promise<Response>;

export interface RunnerDispatch {
  status: 'triggered' | 'unbound' | 'unavailable' | 'failed';
  owner: string;
  task?: string;
  detail?: string;
}

/** A governed write that landed. `cardId`/`cardPath` come back from the launch endpoint; `target` (the
 *  branch/PR info) from the save endpoint. `followUps` carries a multi-file artifact's remaining rendered
 *  files back untouched for the UI to offer as subsequent saves. */
export interface DeploySuccess {
  ok: true;
  kind: ArtifactKind;
  cardId?: string;
  cardPath?: string;
  runner?: RunnerDispatch;
  target?: string;
  followUps?: FollowUp[];
}

/** A refusal, surfaced legibly. `status` is the HTTP status (absent only for the synchronous no-session
 *  nudge, where no request was made); `error` is the server's error code when present (e.g. 'save-refused',
 *  the 409 'approval-locked' shape used elsewhere); `reason` is the human-readable passthrough. */
export interface DeployRefusal {
  ok: false;
  status?: number;
  error?: string;
  reason: string;
}

export type DeployResult = DeploySuccess | DeployRefusal;

/** The fail-closed nudge text — mirrors LaunchControls' no-session copy so the UX reads the same. */
const NO_SESSION_NUDGE = 'no session — the dashboard is locked';

/** Compose a sensible durable commit message from the plan (the server would otherwise default it). Kept
 *  legible and kind-aware so the eventual PR/commit says what Composer deployed. */
function commitMessage(plan: DeployPlan): string {
  return `feat(${plan.kind}): deploy ${plan.relpath} via composer`;
}

/** Read a governed refusal body into {error, reason}. The two endpoints shape refusals differently: `save`
 *  replies {error, reason} (and the 409 approval-locked shape does too); `launch` replies {error, detail}
 *  where `error` IS the reason. So prefer an explicit `reason`, else fall back to `error`, else the status. */
async function refusalOf(res: Response): Promise<DeployRefusal> {
  let body: { error?: string; reason?: string } = {};
  try {
    body = (await res.json()) as { error?: string; reason?: string };
  } catch {
    /* non-JSON error body — fall through to the status-derived reason below */
  }
  const reason = body.reason ?? body.error ?? `${res.status}`;
  // Only surface `error` as a distinct code when it isn't merely echoing the reason (the launch case).
  const result: DeployRefusal = { ok: false, status: res.status, reason };
  if (body.error && body.error !== reason) result.error = body.error;
  return result;
}

/** POST a governed write with the shared bearer/JSON convention. */
async function post(fetchImpl: DeployFetch, url: string, sessionToken: string, payload: unknown): Promise<Response> {
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${sessionToken}` },
    body: JSON.stringify(payload),
  });
  await invalidateSessionOnGovernedAuthFailure(response);
  return response;
}

/**
 * Deploy a validated plan to its governed endpoint. Fail-closed with no session (no fetch). Otherwise POST
 * the endpoint's exact payload and map the response to a legible result. Never throws on a governed
 * refusal — a network fault is the only rejection path.
 */
export async function deploy(
  plan: DeployPlan,
  sessionToken: string | undefined,
  fetchImpl: DeployFetch = fetch,
): Promise<DeployResult> {
  // Fail-closed, synchronously, with NO fetch — mirrors LaunchControls' no-session behaviour exactly.
  if (!sessionToken) {
    return { ok: false, reason: NO_SESSION_NUDGE };
  }

  if (plan.endpoint === 'launch') {
    // The launch payload is the plan's launchFields verbatim — {project, action, target, riskTier, body} —
    // exactly what LaunchControls POSTs. (launchFields is always present on a task plan per the registry.)
    const res = await post(fetchImpl, '/api/write/launch', sessionToken, plan.launchFields);
    if (!res.ok) return refusalOf(res);
    const data = (await res.json()) as { cardId?: string; cardPath?: string; runner?: RunnerDispatch };
    return { ok: true, kind: plan.kind, cardId: data.cardId, cardPath: data.cardPath, runner: data.runner };
  }

  // endpoint === 'save' → a single durable relpath. NEVER include workBranch: the server owns the branch.
  const res = await post(fetchImpl, '/api/write/save', sessionToken, {
    relpath: plan.relpath,
    content: plan.content,
    message: commitMessage(plan),
  });
  if (!res.ok) return refusalOf(res);
  const data = (await res.json()) as { target?: string };
  // v1 primary-file-only: return the plan's followUps untouched for the UI to offer as subsequent saves.
  const result: DeploySuccess = { ok: true, kind: plan.kind, target: data.target };
  if (plan.followUps) result.followUps = plan.followUps;
  return result;
}

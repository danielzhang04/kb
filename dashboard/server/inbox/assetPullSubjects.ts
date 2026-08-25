// Dashboard v3 P5 W3 — the Inbox projector extension for the asset-pull arm (§3.2, movement:256). Pure
// projection over an injected read-only `AssetPullIntentsReaderPort`: no store write, no subprocess, no
// retry-loop side effect. `succeeded` vanishes on the helper receipt (design 266); `pending` offers
// Pull, `failed`/`offline` offer Retry and stay visible/retryable, `in-flight` offers Inspect only.
import { ContractDecodeError, sha256Hex } from '../write/durableManifest.ts';
import {
  assetPullItemId,
  type AssetPullIntent, type AssetPullState,
} from './deploymentContracts.ts';

export interface AssetPullInboxItem {
  readonly kind: 'asset-pull';
  readonly id: string;
  readonly createdAt: string;
  /** Content hash over the record's mutable fields — there is no store revision number for intents. */
  readonly revision: string;
  readonly subject: { readonly intentRef: string; readonly runRef: string; readonly manifestDigest: string };
  readonly title: string;
  readonly state: AssetPullState;
}

export interface AssetPullIntentsReaderPort {
  readonly listAssetPullIntents: () => readonly AssetPullIntent[];
}

function assetPullRevision(intent: AssetPullIntent): string {
  return sha256Hex(JSON.stringify([
    intent.intentRef, intent.state, intent.attempts, intent.result,
  ]));
}

function assetPullTitle(intent: AssetPullIntent): string {
  return `Pull assets for ${intent.runRef}`;
}

/** `succeeded` vanishes; every other closed state projects one item (§3.2). */
export function projectAssetPullItem(intent: AssetPullIntent): AssetPullInboxItem | null {
  if (intent.state === 'succeeded') return null;
  return {
    kind: 'asset-pull',
    id: assetPullItemId(intent.intentRef),
    createdAt: intent.requestedAt,
    revision: assetPullRevision(intent),
    subject: { intentRef: intent.intentRef, runRef: intent.runRef, manifestDigest: intent.manifestDigest },
    title: assetPullTitle(intent),
    state: intent.state,
  };
}

export type AssetPullSourceState =
  | { readonly status: 'ok' }
  | { readonly status: 'failed'; readonly errorCode: 'unavailable' };

export interface AssetPullSubjectsResult {
  readonly items: readonly AssetPullInboxItem[];
  readonly state: AssetPullSourceState;
}

function compareById(a: { readonly id: string }, b: { readonly id: string }): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** A failed read yields a `failed` source row and empty items — never a false-empty `ok`. */
export function projectAssetPullSubjects(reader: AssetPullIntentsReaderPort): AssetPullSubjectsResult {
  try {
    const items = reader.listAssetPullIntents()
      .map(projectAssetPullItem)
      .filter((item): item is AssetPullInboxItem => item !== null)
      .sort(compareById);
    return { items, state: { status: 'ok' } };
  } catch (error) {
    if (error instanceof ContractDecodeError) throw error;
    return { items: [], state: { status: 'failed', errorCode: 'unavailable' } };
  }
}

// P6 W0 §3.4: the v1 success/error envelope [design:420 verbatim]. Fields not meaningful to a kind are
// ABSENT, never null; there is no universal `revision` domain. Builders only — no route.
import type { V1Action } from './contracts.ts';

export interface V1SuccessMeta {
  readonly etag?: string;
  readonly watermark?: string;
  readonly nextCursor?: string;
}

export interface V1SuccessEnvelope<K extends string = string, D = unknown> {
  readonly apiVersion: 'v1';
  readonly kind: K;
  readonly data: D;
  readonly meta: V1SuccessMeta;
  readonly actions?: readonly V1Action[];
}

export interface V1ErrorMeta {
  readonly currentEtag?: string;
  readonly currentWatermark?: string;
}

export interface V1ErrorEnvelope {
  readonly apiVersion: 'v1';
  readonly error: { readonly code: string; readonly message: string; readonly retryable: boolean };
  readonly meta: V1ErrorMeta;
}

export interface V1SuccessOptions {
  readonly etag?: string;
  readonly watermark?: string;
  readonly nextCursor?: string;
  readonly actions?: readonly V1Action[];
}

/**
 * Build a v1 success envelope. `meta` carries only the fields present in `opts`, so a kind that has no
 * ETag emits no `etag` key at all. `actions` is absent (not `[]`) when none are supplied.
 */
export function v1Success<K extends string, D>(
  kind: K, data: D, opts: V1SuccessOptions = {},
): V1SuccessEnvelope<K, D> {
  const meta: { etag?: string; watermark?: string; nextCursor?: string } = {};
  if (opts.etag !== undefined) meta.etag = opts.etag;
  if (opts.watermark !== undefined) meta.watermark = opts.watermark;
  if (opts.nextCursor !== undefined) meta.nextCursor = opts.nextCursor;
  const envelope: { apiVersion: 'v1'; kind: K; data: D; meta: V1SuccessMeta; actions?: readonly V1Action[] } = {
    apiVersion: 'v1', kind, data, meta,
  };
  if (opts.actions !== undefined && opts.actions.length > 0) envelope.actions = opts.actions;
  return envelope;
}

export interface V1ErrorOptions {
  readonly currentEtag?: string;
  readonly currentWatermark?: string;
}

/** Build a v1 error envelope. `meta` omits `currentEtag`/`currentWatermark` when not applicable. */
export function v1Error(
  code: string, message: string, retryable: boolean, opts: V1ErrorOptions = {},
): V1ErrorEnvelope {
  const meta: { currentEtag?: string; currentWatermark?: string } = {};
  if (opts.currentEtag !== undefined) meta.currentEtag = opts.currentEtag;
  if (opts.currentWatermark !== undefined) meta.currentWatermark = opts.currentWatermark;
  return { apiVersion: 'v1', error: { code, message, retryable }, meta };
}

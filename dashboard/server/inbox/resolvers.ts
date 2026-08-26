// P4 section 3.3: the two Inbox resolvers.
//
// The PR resolver runs the PINNED literal read `gh pr list --repo <owner>/<repo> --state open
// --limit 101 --json number,title,createdAt` as a 15-second read [P4-C25], with `<owner>/<repo>`
// coming only from W0's composition-time pin (`server/runtime/repoPin.ts`) [P4-C35]. The subprocess
// is an INJECTED port, so this module spawns nothing itself and no test ever reaches a real `gh`.
//
// The run and STOP resolvers create or link escalation cards. Runs and STOP are never Inbox
// subjects (`design:244-273,597`), so nothing here emits an item kind, a next-fire, or a run gate.
import { sha256Hex } from '../shared/hashing.ts';
import type { RepositoryPin } from '../runtime/repoPin.ts';
import {
  PR_LIST_ROW_LIMIT, PR_LIST_TIMEOUT_MS, ghPrListArgv, inboxItemId, prHref, prSubjectKeyString,
  runSourceKey, stopSourceKey, type InboxSourceErrorCode, type PrSubject, type PrSubjectKey,
} from './contracts.ts';
import type { PrRead } from './sourceCache.ts';

export interface SubprocessRequest {
  readonly command: 'gh';
  readonly argv: readonly string[];
  readonly timeoutMs: number;
}
export interface SubprocessResult {
  readonly ok: boolean;
  readonly stdout: string;
  readonly timedOut?: boolean;
}
export type SubprocessPort = (request: SubprocessRequest) => Promise<SubprocessResult>;

function sha256(value: string): string {
  return sha256Hex(value);
}

function failed(errorCode: InboxSourceErrorCode): PrRead {
  return { items: [], state: { status: 'failed', errorCode, stale: false } };
}

const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

const PR_ROW_KEYS = ['number', 'title', 'createdAt'] as const;

/**
 * The pinned argv carries `--json number,title,createdAt`, so stdout is a JSON ARRAY of objects
 * with exactly those three keys (boss-verified against real `gh` on this repo). The decoder is
 * CLOSED: a non-array, a non-object row, an extra or missing key, a non-integer or non-positive
 * number, a non-string title, or a createdAt that is not an ISO instant fails the WHOLE source as
 * `invalid` — never a partially-trusted item. Title text stays inert data: it is carried verbatim
 * into `title` and into the item revision, and it can never reach `number`, `id`, `href` or
 * `createdAt`, every one of which is rebuilt from the pin. JSON also removes the field-shifting
 * class outright — a tab, newline or ANSI escape inside a title is just more title bytes.
 */
function parseRow(pin: RepositoryPin, row: unknown): PrSubject | null {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return null;
  const record = row as Record<string, unknown>;
  if (Object.keys(record).length !== PR_ROW_KEYS.length) return null;
  for (const key of PR_ROW_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(record, key)) return null;
  }

  const number = record['number'];
  const title = record['title'];
  const createdAt = record['createdAt'];
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number <= 0) return null;
  if (typeof title !== 'string') return null;
  if (typeof createdAt !== 'string' || !ISO_INSTANT.test(createdAt)) return null;

  const subject: PrSubjectKey = { owner: pin.owner, repo: pin.repo, number };
  const key = prSubjectKeyString(subject);
  return {
    kind: 'pr',
    id: inboxItemId('pr', key),
    createdAt: new Date(createdAt).toISOString(),
    revision: prItemRevision(key, title, createdAt),
    subject,
    title,
    // Rebuilt from the pinned owner/repo/number; row text can never supply a href.
    href: prHref(subject),
  };
}

/** The PR item revision formula, exported so the fixture derives it instead of hand-typing a hash. */
export function prItemRevision(subjectKey: string, title: string, createdAt: string): string {
  return sha256(`pr ${subjectKey} ${title} ${createdAt}`);
}

/** createdAt desc, then id — the item order of section 3.3 restricted to one kind. */
function sortPrItems(items: PrSubject[]): PrSubject[] {
  return items.sort((left, right) => {
    if (left.createdAt !== right.createdAt) return left.createdAt < right.createdAt ? 1 : -1;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}

export async function readOpenPullRequests(
  pin: RepositoryPin,
  run: SubprocessPort,
  clock: () => string,
): Promise<PrRead> {
  let result: SubprocessResult;
  try {
    result = await run({ command: 'gh', argv: ghPrListArgv(pin.owner, pin.repo), timeoutMs: PR_LIST_TIMEOUT_MS });
  } catch {
    // A port that REJECTS (`gh` absent, spawn ENOENT, an auth helper crash) is the same closed
    // `unavailable` source failure as a non-zero exit. The rejection value is discarded unread, so
    // no message, path or stderr fragment can ride out of this boundary on it.
    return failed('unavailable');
  }
  // Browser error text is fixed copy: only the closed error code crosses this boundary, never stderr.
  if (!result.ok) return failed(result.timedOut === true ? 'timeout' : 'unavailable');

  let rows: unknown;
  try {
    // `gh` prints `[]` for an empty open list; treat blank stdout as that same empty array.
    rows = JSON.parse(result.stdout.trim() === '' ? '[]' : result.stdout);
  } catch {
    return failed('invalid');
  }
  if (!Array.isArray(rows)) return failed('invalid');
  if (rows.length > PR_LIST_ROW_LIMIT) return failed('overflow');

  const items: PrSubject[] = [];
  for (const row of rows) {
    const item = parseRow(pin, row);
    if (item === null) return failed('invalid');
    items.push(item);
  }
  sortPrItems(items);
  const verifiedAt = clock();
  const revision = sha256(items.map((item) => `${item.id}\u0000${item.revision}`).join(''));
  return { items, state: { status: 'verified', revision, verifiedAt } };
}

/**
 * Escalation card ids derive from the source `createdAt` plus the source-key hash (section 3.3), so
 * the same failure always addresses the same card and resolution cannot recreate one.
 *
 * TRUNCATION, deliberate and pinned by `escalationCardId derivation` in resolvers.test.ts: the id is
 * `<8 hex epoch seconds>-<first 8 hex of sha256(sourceKey)>`. `>>> 0` keeps the LOW 32 bits of the
 * epoch, so the timestamp half wraps outside 1970-01-01 .. 2106-02-07 (a pre-1970 createdAt maps to
 * its two's-complement value). Both halves are 32 bits because `project.ts` reads the same 8 hex
 * back (`project.ts:55` parses the epoch prefix, `project.ts:59` re-derives the item id), and the
 * card-id format is a W1 contract this unit may not widen. De-dup does NOT rest on the truncation:
 * `EscalationLookup` keys on the full source key, and the id only has to be stable, not unique
 * across a 136-year span.
 */
export function escalationCardId(createdAt: string, sourceKey: string): string {
  const seconds = Math.floor(Date.parse(createdAt) / 1000);
  if (!Number.isFinite(seconds)) throw new Error(`escalation createdAt is not an instant: ${createdAt}`);
  return `${(seconds >>> 0).toString(16).padStart(8, '0')}-${sha256(sourceKey).slice(0, 8)}`;
}

/** Longest `title` / `reason` an escalation request may carry into a `queue/` card. */
export const ESCALATION_TITLE_MAX = 200;
export const ESCALATION_REASON_MAX = 500;

/**
 * MARKDOWN BOUNDARY. `title` and `reason` originate in run output and STOP payloads, and W6.2
 * writes them into a `queue/` card that `project.ts` later re-reads. A value carrying a newline
 * could therefore forge frontmatter (a line break, then `---`, then `owner: codex`) or a section
 * header (a line break, then `## Work order`) that the card reader would believe. So the producer
 * bounds both fields HERE, at the only place the record is minted: every C0 control character,
 * DEL, every C1 control, and the Unicode line/paragraph separators collapse to a single space,
 * runs of spaces collapse, the value is trimmed, and an over-long value is truncated with a
 * one-character ellipsis. The result is ALWAYS a single line no longer than `max`.
 */
function singleLine(value: string, max: number): string {
  const flattened = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, ' ')
    .replace(/ {2,}/g, ' ')
    .trim();
  return flattened.length <= max ? flattened : `${flattened.slice(0, max - 1).trimEnd()}\u2026`;
}

/** `title` and `reason` are ALWAYS single-line and bounded; see `singleLine` below. */
export interface EscalationCardRequest {
  readonly cardId: string;
  readonly sourceKey: string;
  readonly createdAt: string;
  readonly title: string;
  readonly reason: string;
  readonly related: { readonly runRef?: string; readonly stopEvent?: string };
}

export type EscalationResolution =
  | { readonly outcome: 'existing'; readonly cardId: string }
  | { readonly outcome: 'request'; readonly request: EscalationCardRequest };

/**
 * Looks up BOTH open and completed cards for a source key. The caller supplies the lookup; a hit of
 * either state means no new escalation is requested.
 */
export type EscalationLookup = (sourceKey: string) => { readonly cardId: string; readonly state: 'open' | 'completed' } | null;

function resolve(
  sourceKey: string,
  createdAt: string,
  title: string,
  reason: string,
  related: { runRef?: string; stopEvent?: string },
  lookup: EscalationLookup,
): EscalationResolution {
  const existing = lookup(sourceKey);
  if (existing !== null) return { outcome: 'existing', cardId: existing.cardId };
  return {
    outcome: 'request',
    request: {
      cardId: escalationCardId(createdAt, sourceKey), sourceKey, createdAt,
      title: singleLine(title, ESCALATION_TITLE_MAX), reason: singleLine(reason, ESCALATION_REASON_MAX), related,
    },
  };
}

export interface RunEscalationInput {
  readonly runRef: string;
  readonly createdAt: string;
  readonly title: string;
  readonly reason: string;
  readonly stopBytesSha256?: string;
}

export function resolveRunEscalation(input: RunEscalationInput, lookup: EscalationLookup): EscalationResolution {
  const related: { runRef?: string; stopEvent?: string } = { runRef: input.runRef };
  if (input.stopBytesSha256 !== undefined) related.stopEvent = stopSourceKey(input.stopBytesSha256);
  return resolve(runSourceKey(input.runRef), input.createdAt, input.title, input.reason, related, lookup);
}

export interface StopEscalationInput {
  readonly stopBytesSha256: string;
  readonly createdAt: string;
  readonly title: string;
  readonly reason: string;
  readonly runRef?: string;
}

export function resolveStopEscalation(input: StopEscalationInput, lookup: EscalationLookup): EscalationResolution {
  const stopEvent = stopSourceKey(input.stopBytesSha256);
  // One card may link a run AND a STOP; those links never become separate items.
  const related: { runRef?: string; stopEvent?: string } = { ...(input.runRef === undefined ? {} : { runRef: input.runRef }), stopEvent };
  return resolve(stopEvent, input.createdAt, input.title, input.reason, related, lookup);
}

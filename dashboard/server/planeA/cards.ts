/**
 * Plane-A card parsing. A card is a markdown file (`queue/{inbox,working,approvals,done}/*.md`)
 * with YAML frontmatter (schema: governance/card-schema.md) and a `## Work order` / `## Evidence`
 * / `## Result` body.
 *
 * SECURITY INVARIANT: only the frontmatter is parsed into `meta`. The body — and in particular the
 * `## Evidence` block — is retained verbatim and NEVER interpreted. Evidence is inert data.
 *
 * We intentionally do NOT pull in a YAML dependency (none is available and D0.2 adds no deps). Card
 * frontmatter is a flat map of scalars, `null`, and simple inline lists (`depends-on: []` /
 * `[a, b]`) — a minimal, self-contained parser covers it exactly.
 */

export type CardFieldValue = string | number | boolean | null | string[];

export interface CardMeta {
  id: string;
  project: string | string[];
  action: string;
  target: string;
  'risk-tier': string;
  owner: string | null;
  state: string;
  [key: string]: CardFieldValue | undefined;
}

export interface ParsedCard {
  meta: CardMeta;
  body: string;
}

/** All seven schema card states (mirrors scripts/cards.py `STATES`). */
export const CARD_STATES = [
  'inbox',
  'blocked',
  'working',
  'done',
  'approvals',
  'approved',
  'rejected',
] as const;

/** Coerce a raw frontmatter scalar/list token into a JS value. */
function coerceScalar(raw: string): CardFieldValue {
  const v = raw.trim();
  if (v === '' || v === 'null' || v === '~') return null;
  if (v === 'true') return true;
  if (v === 'false') return false;

  // inline list: [] or [a, b, c] (items may be quoted)
  if (v.startsWith('[') && v.endsWith(']')) {
    const inner = v.slice(1, -1).trim();
    if (inner === '') return [];
    return inner.split(',').map((item) => stripQuotes(item.trim())).filter((item) => item !== '');
  }

  return stripQuotes(v);
}

function stripQuotes(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

/**
 * Parse a card's text into `{ meta, body }`. Splits the leading `---\n … \n---` frontmatter from the
 * body exactly like scripts/cards.py, then reads flat `key: value` lines. The body is returned
 * untouched.
 */
export function parseCardFrontmatter(text: string): ParsedCard {
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    throw new Error('card has no frontmatter');
  }
  // Strip the leading `---` fence, then split the frontmatter from the body at the closing fence.
  const head = text.replace(/^---\r?\n/, '');
  const fenceIdx = head.search(/\r?\n---\r?\n/);
  if (fenceIdx === -1) {
    throw new Error('card frontmatter is not terminated');
  }
  const fm = head.slice(0, fenceIdx);
  const body = head.slice(fenceIdx).replace(/^\r?\n---\r?\n/, '').replace(/^\r?\n+/, '');

  const meta: Record<string, CardFieldValue> = {};
  for (const line of fm.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue; // skip malformed / continuation lines defensively
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1);
    meta[key] = coerceScalar(rawValue);
  }

  return { meta: meta as CardMeta, body };
}

/** Group parsed cards by their `state` field. One bucket per state that appears. */
export function groupByState(cards: ParsedCard[]): Record<string, ParsedCard[]> {
  const grouped: Record<string, ParsedCard[]> = {};
  for (const card of cards) {
    const state = String(card.meta.state);
    (grouped[state] ??= []).push(card);
  }
  return grouped;
}

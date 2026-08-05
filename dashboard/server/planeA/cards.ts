/**
 * Plane-A card parsing. A card is a markdown file (`queue/{inbox,working,approvals,done}/*.md`)
 * with YAML frontmatter (schema: governance/card-schema.md) and a `## Work order` / `## Evidence`
 * / `## Result` body.
 *
 * SECURITY INVARIANT: only the frontmatter is parsed into `meta`. The body — and in particular the
 * `## Evidence` block — is retained verbatim and NEVER interpreted. Evidence is inert data.
 *
 * We intentionally do NOT pull in a YAML dependency. Card frontmatter is a flat map of scalars,
 * `null`, inline lists, and the scalar block lists `yaml.safe_dump` emits for the two schema-declared
 * list keys (`project`, `depends-on`). The narrow parser below recognises only those shapes — every
 * other block list or indented continuation is a parse error — and it never interprets body text.
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

/**
 * A card as it leaves a DTO builder: the parsed card plus the server-owned display identity
 * (`server/naming.ts`). The canonical `meta.id` is untouched — these two fields exist so no view has
 * to invent a human label from an id, and they are added by {@link ../planeA/indexer.ts#indexRepo},
 * never by the parser (which has no registry and must stay pure).
 */
export interface CardProjection extends ParsedCard {
  displayName: string;
  shortRef: number;
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

/**
 * The only list-valued keys governance/card-schema.md declares (`project: <org>|[orgs]`,
 * `depends-on: [ids]`). A block list under any other key is a parse error, never a silent string[]
 * behind a `string | null` field — `groupByState` would then String()-coerce `['working']` into a
 * bucket no `=== 'working'` comparison can ever match.
 */
const CARD_LIST_KEYS = new Set(['project', 'depends-on']);

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
  let pendingBlockList: string | null = null;
  for (const line of fm.split(/\r?\n/)) {
    if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
    // `yaml.safe_dump` emits sequence items at column zero beneath a scalar
    // key (`depends-on:\n- wf-root`).  Accept that canonical shape only;
    // indented continuations are deliberately rejected below so nested YAML
    // cannot be mistaken for card metadata.
    const blockItem = /^-\s+(.+?)\s*$/.exec(line);
    if (blockItem) {
      // `pendingBlockList` is only ever set for a schema-declared list key, so a block list under any
      // other key (`state:` followed by `- working`) lands here and is rejected.
      if (!pendingBlockList) throw new Error('card frontmatter has an unexpected block-list item');
      const item = coerceScalar(blockItem[1]);
      if (typeof item !== 'string') throw new Error('card frontmatter block-list items must be strings');
      const values = meta[pendingBlockList];
      if (!Array.isArray(values)) meta[pendingBlockList] = [];
      (meta[pendingBlockList] as string[]).push(item);
      continue;
    }
    if (/^\s/.test(line)) throw new Error('card frontmatter has an unsupported continuation');
    const colon = line.indexOf(':');
    if (colon === -1) continue; // skip malformed / continuation lines defensively
    const key = line.slice(0, colon).trim();
    const rawValue = line.slice(colon + 1);
    meta[key] = coerceScalar(rawValue);
    pendingBlockList = rawValue.trim() === '' && CARD_LIST_KEYS.has(key) ? key : null;
  }

  return { meta: meta as CardMeta, body };
}

/** Group parsed cards by their `state` field. One bucket per state that appears. Generic so the
 *  indexer can group already-projected cards without losing their display fields. */
export function groupByState<T extends ParsedCard>(cards: T[]): Record<string, T[]> {
  const grouped: Record<string, T[]> = {};
  for (const card of cards) {
    const state = String(card.meta.state);
    (grouped[state] ??= []).push(card);
  }
  return grouped;
}

/**
 * The card's human name. Cards carry no `title` field (governance/card-schema.md), so the dispatcher-set
 * `action` verb phrase IS the name an operator reads; an empty one leaves the naming registry to fall
 * back to a truncated id. `target` is deliberately excluded — it is a path, not a name.
 */
export function cardTitle(card: ParsedCard): string {
  return typeof card.meta.action === 'string' ? card.meta.action : '';
}

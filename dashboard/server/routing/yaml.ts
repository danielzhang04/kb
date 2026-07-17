/**
 * R2 — a focused YAML subset parser + a dedicated override-file serializer.
 *
 * The dashboard carries no YAML dependency (D0.2 added none; `planeA/cards.ts` hand-parses flat card
 * frontmatter for the same reason). Phase R needs to read two real YAML files whose shapes are known
 * and small — `governance/model-routing.yaml` (nested block maps + inline flow maps/seqs) and
 * `queue/routing-override.yaml` (a `version` scalar + an `overrides:` block sequence of flat maps) —
 * and to REWRITE the override file. This module implements exactly the subset those two files use:
 *
 *   - block mappings (indentation-based), block sequences (`- ` items, same-indent or indented style),
 *   - inline flow maps `{ a: b, c: d }` and flow sequences `[a, b, c]` / `[]`,
 *   - quoted keys/values (`"*"`), `#` line comments (quote/bracket-aware),
 *   - scalar coercion: `null`/`~`/empty -> null, `true`/`false` -> bool, integers -> number, else string.
 *
 * It is server-only (never in the client import graph) and pure. It is NOT a general YAML engine: block
 * scalars (`|`/`>`), anchors, multi-doc, and nested block sequences-of-sequences are intentionally out
 * of scope. The parser is defensive (a shape it does not understand degrades to null/skip, never throws
 * on structure) so a hand-edit that drifts fails OPEN to policy at the loader layer, mirroring the
 * Python `routing.load_*` posture.
 */

export type YamlValue = string | number | boolean | null | YamlValue[] | { [k: string]: YamlValue };

interface Line {
  indent: number;
  content: string;
  /** true when this line began a block-sequence item (`- ...`); its content/indent are post-`- `. */
  dash: boolean;
}

/** Strip a trailing `#` comment, honouring single/double quotes and `{}`/`[]` nesting so a `#` inside a
 *  value or flow collection is never mistaken for a comment. A `#` only starts a comment at line start
 *  or after whitespace. */
function stripComment(raw: string): string {
  let inS = false;
  let inD = false;
  let depth = 0;
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (!inS && !inD && (ch === '{' || ch === '[')) depth += 1;
    else if (!inS && !inD && (ch === '}' || ch === ']')) depth -= 1;
    else if (ch === '#' && !inS && !inD && depth === 0 && (i === 0 || /\s/.test(raw[i - 1]))) {
      return raw.slice(0, i);
    }
  }
  return raw;
}

/** Tokenize source into significant lines (comments/blanks dropped), normalising `- ` sequence markers
 *  into a `dash` flag with the content shifted two columns right (so a dash item always nests deeper
 *  than the key it hangs under, whether written same-indent or indented). */
function tokenize(text: string): Line[] {
  const out: Line[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const noComment = stripComment(rawLine);
    if (noComment.trim() === '') continue;
    const indent = noComment.length - noComment.trimStart().length;
    let content = noComment.trimStart();
    let dash = false;
    if (content === '-' || content.startsWith('- ')) {
      dash = true;
      const after = content === '-' ? '' : content.slice(2);
      out.push({ indent: indent + 2, content: after.trim(), dash });
      continue;
    }
    out.push({ indent, content: content.trim(), dash });
  }
  return out;
}

/** Split top-level commas (honouring quotes + `{}`/`[]` nesting) for flow-collection parsing. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let buf = '';
  let inS = false;
  let inD = false;
  let depth = 0;
  for (const ch of s) {
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (!inS && !inD && (ch === '{' || ch === '[')) depth += 1;
    else if (!inS && !inD && (ch === '}' || ch === ']')) depth -= 1;
    if (ch === ',' && !inS && !inD && depth === 0) {
      parts.push(buf);
      buf = '';
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== '') parts.push(buf);
  return parts;
}

/** Find the index of the key/value `:` separator (first colon not inside quotes/brackets), or -1. */
function keyColon(s: string): number {
  let inS = false;
  let inD = false;
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "'" && !inD) inS = !inS;
    else if (ch === '"' && !inS) inD = !inD;
    else if (!inS && !inD && (ch === '{' || ch === '[')) depth += 1;
    else if (!inS && !inD && (ch === '}' || ch === ']')) depth -= 1;
    else if (ch === ':' && !inS && !inD && depth === 0) {
      // a mapping colon must be followed by end-of-string or whitespace (so `http://x` is not split)
      if (i + 1 >= s.length || /\s/.test(s[i + 1])) return i;
    }
  }
  return -1;
}

function stripQuotes(v: string): string {
  const t = v.trim();
  // A DOUBLE-quoted scalar is JSON-unescaped (\n/\t/\r/\uXXXX -> the real char) so it round-trips the
  // allowlist serializer's JSON.stringify emission exactly. Malformed escapes fall back to a literal
  // strip (defensive: the parser never throws on a value it does not fully understand).
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    try {
      const parsed = JSON.parse(t);
      if (typeof parsed === 'string') return parsed;
    } catch {
      /* fall through to a literal strip */
    }
    return t.slice(1, -1);
  }
  // A SINGLE-quoted scalar is taken literally (no escape processing), matching YAML single-quote semantics
  // and the subset we emit (we never emit single quotes).
  if (t.length >= 2 && t.startsWith("'") && t.endsWith("'")) {
    return t.slice(1, -1);
  }
  return t;
}

/** Coerce a bare scalar token to its JS value. */
export function coerceScalar(raw: string): YamlValue {
  const t = raw.trim();
  if (t === '' || t === 'null' || t === '~') return null;
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (t.startsWith('"') || t.startsWith("'")) return stripQuotes(t);
  if (/^-?\d+$/.test(t)) return Number(t);
  return t;
}

/** Parse an inline (flow) value: a flow map, a flow sequence, or a scalar. */
function parseInline(raw: string): YamlValue {
  const t = raw.trim();
  if (t.startsWith('{') && t.endsWith('}')) {
    const inner = t.slice(1, -1).trim();
    const obj: { [k: string]: YamlValue } = {};
    if (inner === '') return obj;
    for (const part of splitTopLevel(inner)) {
      const c = keyColon(part);
      if (c === -1) continue;
      const key = stripQuotes(part.slice(0, c));
      obj[key] = parseInline(part.slice(c + 1));
    }
    return obj;
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (inner === '') return [];
    return splitTopLevel(inner).map((p) => parseInline(p));
  }
  return coerceScalar(t);
}

/** Parse the node beginning at `lines[i]`, returning `[value, nextIndex]`. */
function parseNode(lines: Line[], i: number): [YamlValue, number] {
  if (i >= lines.length) return [null, i];
  const indent = lines[i].indent;

  // Block sequence: consecutive dash items at this indent.
  if (lines[i].dash) {
    const items: YamlValue[] = [];
    let j = i;
    while (j < lines.length && lines[j].indent === indent && lines[j].dash) {
      // The item's inner lines: this dash line (as a plain line) + following lines that belong to it
      // (strictly deeper, or a same-indent non-dash sibling key of the item's own map).
      const inner: Line[] = [{ indent, content: lines[j].content, dash: false }];
      let k = j + 1;
      while (k < lines.length && (lines[k].indent > indent || (lines[k].indent === indent && !lines[k].dash))) {
        inner.push(lines[k]);
        k += 1;
      }
      items.push(inner.length === 1 && inner[0].content === '' ? null : parseNode(inner, 0)[0]);
      j = k;
    }
    return [items, j];
  }

  // A lone scalar line (no mapping colon) is a scalar node.
  if (keyColon(lines[i].content) === -1) {
    return [coerceScalar(lines[i].content), i + 1];
  }

  // Block mapping: consecutive `key: value` lines at this indent.
  const obj: { [k: string]: YamlValue } = {};
  let j = i;
  while (j < lines.length && lines[j].indent === indent && !lines[j].dash) {
    const c = keyColon(lines[j].content);
    if (c === -1) {
      j += 1;
      continue;
    }
    const key = stripQuotes(lines[j].content.slice(0, c));
    const rest = lines[j].content.slice(c + 1).trim();
    if (rest !== '') {
      obj[key] = parseInline(rest);
      j += 1;
      continue;
    }
    // Empty value: a nested block on the following deeper (or dash-normalised deeper) lines.
    if (j + 1 < lines.length && lines[j + 1].indent > indent) {
      const [val, next] = parseNode(lines, j + 1);
      obj[key] = val;
      j = next;
    } else {
      obj[key] = null;
      j += 1;
    }
  }
  return [obj, j];
}

/**
 * Parse a YAML-subset document into a JS value. A structurally-unrecognised document degrades to `null`
 * rather than throwing (the loader layer treats that as absent -> fail open).
 */
export function parseYaml(text: string): YamlValue {
  const lines = tokenize(text);
  if (lines.length === 0) return null;
  return parseNode(lines, 0)[0];
}

// --------------------------------------------------------------------------- //
// Dedicated serializer for queue/routing-override.yaml ONLY.                    //
// --------------------------------------------------------------------------- //
export interface SerializableOverrideEntry {
  scope: string;
  key: string;
  runtime?: string | null;
  model?: string | null;
  expires?: string | null;
  'set-by'?: string | null;
  'set-at'?: string | null;
}

/** Field emission order for an override entry (matches the proposal §2 schema example). */
const ENTRY_FIELD_ORDER: Array<keyof SerializableOverrideEntry> = [
  'scope',
  'key',
  'runtime',
  'model',
  'expires',
  'set-by',
  'set-at',
];

/** Characters allowed in a BARE (unquoted) scalar — an ALLOWLIST (LOW-2/LOW-3). Anything outside it
 *  (control chars, spaces, YAML flow/indicator chars, `:` `*` `#` `~` ...) forces a JSON-quoted emission. */
const BARE_SCALAR_RE = /^[A-Za-z0-9._/@-]+$/;

/** Tokens that are legal bare per {@link BARE_SCALAR_RE} but which YAML (and this parser's `coerceScalar`)
 *  would COERCE away from a string: null/bool/number forms. Emitting these bare would silently change a
 *  string key/value's type on round-trip, so they are always quoted. Case-insensitive (YAML `TRUE`/`Null`). */
const YAML_COERCIBLE_RE =
  /^(?:null|~|true|false|yes|no|on|off|[+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|[+-]?\.(?:inf|nan))$/i;

/**
 * Emit a scalar value with ALLOWLIST quoting: bare ONLY when it matches {@link BARE_SCALAR_RE} and is not
 * a YAML-coercible token; otherwise `JSON.stringify`-quoted. JSON quoting is round-trip-exact with this
 * module's `stripQuotes` (which JSON-unescapes double-quoted scalars), and loads identically under Python
 * `yaml.safe_load`. Closes LOW-2 (raw \n/\r/\t emitted bare) and LOW-3 ("null"/"true"/"123" re-coerced).
 */
function emitScalar(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v !== 'string') return String(v);
  if (BARE_SCALAR_RE.test(v) && !YAML_COERCIBLE_RE.test(v)) return v;
  return JSON.stringify(v);
}

/**
 * Serialize the override document to canonical YAML. Only the fields present on each entry are emitted
 * (a partial `model`-only entry stays partial); `expires: null` IS emitted (an explicit "no expiry" is
 * meaningful provenance). Deterministic field order keeps the committed file diff-friendly.
 */
export function serializeOverride(doc: { version: number; overrides: SerializableOverrideEntry[] }): string {
  const lines: string[] = [
    '# queue/routing-override.yaml — ops-side fast routing override (dashboard-written, WebAuthn-gated,',
    '# audited). NOT governance: a coordination artifact written at runtime through the governed ops',
    '# path (pull-rebase-push). scripts/routing.py:load_override() reads it override-over-policy. Absent',
    '# / empty / malformed -> treated as {overrides: []} (fall back to policy). See',
    '# docs/proposals/model-routing-yaml-proposal.md §2.',
    `version: ${doc.version}`,
  ];
  if (doc.overrides.length === 0) {
    lines.push('overrides: []');
    return `${lines.join('\n')}\n`;
  }
  lines.push('overrides:');
  for (const entry of doc.overrides) {
    let first = true;
    for (const field of ENTRY_FIELD_ORDER) {
      if (!(field in entry)) continue;
      const value = entry[field];
      if (value === undefined) continue;
      const prefix = first ? '  - ' : '    ';
      lines.push(`${prefix}${field}: ${emitScalar(value)}`);
      first = false;
    }
  }
  return `${lines.join('\n')}\n`;
}

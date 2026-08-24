/**
 * Static source-flow scan for the one capability the OS must never decide (plan section 9).
 *
 * `pty` is the discriminant of a closed capability: it may only ever come from an actual probe
 * result. A `process.platform === 'win32'` shortcut would produce a dashboard that claims a working
 * terminal on a host that has none — the exact false-availability P3 exists to close.
 *
 * The scan is deliberately narrow. It flags an OS-derived symbol ONLY inside the expression subtree
 * that produces a `pty` value: a `pty:` property initializer, an assignment to `pty`/`.pty`, a `pty`
 * variable initializer, or a `return` expression of a function declared to return a PTY capability.
 * Sibling properties of a conforming `{pty:false, diagnostic:{reason: platform === ...}}` result are
 * NOT in that subtree, so constructing and consuming both probe branches stays legal.
 *
 * The repo pins `typescript@7`, whose npm package exposes no compiler API, so the extents below come
 * from a small scanner of this file's own: comments and string/template BODIES are blanked (offsets
 * preserved) and expression ends are found by bracket balancing. Blanking is why a forbidden symbol
 * inside a comment or a string never counts, and why a `,` inside a nested call never ends an extent.
 */

/** Expressions that read the operating system directly rather than a probe result. */
export const OS_DERIVED_SYMBOLS: readonly string[] = [
  'process.platform',
  'process.arch',
  'os.platform',
  'os.type',
  'os.arch',
  'os.release',
  'navigator.platform',
  'navigator.userAgent',
];

const OS_MODULE_MEMBERS = ['platform', 'type', 'arch', 'release'];

/** A function's declared return type that makes its `return` expressions pty sinks. */
const PTY_RETURN_TYPE = /:\s*(?:Promise\s*<\s*)?(?:PublicPtyCapability|PtyCapabilityProbe|PtyCapability|PtyAvailability)\b/g;

export interface PtySourceFinding {
  /** Repo-relative source path. */
  path: string;
  /** 1-based line of the offending OS-derived symbol. */
  line: number;
  /** What produced the `pty` value. */
  sink: 'property' | 'assignment' | 'variable' | 'return';
  /** The OS-derived expression text, e.g. `process.platform`. */
  symbol: string;
  /** Empty when written inline; otherwise the local bindings the flow was traced through. */
  through: string[];
}

export interface ScannedSource { path: string; text: string }

/**
 * Returns a same-length copy of `text` with comment and string/template bodies replaced by spaces,
 * so every offset still lines up with the original but no literal or comment can be mistaken for code.
 */
export function blankLiterals(text: string): string {
  const out = text.split('');
  const blank = (from: number, to: number): void => {
    for (let index = from; index < to && index < out.length; index += 1) {
      if (out[index] !== '\n') out[index] = ' ';
    }
  };
  let index = 0;
  while (index < text.length) {
    const two = text.slice(index, index + 2);
    if (two === '//') {
      const end = text.indexOf('\n', index);
      blank(index, end === -1 ? text.length : end);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (two === '/*') {
      const end = text.indexOf('*/', index + 2);
      blank(index, end === -1 ? text.length : end + 2);
      index = end === -1 ? text.length : end + 2;
      continue;
    }
    const quote = text[index];
    if (quote === '"' || quote === "'" || quote === '`') {
      let cursor = index + 1;
      while (cursor < text.length) {
        if (text[cursor] === '\\') { cursor += 2; continue; }
        if (text[cursor] === quote) break;
        cursor += 1;
      }
      blank(index + 1, cursor);
      index = cursor + 1;
      continue;
    }
    index += 1;
  }
  return out.join('');
}

const OPENERS = '([{';
const CLOSERS = ')]}';

/**
 * End offset (exclusive) of the expression starting at `start` in already-blanked `code`: the first
 * depth-zero `,` or `;`, or the closer of the bracket that encloses it.
 */
export function expressionEnd(code: string, start: number): number {
  let depth = 0;
  for (let index = start; index < code.length; index += 1) {
    const char = code[index];
    if (OPENERS.includes(char)) depth += 1;
    else if (CLOSERS.includes(char)) {
      if (depth === 0) return index;
      depth -= 1;
    } else if (depth === 0 && (char === ',' || char === ';')) return index;
  }
  return code.length;
}

/** End offset (exclusive) of the block whose `{` is at `open`. */
function blockEnd(code: string, open: number): number {
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '{') depth += 1;
    else if (code[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return code.length;
}

const lineOf = (text: string, offset: number): number => {
  let line = 1;
  for (let index = 0; index < offset && index < text.length; index += 1) if (text[index] === '\n') line += 1;
  return line;
};

/** Names imported from `node:os` that read the OS, plus any `* as os` namespace. */
function osBindings(code: string): { namespaces: string[]; named: string[] } {
  const namespaces: string[] = [];
  const named: string[] = [];
  for (const match of code.matchAll(/import\s+([^;]+?)\s+from\s+(['"])\s*(?:node:)?os\s*\2/g)) {
    const clause = match[1];
    const namespace = /\*\s+as\s+([\w$]+)/.exec(clause);
    if (namespace !== null) { namespaces.push(namespace[1]); continue; }
    const namedClause = /\{([^}]*)\}/.exec(clause);
    if (namedClause === null) continue;
    for (const entry of namedClause[1].split(',')) {
      const parts = entry.trim().split(/\s+as\s+/);
      const original = parts[0].trim();
      const local = (parts[1] ?? parts[0]).trim();
      if (OS_MODULE_MEMBERS.includes(original) && local.length > 0) named.push(local);
    }
  }
  return { namespaces, named };
}

/** The tightest `{ ... }` enclosing `offset`, or the whole file. Gives bindings a lexical scope. */
export function enclosingBlock(code: string, offset: number): { start: number; end: number } {
  const stack: number[] = [];
  let innermost = { start: 0, end: code.length };
  for (let index = 0; index < code.length; index += 1) {
    if (code[index] === '{') stack.push(index);
    else if (code[index] === '}') {
      const open = stack.pop();
      if (open !== undefined && open <= offset && index >= offset
        && (open > innermost.start || index < innermost.end)) {
        innermost = { start: open, end: index };
      }
    }
  }
  return innermost;
}

/**
 * `const|let|var NAME = <expr>` bindings, so a laundered flow is still traced. Each carries the block
 * it was declared in: without that, a `const platform = process.platform` in one function would make
 * every unrelated `platform` in the file look OS-derived.
 */
function localBindings(code: string): Map<string, { start: number; end: number; scope: { start: number; end: number } }> {
  const bindings = new Map<string, { start: number; end: number; scope: { start: number; end: number } }>();
  for (const match of code.matchAll(/\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]*)?=\s*(?!=)/g)) {
    const start = match.index + match[0].length;
    if (!bindings.has(match[1])) {
      bindings.set(match[1], { start, end: expressionEnd(code, start), scope: enclosingBlock(code, match.index) });
    }
  }
  return bindings;
}

const MAX_FLOW_DEPTH = 4;

/** OS-derived symbols in `code[start,end)`, following local bindings up to `MAX_FLOW_DEPTH`. */
function scanExtent(
  code: string,
  text: string,
  path: string,
  sink: PtySourceFinding['sink'],
  extent: { start: number; end: number },
  context: {
    namespaces: string[];
    named: string[];
    bindings: Map<string, { start: number; end: number; scope: { start: number; end: number } }>;
  },
  through: string[],
  seen: Set<string>,
  findings: PtySourceFinding[],
): void {
  const slice = code.slice(extent.start, extent.end);
  const direct = [
    ...OS_DERIVED_SYMBOLS,
    ...context.namespaces.flatMap((namespace) => OS_MODULE_MEMBERS.map((member) => `${namespace}.${member}`)),
  ];
  for (const symbol of direct) {
    const at = slice.indexOf(symbol);
    if (at !== -1) {
      findings.push({ path, line: lineOf(text, extent.start + at), sink, symbol, through: [...through] });
      return;
    }
  }
  for (const local of context.named) {
    const match = new RegExp(`(?:^|[^\\w.$])${local}\\s*\\(`).exec(slice);
    if (match !== null) {
      findings.push({
        path,
        line: lineOf(text, extent.start + match.index),
        sink,
        symbol: `${local}() [node:os]`,
        through: [...through],
      });
      return;
    }
  }
  if (through.length >= MAX_FLOW_DEPTH) return;
  // Paren depth at each offset of the slice: an identifier passed INTO a call is an argument to a
  // helper that has its own `pty` sink in this same scan (e.g. `unavailablePtyCapability(platform)`,
  // whose `pty` is the literal `false`). Following it would blame the helper's caller for the
  // platform-shaped diagnostic the closed refusal is allowed to carry. An identifier used AS the pty
  // value (`{ pty: isWindows }`) is at depth zero and is still followed.
  let parenDepth = 0;
  const depthAt: number[] = [];
  for (let index = 0; index < slice.length; index += 1) {
    if (slice[index] === '(') parenDepth += 1;
    depthAt.push(parenDepth);
    if (slice[index] === ')') parenDepth = Math.max(0, parenDepth - 1);
  }
  for (const match of slice.matchAll(/[A-Za-z_$][\w$]*/g)) {
    const name = match[0];
    if (seen.has(name) || (depthAt[match.index] ?? 0) > 0) continue;
    const binding = context.bindings.get(name);
    if (binding === undefined || binding.start >= extent.start && binding.end <= extent.end) continue;
    // Only a binding whose own block encloses this reference can be the one being read.
    if (extent.start < binding.scope.start || extent.start > binding.scope.end) continue;
    seen.add(name);
    scanExtent(code, text, path, sink, binding, context, [...through, name], seen, findings);
    if (findings.length > 0) return;
  }
}

/** Every OS-derived symbol reachable from a `pty` value in the given production sources. */
export function findOsDerivedPtyFlows(sources: readonly ScannedSource[]): PtySourceFinding[] {
  const findings: PtySourceFinding[] = [];
  for (const { path, text } of sources) {
    const code = blankLiterals(text);
    // Import specifiers are string literals, so os bindings are read from the ORIGINAL text.
    const context = { ...osBindings(text), bindings: localBindings(code) };
    const sinks: { sink: PtySourceFinding['sink']; start: number }[] = [];

    // `{ pty: <expr> }` — the property must be a real key, not the tail of `capabilities.pty`.
    for (const match of code.matchAll(/(^|[^\w.$'"])pty\s*:/gm)) {
      const start = match.index + match[0].length;
      // `pty: PublicPtyCapability = unavailablePtyCapability(platform)` is a TYPE ANNOTATION on a
      // parameter, not a property initializer: the value is the closed fail-closed capability, and
      // section 9 accepts constructing one. A property initializer never opens with a bare type name.
      if (/^\s*[A-Z][\w$]*(?:<[^=;,)]*>)?\s*(?:[=;,)]|$)/.test(code.slice(start, expressionEnd(code, start) + 1))) {
        continue;
      }
      sinks.push({ sink: 'property', start });
    }
    // `const pty = <expr>`. Declared before the assignment sink so the dedupe keeps the truer label.
    for (const match of code.matchAll(/\b(?:const|let|var)\s+pty\s*(?::[^=;]*)?=\s*(?!=)/g)) {
      sinks.push({ sink: 'variable', start: match.index + match[0].length });
    }
    // `x.pty = <expr>` / `pty = <expr>` (never `pty ==`, never `pty:`).
    for (const match of code.matchAll(/(?:^|[^\w$])(?:[A-Za-z_$][\w$]*\s*\.\s*)*pty\s*=(?!=)/gm)) {
      sinks.push({ sink: 'assignment', start: match.index + match[0].length });
    }
    // `return <expr>` inside a function DECLARED to return a PTY capability.
    for (const header of code.matchAll(PTY_RETURN_TYPE)) {
      const open = code.indexOf('{', header.index + header[0].length);
      if (open === -1) continue;
      const close = blockEnd(code, open);
      for (const returned of code.slice(open, close).matchAll(/\breturn\s+/g)) {
        const start = open + returned.index + returned[0].length;
        // A returned OBJECT LITERAL carries its own `pty:` property, which the property sink already
        // scans precisely. Scanning the whole literal here would pull in sibling fields — exactly the
        // conforming `{pty:false, diagnostic:{reason: platform === ...}}` shape section 9 accepts.
        if (code[start] === '{') continue;
        sinks.push({ sink: 'return', start });
      }
    }

    for (const { sink, start } of sinks) {
      scanExtent(code, text, path, sink, { start, end: expressionEnd(code, start) }, context, [], new Set(), findings);
    }
  }
  // `const pty = ...` is matched by both the variable and the assignment pattern, and one expression
  // can be reached twice; report each offending flow once.
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const key = `${finding.path}:${finding.line}:${finding.symbol}:${finding.through.join('>')}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export const formatFinding = (finding: PtySourceFinding): string =>
  `${finding.path}:${finding.line} ${finding.sink} pty <- ${finding.symbol}`
  + (finding.through.length === 0 ? '' : ` (through ${finding.through.join(' -> ')})`);

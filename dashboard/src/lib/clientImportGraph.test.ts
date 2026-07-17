/**
 * Regression guard for the client→server `node:`-builtin coupling that blanked the SPA (a client import
 * chain reached `server/auth/challenge.ts`'s `import { createHash } from 'node:crypto'`; Vite externalizes
 * `node:crypto` for the browser, so the whole bundle threw before React mounted). The 349 unit tests all
 * pass in Node and CANNOT catch this class — a runtime `import` that only breaks under a browser bundler.
 *
 * This test statically walks the client import graph the way esbuild/Vite actually bundle it — following
 * only RUNTIME imports (`import type` / `export type` edges are erased, so they are NOT followed) across
 * both `src/**` and any `server/**` module a client file runtime-imports — and asserts no reachable module
 * imports a `node:` builtin (or a bare Node core module). Deterministic: pure file resolution, no build.
 *
 * If this fails, a client module gained (directly or transitively) a runtime import of server code that
 * pulls in a node builtin. Fix by importing only `import type` across the boundary, or by moving the pure
 * logic into a node-builtin-free module (as `server/auth/workOrder.ts` / `server/planeB/record.ts` do) —
 * never by reimplementing server crypto/security logic in the client.
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // dashboard/src/lib
const DASHBOARD = resolve(HERE, '../..'); // dashboard/
const SRC = join(DASHBOARD, 'src');

/** Node core module names (bare form). The scheme-prefixed `node:` form is matched separately. */
const NODE_CORE = new Set([
  'assert', 'buffer', 'child_process', 'cluster', 'console', 'crypto', 'dgram', 'diagnostics_channel',
  'dns', 'domain', 'events', 'fs', 'http', 'http2', 'https', 'inspector', 'module', 'net', 'os', 'path',
  'perf_hooks', 'process', 'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder',
  'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi', 'worker_threads', 'zlib',
]);

/** Strip block and line comments so a `node:` mention inside a doc comment is never mistaken for an
 *  actual import statement. Good enough for this repo's source (import statements sit on their own lines). */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

interface Edge {
  spec: string;
  /** true when the statement is `import type` / `export type` (erased at build — not followed). */
  typeOnly: boolean;
}

/** Extract module specifiers from `import`/`export … from` and side-effect `import '…'` statements. */
function importsOf(code: string): Edge[] {
  const src = stripComments(code);
  const edges: Edge[] = [];
  // `import …`/`export … from '<spec>'` — group 1 = the `type` keyword iff it sits right after import/export.
  const fromRe = /\b(?:import|export)\s+(type\s+)?[^;]*?\bfrom\s*['"]([^'"]+)['"]/g;
  for (let m = fromRe.exec(src); m !== null; m = fromRe.exec(src)) {
    edges.push({ spec: m[2], typeOnly: Boolean(m[1]) });
  }
  // Side-effect import: `import '<spec>'` (never type-only).
  const bareRe = /\bimport\s*['"]([^'"]+)['"]/g;
  for (let m = bareRe.exec(src); m !== null; m = bareRe.exec(src)) {
    edges.push({ spec: m[1], typeOnly: false });
  }
  return edges;
}

/** True if a RUNTIME import in `code` targets a Node builtin (`node:*` or a bare core module). */
function importsNodeBuiltin(code: string): string | null {
  for (const { spec, typeOnly } of importsOf(code)) {
    if (typeOnly) continue;
    if (spec.startsWith('node:')) return spec;
    if (NODE_CORE.has(spec)) return spec;
  }
  return null;
}

/** Resolve a relative specifier to a concrete `.ts`/`.tsx` file, or null (bare pkg / css / unresolved). */
function resolveRelative(fromFile: string, spec: string): string | null {
  if (!spec.startsWith('.')) return null; // bare package — not part of the local graph
  const base = resolve(dirname(fromFile), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

/**
 * Walk the runtime import closure from `roots`. Returns any reachable file that itself imports a node
 * builtin, together with the shortest chain (root → … → offender) that reaches it.
 */
function findNodeBuiltinViolations(roots: string[]): Array<{ file: string; builtin: string; chain: string[] }> {
  const visited = new Set<string>();
  const parent = new Map<string, string | null>();
  const queue: string[] = [];
  for (const r of roots) {
    if (!visited.has(r)) {
      visited.add(r);
      parent.set(r, null);
      queue.push(r);
    }
  }
  const violations: Array<{ file: string; builtin: string; chain: string[] }> = [];
  while (queue.length > 0) {
    const file = queue.shift() as string;
    const code = readFileSync(file, 'utf8');
    const builtin = importsNodeBuiltin(code);
    if (builtin !== null) {
      const chain: string[] = [];
      for (let f: string | null | undefined = file; f; f = parent.get(f)) chain.unshift(rel(f));
      violations.push({ file: rel(file), builtin, chain });
    }
    for (const { spec, typeOnly } of importsOf(code)) {
      if (typeOnly) continue; // erased at build — not a bundled edge
      const target = resolveRelative(file, spec);
      if (target && !visited.has(target)) {
        visited.add(target);
        parent.set(target, file);
        queue.push(target);
      }
    }
  }
  return violations;
}

function rel(abs: string): string {
  return abs.slice(DASHBOARD.length + 1).replace(/\\/g, '/');
}

/** Every client-source module (the whole `src/**` tree, excluding tests) — a potential bundle entry. */
function allClientSources(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) out.push(p);
    }
  };
  walk(SRC);
  return out.sort();
}

describe('client import graph is free of node: builtins', () => {
  it('the live SPA entry (src/main.tsx) reaches no node builtin via runtime imports', () => {
    const entry = join(SRC, 'main.tsx');
    expect(existsSync(entry)).toBe(true);
    const violations = findNodeBuiltinViolations([entry]);
    expect(violations, violations.map((v) => `${v.builtin} via ${v.chain.join(' -> ')}`).join('\n')).toEqual([]);
  });

  it('no client-source module (routed or not) runtime-imports a node builtin', () => {
    const violations = findNodeBuiltinViolations(allClientSources());
    expect(violations, violations.map((v) => `${v.builtin} via ${v.chain.join(' -> ')}`).join('\n')).toEqual([]);
  });
});

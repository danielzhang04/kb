/**
 * D0.8 — Static trace permalinks (the Flight Recorder).
 *
 * Post-run render of a dispatch's Claude Code transcript to a SELF-CONTAINED static HTML page
 * (inline CSS, no external asset references — offline-openable) committed **distilled** (Q10) under
 * `traces/<card-id>/index.html`. Raw JSONL stays local; the committed artifact is the distilled
 * render (see `docs/proposals/trace-retention.md` for the GC policy note).
 *
 * PARSING IS REUSED, NOT REIMPLEMENTED. The transcript is read through the existing Plane-B modules:
 *   - `tailFrom`         (byte-offset streaming tail — huge-line safe)
 *   - `joinToolResults`  (tool_result → tool_use join by tool_use_id)
 *   - `buildSubagentTree`(flat subagents/ spawn tree by toolUseId)
 *
 * INERT CONTENT. Every byte of transcript text — assistant prose, thinking, tool inputs/outputs, and
 * any `## Evidence` block — is HTML-ESCAPED before it reaches the page and the renderer emits no live
 * `<script>` markup, so raw HTML in a transcript can never become executable. This mirrors the D0.5
 * KB-browser sanitizer posture (escape-first, transform-never on untrusted text).
 */

import { dirname } from 'node:path';
import { tailFrom } from '../planeB/tailer.ts';
import type { TranscriptRecord } from '../planeB/tailer.ts';
import { joinToolResults } from '../planeB/join.ts';
import { buildSubagentTree } from '../planeB/subagents.ts';
import type { SubagentNode } from '../planeB/subagents.ts';

/**
 * Tool payloads whose JSON serialization exceeds this many bytes are elided to a summary in the
 * distilled render. Turn structure (records, types, tool ids) is always preserved; only the bulky
 * `tool_use.input` / `tool_result.content` blobs are dropped.
 */
export const DISTILL_THRESHOLD_BYTES = 2048;

/** Stable permalink shape: a trace lives at `traces/<card-id>/index.html`. */
export function tracePath(cardId: string): string {
  return `traces/${cardId}/index.html`;
}

/** Escape the five HTML-significant characters. Applied to ALL transcript-derived text. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface ElidedPayload {
  distilled: true;
  elidedBytes: number;
  summary: string;
}

function isElided(v: unknown): v is ElidedPayload {
  return typeof v === 'object' && v !== null && (v as { distilled?: unknown }).distilled === true;
}

/** Replace an oversize payload with a compact summary; small payloads pass through unchanged. */
function distillPayload(payload: unknown): unknown {
  const json = payload === undefined ? '' : JSON.stringify(payload);
  const size = json ? json.length : 0;
  if (size <= DISTILL_THRESHOLD_BYTES) return payload;
  const elided: ElidedPayload = {
    distilled: true,
    elidedBytes: size,
    summary: `[distilled: ${size} bytes elided — raw kept local]`,
  };
  return elided;
}

function distillBlock(block: unknown): unknown {
  if (typeof block !== 'object' || block === null) return block;
  const b = block as Record<string, unknown>;
  if (b.type === 'tool_use') return { ...b, input: distillPayload(b.input) };
  if (b.type === 'tool_result') return { ...b, content: distillPayload(b.content) };
  return block;
}

function distillRecord(rec: TranscriptRecord): TranscriptRecord {
  const content = rec.message?.content;
  if (!Array.isArray(content)) return rec;
  return { ...rec, message: { ...rec.message, content: content.map(distillBlock) } };
}

/**
 * Distill a transcript: preserve every record and its turn structure, but elide any tool payload
 * whose serialized size exceeds {@link DISTILL_THRESHOLD_BYTES}. Pure; input is not mutated.
 */
export function distill(records: TranscriptRecord[]): TranscriptRecord[] {
  return records.map(distillRecord);
}

/** Render an (already distilled) payload value to escaped, human-readable HTML text. */
function renderPayload(value: unknown): string {
  if (isElided(value)) return `<em class="elided">${escapeHtml(value.summary)}</em>`;
  if (typeof value === 'string') return escapeHtml(value);
  return escapeHtml(JSON.stringify(value, null, 2) ?? String(value));
}

function contentBlocks(rec: TranscriptRecord): Array<Record<string, unknown>> {
  const content = rec.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null);
}

/** Render one subagent subtree as a nested list (all text escaped). */
function renderSubagentNode(node: SubagentNode): string {
  const label = `${escapeHtml(node.agentType ?? node.id)}${
    node.description ? ` — ${escapeHtml(node.description)}` : ''
  }`;
  const kids = node.children.length
    ? `<ul>${node.children.map(renderSubagentNode).join('')}</ul>`
    : '';
  return `<li>${label}${kids}</li>`;
}

const PAGE_STYLE = `
  :root { color-scheme: light dark; }
  body { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; margin: 0; padding: 1.5rem; background: #0d1117; color: #c9d1d9; }
  header { border-bottom: 1px solid #30363d; padding-bottom: .75rem; margin-bottom: 1rem; }
  h1 { font-size: 1.1rem; margin: 0 0 .25rem; }
  .meta { color: #8b949e; font-size: .8rem; }
  .turn { border: 1px solid #30363d; border-radius: 6px; padding: .6rem .8rem; margin: .6rem 0; }
  .role { font-weight: 600; text-transform: uppercase; font-size: .72rem; letter-spacing: .04em; color: #58a6ff; }
  .assistant .role { color: #58a6ff; } .user .role { color: #3fb950; }
  .text { white-space: pre-wrap; margin: .35rem 0; }
  .thinking { color: #8b949e; }
  .tool { border-left: 2px solid #d29922; padding-left: .6rem; margin: .4rem 0; }
  .tool-name { color: #d29922; font-weight: 600; }
  pre { white-space: pre-wrap; word-break: break-word; background: #161b22; padding: .5rem; border-radius: 4px; overflow-x: auto; margin: .3rem 0; }
  .elided { color: #8b949e; }
  .subagents ul { margin: .2rem 0; }
  footer { color: #6e7681; font-size: .75rem; margin-top: 1.5rem; border-top: 1px solid #30363d; padding-top: .5rem; }
`;

/**
 * Render `sessionPath`'s transcript into a self-contained distilled HTML permalink for `cardId`.
 *
 * The document is fully offline-openable: styles are inline (`<style>`), there are no external asset
 * references, and no live scripts. All transcript text is escaped.
 */
export async function renderTrace(sessionPath: string, cardId: string): Promise<string> {
  const { records } = await tailFrom(sessionPath, 0);
  const distilled = distill(records);

  // Join tool_result → tool_use so each tool call renders with its (distilled) result inline.
  const joined = joinToolResults(distilled);
  const resultById = new Map<string, unknown>();
  for (const tu of joined) {
    if (tu.result) resultById.set(tu.id, tu.result.content);
  }

  // Subagent spawn tree (empty root when the session has no subagents/ dir).
  let subagentRoot: SubagentNode | null = null;
  try {
    subagentRoot = await buildSubagentTree(dirname(sessionPath));
  } catch {
    subagentRoot = null;
  }

  const body: string[] = [];
  for (const rec of distilled) {
    const role = rec.type === 'assistant' ? 'assistant' : rec.type === 'user' ? 'user' : rec.type ?? 'record';
    const parts: string[] = [];

    const raw = rec.message?.content;
    if (typeof raw === 'string') {
      parts.push(`<div class="text">${escapeHtml(raw)}</div>`);
    } else {
      for (const block of contentBlocks(rec)) {
        if (block.type === 'text' && typeof block.text === 'string') {
          parts.push(`<div class="text">${escapeHtml(block.text)}</div>`);
        } else if (block.type === 'thinking' && typeof block.thinking === 'string') {
          parts.push(`<div class="text thinking">${escapeHtml(block.thinking)}</div>`);
        } else if (block.type === 'tool_use') {
          const name = typeof block.name === 'string' ? block.name : 'tool';
          const result = typeof block.id === 'string' && resultById.has(block.id) ? resultById.get(block.id) : undefined;
          parts.push(
            `<div class="tool"><span class="tool-name">${escapeHtml(name)}</span>` +
              `<pre>${renderPayload(block.input)}</pre>` +
              (result !== undefined ? `<pre class="result">${renderPayload(result)}</pre>` : '') +
              `</div>`,
          );
        } else if (block.type === 'tool_result') {
          // Standalone tool_result already surfaced under its tool_use; skip to avoid duplication.
          continue;
        }
      }
    }

    if (parts.length === 0) continue;
    body.push(`<section class="turn ${escapeHtml(role)}"><div class="role">${escapeHtml(role)}</div>${parts.join('')}</section>`);
  }

  const subagentsHtml =
    subagentRoot && subagentRoot.children.length
      ? `<section class="subagents"><div class="role">subagents</div><ul>${subagentRoot.children
          .map(renderSubagentNode)
          .join('')}</ul></section>`
      : '';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Trace ${escapeHtml(cardId)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<header>
<h1>Flight Recorder — ${escapeHtml(cardId)}</h1>
<div class="meta">Distilled static trace (raw JSONL kept local). ${distilled.length} record(s).</div>
</header>
<main>
${body.join('\n')}
${subagentsHtml}
</main>
<footer>Self-contained distilled render. Payloads over ${DISTILL_THRESHOLD_BYTES} bytes are elided; see docs/proposals/trace-retention.md for the GC policy.</footer>
</body>
</html>
`;
}

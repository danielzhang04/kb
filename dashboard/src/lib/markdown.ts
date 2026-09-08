/**
 * Minimal, safe markdown renderer (client-side).
 *
 * WHY HAND-ROLLED (no dependency): the rest of dashboard/ deliberately keeps a zero-extra-dep
 * discipline (e.g. Plane-A parses card frontmatter without a YAML lib). A full markdown+sanitizer
 * stack (marked + DOMPurify) is far larger than the KB browser needs, and DOMPurify additionally
 * requires a DOM (jsdom) under vitest's `node` environment. Instead this renderer HTML-ESCAPES the
 * entire input FIRST, then applies markdown transforms only to already-escaped text. Raw HTML in the
 * source can therefore never become live markup — the core "no raw HTML injection" invariant holds
 * by construction, and a card's `## Evidence` block stays inert displayed text.
 *
 * Supported: ATX headings, fenced code blocks, unordered lists, blockquotes, bold/italic, inline
 * code, and links with a scheme allowlist (http/https/mailto/relative; `javascript:` etc. dropped).
 * Tables are deliberately an opt-in extension for readers that need them; the default remains the
 * small established markdown subset used by card and KB surfaces.
 */

/** Escape the five HTML-significant characters. Applied to the whole source before any transform. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Allow only safe link schemes; everything else (javascript:, data:, vbscript:) is dropped. */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  // Relative / anchor / root-relative links are safe (same-origin, read-only browser).
  if (/^(?:[.#/]|[\w-]+\.)/.test(trimmed) && !/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return trimmed;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^mailto:/i.test(trimmed)) return trimmed;
  return null;
}

/** Inline transforms applied to an already-HTML-escaped line. */
function renderInline(escaped: string): string {
  let out = escaped;
  // inline code first, so its contents are not further transformed.
  out = out.replace(/`([^`]+)`/g, (_m, code) => `<code>${code}</code>`);
  // links: [text](href) — href was escaped, so `&#39;`/`&quot;` are literal; validate the raw text.
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, text: string, rawHref: string) => {
    const href = safeHref(rawHref.replace(/&amp;/g, '&'));
    if (href === null) return text; // unsafe scheme → show link text only, drop the href
    return `<a href="${escapeHtml(href)}" rel="noopener noreferrer">${text}</a>`;
  });
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  return out;
}

export interface MarkdownRenderOptions {
  /** Enable the deliberately narrow GFM-style pipe table subset. */
  tables?: boolean;
}

/** Parse one simple GFM table row after the source has already been HTML-escaped. */
function tableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.includes('|')) return null;
  const body = trimmed.replace(/^\|/, '').replace(/\|$/, '');
  const cells = body.split('|').map((cell) => cell.trim());
  return cells.length > 0 && cells.every((cell) => cell.length > 0) ? cells : null;
}

function isTableSeparator(cells: readonly string[], expectedColumns: number): boolean {
  return cells.length === expectedColumns && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

/** Render markdown source to a safe HTML string. Input is escaped before any transform. */
export function renderMarkdown(source: string, options: MarkdownRenderOptions = {}): string {
  const lines = escapeHtml(source).split(/\r?\n/);
  const html: string[] = [];
  let inCode = false;
  let inList = false;
  let para: string[] = [];

  const flushPara = () => {
    if (para.length) {
      html.push(`<p>${renderInline(para.join(' '))}</p>`);
      para = [];
    }
  };
  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    // fenced code block toggles (``` may be escaped? backticks are not escaped, so plain match).
    if (/^```/.test(line)) {
      flushPara();
      closeList();
      if (!inCode) {
        html.push('<pre><code>');
        inCode = true;
      } else {
        html.push('</code></pre>');
        inCode = false;
      }
      continue;
    }
    if (inCode) {
      html.push(line);
      continue;
    }

    const header = options.tables ? tableCells(line) : null;
    const separator = header && index + 1 < lines.length ? tableCells(lines[index + 1]) : null;
    if (header && separator && isTableSeparator(separator, header.length)) {
      flushPara();
      closeList();
      html.push(`<table><thead><tr>${header.map((cell) => `<th>${renderInline(cell)}</th>`).join('')}</tr></thead><tbody>`);
      index += 2;
      while (index < lines.length) {
        const row = tableCells(lines[index]);
        if (!row || row.length !== header.length) break;
        html.push(`<tr>${row.map((cell) => `<td>${renderInline(cell)}</td>`).join('')}</tr>`);
        index += 1;
      }
      html.push('</tbody></table>');
      index -= 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushPara();
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2].trim())}</h${level}>`);
      continue;
    }

    const listItem = /^\s*[-*]\s+(.*)$/.exec(line);
    if (listItem) {
      flushPara();
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${renderInline(listItem[1])}</li>`);
      continue;
    }

    const quote = /^&gt;\s?(.*)$/.exec(line); // `>` was escaped to `&gt;`
    if (quote) {
      flushPara();
      closeList();
      html.push(`<blockquote>${renderInline(quote[1])}</blockquote>`);
      continue;
    }

    if (line.trim() === '') {
      flushPara();
      closeList();
      continue;
    }

    para.push(line.trim());
  }

  if (inCode) html.push('</code></pre>');
  flushPara();
  closeList();
  return html.join('\n');
}

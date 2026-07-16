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

/** Render markdown source to a safe HTML string. Input is escaped before any transform. */
export function renderMarkdown(source: string): string {
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

  for (const line of lines) {
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

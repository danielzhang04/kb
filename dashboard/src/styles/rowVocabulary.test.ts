import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

function rulesFor(css: string, selector: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (new RegExp(`${selector.replace('.', '\\.')}(?![\\w-])`).test(match[1])) bodies.push(match[2]);
  }
  return bodies;
}

// The card row now lives in Inbox and intentionally departs from the dense 36–44px single-line
// vocabulary: it is a variable-height human-first row with the next action and recency visible. It
// keeps every other row invariant (one hairline separator, cursor:pointer, row-as-primary-action).
// Projects/Files/folder remain the dense 36–44px vocabulary.
const ROWS = [
  { name: 'Inbox card', file: 'views/inbox.css', selector: '.inbox__row--card', height: /height\s*:\s*auto/, shape: 'a variable-height human-first row' },
  { name: 'Projects', file: 'views/projects.css', selector: '.v-projects__card', height: /min-height\s*:\s*36px[\s\S]*max-height\s*:\s*44px/, shape: 'a 36–44 px row' },
  { name: 'folder', file: 'views/folder.css', selector: '.v-folder__row', height: /min-height\s*:\s*36px[\s\S]*max-height\s*:\s*44px/, shape: 'a 36–44 px row' },
] as const;

describe('Inbox cards, Projects, Files, and folder row vocabulary', () => {
  for (const row of ROWS) {
    it(`${row.name} uses ${row.shape}, one hairline separator, and the row as primary action`, () => {
      const css = readFileSync(resolve(here, row.file), 'utf8');
      const body = rulesFor(css, row.selector)[0] ?? '';
      expect(body).toMatch(row.height);
      expect(body).toMatch(/border-bottom\s*:\s*1px\s+solid\s+var\(--border\)/);
      expect(body).toMatch(/cursor\s*:\s*pointer/);
      expect((body.match(/1px\s+solid/g) ?? [])).toHaveLength(1);
    });
  }

  it('Files uses the shared folder rows instead of defining a parallel row vocabulary', () => {
    const css = readFileSync(resolve(here, 'views/files.css'), 'utf8');
    expect(css).toMatch(/\.v-files \.v-folder/);
    expect(css).not.toMatch(/\.v-files__(row|item|card)/);
  });
});

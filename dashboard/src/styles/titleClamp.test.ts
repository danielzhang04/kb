/**
 * Guard: A RUN TITLE IS SHOWN IN FULL.
 *
 * This is the single most-emphasised requirement on this surface, and every behavioural test asserts
 * `element.textContent`, which is completely invariant under a CSS ellipsis: jsdom applies no
 * stylesheets, so adding `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` to a title
 * rule keeps every one of those assertions green while the operator sees "Rebuild the faceless video
 * pipe…". A reviewer confirmed that by mutation.
 *
 * The only place the truth lives is the CSS itself, so that is what this asserts. It reads the stylesheet
 * SOURCE and fails if any rule matching a title selector carries a clamping declaration — including a
 * rule added later, elsewhere in the file, or under a media query, since it checks every block whose
 * selector mentions the class rather than one hard-coded location.
 *
 * If this test fails, do not relax it. The requirement is the test.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));

/** The title elements the operator reads a run by: the list row and the detail header. The old grid
 *  card (`.run-card__title`) went with the run grid; runs are listed as entity rows now. */
const GUARDED = [
  { selector: '.entity-row__main', file: resolve(here, 'views/entity.css') },
  { selector: '.entity-detail__title', file: resolve(here, 'views/entity.css') },
];

/**
 * Declarations that clip text. `overflow-wrap`/`word-break` are deliberately NOT here: they make long
 * unbroken tokens WRAP, which serves the requirement rather than fighting it.
 */
const CLAMPING = [
  /(^|[;{\s])white-space\s*:\s*(nowrap|pre)\b/,
  /(^|[;{\s])text-overflow\s*:/,
  /(^|[;{\s])overflow\s*:\s*hidden\b/,
  /(^|[;{\s])overflow-y\s*:\s*hidden\b/,
  /-webkit-line-clamp\s*:/,
  /(^|[;{\s])line-clamp\s*:/,
  /(^|[;{\s])max-height\s*:/,
  /(^|[;{\s])height\s*:/,
];

/** Strip comments, then pull out every `selector { body }` pair. Sufficient for this flat stylesheet. */
function rulesFor(css: string, selector: string): string[] {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const bodies: string[] = [];
  for (const match of withoutComments.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // Word-boundary the class so `.run-card__title` never matches a hypothetical `.run-card__title-x`.
    if (new RegExp(`${selector.replace('.', '\\.')}(?![\\w-])`).test(match[1])) bodies.push(match[2]);
  }
  return bodies;
}

describe('run and entity titles are never clamped', () => {
  for (const { selector, file } of GUARDED) {
    it(`${selector} carries no clipping declaration`, () => {
      const css = readFileSync(file, 'utf8');
      const bodies = rulesFor(css, selector);

      // A vanished selector is a failure too: silently losing the rule would silently lose the guard.
      expect(bodies.length).toBeGreaterThan(0);

      for (const body of bodies) {
        for (const pattern of CLAMPING) {
          expect(
            pattern.test(body),
            `${selector} must show the whole title, but a rule matched ${pattern}:\n${body.trim()}`,
          ).toBe(false);
        }
      }
    });
  }

  it('a run row wraps rather than scrolling horizontally, which is what lets titles be full', () => {
    const css = readFileSync(resolve(here, 'views/entity.css'), 'utf8');
    const [row] = rulesFor(css, '.entity-row');
    // Wrapping is precisely what lets every row show its title in full at any width. An
    // `overflow-x: auto` here would reintroduce exactly the truncating scroller this replaced.
    expect(row).toMatch(/flex-wrap\s*:\s*wrap/);
    expect(row).not.toMatch(/overflow-x\s*:\s*(auto|scroll)/);
  });
});

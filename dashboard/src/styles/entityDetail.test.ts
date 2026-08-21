import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('entity detail CSS', () => {
  it('pins right overlay and exact max-width 720 rule with no later override', () => {
    const css = readFileSync(new URL('./views/entity.css', import.meta.url), 'utf8');
    const overlay = css.match(/\.entity-detail__overlay\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(overlay).toMatch(/right:\s*0/);
    expect(overlay).toMatch(/width:\s*min\(100vw,\s*720px\)/);
    expect(overlay).toMatch(/max-width:\s*720px/);
    expect(overlay).toMatch(/background:\s*var\(--bg-elevated\)/);
    expect(overlay).toMatch(/border-left:\s*1px solid var\(--border\)/);
    expect((css.match(/max-width:\s*720px/g) ?? []).length).toBe(1);
  });
});

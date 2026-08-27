import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('entity detail CSS', () => {
  it('pins the right overlay to the content-area width capped at 45rem with no later override', () => {
    const css = readFileSync(new URL('./views/entity.css', import.meta.url), 'utf8');
    const overlay = css.match(/\.entity-detail__overlay\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
    expect(overlay).toMatch(/right:\s*0/);
    // U8: the drawer sizes to the CONTENT area (100%), not the full viewport (100vw), so it stays
    // correct alongside the sidebar — capped at the same 720px (45rem); max-width:100% lets it shrink.
    expect(overlay).toMatch(/width:\s*min\(100%,\s*45rem\)/);
    expect(overlay).toMatch(/max-width:\s*100%/);
    expect(overlay).toMatch(/background:\s*var\(--bg-elevated\)/);
    expect(overlay).toMatch(/border-left:\s*1px solid var\(--border\)/);
    expect((css.match(/min\(100%,\s*45rem\)/g) ?? []).length).toBe(1);
  });
});

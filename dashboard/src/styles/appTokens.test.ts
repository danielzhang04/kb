import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function blocks(selector: string): string[] {
  const found: string[] = [];
  for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (match[1].trim() === selector) found.push(match[2]);
  }
  return found;
}

function declaration(body: string, name: string): string | null {
  return new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*([^;]+);`).exec(body)?.[1].trim() ?? null;
}

const DARK = {
  '--bg-base': '#000000', '--bg-panel': '#111111', '--bg-elevated': '#1a1a1a', '--hairline': '#333333',
  '--fg-dim': '#888888', '--fg-primary': '#ffffff', '--focus': '#0070f3', '--success': '#46a758',
  '--warning': '#f5a623', '--error': '#e5484d',
};
const LIGHT = {
  '--bg-base': '#ffffff', '--bg-panel': '#f7f7f7', '--bg-elevated': '#ededed', '--hairline': '#d4d4d4',
  '--fg-dim': '#666666', '--fg-primary': '#000000', '--focus': '#0070f3', '--success': '#18794e',
  '--warning': '#9a6700', '--error': '#d1242f',
};

describe('P1 application tokens', () => {
  it('pins exact dark light pairs in root light and dark blocks with no later override', () => {
    const root = blocks(':root');
    const light = blocks(":root[data-theme='light']");
    const dark = blocks(":root[data-theme='dark']");
    expect(root).toHaveLength(1);
    expect(light).toHaveLength(1);
    expect(dark).toHaveLength(1);
    for (const [name, value] of Object.entries(DARK)) {
      expect(declaration(root[0], name), `root ${name}`).toBe(value);
      expect(declaration(dark[0], name), `dark ${name}`).toBe(value);
    }
    for (const [name, value] of Object.entries(LIGHT)) expect(declaration(light[0], name), `light ${name}`).toBe(value);
    for (const name of Object.keys(DARK)) {
      expect((css.match(new RegExp(`${name.replace(/-/g, '\\-')}\\s*:`, 'g')) ?? []).length, name).toBe(3);
    }
  });

  it('pins the three exact system stacks and five type roles', () => {
    const root = blocks(':root')[0] ?? '';
    expect(declaration(root, '--font-header')).toBe('"Arial Narrow","Aptos Narrow","Roboto Condensed","Helvetica Neue Condensed",sans-serif');
    expect(declaration(root, '--font-body')).toBe('"Geist","Geist Sans",-apple-system,BlinkMacSystemFont,"Segoe UI Variable","Segoe UI",sans-serif');
    expect(declaration(root, '--font-mono')).toBe('"Geist Mono",ui-monospace,"Cascadia Code","SFMono-Regular",Consolas,"Liberation Mono",monospace');
    expect(declaration(root, '--type-title')).toBe('600 24px/28px var(--font-header)');
    expect(declaration(root, '--type-section')).toBe('600 16px/20px var(--font-header)');
    expect(declaration(root, '--type-body')).toBe('400 13px/18px var(--font-body)');
    expect(declaration(root, '--type-meta')).toBe('400 12px/16px var(--font-body)');
    expect(declaration(root, '--type-mono')).toBe('400 12px/18px var(--font-mono)');
  });

  it('rejects every legacy color variable declaration or use', () => {
    expect(css).not.toMatch(/--(?:ink|mc-accent|accent-strong)\b/);
  });
});

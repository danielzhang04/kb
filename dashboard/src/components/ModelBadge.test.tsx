// @vitest-environment jsdom
/**
 * U16 — ModelBadge is the single renderer for "which model tier is this costing us". These tests pin the
 * two things a later edit could quietly break: (1) each canonical alias in governance/model-routing.yaml
 * maps to its weight class, so a routing change can never silently repaint a chip; (2) an unknown or
 * absent tier degrades to a plain chip instead of throwing or guessing a weight — the badge renders
 * against live daemon data, where a newly-added alias arriving before a UI update is expected, not
 * exceptional.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ModelBadge, modelWeight } from './ModelBadge';

afterEach(() => {
  cleanup();
});

/** Aliases a human writes — governance/model-routing.yaml `runtimes.*.aliases`. */
const ALIASES: ReadonlyArray<readonly [string, string]> = [
  ['fable', 'deep'],
  ['opus', 'deep'],
  ['sonnet', 'standard'],
  ['haiku', 'cheap'],
  ['codex-deep', 'deep'],
  ['codex', 'standard'],
  ['codex-cheap', 'cheap'],
];

/**
 * Concrete ids — governance/model-routing.yaml `runtimes.*.known_models`. These are what actually reach
 * the badge on live data: server/routing/effective.ts resolves each alias and guards it against
 * known_models before it goes on the wire, so a table covering only ALIASES would render colourless in
 * production while passing every alias-fed test.
 */
const CONCRETE_IDS: ReadonlyArray<readonly [string, string]> = [
  ['claude-fable-5', 'deep'],
  ['claude-opus-5', 'deep'],
  ['claude-sonnet-5', 'standard'],
  ['claude-haiku-4-5', 'cheap'],
  ['gpt-5.6-sol', 'deep'],
  ['gpt-5.6-terra', 'standard'],
  ['gpt-5.6-luna', 'cheap'],
];

const CANONICAL: ReadonlyArray<readonly [string, string]> = [...ALIASES, ...CONCRETE_IDS];

describe('ModelBadge', () => {
  it('maps every canonical model-routing name — alias AND concrete id — to its weight class', () => {
    for (const [tier, weight] of CANONICAL) {
      const { unmount } = render(<ModelBadge tier={tier} />);
      const el = screen.getByTestId('model-badge');
      expect(el.className).toContain(`mc-badge--model-${weight}`);
      expect(el.getAttribute('data-model-weight')).toBe(weight);
      unmount();
    }
  });

  it('always carries the shared badge + mono vocabulary, whatever the tier', () => {
    for (const tier of ['fable', 'sonnet', 'codex-deep', 'claude-opus-5', 'gpt-5.6-luna', 'gpt-9', '']) {
      const { unmount } = render(<ModelBadge tier={tier} />);
      const el = screen.getByTestId('model-badge');
      expect(el.className).toContain('mc-badge');
      expect(el.className).toContain('mc-mono');
      unmount();
    }
  });

  it('renders the tier name as its label by default', () => {
    render(<ModelBadge tier="sonnet" />);
    expect(screen.getByTestId('model-badge').textContent).toBe('sonnet');
  });

  it('prefers an explicit label over the tier name', () => {
    render(<ModelBadge tier="codex-deep" label="gpt-5.6-sol" />);
    expect(screen.getByTestId('model-badge').textContent).toBe('gpt-5.6-sol');
  });

  it('degrades gracefully on an unknown tier — plain chip, no weight class, no throw', () => {
    // `gemini` is the yaml's explicitly deferred runtime — a real future name this build cannot weigh yet.
    for (const tier of ['gpt-9', 'gemini', 'not-a-model']) {
      const { unmount } = render(<ModelBadge tier={tier} />);
      const el = screen.getByTestId('model-badge');
      expect(el.className).not.toContain('mc-badge--model-');
      expect(el.getAttribute('data-model-weight')).toBeNull();
      expect(el.textContent).toBe(tier);
      unmount();
    }
  });

  it('degrades gracefully on a missing tier — renders a placeholder, never "undefined"', () => {
    for (const tier of [undefined, null, '', '   ']) {
      const { unmount } = render(<ModelBadge tier={tier} />);
      const el = screen.getByTestId('model-badge');
      expect(el.className).not.toContain('mc-badge--model-');
      expect(el.textContent).toBe('—');
      expect(el.textContent).not.toContain('undefined');
      expect(el.textContent).not.toContain('null');
      unmount();
    }
  });

  it('is case- and whitespace-tolerant about the tier it is handed', () => {
    for (const tier of [' Sonnet ', 'SONNET', 'sonnet']) {
      const { unmount } = render(<ModelBadge tier={tier} />);
      expect(screen.getByTestId('model-badge').className).toContain('mc-badge--model-standard');
      unmount();
    }
  });

  it('exposes the raw tier via title so the mapping is inspectable from the UI', () => {
    render(<ModelBadge tier="opus" label="Opus 5" />);
    expect(screen.getByTestId('model-badge').getAttribute('title')).toBe('opus');
  });

  describe('modelWeight', () => {
    it('resolves every alias and concrete id, and returns null for anything else', () => {
      for (const [tier, weight] of CANONICAL) expect(modelWeight(tier)).toBe(weight);
      for (const tier of [undefined, null, '', 'gpt-9', 'gemini']) expect(modelWeight(tier)).toBeNull();
    });

    it('weighs an alias and the concrete id it resolves to identically', () => {
      // The pairs are governance/model-routing.yaml `runtimes.*.aliases`. If effective.ts resolves an
      // alias to an id this table weighs differently, the same run would change colour mid-pipeline.
      const RESOLVES: ReadonlyArray<readonly [string, string]> = [
        ['fable', 'claude-fable-5'],
        ['opus', 'claude-opus-5'],
        ['sonnet', 'claude-sonnet-5'],
        ['haiku', 'claude-haiku-4-5'],
        ['codex-cheap', 'gpt-5.6-luna'],
        ['codex', 'gpt-5.6-terra'],
        ['codex-deep', 'gpt-5.6-sol'],
      ];
      for (const [alias, id] of RESOLVES) expect(modelWeight(alias)).toBe(modelWeight(id));
    });
  });
});

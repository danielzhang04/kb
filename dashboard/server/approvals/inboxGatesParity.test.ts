/**
 * Cross-language parity for the inbox-gate classifier (dashboard side).
 *
 * Loads the SAME fixture as tests/test_inbox_gates_parity.py and asserts the dashboard
 * `classify` (exercised through `projectHumanInbox`) returns the identical canonical
 * category for every case. Drift between this and brief.classify_category reddens one
 * side — that is the whole anti-drift guarantee for G4. The fixture lives at the repo
 * root; resolve it relative to this file (dashboard/server/approvals -> ../../../).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { projectHumanInbox, type HumanInboxCategory } from './humanInbox.ts';
import type { ParsedCard, CardMeta } from '../planeA/cards.ts';
import type { PlaneAIndex } from '../planeA/indexer.ts';

interface ParityCase {
  name: string;
  meta: Record<string, unknown>;
  body?: string;
  expected: HumanInboxCategory | null;
}

const fixturePath = fileURLToPath(new URL('../../../tests/fixtures/inbox-gates-parity.json', import.meta.url));
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { now: number; cases: ParityCase[] };

function indexOf(card: ParsedCard): PlaneAIndex {
  return {
    cards: { [String(card.meta.state)]: [card] },
    ledgers: {
      dispatch: { count: 0, cards: 0, byProject: {} },
      cost: { stepCount: 0, perModelSteps: {}, modelMix: {}, usdPresent: false },
      grades: { count: 0, rows: [] },
      activity: { count: 0, rows: [] },
    },
    orgStates: [],
  };
}

/** The category the dashboard would project for one card, or null — bridges the
 *  `HumanInboxItem | null` classifier through the real projection entry point. */
function categoryOf(meta: Record<string, unknown>, body: string): HumanInboxCategory | null {
  const card: ParsedCard = { meta: meta as unknown as CardMeta, body };
  const items = projectHumanInbox(indexOf(card), { now: fixture.now }).items;
  return items[0]?.category ?? null;
}

describe('inbox-gate classifier parity (dashboard side)', () => {
  it('has cases to check', () => {
    expect(fixture.cases.length).toBeGreaterThan(0);
  });

  for (const testCase of fixture.cases) {
    it(`${testCase.name}`, () => {
      expect(categoryOf(testCase.meta, testCase.body ?? '')).toBe(testCase.expected);
    });
  }
});

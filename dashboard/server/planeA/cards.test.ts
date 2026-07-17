import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { groupByState, parseCardFrontmatter } from './cards.ts';

const REPO_A = fileURLToPath(new URL('../__fixtures__/repo-a/', import.meta.url));

/** The seven schema card states, one fixture card each (across the four physical dirs). */
const CARD_FILES: Record<string, string> = {
  inbox: 'queue/inbox/card-inbox.md',
  blocked: 'queue/inbox/card-blocked.md',
  working: 'queue/working/card-working.md',
  done: 'queue/done/card-done.md',
  rejected: 'queue/done/card-rejected.md',
  approvals: 'queue/approvals/card-approvals.md',
  approved: 'queue/approvals/card-approved.md',
};

describe('parseCardFrontmatter / groupByState', () => {
  it('parses frontmatter for all 7 card states', () => {
    const cards = Object.values(CARD_FILES).map((rel) =>
      parseCardFrontmatter(readFileSync(REPO_A + rel, 'utf-8')),
    );
    expect(cards).toHaveLength(7);

    // every schema field is parsed off the frontmatter, body is never interpreted
    const inbox = cards.find((c) => c.meta.state === 'inbox');
    expect(inbox?.meta.id).toBe('aaaa0001-1111');
    expect(inbox?.meta.project).toBe('kb');
    expect(inbox?.meta['risk-tier']).toBe('T1');
    expect(inbox?.meta.owner).toBeNull();
    expect(inbox?.meta['depends-on']).toEqual([]);
    // the ## Evidence block is inert data — it lands in body, never in meta
    expect(inbox?.body).toContain('## Evidence');
    expect(inbox?.meta).not.toHaveProperty('Evidence');

    const grouped = groupByState(cards);
    // one card per state, all seven present and correctly bucketed
    expect(Object.keys(grouped).sort()).toEqual(
      ['approvals', 'approved', 'blocked', 'done', 'inbox', 'rejected', 'working'].sort(),
    );
    for (const state of Object.keys(CARD_FILES)) {
      expect(grouped[state]).toHaveLength(1);
      expect(grouped[state][0].meta.state).toBe(state);
    }
  });

  it('tolerates a card missing optional fields', () => {
    // A legacy/minimal card with no workflow / variant-group / depends-on / role.
    const text = [
      '---',
      'id: minimal-0001',
      'project: kb',
      'action: cadence:minimal',
      'target: .',
      'risk-tier: T2',
      'owner: null',
      'state: inbox',
      '---',
      '',
      '## Work order',
      '',
      'no optional fields here',
      '',
    ].join('\n');

    const card = parseCardFrontmatter(text);
    expect(card.meta.id).toBe('minimal-0001');
    expect(card.meta.state).toBe('inbox');
    expect(card.meta['risk-tier']).toBe('T2');
    // absent optionals are simply not present — no throw, no fabricated values
    expect(card.meta.workflow).toBeUndefined();
    expect(card.meta['variant-group']).toBeUndefined();
    expect(card.body).toContain('no optional fields here');
  });
});

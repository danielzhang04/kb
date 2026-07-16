import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { indexSkills } from './skills';

const REGISTRY_A = fileURLToPath(new URL('../__fixtures__/registry-a/', import.meta.url));

/** Build a throwaway repo with a curated skill + a grades ledger row for that skill. */
function repoWithGrade(): string {
  const root = mkdtempSync(join(tmpdir(), 'registry-graded-'));
  const skillDir = join(root, 'skills', 'curated', 'graded-skill');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(
    join(skillDir, 'SKILL.md'),
    '---\nname: graded-skill\ndescription: A skill with a trust grade.\n---\n\n# graded-skill\n',
  );
  const gradesDir = join(root, 'ledgers', 'grades');
  mkdirSync(gradesDir, { recursive: true });
  writeFileSync(
    join(gradesDir, 'grader-2026-07-16.tsv'),
    'skill\tgrade\tdate\ngraded-skill\tA\t2026-07-16\n',
  );
  return root;
}

describe('indexSkills', () => {
  it('indexes curated SKILL.md files with name+description', () => {
    const idx = indexSkills(REGISTRY_A);

    const alpha = idx.items.find((s) => s.name === 'alpha-skill');
    expect(alpha).toBeDefined();
    expect(alpha?.tier).toBe('curated');
    expect(alpha?.description).toContain('curated skill for testing');

    // all four tiers are scanned; the evolved one is present too
    const beta = idx.items.find((s) => s.name === 'beta-skill');
    expect(beta?.tier).toBe('evolved');

    expect(idx.count).toBe(2);
    expect(idx.byTier.curated.map((s) => s.name)).toEqual(['alpha-skill']);
  });

  it('overlays trust grade when ledgers/grades has rows, empty overlay otherwise', () => {
    // fixture repo-a has an EMPTY ledgers/grades/ (only .gitkeep) → clean no-data overlay
    const empty = indexSkills(REGISTRY_A);
    expect(empty.trust.present).toBe(false);
    expect(empty.trust.count).toBe(0);
    expect(empty.items.every((s) => s.grade === null)).toBe(true);

    // a repo WITH a grades row overlays that grade onto the matching skill
    const graded = indexSkills(repoWithGrade());
    expect(graded.trust.present).toBe(true);
    expect(graded.trust.count).toBe(1);
    const gradedSkill = graded.items.find((s) => s.name === 'graded-skill');
    expect(gradedSkill?.grade).toBe('A');
  });

  it('returns an empty-but-valid index for a repo with no skills/ dir', () => {
    const empty = mkdtempSync(join(tmpdir(), 'registry-noskills-'));
    const idx = indexSkills(empty);
    expect(idx.count).toBe(0);
    expect(idx.items).toEqual([]);
    expect(idx.trust.present).toBe(false);
  });
});

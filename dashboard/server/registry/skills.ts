/**
 * Skills registry projection. Skills live under `skills/<tier>/<slug>/SKILL.md` for the four tiers
 * curated / evolved / imported / learned, each with YAML frontmatter (`name`, `description`).
 *
 * A trust/grade overlay is read from `ledgers/grades/*.tsv`. That ledger is currently EMPTY in the
 * live repo, so the overlay MUST degrade to a clean no-data state (`trust.present === false`, every
 * skill's `grade === null`) — never throw, never fabricate a grade.
 *
 * No YAML dependency is pulled in (D0.x adds no deps). SKILL.md frontmatter is a flat map of scalars;
 * a minimal self-contained reader covers `name` + `description`.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** The four skill tiers, in display order. */
export const SKILL_TIERS = ['curated', 'evolved', 'imported', 'learned'] as const;
export type SkillTier = (typeof SKILL_TIERS)[number];

export interface SkillEntry {
  tier: SkillTier;
  slug: string;
  name: string;
  description: string;
  /** Repo-relative path to the SKILL.md. */
  path: string;
  /** Trust grade overlaid from ledgers/grades, or null when no grade data exists. */
  grade: string | null;
}

export interface TrustOverlay {
  /** True only when ledgers/grades/ holds at least one grade row. */
  present: boolean;
  count: number;
}

export interface SkillsIndex {
  count: number;
  items: SkillEntry[];
  byTier: Record<SkillTier, SkillEntry[]>;
  trust: TrustOverlay;
}

/** Read `name` + `description` from a SKILL.md's leading `---` frontmatter. Missing fields → ''. */
function readSkillFrontmatter(text: string): { name: string; description: string } {
  const out = { name: '', description: '' };
  if (!/^---\r?\n/.test(text)) return out;
  const head = text.replace(/^---\r?\n/, '');
  const fenceIdx = head.search(/\r?\n---\r?\n/);
  const fm = fenceIdx === -1 ? head : head.slice(0, fenceIdx);
  for (const line of fm.split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key === 'name') out.name = value;
    else if (key === 'description') out.description = value;
  }
  return out;
}

/**
 * Read every grades TSV under `ledgers/grades/` and build a `skill → latest grade` map. The ledger is
 * TSV with a header row; we look for a `skill` and a `grade` column. Missing dir / empty → {}.
 */
function readGradeOverlay(repoRoot: string): Record<string, string> {
  const dir = join(repoRoot, 'ledgers', 'grades');
  if (!existsSync(dir)) return {};
  const grades: Record<string, string> = {};
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.tsv')) continue; // skip .gitkeep and non-ledger files
    const text = readFileSync(join(dir, name), 'utf-8');
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) continue;
    const header = lines[0].split('\t');
    const skillCol = header.indexOf('skill');
    const gradeCol = header.indexOf('grade');
    if (skillCol === -1 || gradeCol === -1) continue;
    for (const line of lines.slice(1)) {
      const cells = line.split('\t');
      const skill = (cells[skillCol] ?? '').trim();
      const grade = (cells[gradeCol] ?? '').trim();
      if (skill) grades[skill] = grade; // last row wins (latest)
    }
  }
  return grades;
}

/** Index all SKILL.md files across the four tiers and overlay trust grades where present. */
export function indexSkills(repoRoot: string): SkillsIndex {
  const grades = readGradeOverlay(repoRoot);
  const items: SkillEntry[] = [];
  const byTier = { curated: [], evolved: [], imported: [], learned: [] } as Record<
    SkillTier,
    SkillEntry[]
  >;

  for (const tier of SKILL_TIERS) {
    const tierDir = join(repoRoot, 'skills', tier);
    if (!existsSync(tierDir)) continue;
    for (const slug of readdirSync(tierDir)) {
      const skillDir = join(tierDir, slug);
      if (!statSync(skillDir).isDirectory()) continue;
      const skillPath = join(skillDir, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      const { name, description } = readSkillFrontmatter(readFileSync(skillPath, 'utf-8'));
      const entry: SkillEntry = {
        tier,
        slug,
        name: name || slug,
        description,
        path: `skills/${tier}/${slug}/SKILL.md`,
        grade: grades[name || slug] ?? null,
      };
      items.push(entry);
      byTier[tier].push(entry);
    }
  }

  const gradeCount = Object.keys(grades).length;
  return {
    count: items.length,
    items,
    byTier,
    trust: { present: gradeCount > 0, count: gradeCount },
  };
}

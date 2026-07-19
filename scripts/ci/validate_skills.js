#!/usr/bin/env node
/**
 * source: ecc@2.0.0/scripts/ci/validate-skills.js
 * imported: 2026-07-19
 * provenance-tier: imported
 *
 * Validate kb skill directories. kb layout is one level deeper than ECC's
 * (skills/<tier>/<name>/SKILL.md vs ECC's skills/<name>/SKILL.md), so the
 * walk is retargeted; the frontmatter parsing (extractFrontmatter /
 * inspectFrontmatter) is copied VERBATIM from ECC.
 *
 * kb gate additions on top of ECC's structural checks:
 *   - Every skills/{imported,learned,evolved}/**\/SKILL.md must declare the
 *     provenance fields required by scripts/schemas/provenance.schema.json
 *     (source, imported ISO date, provenance-tier in the schema enum).
 *   - curated/ is EXEMPT from the requirement (promotion is a human gate), but
 *     any provenance field a promoted curated skill carries is still validated.
 *
 * CLI: node scripts/ci/validate_skills.js [skills-root...]
 *   default root: <repo>/skills; exit 0 clean / exit 1 with findings on stdout.
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const SCHEMA_PATH = path.join(REPO_ROOT, 'scripts', 'schemas', 'provenance.schema.json');

const PROVENANCE_TIERS = new Set(['imported', 'learned', 'evolved']);
const ALL_TIERS = ['curated', 'imported', 'learned', 'evolved'];

function loadSchema() {
  const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf-8'));
  return {
    required: schema.required || ['source', 'imported', 'provenance-tier'],
    tierEnum: new Set(schema.properties?.['provenance-tier']?.enum || ALL_TIERS),
    datePattern: new RegExp(schema.properties?.imported?.pattern || '^\\d{4}-\\d{2}-\\d{2}'),
  };
}

// --- VERBATIM from ECC: frontmatter parsing --------------------------------

function extractFrontmatter(content) {
  const clean = content.replace(/^\uFEFF/, '');
  const match = clean.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return { present: false, lines: [] };
  return {
    present: true,
    lines: match[1].split(/\r?\n/)
  };
}

function inspectFrontmatter(lines) {
  const values = Object.create(null);
  let descriptionIndicator = null;
  let inBlockScalar = false;
  let blockScalarIndent = -1;

  for (const rawLine of lines) {
    if (inBlockScalar) {
      const leadingSpaces = rawLine.match(/^(\s*)/)[1].length;
      if (rawLine.trim() === '' || leadingSpaces > blockScalarIndent) {
        continue;
      }
      inBlockScalar = false;
      blockScalarIndent = -1;
    }

    const match = rawLine.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const rawValue = match[2];
    const valueNoComment = rawValue
      .replace(/^\s*#.*$/, '')
      .replace(/\s+#.*$/, '')
      .trim();
    values[key] = valueNoComment;

    if (/^[|>](?:[+-]?\d+|\d+[+-]?|[+-])?$/.test(valueNoComment)) {
      if (key === 'description') {
        descriptionIndicator = valueNoComment;
      }
      inBlockScalar = true;
      blockScalarIndent = rawLine.match(/^(\s*)/)[1].length;
    }
  }

  return { values, descriptionIndicator };
}

// --- kb walk + validation --------------------------------------------------

function findSkillMd(dir, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findSkillMd(full, out);
    } else if (entry.isFile() && entry.name === 'SKILL.md') {
      out.push(full);
    }
  }
}

function stripQuotes(value) {
  const v = value.trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}

function validateProvenance(values, required, tierEnum, datePattern, label, errors) {
  for (const field of required) {
    if (!Object.prototype.hasOwnProperty.call(values, field) || stripQuotes(values[field]) === '') {
      errors.push(`${label} - frontmatter missing required provenance field: ${field}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(values, 'provenance-tier')) {
    const tier = stripQuotes(values['provenance-tier']);
    if (tier !== '' && !tierEnum.has(tier)) {
      errors.push(`${label} - provenance-tier '${tier}' not in ${[...tierEnum].join(',')}`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(values, 'imported')) {
    const imported = stripQuotes(values['imported']);
    if (imported !== '' && !datePattern.test(imported)) {
      errors.push(`${label} - imported '${imported}' is not an ISO date (YYYY-MM-DD)`);
    }
  }
}

function main() {
  const args = process.argv.slice(2).filter(a => a !== '--strict' && a !== '--');
  const roots = args.length === 0 ? [path.join(REPO_ROOT, 'skills')] : args.map(a => path.resolve(a));
  const schema = loadSchema();
  const errors = [];

  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const tier of ALL_TIERS) {
      const tierDir = path.join(root, tier);
      if (!fs.existsSync(tierDir)) continue;

      const skillFiles = [];
      findSkillMd(tierDir, skillFiles);

      for (const skillMd of skillFiles) {
        const label = path.relative(root, skillMd).split(path.sep).join('/');

        let content;
        try {
          content = fs.readFileSync(skillMd, 'utf-8');
        } catch (err) {
          errors.push(`${label} - ${err.message}`);
          continue;
        }
        if (content.trim().length === 0) {
          errors.push(`${label} - empty SKILL.md`);
          continue;
        }

        const fm = extractFrontmatter(content);
        if (!fm.present) {
          errors.push(`${label} - missing YAML frontmatter`);
          continue;
        }
        const { values } = inspectFrontmatter(fm.lines);

        // Structural check (ECC): name must be present and non-empty.
        if (!Object.prototype.hasOwnProperty.call(values, 'name') || stripQuotes(values.name) === '') {
          errors.push(`${label} - frontmatter missing required field: name`);
        }

        if (PROVENANCE_TIERS.has(tier)) {
          // Provenance-governed tier: full schema requirement.
          validateProvenance(values, schema.required, schema.tierEnum, schema.datePattern, label, errors);
        } else {
          // curated/: exempt from the requirement, but any provenance field
          // that IS declared (e.g. on a promoted skill) must be well-formed.
          const declaresProvenance = schema.required.some(f =>
            Object.prototype.hasOwnProperty.call(values, f));
          if (declaresProvenance) {
            validateProvenance(values, schema.required, schema.tierEnum, schema.datePattern, label, errors);
          }
        }
      }
    }
  }

  if (errors.length > 0) {
    for (const e of errors) console.log(e);
    process.exit(1);
  }
  process.exit(0);
}

main();

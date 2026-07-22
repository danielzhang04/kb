# Imported skills — provenance & promotion gate

Skills here are external imports carrying provenance frontmatter (`source`,
`imported`, `provenance-tier: imported`). They are **not** trusted until a
human promotes them to `skills/curated/`.

Gate sequence — every import passes all four, in order:

1. `python scripts/scan_skill.py <skill-directory>` — quick injection/heuristic scan.
2. CI validators (deep gate): `node scripts/ci/{check_unicode_safety,scan_supply_chain_iocs,validate_skills}.js`.
3. Human read-through (§6 of the import design doc).
4. Promotion imported -> curated.

Who may promote: **humans only** — no agent self-promotes. Promotion moves the
directory to `skills/curated/` and stamps a `promoted:` line.

Frontmatter is validated against
[`scripts/schemas/provenance.schema.json`](../../scripts/schemas/provenance.schema.json).
Gate authority lives in `governance/` (linked, never copied here).

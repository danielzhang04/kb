# Skill routing

- `skills/curated/` is the only authoritative source for active repository skills.
- Never edit `.claude/skills/` or `.agents/skills/`; they are generated runtime mirrors.
- Add, update, or delete an approved skill under `skills/curated/`, then run
  `python scripts/sync_skills.py`. The pre-commit hook repeats this sync and stages both mirrors.
- Agent-created proposals belong in `skills/learned/`; external candidates belong in
  `skills/imported/`. They reach `curated/` only through the human promotion gate.

`python scripts/sync_skills.py --check` fails if either runtime differs from the canonical source.

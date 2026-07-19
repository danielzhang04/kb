# Stage recipe schema (`references/recipes/<stage>.md`)

A recipe parameterizes the convergence engine (`convergence-engine.md`) for one genesis stage. It is a
markdown file: a `---`-fenced flat frontmatter (one `key: value` per line) + a prose guidance body.
Validated by `scripts/validate_recipe.py`.

## Required frontmatter keys
- `inputs` — prior locked stages + research this stage consumes.
- `reuse_check` — what existing skill/asset/exemplar to look for before generating (reuse-first).
- `option_shape` — what an option is + how it is presented (e.g., "N voices" for a multi-voice channel).
- `critic_checks` — the stage-specific quality bars beyond the universal Enforcement Contract.
- `gate` — what the human is shown and what "approve" means.

## Optional frontmatter keys
- `routes_to` — the existing skill delegated to for a reuse resolution. Present only on stages that route to
  a skill (e.g. `niche`→idea-generator, `voice`→voiceover); omitted on playbook- or mechanically-authored
  stages (doctrine, format, guardrails, scaffold).

The prose body gives the human-readable guidance the engine follows for this stage.

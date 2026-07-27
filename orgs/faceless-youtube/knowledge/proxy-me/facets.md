# proxy-me facet manifest

Pointer table the `proxy-judge` harness reads to resolve a facet's taste pack.
`<ch>` is substituted from the `--channel` argument. Add a new `##` block to add a facet.
See `docs/superpowers/specs/2026-07-09-proxy-judge-story-editor-me-design.md` §5.

## story
grammar: channels/<ch>/storytelling-grammar.md
voice: .claude/skills/long-form-writer/references/personable-calibration.md
calibration: knowledge/proxy-me/story/calibration-set.md
gates: verdict-only (no numeric score); judged against grammar + calibration TRAINING set

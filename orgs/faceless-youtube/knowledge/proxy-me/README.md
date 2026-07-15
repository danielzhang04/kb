# proxy-me — proxies of how Daniel judges the pipeline

This folder holds the **taste packs and calibration data** for `proxy-judge`, the skill that stands
where Daniel stands at a pipeline gate and renders his verdict on an output.

## The harness / taste-pack split

- **The harness** (facet-agnostic, lives in `.claude/skills/proxy-judge/`): the skill, the judge
  subagent prompt, the verdict contract, and the Python helpers. Built and proven ONCE.
- **A taste pack** (per facet, lives here under `<facet>/`): pure data — a rubric + grammar + gold
  exemplar + a `calibration-set.md` (Daniel's labeled judgments). Pointed at by `facets.md`.

The judge runs as a **fresh-context subagent** (separate context window = real fresh eyes), because a
model checking work in the same context shares its blind spot (`knowledge/decisions.md`).

## Facets

| Facet | Gate it stands at | Status |
| --- | --- | --- |
| `story` | long-form script, after `humanize` | v1 — being built + proven |
| `idea` | idea pick + channel setup | design-only; reuse the harness once story clears the bar |
| `art` | scene / thumbnail / font taste | design-only |
| `voice` | VO A/B | deprioritized (largely locked) |

## To add a facet

1. Author its taste pack (rubric + grammar + gold) and a `<facet>/calibration-set.md`.
2. Add a `## <facet>` block to `facets.md` pointing at those files.
3. Reuse the same skill, judge prompt, verdict contract, and calibration protocol — no new code.

The harness is frozen for reuse only AFTER the `story` facet clears its agreement bar
(`story/agreement-report.md`).

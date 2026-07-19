---
inputs: the locked niche + the visual-style direction + the production-pipeline registry (built pipelines)
reuse_check: the registry of BUILT pipelines (today - stylized-compositing) + the visual-style's rendering needs
option_shape: the recommended pipeline from the registry, OR - if the style needs a capability we don't have - a flagged NEW-pipeline BUILD proposal with its cost + the no-slop bar
critic_checks: the pipeline can render the locked style at the no-slop bar; the reuse-vs-build cost is explicit (never a hidden veto); a BUILD routes into brainstorm->plan->build for that pipeline
gate: the human approves the pipeline (or authorizes a new-pipeline build); on approval it sets capability-map.json production_pipeline
---

# Recipe: production-pipeline stage

Which BUILT production pipeline the channel uses — or a decision to build a new one (spec §8). Registry-driven.
**Gather** the visual-style + the registry. **Reuse-first:** pick a built pipeline if the style fits. **Generate**
the recommendation, or a flagged new-build proposal + cost when the style needs a capability we lack. **Critics:**
renders-at-no-slop, explicit cost, build-routes-to-a-project. **Gate:** human approves reuse or authorizes the
build → capability-map production_pipeline.

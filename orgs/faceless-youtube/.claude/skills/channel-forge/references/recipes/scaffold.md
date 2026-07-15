---
inputs: every prior locked stage (niche, doctrine, format, visual-style, voice, production-pipeline, capability-map, storytelling-grammar, guardrails)
reuse_check: channels/_TEMPLATE/ (copy it) + the inheritance model (reference the universal infra, never duplicate it)
option_shape: the materialized channel folder - dna.md assembled from every locked stage + capability-map.json + the style-bible + storytelling-grammar + a backlog stub
critic_checks: dna.md is complete + CONSISTENT with every locked stage; capability-map.json validates; the tree is clean (no scratch/.workspace); universal infra is referenced, not copied
gate: the human reviews the assembled channel folder; on approval it is committed
---

# Recipe: scaffold stage

Materialize the real channel folder from every locked decision. Mechanical assembly — no skill routes here.
**Gather** all prior stages. **Reuse-first:** copy `_TEMPLATE/`, reference universal infra. **Generate** the
assembled `channels/<name>/` (dna.md woven from the locked stages + capability-map + style-bible + grammar).
**Critics:** complete + consistent + validates + clean + inheritance-correct. **Gate:** human reviews the folder →
commit.

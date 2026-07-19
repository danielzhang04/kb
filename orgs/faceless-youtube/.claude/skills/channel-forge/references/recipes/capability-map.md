---
inputs: the locked niche + production-pipeline + the pipeline slot list (research/script/visual/motion/audio/voice/render/publish...)
reuse_check: the existing skills per slot + what The Second Take reuses + the capability-map-schema.md
option_shape: a proposed resolution per slot (reuse / reconfigure / adapt / build / n-a) with one-line reasoning each
critic_checks: every slot resolved; reuse-first (never rebuild what exists); a build slot carries a plan ref; the whole map passes validate_capability_map.py
gate: the human approves the map; a build slot routes into brainstorm->plan->build for that capability
---

# Recipe: capability-map stage

How each production slot is satisfied for this channel (spec §4). This stage authors
`channels/<name>/capability-map.json`. **Gather** the pipeline + slot list. **Reuse-first IS the job** here —
propose reuse/reconfigure/adapt/build/n-a per slot with reasoning. **Critics:** all slots resolved, reuse-first,
build-has-a-plan, validates clean. **Gate:** human approves; each `build` becomes its own brainstorm->plan->build.

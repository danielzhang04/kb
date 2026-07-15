# Channel template

Copy this folder to `channels/<name>/` to start a channel. `channel-forge` fills it in stage-by-stage.

## What lives here (channel-specific, freshly built)
- `dna.md`, `idea-backlog.md`, `performance.md`
- `capability-map.json` — copy from `capability-map.example.json`; declares how each pipeline slot is
  resolved (reuse / reconfigure / adapt / build / n/a). Schema + rules:
  `.claude/skills/channel-forge/references/capability-map-schema.md`.
- `visual-kit/`, `storytelling-grammar.md`, etc. — built during genesis.
- `.workspace/` — **ephemeral** exploration; pruned on lock by
  `.claude/skills/channel-forge/scripts/prune_workspace.py`. Never commit scratch from here.

## What is NOT copied here (universal, referenced)
The skills, the `knowledge/` playbook + `universal.md`, and the dna / style-bible / guardrail *schemas*
live at the repo root and are **referenced, never duplicated** into a channel. A channel is data; the
machinery is shared.

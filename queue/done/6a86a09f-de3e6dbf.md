---
id: 6a86a09f-de3e6dbf
project: kb-ops
action: codex-dispatch
target: C:\Users\danie\kb-clones\bricks-arc\orgs\faceless-youtube
risk-tier: T1
owner: codex-worker
claim-token: c00a0a3b04d4b324
state: done
approval: null
workflow: 01a01ddb-ca5b-72a1-b533-f08babfcb775
depends-on: []
variant-group: null
role: work
session-id: 6a869ea4-a2a5b05e
runtime: codex
model: gpt-5.6-terra
execution-controller: terminal
---

## Work order

\# Brief: doctrine era map — full governing stack × era, section-level, evidence-annotated

You are a codex forensics worker on the kb fleet. READ-ONLY except your report. Read-only git REQUIRED. No network. UTF-8.

WORKING ROOT: C:/Users/danie/kb-clones/bricks-arc/orgs/faceless-youtube

\## Commission context (Daniel's words, binding)
"Combining mostly reversions with some modern text. Apply across the board. We shouldn't be trying to layer on function. Analyze past and present versions and edit select parts to achieve better performance like we've seen in the past. This shouldn't just apply to bricks, it should apply to all [channels]."
This brief is phase 1: the EVIDENCE MAP a reconciliation plan will be built on. No recommendations yet — inventory and evidence only.

\## The stack (map every file)
ORG SKILLS (cross-channel layer): .claude/skills/visual-prompt-writer/ (SKILL.md, references/*, scripts/lint_shots.py), .claude/skills/image-generation/ (SKILL.md, scripts/forge.py + stamp_review + related)
CHANNEL KIT (taste layer, the-second-take): channels/the-second-take/visual-kit/visual-grammar.md, style-bible.md, registry/registry.json (doctrine-bearing notes), channels/the-second-take/example-shots.md

\## Era snapshots (identify the exact sha per file per era from git log; record them)
E1 poyais-final (~2026-07-18/20) · E2 liked-bricks (30d2b7e8 era, ~2026-07-28..08-05) · E3 doctrine-reset (2026-08-06/07) · E4 taste-forensics v1+v2 (33676421..f8aa5e52) · E5 current (f1c3b1aa+)

\## Per file: section-level era table
Break each file into its functional sections (authoring procedure, figure law, palette/color text, chain/stage rules, depiction classes, camera/vantage, crowd, lint rules, prompt assembly, suffix, review gates, parallelization, ...). For each section × era: what the text said (one line + the load-bearing phrase verbatim), when it changed (sha), and any stated reason (commit msg / handoff). Mark sections UNCHANGED-SINCE-E1 explicitly — those are not candidates for anything.

\## Evidence annotations (the crucial part — attach per section, honest, cite the file)
Performance evidence available: Daniel's verdicts (scratchpad/taste-audit/taste-ground-truth.md; the poyais-visual/register audits; threeway-* audits; character-presence-audit.md; palette-forensics.md — all under channels/the-second-take/videos/2026-07-28-bricks-fresh/scratchpad/taste-audit/), verified/park rates per gen run (genlogs, manifests), critic verdicts (vpw2 + vpw3), and known-fixed failure classes (rig drift, no-op deltas, template convergence, prop-text bake, stale-collision). For each section: which era's text has POSITIVE evidence, which has NEGATIVE, which has NONE (say "no evidence" plainly — do not infer).

\## Layering audit
Flag every passage sitting at the wrong layer: channel-specific taste hard-coded in org skills (breaks other channels), or channel-agnostic process logic living only in the-second-take kit (other channels don't inherit it). Check what other channel kits exist under channels/ for comparison.

OUTPUT → doctrine-recon/era-map.md under WORKING ROOT (create the dir). Structured: one table per file, evidence column, layer-flag column.
Final message: file count, section count, counts by evidence status (positive-past / positive-present / negative-present / none), top 10 sections where PAST text has positive evidence and PRESENT text has negative, layer-violation count. Nothing else.

## Result

[era-map.md](C:\Users\danie\kb-clones\bricks-arc\orgs\faceless-youtube\doctrine-recon\era-map.md)

14 files; 60 sections.

Evidence tags: +past 18; +present 31; −present 26; none 11.

Top 10 past-positive / present-negative sections:

1. Style descriptor / assembly
2. Non-literal depiction
3. Chain / delta law
4. Palette authoring
5. Figure / crowd staging
6. Composition / world scale
7. Example-shot calibration
8. Crowd-rig rendering
9. Prompt register / palette assembly
10. Critic gate

Layer violations: 18.
